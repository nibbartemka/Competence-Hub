from collections.abc import Iterable
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import lazyload
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    Discipline,
    KnowledgeElement,
    KnowledgeElementRelation,
    LearningTrajectory,
    LearningTrajectoryElement,
    LearningTrajectoryTopic,
    MasterElementDomainObject,
    Relation,
    Topic,
    TopicDependency,
    TopicKnowledgeElement,
)
from app.models.enums import (
    CompetenceType,
    KnowledgeElementRelationType,
    LearningTrajectoryStatus,
    TopicDependencyRelationType,
)
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


async def ensure_master_relies_on_relations(
    session: AsyncSession,
    discipline_id: UUID,
) -> int:
    relation_result = await session.execute(
        select(Relation)
        .options(lazyload("*"))
        .where(Relation.relation_type == KnowledgeElementRelationType.RELIES_ON)
    )
    relies_on_relation = relation_result.scalar_one_or_none()
    if relies_on_relation is None:
        return 0

    domain_object_result = await session.execute(
        select(
            MasterElementDomainObject.master_element_id,
            MasterElementDomainObject.knowledge_element_id,
        )
        .join(
            KnowledgeElement,
            KnowledgeElement.id == MasterElementDomainObject.master_element_id,
        )
        .where(KnowledgeElement.discipline_id == discipline_id)
    )
    domain_object_pairs = list(domain_object_result.all())
    if not domain_object_pairs:
        return 0

    involved_element_ids = {
        element_id
        for pair in domain_object_pairs
        for element_id in pair
    }
    topic_link_result = await session.execute(
        select(TopicKnowledgeElement.topic_id, TopicKnowledgeElement.element_id)
        .join(Topic, Topic.id == TopicKnowledgeElement.topic_id)
        .where(
            Topic.discipline_id == discipline_id,
            TopicKnowledgeElement.element_id.in_(involved_element_ids),
        )
    )
    topic_ids_by_element_id: dict[UUID, set[UUID]] = {}
    for topic_id, element_id in topic_link_result.all():
        topic_ids_by_element_id.setdefault(element_id, set()).add(topic_id)

    existing_relation_result = await session.execute(
        select(
            KnowledgeElementRelation.topic_id,
            KnowledgeElementRelation.source_element_id,
            KnowledgeElementRelation.target_element_id,
        )
        .join(Relation, Relation.id == KnowledgeElementRelation.relation_id)
        .where(
            Relation.relation_type == KnowledgeElementRelationType.RELIES_ON,
            KnowledgeElementRelation.source_element_id.in_(
                [master_element_id for master_element_id, _ in domain_object_pairs]
            ),
            KnowledgeElementRelation.target_element_id.in_(
                [knowledge_element_id for _, knowledge_element_id in domain_object_pairs]
            ),
        )
    )
    existing_relations = {
        (topic_id, source_element_id, target_element_id)
        for topic_id, source_element_id, target_element_id in existing_relation_result.all()
    }

    created_count = 0
    for master_element_id, knowledge_element_id in domain_object_pairs:
        master_topic_ids = topic_ids_by_element_id.get(master_element_id, set())
        knowledge_topic_ids = topic_ids_by_element_id.get(knowledge_element_id, set())
        shared_topic_ids = master_topic_ids & knowledge_topic_ids
        if not shared_topic_ids:
            continue

        for topic_id in shared_topic_ids:
            relation_key = (topic_id, master_element_id, knowledge_element_id)
            if relation_key in existing_relations:
                continue
            session.add(
                KnowledgeElementRelation(
                    topic_id=topic_id,
                    source_element_id=master_element_id,
                    target_element_id=knowledge_element_id,
                    relation_id=relies_on_relation.id,
                    description=None,
                )
            )
            existing_relations.add(relation_key)
            created_count += 1

    if created_count:
        await session.flush()

    return created_count


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
    dependency_result = await session.execute(
        select(Topic.name)
        .join(TopicDependency, TopicDependency.dependent_topic_id == Topic.id)
        .where(
            TopicDependency.prerequisite_topic_id == topic_id,
            TopicDependency.relation_type == TopicDependencyRelationType.REQUIRES,
        )
        .order_by(Topic.name)
    )
    dependent_topic_names = list(dependency_result.scalars().all())
    if dependent_topic_names:
        dependent_topics = ", ".join(dependent_topic_names)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Topic cannot be removed because it is required by other topics: "
                f"{dependent_topics}."
            ),
        )

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
    if trajectory_name is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"Knowledge element belongs to a topic used by active learning trajectory "
                f"'{trajectory_name}'. Archive the trajectory before changing this element."
            ),
        )

    relation_result = await session.execute(
        select(KnowledgeElementRelation).where(
            (KnowledgeElementRelation.source_element_id == element_id)
            | (KnowledgeElementRelation.target_element_id == element_id)
        )
    )
    relations = list(relation_result.scalars().all())
    if not relations:
        return

    element_result = await session.execute(
        select(KnowledgeElement).where(KnowledgeElement.id == element_id)
    )
    element = element_result.scalar_one_or_none()
    if element is None:
        return

    related_element_ids = {
        relation.source_element_id
        for relation in relations
        if relation.source_element_id != element_id
    } | {
        relation.target_element_id
        for relation in relations
        if relation.target_element_id != element_id
    }
    if not related_element_ids:
        return

    related_elements_result = await session.execute(
        select(KnowledgeElement).where(KnowledgeElement.id.in_(related_element_ids))
    )
    related_elements_by_id = {
        related_element.id: related_element
        for related_element in related_elements_result.scalars().all()
    }

    blocking_source_names: list[str] = []
    for relation in relations:
        if relation.target_element_id != element_id:
            continue

        source_element = related_elements_by_id.get(relation.source_element_id)
        if source_element is None:
            continue

        if (
            element.competence_type == CompetenceType.KNOW
            and source_element.competence_type in {CompetenceType.CAN, CompetenceType.MASTER}
        ) or (
            element.competence_type == CompetenceType.CAN
            and source_element.competence_type == CompetenceType.MASTER
        ):
            blocking_source_names.append(source_element.name)

    if not blocking_source_names:
        return

    blocking_names = ", ".join(dict.fromkeys(blocking_source_names))
    raise HTTPException(
        status_code=status.HTTP_409_CONFLICT,
        detail=(
            "Knowledge element cannot be removed because higher-level elements depend on it: "
            f"{blocking_names}."
        ),
    )
