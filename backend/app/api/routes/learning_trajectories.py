from collections import defaultdict
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import lazyload, selectinload

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
    LearningTrajectoryStatus,
    StudentTaskProgressStatus,
    TopicKnowledgeElementRole,
)
from app.schemas import (
    LearningTrajectoryCreate,
    LearningTrajectoryElementCreate,
    LearningTrajectoryRead,
    LearningTrajectorySummaryRead,
    LearningTrajectoryStatusUpdate,
    StudentLearningTrajectorySummaryRead,
    LearningTrajectoryTopicCreate,
    LearningTrajectoryTopicOrderUpdate,
)


router = APIRouter(prefix="/learning-trajectories", tags=["Learning Trajectories"])


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _trajectory_read_options():
    return (
        lazyload("*"),
        selectinload(LearningTrajectory.discipline).options(lazyload("*")),
        selectinload(LearningTrajectory.topics).options(
            lazyload("*"),
            selectinload(LearningTrajectoryTopic.elements).options(lazyload("*")),
        ),
    )


def _trajectory_summary_options():
    return (
        lazyload("*"),
        selectinload(LearningTrajectory.discipline).options(lazyload("*")),
    )


def _build_trajectory_summary(
    trajectory: LearningTrajectory,
    topic_count: int = 0,
) -> LearningTrajectorySummaryRead:
    return LearningTrajectorySummaryRead(
        id=trajectory.id,
        name=trajectory.name,
        status=trajectory.status,
        graph_version=trajectory.graph_version,
        is_actual=trajectory.is_actual,
        discipline_id=trajectory.discipline_id,
        teacher_id=trajectory.teacher_id,
        group_id=trajectory.group_id,
        subgroup_id=trajectory.subgroup_id,
        topic_count=topic_count,
    )


def _build_student_trajectory_summary(
    trajectory: LearningTrajectory,
    topic_count: int = 0,
    total_task_count: int = 0,
    completed_task_count: int = 0,
) -> StudentLearningTrajectorySummaryRead:
    progress_percent = (
        round((completed_task_count / total_task_count) * 100)
        if total_task_count
        else 0
    )
    return StudentLearningTrajectorySummaryRead(
        id=trajectory.id,
        name=trajectory.name,
        status=trajectory.status,
        graph_version=trajectory.graph_version,
        is_actual=trajectory.is_actual,
        discipline_id=trajectory.discipline_id,
        teacher_id=trajectory.teacher_id,
        group_id=trajectory.group_id,
        subgroup_id=trajectory.subgroup_id,
        topic_count=topic_count,
        total_task_count=total_task_count,
        completed_task_count=completed_task_count,
        progress_percent=progress_percent,
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


def ensure_trajectory_editable(trajectory: LearningTrajectory) -> None:
    if trajectory.status != LearningTrajectoryStatus.DRAFT:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Only draft learning trajectories can be edited.",
        )
    if not trajectory.is_actual:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                "Траектория создана для старой версии графа знаний. "
                "Пересобери или отправь её в архив перед редактированием."
            ),
        )


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

    missing_competence_types = _missing_required_competence_types(
        available_competence_types,
        selected_competence_thresholds,
    )
    for competence_type in missing_competence_types:
        raise _bad_request(
            f"For competence type '{competence_type.value}', select at least one "
            "required element with threshold 0."
        )


def _missing_required_competence_types(
    available_competence_types: set[CompetenceType],
    selected_competence_thresholds: dict[CompetenceType, list[int]],
) -> set[CompetenceType]:
    return {
        competence_type
        for competence_type in available_competence_types
        if 0 not in selected_competence_thresholds.get(competence_type, [])
    }


async def validate_learning_trajectory(
    payload: LearningTrajectoryCreate,
    session: DbSession,
) -> None:
    await _validate_assignment_target(payload, session)
    await _validate_topics_and_elements(payload, session)


