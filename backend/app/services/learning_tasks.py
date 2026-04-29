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
    LearningTrajectoryTaskTemplateKind,
    LearningTrajectoryTaskType,
    StudentTaskProgressStatus,
)
from app.schemas import (
    LearningTrajectoryTaskCreate,
    LearningTrajectoryTaskElementRead,
    LearningTrajectoryTaskRead,
    LearningTrajectoryTaskRelationRead,
    StudentAssignedTaskRead,
    StudentTaskElementStateRead,
    StudentTaskProgressRead,
)


TASK_PREREQUISITE_RELATIONS = {
    KnowledgeElementRelationType.REQUIRES,
    KnowledgeElementRelationType.BUILDS_ON,
}

TASK_CHECKED_RELATIONS = {
    KnowledgeElementRelationType.REQUIRES,
    KnowledgeElementRelationType.CONTAINS,
    KnowledgeElementRelationType.PART_OF,
    KnowledgeElementRelationType.PROPERTY_OF,
    KnowledgeElementRelationType.REFINES,
    KnowledgeElementRelationType.GENERALIZES,
    KnowledgeElementRelationType.SIMILAR,
    KnowledgeElementRelationType.CONTRASTS_WITH,
    KnowledgeElementRelationType.USED_WITH,
    KnowledgeElementRelationType.BUILDS_ON,
}

ACTIVE_TASK_TEMPLATE_KINDS = {
    LearningTrajectoryTaskTemplateKind.DEFINITION_CHOICE,
    LearningTrajectoryTaskTemplateKind.TERM_CHOICE,
    LearningTrajectoryTaskTemplateKind.PROPERTY_MULTIPLE,
    LearningTrajectoryTaskTemplateKind.CONTAINS_MULTIPLE,
    LearningTrajectoryTaskTemplateKind.MATCHING_DEFINITION,
    LearningTrajectoryTaskTemplateKind.MANUAL,
}

FIXED_TASK_TYPE_BY_TEMPLATE: dict[
    LearningTrajectoryTaskTemplateKind,
    LearningTrajectoryTaskType | None,
] = {
    LearningTrajectoryTaskTemplateKind.DEFINITION_CHOICE: LearningTrajectoryTaskType.SINGLE_CHOICE,
    LearningTrajectoryTaskTemplateKind.TERM_CHOICE: LearningTrajectoryTaskType.SINGLE_CHOICE,
    LearningTrajectoryTaskTemplateKind.PROPERTY_MULTIPLE: LearningTrajectoryTaskType.MULTIPLE_CHOICE,
    LearningTrajectoryTaskTemplateKind.CONTAINS_MULTIPLE: LearningTrajectoryTaskType.MULTIPLE_CHOICE,
    LearningTrajectoryTaskTemplateKind.MATCHING_DEFINITION: LearningTrajectoryTaskType.MATCHING,
    LearningTrajectoryTaskTemplateKind.MANUAL: None,
    LearningTrajectoryTaskTemplateKind.RELATION_CHOICE: LearningTrajectoryTaskType.SINGLE_CHOICE,
    LearningTrajectoryTaskTemplateKind.REQUIRES_ORDERING: LearningTrajectoryTaskType.ORDERING,
    LearningTrajectoryTaskTemplateKind.CONTRAST_CHOICE: LearningTrajectoryTaskType.SINGLE_CHOICE,
    LearningTrajectoryTaskTemplateKind.TEXT_DEFINITION: LearningTrajectoryTaskType.TEXT,
}

MANUAL_ALLOWED_TASK_TYPES = {
    LearningTrajectoryTaskType.SINGLE_CHOICE,
    LearningTrajectoryTaskType.MULTIPLE_CHOICE,
    LearningTrajectoryTaskType.MATCHING,
}

DEFAULT_ELEMENT_TARGET_MASTERY = 70
BASIC_TASK_MAX_DIFFICULTY = 40
ADVANCED_UNLOCK_MASTERY = 55
MASTERY_UPDATE_FACTOR = 0.45
SUCCESS_SCORE_THRESHOLD = 60


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def ensure_task_write_allowed(trajectory: LearningTrajectory) -> None:
    if trajectory.status.value == "archived":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Архивная траектория доступна только для чтения: задания в ней менять нельзя.",
        )


def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def parse_task_content_json(raw_content: str) -> dict[str, Any]:
    if not raw_content.strip():
        return {}
    parsed = json.loads(raw_content)
    if not isinstance(parsed, dict):
        raise bad_request("Сохранённое содержимое задания должно быть JSON-объектом.")
    return parsed


def dump_task_content(content: dict[str, Any]) -> str:
    return json.dumps(content, ensure_ascii=False)


