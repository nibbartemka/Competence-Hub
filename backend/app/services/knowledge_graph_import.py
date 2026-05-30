from __future__ import annotations

from collections.abc import Mapping
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import lazyload

from app.models import (
    Discipline,
    KnowledgeElement,
    KnowledgeElementRelation,
    Relation,
    Topic,
    TopicDependency,
    TopicKnowledgeElement,
)
from app.models.enums import TopicDependencySource
from app.schemas.knowledge_graph_io import (
    ImportPreviewElementRow,
    ImportPreviewKnowledgeElementRelationRow,
    ImportPreviewTopicDependencyRow,
    ImportPreviewTopicKnowledgeElementRow,
    ImportPreviewTopicRow,
    KnowledgeGraphExportFile,
    KnowledgeGraphImportPreviewResponse,
    KnowledgeGraphImportRequest,
    KnowledgeGraphImportResult,
)
from app.services.knowledge_graph_integrity import (
    assert_no_topic_dependency_cycle,
    bump_knowledge_graph_version,
)
from app.services.topic_dependencies import sync_topic_dependencies_for_discipline


def _validate_export_consistency(payload: KnowledgeGraphExportFile) -> None:
    topic_ids = {topic.id for topic in payload.topics}
    element_ids = {element.id for element in payload.knowledge_elements}

    for dep in payload.topic_dependencies:
        if dep.prerequisite_topic_id not in topic_ids or dep.dependent_topic_id not in topic_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В файле есть зависимость тем, ссылающаяся на неизвестную тему.",
            )

    for link in payload.topic_knowledge_elements:
        if link.topic_id not in topic_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В файле есть привязка элемента к теме с неизвестным id темы.",
            )
        if link.element_id not in element_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В файле есть привязка с неизвестным id элемента знаний.",
            )

    for ker in payload.knowledge_element_relations:
        if ker.topic_id not in topic_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В файле есть связь элементов с неизвестным id темы.",
            )
        if ker.source_element_id not in element_ids or ker.target_element_id not in element_ids:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В файле есть связь элементов, ссылающаяся на неизвестный элемент.",
            )
        source_linked = any(
            link.topic_id == ker.topic_id and link.element_id == ker.source_element_id
            for link in payload.topic_knowledge_elements
        )
        target_linked = any(
            link.topic_id == ker.topic_id and link.element_id == ker.target_element_id
            for link in payload.topic_knowledge_elements
        )
        if not source_linked or not target_linked:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В файле есть связь элементов вне темы, к которой привязаны оба элемента.",
            )


async def _load_target_topic_index(
    session: AsyncSession,
    discipline_id: UUID,
) -> dict[str, Topic]:
    result = await session.execute(
        select(Topic).options(lazyload("*")).where(Topic.discipline_id == discipline_id)
    )
    topics = list(result.scalars().all())
    return {topic.name: topic for topic in topics}


async def _load_target_element_index(
    session: AsyncSession,
    discipline_id: UUID,
) -> dict[tuple[str, str], KnowledgeElement]:
    result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.discipline_id == discipline_id)
    )
    elements = list(result.scalars().all())
    return {(element.name, element.competence_type.value): element for element in elements}


async def _load_relation_id_by_type(
    session: AsyncSession,
) -> dict[str, UUID]:
    result = await session.execute(select(Relation))
    relations = list(result.scalars().all())
    return {relation.relation_type.value: relation.id for relation in relations}


