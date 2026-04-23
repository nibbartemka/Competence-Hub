from collections.abc import Iterable
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Discipline,
    LearningTrajectory,
    LearningTrajectoryElement,
    LearningTrajectoryTopic,
    Topic,
    TopicKnowledgeElement,
)
from app.models.enums import LearningTrajectoryStatus
from app.services.topic_dependencies import get_topic_dependency_cycle_for_discipline


async def bump_knowledge_graph_version(
    session: AsyncSession,
    discipline_ids: Iterable[UUID],
) -> None:
    unique_ids = list(dict.fromkeys(discipline_ids))
    if not unique_ids:
        return

    result = await session.execute(select(Discipline).where(Discipline.id.in_(unique_ids)))
    for discipline in result.scalars().all():
        discipline.knowledge_graph_version += 1


async def assert_no_topic_dependency_cycle(
    session: AsyncSession,
    discipline_id: UUID,
) -> None:
    cycle = await get_topic_dependency_cycle_for_discipline(session, discipline_id)
    if not cycle:
        return

    topics_result = await session.execute(select(Topic).where(Topic.id.in_(cycle)))
    topic_by_id = {topic.id: topic for topic in topics_result.scalars().all()}
    cycle_names = " -> ".join(topic_by_id.get(topic_id).name for topic_id in cycle if topic_id in topic_by_id)
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail=f"Topic dependency cycle detected: {cycle_names}.",
    )


async def ensure_topic_can_be_removed(session: AsyncSession, topic_id: UUID) -> None:
    result = await session.execute(
        select(LearningTrajectory.name)
        .join(LearningTrajectoryTopic, LearningTrajectoryTopic.trajectory_id == LearningTrajectory.id)
        .where(
            LearningTrajectoryTopic.topic_id == topic_id,
            LearningTrajectory.status == LearningTrajectoryStatus.ACTIVE,
        )
        .limit(1)
    )
    trajectory_name = result.scalar_one_or_none()
    if trajectory_name is None:
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Topic is used by active learning trajectory '{trajectory_name}'. "
            "Archive the trajectory before changing this part of the graph."
        ),
    )


async def ensure_topic_element_link_can_be_removed(
    session: AsyncSession,
    topic_id: UUID,
) -> None:
    await ensure_topic_can_be_removed(session, topic_id)


async def ensure_element_can_be_removed(session: AsyncSession, element_id: UUID) -> None:
    selected_result = await session.execute(
        select(LearningTrajectory.name)
        .join(LearningTrajectoryTopic, LearningTrajectoryTopic.trajectory_id == LearningTrajectory.id)
        .join(
            LearningTrajectoryElement,
            LearningTrajectoryElement.trajectory_topic_id == LearningTrajectoryTopic.id,
        )
        .where(
            LearningTrajectoryElement.element_id == element_id,
            LearningTrajectory.status == LearningTrajectoryStatus.ACTIVE,
        )
        .limit(1)
    )
    trajectory_name = selected_result.scalar_one_or_none()
    if trajectory_name is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Knowledge element is selected by active learning trajectory '{trajectory_name}'. "
                "Archive the trajectory before changing this element."
            ),
        )

    linked_topic_result = await session.execute(
        select(LearningTrajectory.name)
        .join(LearningTrajectoryTopic, LearningTrajectoryTopic.trajectory_id == LearningTrajectory.id)
        .join(TopicKnowledgeElement, TopicKnowledgeElement.topic_id == LearningTrajectoryTopic.topic_id)
        .where(
            TopicKnowledgeElement.element_id == element_id,
            LearningTrajectory.status == LearningTrajectoryStatus.ACTIVE,
        )
        .limit(1)
    )
    trajectory_name = linked_topic_result.scalar_one_or_none()
    if trajectory_name is None:
        return

    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            f"Knowledge element belongs to a topic used by active learning trajectory "
            f"'{trajectory_name}'. Archive the trajectory before changing this element."
        ),
    )