@router.get("/", response_model=list[LearningTrajectorySummaryRead])
async def list_learning_trajectories(
    session: DbSession,
    discipline_id: UUID | None = None,
    teacher_id: UUID | None = None,
    group_id: UUID | None = None,
    subgroup_id: UUID | None = None,
    status_filter: LearningTrajectoryStatus | None = None,
) -> list[LearningTrajectorySummaryRead]:
    query = select(LearningTrajectory).options(*_trajectory_summary_options())
    if discipline_id is not None:
        query = query.where(LearningTrajectory.discipline_id == discipline_id)
    if teacher_id is not None:
        query = query.where(LearningTrajectory.teacher_id == teacher_id)
    if group_id is not None:
        query = query.where(LearningTrajectory.group_id == group_id)
    if subgroup_id is not None:
        query = query.where(LearningTrajectory.subgroup_id == subgroup_id)
    if status_filter is not None:
        query = query.where(LearningTrajectory.status == status_filter)

    result = await session.execute(query.order_by(LearningTrajectory.name))
    trajectories = list(result.scalars().all())
    if not trajectories:
        return []

    trajectory_ids = [trajectory.id for trajectory in trajectories]
    topic_counts_result = await session.execute(
        select(
            LearningTrajectoryTopic.trajectory_id,
            func.count(LearningTrajectoryTopic.id),
        )
        .where(LearningTrajectoryTopic.trajectory_id.in_(trajectory_ids))
        .group_by(LearningTrajectoryTopic.trajectory_id)
    )
    topic_counts = {
        trajectory_id: topic_count
        for trajectory_id, topic_count in topic_counts_result.all()
    }
    return [
        _build_trajectory_summary(
            trajectory,
            topic_count=topic_counts.get(trajectory.id, 0),
        )
        for trajectory in trajectories
    ]


