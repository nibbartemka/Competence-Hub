from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import lazyload

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.algorithm_library import get_operation_contract
from app.models import (
    Discipline,
    KnowledgeElement,
    KnowledgeElementRelation,
    MasterElementDomainObject,
    Relation,
    SkillAssessmentTask,
    Topic,
    TopicKnowledgeElement,
)
from app.models.enums import CompetenceType, KnowledgeElementRelationType, TopicKnowledgeElementRole
from app.schemas import (
    KnowledgeElementCreate,
    KnowledgeElementRead,
    KnowledgeElementUpdate,
    StructuredMasterKnowledgeElementCreate,
    StructuredMasterKnowledgeElementUpdate,
    StructuredSkillKnowledgeElementUpdate,
)
from app.services.knowledge_graph_integrity import (
    bump_knowledge_graph_version,
    ensure_element_can_be_removed,
    ensure_master_relies_on_relations,
)
from app.services.topic_dependencies import sync_topic_dependencies_for_disciplines


router = APIRouter(prefix="/knowledge-elements", tags=["Knowledge Elements"])


def _normalize_operation_ref(
    competence_type: CompetenceType,
    operation_ref: str | None,
) -> str | None:
    normalized = (operation_ref or "").strip() or None
    if competence_type == CompetenceType.CAN:
        if normalized is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Knowledge element of competence 'can' must reference an operation contract.",
            )
        if get_operation_contract(normalized) is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Operation contract '{normalized}' was not found in the local algorithm library.",
            )
        return normalized

    if normalized is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Only knowledge elements of competence 'can' can reference an operation contract.",
        )
    return None


def _normalize_subject_area_description(
    competence_type: CompetenceType,
    subject_area_description: str | None,
) -> str | None:
    normalized = (subject_area_description or "").strip() or None
    if competence_type == CompetenceType.MASTER:
        return normalized

    if normalized is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Only knowledge elements of competence 'master' can include "
                "a subject area description."
            ),
        )
    return None


async def _delete_all_element_relations(session: DbSession, element_id: UUID) -> None:
    relations_result = await session.execute(
        select(KnowledgeElementRelation)
        .options(lazyload("*"))
        .where(
            (KnowledgeElementRelation.source_element_id == element_id)
            | (KnowledgeElementRelation.target_element_id == element_id)
        )
    )
    for relation in relations_result.scalars().all():
        await session.delete(relation)


async def _prepare_structured_skill_payload(
    *,
    session: DbSession,
    discipline_id: UUID,
    topic_id: UUID,
    operation_ref: str,
    realized_knowledge_element_ids: list[UUID],
) -> tuple[Topic, str, list[UUID], Relation]:
    topic_result = await session.execute(
        select(Topic).options(lazyload("*")).where(Topic.id == topic_id)
    )
    topic = topic_result.scalar_one_or_none()
    if topic is None:
        raise not_found("Topic", topic_id)
    if topic.discipline_id != discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected topic must belong to the same discipline.",
        )

    normalized_operation_ref = _normalize_operation_ref(
        CompetenceType.CAN,
        operation_ref,
    )
    normalized_knowledge_ids = list(dict.fromkeys(realized_knowledge_element_ids))

    knowledge_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id.in_(normalized_knowledge_ids))
    )
    knowledge_elements = list(knowledge_result.scalars().all())
    knowledge_by_id = {element.id: element for element in knowledge_elements}
    missing_knowledge_ids = [
        element_id for element_id in normalized_knowledge_ids if element_id not in knowledge_by_id
    ]
    if missing_knowledge_ids:
        raise not_found("Knowledge element", missing_knowledge_ids[0])

    for knowledge_element_id in normalized_knowledge_ids:
        knowledge_element = knowledge_by_id[knowledge_element_id]
        if knowledge_element.discipline_id != discipline_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected knowledge elements must belong to the same discipline.",
            )
        if knowledge_element.competence_type != CompetenceType.KNOW:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Structured skill element flow expects related elements of "
                    "competence 'know'."
                ),
            )

    knowledge_topic_link_result = await session.execute(
        select(TopicKnowledgeElement.element_id).where(
            TopicKnowledgeElement.topic_id == topic.id,
            TopicKnowledgeElement.element_id.in_(normalized_knowledge_ids),
        )
    )
    linked_knowledge_ids = set(knowledge_topic_link_result.scalars().all())
    if len(linked_knowledge_ids) != len(normalized_knowledge_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Each related knowledge element must be linked to the chosen topic.",
        )

    relation_result = await session.execute(
        select(Relation)
        .options(lazyload("*"))
        .where(Relation.relation_type == KnowledgeElementRelationType.IMPLEMENTS)
    )
    implements_relation = relation_result.scalar_one_or_none()
    if implements_relation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Required relation definition 'implements' was not found.",
        )

    return topic, normalized_operation_ref, normalized_knowledge_ids, implements_relation


