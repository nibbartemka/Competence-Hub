from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, Topic, TopicKnowledgeElement
from app.schemas import (
    KnowledgeElementCreate,
    KnowledgeElementRead,
    KnowledgeElementUpdate,
)
from app.services.topic_dependencies import sync_topic_dependencies_for_disciplines


router = APIRouter(prefix="/knowledge-elements", tags=["Knowledge Elements"])


@router.get("/", response_model=list[KnowledgeElementRead])
async def list_knowledge_elements(session: DbSession) -> list[KnowledgeElement]:
    result = await session.execute(
        select(KnowledgeElement).order_by(
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
    element = KnowledgeElement(
        name=payload.name,
        description=payload.description,
        competence_type=payload.competence_type,
    )
    session.add(element)
    await commit_or_409(session)
    await session.refresh(element)
    return element


@router.get("/{element_id}", response_model=KnowledgeElementRead)
async def get_knowledge_element(element_id: UUID, session: DbSession) -> KnowledgeElement:
    element = await session.get(KnowledgeElement, element_id)
    if element is None:
        raise not_found("Knowledge element", element_id)
    return element


@router.put("/{element_id}", response_model=KnowledgeElementRead)
async def update_knowledge_element(
    element_id: UUID,
    payload: KnowledgeElementUpdate,
    session: DbSession,
) -> KnowledgeElement:
    element = await session.get(KnowledgeElement, element_id)
    if element is None:
        raise not_found("Knowledge element", element_id)

    element.name = payload.name
    element.description = payload.description
    element.competence_type = payload.competence_type
    await commit_or_409(session)
    await session.refresh(element)
    return element


@router.delete("/{element_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_element(element_id: UUID, session: DbSession) -> None:
    element = await session.get(KnowledgeElement, element_id)
    if element is None:
        raise not_found("Knowledge element", element_id)

    affected_disciplines_result = await session.execute(
        select(Topic.discipline_id)
        .join(TopicKnowledgeElement, TopicKnowledgeElement.topic_id == Topic.id)
        .where(TopicKnowledgeElement.element_id == element_id)
        .distinct()
    )
    affected_discipline_ids = list(affected_disciplines_result.scalars().all())

    await session.delete(element)
    await flush_or_409(session)
    await sync_topic_dependencies_for_disciplines(session, affected_discipline_ids)
    await commit_or_409(session)
