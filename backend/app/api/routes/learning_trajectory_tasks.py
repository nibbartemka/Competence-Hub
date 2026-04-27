from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import selectinload

from app.api.crud import commit_or_409, delete_and_commit, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import (
    Discipline,
    KnowledgeElement,
    KnowledgeElementRelation,
    LearningTrajectory,
    LearningTrajectoryElement,
    LearningTrajectoryTask,
    LearningTrajectoryTaskElement,
    LearningTrajectoryTopic,
    Student,
    StudentElementMastery,
    StudentTaskProgress,
)
from app.models.enums import LearningTrajectoryStatus, StudentTaskProgressStatus
from app.schemas import (
    LearningTrajectoryTaskCreate,
    LearningTrajectoryTaskRead,
    LearningTrajectoryTaskUpdate,
    StudentAssignedTaskRead,
    StudentTaskAnswerSubmit,
)
from app.services.learning_tasks import (
    bad_request,
    build_relation_maps,
    build_student_task_read,
    build_task_read,
    dump_task_content,
    ensure_task_write_allowed,
    evaluate_task_answer,
    merge_mastery_value,
    prerequisites_ready,
    task_priority,
    validate_manual_task_payload,
)


router = APIRouter(prefix="/learning-trajectory-tasks", tags=["Learning Trajectory Tasks"])


def _trajectory_read_options():
    return (
        selectinload(LearningTrajectory.discipline),
        selectinload(LearningTrajectory.topics)
        .selectinload(LearningTrajectoryTopic.topic),
        selectinload(LearningTrajectory.topics)
        .selectinload(LearningTrajectoryTopic.elements)
        .selectinload(LearningTrajectoryElement.element),
    )


def _task_read_options():
    return (
        selectinload(LearningTrajectoryTask.trajectory).selectinload(
            LearningTrajectory.discipline
        ),
        selectinload(LearningTrajectoryTask.trajectory_topic).selectinload(
            LearningTrajectoryTopic.topic
        ),
        selectinload(LearningTrajectoryTask.primary_element),
        selectinload(LearningTrajectoryTask.related_elements).selectinload(
            LearningTrajectoryTaskElement.element
        ),
        selectinload(LearningTrajectoryTask.student_progress_entries),
    )