async def _prepare_structured_master_payload(
    *,
    session: DbSession,
    discipline_id: UUID,
    topic_id: UUID,
    automated_skill_element_ids: list[UUID],
    domain_objects,
) -> tuple[
    Topic,
    list[UUID],
    dict[KnowledgeElementRelationType, Relation],
    list[tuple[str, UUID]],
]:
    topic_result = await session.execute(
        select(Topic).options(lazyload("*")).where(Topic.id == topic_id)
    )
    topic = topic_result.scalar_one_or_none()
    if topic is None:
        raise not_found("Topic", topic_id)
    if topic.discipline_id != discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected topic must belong to the same discipline.",
        )

    normalized_skill_ids = list(dict.fromkeys(automated_skill_element_ids))
    skill_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id.in_(normalized_skill_ids))
    )
    skill_elements = list(skill_result.scalars().all())
    skill_elements_by_id = {element.id: element for element in skill_elements}
    missing_skill_ids = [
        element_id for element_id in normalized_skill_ids if element_id not in skill_elements_by_id
    ]
    if missing_skill_ids:
        raise not_found("Knowledge element", missing_skill_ids[0])

    for skill_element_id in normalized_skill_ids:
        skill_element = skill_elements_by_id[skill_element_id]
        if skill_element.discipline_id != discipline_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selected skill elements must belong to the same discipline.",
            )
        if skill_element.competence_type != CompetenceType.CAN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Structured master element flow expects skill elements of "
                    "competence 'can'."
                ),
            )
        if not skill_element.operation_ref:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each selected skill element must be linked to an algorithm operation.",
            )

    skill_topic_link_result = await session.execute(
        select(TopicKnowledgeElement.element_id).where(
            TopicKnowledgeElement.topic_id == topic.id,
            TopicKnowledgeElement.element_id.in_(normalized_skill_ids),
        )
    )
    linked_skill_ids = set(skill_topic_link_result.scalars().all())
    if len(linked_skill_ids) != len(normalized_skill_ids):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Each selected skill element must be linked to the chosen topic.",
        )

    relation_result = await session.execute(
        select(Relation).options(lazyload("*")).where(
            Relation.relation_type.in_(
                [
                    KnowledgeElementRelationType.IMPLEMENTS,
                    KnowledgeElementRelationType.AUTOMATES,
                    KnowledgeElementRelationType.RELIES_ON,
                ]
            )
        )
    )
    relations_by_type = {
        relation.relation_type: relation for relation in relation_result.scalars().all()
    }
    implements_relation = relations_by_type.get(KnowledgeElementRelationType.IMPLEMENTS)
    if implements_relation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Required relation definition 'implements' was not found.",
        )

    required_knowledge_result = await session.execute(
        select(KnowledgeElement)
        .join(
            KnowledgeElementRelation,
            KnowledgeElementRelation.target_element_id == KnowledgeElement.id,
        )
        .join(
            TopicKnowledgeElement,
            TopicKnowledgeElement.element_id == KnowledgeElement.id,
        )
        .where(
            KnowledgeElementRelation.topic_id == topic.id,
            KnowledgeElementRelation.source_element_id.in_(normalized_skill_ids),
            KnowledgeElementRelation.relation_id == implements_relation.id,
            TopicKnowledgeElement.topic_id == topic.id,
            KnowledgeElement.competence_type == CompetenceType.KNOW,
        )
        .order_by(KnowledgeElement.name)
    )
    required_knowledge_elements = list(
        {
            element.id: element
            for element in required_knowledge_result.scalars().all()
        }.values()
    )
    required_knowledge_by_id = {
        element.id: element for element in required_knowledge_elements
    }
    if not required_knowledge_by_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Selected skill elements have no related knowledge elements of "
                "competence 'know' in the chosen topic."
            ),
        )

    topic_knowledge_result = await session.execute(
        select(KnowledgeElement)
        .join(
            TopicKnowledgeElement,
            TopicKnowledgeElement.element_id == KnowledgeElement.id,
        )
        .where(
            TopicKnowledgeElement.topic_id == topic.id,
            KnowledgeElement.competence_type == CompetenceType.KNOW,
        )
        .order_by(KnowledgeElement.name)
    )
    topic_knowledge_by_id = {
        element.id: element for element in topic_knowledge_result.scalars().all()
    }

    cleaned_domain_objects: list[tuple[str, UUID]] = []
    covered_knowledge_ids: set[UUID] = set()
    seen_domain_object_pairs: set[tuple[str, UUID]] = set()
    for domain_object in domain_objects:
        object_name = domain_object.object_name.strip()
        if not object_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Each subject area object must have a name.",
            )
        if domain_object.knowledge_element_id not in topic_knowledge_by_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Subject area objects can only reference knowledge elements of "
                    "competence 'know' from the selected topic."
                ),
            )
        normalized_pair = (object_name.casefold(), domain_object.knowledge_element_id)
        if normalized_pair in seen_domain_object_pairs:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Duplicate subject area object mappings are not allowed. "
                    "Remove repeated object-to-knowledge pairs."
                ),
            )
        seen_domain_object_pairs.add(normalized_pair)
        cleaned_domain_objects.append((object_name, domain_object.knowledge_element_id))
        covered_knowledge_ids.add(domain_object.knowledge_element_id)

    missing_knowledge = [
        element.name
        for element_id, element in required_knowledge_by_id.items()
        if element_id not in covered_knowledge_ids
    ]
    if missing_knowledge:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "All related knowledge elements of competence 'know' must be covered. "
                f"Missing: {', '.join(missing_knowledge)}."
            ),
        )

    return topic, normalized_skill_ids, relations_by_type, cleaned_domain_objects


