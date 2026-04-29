from datetime import datetime
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import lazyload, selectinload

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
    LearningTrajectoryTaskRelation,
    LearningTrajectoryTopic,
    Student,
    StudentElementMastery,
    StudentTaskAttempt,
    StudentTaskInstance,
    StudentTaskProgress,
)
from app.models.enums import (
    CompetenceType,
    LearningTrajectoryStatus,
    LearningTrajectoryTaskType,
    StudentTaskProgressStatus,
)
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
    parse_task_content_json,
    prerequisites_ready,
    select_next_task,
    TASK_CHECKED_RELATIONS,
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


def _task_read_options(
    include_unlock_data: bool = False,
    include_progress_entries: bool = False,
):
    options = [
        lazyload("*"),
        selectinload(LearningTrajectoryTask.trajectory).options(
            lazyload("*"),
            selectinload(LearningTrajectory.discipline).options(lazyload("*")),
        ),
        selectinload(LearningTrajectoryTask.trajectory_topic).options(
            lazyload("*"),
            selectinload(LearningTrajectoryTopic.topic).options(lazyload("*")),
        ),
        selectinload(LearningTrajectoryTask.primary_element).options(lazyload("*")),
        selectinload(LearningTrajectoryTask.related_elements).options(
            lazyload("*"),
            selectinload(LearningTrajectoryTaskElement.element).options(lazyload("*")),
        ),
        selectinload(LearningTrajectoryTask.checked_relations).options(
            lazyload("*"),
            selectinload(LearningTrajectoryTaskRelation.relation).options(
                lazyload("*"),
                selectinload(KnowledgeElementRelation.relation).options(
                    lazyload("*")
                ),
                selectinload(KnowledgeElementRelation.source_element).options(
                    lazyload("*")
                ),
                selectinload(KnowledgeElementRelation.target_element).options(
                    lazyload("*")
                ),
            ),
        ),
    ]
    if include_progress_entries:
        options.append(
            selectinload(LearningTrajectoryTask.student_progress_entries).options(
                lazyload("*")
            )
        )
    if include_unlock_data:
        options.append(
            selectinload(LearningTrajectoryTask.trajectory).options(
                selectinload(LearningTrajectory.topics).options(
                    lazyload("*"),
                    selectinload(LearningTrajectoryTopic.elements).options(
                        lazyload("*"),
                        selectinload(LearningTrajectoryElement.element).options(
                            lazyload("*")
                        ),
                    ),
                )
            )
        )
    return tuple(options)


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


async def _ensure_trajectory_exists(trajectory_id: UUID, session: DbSession) -> None:
    result = await session.execute(
        select(LearningTrajectory.id).where(LearningTrajectory.id == trajectory_id)
    )
    if result.scalar_one_or_none() is None:
        raise not_found("Learning trajectory", trajectory_id)


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


async def _get_student_for_tasks(student_id: UUID, session: DbSession) -> Student:
    result = await session.execute(
        select(Student).options(lazyload("*")).where(Student.id == student_id)
    )
    student = result.scalar_one_or_none()
    if student is None:
        raise not_found("Student", student_id)
    return student