async def build_knowledge_graph_import_preview(
    session: AsyncSession,
    *,
    target_discipline_id: UUID,
    payload: KnowledgeGraphExportFile,
) -> KnowledgeGraphImportPreviewResponse:
    if payload.format_version != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неподдерживаемая версия формата экспорта.",
        )

    discipline_exists = await session.execute(select(Discipline.id).where(Discipline.id == target_discipline_id))
    if discipline_exists.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Дисциплина не найдена.",
        )

    _validate_export_consistency(payload)

    target_topics_by_name = await _load_target_topic_index(session, target_discipline_id)
    target_elements_by_key = await _load_target_element_index(session, target_discipline_id)

    topic_ids_in_discipline = [t.id for t in target_topics_by_name.values()]
    element_ids_in_discipline = [e.id for e in target_elements_by_key.values()]

    existing_topic_deps: set[tuple[UUID, UUID, str]] = set()
    if topic_ids_in_discipline:
        deps_result = await session.execute(
            select(TopicDependency).where(
                and_(
                    TopicDependency.prerequisite_topic_id.in_(topic_ids_in_discipline),
                    TopicDependency.dependent_topic_id.in_(topic_ids_in_discipline),
                )
            )
        )
        for row in deps_result.scalars().all():
            existing_topic_deps.add(
                (row.prerequisite_topic_id, row.dependent_topic_id, row.relation_type.value),
            )

    existing_tke: set[tuple[UUID, UUID]] = set()
    if topic_ids_in_discipline:
        tke_result = await session.execute(
            select(TopicKnowledgeElement).where(
                TopicKnowledgeElement.topic_id.in_(topic_ids_in_discipline)
            )
        )
        for row in tke_result.scalars().all():
            existing_tke.add((row.topic_id, row.element_id))

    existing_ker: set[tuple[UUID, UUID, UUID, UUID]] = set()
    if element_ids_in_discipline:
        ker_q = await session.execute(
            select(KnowledgeElementRelation).where(
                and_(
                    KnowledgeElementRelation.source_element_id.in_(element_ids_in_discipline),
                    KnowledgeElementRelation.target_element_id.in_(element_ids_in_discipline),
                )
            )
        )
        for row in ker_q.scalars().all():
            existing_ker.add((row.topic_id, row.source_element_id, row.target_element_id, row.relation_id))

    relation_type_to_id = await _load_relation_id_by_type(session)

    topic_rows: list[ImportPreviewTopicRow] = []
    for topic in payload.topics:
        existing = target_topics_by_name.get(topic.name)
        topic_rows.append(
            ImportPreviewTopicRow(
                export_id=topic.id,
                name=topic.name,
                description=topic.description,
                is_duplicate=existing is not None,
                existing_topic_id=existing.id if existing else None,
            )
        )

    element_rows: list[ImportPreviewElementRow] = []
    for element in payload.knowledge_elements:
        key = (element.name, element.competence_type.value)
        existing = target_elements_by_key.get(key)
        element_rows.append(
            ImportPreviewElementRow(
                export_id=element.id,
                name=element.name,
                competence_type=element.competence_type,
                description=element.description,
                is_duplicate=existing is not None,
                existing_element_id=existing.id if existing else None,
            )
        )

    export_topic_by_id: Mapping[UUID, object] = {t.id: t for t in payload.topics}
    export_element_by_id = {e.id: e for e in payload.knowledge_elements}

    dep_preview: list[ImportPreviewTopicDependencyRow] = []
    for dep in payload.topic_dependencies:
        pre_topic = export_topic_by_id.get(dep.prerequisite_topic_id)
        post_topic = export_topic_by_id.get(dep.dependent_topic_id)
        if pre_topic is None or post_topic is None:
            continue

        pre_existing = target_topics_by_name.get(pre_topic.name)
        post_existing = target_topics_by_name.get(post_topic.name)
        pre_dup = pre_existing is not None
        post_dup = post_existing is not None

        is_dup = False
        if pre_dup and post_dup:
            is_dup = (
                pre_existing.id,
                post_existing.id,
                dep.relation_type.value,
            ) in existing_topic_deps

        dep_preview.append(
            ImportPreviewTopicDependencyRow(
                export_id=dep.id,
                prerequisite_topic_export_id=dep.prerequisite_topic_id,
                dependent_topic_export_id=dep.dependent_topic_id,
                relation_type=dep.relation_type,
                description=dep.description,
                is_duplicate=is_dup,
                prerequisite_is_duplicate=pre_dup,
                dependent_is_duplicate=post_dup,
            )
        )

    tke_preview: list[ImportPreviewTopicKnowledgeElementRow] = []
    for link in payload.topic_knowledge_elements:
        t_ex = export_topic_by_id.get(link.topic_id)
        el_ex = export_element_by_id.get(link.element_id)
        if t_ex is None or el_ex is None:
            continue

        t_tgt = target_topics_by_name.get(t_ex.name)
        el_key = (el_ex.name, el_ex.competence_type.value)
        el_tgt = target_elements_by_key.get(el_key)
        t_dup = t_tgt is not None
        el_dup = el_tgt is not None

        is_dup = False
        if t_dup and el_dup:
            is_dup = (t_tgt.id, el_tgt.id) in existing_tke

        tke_preview.append(
            ImportPreviewTopicKnowledgeElementRow(
                export_id=link.id,
                topic_export_id=link.topic_id,
                element_export_id=link.element_id,
                role=link.role,
                note=link.note,
                is_duplicate=is_dup,
                topic_is_duplicate=t_dup,
                element_is_duplicate=el_dup,
            )
        )

    ker_preview: list[ImportPreviewKnowledgeElementRelationRow] = []
    for ker in payload.knowledge_element_relations:
        topic_ex = export_topic_by_id.get(ker.topic_id)
        s_ex = export_element_by_id.get(ker.source_element_id)
        t_ex = export_element_by_id.get(ker.target_element_id)
        if topic_ex is None or s_ex is None or t_ex is None:
            continue

        topic_tgt = target_topics_by_name.get(topic_ex.name)
        s_key = (s_ex.name, s_ex.competence_type.value)
        t_key = (t_ex.name, t_ex.competence_type.value)
        s_tgt = target_elements_by_key.get(s_key)
        t_tgt = target_elements_by_key.get(t_key)
        topic_dup = topic_tgt is not None
        s_dup = s_tgt is not None
        t_dup = t_tgt is not None

        rel_id = relation_type_to_id.get(ker.relation_type.value)
        is_dup = False
        if rel_id is not None and topic_dup and s_dup and t_dup:
            is_dup = (topic_tgt.id, s_tgt.id, t_tgt.id, rel_id) in existing_ker

        ker_preview.append(
            ImportPreviewKnowledgeElementRelationRow(
                export_id=ker.id,
                topic_export_id=ker.topic_id,
                source_element_export_id=ker.source_element_id,
                target_element_export_id=ker.target_element_id,
                relation_type=ker.relation_type,
                description=ker.description,
                is_duplicate=is_dup,
                source_is_duplicate=s_dup,
                target_is_duplicate=t_dup,
            )
        )

    return KnowledgeGraphImportPreviewResponse(
        target_discipline_id=target_discipline_id,
        topics=topic_rows,
        knowledge_elements=element_rows,
        topic_dependencies=dep_preview,
        topic_knowledge_elements=tke_preview,
        knowledge_element_relations=ker_preview,
    )