@router.get("/", response_model=list[KnowledgeElementRead])
async def list_knowledge_elements(
    session: DbSession,
    discipline_id: UUID | None = None,
) -> list[KnowledgeElement]:
    query = select(KnowledgeElement).options(lazyload("*"))
    if discipline_id is not None:
        query = query.where(KnowledgeElement.discipline_id == discipline_id)

    result = await session.execute(
        query.order_by(
            KnowledgeElement.competence_type,
            KnowledgeElement.name,
        )
    )
    return list(result.scalars().all())


@router.post("/", response_model=KnowledgeElementRead, status_code=status.HTTP_201_CREATED)
async def create_knowledge_element(
    payload: KnowledgeElementCreate,
    session: DbSession,
) -> KnowledgeElement:
    if payload.competence_type == CompetenceType.MASTER:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Knowledge elements of competence 'master' must be created "
                "through the structured master element flow."
            ),
        )

    discipline_exists = await session.execute(
        select(Discipline.id).where(Discipline.id == payload.discipline_id)
    )
    if discipline_exists.scalar_one_or_none() is None:
        raise not_found("Discipline", payload.discipline_id)

    operation_ref = _normalize_operation_ref(
        payload.competence_type,
        payload.operation_ref,
    )
    subject_area_description = _normalize_subject_area_description(
        payload.competence_type,
        payload.subject_area_description,
    )

    element = KnowledgeElement(
        name=payload.name,
        description=payload.description,
        subject_area_description=subject_area_description,
        competence_type=payload.competence_type,
        discipline_id=payload.discipline_id,
        operation_ref=operation_ref,
    )
    session.add(element)
    await flush_or_409(session)
    await bump_knowledge_graph_version(session, [payload.discipline_id])
    await commit_or_409(session)
    await session.refresh(element)
    return element


