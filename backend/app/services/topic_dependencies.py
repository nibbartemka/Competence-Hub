from collections import defaultdict
from typing import Iterable, Sequence
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Topic, TopicDependency, TopicKnowledgeElement
from app.models.enums import (
    TopicDependencyRelationType,
    TopicDependencySource,
    TopicKnowledgeElementRole,
)


def find_topic_dependency_cycle(
    dependency_pairs: Iterable[tuple[UUID, UUID]],
) -> list[UUID]:
    """Return a cycle if one exists.

    Pair direction is canonical: (prerequisite_topic_id, dependent_topic_id),
    meaning the dependent topic requires the prerequisite topic.
    """
    children: dict[UUID, set[UUID]] = defaultdict(set)
    nodes: set[UUID] = set()
    for prerequisite_topic_id, dependent_topic_id in dependency_pairs:
        children[prerequisite_topic_id].add(dependent_topic_id)
        nodes.add(prerequisite_topic_id)
        nodes.add(dependent_topic_id)

    visiting: set[UUID] = set()
    visited: set[UUID] = set()
    stack: list[UUID] = []

    def visit(node_id: UUID) -> list[UUID]:
        if node_id in visiting:
            cycle_start = stack.index(node_id)
            return stack[cycle_start:] + [node_id]
        if node_id in visited:
            return []

        visiting.add(node_id)
        stack.append(node_id)
        for child_id in children.get(node_id, set()):
            cycle = visit(child_id)
            if cycle:
                return cycle
        stack.pop()
        visiting.remove(node_id)
        visited.add(node_id)
        return []

    for node_id in nodes:
        cycle = visit(node_id)
        if cycle:
            return cycle

    return []


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
        if dependency.source == TopicDependencySource.MANUAL:
            continue
        if pair not in desired_pairs:
            await session.delete(dependency)
            existing_by_pair.pop(pair, None)
            continue

        dependency.relation_type = TopicDependencyRelationType.REQUIRES
        dependency.source = TopicDependencySource.COMPUTED
        dependency.description = None

    for prerequisite_topic_id, dependent_topic_id in sorted(desired_pairs, key=lambda item: str(item)):
        if (prerequisite_topic_id, dependent_topic_id) in existing_by_pair:
            continue

        dependency = TopicDependency(
            prerequisite_topic_id=prerequisite_topic_id,
            dependent_topic_id=dependent_topic_id,
            relation_type=TopicDependencyRelationType.REQUIRES,
            source=TopicDependencySource.COMPUTED,
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


async def get_topic_dependency_cycle_for_discipline(
    session: AsyncSession,
    discipline_id: UUID,
) -> list[UUID]:
    topics_result = await session.execute(
        select(Topic.id).where(Topic.discipline_id == discipline_id)
    )
    topic_ids = set(topics_result.scalars().all())
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
    dependency_pairs = {
        (dependency.prerequisite_topic_id, dependency.dependent_topic_id)
        for dependency in dependencies_result.scalars().all()
    }
    return find_topic_dependency_cycle(dependency_pairs)


async def sync_topic_dependencies_for_disciplines(
    session: AsyncSession,
    discipline_ids: Iterable[UUID],
) -> None:
    unique_ids = list(dict.fromkeys(discipline_ids))
    for discipline_id in unique_ids:
        await sync_topic_dependencies_for_discipline(session, discipline_id)
