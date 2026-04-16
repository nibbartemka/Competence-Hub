from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import Discipline, Topic
from app.schemas import TopicCreate, TopicRead, TopicUpdate


router = APIRouter(prefix="/topics", tags=["Topics"])


@router.get("/", response_model=list[TopicRead])
async def list_topics(
    session: DbSession,
    discipline_id: UUID | None = None,
) -> list[Topic]:
    query = select(Topic).order_by(Topic.name)
    if discipline_id is not None:
        query = query.where(Topic.discipline_id == discipline_id)
    result = await session.execute(query)
    return list(result.scalars().all())


@router.post("/", response_model=TopicRead, status_code=status.HTTP_201_CREATED)
async def create_topic(payload: TopicCreate, session: DbSession) -> Topic:
    discipline = await session.get(Discipline, payload.discipline_id)
    if discipline is None:
        raise not_found("Discipline", payload.discipline_id)

    topic = Topic(
        name=payload.name,
        description=payload.description,
        discipline_id=payload.discipline_id,
    )
    session.add(topic)
    await commit_or_409(session)
    await session.refresh(topic)
    return topic


@router.get("/{topic_id}", response_model=TopicRead)
async def get_topic(topic_id: UUID, session: DbSession) -> Topic:
    topic = await session.get(Topic, topic_id)
    if topic is None:
        raise not_found("Topic", topic_id)
    return topic


@router.put("/{topic_id}", response_model=TopicRead)
async def update_topic(
    topic_id: UUID,
    payload: TopicUpdate,
    session: DbSession,
) -> Topic:
    topic = await session.get(Topic, topic_id)
    if topic is None:
        raise not_found("Topic", topic_id)

    topic.name = payload.name
    topic.description = payload.description
    await commit_or_409(session)
    await session.refresh(topic)
    return topic


@router.delete("/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(topic_id: UUID, session: DbSession) -> None:
    topic = await session.get(Topic, topic_id)
    if topic is None:
        raise not_found("Topic", topic_id)
    await delete_and_commit(session, topic)
