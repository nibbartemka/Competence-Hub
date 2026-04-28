from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.orm import lazyload

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import Discipline, Topic
from app.schemas import TopicCreate, TopicRead, TopicUpdate
from app.services.knowledge_graph_integrity import (
    assert_no_topic_dependency_cycle,
    bump_knowledge_graph_version,
    ensure_topic_can_be_removed,
)
from app.services.topic_dependencies import sync_topic_dependencies_for_discipline


router = APIRouter(prefix="/topics", tags=["Topics"])


@router.get("/", response_model=list[TopicRead])
async def list_topics(
    session: DbSession,
    discipline_id: UUID | None = None,
) -> list[Topic]:
    query = select(Topic).options(lazyload("*")).order_by(Topic.name)
    if discipline_id is not None:
        query = query.where(Topic.discipline_id == discipline_id)
    result = await session.execute(query)
    return list(result.scalars().all())


@router.post("/", response_model=TopicRead, status_code=status.HTTP_201_CREATED)
async def create_topic(payload: TopicCreate, session: DbSession) -> Topic:
    discipline_exists = await session.execute(
        select(Discipline.id).where(Discipline.id == payload.discipline_id)
    )
    if discipline_exists.scalar_one_or_none() is None:
        raise not_found("Discipline", payload.discipline_id)

    topic = Topic(
        name=payload.name,
        description=payload.description,
        discipline_id=payload.discipline_id,
    )
    session.add(topic)
    await flush_or_409(session)
    await sync_topic_dependencies_for_discipline(session, payload.discipline_id)
    await assert_no_topic_dependency_cycle(session, payload.discipline_id)
    await bump_knowledge_graph_version(session, [payload.discipline_id])
    await commit_or_409(session)
    await session.refresh(topic)
    return topic


@router.get("/{topic_id}", response_model=TopicRead)
async def get_topic(topic_id: UUID, session: DbSession) -> Topic:
    result = await session.execute(select(Topic).options(lazyload("*")).where(Topic.id == topic_id))
    topic = result.scalar_one_or_none()
    if topic is None:
        raise not_found("Topic", topic_id)
    return topic


@router.put("/{topic_id}", response_model=TopicRead)
async def update_topic(
    topic_id: UUID,
    payload: TopicUpdate,
    session: DbSession,
) -> Topic:
    result = await session.execute(select(Topic).options(lazyload("*")).where(Topic.id == topic_id))
    topic = result.scalar_one_or_none()
    if topic is None:
        raise not_found("Topic", topic_id)

    topic.name = payload.name
    topic.description = payload.description
    await flush_or_409(session)
    await sync_topic_dependencies_for_discipline(session, topic.discipline_id)
    await assert_no_topic_dependency_cycle(session, topic.discipline_id)
    await bump_knowledge_graph_version(session, [topic.discipline_id])
    await commit_or_409(session)
    await session.refresh(topic)
    return topic


@router.delete("/{topic_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic(topic_id: UUID, session: DbSession) -> None:
    result = await session.execute(select(Topic).options(lazyload("*")).where(Topic.id == topic_id))
    topic = result.scalar_one_or_none()
    if topic is None:
        raise not_found("Topic", topic_id)
    await ensure_topic_can_be_removed(session, topic_id)
    discipline_id = topic.discipline_id
    await session.delete(topic)
    await flush_or_409(session)
    await sync_topic_dependencies_for_discipline(session, discipline_id)
    await bump_knowledge_graph_version(session, [discipline_id])
    await commit_or_409(session)
