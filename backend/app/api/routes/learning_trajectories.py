from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, select
from sqlalchemy.orm import selectinload

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import (
    Discipline,
    Group,
    GroupDiscipline,
    KnowledgeElement,
    LearningTrajectory,
    LearningTrajectoryElement,
    LearningTrajectoryTopic,
    Subgroup,
    Teacher,
    TeacherDiscipline,
    TeacherGroup,
    TeacherSubgroup,
    Topic,
    TopicKnowledgeElement,
)
from app.models.enums import (
    CompetenceType,
    TopicKnowledgeElementRole,
)
from app.schemas import LearningTrajectoryCreate, LearningTrajectoryRead


router = APIRouter(prefix="/learning-trajectories", tags=["Learning Trajectories"])


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _trajectory_read_options():
    return (
        selectinload(LearningTrajectory.topics).selectinload(
            LearningTrajectoryTopic.elements
        ),
    )


async def get_learning_trajectory_for_read(
    trajectory_id: UUID,
    session: DbSession,
) -> LearningTrajectory:
    result = await session.execute(
        select(LearningTrajectory)
        .options(*_trajectory_read_options())
        .where(LearningTrajectory.id == trajectory_id)
    )
    trajectory = result.scalar_one_or_none()
    if trajectory is None:
        raise not_found("Learning trajectory", trajectory_id)
    return trajectory


async def _exists(session: DbSession, query) -> bool:
    result = await session.execute(query)
    return result.scalar_one_or_none() is not None


async def _validate_assignment_target(
    payload: LearningTrajectoryCreate,
    session: DbSession,
) -> None:
    discipline = await session.get(Discipline, payload.discipline_id)
    if discipline is None:
        raise not_found("Discipline", payload.discipline_id)

    teacher = await session.get(Teacher, payload.teacher_id)
    if teacher is None:
        raise not_found("Teacher", payload.teacher_id)

    if payload.group_id is None and payload.subgroup_id is None:
        raise _bad_request("Learning trajectory must be assigned to a group or subgroup.")

    teacher_has_discipline = await _exists(
        session,
        select(TeacherDiscipline.id).where(
            and_(
                TeacherDiscipline.teacher_id == payload.teacher_id,
                TeacherDiscipline.discipline_id == payload.discipline_id,
            )
        ),
    )
    if not teacher_has_discipline:
        raise _bad_request("Teacher does not teach this discipline.")

    target_group_id = payload.group_id
    if payload.subgroup_id is not None:
        subgroup = await session.get(Subgroup, payload.subgroup_id)
        if subgroup is None:
            raise not_found("Subgroup", payload.subgroup_id)
        if payload.group_id is not None and subgroup.group_id != payload.group_id:
            raise _bad_request("Subgroup does not belong to the selected group.")
        target_group_id = subgroup.group_id

    if target_group_id is None:
        raise _bad_request("Learning trajectory target group could not be resolved.")

    group = await session.get(Group, target_group_id)
    if group is None:
        raise not_found("Group", target_group_id)

    teacher_has_group = await _exists(
        session,
        select(TeacherGroup.id).where(
            and_(
                TeacherGroup.teacher_id == payload.teacher_id,
                TeacherGroup.group_id == target_group_id,
            )
        ),
    )
    if not teacher_has_group:
        teacher_has_subgroup = False
        if payload.subgroup_id is not None:
            teacher_has_subgroup = await _exists(
                session,
                select(TeacherSubgroup.id).where(
                    and_(
                        TeacherSubgroup.teacher_id == payload.teacher_id,
                        TeacherSubgroup.subgroup_id == payload.subgroup_id,
                    )
                ),
            )

        if not teacher_has_subgroup:
            raise _bad_request("Teacher is not assigned to the selected group or subgroup.")

    group_has_discipline = await _exists(
        session,
        select(GroupDiscipline.id).where(
            and_(
                GroupDiscipline.group_id == target_group_id,
                GroupDiscipline.discipline_id == payload.discipline_id,
            )
        ),
    )
    if not group_has_discipline:
        raise _bad_request("Selected group does not study this discipline.")