def _validate_choice_content(
    content: dict[str, Any],
    task_type: LearningTrajectoryTaskType,
) -> dict[str, Any]:
    raw_options = content.get("options")
    if not isinstance(raw_options, list) or len(raw_options) < 2:
        raise bad_request("Для задания с выбором нужно минимум два варианта ответа.")

    normalized_options: list[dict[str, Any]] = []
    option_ids: set[str] = set()
    correct_count = 0

    for raw_option in raw_options:
        if not isinstance(raw_option, dict):
            raise bad_request("Каждый вариант ответа должен быть объектом.")
        option_id = str(raw_option.get("id", "")).strip()
        option_text = str(raw_option.get("text", "")).strip()
        is_correct = bool(raw_option.get("is_correct"))

        if not option_id:
            raise bad_request("У каждого варианта ответа должен быть идентификатор.")
        if option_id in option_ids:
            raise bad_request("Варианты ответа не должны повторяться.")
        if not option_text:
            raise bad_request("Текст варианта ответа не должен быть пустым.")

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
        raise bad_request("Для задания с одним выбором нужен ровно один правильный вариант.")
    if task_type == LearningTrajectoryTaskType.MULTIPLE_CHOICE and correct_count < 1:
        raise bad_request("Для задания с несколькими вариантами нужен минимум один правильный вариант.")

    return {"options": normalized_options}


def _validate_matching_content(content: dict[str, Any]) -> dict[str, Any]:
    raw_pairs = content.get("pairs")
    if not isinstance(raw_pairs, list) or len(raw_pairs) < 2:
        raise bad_request("Для сопоставления нужно минимум две пары.")

    normalized_pairs: list[dict[str, str]] = []
    pair_ids: set[str] = set()
    for raw_pair in raw_pairs:
        if not isinstance(raw_pair, dict):
            raise bad_request("Каждая пара сопоставления должна быть объектом.")
        pair_id = str(raw_pair.get("id", "")).strip()
        left = str(raw_pair.get("left", "")).strip()
        right = str(raw_pair.get("right", "")).strip()

        if not pair_id:
            raise bad_request("У каждой пары сопоставления должен быть идентификатор.")
        if pair_id in pair_ids:
            raise bad_request("Пары сопоставления не должны повторяться.")
        if not left or not right:
            raise bad_request("Пара сопоставления должна содержать левый и правый текст.")

        pair_ids.add(pair_id)
        normalized_pairs.append({"id": pair_id, "left": left, "right": right})

    return {"pairs": normalized_pairs}


def _validate_ordering_content(content: dict[str, Any]) -> dict[str, Any]:
    raw_items = content.get("items")
    raw_correct_order = content.get("correct_order_ids")
    if not isinstance(raw_items, list) or len(raw_items) < 2:
        raise bad_request("Для задания на порядок нужно минимум два элемента.")
    if not isinstance(raw_correct_order, list) or len(raw_correct_order) != len(raw_items):
        raise bad_request("Для задания на порядок нужен полный эталонный порядок.")

    normalized_items: list[dict[str, str]] = []
    item_ids: set[str] = set()
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise bad_request("Каждый элемент порядка должен быть объектом.")
        item_id = str(raw_item.get("id", "")).strip()
        text = str(raw_item.get("text", "")).strip()
        if not item_id or not text:
            raise bad_request("У каждого элемента порядка должны быть идентификатор и текст.")
        if item_id in item_ids:
            raise bad_request("Элементы порядка не должны повторяться.")
        item_ids.add(item_id)
        normalized_items.append({"id": item_id, "text": text})

    correct_order = [str(item).strip() for item in raw_correct_order if str(item).strip()]
    if set(correct_order) != item_ids or len(correct_order) != len(item_ids):
        raise bad_request("Эталонный порядок должен содержать ровно те элементы, которые есть в задании.")

    return {
        "items": normalized_items,
        "correct_order_ids": correct_order,
    }


def _validate_text_content(content: dict[str, Any]) -> dict[str, Any]:
    raw_answers = content.get("accepted_answers")
    if not isinstance(raw_answers, list) or not raw_answers:
        raise bad_request("Для текстового задания нужен минимум один эталонный ответ.")

    normalized_answers: list[str] = []
    seen_answers: set[str] = set()
    for raw_answer in raw_answers:
        answer = str(raw_answer).strip()
        normalized = _normalize_text(answer)
        if not answer:
            raise bad_request("Эталонный ответ не должен быть пустым.")
        if normalized in seen_answers:
            continue
        seen_answers.add(normalized)
        normalized_answers.append(answer)

    if not normalized_answers:
        raise bad_request("Для текстового задания нужен минимум один эталонный ответ.")

    placeholder = str(content.get("placeholder", "")).strip()
    return {
        "accepted_answers": normalized_answers,
        "placeholder": placeholder,
    }


def _element_description(element: KnowledgeElement) -> str:
    return (element.description or element.name).strip()


