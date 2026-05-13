from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import lazyload

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.algorithm_library import get_operation_contract
from app.models import Discipline, KnowledgeElement, SkillAssessmentTask, Topic, TopicKnowledgeElement
from app.models.enums import CompetenceType
from app.schemas import (
    KnowledgeElementCreate,
    KnowledgeElementRead,
    KnowledgeElementUpdate,
)
from app.services.knowledge_graph_integrity import (
    bump_knowledge_graph_version,
    ensure_element_can_be_removed,
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
    discipline_exists = await session.execute(
        select(Discipline.id).where(Discipline.id == payload.discipline_id)
    )
    if discipline_exists.scalar_one_or_none() is None:
        raise not_found("Discipline", payload.discipline_id)

    operation_ref = _normalize_operation_ref(
        payload.competence_type,
        payload.operation_ref,
    )

    element = KnowledgeElement(
        name=payload.name,
        description=payload.description,
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

    operation_ref = _normalize_operation_ref(
        payload.competence_type,
        payload.operation_ref,
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
