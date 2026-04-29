from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import lazyload, selectinload

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import (
    KnowledgeElement,
    KnowledgeElementRelation,
    LearningTrajectory,
    LearningTrajectoryElement,
    LearningTrajectoryTask,
    LearningTrajectoryTaskElement,
    LearningTrajectoryTaskRelation,
    LearningTrajectoryTopic,
    Student,
    StudentElementMastery,
    StudentTaskProgress,
)
from app.models.enums import (
    LearningTrajectoryStatus,
    LearningTrajectoryTaskType,
)
from app.schemas import (
    StudentTopicControlElementRead,
    StudentTopicControlRead,
    StudentTrajectoryMasteryElementRead,
    StudentTrajectoryMasteryRead,
    StudentTrajectoryMasteryTopicRead,
)
from app.services.learning_tasks import (
    build_adaptive_candidate_pool,
    build_student_task_read,
    build_relation_maps,
    parse_task_content_json,
    select_next_task,
)

from .learning_trajectory_tasks import (
    _get_or_create_task_instance,
    _trajectory_topic_is_unlocked,
    _trajectory_topic_mastery,
)


router = APIRouter(prefix="/students", tags=["Student Learning Control"])


def _student_can_access_trajectory(student: Student, trajectory: LearningTrajectory) -> bool:
    if trajectory.status != LearningTrajectoryStatus.ACTIVE:
        return False
    if trajectory.group_id != student.group_id:
        return False
    if trajectory.subgroup_id is None:
        return True
    return trajectory.subgroup_id == student.subgroup_id


def _control_task_options():
    return (
        lazyload("*"),
        selectinload(LearningTrajectoryTask.trajectory),
        selectinload(LearningTrajectoryTask.trajectory_topic).selectinload(
            LearningTrajectoryTopic.topic
        ),
        selectinload(LearningTrajectoryTask.trajectory_topic).selectinload(
            LearningTrajectoryTopic.elements
        ).selectinload(LearningTrajectoryElement.element),
        selectinload(LearningTrajectoryTask.primary_element),
        selectinload(LearningTrajectoryTask.related_elements).selectinload(
            LearningTrajectoryTaskElement.element
        ),
        selectinload(LearningTrajectoryTask.checked_relations)
        .selectinload(LearningTrajectoryTaskRelation.relation)
        .selectinload(KnowledgeElementRelation.relation),
        selectinload(LearningTrajectoryTask.checked_relations)
        .selectinload(LearningTrajectoryTaskRelation.relation)
        .selectinload(KnowledgeElementRelation.source_element),
        selectinload(LearningTrajectoryTask.checked_relations)
        .selectinload(LearningTrajectoryTaskRelation.relation)
        .selectinload(KnowledgeElementRelation.target_element),
    )


async def _get_student_for_control(student_id: UUID, session: DbSession) -> Student:
    result = await session.execute(
        select(Student)
        .options(lazyload("*"))
        .where(Student.id == student_id)
    )
    student = result.scalar_one_or_none()
    if student is None:
        raise not_found("Student", student_id)
    return student


async def _get_trajectory_for_control(
    trajectory_id: UUID,
    session: DbSession,
) -> LearningTrajectory:
    result = await session.execute(
        select(LearningTrajectory)
        .options(
            lazyload("*"),
            selectinload(LearningTrajectory.discipline),
            selectinload(LearningTrajectory.topics)
            .selectinload(LearningTrajectoryTopic.topic),
            selectinload(LearningTrajectory.topics)
            .selectinload(LearningTrajectoryTopic.elements)
            .selectinload(LearningTrajectoryElement.element),
        )
        .where(LearningTrajectory.id == trajectory_id)
    )
    trajectory = result.scalar_one_or_none()
    if trajectory is None:
        raise not_found("Learning trajectory", trajectory_id)
    return trajectory


async def _load_control_mastery_map(
    student_id: UUID,
    discipline_id: UUID,
    session: DbSession,
) -> dict[UUID, int]:
    result = await session.execute(
        select(
            StudentElementMastery.element_id,
            StudentElementMastery.mastery_value,
        ).where(
            StudentElementMastery.student_id == student_id,
            StudentElementMastery.discipline_id == discipline_id,
        )
    )
    return {
        element_id: mastery_value
        for element_id, mastery_value in result.all()
    }


