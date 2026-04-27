import json
import random
import re
from collections import defaultdict
from typing import Any
from uuid import UUID

from fastapi import HTTPException, status

from app.models import (
    KnowledgeElement,
    KnowledgeElementRelation,
    LearningTrajectory,
    LearningTrajectoryTask,
    StudentTaskProgress,
)
from app.models.enums import (
    CompetenceType,
    KnowledgeElementRelationType,
    LearningTrajectoryTaskType,
    StudentTaskProgressStatus,
)
from app.schemas import (
    LearningTrajectoryTaskCreate,
    LearningTrajectoryTaskElementRead,
    LearningTrajectoryTaskRead,
    StudentAssignedTaskRead,
    StudentTaskElementStateRead,
    StudentTaskProgressRead,
)


TASK_PREREQUISITE_RELATIONS = {
    KnowledgeElementRelationType.REQUIRES,
    KnowledgeElementRelationType.BUILDS_ON,
}


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def ensure_task_write_allowed(trajectory: LearningTrajectory) -> None:
    if trajectory.status.value == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Archived trajectories are read-only for manual tasks.",
        )


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def parse_task_content_json(raw_content: str) -> dict[str, Any]:
    if not raw_content.strip():
        return {}
    parsed = json.loads(raw_content)
    if not isinstance(parsed, dict):
        raise bad_request("Stored task content must be a JSON object.")
    return parsed


def dump_task_content(content: dict[str, Any]) -> str:
    return json.dumps(content, ensure_ascii=False)


def _validate_choice_content(
    content: dict[str, Any],
    task_type: LearningTrajectoryTaskType,
) -> dict[str, Any]:
    raw_options = content.get("options")
    if not isinstance(raw_options, list) or len(raw_options) < 2:
        raise bad_request("Choice task must contain at least two options.")

    normalized_options: list[dict[str, Any]] = []
    option_ids: set[str] = set()
    correct_count = 0

    for raw_option in raw_options:
        if not isinstance(raw_option, dict):
            raise bad_request("Each task option must be an object.")
        option_id = str(raw_option.get("id", "")).strip()
        option_text = str(raw_option.get("text", "")).strip()
        is_correct = bool(raw_option.get("is_correct"))

        if not option_id:
            raise bad_request("Each task option must have a non-empty id.")
        if option_id in option_ids:
            raise bad_request("Task option ids must be unique.")
        if not option_text:
            raise bad_request("Each task option must have non-empty text.")

        option_ids.add(option_id)
        correct_count += 1 if is_correct else 0
        normalized_options.append(
            {
                "id": option_id,
                "text": option_text,
                "is_correct": is_correct,
            }
        )

    if task_type == LearningTrajectoryTaskType.SINGLE_CHOICE and correct_count != 1:
        raise bad_request("Single choice task must have exactly one correct option.")
    if task_type == LearningTrajectoryTaskType.MULTIPLE_CHOICE and correct_count < 1:
        raise bad_request("Multiple choice task must have at least one correct option.")

    return {"options": normalized_options}


def _validate_matching_content(content: dict[str, Any]) -> dict[str, Any]:
    raw_pairs = content.get("pairs")
    if not isinstance(raw_pairs, list) or len(raw_pairs) < 2:
        raise bad_request("Matching task must contain at least two pairs.")

    normalized_pairs: list[dict[str, str]] = []
    pair_ids: set[str] = set()
    for raw_pair in raw_pairs:
        if not isinstance(raw_pair, dict):
            raise bad_request("Each matching pair must be an object.")
        pair_id = str(raw_pair.get("id", "")).strip()
        left = str(raw_pair.get("left", "")).strip()
        right = str(raw_pair.get("right", "")).strip()

        if not pair_id:
            raise bad_request("Each matching pair must have a non-empty id.")
        if pair_id in pair_ids:
            raise bad_request("Matching pair ids must be unique.")
        if not left or not right:
            raise bad_request("Matching pair must contain both left and right texts.")

        pair_ids.add(pair_id)
        normalized_pairs.append({"id": pair_id, "left": left, "right": right})

    return {"pairs": normalized_pairs}


