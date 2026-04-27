from uuid import UUID

from fastapi import APIRouter

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import Student, StudentTaskProgress
from app.models.enums import StudentTaskProgressStatus
from app.schemas import StudentTopicControlElementRead, StudentTopicControlRead
from app.services.learning_tasks import (
    build_student_task_read,
    parse_task_content_json,
    prerequisites_ready,
    select_next_task,
)

from .learning_trajectory_tasks import (
    _get_or_create_task_instance,
    _get_trajectory_for_tasks,
    _load_mastery_map,
    _load_relation_map,
    _load_student_tasks,
    _topic_is_unlocked,
    _trajectory_topic_is_unlocked,
    _trajectory_topic_mastery,
)


router = APIRouter(prefix="/students", tags=["Student Learning Control"])


@router.get(
    "/{student_id}/trajectories/{trajectory_id}/control/{topic_id}",
    response_model=StudentTopicControlRead,
)
async def get_student_topic_control(
    student_id: UUID,
    trajectory_id: UUID,
    topic_id: UUID,
    session: DbSession,
) -> StudentTopicControlRead:
    student = await session.get(Student, student_id)
    if student is None:
        raise not_found("Student", student_id)

    trajectory = await _get_trajectory_for_tasks(trajectory_id, session)
    trajectory_topic = next(
        (item for item in trajectory.topics if item.topic_id == topic_id),
        None,
    )
    if trajectory_topic is None:
        raise not_found("Trajectory topic", topic_id)

    tasks = await _load_student_tasks(
        student=student,
        session=session,
        discipline_id=trajectory.discipline_id,
        trajectory_id=trajectory.id,
        topic_id=topic_id,
    )
    mastery_by_element_id = await _load_mastery_map(
        student.id,
        {trajectory.discipline_id},
        session,
    )
    outgoing_by_source, degree_by_element_id = await _load_relation_map(
        {trajectory.discipline_id},
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

    accessible_candidates = []
    fallback_candidates = []
    for task in tasks:
        progress = progress_by_task_id.get(task.id)
        if not prerequisites_ready(task, mastery_by_element_id, outgoing_by_source):
            continue
        if not _topic_is_unlocked(task, mastery_by_element_id):
            continue

        fallback_candidates.append((task, progress))
        primary_mastery = mastery_by_element_id.get(task.primary_element_id, 0)
        if primary_mastery < 85 or progress is None or progress.status != StudentTaskProgressStatus.COMPLETED:
            accessible_candidates.append((task, progress))

    selected = select_next_task(
        accessible_candidates or fallback_candidates,
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

    is_unlocked = _trajectory_topic_is_unlocked(
        trajectory,
        trajectory_topic,
        mastery_by_element_id,
    )
    return StudentTopicControlRead(
        student_id=student.id,
        trajectory_id=trajectory.id,
        topic_id=topic_id,
        topic_name=trajectory_topic.topic.name,
        topic_threshold=trajectory_topic.threshold,
        topic_mastery=topic_mastery,
        is_unlocked=is_unlocked,
        elements=elements,
        current_task=current_task,
    )