async def execute_knowledge_graph_import(
    session: AsyncSession,
    *,
    target_discipline_id: UUID,
    request: KnowledgeGraphImportRequest,
) -> KnowledgeGraphImportResult:
    payload = request.export
    if payload.format_version != 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Неподдерживаемая версия формата экспорта.",
        )

    discipline_exists = await session.execute(select(Discipline.id).where(Discipline.id == target_discipline_id))
    if discipline_exists.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Дисциплина не найдена.",
        )

    _validate_export_consistency(payload)

    target_topics_by_name = await _load_target_topic_index(session, target_discipline_id)
    target_elements_by_key = await _load_target_element_index(session, target_discipline_id)
    relation_type_to_id = await _load_relation_id_by_type(session)

    topic_is_duplicate: dict[UUID, bool] = {}
    topic_duplicate_to_existing: dict[UUID, UUID] = {}
    for topic in payload.topics:
        existing = target_topics_by_name.get(topic.name)
        topic_is_duplicate[topic.id] = existing is not None
        if existing:
            topic_duplicate_to_existing[topic.id] = existing.id

    element_is_duplicate: dict[UUID, bool] = {}
    element_duplicate_to_existing: dict[UUID, UUID] = {}
    for element in payload.knowledge_elements:
        key = (element.name, element.competence_type.value)
        existing = target_elements_by_key.get(key)
        element_is_duplicate[element.id] = existing is not None
        if existing:
            element_duplicate_to_existing[element.id] = existing.id

    selected_topics = set(request.selected_topic_export_ids)
    selected_elements = set(request.selected_element_export_ids)

    for topic_id in selected_topics:
        if topic_is_duplicate.get(topic_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В выбор попала тема, которая уже есть в дисциплине.",
            )
        if not any(t.id == topic_id for t in payload.topics):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неизвестный id темы в списке выбранных.",
            )

    for element_id in selected_elements:
        if element_is_duplicate.get(element_id):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="В выбор попал элемент, который уже есть в дисциплине.",
            )
        if not any(e.id == element_id for e in payload.knowledge_elements):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неизвестный id элемента в списке выбранных.",
            )

    topic_id_map: dict[UUID, UUID] = {}
    created_topics = 0

    for topic in payload.topics:
        if topic_is_duplicate.get(topic.id):
            continue
        if topic.id not in selected_topics:
            continue
        new_topic = Topic(
            name=topic.name,
            description=topic.description,
            discipline_id=target_discipline_id,
        )
        session.add(new_topic)
        await session.flush()
        topic_id_map[topic.id] = new_topic.id
        target_topics_by_name[topic.name] = new_topic
        created_topics += 1

    element_id_map: dict[UUID, UUID] = {}
    created_elements = 0

    for element in payload.knowledge_elements:
        if element_is_duplicate.get(element.id):
            continue
        if element.id not in selected_elements:
            continue
        new_el = KnowledgeElement(
            name=element.name,
            description=element.description,
            competence_type=element.competence_type,
            discipline_id=target_discipline_id,
            operation_ref=getattr(element, "operation_ref", None),
        )
        session.add(new_el)
        await session.flush()
        element_id_map[element.id] = new_el.id
        target_elements_by_key[(element.name, element.competence_type.value)] = new_el
        created_elements += 1

    def resolve_topic_id(export_topic_id: UUID) -> UUID:
        if topic_is_duplicate.get(export_topic_id):
            return topic_duplicate_to_existing[export_topic_id]
        if export_topic_id in topic_id_map:
            return topic_id_map[export_topic_id]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для связи не хватает темы: отметьте тему к импорту или она должна уже существовать в дисциплине.",
        )

    def resolve_element_id(export_element_id: UUID) -> UUID:
        if element_is_duplicate.get(export_element_id):
            return element_duplicate_to_existing[export_element_id]
        if export_element_id in element_id_map:
            return element_id_map[export_element_id]
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Для связи не хватает элемента: отметьте элемент к импорту или он должен уже существовать.",
        )

    dep_by_export = {d.id: d for d in payload.topic_dependencies}
    created_deps = 0
    skipped_dup_deps = 0

    for dep_export_id in request.selected_topic_dependency_export_ids:
        dep = dep_by_export.get(dep_export_id)
        if dep is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неизвестная зависимость тем в списке выбранных.",
            )

        pre_id = resolve_topic_id(dep.prerequisite_topic_id)
        post_id = resolve_topic_id(dep.dependent_topic_id)

        exists = await session.execute(
            select(TopicDependency.id).where(
                and_(
                    TopicDependency.prerequisite_topic_id == pre_id,
                    TopicDependency.dependent_topic_id == post_id,
                    TopicDependency.relation_type == dep.relation_type,
                )
            )
        )
        if exists.scalar_one_or_none() is not None:
            skipped_dup_deps += 1
            continue

        session.add(
            TopicDependency(
                prerequisite_topic_id=pre_id,
                dependent_topic_id=post_id,
                relation_type=dep.relation_type,
                source=TopicDependencySource.MANUAL,
                description=dep.description,
            )
        )
        created_deps += 1

    await session.flush()

    tke_by_export = {x.id: x for x in payload.topic_knowledge_elements}
    created_tke = 0
    skipped_tke = 0

    for link_export_id in request.selected_topic_knowledge_element_export_ids:
        link = tke_by_export.get(link_export_id)
        if link is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неизвестная привязка тема–элемент в списке выбранных.",
            )

        topic_target = resolve_topic_id(link.topic_id)
        element_target = resolve_element_id(link.element_id)

        exists = await session.execute(
            select(TopicKnowledgeElement.id).where(
                and_(
                    TopicKnowledgeElement.topic_id == topic_target,
                    TopicKnowledgeElement.element_id == element_target,
                )
            )
        )
        if exists.scalar_one_or_none() is not None:
            skipped_tke += 1
            continue

        session.add(
            TopicKnowledgeElement(
                topic_id=topic_target,
                element_id=element_target,
                role=link.role,
                note=link.note,
            )
        )
        created_tke += 1

    await session.flush()

    ker_by_export = {x.id: x for x in payload.knowledge_element_relations}
    created_ker = 0
    skipped_ker = 0

    for ker_export_id in request.selected_knowledge_element_relation_export_ids:
        ker = ker_by_export.get(ker_export_id)
        if ker is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Неизвестная связь элементов в списке выбранных.",
            )

        rel_id = relation_type_to_id.get(ker.relation_type.value)
        if rel_id is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Тип связи не найден в системе: {ker.relation_type.value}",
            )

        src = resolve_element_id(ker.source_element_id)
        tgt = resolve_element_id(ker.target_element_id)
        topic_target = resolve_topic_id(ker.topic_id)

        exists = await session.execute(
            select(KnowledgeElementRelation.id).where(
                and_(
                    KnowledgeElementRelation.topic_id == topic_target,
                    KnowledgeElementRelation.source_element_id == src,
                    KnowledgeElementRelation.target_element_id == tgt,
                    KnowledgeElementRelation.relation_id == rel_id,
                )
            )
        )
        if exists.scalar_one_or_none() is not None:
            skipped_ker += 1
            continue

        session.add(
            KnowledgeElementRelation(
                topic_id=topic_target,
                source_element_id=src,
                target_element_id=tgt,
                relation_id=rel_id,
                description=ker.description,
            )
        )
        created_ker += 1

    await session.flush()
    await sync_topic_dependencies_for_discipline(session, target_discipline_id)
    await assert_no_topic_dependency_cycle(session, target_discipline_id)
    await bump_knowledge_graph_version(session, [target_discipline_id])

    return KnowledgeGraphImportResult(
        created_topics=created_topics,
        created_knowledge_elements=created_elements,
        created_topic_dependencies=created_deps,
        created_topic_knowledge_elements=created_tke,
        created_knowledge_element_relations=created_ker,
        skipped_duplicate_topic_dependencies=skipped_dup_deps,
        skipped_duplicate_topic_knowledge_elements=skipped_tke,
        skipped_duplicate_knowledge_element_relations=skipped_ker,
    )