def _relation_pair_set(
    relations: list[KnowledgeElementRelation],
    relation_types: set[KnowledgeElementRelationType],
) -> set[tuple[str, str]]:
    return {
        (str(relation.source_element_id), str(relation.target_element_id))
        for relation in relations
        if relation.relation_type in relation_types
    }


def _build_single_choice_definition_content(
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
) -> dict[str, Any]:
    return {
        "options": [
            {
                "id": str(primary_element.id),
                "text": _element_description(primary_element),
                "is_correct": True,
            },
            *[
                {
                    "id": str(element.id),
                    "text": _element_description(element),
                    "is_correct": False,
                }
                for element in related_elements
            ],
        ],
        "correct_element_id": str(primary_element.id),
    }


def _build_single_choice_term_content(
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
) -> dict[str, Any]:
    return {
        "options": [
            {
                "id": str(primary_element.id),
                "text": primary_element.name,
                "is_correct": True,
            },
            *[
                {
                    "id": str(element.id),
                    "text": element.name,
                    "is_correct": False,
                }
                for element in related_elements
            ],
        ],
        "correct_element_id": str(primary_element.id),
    }


def _build_multiple_choice_relation_content(
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
    relations: list[KnowledgeElementRelation],
    relation_types: set[KnowledgeElementRelationType],
) -> dict[str, Any]:
    relation_pairs = _relation_pair_set(relations, relation_types)
    correct_related_ids: list[str] = []
    distractor_ids: list[str] = []

    for element in related_elements:
        element_id = str(element.id)
        if (
            (str(primary_element.id), element_id) in relation_pairs
            or (element_id, str(primary_element.id)) in relation_pairs
        ):
            correct_related_ids.append(element_id)
        else:
            distractor_ids.append(element_id)

    if not correct_related_ids:
        raise bad_request("Для выбранного шаблона не найдено ни одного правильного варианта среди выбранных элементов темы.")
    if not distractor_ids:
        raise bad_request("Для выбранного шаблона нужен минимум один дополнительный элемент-дистрактор.")

    element_by_id = {str(element.id): element for element in related_elements}
    option_ids = [*correct_related_ids, *distractor_ids]
    return {
        "options": [
            {
                "id": element_id,
                "text": element_by_id[element_id].name,
                "is_correct": element_id in correct_related_ids,
            }
            for element_id in option_ids
        ],
        "correct_related_element_ids": correct_related_ids,
        "distractor_element_ids": distractor_ids,
    }


