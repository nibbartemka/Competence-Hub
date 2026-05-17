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

    topic_result = await session.execute(
        select(Topic).options(lazyload("*")).where(Topic.id == payload.topic_id)
    )
    topic = topic_result.scalar_one_or_none()
    if topic is None:
        raise not_found("Topic", payload.topic_id)
    if topic.discipline_id != payload.discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected topic must belong to the same discipline.",
        )

    skill_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == payload.automated_skill_element_id)
    )
    skill_element = skill_result.scalar_one_or_none()
    if skill_element is None:
        raise not_found("Knowledge element", payload.automated_skill_element_id)
    if skill_element.discipline_id != payload.discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected skill element must belong to the same discipline.",
        )
    if skill_element.competence_type != CompetenceType.CAN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Structured master element flow expects a skill element of competence 'can'.",
        )
    if not skill_element.operation_ref:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected skill element must be linked to an algorithm operation.",
        )

    skill_topic_link_result = await session.execute(
        select(TopicKnowledgeElement.id).where(
            TopicKnowledgeElement.topic_id == payload.topic_id,
            TopicKnowledgeElement.element_id == skill_element.id,
        )
    )
    if skill_topic_link_result.scalar_one_or_none() is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Selected skill element must be linked to the chosen topic.",
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
        relation.relation_type: relation
        for relation in relation_result.scalars().all()
    }
    implements_relation = relations_by_type.get(KnowledgeElementRelationType.IMPLEMENTS)
    automates_relation = relations_by_type.get(KnowledgeElementRelationType.AUTOMATES)
    relies_on_relation = relations_by_type.get(KnowledgeElementRelationType.RELIES_ON)
    if implements_relation is None or automates_relation is None or relies_on_relation is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Required relation definitions 'implements', 'automates' and "
                "'relies_on' were not found."
            ),
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
            KnowledgeElementRelation.topic_id == payload.topic_id,
            KnowledgeElementRelation.source_element_id == skill_element.id,
            KnowledgeElementRelation.relation_id == implements_relation.id,
            TopicKnowledgeElement.topic_id == payload.topic_id,
            KnowledgeElement.competence_type == CompetenceType.KNOW,
        )
        .order_by(KnowledgeElement.name)
    )
    required_knowledge_elements = list(required_knowledge_result.scalars().all())
    required_knowledge_by_id = {
        element.id: element for element in required_knowledge_elements
    }
    if not required_knowledge_by_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Selected skill element has no related knowledge elements of competence "
                "'know' in the chosen topic."
            ),
        )

    topic_knowledge_result = await session.execute(
        select(KnowledgeElement)
        .join(
            TopicKnowledgeElement,
            TopicKnowledgeElement.element_id == KnowledgeElement.id,
        )
        .where(
            TopicKnowledgeElement.topic_id == payload.topic_id,
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
    for domain_object in payload.domain_objects:
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
        cleaned_domain_objects.append(
            (object_name, domain_object.knowledge_element_id)
        )
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
    session.add(
        KnowledgeElementRelation(
            topic_id=payload.topic_id,
            source_element_id=master_element.id,
            target_element_id=skill_element.id,
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
