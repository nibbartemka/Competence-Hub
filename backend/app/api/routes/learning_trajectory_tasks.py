from datetime import datetime
from pathlib import Path
from urllib.parse import quote
from uuid import UUID, uuid4

from fastapi import APIRouter, File, Form, Header, HTTPException, UploadFile, status
from fastapi.responses import FileResponse, Response
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import lazyload, load_only, selectinload

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
    MasterElementDomainObject,
    Student,
    StudentElementMastery,
    StudentTaskAttempt,
    StudentTaskInstance,
    StudentTaskProgress,
    Teacher,
    Topic,
    TopicKnowledgeElement,
)
from app.models.enums import (
    CompetenceType,
    KnowledgeElementRelationType,
    LearningTrajectoryStatus,
    LearningTrajectoryTaskType,
    StudentTaskProgressStatus,
    TopicKnowledgeElementRole,
)
from app.schemas import (
    LearningTrajectoryTaskCreate,
    LearningTrajectoryTaskRead,
    LearningTrajectoryTaskUpdate,
    StudentAssignedTaskRead,
    StudentTaskAnswerSubmit,
    StudentTaskManualReviewUpdate,
)
from app.services.learning_tasks import (
    bad_request,
    build_adaptive_candidate_pool,
    build_relation_maps,
    build_student_task_read,
    build_task_read,
    dump_task_content,
    enrich_feedback_for_adaptive_control,
    ensure_task_write_allowed,
    evaluate_task_answer,
    merge_mastery_value,
    normalize_task_request_payload,
    parse_task_content_json,
    select_next_task,
    TASK_CHECKED_RELATIONS,
    validate_task_payload,
)
from app.services.object_storage import (
    ObjectStorageError,
    download_student_submission,
    upload_student_submission,
)
from app.services.session_store import session_store


router = APIRouter(prefix="/learning-trajectory-tasks", tags=["Learning Trajectory Tasks"])
LEGACY_UPLOAD_ROOT = Path(__file__).resolve().parents[3] / "uploads" / "student_task_submissions"


def _safe_uploaded_filename(filename: str | None) -> str:
    candidate = Path(filename or "submission").name.strip() or "submission"
    sanitized = "".join(
        char if char.isalnum() or char in {"-", "_", "."} else "_"
        for char in candidate
    )
    return sanitized[:180] or "submission"


def _extract_submitted_file(answer_payload: dict | None) -> dict | None:
    if not isinstance(answer_payload, dict):
        return None
    if answer_payload.get("submission_kind") != "file":
        return None
    original_name = str(answer_payload.get("original_name", "")).strip()
    if not original_name:
        return None
    result = {
        "submission_kind": "file",
        "original_name": original_name,
        "mime_type": str(answer_payload.get("mime_type", "")).strip(),
        "size_bytes": int(answer_payload.get("size_bytes") or 0),
        "uploaded_at": str(answer_payload.get("uploaded_at", "")).strip(),
    }
    object_key = str(answer_payload.get("object_key", "")).strip()
    bucket_name = str(answer_payload.get("bucket_name", "")).strip()
    if object_key and bucket_name:
        result["storage_provider"] = str(answer_payload.get("storage_provider", "minio")).strip() or "minio"
        result["bucket_name"] = bucket_name
        result["object_key"] = object_key
        return result
    stored_path = str(answer_payload.get("stored_path", "")).strip()
    if stored_path:
        result["stored_path"] = stored_path
        return result
    return None


def _manual_review_feedback(message: str, **extra) -> dict:
    return {
        "manual_review": True,
        "message": message,
        **extra,
    }


async def _require_teacher_review_access(
    session: DbSession,
    *,
    task: LearningTrajectoryTask,
    x_session_id: str | None,
) -> Teacher:
    auth_session = await session_store.get(x_session_id)
    if auth_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия не найдена. Выполните вход заново.",
        )
    if auth_session.role != "teacher":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Проверять задания вручную может только преподаватель.",
        )
    teacher_id = UUID(auth_session.user_id)
    teacher_result = await session.execute(
        select(Teacher).options(lazyload("*")).where(Teacher.id == teacher_id)
    )
    teacher = teacher_result.scalar_one_or_none()
    if teacher is None or not teacher.is_active:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Профиль преподавателя недоступен для проверки задания.",
        )
    if task.trajectory.teacher_id != teacher.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Только преподаватель этой траектории может проверять файл студента.",
        )
    return teacher