@router.post(
    "/master-structured",
    response_model=KnowledgeElementRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_structured_master_knowledge_element(
    payload: StructuredMasterKnowledgeElementCreate,
    session: DbSession,
) -> KnowledgeElement:
    discipline_exists = await session.execute(
        select(Discipline.id).where(Discipline.id == payload.discipline_id)
    )
    if discipline_exists.scalar_one_or_none() is None:
        raise not_found("Discipline", payload.discipline_id)

    topic, automated_skill_element_ids, relations_by_type, cleaned_domain_objects = (
        await _prepare_structured_master_payload(
            session=session,
            discipline_id=payload.discipline_id,
            topic_id=payload.topic_id,
            automated_skill_element_ids=payload.automated_skill_element_ids,
            domain_objects=payload.domain_objects,
        )
    )
    automates_relation = relations_by_type.get(KnowledgeElementRelationType.AUTOMATES)
    relies_on_relation = relations_by_type.get(KnowledgeElementRelationType.RELIES_ON)
    if automates_relation is None or relies_on_relation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Required relation definitions 'automates' and 'relies_on' were not found."
            ),
        )

    master_element = KnowledgeElement(
        name=payload.name,
        description=payload.description,
        subject_area_description=payload.subject_area_description.strip(),
        competence_type=CompetenceType.MASTER,
        discipline_id=payload.discipline_id,
        operation_ref=None,
    )
    session.add(master_element)
    await flush_or_409(session)

    session.add(
        TopicKnowledgeElement(
            topic_id=payload.topic_id,
            element_id=master_element.id,
            role=TopicKnowledgeElementRole.FORMED,
            note=None,
        )
    )
    for skill_element_id in automated_skill_element_ids:
        session.add(
            KnowledgeElementRelation(
                topic_id=payload.topic_id,
                source_element_id=master_element.id,
                target_element_id=skill_element_id,
                relation_id=automates_relation.id,
                description=None,
            )
        )
    for object_name, knowledge_element_id in cleaned_domain_objects:
        session.add(
            MasterElementDomainObject(
                object_name=object_name,
                master_element_id=master_element.id,
                knowledge_element_id=knowledge_element_id,
            )
        )

    await flush_or_409(session)
    await ensure_master_relies_on_relations(session, payload.discipline_id)
    await bump_knowledge_graph_version(session, [payload.discipline_id])
    await commit_or_409(session)
    await session.refresh(master_element)
    return master_element


@router.get("/{element_id}", response_model=KnowledgeElementRead)
async def get_knowledge_element(element_id: UUID, session: DbSession) -> KnowledgeElement:
    result = await session.execute(
        select(KnowledgeElement).options(lazyload("*")).where(KnowledgeElement.id == element_id)
    )
    element = result.scalar_one_or_none()
    if element is None:
        raise not_found("Knowledge element", element_id)
    return element