def build_content_from_template(
    template_kind: LearningTrajectoryTaskTemplateKind,
    task_type: LearningTrajectoryTaskType,
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
    content: dict[str, Any],
    template_relations: list[KnowledgeElementRelation] | None = None,
) -> dict[str, Any]:
    checked_elements = [primary_element, *related_elements]
    element_by_id = {str(element.id): element for element in checked_elements}

    if template_kind == LearningTrajectoryTaskTemplateKind.DEFINITION_CHOICE:
        if not related_elements:
            raise bad_request("Для шаблона выбора правильного определения нужен минимум один дополнительный элемент темы.")
        return _build_single_choice_definition_content(primary_element, related_elements)

    if template_kind == LearningTrajectoryTaskTemplateKind.TERM_CHOICE:
        if not related_elements:
            raise bad_request("Для шаблона выбора понятия по определению нужен минимум один дополнительный элемент темы.")
        return _build_single_choice_term_content(primary_element, related_elements)

    if template_kind == LearningTrajectoryTaskTemplateKind.MATCHING_DEFINITION:
        if not related_elements:
            raise bad_request("Для сопоставления понятий и определений нужен минимум один дополнительный элемент темы.")
        return {
            "pairs": [
                {
                    "id": str(element.id),
                    "left": element.name,
                    "right": _element_description(element),
                }
                for element in checked_elements
            ]
        }

    if template_kind == LearningTrajectoryTaskTemplateKind.PROPERTY_MULTIPLE:
        if len(related_elements) < 2:
            raise bad_request("Для выбора характеристик объекта нужны минимум два дополнительных элемента темы.")
        return _build_multiple_choice_relation_content(
            primary_element=primary_element,
            related_elements=related_elements,
            relations=template_relations or [],
            relation_types={KnowledgeElementRelationType.PROPERTY_OF},
        )

    if template_kind == LearningTrajectoryTaskTemplateKind.CONTAINS_MULTIPLE:
        if len(related_elements) < 2:
            raise bad_request("Для шаблона частей целого нужны минимум два дополнительных элемента темы.")
        return _build_multiple_choice_relation_content(
            primary_element=primary_element,
            related_elements=related_elements,
            relations=template_relations or [],
            relation_types={
                KnowledgeElementRelationType.CONTAINS,
                KnowledgeElementRelationType.PART_OF,
            },
        )

    if task_type == LearningTrajectoryTaskType.SINGLE_CHOICE:
        if len(checked_elements) < 2:
            raise bad_request(
                "Для задания с одним выбором нужен ключевой элемент и минимум один вариант из связанных элементов."
            )
        correct_element_id = str(content.get("correct_element_id") or primary_element.id)
        if correct_element_id not in element_by_id:
            raise bad_request("Правильный вариант должен быть ключевым или связанным элементом.")
        return {
            "options": [
                {
                    "id": str(element.id),
                    "text": element.name,
                    "is_correct": str(element.id) == correct_element_id,
                }
                for element in checked_elements
            ],
            "correct_element_id": correct_element_id,
        }

    if task_type == LearningTrajectoryTaskType.MULTIPLE_CHOICE:
        correct_related_ids = {
            str(element_id)
            for element_id in content.get("correct_related_element_ids", [])
        }
        distractor_ids = {
            str(element_id)
            for element_id in content.get("distractor_element_ids", [])
        }
        if not distractor_ids:
            raise bad_request("Для задания с несколькими вариантами нужен минимум один дистрактор.")
        if correct_related_ids & distractor_ids:
            raise bad_request("Один элемент не может быть одновременно правильным вариантом и дистрактором.")
        unknown_ids = (correct_related_ids | distractor_ids) - element_by_id.keys()
        if unknown_ids:
            raise bad_request("Все правильные связанные элементы и дистракторы должны быть выбраны в задании.")

        option_ids = [*sorted(correct_related_ids), *sorted(distractor_ids)]
        if len(set(option_ids)) < 2:
            raise bad_request("Для задания с несколькими вариантами нужно минимум два варианта ответа.")

        return {
            "options": [
                {
                    "id": element_id,
                    "text": element_by_id[element_id].name,
                    "is_correct": element_id in correct_related_ids,
                }
                for element_id in option_ids
            ],
            "correct_related_element_ids": sorted(correct_related_ids),
            "distractor_element_ids": sorted(distractor_ids),
        }

    if task_type == LearningTrajectoryTaskType.MATCHING:
        if len(checked_elements) < 2:
            raise bad_request("Для сопоставления нужен ключевой элемент и минимум один связанный элемент.")
        return {
            "pairs": [
                {
                    "id": str(element.id),
                    "left": element.name,
                    "right": _element_description(element),
                }
                for element in checked_elements
            ]
        }

    if task_type == LearningTrajectoryTaskType.ORDERING:
        if len(checked_elements) < 2:
            raise bad_request("Для порядка нужен ключевой элемент и минимум один связанный элемент.")
        correct_order_ids = [
            str(element_id)
            for element_id in content.get("correct_order_ids", [])
        ]
        fallback_order_ids = [str(element.id) for element in related_elements] + [str(primary_element.id)]
        return {
            "items": [
                {
                    "id": str(element.id),
                    "text": element.name,
                }
                for element in checked_elements
            ],
            "correct_order_ids": correct_order_ids or fallback_order_ids,
        }

    if task_type == LearningTrajectoryTaskType.TEXT:
        raise bad_request("Текстовые задания отключены. Используй выбор, сопоставление или порядок.")

    raise bad_request("Неподдерживаемый тип задания.")


def normalize_task_content(
    task_type: LearningTrajectoryTaskType,
    content: dict[str, Any],
) -> dict[str, Any]:
    if not isinstance(content, dict):
        raise bad_request("Содержимое задания должно быть JSON-объектом.")

    if task_type in {
        LearningTrajectoryTaskType.SINGLE_CHOICE,
        LearningTrajectoryTaskType.MULTIPLE_CHOICE,
    }:
        return _validate_choice_content(content, task_type)
    if task_type == LearningTrajectoryTaskType.MATCHING:
        return _validate_matching_content(content)
    if task_type == LearningTrajectoryTaskType.ORDERING:
        return _validate_ordering_content(content)
    if task_type == LearningTrajectoryTaskType.TEXT:
        raise bad_request("Текстовые задания отключены. Используй выбор, сопоставление или порядок.")

    raise bad_request("Неподдерживаемый тип задания.")


