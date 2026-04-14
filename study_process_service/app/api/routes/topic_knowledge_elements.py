from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, Topic, TopicKnowledgeElement
from app.schemas import TopicKnowledgeElementCreate, TopicKnowledgeElementRead


router = APIRouter(prefix="/topic-knowledge-elements", tags=["Topic Knowledge Elements"])


@router.get("/", response_model=list[TopicKnowledgeElementRead])
async def list_topic_knowledge_elements(
    session: DbSession,
    topic_id: UUID | None = None,
    element_id: UUID | None = None,
) -> list[TopicKnowledgeElement]:
    query = select(TopicKnowledgeElement)
    if topic_id is not None:
        query = query.where(TopicKnowledgeElement.topic_id == topic_id)
    if element_id is not None:
        query = query.where(TopicKnowledgeElement.element_id == element_id)
    result = await session.execute(query.order_by(TopicKnowledgeElement.id))
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
        note=payload.note,
    )
    session.add(topic_element)
    await commit_or_409(session)
    await session.refresh(topic_element)
    return topic_element


@router.delete("/{topic_element_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic_knowledge_element(topic_element_id: UUID, session: DbSession) -> None:
    topic_element = await session.get(TopicKnowledgeElement, topic_element_id)
    if topic_element is None:
        raise not_found("Topic knowledge element", topic_element_id)
    await delete_and_commit(session, topic_element)