@router.put(
    "/{element_id}/master-structured",
    response_model=KnowledgeElementRead,
)
async def update_structured_master_knowledge_element(
    element_id: UUID,
    payload: StructuredMasterKnowledgeElementUpdate,
    session: DbSession,
) -> KnowledgeElement:
    result = await session.execute(
        select(KnowledgeElement).options(lazyload("*")).where(KnowledgeElement.id == element_id)
    )
    element = result.scalar_one_or_none()
    if element is None:
        raise not_found("Knowledge element", element_id)
    if element.discipline_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge element must belong to a discipline.",
        )

    if element.competence_type == CompetenceType.CAN:
        task_result = await session.execute(
            select(SkillAssessmentTask.id)
            .where(SkillAssessmentTask.skill_element_id == element.id)
            .limit(1)
        )
        if task_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This skill element already has assessment tasks. "
                    "Delete the tasks before changing its competence level."
                ),
            )

    topic, automated_skill_element_ids, relations_by_type, cleaned_domain_objects = (
        await _prepare_structured_master_payload(
            session=session,
            discipline_id=element.discipline_id,
            topic_id=payload.topic_id,
            automated_skill_element_ids=payload.automated_skill_element_ids,
            domain_objects=payload.domain_objects,
        )
    )
    automates_relation = relations_by_type.get(KnowledgeElementRelationType.AUTOMATES)
    relies_on_relation = relations_by_type.get(KnowledgeElementRelationType.RELIES_ON)
    if automates_relation is None or relies_on_relation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Required relation definitions 'automates' and 'relies_on' were not found."
            ),
        )

    existing_topic_links_result = await session.execute(
        select(TopicKnowledgeElement)
        .options(lazyload("*"))
        .where(TopicKnowledgeElement.element_id == element.id)
    )
    existing_topic_links = list(existing_topic_links_result.scalars().all())
    formed_link_in_other_topic = next(
        (
            link
            for link in existing_topic_links
            if link.role == TopicKnowledgeElementRole.FORMED and link.topic_id != topic.id
        ),
        None,
    )
    if formed_link_in_other_topic is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Элемент уже является формируемым в другой теме. "
                "Сначала отвяжи его от той темы."
            ),
        )

    if element.competence_type != CompetenceType.MASTER:
        await _delete_all_element_relations(session, element.id)

    existing_master_relations_result = await session.execute(
        select(KnowledgeElementRelation)
        .join(Relation, Relation.id == KnowledgeElementRelation.relation_id)
        .where(
            KnowledgeElementRelation.source_element_id == element.id,
            Relation.relation_type.in_(
                [
                    KnowledgeElementRelationType.AUTOMATES,
                    KnowledgeElementRelationType.RELIES_ON,
                ]
            ),
        )
    )
    for relation in existing_master_relations_result.scalars().all():
        await session.delete(relation)

    existing_domain_objects_result = await session.execute(
        select(MasterElementDomainObject)
        .options(lazyload("*"))
        .where(MasterElementDomainObject.master_element_id == element.id)
    )
    for domain_object in existing_domain_objects_result.scalars().all():
        await session.delete(domain_object)

    topic_link_for_selected_topic = next(
        (link for link in existing_topic_links if link.topic_id == topic.id),
        None,
    )
    if topic_link_for_selected_topic is None:
        session.add(
            TopicKnowledgeElement(
                topic_id=topic.id,
                element_id=element.id,
                role=TopicKnowledgeElementRole.FORMED,
                note=None,
            )
        )
    else:
        topic_link_for_selected_topic.role = TopicKnowledgeElementRole.FORMED

    element.name = payload.name
    element.description = payload.description
    element.subject_area_description = payload.subject_area_description.strip()
    element.competence_type = CompetenceType.MASTER
    element.operation_ref = None

    for skill_element_id in automated_skill_element_ids:
        session.add(
            KnowledgeElementRelation(
                topic_id=topic.id,
                source_element_id=element.id,
                target_element_id=skill_element_id,
                relation_id=automates_relation.id,
                description=None,
            )
        )
    for object_name, knowledge_element_id in cleaned_domain_objects:
        session.add(
            MasterElementDomainObject(
                object_name=object_name,
                master_element_id=element.id,
                knowledge_element_id=knowledge_element_id,
            )
        )

    await flush_or_409(session)
    await ensure_master_relies_on_relations(session, element.discipline_id)
    await sync_topic_dependencies_for_disciplines(session, [element.discipline_id])
    await bump_knowledge_graph_version(session, [element.discipline_id])
    await commit_or_409(session)
    await session.refresh(element)
    return element