def _trajectory_read_options():
    return (
        selectinload(LearningTrajectory.discipline),
        selectinload(LearningTrajectory.topics)
        .selectinload(LearningTrajectoryTopic.topic)
        .selectinload(Topic.element_links)
        .selectinload(TopicKnowledgeElement.element),
        selectinload(LearningTrajectory.topics)
        .selectinload(LearningTrajectoryTopic.elements)
        .selectinload(LearningTrajectoryElement.element),
    )


def _trajectory_unlock_options():
    return selectinload(LearningTrajectory.topics).options(
        lazyload("*"),
        load_only(
            LearningTrajectoryTopic.id,
            LearningTrajectoryTopic.topic_id,
            LearningTrajectoryTopic.position,
            LearningTrajectoryTopic.threshold,
        ),
        selectinload(LearningTrajectoryTopic.topic).options(
            lazyload("*"),
            load_only(Topic.id, Topic.name),
            selectinload(Topic.element_links).options(
                lazyload("*"),
                load_only(
                    TopicKnowledgeElement.element_id,
                    TopicKnowledgeElement.role,
                ),
                selectinload(TopicKnowledgeElement.element).options(
                    lazyload("*"),
                    load_only(
                        KnowledgeElement.id,
                        KnowledgeElement.competence_type,
                    ),
                ),
            ),
        ),
        selectinload(LearningTrajectoryTopic.elements).options(
            lazyload("*"),
            load_only(
                LearningTrajectoryElement.element_id,
                LearningTrajectoryElement.threshold,
            ),
            selectinload(LearningTrajectoryElement.element).options(
                lazyload("*"),
                load_only(
                    KnowledgeElement.id,
                    KnowledgeElement.competence_type,
                ),
            ),
        ),
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
            selectinload(LearningTrajectory.teacher).options(lazyload("*")),
        ),
        selectinload(LearningTrajectoryTask.trajectory_topic).options(
            lazyload("*"),
            selectinload(LearningTrajectoryTopic.topic).options(lazyload("*")),
        ),
        selectinload(LearningTrajectoryTask.primary_element).options(
            lazyload("*"),
            selectinload(KnowledgeElement.master_domain_objects).options(
                lazyload("*"),
                selectinload(MasterElementDomainObject.knowledge_element).options(lazyload("*")),
            ),
        ),
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
            selectinload(LearningTrajectoryTask.trajectory_topic).options(
                selectinload(LearningTrajectoryTopic.topic).options(
                    lazyload("*"),
                    selectinload(Topic.element_links).options(
                        lazyload("*"),
                        selectinload(TopicKnowledgeElement.element).options(lazyload("*")),
                    ),
                ),
                selectinload(LearningTrajectoryTopic.elements).options(
                    lazyload("*"),
                    selectinload(LearningTrajectoryElement.element).options(
                        lazyload("*")
                    ),
                ),
            )
        )
        options.append(
            selectinload(LearningTrajectoryTask.trajectory).options(
                _trajectory_unlock_options()
            )
        )
    return tuple(options)