async def _get_trajectory_for_tasks(
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


async def _get_task_for_read(task_id: UUID, session: DbSession) -> LearningTrajectoryTask:
    result = await session.execute(
        select(LearningTrajectoryTask)
        .options(*_task_read_options())
        .where(LearningTrajectoryTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise not_found("Learning trajectory task", task_id)
    return task


def _student_can_access_task(student: Student, task: LearningTrajectoryTask) -> bool:
    trajectory = task.trajectory
    if trajectory.status != LearningTrajectoryStatus.ACTIVE:
        return False
    if trajectory.group_id != student.group_id:
        return False
    if trajectory.subgroup_id is None:
        return True
    return trajectory.subgroup_id == student.subgroup_id


async def _load_student_tasks(
    student: Student,
    session: DbSession,
    discipline_id: UUID | None = None,
) -> list[LearningTrajectoryTask]:
    query = (
        select(LearningTrajectoryTask)
        .join(LearningTrajectory, LearningTrajectoryTask.trajectory_id == LearningTrajectory.id)
        .options(*_task_read_options())
        .where(
            LearningTrajectory.status == LearningTrajectoryStatus.ACTIVE,
            LearningTrajectory.group_id == student.group_id,
        )
    )

    if student.subgroup_id is None:
        query = query.where(LearningTrajectory.subgroup_id.is_(None))
    else:
        query = query.where(
            or_(
                LearningTrajectory.subgroup_id.is_(None),
                LearningTrajectory.subgroup_id == student.subgroup_id,
            )
        )

    if discipline_id is not None:
        query = query.where(LearningTrajectory.discipline_id == discipline_id)

    result = await session.execute(
        query.order_by(LearningTrajectoryTask.created_at.desc())
    )
    return list(result.scalars().all())


async def _load_mastery_map(
    student_id: UUID,
    discipline_ids: set[UUID],
    session: DbSession,
) -> dict[UUID, int]:
    if not discipline_ids:
        return {}

    result = await session.execute(
        select(StudentElementMastery).where(
            StudentElementMastery.student_id == student_id,
            StudentElementMastery.discipline_id.in_(discipline_ids),
        )
    )
    return {
        mastery.element_id: mastery.mastery_value
        for mastery in result.scalars().all()
    }


async def _load_relation_map(
    discipline_ids: set[UUID],
    session: DbSession,
) -> tuple[dict[UUID, list[KnowledgeElementRelation]], dict[UUID, int]]:
    if not discipline_ids:
        return {}, {}

    result = await session.execute(
        select(KnowledgeElementRelation)
        .join(
            KnowledgeElement,
            KnowledgeElement.id == KnowledgeElementRelation.source_element_id,
        )
        .where(KnowledgeElement.discipline_id.in_(discipline_ids))
    )
    return build_relation_maps(list(result.scalars().all()))


async def _upsert_student_mastery(
    student: Student,
    discipline_id: UUID,
    element_id: UUID,
    score: int,
    session: DbSession,
) -> StudentElementMastery:
    result = await session.execute(
        select(StudentElementMastery).where(
            StudentElementMastery.student_id == student.id,
            StudentElementMastery.discipline_id == discipline_id,
            StudentElementMastery.element_id == element_id,
        )
    )
    mastery = result.scalar_one_or_none()
    if mastery is None:
        mastery = StudentElementMastery(
            student_id=student.id,
            discipline_id=discipline_id,
            element_id=element_id,
            mastery_value=score,
        )
        session.add(mastery)
    else:
        mastery.mastery_value = merge_mastery_value(mastery.mastery_value, score)
    mastery.updated_at = datetime.utcnow()
    return mastery


@router.get(
    "/trajectories/{trajectory_id}",
    response_model=list[LearningTrajectoryTaskRead],
)
async def list_learning_trajectory_tasks(
    trajectory_id: UUID,
    session: DbSession,
) -> list[LearningTrajectoryTaskRead]:
    await _get_trajectory_for_tasks(trajectory_id, session)
    result = await session.execute(
        select(LearningTrajectoryTask)
        .options(*_task_read_options())
        .where(LearningTrajectoryTask.trajectory_id == trajectory_id)
        .order_by(LearningTrajectoryTask.created_at.desc())
    )
    return [build_task_read(task) for task in result.scalars().all()]


@router.post(
    "/trajectories/{trajectory_id}",
    response_model=LearningTrajectoryTaskRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_learning_trajectory_task(
    trajectory_id: UUID,
    payload: LearningTrajectoryTaskCreate,
    session: DbSession,
) -> LearningTrajectoryTaskRead:
    trajectory = await _get_trajectory_for_tasks(trajectory_id, session)
    normalized_content = validate_manual_task_payload(trajectory, payload)

    trajectory_topic = next(
        topic for topic in trajectory.topics if topic.topic_id == payload.topic_id
    )
    task = LearningTrajectoryTask(
        trajectory_id=trajectory.id,
        trajectory_topic_id=trajectory_topic.id,
        primary_element_id=payload.primary_element_id,
        task_type=payload.task_type,
        prompt=payload.prompt.strip(),
        content_json=dump_task_content(normalized_content),
        difficulty=payload.difficulty,
    )
    session.add(task)
    await flush_or_409(session)

    for related_element_id in payload.related_element_ids:
        session.add(
            LearningTrajectoryTaskElement(
                task_id=task.id,
                element_id=related_element_id,
            )
        )

    await commit_or_409(session)
    return build_task_read(await _get_task_for_read(task.id, session))


@router.put("/{task_id}", response_model=LearningTrajectoryTaskRead)
async def update_learning_trajectory_task(
    task_id: UUID,
    payload: LearningTrajectoryTaskUpdate,
    session: DbSession,
) -> LearningTrajectoryTaskRead:
    task = await _get_task_for_read(task_id, session)
    trajectory = await _get_trajectory_for_tasks(task.trajectory_id, session)
    normalized_content = validate_manual_task_payload(
        trajectory,
        LearningTrajectoryTaskCreate(**payload.model_dump()),
    )

    trajectory_topic = next(
        topic for topic in trajectory.topics if topic.topic_id == payload.topic_id
    )
    task.trajectory_topic_id = trajectory_topic.id
    task.primary_element_id = payload.primary_element_id
    task.task_type = payload.task_type
    task.prompt = payload.prompt.strip()
    task.content_json = dump_task_content(normalized_content)
    task.difficulty = payload.difficulty
    task.updated_at = datetime.utcnow()

    for related_element in list(task.related_elements):
        await session.delete(related_element)
    await flush_or_409(session)

    for related_element_id in payload.related_element_ids:
        session.add(
            LearningTrajectoryTaskElement(
                task_id=task.id,
                element_id=related_element_id,
            )
        )

    await commit_or_409(session)
    return build_task_read(await _get_task_for_read(task.id, session))


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_learning_trajectory_task(
    task_id: UUID,
    session: DbSession,
) -> None:
    task = await _get_task_for_read(task_id, session)
    ensure_task_write_allowed(task.trajectory)
    await delete_and_commit(session, task)


@router.get(
    "/students/{student_id}",
    response_model=list[StudentAssignedTaskRead],
)
async def list_student_tasks(
    student_id: UUID,
    session: DbSession,
    discipline_id: UUID | None = None,
) -> list[StudentAssignedTaskRead]:
    student = await session.get(Student, student_id)
    if student is None:
        raise not_found("Student", student_id)

    tasks = await _load_student_tasks(student, session, discipline_id)
    discipline_ids = {task.trajectory.discipline_id for task in tasks}
    mastery_by_element_id = await _load_mastery_map(student.id, discipline_ids, session)

    progress_by_task_id: dict[UUID, StudentTaskProgress] = {}
    for task in tasks:
        progress = next(
            (
                item
                for item in task.student_progress_entries
                if item.student_id == student.id
            ),
            None,
        )
        if progress is not None:
            progress_by_task_id[task.id] = progress

    return [
        build_student_task_read(
            task=task,
            discipline_name=task.trajectory.discipline.name,
            mastery_by_element_id=mastery_by_element_id,
            progress=progress_by_task_id.get(task.id),
        )
        for task in tasks
    ]


@router.get(
    "/students/{student_id}/next",
    response_model=StudentAssignedTaskRead | None,
)
async def get_recommended_student_task(
    student_id: UUID,
    session: DbSession,
    discipline_id: UUID | None = None,
) -> StudentAssignedTaskRead | None:
    student = await session.get(Student, student_id)
    if student is None:
        raise not_found("Student", student_id)

    tasks = await _load_student_tasks(student, session, discipline_id)
    if not tasks:
        return None

    discipline_ids = {task.trajectory.discipline_id for task in tasks}
    mastery_by_element_id = await _load_mastery_map(student.id, discipline_ids, session)
    outgoing_by_source, degree_by_element_id = await _load_relation_map(discipline_ids, session)

    candidates: list[tuple[float, LearningTrajectoryTask, StudentTaskProgress | None]] = []
    fallback_candidates: list[tuple[float, LearningTrajectoryTask, StudentTaskProgress | None]] = []
    for task in tasks:
        progress = next(
            (
                item
                for item in task.student_progress_entries
                if item.student_id == student.id
            ),
            None,
        )
        if not prerequisites_ready(task, mastery_by_element_id, outgoing_by_source):
            continue

        score = task_priority(task, mastery_by_element_id, degree_by_element_id, progress)
        fallback_candidates.append((score, task, progress))
        primary_mastery = mastery_by_element_id.get(task.primary_element_id, 0)
        if primary_mastery < 85 or progress is None or progress.status != StudentTaskProgressStatus.COMPLETED:
            candidates.append((score, task, progress))

    pool = candidates or fallback_candidates
    if not pool:
        return None

    pool.sort(key=lambda item: item[0], reverse=True)
    recommendation_score, task, progress = pool[0]
    return build_student_task_read(
        task=task,
        discipline_name=task.trajectory.discipline.name,
        mastery_by_element_id=mastery_by_element_id,
        progress=progress,
        recommendation_score=round(recommendation_score, 4),
    )


@router.put(
    "/{task_id}/students/{student_id}/progress",
    response_model=StudentAssignedTaskRead,
)
async def submit_student_task_score(
    task_id: UUID,
    student_id: UUID,
    payload: StudentTaskAnswerSubmit,
    session: DbSession,
) -> StudentAssignedTaskRead:
    student = await session.get(Student, student_id)
    if student is None:
        raise not_found("Student", student_id)

    task = await _get_task_for_read(task_id, session)
    if not _student_can_access_task(student, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Task is not assigned to this student.",
        )

    result = await session.execute(
        select(StudentTaskProgress).where(
            StudentTaskProgress.student_id == student.id,
            StudentTaskProgress.task_id == task.id,
        )
    )
    progress = result.scalar_one_or_none()
    if progress is None:
        progress = StudentTaskProgress(
            student_id=student.id,
            task_id=task.id,
        )
        session.add(progress)

    score, normalized_answer_payload = evaluate_task_answer(task, payload.answer_payload)

    progress.attempts_count += 1
    progress.last_score = score
    progress.best_score = max(progress.best_score or 0, score)
    progress.last_answered_at = datetime.utcnow()
    progress.last_answer_payload = dump_task_content(normalized_answer_payload)
    progress.status = (
        StudentTaskProgressStatus.COMPLETED
        if score >= 60
        else StudentTaskProgressStatus.IN_PROGRESS
    )
    if progress.status == StudentTaskProgressStatus.COMPLETED:
        progress.completed_at = datetime.utcnow()

    affected_element_ids = [task.primary_element_id] + [
        related.element_id for related in task.related_elements
    ]
    for element_id in affected_element_ids:
        await _upsert_student_mastery(
            student=student,
            discipline_id=task.trajectory.discipline_id,
            element_id=element_id,
            score=score,
            session=session,
        )

    await commit_or_409(session)

    updated_task = await _get_task_for_read(task.id, session)
    mastery_by_element_id = await _load_mastery_map(
        student.id,
        {updated_task.trajectory.discipline_id},
        session,
    )
    updated_progress = next(
        (
            item
            for item in updated_task.student_progress_entries
            if item.student_id == student.id
        ),
        None,
    )
    return build_student_task_read(
        task=updated_task,
        discipline_name=updated_task.trajectory.discipline.name,
        mastery_by_element_id=mastery_by_element_id,
        progress=updated_progress,
    )