@router.put(
    "/{element_id}/skill-structured",
    response_model=KnowledgeElementRead,
)
async def update_structured_skill_knowledge_element(
    element_id: UUID,
    payload: StructuredSkillKnowledgeElementUpdate,
    session: DbSession,
) -> KnowledgeElement:
    result = await session.execute(
        select(KnowledgeElement).options(lazyload("*")).where(KnowledgeElement.id == element_id)
    )
    element = result.scalar_one_or_none()
    if element is None:
        raise not_found("Knowledge element", element_id)
    if element.discipline_id is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge element must belong to a discipline.",
        )

    if (
        element.competence_type == CompetenceType.CAN
        and element.operation_ref != payload.operation_ref
    ):
        task_result = await session.execute(
            select(SkillAssessmentTask.id)
            .where(SkillAssessmentTask.skill_element_id == element.id)
            .limit(1)
        )
        if task_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This skill element already has assessment tasks. "
                    "Delete the tasks before changing its operation contract."
                ),
            )

    topic, normalized_operation_ref, realized_knowledge_ids, implements_relation = (
        await _prepare_structured_skill_payload(
            session=session,
            discipline_id=element.discipline_id,
            topic_id=payload.topic_id,
            operation_ref=payload.operation_ref,
            realized_knowledge_element_ids=payload.realized_knowledge_element_ids,
        )
    )

    existing_topic_links_result = await session.execute(
        select(TopicKnowledgeElement)
        .options(lazyload("*"))
        .where(TopicKnowledgeElement.element_id == element.id)
    )
    existing_topic_links = list(existing_topic_links_result.scalars().all())
    formed_link_in_other_topic = next(
        (
            link
            for link in existing_topic_links
            if link.role == TopicKnowledgeElementRole.FORMED and link.topic_id != topic.id
        ),
        None,
    )
    if formed_link_in_other_topic is not None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Элемент уже является формируемым в другой теме. "
                "Сначала отвяжи его от той темы."
            ),
        )

    if element.competence_type != CompetenceType.CAN:
        if element.competence_type == CompetenceType.MASTER:
            existing_domain_objects_result = await session.execute(
                select(MasterElementDomainObject)
                .options(lazyload("*"))
                .where(MasterElementDomainObject.master_element_id == element.id)
            )
            for domain_object in existing_domain_objects_result.scalars().all():
                await session.delete(domain_object)
        await _delete_all_element_relations(session, element.id)
    else:
        existing_implements_result = await session.execute(
            select(KnowledgeElementRelation)
            .join(Relation, Relation.id == KnowledgeElementRelation.relation_id)
            .where(
                KnowledgeElementRelation.topic_id == topic.id,
                KnowledgeElementRelation.source_element_id == element.id,
                Relation.relation_type == KnowledgeElementRelationType.IMPLEMENTS,
            )
        )
        for relation in existing_implements_result.scalars().all():
            await session.delete(relation)

    topic_link_for_selected_topic = next(
        (link for link in existing_topic_links if link.topic_id == topic.id),
        None,
    )
    if topic_link_for_selected_topic is None:
        session.add(
            TopicKnowledgeElement(
                topic_id=topic.id,
                element_id=element.id,
                role=TopicKnowledgeElementRole.FORMED,
                note=None,
            )
        )
    else:
        topic_link_for_selected_topic.role = TopicKnowledgeElementRole.FORMED

    element.name = payload.name
    element.description = payload.description
    element.subject_area_description = None
    element.competence_type = CompetenceType.CAN
    element.operation_ref = normalized_operation_ref

    for knowledge_element_id in realized_knowledge_ids:
        session.add(
            KnowledgeElementRelation(
                topic_id=topic.id,
                source_element_id=element.id,
                target_element_id=knowledge_element_id,
                relation_id=implements_relation.id,
                description=None,
            )
        )

    await flush_or_409(session)
    await sync_topic_dependencies_for_disciplines(session, [element.discipline_id])
    await bump_knowledge_graph_version(session, [element.discipline_id])
    await commit_or_409(session)
    await session.refresh(element)
    return element