async def _load_control_relation_map(
    discipline_id: UUID,
    session: DbSession,
) -> tuple[dict[UUID, list[KnowledgeElementRelation]], dict[UUID, int]]:
    result = await session.execute(
        select(KnowledgeElementRelation)
        .options(
            lazyload("*"),
            selectinload(KnowledgeElementRelation.relation).options(lazyload("*")),
        )
        .join(
            KnowledgeElement,
            KnowledgeElement.id == KnowledgeElementRelation.source_element_id,
        )
        .where(KnowledgeElement.discipline_id == discipline_id)
    )
    return build_relation_maps(list(result.scalars().all()))


async def _load_control_tasks(
    trajectory_id: UUID,
    trajectory_topic_id: UUID,
    session: DbSession,
) -> list[LearningTrajectoryTask]:
    result = await session.execute(
        select(LearningTrajectoryTask)
        .options(*_control_task_options())
        .where(
            LearningTrajectoryTask.trajectory_id == trajectory_id,
            LearningTrajectoryTask.trajectory_topic_id == trajectory_topic_id,
            LearningTrajectoryTask.task_type != LearningTrajectoryTaskType.TEXT,
        )
        .order_by(LearningTrajectoryTask.created_at.desc())
    )
    return list(result.scalars().all())


async def _load_control_progress(
    student_id: UUID,
    task_ids: set[UUID],
    session: DbSession,
) -> dict[UUID, StudentTaskProgress]:
    if not task_ids:
        return {}

    result = await session.execute(
        select(StudentTaskProgress).options(lazyload("*")).where(
            StudentTaskProgress.student_id == student_id,
            StudentTaskProgress.task_id.in_(task_ids),
        )
    )
    return {
        progress.task_id: progress
        for progress in result.scalars().all()
    }


async def _build_student_topic_control(
    student_id: UUID,
    trajectory_id: UUID,
    session: DbSession,
    *,
    topic_id: UUID | None = None,
    topic_position: int | None = None,
    continue_practice: bool = False,
) -> StudentTopicControlRead:
    student = await _get_student_for_control(student_id, session)
    trajectory = await _get_trajectory_for_control(trajectory_id, session)
    if not _student_can_access_trajectory(student, trajectory):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Траектория не назначена этому студенту или еще не активна.",
        )

    if topic_id is not None:
        trajectory_topic = next(
            (item for item in trajectory.topics if item.topic_id == topic_id),
            None,
        )
        not_found_value: UUID | int = topic_id
    else:
        trajectory_topic = next(
            (item for item in trajectory.topics if item.position == topic_position),
            None,
        )
        not_found_value = topic_position or 0

    if trajectory_topic is None:
        raise not_found("Trajectory topic", not_found_value)

    mastery_by_element_id = await _load_control_mastery_map(
        student.id,
        trajectory.discipline_id,
        session,
    )
    outgoing_by_source, degree_by_element_id = await _load_control_relation_map(
        trajectory.discipline_id,
        session,
    )

    elements = [
        StudentTopicControlElementRead(
            element_id=trajectory_element.element_id,
            name=trajectory_element.element.name,
            threshold=trajectory_element.threshold,
            mastery_value=mastery_by_element_id.get(trajectory_element.element_id, 0),
        )
        for trajectory_element in trajectory_topic.elements
    ]
    topic_mastery = _trajectory_topic_mastery(trajectory_topic, mastery_by_element_id)
    is_unlocked = _trajectory_topic_is_unlocked(
        trajectory,
        trajectory_topic,
        mastery_by_element_id,
    )

    tasks: list[LearningTrajectoryTask] = []
    progress_by_task_id: dict[UUID, StudentTaskProgress] = {}
    if is_unlocked:
        tasks = await _load_control_tasks(trajectory.id, trajectory_topic.id, session)
        progress_by_task_id = await _load_control_progress(
            student.id,
            {task.id for task in tasks},
            session,
        )

    has_tasks = bool(tasks)

    def _build_pool(*, ignore_target_mastery: bool) -> list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]]:
        candidate_pool = build_adaptive_candidate_pool(
            tasks,
            mastery_by_element_id,
            progress_by_task_id,
            outgoing_by_source,
            ignore_target_mastery=ignore_target_mastery,
        )
        if not candidate_pool:
            candidate_pool = build_adaptive_candidate_pool(
                tasks,
                mastery_by_element_id,
                progress_by_task_id,
                outgoing_by_source,
                ignore_stage_gate=True,
                ignore_target_mastery=ignore_target_mastery,
            )
        if not candidate_pool:
            candidate_pool = build_adaptive_candidate_pool(
                tasks,
                mastery_by_element_id,
                progress_by_task_id,
                outgoing_by_source,
                ignore_stage_gate=True,
                ignore_prerequisites=True,
                ignore_target_mastery=ignore_target_mastery,
            )
        return candidate_pool

    candidate_pool = _build_pool(ignore_target_mastery=continue_practice)
    continue_practice_available = False
    if not continue_practice and has_tasks and not candidate_pool:
        continue_practice_available = bool(_build_pool(ignore_target_mastery=True))
    elif continue_practice:
        continue_practice_available = bool(candidate_pool)

    selected = select_next_task(
        candidate_pool,
        mastery_by_element_id,
        degree_by_element_id,
    )

    current_task = None
    if selected is not None:
        task, progress, recommendation_score = selected
        instance = await _get_or_create_task_instance(student, task, session)
        await commit_or_409(session)
        current_task = build_student_task_read(
            task=task,
            discipline_name=trajectory.discipline.name,
            mastery_by_element_id=mastery_by_element_id,
            progress=progress,
            recommendation_score=recommendation_score,
            task_instance_id=instance.id,
            content_snapshot=parse_task_content_json(instance.content_snapshot_json),
        )

    return StudentTopicControlRead(
        student_id=student.id,
        trajectory_id=trajectory.id,
        topic_id=trajectory_topic.topic_id,
        topic_name=trajectory_topic.topic.name,
        topic_threshold=trajectory_topic.threshold,
        topic_mastery=topic_mastery,
        is_unlocked=is_unlocked,
        has_tasks=has_tasks,
        continue_practice_available=continue_practice_available,
        is_extra_practice=continue_practice,
        elements=elements,
        current_task=current_task,
    )