@router.get(
    "/students/{student_id}",
    response_model=list[StudentLearningTrajectorySummaryRead],
)
async def list_student_learning_trajectories(
    student_id: UUID,
    session: DbSession,
) -> list[StudentLearningTrajectorySummaryRead]:
    from app.models import LearningTrajectoryTask, Student, StudentTaskProgress

    student_result = await session.execute(
        select(Student.group_id, Student.subgroup_id).where(Student.id == student_id)
    )
    student_row = student_result.one_or_none()
    if student_row is None:
        raise not_found("Student", student_id)

    target_filter = LearningTrajectory.group_id == student_row.group_id
    if student_row.subgroup_id is None:
        target_filter = and_(target_filter, LearningTrajectory.subgroup_id.is_(None))
    else:
        target_filter = and_(
            target_filter,
            or_(
                LearningTrajectory.subgroup_id.is_(None),
                LearningTrajectory.subgroup_id == student_row.subgroup_id,
            ),
        )

    result = await session.execute(
        select(LearningTrajectory)
        .options(*_trajectory_summary_options())
        .where(
            target_filter,
            LearningTrajectory.status == LearningTrajectoryStatus.ACTIVE,
        )
        .order_by(LearningTrajectory.name)
    )
    trajectories = list(result.scalars().all())
    if not trajectories:
        return []

    trajectory_ids = [trajectory.id for trajectory in trajectories]
    topic_counts_result = await session.execute(
        select(
            LearningTrajectoryTopic.trajectory_id,
            func.count(LearningTrajectoryTopic.id),
        )
        .where(LearningTrajectoryTopic.trajectory_id.in_(trajectory_ids))
        .group_by(LearningTrajectoryTopic.trajectory_id)
    )
    topic_counts = {
        trajectory_id: topic_count
        for trajectory_id, topic_count in topic_counts_result.all()
    }
    total_task_counts_result = await session.execute(
        select(
            LearningTrajectoryTask.trajectory_id,
            func.count(LearningTrajectoryTask.id),
        )
        .where(LearningTrajectoryTask.trajectory_id.in_(trajectory_ids))
        .group_by(LearningTrajectoryTask.trajectory_id)
    )
    total_task_counts = {
        trajectory_id: total_task_count
        for trajectory_id, total_task_count in total_task_counts_result.all()
    }
    completed_task_counts_result = await session.execute(
        select(
            LearningTrajectoryTask.trajectory_id,
            func.count(StudentTaskProgress.id),
        )
        .join(
            StudentTaskProgress,
            and_(
                StudentTaskProgress.task_id == LearningTrajectoryTask.id,
                StudentTaskProgress.student_id == student_id,
                StudentTaskProgress.status == StudentTaskProgressStatus.COMPLETED,
            ),
        )
        .where(LearningTrajectoryTask.trajectory_id.in_(trajectory_ids))
        .group_by(LearningTrajectoryTask.trajectory_id)
    )
    completed_task_counts = {
        trajectory_id: completed_task_count
        for trajectory_id, completed_task_count in completed_task_counts_result.all()
    }
    return [
        _build_student_trajectory_summary(
            trajectory,
            topic_count=topic_counts.get(trajectory.id, 0),
            total_task_count=total_task_counts.get(trajectory.id, 0),
            completed_task_count=completed_task_counts.get(trajectory.id, 0),
        )
        for trajectory in trajectories
    ]


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
    discipline = await session.get(Discipline, payload.discipline_id)
    if discipline is None:
        raise not_found("Discipline", payload.discipline_id)

    trajectory = LearningTrajectory(
        name=payload.name,
        discipline_id=payload.discipline_id,
        teacher_id=payload.teacher_id,
        group_id=payload.group_id,
        subgroup_id=payload.subgroup_id,
        status=LearningTrajectoryStatus.DRAFT,
        graph_version=discipline.knowledge_graph_version,
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


@router.put("/{trajectory_id}/topics/order", response_model=LearningTrajectoryRead)
async def update_learning_trajectory_topic_order(
    trajectory_id: UUID,
    payload: LearningTrajectoryTopicOrderUpdate,
    session: DbSession,
) -> LearningTrajectory:
    trajectory = await get_learning_trajectory_for_read(trajectory_id, session)
    ensure_trajectory_editable(trajectory)
    topics_by_id = {trajectory_topic.topic_id: trajectory_topic for trajectory_topic in trajectory.topics}

    if len(payload.topic_ids) != len(set(payload.topic_ids)):
        raise _bad_request("Each topic can appear in the trajectory order only once.")
    if set(payload.topic_ids) != set(topics_by_id):
        raise _bad_request("Topic order must contain exactly the trajectory topics.")

    validation_payload = LearningTrajectoryCreate(
        name=trajectory.name,
        discipline_id=trajectory.discipline_id,
        teacher_id=trajectory.teacher_id,
        group_id=trajectory.group_id,
        subgroup_id=trajectory.subgroup_id,
        topics=[
            LearningTrajectoryTopicCreate(
                topic_id=topic_id,
                position=index + 1,
                threshold=topics_by_id[topic_id].threshold,
                elements=[
                    LearningTrajectoryElementCreate(
                        element_id=element.element_id,
                        threshold=element.threshold,
                    )
                    for element in topics_by_id[topic_id].elements
                ],
            )
            for index, topic_id in enumerate(payload.topic_ids)
        ],
    )
    await _validate_topics_and_elements(validation_payload, session)

    offset = len(trajectory.topics) + 1
    for index, trajectory_topic in enumerate(trajectory.topics):
        trajectory_topic.position = offset + index
    await flush_or_409(session)

    for index, topic_id in enumerate(payload.topic_ids):
        topics_by_id[topic_id].position = index + 1

    await flush_or_409(session)
    await commit_or_409(session)
    return await get_learning_trajectory_for_read(trajectory_id, session)


@router.put("/{trajectory_id}/status", response_model=LearningTrajectoryRead)
async def update_learning_trajectory_status(
    trajectory_id: UUID,
    payload: LearningTrajectoryStatusUpdate,
    session: DbSession,
) -> LearningTrajectory:
    trajectory = await get_learning_trajectory_for_read(trajectory_id, session)

    if payload.status == LearningTrajectoryStatus.ACTIVE:
        if not trajectory.is_actual:
            raise _bad_request(
                "Траекторию нельзя активировать: версия графа знаний устарела."
            )
        validation_payload = LearningTrajectoryCreate(
            name=trajectory.name,
            discipline_id=trajectory.discipline_id,
            teacher_id=trajectory.teacher_id,
            group_id=trajectory.group_id,
            subgroup_id=trajectory.subgroup_id,
            topics=[
                LearningTrajectoryTopicCreate(
                    topic_id=trajectory_topic.topic_id,
                    position=trajectory_topic.position,
                    threshold=trajectory_topic.threshold,
                    elements=[
                        LearningTrajectoryElementCreate(
                            element_id=element.element_id,
                            threshold=element.threshold,
                        )
                        for element in trajectory_topic.elements
                    ],
                )
                for trajectory_topic in trajectory.topics
            ],
        )
        await validate_learning_trajectory(validation_payload, session)

    trajectory.status = payload.status
    await commit_or_409(session)
    return await get_learning_trajectory_for_read(trajectory_id, session)
