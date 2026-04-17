from collections import defaultdict
from typing import Iterable, Sequence
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Topic, TopicDependency, TopicKnowledgeElement
from app.models.enums import TopicDependencyRelationType, TopicKnowledgeElementRole


def calculate_topic_dependency_pairs(
    topics: Sequence[Topic],
    topic_knowledge_elements: Iterable[TopicKnowledgeElement],
) -> set[tuple[UUID, UUID]]:
    required_by_topic: dict[UUID, set[UUID]] = defaultdict(set)
    formed_by_topic: dict[UUID, set[UUID]] = defaultdict(set)

    for link in topic_knowledge_elements:
        if link.role == TopicKnowledgeElementRole.REQUIRED:
            required_by_topic[link.topic_id].add(link.element_id)
        elif link.role == TopicKnowledgeElementRole.FORMED:
            formed_by_topic[link.topic_id].add(link.element_id)

    dependency_pairs: set[tuple[UUID, UUID]] = set()

    for source_topic in topics:
        source_elements = formed_by_topic.get(source_topic.id, set())
        if not source_elements:
            continue

        for target_topic in topics:
            if source_topic.id == target_topic.id:
                continue

            if source_elements & required_by_topic.get(target_topic.id, set()):
                dependency_pairs.add((source_topic.id, target_topic.id))

    return dependency_pairs


async def sync_topic_dependencies_for_discipline(
    session: AsyncSession,
    discipline_id: UUID,
) -> list[TopicDependency]:
    topics_result = await session.execute(
        select(Topic)
        .where(Topic.discipline_id == discipline_id)
        .order_by(Topic.name, Topic.id)
    )
    topics = list(topics_result.scalars().all())
    topic_ids = [topic.id for topic in topics]

    existing_dependencies: list[TopicDependency] = []
    topic_knowledge_elements: list[TopicKnowledgeElement] = []

    if not topic_ids:
        return []

    dependencies_result = await session.execute(
        select(TopicDependency).where(
            and_(
                TopicDependency.prerequisite_topic_id.in_(topic_ids),
                TopicDependency.dependent_topic_id.in_(topic_ids),
            )
        )
    )
    existing_dependencies = list(dependencies_result.scalars().all())

    topic_elements_result = await session.execute(
        select(TopicKnowledgeElement).where(TopicKnowledgeElement.topic_id.in_(topic_ids))
    )
    topic_knowledge_elements = list(topic_elements_result.scalars().all())

    desired_pairs = calculate_topic_dependency_pairs(topics, topic_knowledge_elements)
    existing_by_pair = {
        (dependency.prerequisite_topic_id, dependency.dependent_topic_id): dependency
        for dependency in existing_dependencies
    }

    for pair, dependency in list(existing_by_pair.items()):
        if pair not in desired_pairs:
            await session.delete(dependency)
            existing_by_pair.pop(pair, None)
            continue

        dependency.relation_type = TopicDependencyRelationType.REQUIRES
        dependency.description = None

    for prerequisite_topic_id, dependent_topic_id in sorted(desired_pairs, key=lambda item: str(item)):
        if (prerequisite_topic_id, dependent_topic_id) in existing_by_pair:
            continue

        dependency = TopicDependency(
            prerequisite_topic_id=prerequisite_topic_id,
            dependent_topic_id=dependent_topic_id,
            relation_type=TopicDependencyRelationType.REQUIRES,
            description=None,
        )
        session.add(dependency)
        existing_by_pair[(prerequisite_topic_id, dependent_topic_id)] = dependency

    await session.flush()

    dependencies_result = await session.execute(
        select(TopicDependency)
        .where(
            and_(
                TopicDependency.prerequisite_topic_id.in_(topic_ids),
                TopicDependency.dependent_topic_id.in_(topic_ids),
            )
        )
        .order_by(TopicDependency.prerequisite_topic_id, TopicDependency.dependent_topic_id)
    )
    return list(dependencies_result.scalars().all())


async def sync_topic_dependencies_for_disciplines(
    session: AsyncSession,
    discipline_ids: Iterable[UUID],
) -> None:
    unique_ids = list(dict.fromkeys(discipline_ids))
    for discipline_id in unique_ids:
        await sync_topic_dependencies_for_discipline(session, discipline_id)