@router.get(
    "/{student_id}/trajectories/{trajectory_id}/control/{topic_id}",
    response_model=StudentTopicControlRead,
)
async def get_student_topic_control(
    student_id: UUID,
    trajectory_id: UUID,
    topic_id: UUID,
    session: DbSession,
    continue_practice: bool = Query(False),
) -> StudentTopicControlRead:
    return await _build_student_topic_control(
        student_id,
        trajectory_id,
        session,
        topic_id=topic_id,
        continue_practice=continue_practice,
    )


@router.get(
    "/{student_id}/trajectories/{trajectory_id}/mastery",
    response_model=StudentTrajectoryMasteryRead,
)
async def get_student_trajectory_mastery(
    student_id: UUID,
    trajectory_id: UUID,
    session: DbSession,
) -> StudentTrajectoryMasteryRead:
    student = await _get_student_for_control(student_id, session)
    trajectory = await _get_trajectory_for_control(trajectory_id, session)
    if not _student_can_access_trajectory(student, trajectory):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Траектория не назначена этому студенту или еще не активна.",
        )

    mastery_by_element_id = await _load_control_mastery_map(
        student.id,
        trajectory.discipline_id,
        session,
    )

    topics = [
        StudentTrajectoryMasteryTopicRead(
            topic_id=trajectory_topic.topic_id,
            position=trajectory_topic.position,
            threshold=trajectory_topic.threshold,
            mastery_value=_trajectory_topic_mastery(trajectory_topic, mastery_by_element_id),
            is_unlocked=_trajectory_topic_is_unlocked(
                trajectory,
                trajectory_topic,
                mastery_by_element_id,
            ),
            elements=[
                StudentTrajectoryMasteryElementRead(
                    element_id=trajectory_element.element_id,
                    threshold=trajectory_element.threshold,
                    mastery_value=mastery_by_element_id.get(trajectory_element.element_id, 0),
                )
                for trajectory_element in trajectory_topic.elements
            ],
        )
        for trajectory_topic in trajectory.topics
    ]

    return StudentTrajectoryMasteryRead(
        student_id=student.id,
        trajectory_id=trajectory.id,
        topics=topics,
    )


@router.get(
    "/{student_id}/trajectories/{trajectory_id}/control/steps/{topic_position}",
    response_model=StudentTopicControlRead,
)
async def get_student_topic_control_by_position(
    student_id: UUID,
    trajectory_id: UUID,
    topic_position: int,
    session: DbSession,
    continue_practice: bool = Query(False),
) -> StudentTopicControlRead:
    return await _build_student_topic_control(
        student_id,
        trajectory_id,
        session,
        topic_position=topic_position,
        continue_practice=continue_practice,
    )