def validate_task_payload(
    trajectory: LearningTrajectory,
    payload: LearningTrajectoryTaskCreate,
    template_relations: list[KnowledgeElementRelation] | None = None,
) -> dict[str, Any]:
    ensure_task_write_allowed(trajectory)

    if payload.template_kind not in ACTIVE_TASK_TEMPLATE_KINDS:
        raise bad_request("Выбранный шаблон задания больше не поддерживается в редакторе.")

    fixed_task_type = FIXED_TASK_TYPE_BY_TEMPLATE.get(payload.template_kind)
    if fixed_task_type is not None and payload.task_type != fixed_task_type:
        raise bad_request("Для выбранного шаблона тип задания фиксирован и не может быть изменён.")
    if payload.template_kind == LearningTrajectoryTaskTemplateKind.MANUAL:
        if payload.task_type not in MANUAL_ALLOWED_TASK_TYPES:
            raise bad_request("В ручном шаблоне сейчас доступны только один выбор, несколько выборов и сопоставление.")

    trajectory_topic = next(
        (item for item in trajectory.topics if item.topic_id == payload.topic_id),
        None,
    )
    if trajectory_topic is None:
        raise bad_request("Тема задания должна входить в выбранную траекторию.")

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
            "Ключевой элемент должен быть выбран в этой теме траектории."
        )
    if primary_element.competence_type != CompetenceType.KNOW:
        raise bad_request("Ручные задания пока доступны только для компетенции «Знать».")

    allowed_related_elements: dict[UUID, KnowledgeElement] = {}
    for trajectory_element in trajectory_topic.elements:
        element = trajectory_element.element
        if element.competence_type == CompetenceType.KNOW:
            allowed_related_elements[element.id] = element

    if payload.primary_element_id in payload.related_element_ids:
        raise bad_request("Ключевой элемент не нужно дублировать среди связанных элементов.")

    if len(payload.related_element_ids) != len(set(payload.related_element_ids)):
        raise bad_request("Связанные элементы в одном задании не должны повторяться.")

    related_elements: list[KnowledgeElement] = []
    for related_element_id in payload.related_element_ids:
        if related_element_id not in allowed_related_elements:
            raise bad_request(
                "Связанные элементы должны входить в сохранённую траекторию и иметь компетенцию «Знать»."
            )
        related_elements.append(allowed_related_elements[related_element_id])

    return normalize_task_content(
        payload.task_type,
        build_content_from_template(
            template_kind=payload.template_kind,
            task_type=payload.task_type,
            primary_element=primary_element,
            related_elements=related_elements,
            content=payload.content,
            template_relations=template_relations,
        ),
    )


def merge_mastery_value(current_value: int | None, score: int) -> int:
    baseline = current_value if current_value is not None else 0
    next_value = baseline + (score - baseline) * MASTERY_UPDATE_FACTOR
    return max(0, min(100, round(next_value)))


def build_teacher_task_content(task: LearningTrajectoryTask) -> dict[str, Any]:
    return parse_task_content_json(task.content_json)


def build_student_task_content_from_snapshot(
    task: LearningTrajectoryTask,
    content: dict[str, Any],
    seed: str | None = None,
) -> dict[str, Any]:
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
        random.Random(seed or str(task.id)).shuffle(right_items)
        return {
            "left_items": [
                {"id": pair["id"], "text": pair["left"]}
                for pair in pairs
            ],
            "right_items": right_items,
        }

    if task.task_type == LearningTrajectoryTaskType.ORDERING:
        items = [
            {"id": item["id"], "text": item["text"]}
            for item in content.get("items", [])
        ]
        random.Random(seed or str(task.id)).shuffle(items)
        return {"items": items}

    if task.task_type == LearningTrajectoryTaskType.TEXT:
        return {
            "placeholder": content.get("placeholder", ""),
        }

    return {}


def build_student_task_content(task: LearningTrajectoryTask) -> dict[str, Any]:
    return build_student_task_content_from_snapshot(
        task,
        parse_task_content_json(task.content_json),
    )


def build_task_relation_read(link) -> LearningTrajectoryTaskRelationRead:
    relation = link.relation
    return LearningTrajectoryTaskRelationRead(
        relation_id=relation.id,
        source_element_id=relation.source_element_id,
        source_element_name=relation.source_element.name,
        target_element_id=relation.target_element_id,
        target_element_name=relation.target_element.name,
        relation_type=relation.relation_type,
    )