def _task_selection_options(include_unlock_data: bool = False):
    options = [
        lazyload("*"),
        load_only(
            LearningTrajectoryTask.id,
            LearningTrajectoryTask.trajectory_id,
            LearningTrajectoryTask.trajectory_topic_id,
            LearningTrajectoryTask.primary_element_id,
            LearningTrajectoryTask.task_type,
            LearningTrajectoryTask.template_kind,
            LearningTrajectoryTask.content_json,
            LearningTrajectoryTask.difficulty,
            LearningTrajectoryTask.created_at,
        ),
        selectinload(LearningTrajectoryTask.primary_element).options(
            lazyload("*"),
            load_only(
                KnowledgeElement.id,
                KnowledgeElement.competence_type,
            ),
        ),
        selectinload(LearningTrajectoryTask.trajectory_topic).options(
            lazyload("*"),
            load_only(
                LearningTrajectoryTopic.id,
                LearningTrajectoryTopic.topic_id,
                LearningTrajectoryTopic.position,
                LearningTrajectoryTopic.threshold,
            ),
            selectinload(LearningTrajectoryTopic.topic).options(
                lazyload("*"),
                load_only(Topic.id, Topic.name),
                selectinload(Topic.element_links).options(
                    lazyload("*"),
                    load_only(
                        TopicKnowledgeElement.element_id,
                        TopicKnowledgeElement.role,
                    ),
                    selectinload(TopicKnowledgeElement.element).options(
                        lazyload("*"),
                        load_only(
                            KnowledgeElement.id,
                            KnowledgeElement.competence_type,
                        ),
                    ),
                ),
            ),
            selectinload(LearningTrajectoryTopic.elements).options(
                lazyload("*"),
                load_only(
                    LearningTrajectoryElement.element_id,
                    LearningTrajectoryElement.threshold,
                ),
                selectinload(LearningTrajectoryElement.element).options(
                    lazyload("*"),
                    load_only(
                        KnowledgeElement.id,
                        KnowledgeElement.competence_type,
                    ),
                ),
            ),
        ),
        selectinload(LearningTrajectoryTask.trajectory).options(
            lazyload("*"),
            load_only(
                LearningTrajectory.id,
                LearningTrajectory.name,
                LearningTrajectory.status,
                LearningTrajectory.discipline_id,
                LearningTrajectory.group_id,
                LearningTrajectory.subgroup_id,
            ),
        ),
    ]
    if include_unlock_data:
        options.append(
            selectinload(LearningTrajectoryTask.trajectory).options(
                _trajectory_unlock_options()
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
    for_selection_only: bool = False,
) -> list[LearningTrajectoryTask]:
    query = (
        select(LearningTrajectoryTask)
        .join(LearningTrajectory, LearningTrajectoryTask.trajectory_id == LearningTrajectory.id)
        .options(
            *(
                _task_selection_options(include_unlock_data)
                if for_selection_only
                else _task_read_options(include_unlock_data)
            )
        )
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


def _trajectory_element_thresholds(
    trajectory: LearningTrajectory,
) -> dict[UUID, int]:
    thresholds: dict[UUID, int] = {}
    for trajectory_topic in trajectory.topics:
        for trajectory_element in trajectory_topic.elements:
            current = thresholds.get(trajectory_element.element_id)
            if current is None or trajectory_element.threshold > current:
                thresholds[trajectory_element.element_id] = trajectory_element.threshold
    return thresholds


def _trajectory_topic_knowledge_complete(
    trajectory_topic: LearningTrajectoryTopic,
    mastery_by_element_id: dict[UUID, int],
) -> bool:
    know_elements = [
        trajectory_element
        for trajectory_element in trajectory_topic.elements
        if trajectory_element.element.competence_type == CompetenceType.KNOW
    ]
    if not know_elements:
        return True
    return all(
        mastery_by_element_id.get(trajectory_element.element_id, 0) >= trajectory_element.threshold
        for trajectory_element in know_elements
    )


def _trajectory_topic_skill_complete(
    trajectory_topic: LearningTrajectoryTopic,
    mastery_by_element_id: dict[UUID, int],
) -> bool:
    can_elements = [
        trajectory_element
        for trajectory_element in trajectory_topic.elements
        if trajectory_element.element.competence_type == CompetenceType.CAN
    ]
    if not can_elements:
        return True
    return all(
        mastery_by_element_id.get(trajectory_element.element_id, 0) >= trajectory_element.threshold
        for trajectory_element in can_elements
    )


def _trajectory_topic_is_unlocked(
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    mastery_by_element_id: dict[UUID, int],
) -> bool:
    required_links = [
        link
        for link in trajectory_topic.topic.element_links
        if link.role == TopicKnowledgeElementRole.REQUIRED
        and link.element.competence_type == CompetenceType.KNOW
    ]
    if required_links:
        thresholds = _trajectory_element_thresholds(trajectory)
        return all(
            thresholds.get(link.element_id) is not None
            and mastery_by_element_id.get(link.element_id, 0) >= thresholds[link.element_id]
            for link in required_links
        )
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


async def _load_element_mastery_map(
    student_id: UUID,
    discipline_id: UUID,
    element_ids: set[UUID],
    session: DbSession,
) -> dict[UUID, int]:
    if not element_ids:
        return {}

    result = await session.execute(
        select(
            StudentElementMastery.element_id,
            StudentElementMastery.mastery_value,
        ).where(
            StudentElementMastery.student_id == student_id,
            StudentElementMastery.discipline_id == discipline_id,
            StudentElementMastery.element_id.in_(element_ids),
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


async def _load_template_relations(
    element_ids: set[UUID],
    session: DbSession,
) -> list[KnowledgeElementRelation]:
    if len(element_ids) < 2:
        return []

    result = await session.execute(
        select(KnowledgeElementRelation)
        .options(
            lazyload("*"),
            selectinload(KnowledgeElementRelation.relation).options(
                lazyload("*")
            ),
        )
        .where(
            KnowledgeElementRelation.source_element_id.in_(element_ids),
            KnowledgeElementRelation.target_element_id.in_(element_ids),
        )
    )
    return list(result.scalars().all())


async def _validate_checked_relations(
    trajectory: LearningTrajectory,
    topic_id: UUID,
    primary_element_id: UUID,
    related_element_ids: list[UUID],
    checked_relation_ids: list[UUID],
    session: DbSession,
) -> list[KnowledgeElementRelation]:
    if len(checked_relation_ids) != len(set(checked_relation_ids)):
        raise bad_request("Проверяемые связи в одном задании не должны повторяться.")

    primary_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == primary_element_id)
    )
    primary_element = primary_result.scalar_one_or_none()
    if primary_element is None:
        raise bad_request("Ключевой элемент задания не найден.")

    if not checked_relation_ids and primary_element.competence_type not in {
        CompetenceType.CAN,
        CompetenceType.MASTER,
    }:
        return []

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

    if primary_element.competence_type == CompetenceType.CAN:
        mandatory_result = await session.execute(
            select(KnowledgeElementRelation)
            .options(
                selectinload(KnowledgeElementRelation.relation).options(lazyload("*")),
                selectinload(KnowledgeElementRelation.target_element).options(lazyload("*")),
            )
            .where(
                KnowledgeElementRelation.topic_id == topic_id,
                KnowledgeElementRelation.source_element_id == primary_element_id,
            )
        )
        mandatory_relation_ids = {
            relation.id
            for relation in mandatory_result.scalars().all()
            if relation.relation_type == KnowledgeElementRelationType.IMPLEMENTS
            and relation.target_element.competence_type == CompetenceType.KNOW
        }
        if not mandatory_relation_ids:
            raise bad_request(
                "У выбранного элемента «Уметь» нет обязательных связей «реализует» с элементами «Знать» этой темы."
            )
        if not mandatory_relation_ids.issubset(set(checked_relation_ids)):
            raise bad_request(
                "Для задания уровня «Уметь» нужно сохранить все обязательные связи «реализует» с элементами «Знать»."
            )
    elif primary_element.competence_type == CompetenceType.MASTER:
        mandatory_result = await session.execute(
            select(KnowledgeElementRelation)
            .options(
                selectinload(KnowledgeElementRelation.relation).options(lazyload("*")),
                selectinload(KnowledgeElementRelation.target_element).options(lazyload("*")),
            )
            .where(
                KnowledgeElementRelation.topic_id == topic_id,
                KnowledgeElementRelation.source_element_id == primary_element_id,
            )
        )
        mandatory_relations = list(mandatory_result.scalars().all())
        mandatory_automates_relation_ids = {
            relation.id
            for relation in mandatory_relations
            if relation.relation_type == KnowledgeElementRelationType.AUTOMATES
            and relation.target_element.competence_type == CompetenceType.CAN
        }
        mandatory_relies_on_relation_ids = {
            relation.id
            for relation in mandatory_relations
            if relation.relation_type == KnowledgeElementRelationType.RELIES_ON
            and relation.target_element.competence_type == CompetenceType.KNOW
        }
        if not mandatory_automates_relation_ids:
            raise bad_request(
                "У выбранного элемента «Владеть» нет обязательных связей «автоматизирует» с элементами «Уметь» этой темы."
            )
        if not mandatory_relies_on_relation_ids:
            raise bad_request(
                "У выбранного элемента «Владеть» нет обязательных связей «опирается на» с элементами «Знать» этой темы."
            )
        mandatory_relation_ids = {
            *mandatory_automates_relation_ids,
            *mandatory_relies_on_relation_ids,
        }
        if not mandatory_relation_ids.issubset(set(checked_relation_ids)):
            raise bad_request(
                "Для задания уровня «Владеть» нужно сохранить все обязательные связи «автоматизирует» и «опирается на» этой темы."
            )

    for relation in relations:
        if relation.topic_id != topic_id:
            raise bad_request("Проверяемая связь должна относиться к выбранной теме задания.")
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

        if primary_element.competence_type == CompetenceType.CAN:
            if relation.relation_type != KnowledgeElementRelationType.IMPLEMENTS:
                raise bad_request("Для заданий «Уметь» можно проверять только связи «реализует».")
            if primary_element_id not in {
                relation.source_element_id,
                relation.target_element_id,
            }:
                raise bad_request(
                    "Проверяемая связь задания «Уметь» должна быть связана с его ключевым элементом."
                )
            relation_competence_types = {
                relation.source_element.competence_type,
                relation.target_element.competence_type,
            }
            if relation_competence_types not in (
                {CompetenceType.CAN, CompetenceType.KNOW},
                {CompetenceType.CAN},
            ):
                raise bad_request(
                    "Для заданий «Уметь» допустимы только связи с элементами «Знать» или «Уметь»."
                )
            continue

        if primary_element.competence_type == CompetenceType.MASTER:
            if primary_element_id not in {
                relation.source_element_id,
                relation.target_element_id,
            }:
                raise bad_request(
                    "Проверяемая связь задания «Владеть» должна быть связана с его ключевым элементом."
                )
            other_element = (
                relation.target_element
                if relation.source_element_id == primary_element_id
                else relation.source_element
            )
            if relation.relation_type == KnowledgeElementRelationType.AUTOMATES:
                if (
                    relation.source_element_id != primary_element_id
                    or other_element.competence_type != CompetenceType.CAN
                ):
                    raise bad_request(
                        "Связь «автоматизирует» в задании «Владеть» должна идти от ключевого элемента к элементу «Уметь»."
                    )
                continue
            if relation.relation_type == KnowledgeElementRelationType.RELIES_ON:
                if (
                    relation.source_element_id != primary_element_id
                    or other_element.competence_type != CompetenceType.KNOW
                ):
                    raise bad_request(
                        "Связь «опирается на» в задании «Владеть» должна идти от ключевого элемента к элементу «Знать»."
                    )
                continue
            if other_element.competence_type != CompetenceType.MASTER:
                raise bad_request(
                    "Дополнительные проверяемые связи задания «Владеть» можно выбирать только с другими элементами «Владеть» этой темы."
                )
            if relation.relation_type == KnowledgeElementRelationType.IMPLEMENTS:
                raise bad_request(
                    "Связь «реализует» не поддерживается для заданий «Владеть»."
                )
            continue

        if relation.relation_type not in TASK_CHECKED_RELATIONS - {
            KnowledgeElementRelationType.IMPLEMENTS
        }:
            raise bad_request("Для заданий «Знать» выбрана неподдерживаемая проверяемая связь.")
        if (
            relation.source_element.competence_type != CompetenceType.KNOW
            or relation.target_element.competence_type != CompetenceType.KNOW
        ):
            raise bad_request("Проверяемые связи в заданиях «Знать» доступны только для элементов «Знать».")

    if primary_element.competence_type == CompetenceType.CAN:
        relation_related_element_ids = {
            relation.target_element_id
            if relation.source_element_id == primary_element_id
            else relation.source_element_id
            for relation in relations
        }
        if set(related_element_ids) != relation_related_element_ids:
            raise bad_request(
                "Связанные элементы задания «Уметь» должны совпадать с выбранными проверяемыми связями."
            )
    elif primary_element.competence_type == CompetenceType.MASTER:
        relation_related_element_ids = {
            relation.target_element_id
            if relation.source_element_id == primary_element_id
            else relation.source_element_id
            for relation in relations
        }
        if set(related_element_ids) != relation_related_element_ids:
            raise bad_request(
                "Связанные элементы задания «Владеть» должны совпадать с выбранными проверяемыми связями."
            )

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


async def _upsert_student_masteries(
    student: Student,
    discipline_id: UUID,
    scores_by_element_id: dict[UUID, int],
    session: DbSession,
) -> dict[UUID, int]:
    if not scores_by_element_id:
        return {}

    result = await session.execute(
        select(StudentElementMastery).where(
            StudentElementMastery.student_id == student.id,
            StudentElementMastery.discipline_id == discipline_id,
            StudentElementMastery.element_id.in_(set(scores_by_element_id)),
        )
    )
    mastery_by_element_id = {
        mastery.element_id: mastery
        for mastery in result.scalars().all()
    }
    now = datetime.utcnow()
    updated_values: dict[UUID, int] = {}

    for element_id, score in scores_by_element_id.items():
        mastery = mastery_by_element_id.get(element_id)
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
        mastery.updated_at = now
        updated_values[element_id] = mastery.mastery_value

    return updated_values


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
    normalized_payload = normalize_task_request_payload(trajectory, payload)
    template_relations = await _load_template_relations(
        {normalized_payload.primary_element_id, *normalized_payload.related_element_ids},
        session,
    )
    normalized_content = validate_task_payload(
        trajectory,
        normalized_payload,
        template_relations=template_relations,
    )
    checked_relations = await _validate_checked_relations(
        trajectory=trajectory,
        topic_id=normalized_payload.topic_id,
        primary_element_id=normalized_payload.primary_element_id,
        related_element_ids=normalized_payload.related_element_ids,
        checked_relation_ids=normalized_payload.checked_relation_ids,
        session=session,
    )

    trajectory_topic = next(
        topic for topic in trajectory.topics if topic.topic_id == normalized_payload.topic_id
    )
    task = LearningTrajectoryTask(
        trajectory_id=trajectory.id,
        trajectory_topic_id=trajectory_topic.id,
        primary_element_id=normalized_payload.primary_element_id,
        task_type=normalized_payload.task_type,
        template_kind=normalized_payload.template_kind,
        title=normalized_payload.title.strip(),
        prompt=normalized_payload.prompt.strip(),
        content_json=dump_task_content(normalized_content),
        difficulty=normalized_payload.difficulty,
        expected_duration_seconds=normalized_payload.expected_duration_seconds,
    )
    session.add(task)
    await flush_or_409(session)

    for related_element_id in normalized_payload.related_element_ids:
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
    normalized_payload = normalize_task_request_payload(
        trajectory,
        LearningTrajectoryTaskCreate(**payload.model_dump()),
    )
    template_relations = await _load_template_relations(
        {normalized_payload.primary_element_id, *normalized_payload.related_element_ids},
        session,
    )
    normalized_content = validate_task_payload(
        trajectory,
        normalized_payload,
        template_relations=template_relations,
    )
    checked_relations = await _validate_checked_relations(
        trajectory=trajectory,
        topic_id=normalized_payload.topic_id,
        primary_element_id=normalized_payload.primary_element_id,
        related_element_ids=normalized_payload.related_element_ids,
        checked_relation_ids=normalized_payload.checked_relation_ids,
        session=session,
    )

    trajectory_topic = next(
        topic for topic in trajectory.topics if topic.topic_id == normalized_payload.topic_id
    )
    task.trajectory_topic_id = trajectory_topic.id
    task.primary_element_id = normalized_payload.primary_element_id
    task.task_type = normalized_payload.task_type
    task.template_kind = normalized_payload.template_kind
    task.title = normalized_payload.title.strip()
    task.prompt = normalized_payload.prompt.strip()
    task.content_json = dump_task_content(normalized_content)
    task.difficulty = normalized_payload.difficulty
    task.expected_duration_seconds = normalized_payload.expected_duration_seconds
    task.updated_at = datetime.utcnow()

    for related_element in list(task.related_elements):
        await session.delete(related_element)
    for checked_relation in list(task.checked_relations):
        await session.delete(checked_relation)
    await flush_or_409(session)

    for related_element_id in normalized_payload.related_element_ids:
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
        for_selection_only=True,
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

    unlocked_tasks = [
        task
        for task in tasks
        if _topic_is_unlocked(task, mastery_by_element_id)
    ]
    pool = build_adaptive_candidate_pool(
        unlocked_tasks,
        mastery_by_element_id,
        progress_by_task_id,
        outgoing_by_source,
    )
    if not pool:
        pool = build_adaptive_candidate_pool(
            unlocked_tasks,
            mastery_by_element_id,
            progress_by_task_id,
            outgoing_by_source,
            ignore_stage_gate=True,
        )
    if not pool:
        pool = build_adaptive_candidate_pool(
            unlocked_tasks,
            mastery_by_element_id,
            progress_by_task_id,
            outgoing_by_source,
            ignore_stage_gate=True,
            ignore_prerequisites=True,
        )
    selected = select_next_task(pool, mastery_by_element_id, degree_by_element_id)
    if selected is None:
        return None

    task, progress, recommendation_score = selected
    instance = await _get_or_create_task_instance(student, task, session)
    await commit_or_409(session)
    selected_task = await _get_task_for_read(task.id, session)
    content_snapshot = parse_task_content_json(instance.content_snapshot_json)
    return build_student_task_read(
        task=selected_task,
        discipline_name=selected_task.trajectory.discipline.name,
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
    if (
        task.task_type == LearningTrajectoryTaskType.TEXT
        and task.primary_element.competence_type == CompetenceType.MASTER
        and bool(content_snapshot.get("manual_review"))
    ):
        raise bad_request(
            "Для заданий уровня «Владеть» отправка ответа выполняется через загрузку файла."
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
            attempts_count=0,
            status=StudentTaskProgressStatus.NOT_STARTED,
        )
        session.add(progress)

    score, normalized_answer_payload, feedback = evaluate_task_answer(
        task,
        payload.answer_payload,
        content_snapshot=content_snapshot,
    )
    feedback = enrich_feedback_for_adaptive_control(
        task,
        normalized_answer_payload,
        feedback,
        score=score,
        duration_seconds=payload.duration_seconds,
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

    if task.primary_element.competence_type == CompetenceType.CAN:
        scores_by_element_id = {task.primary_element_id: score}
        if score < 60:
            scores_by_element_id.update(
                {
                    related.element_id: 0
                    for related in task.related_elements
                }
            )
        await _upsert_student_masteries(
            student=student,
            discipline_id=task.trajectory.discipline_id,
            scores_by_element_id=scores_by_element_id,
            session=session,
        )
    else:
        await _upsert_student_masteries(
            student=student,
            discipline_id=task.trajectory.discipline_id,
            scores_by_element_id={
                task.primary_element_id: score,
                **{
                    related.element_id: score
                    for related in task.related_elements
                },
            },
            session=session,
        )

    await commit_or_409(session)

    mastery_by_element_id = await _load_element_mastery_map(
        student.id,
        task.trajectory.discipline_id,
        {
            task.primary_element_id,
            *[related.element_id for related in task.related_elements],
        },
        session,
    )
    return build_student_task_read(
        task=task,
        discipline_name=task.trajectory.discipline.name,
        mastery_by_element_id=mastery_by_element_id,
        progress=progress,
    )


@router.post(
    "/{task_id}/students/{student_id}/file-submission",
    response_model=StudentAssignedTaskRead,
)
async def submit_student_task_file(
    task_id: UUID,
    student_id: UUID,
    session: DbSession,
    file: UploadFile = File(...),
    task_instance_id: UUID | None = Form(default=None),
    duration_seconds: int | None = Form(default=None),
) -> StudentAssignedTaskRead:
    student = await _get_student_for_tasks(student_id, session)
    task = await _get_task_for_read(task_id, session)
    if not _student_can_access_task(student, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Задание не назначено этому студенту.",
        )

    content = parse_task_content_json(task.content_json)
    if (
        task.task_type != LearningTrajectoryTaskType.TEXT
        or task.primary_element.competence_type != CompetenceType.MASTER
        or not bool(content.get("manual_review"))
    ):
        raise bad_request("Загрузка файла поддерживается только для ручных заданий уровня «Владеть».")

    if task_instance_id is not None:
        instance_result = await session.execute(
            select(StudentTaskInstance)
            .options(lazyload("*"))
            .where(StudentTaskInstance.id == task_instance_id)
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

    file_bytes = await file.read()
    if not file_bytes:
        raise bad_request("Файл решения пустой.")

    safe_name = _safe_uploaded_filename(file.filename)
    try:
        answer_payload = await upload_student_submission(
            task_id=task.id,
            student_id=student.id,
            original_name=safe_name,
            file_bytes=file_bytes,
            content_type=file.content_type or "application/octet-stream",
        )
    except ObjectStorageError as exc:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=str(exc),
        ) from exc
    feedback = _manual_review_feedback(
        "Файл отправлен и ожидает проверки преподавателем.",
        pending_review=True,
    )
    if duration_seconds is not None:
        feedback["duration_seconds"] = duration_seconds
    answered_at = datetime.utcnow()
    instance.answered_at = answered_at

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

    session.add(
        StudentTaskAttempt(
            instance_id=instance.id,
            student_id=student.id,
            task_id=task.id,
            answer_payload_json=dump_task_content(answer_payload),
            feedback_json=dump_task_content(feedback),
            score=0,
            duration_seconds=duration_seconds,
            answered_at=answered_at,
        )
    )

    progress.attempts_count = (progress.attempts_count or 0) + 1
    progress.last_answered_at = answered_at
    progress.last_answer_payload = dump_task_content(answer_payload)
    progress.last_feedback_json = dump_task_content(feedback)
    progress.last_score = None
    progress.status = StudentTaskProgressStatus.PENDING_REVIEW
    progress.completed_at = None

    await commit_or_409(session)

    mastery_by_element_id = await _load_element_mastery_map(
        student.id,
        task.trajectory.discipline_id,
        {
            task.primary_element_id,
            *[related.element_id for related in task.related_elements],
        },
        session,
    )
    return build_student_task_read(
        task=task,
        discipline_name=task.trajectory.discipline.name,
        mastery_by_element_id=mastery_by_element_id,
        progress=progress,
    )


@router.put(
    "/{task_id}/students/{student_id}/teacher-review",
    response_model=StudentAssignedTaskRead,
)
async def review_student_task_submission(
    task_id: UUID,
    student_id: UUID,
    payload: StudentTaskManualReviewUpdate,
    session: DbSession,
    x_session_id: str | None = Header(default=None),
) -> StudentAssignedTaskRead:
    student = await _get_student_for_tasks(student_id, session)
    task = await _get_task_for_read(task_id, session)
    await _require_teacher_review_access(session, task=task, x_session_id=x_session_id)
    if not _student_can_access_task(student, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Задание не назначено этому студенту.",
        )

    progress_result = await session.execute(
        select(StudentTaskProgress).where(
            StudentTaskProgress.student_id == student.id,
            StudentTaskProgress.task_id == task.id,
        )
    )
    progress = progress_result.scalar_one_or_none()
    if progress is None or not progress.last_answer_payload:
        raise bad_request("У студента нет отправленного файла для проверки.")

    submitted_file = _extract_submitted_file(parse_task_content_json(progress.last_answer_payload))
    if submitted_file is None:
        raise bad_request("Последняя отправка студента не содержит файла для проверки.")

    attempt_result = await session.execute(
        select(StudentTaskAttempt)
        .options(lazyload("*"))
        .where(
            StudentTaskAttempt.student_id == student.id,
            StudentTaskAttempt.task_id == task.id,
        )
        .order_by(StudentTaskAttempt.answered_at.desc())
    )
    attempts = list(attempt_result.scalars().all())
    latest_attempt = next(
        (
            attempt
            for attempt in attempts
            if _extract_submitted_file(parse_task_content_json(attempt.answer_payload_json)) is not None
        ),
        None,
    )
    if latest_attempt is None:
        raise bad_request("Не найдена последняя попытка с загруженным файлом.")

    reviewed_at = datetime.utcnow()
    feedback = _manual_review_feedback(
        "Проверка преподавателем завершена.",
        pending_review=False,
        reviewed=True,
        review_comment=payload.review_comment.strip(),
        reviewed_at=reviewed_at.isoformat(),
        score=payload.score,
    )
    latest_attempt.score = payload.score
    latest_attempt.feedback_json = dump_task_content(feedback)
    progress.last_score = payload.score
    progress.best_score = max(progress.best_score or 0, payload.score)
    progress.last_feedback_json = dump_task_content(feedback)
    progress.status = (
        StudentTaskProgressStatus.COMPLETED
        if payload.score >= 60
        else StudentTaskProgressStatus.IN_PROGRESS
    )
    progress.completed_at = reviewed_at if progress.status == StudentTaskProgressStatus.COMPLETED else None

    await _upsert_student_masteries(
        student=student,
        discipline_id=task.trajectory.discipline_id,
        scores_by_element_id={
            task.primary_element_id: payload.score,
            **{
                related.element_id: payload.score
                for related in task.related_elements
            },
        },
        session=session,
    )

    await commit_or_409(session)

    mastery_by_element_id = await _load_element_mastery_map(
        student.id,
        task.trajectory.discipline_id,
        {
            task.primary_element_id,
            *[related.element_id for related in task.related_elements],
        },
        session,
    )
    return build_student_task_read(
        task=task,
        discipline_name=task.trajectory.discipline.name,
        mastery_by_element_id=mastery_by_element_id,
        progress=progress,
    )


@router.get("/{task_id}/students/{student_id}/submission-file")
async def download_student_task_submission_file(
    task_id: UUID,
    student_id: UUID,
    session: DbSession,
    x_session_id: str | None = Header(default=None),
):
    student = await _get_student_for_tasks(student_id, session)
    task = await _get_task_for_read(task_id, session)
    await _require_teacher_review_access(session, task=task, x_session_id=x_session_id)
    if not _student_can_access_task(student, task):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Задание не назначено этому студенту.",
        )

    progress_result = await session.execute(
        select(StudentTaskProgress).where(
            StudentTaskProgress.student_id == student.id,
            StudentTaskProgress.task_id == task.id,
        )
    )
    progress = progress_result.scalar_one_or_none()
    if progress is None or not progress.last_answer_payload:
        raise not_found("Student task submission file", task_id)

    submitted_file = _extract_submitted_file(parse_task_content_json(progress.last_answer_payload))
    if submitted_file is None:
        raise not_found("Student task submission file", task_id)

    if submitted_file.get("object_key") and submitted_file.get("bucket_name"):
        try:
            file_bytes = await download_student_submission(
                bucket_name=str(submitted_file["bucket_name"]),
                object_key=str(submitted_file["object_key"]),
            )
        except FileNotFoundError as exc:
            raise not_found("Student task submission file", task_id) from exc
        except ObjectStorageError as exc:
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail=str(exc),
            ) from exc
        quoted_name = quote(str(submitted_file["original_name"]))
        safe_download_name = _safe_uploaded_filename(str(submitted_file["original_name"]))
        return Response(
            content=file_bytes,
            media_type=str(submitted_file["mime_type"] or "application/octet-stream"),
            headers={
                "Content-Disposition": (
                    f"attachment; filename=\"{safe_download_name}\"; "
                    f"filename*=UTF-8''{quoted_name}"
                )
            },
        )

    uploads_root = LEGACY_UPLOAD_ROOT.parent.resolve()
    file_path = (uploads_root / str(submitted_file.get("stored_path", ""))).resolve()
    if uploads_root not in file_path.parents:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Путь к файлу ответа поврежден.",
        )
    if not file_path.exists() or not file_path.is_file():
        raise not_found("Student task submission file", task_id)

    return FileResponse(
        path=file_path,
        filename=str(submitted_file["original_name"]),
        media_type=str(submitted_file["mime_type"] or "application/octet-stream"),
    )
