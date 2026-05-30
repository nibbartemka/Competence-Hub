import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import lazyload, load_only, selectinload

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import (
    Topic,
    TopicKnowledgeElement,
    KnowledgeElement,
    KnowledgeElementRelation,
    LearningTrajectory,
    LearningTrajectoryElement,
    LearningTrajectoryTask,
    LearningTrajectoryTaskElement,
    LearningTrajectoryTaskRelation,
    LearningTrajectoryTopic,
    MasterElementDomainObject,
    Student,
    StudentElementMastery,
    StudentTaskProgress,
)
from app.models.enums import (
    CompetenceType,
    LearningTrajectoryStatus,
    LearningTrajectoryTaskType,
    TopicKnowledgeElementRole,
)
from app.schemas import (
    StudentAdaptiveStatusRead,
    StudentTopicControlElementRead,
    StudentTopicControlNextTopicRead,
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
    _get_task_for_read,
    _get_or_create_task_instance,
    _trajectory_topic_knowledge_complete,
    _trajectory_topic_is_unlocked,
    _trajectory_topic_mastery,
    _trajectory_topic_skill_complete,
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
        selectinload(LearningTrajectoryTask.trajectory_topic).selectinload(
            LearningTrajectoryTopic.topic
        ),
        selectinload(LearningTrajectoryTask.trajectory_topic)
        .selectinload(LearningTrajectoryTopic.elements)
        .selectinload(LearningTrajectoryElement.element),
        selectinload(LearningTrajectoryTask.primary_element).options(
            lazyload("*"),
            load_only(
                KnowledgeElement.id,
                KnowledgeElement.competence_type,
            ),
        ),
        selectinload(LearningTrajectoryTask.related_elements).options(
            lazyload("*"),
            load_only(LearningTrajectoryTaskElement.element_id),
        ),
        selectinload(LearningTrajectoryTask.checked_relations)
        .selectinload(LearningTrajectoryTaskRelation.relation)
        .options(
            lazyload("*"),
            load_only(
                KnowledgeElementRelation.id,
                KnowledgeElementRelation.source_element_id,
                KnowledgeElementRelation.target_element_id,
            ),
        ),
    )


def _parse_adaptive_feedback(progress: StudentTaskProgress | None) -> dict:
    if progress is None or not progress.last_feedback_json:
        return {}
    try:
        parsed = json.loads(progress.last_feedback_json)
    except json.JSONDecodeError:
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _latest_adaptive_signal(
    candidates: list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]],
) -> tuple[dict, dict] | tuple[None, None]:
    latest_feedback: dict | None = None
    latest_signal: dict | None = None
    latest_answered_at = None
    for _task, progress in candidates:
        if progress is None or progress.last_answered_at is None:
            continue
        feedback = _parse_adaptive_feedback(progress)
        adaptive_signal = feedback.get("adaptive_signal")
        if not isinstance(adaptive_signal, dict):
            continue
        if adaptive_signal.get("kind") not in {"error", "fragile_success"}:
            continue
        if latest_answered_at is None or progress.last_answered_at > latest_answered_at:
            latest_answered_at = progress.last_answered_at
            latest_feedback = feedback
            latest_signal = adaptive_signal

    if latest_signal is None or latest_feedback is None:
        return None, None
    return latest_signal, latest_feedback