def _validate_text_content(content: dict[str, Any]) -> dict[str, Any]:
    raw_answers = content.get("accepted_answers")
    if not isinstance(raw_answers, list) or not raw_answers:
        raise bad_request("Text task must contain at least one accepted answer.")

    normalized_answers: list[str] = []
    seen_answers: set[str] = set()
    for raw_answer in raw_answers:
        answer = str(raw_answer).strip()
        normalized = _normalize_text(answer)
        if not answer:
            raise bad_request("Accepted answer must not be empty.")
        if normalized in seen_answers:
            continue
        seen_answers.add(normalized)
        normalized_answers.append(answer)

    if not normalized_answers:
        raise bad_request("Text task must contain at least one accepted answer.")

    placeholder = str(content.get("placeholder", "")).strip()
    return {
        "accepted_answers": normalized_answers,
        "placeholder": placeholder,
    }


def normalize_task_content(
    task_type: LearningTrajectoryTaskType,
    content: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(content, dict):
        raise bad_request("Task content must be a JSON object.")

    if task_type in {
        LearningTrajectoryTaskType.SINGLE_CHOICE,
        LearningTrajectoryTaskType.MULTIPLE_CHOICE,
    }:
        return _validate_choice_content(content, task_type)
    if task_type == LearningTrajectoryTaskType.MATCHING:
        return _validate_matching_content(content)
    if task_type == LearningTrajectoryTaskType.TEXT:
        return _validate_text_content(content)

    raise bad_request("Unsupported task type.")


def validate_manual_task_payload(
    trajectory: LearningTrajectory,
    payload: LearningTrajectoryTaskCreate,
) -> dict[str, Any]:
    ensure_task_write_allowed(trajectory)

    trajectory_topic = next(
        (item for item in trajectory.topics if item.topic_id == payload.topic_id),
        None,
    )
    if trajectory_topic is None:
        raise bad_request("Task topic must belong to the selected learning trajectory.")

    primary_element = next(
        (
            item.element
            for item in trajectory_topic.elements
            if item.element_id == payload.primary_element_id
        ),
        None,
    )
    if primary_element is None:
        raise bad_request(
            "Primary checked element must be selected in the trajectory for this topic."
        )
    if primary_element.competence_type != CompetenceType.KNOW:
        raise bad_request("Manual tasks are currently available only for competence 'know'.")

    allowed_related_elements: dict[UUID, KnowledgeElement] = {}
    for trajectory_topic_item in trajectory.topics:
        for trajectory_element in trajectory_topic_item.elements:
            element = trajectory_element.element
            if element.competence_type == CompetenceType.KNOW:
                allowed_related_elements[element.id] = element

    if payload.primary_element_id in payload.related_element_ids:
        raise bad_request("Primary checked element should not be duplicated among related ones.")

    if len(payload.related_element_ids) != len(set(payload.related_element_ids)):
        raise bad_request("Related elements in one task must be unique.")

    for related_element_id in payload.related_element_ids:
        if related_element_id not in allowed_related_elements:
            raise bad_request(
                "Related elements must belong to the saved trajectory and use competence 'know'."
            )

    return normalize_task_content(payload.task_type, payload.content)


def merge_mastery_value(current_value: int | None, score: int) -> int:
    if current_value is None:
        return score
    return round((current_value + score) / 2)


def build_teacher_task_content(task: LearningTrajectoryTask) -> dict[str, Any]:
    return parse_task_content_json(task.content_json)


def build_student_task_content(task: LearningTrajectoryTask) -> dict[str, Any]:
    content = parse_task_content_json(task.content_json)

    if task.task_type in {
        LearningTrajectoryTaskType.SINGLE_CHOICE,
        LearningTrajectoryTaskType.MULTIPLE_CHOICE,
    }:
        return {
            "options": [
                {
                    "id": option["id"],
                    "text": option["text"],
                }
                for option in content.get("options", [])
            ]
        }

    if task.task_type == LearningTrajectoryTaskType.MATCHING:
        pairs = content.get("pairs", [])
        right_items = [
            {"id": pair["id"], "text": pair["right"]}
            for pair in pairs
        ]
        random.Random(str(task.id)).shuffle(right_items)
        return {
            "left_items": [
                {"id": pair["id"], "text": pair["left"]}
                for pair in pairs
            ],
            "right_items": right_items,
        }

    if task.task_type == LearningTrajectoryTaskType.TEXT:
        return {
            "placeholder": content.get("placeholder", ""),
        }

    return {}


def build_task_read(task: LearningTrajectoryTask) -> LearningTrajectoryTaskRead:
    return LearningTrajectoryTaskRead(
        id=task.id,
        trajectory_id=task.trajectory_id,
        trajectory_topic_id=task.trajectory_topic_id,
        topic_id=task.trajectory_topic.topic_id,
        topic_name=task.trajectory_topic.topic.name,
        prompt=task.prompt,
        difficulty=task.difficulty,
        task_type=task.task_type,
        content=build_teacher_task_content(task),
        created_at=task.created_at,
        updated_at=task.updated_at,
        primary_element=LearningTrajectoryTaskElementRead(
            element_id=task.primary_element.id,
            name=task.primary_element.name,
        ),
        related_elements=[
            LearningTrajectoryTaskElementRead(
                element_id=link.element.id,
                name=link.element.name,
            )
            for link in task.related_elements
        ],
    )


def build_student_progress_read(progress: StudentTaskProgress | None) -> StudentTaskProgressRead:
    if progress is None:
        return StudentTaskProgressRead(
            status=StudentTaskProgressStatus.NOT_STARTED,
            attempts_count=0,
            last_score=None,
            best_score=None,
            completed_at=None,
            last_answer_payload=None,
        )

    last_answer_payload = None
    if progress.last_answer_payload:
        try:
            parsed = json.loads(progress.last_answer_payload)
            if isinstance(parsed, dict):
                last_answer_payload = parsed
        except json.JSONDecodeError:
            last_answer_payload = None

    return StudentTaskProgressRead(
        status=progress.status,
        attempts_count=progress.attempts_count,
        last_score=progress.last_score,
        best_score=progress.best_score,
        completed_at=progress.completed_at,
        last_answer_payload=last_answer_payload,
    )


def build_student_task_read(
    task: LearningTrajectoryTask,
    discipline_name: str,
    mastery_by_element_id: dict[UUID, int],
    progress: StudentTaskProgress | None,
    recommendation_score: float | None = None,
) -> StudentAssignedTaskRead:
    return StudentAssignedTaskRead(
        id=task.id,
        trajectory_id=task.trajectory_id,
        trajectory_name=task.trajectory.name,
        discipline_id=task.trajectory.discipline_id,
        discipline_name=discipline_name,
        topic_id=task.trajectory_topic.topic_id,
        topic_name=task.trajectory_topic.topic.name,
        prompt=task.prompt,
        difficulty=task.difficulty,
        task_type=task.task_type,
        content=build_student_task_content(task),
        primary_element=StudentTaskElementStateRead(
            element_id=task.primary_element.id,
            name=task.primary_element.name,
            mastery_value=mastery_by_element_id.get(task.primary_element.id, 0),
        ),
        related_elements=[
            StudentTaskElementStateRead(
                element_id=link.element.id,
                name=link.element.name,
                mastery_value=mastery_by_element_id.get(link.element.id, 0),
            )
            for link in task.related_elements
        ],
        progress=build_student_progress_read(progress),
        recommendation_score=recommendation_score,
    )


def build_relation_maps(
    relations: list[KnowledgeElementRelation],
) -> tuple[dict[UUID, list[KnowledgeElementRelation]], dict[UUID, int]]:
    outgoing_by_source: dict[UUID, list[KnowledgeElementRelation]] = defaultdict(list)
    degree_by_element_id: dict[UUID, int] = defaultdict(int)

    for relation in relations:
        outgoing_by_source[relation.source_element_id].append(relation)
        degree_by_element_id[relation.source_element_id] += 1
        degree_by_element_id[relation.target_element_id] += 1

    return outgoing_by_source, degree_by_element_id


def prerequisites_ready(
    task: LearningTrajectoryTask,
    mastery_by_element_id: dict[UUID, int],
    outgoing_by_source: dict[UUID, list[KnowledgeElementRelation]],
    threshold: int = 40,
) -> bool:
    for relation in outgoing_by_source.get(task.primary_element_id, []):
        if relation.relation_type not in TASK_PREREQUISITE_RELATIONS:
            continue
        if mastery_by_element_id.get(relation.target_element_id, 0) < threshold:
            return False
    return True


def graph_importance(
    element_id: UUID,
    degree_by_element_id: dict[UUID, int],
) -> float:
    return min(degree_by_element_id.get(element_id, 0) / 6, 1.0)


def difficulty_fit(task: LearningTrajectoryTask, mastery_value: int) -> float:
    distance = abs(task.difficulty - mastery_value)
    return max(0.0, 1 - distance / 100)


def low_mastery_score(mastery_value: int) -> float:
    return (100 - mastery_value) / 100


def task_priority(
    task: LearningTrajectoryTask,
    mastery_by_element_id: dict[UUID, int],
    degree_by_element_id: dict[UUID, int],
    progress: StudentTaskProgress | None,
) -> float:
    mastery_value = mastery_by_element_id.get(task.primary_element_id, 0)
    completion_penalty = 0.0
    if progress is not None and progress.status == StudentTaskProgressStatus.COMPLETED:
        completion_penalty = 0.15

    return max(
        0.0,
        (
            0.45 * low_mastery_score(mastery_value)
            + 0.25 * graph_importance(task.primary_element_id, degree_by_element_id)
            + 0.20 * difficulty_fit(task, mastery_value)
            + 0.10 * (1.0 if progress is None else max(0.2, 1 - progress.attempts_count * 0.2))
        )
        - completion_penalty,
    )


def _score_single_choice(content: dict[str, Any], answer_payload: dict[str, Any]) -> int:
    selected_ids = answer_payload.get("selected_option_ids")
    if not isinstance(selected_ids, list):
        raise bad_request("Single choice answer must contain selected_option_ids.")
    selected_set = {str(item).strip() for item in selected_ids if str(item).strip()}
    if len(selected_set) != 1:
        return 0

    correct_option = next(
        (option for option in content.get("options", []) if option.get("is_correct")),
        None,
    )
    if correct_option is None:
        raise bad_request("Task does not define a correct option.")
    return 100 if correct_option["id"] in selected_set else 0


def _score_multiple_choice(content: dict[str, Any], answer_payload: dict[str, Any]) -> int:
    selected_ids = answer_payload.get("selected_option_ids")
    if not isinstance(selected_ids, list):
        raise bad_request("Multiple choice answer must contain selected_option_ids.")

    selected_set = {str(item).strip() for item in selected_ids if str(item).strip()}
    correct_set = {
        option["id"]
        for option in content.get("options", [])
        if option.get("is_correct")
    }
    if not correct_set:
        raise bad_request("Task does not define correct options.")

    correct_matches = len(selected_set & correct_set)
    wrong_matches = len(selected_set - correct_set)
    score = max(0.0, (correct_matches - wrong_matches) / len(correct_set))
    return round(score * 100)


def _score_matching(content: dict[str, Any], answer_payload: dict[str, Any]) -> int:
    pairings = answer_payload.get("pairings")
    if not isinstance(pairings, list):
        raise bad_request("Matching answer must contain pairings.")

    submitted_mapping: dict[str, str] = {}
    for pairing in pairings:
        if not isinstance(pairing, dict):
            raise bad_request("Each pairing must be an object.")
        left_id = str(pairing.get("left_id", "")).strip()
        right_id = str(pairing.get("right_id", "")).strip()
        if left_id and right_id:
            submitted_mapping[left_id] = right_id

    pairs = content.get("pairs", [])
    if not pairs:
        raise bad_request("Task does not define matching pairs.")

    correct_matches = sum(
        1
        for pair in pairs
        if submitted_mapping.get(pair["id"]) == pair["id"]
    )
    return round(correct_matches / len(pairs) * 100)


def _score_text(content: dict[str, Any], answer_payload: dict[str, Any]) -> int:
    submitted_text = str(answer_payload.get("text", "")).strip()
    if not submitted_text:
        return 0

    normalized_submitted = _normalize_text(submitted_text)
    accepted_answers = {
        _normalize_text(answer)
        for answer in content.get("accepted_answers", [])
    }
    return 100 if normalized_submitted in accepted_answers else 0


def evaluate_task_answer(
    task: LearningTrajectoryTask,
    answer_payload: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    if not isinstance(answer_payload, dict):
        raise bad_request("Task answer must be a JSON object.")

    content = parse_task_content_json(task.content_json)
    if task.task_type == LearningTrajectoryTaskType.SINGLE_CHOICE:
        return _score_single_choice(content, answer_payload), answer_payload
    if task.task_type == LearningTrajectoryTaskType.MULTIPLE_CHOICE:
        return _score_multiple_choice(content, answer_payload), answer_payload
    if task.task_type == LearningTrajectoryTaskType.MATCHING:
        return _score_matching(content, answer_payload), answer_payload
    if task.task_type == LearningTrajectoryTaskType.TEXT:
        return _score_text(content, answer_payload), answer_payload

    raise bad_request("Unsupported task type.")