def build_task_read(task: LearningTrajectoryTask) -> LearningTrajectoryTaskRead:
    return LearningTrajectoryTaskRead(
        id=task.id,
        trajectory_id=task.trajectory_id,
        trajectory_topic_id=task.trajectory_topic_id,
        topic_id=task.trajectory_topic.topic_id,
        topic_name=task.trajectory_topic.topic.name,
        title=task.title,
        prompt=task.prompt,
        difficulty=task.difficulty,
        task_type=task.task_type,
        template_kind=task.template_kind,
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
        checked_relations=[
            build_task_relation_read(link)
            for link in task.checked_relations
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
            last_feedback=None,
        )

    last_answer_payload = None
    if progress.last_answer_payload:
        try:
            parsed = json.loads(progress.last_answer_payload)
            if isinstance(parsed, dict):
                last_answer_payload = parsed
        except json.JSONDecodeError:
            last_answer_payload = None

    last_feedback = None
    if progress.last_feedback_json:
        try:
            parsed_feedback = json.loads(progress.last_feedback_json)
            if isinstance(parsed_feedback, dict):
                last_feedback = parsed_feedback
        except json.JSONDecodeError:
            last_feedback = None

    return StudentTaskProgressRead(
        status=progress.status,
        attempts_count=progress.attempts_count,
        last_score=progress.last_score,
        best_score=progress.best_score,
        completed_at=progress.completed_at,
        last_answer_payload=last_answer_payload,
        last_feedback=last_feedback,
    )


def build_student_task_read(
    task: LearningTrajectoryTask,
    discipline_name: str,
    mastery_by_element_id: dict[UUID, int],
    progress: StudentTaskProgress | None,
    recommendation_score: float | None = None,
    task_instance_id: UUID | None = None,
    content_snapshot: dict[str, Any] | None = None,
) -> StudentAssignedTaskRead:
    return StudentAssignedTaskRead(
        id=task.id,
        task_instance_id=task_instance_id,
        trajectory_id=task.trajectory_id,
        trajectory_name=task.trajectory.name,
        discipline_id=task.trajectory.discipline_id,
        discipline_name=discipline_name,
        topic_id=task.trajectory_topic.topic_id,
        topic_name=task.trajectory_topic.topic.name,
        title=task.title,
        prompt=task.prompt,
        difficulty=task.difficulty,
        task_type=task.task_type,
        template_kind=task.template_kind,
        content=(
            build_student_task_content_from_snapshot(
                task,
                content_snapshot,
                seed=str(task_instance_id) if task_instance_id else None,
            )
            if content_snapshot is not None
            else build_student_task_content(task)
        ),
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
        checked_relations=[
            build_task_relation_read(link)
            for link in task.checked_relations
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


def task_target_mastery(task: LearningTrajectoryTask) -> int:
    trajectory_element = next(
        (
            element
            for element in task.trajectory_topic.elements
            if element.element_id == task.primary_element_id
        ),
        None,
    )
    if trajectory_element is None:
        trajectory_topic = next(
            (
                topic
                for topic in task.trajectory.topics
                if topic.id == task.trajectory_topic_id
            ),
            None,
        )
        if trajectory_topic is not None:
            trajectory_element = next(
                (
                    element
                    for element in trajectory_topic.elements
                    if element.element_id == task.primary_element_id
                ),
                None,
            )
    if trajectory_element is None or trajectory_element.threshold <= 0:
        return DEFAULT_ELEMENT_TARGET_MASTERY
    return trajectory_element.threshold


def task_is_basic(task: LearningTrajectoryTask) -> bool:
    return task.difficulty <= BASIC_TASK_MAX_DIFFICULTY


def task_needs_more_practice(
    task: LearningTrajectoryTask,
    mastery_by_element_id: dict[UUID, int],
    *,
    ignore_target_mastery: bool = False,
) -> bool:
    current_mastery = mastery_by_element_id.get(task.primary_element_id, 0)
    if ignore_target_mastery:
        return current_mastery < 100
    return current_mastery < task_target_mastery(task)


def task_stage_unlocked(
    task: LearningTrajectoryTask,
    mastery_by_element_id: dict[UUID, int],
    sibling_tasks: list[LearningTrajectoryTask],
    progress_by_task_id: dict[UUID, StudentTaskProgress],
    *,
    ignore_stage_gate: bool = False,
) -> bool:
    if ignore_stage_gate or task_is_basic(task):
        return True

    primary_mastery = mastery_by_element_id.get(task.primary_element_id, 0)
    if primary_mastery >= ADVANCED_UNLOCK_MASTERY:
        return True

    for sibling in sibling_tasks:
        if sibling.id == task.id or not task_is_basic(sibling):
            continue
        sibling_progress = progress_by_task_id.get(sibling.id)
        if sibling_progress and (sibling_progress.best_score or 0) >= SUCCESS_SCORE_THRESHOLD:
            return True

    return False


def build_adaptive_candidate_pool(
    tasks: list[LearningTrajectoryTask],
    mastery_by_element_id: dict[UUID, int],
    progress_by_task_id: dict[UUID, StudentTaskProgress],
    outgoing_by_source: dict[UUID, list[KnowledgeElementRelation]],
    *,
    ignore_stage_gate: bool = False,
    ignore_prerequisites: bool = False,
    ignore_target_mastery: bool = False,
) -> list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]]:
    tasks_by_primary_element: dict[UUID, list[LearningTrajectoryTask]] = defaultdict(list)
    for task in tasks:
        tasks_by_primary_element[task.primary_element_id].append(task)

    candidates: list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]] = []
    for task in tasks:
        if not ignore_prerequisites and not prerequisites_ready(task, mastery_by_element_id, outgoing_by_source):
            continue

        if not task_needs_more_practice(
            task,
            mastery_by_element_id,
            ignore_target_mastery=ignore_target_mastery,
        ):
            continue

        progress = progress_by_task_id.get(task.id)
        if not task_stage_unlocked(
            task,
            mastery_by_element_id,
            tasks_by_primary_element.get(task.primary_element_id, []),
            progress_by_task_id,
            ignore_stage_gate=ignore_stage_gate,
        ):
            continue

        candidates.append((task, progress))

    return candidates


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
    target_mastery = task_target_mastery(task)
    mastery_gap = max(0, target_mastery - mastery_value)
    mastery_gap_score = min(1.0, mastery_gap / max(target_mastery, 1))
    attempts_count = progress.attempts_count if progress and progress.attempts_count else 0
    novelty_score = max(0.25, 1 - attempts_count * 0.18)
    stage_fit = 1.0 if task_is_basic(task) else (1.0 if mastery_value >= ADVANCED_UNLOCK_MASTERY else 0.7)
    recovery_score = 1.0 if progress and (progress.last_score or 0) < SUCCESS_SCORE_THRESHOLD else 0.55

    return max(
        0.0,
        0.35 * mastery_gap_score
        + 0.20 * graph_importance(task.primary_element_id, degree_by_element_id)
        + 0.15 * difficulty_fit(task, mastery_value)
        + 0.15 * novelty_score
        + 0.15 * stage_fit
        + 0.05 * recovery_score,
    )


