from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.orm import lazyload

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, KnowledgeElementRelation, Topic, TopicKnowledgeElement
from app.models.enums import TopicKnowledgeElementRole
from app.schemas import TopicKnowledgeElementCreate, TopicKnowledgeElementRead
from app.services.knowledge_graph_integrity import (
    assert_no_topic_dependency_cycle,
    bump_knowledge_graph_version,
    ensure_topic_element_link_can_be_removed,
)
from app.services.topic_dependencies import sync_topic_dependencies_for_discipline


router = APIRouter(prefix="/topic-knowledge-elements", tags=["Topic Knowledge Elements"])


async def _find_other_formed_topics_for_element(
    session: DbSession,
    *,
    discipline_id: UUID,
    element_id: UUID,
    exclude_topic_id: UUID,
) -> list[Topic]:
    result = await session.execute(
        select(Topic)
        .join(TopicKnowledgeElement, TopicKnowledgeElement.topic_id == Topic.id)
        .where(
            Topic.discipline_id == discipline_id,
            TopicKnowledgeElement.element_id == element_id,
            TopicKnowledgeElement.role == TopicKnowledgeElementRole.FORMED,
            Topic.id != exclude_topic_id,
        )
        .order_by(Topic.name)
    )
    return list(result.scalars().all())


@router.get("/", response_model=list[TopicKnowledgeElementRead])
async def list_topic_knowledge_elements(
    session: DbSession,
    topic_id: UUID | None = None,
    element_id: UUID | None = None,
    role: TopicKnowledgeElementRole | None = None,
) -> list[TopicKnowledgeElement]:
    query = select(TopicKnowledgeElement).options(lazyload("*"))
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
    topic_result = await session.execute(
        select(Topic).options(lazyload("*")).where(Topic.id == payload.topic_id)
    )
    topic = topic_result.scalar_one_or_none()
    if topic is None:
        raise not_found("Topic", payload.topic_id)

    element_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == payload.element_id)
    )
    element = element_result.scalar_one_or_none()
    if element is None:
        raise not_found("Knowledge element", payload.element_id)

    if element.discipline_id != topic.discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge element belongs to another discipline.",
        )

    if payload.role == TopicKnowledgeElementRole.FORMED:
        other_formed_topics = await _find_other_formed_topics_for_element(
            session,
            discipline_id=topic.discipline_id,
            element_id=element.id,
            exclude_topic_id=topic.id,
        )
        if other_formed_topics:
            other_topic_names = ", ".join(other_topic.name for other_topic in other_formed_topics)
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Элемент уже является формируемым в другой теме этой дисциплины: "
                    f"{other_topic_names}. Формируемые элементы тем дисциплины не должны пересекаться."
                ),
            )

    if payload.role == TopicKnowledgeElementRole.REQUIRED:
        other_formed_topics = await _find_other_formed_topics_for_element(
            session,
            discipline_id=topic.discipline_id,
            element_id=element.id,
            exclude_topic_id=topic.id,
        )
        if not other_formed_topics:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    "Элемент можно добавить как требуемый только если он уже является "
                    "формируемым хотя бы в одной другой теме той же дисциплины."
                ),
            )

    topic_element = TopicKnowledgeElement(
        topic_id=payload.topic_id,
        element_id=payload.element_id,
        role=payload.role,
        note=payload.note,
    )
    session.add(topic_element)
    await flush_or_409(session)
    await sync_topic_dependencies_for_discipline(session, topic.discipline_id)
    await assert_no_topic_dependency_cycle(session, topic.discipline_id)
    await bump_knowledge_graph_version(session, [topic.discipline_id])
    await commit_or_409(session)
    await session.refresh(topic_element)
    return topic_element


@router.delete("/{topic_element_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic_knowledge_element(topic_element_id: UUID, session: DbSession) -> None:
    topic_element_result = await session.execute(
        select(TopicKnowledgeElement)
        .options(lazyload("*"))
        .where(TopicKnowledgeElement.id == topic_element_id)
    )
    topic_element = topic_element_result.scalar_one_or_none()
    if topic_element is None:
        raise not_found("Topic knowledge element", topic_element_id)
    topic_result = await session.execute(
        select(Topic).options(lazyload("*")).where(Topic.id == topic_element.topic_id)
    )
    topic = topic_result.scalar_one_or_none()
    discipline_id = topic.discipline_id if topic is not None else None
    await ensure_topic_element_link_can_be_removed(session, topic_element.topic_id)

    await session.execute(
        delete(KnowledgeElementRelation).where(
            KnowledgeElementRelation.topic_id == topic_element.topic_id,
            or_(
                KnowledgeElementRelation.source_element_id == topic_element.element_id,
                KnowledgeElementRelation.target_element_id == topic_element.element_id,
            ),
        )
    )
    await session.delete(topic_element)
    await flush_or_409(session)

    if discipline_id is not None:
        await sync_topic_dependencies_for_discipline(session, discipline_id)
        await bump_knowledge_graph_version(session, [discipline_id])

    await commit_or_409(session)