async def _validate_topics_and_elements(
    payload: LearningTrajectoryCreate,
    session: DbSession,
) -> None:
    topic_ids = [item.topic_id for item in payload.topics]
    if len(topic_ids) != len(set(topic_ids)):
        raise _bad_request("Each topic can be added to a trajectory only once.")

    positions = [item.position for item in payload.topics]
    if len(positions) != len(set(positions)):
        raise _bad_request("Topic positions in a trajectory must be unique.")

    if not any(item.threshold == 0 for item in payload.topics):
        raise _bad_request("At least one topic must have threshold 0.")

    topics_result = await session.execute(
        select(Topic).where(
            and_(
                Topic.id.in_(topic_ids),
                Topic.discipline_id == payload.discipline_id,
            )
        )
    )
    topics = list(topics_result.scalars().all())
    topics_by_id = {topic.id: topic for topic in topics}
    if len(topics_by_id) != len(topic_ids):
        raise _bad_request("Trajectory contains a topic from another discipline.")

    links_result = await session.execute(
        select(TopicKnowledgeElement)
        .options(selectinload(TopicKnowledgeElement.element))
        .where(TopicKnowledgeElement.topic_id.in_(topic_ids))
    )
    formed_by_topic: dict[UUID, dict[UUID, KnowledgeElement]] = defaultdict(dict)
    required_by_topic: dict[UUID, dict[UUID, KnowledgeElement]] = defaultdict(dict)
    for link in links_result.scalars().all():
        if link.role == TopicKnowledgeElementRole.FORMED:
            formed_by_topic[link.topic_id][link.element_id] = link.element
        elif link.role == TopicKnowledgeElementRole.REQUIRED:
            required_by_topic[link.topic_id][link.element_id] = link.element

    formed_before_topic: set[UUID] = set()
    for topic_payload in sorted(payload.topics, key=lambda item: item.position):
        missing_elements = [
            element
            for element_id, element in required_by_topic.get(topic_payload.topic_id, {}).items()
            if element_id not in formed_before_topic
        ]
        if missing_elements:
            topic = topics_by_id[topic_payload.topic_id]
            missing_names = ", ".join(element.name for element in missing_elements)
            raise _bad_request(
                f"Topic '{topic.name}' cannot be placed here because required "
                f"elements are not formed yet: {missing_names}."
            )

        formed_before_topic.update(formed_by_topic.get(topic_payload.topic_id, {}).keys())

    available_competence_types: set[CompetenceType] = set()
    for topic_payload in payload.topics:
        for element in formed_by_topic.get(topic_payload.topic_id, {}).values():
            available_competence_types.add(element.competence_type)

    selected_competence_thresholds: dict[CompetenceType, list[int]] = defaultdict(list)
    selected_elements_count = 0

    for topic_payload in payload.topics:
        element_ids = [item.element_id for item in topic_payload.elements]
        if len(element_ids) != len(set(element_ids)):
            raise _bad_request("Each element can be added to a trajectory topic only once.")

        allowed_elements = formed_by_topic.get(topic_payload.topic_id, {})
        for element_payload in topic_payload.elements:
            element = allowed_elements.get(element_payload.element_id)
            if element is None:
                topic = topics_by_id[topic_payload.topic_id]
                raise _bad_request(
                    f"Topic '{topic.name}' can include only formed knowledge elements."
                )
            selected_competence_thresholds[element.competence_type].append(
                element_payload.threshold
            )
            selected_elements_count += 1

    if selected_elements_count == 0:
        raise _bad_request("Select at least one formed knowledge element.")

    for competence_type in available_competence_types:
        thresholds = selected_competence_thresholds.get(competence_type, [])
        if not thresholds or 0 not in thresholds:
            raise _bad_request(
                f"For competence type '{competence_type.value}', select at least one "
                "required element with threshold 0."
            )


async def validate_learning_trajectory(
    payload: LearningTrajectoryCreate,
    session: DbSession,
) -> None:
    await _validate_assignment_target(payload, session)
    await _validate_topics_and_elements(payload, session)


@router.get("/", response_model=list[LearningTrajectoryRead])
async def list_learning_trajectories(
    session: DbSession,
    discipline_id: UUID | None = None,
    teacher_id: UUID | None = None,
    group_id: UUID | None = None,
) -> list[LearningTrajectory]:
    query = select(LearningTrajectory).options(*_trajectory_read_options())
    if discipline_id is not None:
        query = query.where(LearningTrajectory.discipline_id == discipline_id)
    if teacher_id is not None:
        query = query.where(LearningTrajectory.teacher_id == teacher_id)
    if group_id is not None:
        query = query.where(LearningTrajectory.group_id == group_id)

    result = await session.execute(query.order_by(LearningTrajectory.name))
    return list(result.scalars().all())


@router.post(
    "/",
    response_model=LearningTrajectoryRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_learning_trajectory(
    payload: LearningTrajectoryCreate,
    session: DbSession,
) -> LearningTrajectory:
    await validate_learning_trajectory(payload, session)

    trajectory = LearningTrajectory(
        name=payload.name,
        discipline_id=payload.discipline_id,
        teacher_id=payload.teacher_id,
        group_id=payload.group_id,
        subgroup_id=payload.subgroup_id,
    )
    session.add(trajectory)

    for topic_payload in sorted(payload.topics, key=lambda item: item.position):
        trajectory_topic = LearningTrajectoryTopic(
            trajectory=trajectory,
            topic_id=topic_payload.topic_id,
            position=topic_payload.position,
            threshold=topic_payload.threshold,
        )
        session.add(trajectory_topic)

        for element_payload in topic_payload.elements:
            session.add(
                LearningTrajectoryElement(
                    trajectory_topic=trajectory_topic,
                    element_id=element_payload.element_id,
                    threshold=element_payload.threshold,
                )
            )

    await flush_or_409(session)
    await commit_or_409(session)
    return await get_learning_trajectory_for_read(trajectory.id, session)


@router.get("/{trajectory_id}", response_model=LearningTrajectoryRead)
async def get_learning_trajectory(
    trajectory_id: UUID,
    session: DbSession,
) -> LearningTrajectory:
    return await get_learning_trajectory_for_read(trajectory_id, session)