@router.put("/{element_id}", response_model=KnowledgeElementRead)
async def update_knowledge_element(
    element_id: UUID,
    payload: KnowledgeElementUpdate,
    session: DbSession,
) -> KnowledgeElement:
    result = await session.execute(
        select(KnowledgeElement).options(lazyload("*")).where(KnowledgeElement.id == element_id)
    )
    element = result.scalar_one_or_none()
    if element is None:
        raise not_found("Knowledge element", element_id)

    if (
        payload.competence_type == CompetenceType.MASTER
        and element.competence_type != CompetenceType.MASTER
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Use the structured master element flow to create knowledge elements "
                "of competence 'master'."
            ),
        )
    if (
        element.competence_type == CompetenceType.MASTER
        and payload.competence_type != CompetenceType.MASTER
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Knowledge elements of competence 'master' cannot be converted to "
                "another competence through the generic editor."
            ),
        )

    operation_ref = _normalize_operation_ref(
        payload.competence_type,
        payload.operation_ref,
    )
    subject_area_description = _normalize_subject_area_description(
        payload.competence_type,
        payload.subject_area_description,
    )

    if element.competence_type == CompetenceType.CAN and payload.competence_type != CompetenceType.CAN:
        task_result = await session.execute(
            select(SkillAssessmentTask.id)
            .where(SkillAssessmentTask.skill_element_id == element.id)
            .limit(1)
        )
        if task_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This skill element already has assessment tasks. "
                    "Delete the tasks before changing its competence level."
                ),
            )

    if (
        payload.competence_type == CompetenceType.CAN
        and element.operation_ref != operation_ref
    ):
        task_result = await session.execute(
            select(SkillAssessmentTask.id)
            .where(SkillAssessmentTask.skill_element_id == element.id)
            .limit(1)
        )
        if task_result.scalar_one_or_none() is not None:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=(
                    "This skill element already has assessment tasks. "
                    "Delete the tasks before changing its operation contract."
                ),
            )

    element.name = payload.name
    element.description = payload.description
    element.subject_area_description = subject_area_description
    if payload.competence_type != element.competence_type:
        await _delete_all_element_relations(session, element.id)
    element.competence_type = payload.competence_type
    element.operation_ref = operation_ref
    if element.discipline_id is not None:
        await bump_knowledge_graph_version(session, [element.discipline_id])
    await commit_or_409(session)
    await session.refresh(element)
    return element


@router.delete("/{element_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_element(element_id: UUID, session: DbSession) -> None:
    result = await session.execute(
        select(KnowledgeElement).options(lazyload("*")).where(KnowledgeElement.id == element_id)
    )
    element = result.scalar_one_or_none()
    if element is None:
        raise not_found("Knowledge element", element_id)
    await ensure_element_can_be_removed(session, element_id)

    affected_disciplines_result = await session.execute(
        select(Topic.discipline_id)
        .join(TopicKnowledgeElement, TopicKnowledgeElement.topic_id == Topic.id)
        .where(TopicKnowledgeElement.element_id == element_id)
        .distinct()
    )
    affected_discipline_ids = list(affected_disciplines_result.scalars().all())
    if element.discipline_id is not None and element.discipline_id not in affected_discipline_ids:
        affected_discipline_ids.append(element.discipline_id)

    await session.delete(element)
    await flush_or_409(session)
    await sync_topic_dependencies_for_disciplines(session, affected_discipline_ids)
    await bump_knowledge_graph_version(session, affected_discipline_ids)
    await commit_or_409(session)