def _build_adaptive_status(
    *,
    selected: tuple[LearningTrajectoryTask, StudentTaskProgress | None, float] | None,
    candidate_pool: list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]],
    practice_stage: str,
    continue_practice: bool,
    continue_practice_available: bool,
    has_tasks: bool,
    show_next_topic_prompt: bool,
) -> StudentAdaptiveStatusRead:
    latest_signal, latest_feedback = _latest_adaptive_signal(candidate_pool)

    if selected is None:
        if continue_practice_available and not continue_practice and has_tasks:
            return StudentAdaptiveStatusRead(
                mode="practice_available",
                title="Основной порог уже достигнут",
                summary="В обычном режиме подходящие задания закончились, но можно включить дополнительную практику для закрепления.",
            )
        if continue_practice and has_tasks:
            return StudentAdaptiveStatusRead(
                mode="extra_practice_complete",
                title="Дополнительная практика исчерпана",
                summary="Система не нашла новых заданий даже в режиме дополнительной практики.",
            )
        if not has_tasks:
            return StudentAdaptiveStatusRead(
                mode="no_tasks",
                title="Для этого шага пока нет заданий",
                summary="В текущем состоянии темы система не может выдать задание на выбранном этапе контроля.",
            )
        return StudentAdaptiveStatusRead(
            mode="idle",
            title="Подходящее задание не выбрано",
            summary="Система не нашла задание, которое удовлетворяет текущим ограничениям отбора.",
        )

    _task, _progress, recommendation_score = selected
    expected_duration_seconds = None
    last_duration_seconds = None
    signal_kind = None
    if latest_signal is not None:
        signal_kind = str(latest_signal.get("kind") or "")
        expected_duration_seconds = (
            int(latest_signal["expected_duration_seconds"])
            if latest_signal.get("expected_duration_seconds") is not None
            else None
        )
        last_duration_seconds = (
            int(latest_feedback["duration_seconds"])
            if latest_feedback is not None and latest_feedback.get("duration_seconds") is not None
            else None
        )

    if signal_kind == "error":
        return StudentAdaptiveStatusRead(
            mode="recovery",
            title="Маршрут после недавней ошибки",
            summary="Следующий шаг выбран как повторная проверка после неверного ответа, чтобы уточнить понимание и закрепить слабое место.",
            signal_kind=signal_kind,
            recommendation_score=round(recommendation_score, 4),
            last_duration_seconds=last_duration_seconds,
            expected_duration_seconds=expected_duration_seconds,
        )

    if signal_kind == "fragile_success":
        return StudentAdaptiveStatusRead(
            mode="fragile_success",
            title="Подтверждение после медленного верного ответа",
            summary="Система выбрала дополнительный проверочный шаг, потому что прошлый ответ был верным, но занял больше ожидаемого времени.",
            signal_kind=signal_kind,
            recommendation_score=round(recommendation_score, 4),
            last_duration_seconds=last_duration_seconds,
            expected_duration_seconds=expected_duration_seconds,
        )

    if continue_practice:
        return StudentAdaptiveStatusRead(
            mode="extra_practice",
            title="Режим дополнительной практики",
            summary="Основной порог уже достигнут, поэтому система продолжает закрепление темы дополнительными заданиями.",
            recommendation_score=round(recommendation_score, 4),
        )

    if practice_stage == "master":
        return StudentAdaptiveStatusRead(
            mode="master_stage",
            title="Текущий путь: этап «Владеть»",
            summary="Система перешла к заданиям, которые проверяют устойчивое применение знаний и требуют более содержательного ответа.",
            recommendation_score=round(recommendation_score, 4),
        )

    if practice_stage == "can":
        return StudentAdaptiveStatusRead(
            mode="can_stage",
            title="Текущий путь: этап «Уметь»",
            summary="Порог по знаниям уже пройден, поэтому система выдает практические задания на применение темы.",
            recommendation_score=round(recommendation_score, 4),
        )

    if show_next_topic_prompt:
        return StudentAdaptiveStatusRead(
            mode="topic_threshold_passed",
            title="Порог по знаниям уже пройден",
            summary="Тема уже позволяет двигаться дальше, но система все еще может выдавать задания для закрепления или перехода на следующий этап.",
            recommendation_score=round(recommendation_score, 4),
        )

    return StudentAdaptiveStatusRead(
        mode="regular",
        title="Стандартный шаг адаптивного контроля",
        summary="Система выбрала следующее задание по текущему прогрессу, порогам темы и приоритету кандидатов.",
        recommendation_score=round(recommendation_score, 4),
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
            .selectinload(LearningTrajectoryTopic.topic)
            .selectinload(Topic.element_links)
            .selectinload(TopicKnowledgeElement.element),
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
    practice_stage: str = "know",
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
    stage_tasks: list[LearningTrajectoryTask] = []
    progress_by_task_id: dict[UUID, StudentTaskProgress] = {}
    normalized_practice_stage = (
        practice_stage
        if practice_stage in {"know", "can", "master"}
        else "know"
    )
    knowledge_threshold_passed = _trajectory_topic_knowledge_complete(
        trajectory_topic,
        mastery_by_element_id,
    )
    skill_threshold_passed = _trajectory_topic_skill_complete(
        trajectory_topic,
        mastery_by_element_id,
    )
    next_topic = next(
        (
            item
            for item in sorted(trajectory.topics, key=lambda topic: topic.position)
            if item.position > trajectory_topic.position
        ),
        None,
    )
    next_topic_read = (
        StudentTopicControlNextTopicRead(
            topic_id=next_topic.topic_id,
            topic_name=next_topic.topic.name,
            position=next_topic.position,
            is_unlocked=_trajectory_topic_is_unlocked(
                trajectory,
                next_topic,
                mastery_by_element_id,
            ),
        )
        if next_topic is not None
        else None
    )
    show_next_topic_prompt = bool(
        knowledge_threshold_passed
        and next_topic_read is not None
        and next_topic_read.is_unlocked
    )
    skill_practice_available = False
    master_practice_available = False

    if is_unlocked:
        tasks = await _load_control_tasks(trajectory.id, trajectory_topic.id, session)
        progress_by_task_id = await _load_control_progress(
            student.id,
            {task.id for task in tasks},
            session,
        )
        skill_practice_available = bool(
            knowledge_threshold_passed
            and any(task.primary_element.competence_type == CompetenceType.CAN for task in tasks)
        )
        master_practice_available = bool(
            skill_threshold_passed
            and any(task.primary_element.competence_type == CompetenceType.MASTER for task in tasks)
        )
        stage_competence = {
            "know": CompetenceType.KNOW,
            "can": CompetenceType.CAN,
            "master": CompetenceType.MASTER,
        }[normalized_practice_stage]
        stage_tasks = [
            task
            for task in tasks
            if task.primary_element.competence_type == stage_competence
        ]

    has_tasks = bool(stage_tasks)

    def _build_pool(*, ignore_target_mastery: bool) -> list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]]:
        candidate_pool = build_adaptive_candidate_pool(
            stage_tasks,
            mastery_by_element_id,
            progress_by_task_id,
            outgoing_by_source,
            ignore_target_mastery=ignore_target_mastery,
        )
        if not candidate_pool:
            candidate_pool = build_adaptive_candidate_pool(
                stage_tasks,
                mastery_by_element_id,
                progress_by_task_id,
                outgoing_by_source,
                ignore_stage_gate=True,
                ignore_target_mastery=ignore_target_mastery,
            )
        if not candidate_pool:
            candidate_pool = build_adaptive_candidate_pool(
                stage_tasks,
                mastery_by_element_id,
                progress_by_task_id,
                outgoing_by_source,
                ignore_stage_gate=True,
                ignore_prerequisites=True,
                ignore_target_mastery=ignore_target_mastery,
            )
        return candidate_pool

    outgoing_by_source: dict[UUID, list[KnowledgeElementRelation]] = {}
    degree_by_element_id: dict[UUID, int] = {}
    candidate_pool: list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]] = []
    if has_tasks:
        outgoing_by_source, degree_by_element_id = await _load_control_relation_map(
            trajectory.discipline_id,
            session,
        )
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
    adaptive_status = _build_adaptive_status(
        selected=selected,
        candidate_pool=candidate_pool,
        practice_stage=normalized_practice_stage,
        continue_practice=continue_practice,
        continue_practice_available=continue_practice_available,
        has_tasks=has_tasks,
        show_next_topic_prompt=show_next_topic_prompt,
    )

    current_task = None
    if selected is not None:
        task, progress, recommendation_score = selected
        instance = await _get_or_create_task_instance(student, task, session)
        await commit_or_409(session)
        full_task = await _get_task_for_read(task.id, session)
        current_task = build_student_task_read(
            task=full_task,
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
        practice_stage=normalized_practice_stage,
        knowledge_threshold_passed=knowledge_threshold_passed,
        skill_threshold_passed=skill_threshold_passed,
        skill_practice_available=skill_practice_available,
        master_practice_available=master_practice_available,
        show_next_topic_prompt=show_next_topic_prompt,
        next_topic=next_topic_read,
        adaptive_status=adaptive_status,
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
    practice_stage: str = Query("know"),
) -> StudentTopicControlRead:
    return await _build_student_topic_control(
        student_id,
        trajectory_id,
        session,
        topic_id=topic_id,
        continue_practice=continue_practice,
        practice_stage=practice_stage,
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
    practice_stage: str = Query("know"),
) -> StudentTopicControlRead:
    return await _build_student_topic_control(
        student_id,
        trajectory_id,
        session,
        topic_position=topic_position,
        continue_practice=continue_practice,
        practice_stage=practice_stage,
    )
