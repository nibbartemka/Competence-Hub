from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, Topic, TopicKnowledgeElement
from app.models.enums import TopicKnowledgeElementRole
from app.schemas import TopicKnowledgeElementCreate, TopicKnowledgeElementRead
from app.services.topic_dependencies import sync_topic_dependencies_for_discipline


router = APIRouter(prefix="/topic-knowledge-elements", tags=["Topic Knowledge Elements"])


@router.get("/", response_model=list[TopicKnowledgeElementRead])
async def list_topic_knowledge_elements(
    session: DbSession,
    topic_id: UUID | None = None,
    element_id: UUID | None = None,
    role: TopicKnowledgeElementRole | None = None,
) -> list[TopicKnowledgeElement]:
    query = select(TopicKnowledgeElement)
    if topic_id is not None:
        query = query.where(TopicKnowledgeElement.topic_id == topic_id)
    if element_id is not None:
        query = query.where(TopicKnowledgeElement.element_id == element_id)
    if role is not None:
        query = query.where(TopicKnowledgeElement.role == role)
    result = await session.execute(
        query.order_by(
            TopicKnowledgeElement.topic_id,
            TopicKnowledgeElement.role,
            TopicKnowledgeElement.id,
        )
    )
    return list(result.scalars().all())


@router.post("/", response_model=TopicKnowledgeElementRead, status_code=status.HTTP_201_CREATED)
async def create_topic_knowledge_element(
    payload: TopicKnowledgeElementCreate,
    session: DbSession,
) -> TopicKnowledgeElement:
    topic = await session.get(Topic, payload.topic_id)
    if topic is None:
        raise not_found("Topic", payload.topic_id)

    element = await session.get(KnowledgeElement, payload.element_id)
    if element is None:
        raise not_found("Knowledge element", payload.element_id)

    topic_element = TopicKnowledgeElement(
        topic_id=payload.topic_id,
        element_id=payload.element_id,
        role=payload.role,
        note=payload.note,
    )
    session.add(topic_element)
    await flush_or_409(session)
    await sync_topic_dependencies_for_discipline(session, topic.discipline_id)
    await commit_or_409(session)
    await session.refresh(topic_element)
    return topic_element


@router.delete("/{topic_element_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic_knowledge_element(topic_element_id: UUID, session: DbSession) -> None:
    topic_element = await session.get(TopicKnowledgeElement, topic_element_id)
    if topic_element is None:
        raise not_found("Topic knowledge element", topic_element_id)
    topic = await session.get(Topic, topic_element.topic_id)
    discipline_id = topic.discipline_id if topic is not None else None

    await session.delete(topic_element)
    await flush_or_409(session)

    if discipline_id is not None:
        await sync_topic_dependencies_for_discipline(session, discipline_id)

    await commit_or_409(session)