def select_next_task(
    candidates: list[tuple[LearningTrajectoryTask, StudentTaskProgress | None]],
    mastery_by_element_id: dict[UUID, int],
    degree_by_element_id: dict[UUID, int],
) -> tuple[LearningTrajectoryTask, StudentTaskProgress | None, float] | None:
    """Simple, replaceable selector for adaptive control.

    Policy:
    1. tasks are prefiltered to elements that still need practice;
    2. weaker elements are prioritized;
    3. easier tasks lead until basic mastery is reached;
    4. repeated attempts gradually lose priority.
    """
    if not candidates:
        return None

    def sort_key(item: tuple[LearningTrajectoryTask, StudentTaskProgress | None]):
        task, progress = item
        attempts_count = progress.attempts_count if progress is not None else 0
        priority = task_priority(task, mastery_by_element_id, degree_by_element_id, progress)
        return (
            -priority,
            attempts_count,
            task.difficulty,
            task.created_at,
        )

    task, progress = min(candidates, key=sort_key)
    return (
        task,
        progress,
        round(task_priority(task, mastery_by_element_id, degree_by_element_id, progress), 4),
    )


def _score_single_choice(
    content: dict[str, Any],
    answer_payload: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    selected_ids = answer_payload.get("selected_option_ids")
    if not isinstance(selected_ids, list):
        raise bad_request("Ответ на задание с одним выбором должен содержать selected_option_ids.")
    selected_set = {str(item).strip() for item in selected_ids if str(item).strip()}
    if len(selected_set) != 1:
        return 0, {
            "is_correct": False,
            "message": "Нужно выбрать ровно один вариант.",
            "correct_option_ids": [],
        }

    correct_option = next(
        (option for option in content.get("options", []) if option.get("is_correct")),
        None,
    )
    if correct_option is None:
        raise bad_request("В задании не задан правильный вариант.")
    is_correct = correct_option["id"] in selected_set
    return (
        100 if is_correct else 0,
        {
            "is_correct": is_correct,
            "message": "Ответ верный." if is_correct else "Ответ неверный.",
            "correct_option_ids": [correct_option["id"]],
            "correct_options": [correct_option["text"]],
        },
    )


def _score_multiple_choice(
    content: dict[str, Any],
    answer_payload: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    selected_ids = answer_payload.get("selected_option_ids")
    if not isinstance(selected_ids, list):
        raise bad_request("Ответ на задание с несколькими вариантами должен содержать selected_option_ids.")

    selected_set = {str(item).strip() for item in selected_ids if str(item).strip()}
    correct_set = {
        option["id"]
        for option in content.get("options", [])
        if option.get("is_correct")
    }
    if not correct_set:
        raise bad_request("В задании не заданы правильные варианты.")

    correct_matches = len(selected_set & correct_set)
    wrong_matches = len(selected_set - correct_set)
    score = max(0.0, (correct_matches - wrong_matches) / len(correct_set))
    normalized_score = round(score * 100)
    correct_options = [
        option["text"]
        for option in content.get("options", [])
        if option["id"] in correct_set
    ]
    return (
        normalized_score,
        {
            "is_correct": normalized_score == 100,
            "message": (
                "Все верные варианты выбраны."
                if normalized_score == 100
                else "Часть вариантов выбрана неверно или не полностью."
            ),
            "correct_option_ids": sorted(correct_set),
            "correct_options": correct_options,
        },
    )


def _score_matching(
    content: dict[str, Any],
    answer_payload: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    pairings = answer_payload.get("pairings")
    if not isinstance(pairings, list):
        raise bad_request("Ответ на сопоставление должен содержать pairings.")

    submitted_mapping: dict[str, str] = {}
    for pairing in pairings:
        if not isinstance(pairing, dict):
            raise bad_request("Каждое сопоставление должно быть объектом.")
        left_id = str(pairing.get("left_id", "")).strip()
        right_id = str(pairing.get("right_id", "")).strip()
        if left_id and right_id:
            submitted_mapping[left_id] = right_id

    pairs = content.get("pairs", [])
    if not pairs:
        raise bad_request("В задании не заданы пары для сопоставления.")

    correct_matches = sum(
        1
        for pair in pairs
        if submitted_mapping.get(pair["id"]) == pair["id"]
    )
    score = round(correct_matches / len(pairs) * 100)
    correct_pairs = [
        {"left": pair["left"], "right": pair["right"]}
        for pair in pairs
    ]
    return (
        score,
        {
            "is_correct": score == 100,
            "message": (
                "Все соответствия выбраны верно."
                if score == 100
                else f"Верно сопоставлено {correct_matches} из {len(pairs)}."
            ),
            "correct_pairs": correct_pairs,
        },
    )


def _score_ordering(
    content: dict[str, Any],
    answer_payload: dict[str, Any],
) -> tuple[int, dict[str, Any]]:
    submitted_order = answer_payload.get("ordered_item_ids")
    if not isinstance(submitted_order, list):
        raise bad_request("Ответ на порядок должен содержать ordered_item_ids.")

    normalized_order = [str(item).strip() for item in submitted_order if str(item).strip()]
    correct_order = [
        str(item).strip()
        for item in content.get("correct_order_ids", [])
        if str(item).strip()
    ]
    if not correct_order:
        raise bad_request("В задании не задан эталонный порядок.")

    correct_positions = sum(
        1
        for index, item_id in enumerate(correct_order)
        if index < len(normalized_order) and normalized_order[index] == item_id
    )
    score = round(correct_positions / len(correct_order) * 100)
    item_name_by_id = {
        item["id"]: item["text"]
        for item in content.get("items", [])
        if isinstance(item, dict)
    }
    return (
        score,
        {
            "is_correct": score == 100,
            "message": (
                "Порядок выбран верно."
                if score == 100
                else f"Верно расположено {correct_positions} из {len(correct_order)}."
            ),
            "correct_order_ids": correct_order,
            "correct_order": [
                item_name_by_id.get(item_id, item_id)
                for item_id in correct_order
            ],
        },
    )


def _score_text(content: dict[str, Any], answer_payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
    submitted_text = str(answer_payload.get("text", "")).strip()
    if not submitted_text:
        return 0, {
            "is_correct": False,
            "message": "Ответ пустой.",
            "accepted_answers": content.get("accepted_answers", []),
        }

    normalized_submitted = _normalize_text(submitted_text)
    accepted_answers = {
        _normalize_text(answer)
        for answer in content.get("accepted_answers", [])
    }
    is_correct = normalized_submitted in accepted_answers
    return (
        100 if is_correct else 0,
        {
            "is_correct": is_correct,
            "message": "Ответ верный." if is_correct else "Ответ не совпал с эталоном.",
            "accepted_answers": content.get("accepted_answers", []),
        },
    )


def evaluate_task_answer(
    task: LearningTrajectoryTask,
    answer_payload: dict[str, Any],
    content_snapshot: dict[str, Any] | None = None,
) -> tuple[int, dict[str, Any], dict[str, Any]]:
    if not isinstance(answer_payload, dict):
        raise bad_request("Ответ на задание должен быть JSON-объектом.")

    content = content_snapshot if content_snapshot is not None else parse_task_content_json(task.content_json)
    if task.task_type == LearningTrajectoryTaskType.SINGLE_CHOICE:
        score, feedback = _score_single_choice(content, answer_payload)
        return score, answer_payload, feedback
    if task.task_type == LearningTrajectoryTaskType.MULTIPLE_CHOICE:
        score, feedback = _score_multiple_choice(content, answer_payload)
        return score, answer_payload, feedback
    if task.task_type == LearningTrajectoryTaskType.MATCHING:
        score, feedback = _score_matching(content, answer_payload)
        return score, answer_payload, feedback
    if task.task_type == LearningTrajectoryTaskType.ORDERING:
        score, feedback = _score_ordering(content, answer_payload)
        return score, answer_payload, feedback
    if task.task_type == LearningTrajectoryTaskType.TEXT:
        raise bad_request("Текстовые задания отключены.")

    raise bad_request("Неподдерживаемый тип задания.")