async def _load_progress_by_task_id(
    student_id: UUID,
    task_ids: set[UUID],
    session: DbSession,
) -> dict[UUID, StudentTaskProgress]:
    if not task_ids:
        return {}
    result = await session.execute(
        select(StudentTaskProgress)
        .options(lazyload("*"))
        .where(
            StudentTaskProgress.student_id == student_id,
            StudentTaskProgress.task_id.in_(task_ids),
        )
    )
    return {
        progress.task_id: progress
        for progress in result.scalars().all()
    }


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
    trajectory_id: UUID | None = None,
    topic_id: UUID | None = None,
    include_unlock_data: bool = False,
) -> list[LearningTrajectoryTask]:
    query = (
        select(LearningTrajectoryTask)
        .join(LearningTrajectory, LearningTrajectoryTask.trajectory_id == LearningTrajectory.id)
        .options(*_task_read_options(include_unlock_data))
        .where(
            LearningTrajectory.status == LearningTrajectoryStatus.ACTIVE,
            LearningTrajectory.group_id == student.group_id,
            LearningTrajectoryTask.task_type != LearningTrajectoryTaskType.TEXT,
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
    if trajectory_id is not None:
        query = query.where(LearningTrajectoryTask.trajectory_id == trajectory_id)
    if topic_id is not None:
        query = query.join(
            LearningTrajectoryTopic,
            LearningTrajectoryTask.trajectory_topic_id == LearningTrajectoryTopic.id,
        ).where(LearningTrajectoryTopic.topic_id == topic_id)

    result = await session.execute(
        query.order_by(LearningTrajectoryTask.created_at.desc())
    )
    return list(result.scalars().all())


def _trajectory_topic_mastery(
    trajectory_topic: LearningTrajectoryTopic,
    mastery_by_element_id: dict[UUID, int],
) -> int:
    element_ids = [element.element_id for element in trajectory_topic.elements]
    if not element_ids:
        return 100
    return round(
        sum(mastery_by_element_id.get(element_id, 0) for element_id in element_ids)
        / len(element_ids)
    )


def _trajectory_topic_is_unlocked(
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    mastery_by_element_id: dict[UUID, int],
) -> bool:
    for previous_topic in trajectory.topics:
        if previous_topic.position >= trajectory_topic.position:
            continue
        if _trajectory_topic_mastery(previous_topic, mastery_by_element_id) < previous_topic.threshold:
            return False
    return True


def _topic_is_unlocked(
    task: LearningTrajectoryTask,
    mastery_by_element_id: dict[UUID, int],
) -> bool:
    return _trajectory_topic_is_unlocked(
        task.trajectory,
        task.trajectory_topic,
        mastery_by_element_id,
    )


async def _load_mastery_map(
    student_id: UUID,
    discipline_ids: set[UUID],
    session: DbSession,
) -> dict[UUID, int]:
    if not discipline_ids:
        return {}

    result = await session.execute(
        select(
            StudentElementMastery.element_id,
            StudentElementMastery.mastery_value,
        ).where(
            StudentElementMastery.student_id == student_id,
            StudentElementMastery.discipline_id.in_(discipline_ids),
        )
    )
    return {
        element_id: mastery_value
        for element_id, mastery_value in result.all()
    }


async def _load_relation_map(
    discipline_ids: set[UUID],
    session: DbSession,
) -> tuple[dict[UUID, list[KnowledgeElementRelation]], dict[UUID, int]]:
    if not discipline_ids:
        return {}, {}

    result = await session.execute(
        select(KnowledgeElementRelation)
        .options(
            lazyload("*"),
            selectinload(KnowledgeElementRelation.relation).options(
                lazyload("*")
            ),
        )
        .join(
            KnowledgeElement,
            KnowledgeElement.id == KnowledgeElementRelation.source_element_id,
        )
        .where(KnowledgeElement.discipline_id.in_(discipline_ids))
    )
    return build_relation_maps(list(result.scalars().all()))


async def _validate_checked_relations(
    trajectory: LearningTrajectory,
    primary_element_id: UUID,
    related_element_ids: list[UUID],
    checked_relation_ids: list[UUID],
    session: DbSession,
) -> list[KnowledgeElementRelation]:
    if not checked_relation_ids:
        return []
    if len(checked_relation_ids) != len(set(checked_relation_ids)):
        raise bad_request("Проверяемые связи в одном задании не должны повторяться.")

    checked_element_ids = {primary_element_id, *related_element_ids}
    result = await session.execute(
        select(KnowledgeElementRelation)
        .options(
            selectinload(KnowledgeElementRelation.relation).options(
                lazyload("*")
            ),
            selectinload(KnowledgeElementRelation.source_element),
            selectinload(KnowledgeElementRelation.target_element),
        )
        .where(KnowledgeElementRelation.id.in_(checked_relation_ids))
    )
    relations = list(result.scalars().all())
    relation_by_id = {relation.id: relation for relation in relations}
    missing_ids = [relation_id for relation_id in checked_relation_ids if relation_id not in relation_by_id]
    if missing_ids:
        raise bad_request("Одна из проверяемых связей не найдена.")

    for relation in relations:
        if relation.relation_type not in TASK_CHECKED_RELATIONS:
            raise bad_request("Для заданий «Знать» выбрана неподдерживаемая проверяемая связь.")
        if (
            relation.source_element_id not in checked_element_ids
            or relation.target_element_id not in checked_element_ids
        ):
            raise bad_request(
                "Проверяемая связь должна соединять ключевой элемент и выбранные связанные элементы задания."
            )
        if (
            relation.source_element.discipline_id != trajectory.discipline_id
            or relation.target_element.discipline_id != trajectory.discipline_id
        ):
            raise bad_request("Проверяемая связь должна принадлежать дисциплине этой траектории.")
        if (
            relation.source_element.competence_type != CompetenceType.KNOW
            or relation.target_element.competence_type != CompetenceType.KNOW
        ):
            raise bad_request("Проверяемые связи в заданиях пока доступны только для элементов «Знать».")

    return [relation_by_id[relation_id] for relation_id in checked_relation_ids]


async def _get_or_create_task_instance(
    student: Student,
    task: LearningTrajectoryTask,
    session: DbSession,
) -> StudentTaskInstance:
    result = await session.execute(
        select(StudentTaskInstance)
        .options(lazyload("*"))
        .where(
            StudentTaskInstance.student_id == student.id,
            StudentTaskInstance.task_id == task.id,
            StudentTaskInstance.answered_at.is_(None),
        )
        .order_by(StudentTaskInstance.issued_at.desc())
    )
    instance = result.scalars().first()
    if instance is not None:
        return instance

    instance = StudentTaskInstance(
        student_id=student.id,
        task_id=task.id,
        content_snapshot_json=task.content_json,
    )
    session.add(instance)
    await flush_or_409(session)
    return instance


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
    await _ensure_trajectory_exists(trajectory_id, session)
    result = await session.execute(
        select(LearningTrajectoryTask)
        .options(*_task_read_options())
        .where(
            LearningTrajectoryTask.trajectory_id == trajectory_id,
            LearningTrajectoryTask.task_type != LearningTrajectoryTaskType.TEXT,
        )
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
    checked_relations = await _validate_checked_relations(
        trajectory=trajectory,
        primary_element_id=payload.primary_element_id,
        related_element_ids=payload.related_element_ids,
        checked_relation_ids=payload.checked_relation_ids,
        session=session,
    )

    trajectory_topic = next(
        topic for topic in trajectory.topics if topic.topic_id == payload.topic_id
    )
    task = LearningTrajectoryTask(
        trajectory_id=trajectory.id,
        trajectory_topic_id=trajectory_topic.id,
        primary_element_id=payload.primary_element_id,
        task_type=payload.task_type,
        template_kind=payload.template_kind,
        title=payload.title.strip(),
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
    for relation in checked_relations:
        session.add(
            LearningTrajectoryTaskRelation(
                task_id=task.id,
                relation_id=relation.id,
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
    checked_relations = await _validate_checked_relations(
        trajectory=trajectory,
        primary_element_id=payload.primary_element_id,
        related_element_ids=payload.related_element_ids,
        checked_relation_ids=payload.checked_relation_ids,
        session=session,
    )

    trajectory_topic = next(
        topic for topic in trajectory.topics if topic.topic_id == payload.topic_id
    )
    task.trajectory_topic_id = trajectory_topic.id
    task.primary_element_id = payload.primary_element_id
    task.task_type = payload.task_type
    task.template_kind = payload.template_kind
    task.title = payload.title.strip()
    task.prompt = payload.prompt.strip()
    task.content_json = dump_task_content(normalized_content)
    task.difficulty = payload.difficulty
    task.updated_at = datetime.utcnow()

    for related_element in list(task.related_elements):
        await session.delete(related_element)
    for checked_relation in list(task.checked_relations):
        await session.delete(checked_relation)
    await flush_or_409(session)

    for related_element_id in payload.related_element_ids:
        session.add(
            LearningTrajectoryTaskElement(
                task_id=task.id,
                element_id=related_element_id,
            )
        )
    for relation in checked_relations:
        session.add(
            LearningTrajectoryTaskRelation(
                task_id=task.id,
                relation_id=relation.id,
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
    trajectory_id: UUID | None = None,
    topic_id: UUID | None = None,
) -> list[StudentAssignedTaskRead]:
    student = await _get_student_for_tasks(student_id, session)

    tasks = await _load_student_tasks(student, session, discipline_id, trajectory_id, topic_id)
    discipline_ids = {task.trajectory.discipline_id for task in tasks}
    mastery_by_element_id = await _load_mastery_map(student.id, discipline_ids, session)

    progress_by_task_id = await _load_progress_by_task_id(
        student.id,
        {task.id for task in tasks},
        session,
    )

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
    trajectory_id: UUID | None = None,
    topic_id: UUID | None = None,
) -> StudentAssignedTaskRead | None:
    student = await _get_student_for_tasks(student_id, session)

    tasks = await _load_student_tasks(
        student,
        session,
        discipline_id,
        trajectory_id,
        topic_id,
        include_unlock_data=True,
    )
    if not tasks:
        return None

    discipline_ids = {task.trajectory.discipline_id for task in tasks}
    mastery_by_element_id = await _load_mastery_map(student.id, discipline_ids, session)
    outgoing_by_source, degree_by_element_id = await _load_relation_map(discipline_ids, session)
    progress_by_task_id = await _load_progress_by_task_id(
        student.id,
        {task.id for task in tasks},
        session,
    )

    candidates: list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]] = []
    fallback_candidates: list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]] = []
    for task in tasks:
        progress = progress_by_task_id.get(task.id)
        if not prerequisites_ready(task, mastery_by_element_id, outgoing_by_source):
            continue
        if not _topic_is_unlocked(task, mastery_by_element_id):
            continue

        fallback_candidates.append((task, progress))
        primary_mastery = mastery_by_element_id.get(task.primary_element_id, 0)
        if primary_mastery < 85 or progress is None or progress.status != StudentTaskProgressStatus.COMPLETED:
            candidates.append((task, progress))

    pool = candidates or fallback_candidates
    selected = select_next_task(pool, mastery_by_element_id, degree_by_element_id)
    if selected is None:
        return None

    task, progress, recommendation_score = selected
    instance = await _get_or_create_task_instance(student, task, session)
    await commit_or_409(session)
    content_snapshot = parse_task_content_json(instance.content_snapshot_json)
    return build_student_task_read(
        task=task,
        discipline_name=task.trajectory.discipline.name,
        mastery_by_element_id=mastery_by_element_id,
        progress=progress,
        recommendation_score=round(recommendation_score, 4),
        task_instance_id=instance.id,
        content_snapshot=content_snapshot,
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
    student = await _get_student_for_tasks(student_id, session)

    task = await _get_task_for_read(task_id, session)
    if not _student_can_access_task(student, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Задание не назначено этому студенту.",
        )

    if payload.task_instance_id is not None:
        instance_result = await session.execute(
            select(StudentTaskInstance)
            .options(lazyload("*"))
            .where(StudentTaskInstance.id == payload.task_instance_id)
        )
        instance = instance_result.scalar_one_or_none()
        if (
            instance is None
            or instance.student_id != student.id
            or instance.task_id != task.id
        ):
            raise bad_request("Экземпляр задания не найден для этого студента.")
        if instance.answered_at is not None:
            raise bad_request("Этот экземпляр задания уже был отправлен.")
    else:
        instance = await _get_or_create_task_instance(student, task, session)

    content_snapshot = parse_task_content_json(instance.content_snapshot_json)

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
            attempts_count=0,
            status=StudentTaskProgressStatus.NOT_STARTED,
        )
        session.add(progress)

    score, normalized_answer_payload, feedback = evaluate_task_answer(
        task,
        payload.answer_payload,
        content_snapshot=content_snapshot,
    )
    answered_at = datetime.utcnow()
    instance.answered_at = answered_at
    session.add(
        StudentTaskAttempt(
            instance_id=instance.id,
            student_id=student.id,
            task_id=task.id,
            answer_payload_json=dump_task_content(normalized_answer_payload),
            feedback_json=dump_task_content(feedback),
            score=score,
            duration_seconds=payload.duration_seconds,
            answered_at=answered_at,
        )
    )

    progress.attempts_count = (progress.attempts_count or 0) + 1
    progress.last_score = score
    progress.best_score = max(progress.best_score or 0, score)
    progress.last_answered_at = answered_at
    progress.last_answer_payload = dump_task_content(normalized_answer_payload)
    progress.last_feedback_json = dump_task_content(feedback)
    progress.status = (
        StudentTaskProgressStatus.COMPLETED
        if score >= 60
        else StudentTaskProgressStatus.IN_PROGRESS
    )
    if progress.status == StudentTaskProgressStatus.COMPLETED:
        progress.completed_at = answered_at

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
    return build_student_task_read(
        task=updated_task,
        discipline_name=updated_task.trajectory.discipline.name,
        mastery_by_element_id=mastery_by_element_id,
        progress=progress,
    )
