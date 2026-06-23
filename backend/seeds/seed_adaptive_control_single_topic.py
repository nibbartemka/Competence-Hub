from __future__ import annotations

import json
import os
import random
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

# Allow running the script directly from the test folder.
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core import Base
from app.core.slugs import transliterate_to_slug_base
from app.models import (
    Discipline,
    Group,
    GroupDiscipline,
    KnowledgeElement,
    KnowledgeElementRelation,
    LearningTrajectory,
    LearningTrajectoryElement,
    LearningTrajectoryTask,
    LearningTrajectoryTaskElement,
    LearningTrajectoryTaskRelation,
    LearningTrajectoryTopic,
    Relation,
    Student,
    StudentDiscipline,
    StudentElementMastery,
    StudentTaskAttempt,
    StudentTaskInstance,
    StudentTaskProgress,
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
    KnowledgeElementRelationType,
    LearningTrajectoryStatus,
    LearningTrajectoryTaskTemplateKind,
    LearningTrajectoryTaskType,
    RelationDirectionType,
    StudentTaskProgressStatus,
    TopicKnowledgeElementRole,
)


DB_PATH = Path(
    os.environ.get(
        "COMPETENCE_HUB_DB_PATH",
        str(ROOT_DIR / "app_adaptive_control_single_topic.db"),
    )
)
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"
RNG = random.Random(20260527)


RELATION_DIRECTION_BY_TYPE: dict[KnowledgeElementRelationType, RelationDirectionType] = {
    KnowledgeElementRelationType.REQUIRES: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.BUILDS_ON: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.RELIES_ON: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.CONTAINS: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.PART_OF: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.PROPERTY_OF: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.REFINES: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.GENERALIZES: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.IMPLEMENTS: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.AUTOMATES: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.SIMILAR: RelationDirectionType.TWO_DIRECTION,
    KnowledgeElementRelationType.CONTRASTS_WITH: RelationDirectionType.TWO_DIRECTION,
    KnowledgeElementRelationType.USED_WITH: RelationDirectionType.TWO_DIRECTION,
}


@dataclass(frozen=True)
class ElementSpec:
    key: str
    name: str
    description: str
    competence_type: CompetenceType = CompetenceType.KNOW
    operation_ref: str | None = None
    threshold: int = 60
    subject_area_description: str | None = None


ELEMENT_SPECS: tuple[ElementSpec, ...] = (
    ElementSpec(
        "graph",
        "Граф",
        "Структура из множества вершин и множества связей между ними.",
    ),
    ElementSpec(
        "vertex",
        "Вершина",
        "Базовый объект графа, представляющий узел модели.",
    ),
    ElementSpec(
        "edge",
        "Ребро",
        "Связь между двумя вершинами в неориентированном графе.",
    ),
    ElementSpec(
        "adjacency",
        "Смежность",
        "Отношение между вершинами, если они соединены ребром.",
    ),
    ElementSpec(
        "incidence",
        "Инцидентность",
        "Отношение между вершиной и ребром, если вершина является концом ребра.",
    ),
    ElementSpec(
        "path",
        "Путь",
        "Последовательность вершин и рёбер, позволяющая пройти от одной вершины к другой.",
    ),
    ElementSpec(
        "cycle",
        "Цикл",
        "Путь, который начинается и заканчивается в одной и той же вершине.",
    ),
    ElementSpec(
        "directed_graph",
        "Ориентированный граф",
        "Граф, где связи имеют направление.",
    ),
    ElementSpec(
        "weighted_graph",
        "Взвешенный граф",
        "Граф, в котором вершинам или рёбрам приписаны веса.",
    ),
    ElementSpec(
        "vertex_degree",
        "Степень вершины",
        "Количество рёбер, инцидентных вершине.",
    ),
    ElementSpec(
        "spanning_tree",
        "Остовное дерево",
        "Подграф, который содержит все вершины графа и не содержит циклов.",
    ),
    ElementSpec(
        "shortest_path",
        "Кратчайший путь",
        "Путь с минимальной суммарной длиной или стоимостью среди всех возможных.",
    ),
    ElementSpec(
        "identify_adjacency_structure",
        "Определять смежность по описанию графа",
        "Умение по списку вершин и рёбер понять, какие вершины смежны.",
        competence_type=CompetenceType.CAN,
        operation_ref="graph.operation.build_adjacency_matrix",
        threshold=70,
    ),
    ElementSpec(
        "build_incidence_representation",
        "Строить матрицу инцидентности",
        "Умение представлять граф в виде матрицы инцидентности.",
        competence_type=CompetenceType.CAN,
        operation_ref="graph.operation.build_incidence_matrix",
        threshold=70,
    ),
    ElementSpec(
        "compute_degree_sequence",
        "Вычислять степени вершин",
        "Умение по описанию графа находить степени вершин.",
        competence_type=CompetenceType.CAN,
        operation_ref="graph.operation.build_degree_sequence",
        threshold=70,
    ),
    ElementSpec(
        "analyze_directed_degrees",
        "Анализировать входящие и исходящие степени",
        "Умение считать входящие и исходящие степени в орграфе.",
        competence_type=CompetenceType.CAN,
        operation_ref="graph.operation.build_degree_sequence",
        threshold=70,
    ),
    ElementSpec(
        "model_delivery_network",
        "Моделировать сеть доставки графом",
        "Владение построением графовой модели транспортной или логистической задачи.",
        competence_type=CompetenceType.MASTER,
        threshold=80,
        subject_area_description=(
            "Нужно перевести краткое описание логистической сети в графовую модель, "
            "объяснить выбор вершин, рёбер и весов."
        ),
    ),
    ElementSpec(
        "justify_route_choice",
        "Обосновывать выбор маршрута в графовой модели",
        "Владение аргументированной интерпретацией найденного маршрута.",
        competence_type=CompetenceType.MASTER,
        threshold=80,
        subject_area_description=(
            "Нужно объяснить, почему выбранный маршрут действительно подходит для прикладной задачи "
            "и на каких свойствах графа основано решение."
        ),
    ),
)


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def recreate_database() -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()

    engine = create_engine(DATABASE_URL, echo=False, future=True)
    Base.metadata.create_all(engine)

    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    with session_local() as session:
        seed_data(session)
        session.commit()

    print(f"Database recreated: {DB_PATH.resolve()}")


def seed_data(session: Session) -> None:
    discipline = seed_discipline(session)
    people = seed_people(session, discipline)
    relation_catalog = seed_relation_catalog(session)
    topic, elements = seed_topic_and_elements(session, discipline)
    relations = seed_element_relations(session, topic, elements, relation_catalog)
    trajectory, trajectory_topic = seed_learning_trajectory(session, discipline, people, topic, elements)
    tasks = seed_tasks(session, trajectory, trajectory_topic, elements, relations)
    seed_student_mastery_and_progress(session, discipline, trajectory, people, elements, tasks)
    print_seed_summary(session, discipline, trajectory, topic, tasks, people)


def seed_discipline(session: Session) -> Discipline:
    name = "Адаптивный контроль. Однотематический ручной стенд"
    discipline = Discipline(
        name=name,
        slug=transliterate_to_slug_base(name),
        knowledge_graph_version=1,
    )
    session.add(discipline)
    session.flush()
    return discipline


def seed_people(session: Session, discipline: Discipline) -> dict[str, object]:
    group = Group(name="АДП-TEST-01")
    session.add(group)
    session.flush()

    subgroup = Subgroup(subgroup_num=1, group_id=group.id)
    teacher = Teacher(
        name="Адаптивный Преподаватель",
        login="adaptive_teacher",
        password="adaptive_teacher",
    )
    students = [
        Student(
            name="Студент Fresh",
            login="adaptive_fresh",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Студент Recent Error",
            login="adaptive_error",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Студент Fragile Success",
            login="adaptive_fragile",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Студент Can Stage",
            login="adaptive_can",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Студент Master Stage",
            login="adaptive_master",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
    ]

    session.add_all([subgroup, teacher, *students])
    session.flush()

    session.add_all(
        [
            GroupDiscipline(group_id=group.id, discipline_id=discipline.id),
            TeacherDiscipline(teacher_id=teacher.id, discipline_id=discipline.id),
            TeacherGroup(teacher_id=teacher.id, group_id=group.id),
            TeacherSubgroup(teacher_id=teacher.id, subgroup_id=subgroup.id),
            *[
                StudentDiscipline(student_id=student.id, discipline_id=discipline.id)
                for student in students
            ],
        ]
    )
    session.flush()

    return {
        "group": group,
        "subgroup": subgroup,
        "teacher": teacher,
        "students": students,
    }


def seed_relation_catalog(session: Session) -> dict[KnowledgeElementRelationType, Relation]:
    relations: dict[KnowledgeElementRelationType, Relation] = {}
    for relation_type, direction in RELATION_DIRECTION_BY_TYPE.items():
        relation = Relation(
            relation_type=relation_type,
            direction=direction,
        )
        session.add(relation)
        relations[relation_type] = relation
    session.flush()
    return relations


def seed_topic_and_elements(
    session: Session,
    discipline: Discipline,
) -> tuple[Topic, dict[str, KnowledgeElement]]:
    topic = Topic(
        name="Тема 1. Базовые структуры графов и диагностика ошибок",
        description=(
            "Одна насыщенная тема для ручной проверки adaptive control: много элементов знать, "
            "несколько элементов уметь и владеть, а также большой банк разнотипных заданий."
        ),
        discipline_id=discipline.id,
    )
    session.add(topic)
    session.flush()

    elements: dict[str, KnowledgeElement] = {}
    for spec in ELEMENT_SPECS:
        element = KnowledgeElement(
            name=spec.name,
            description=spec.description,
            competence_type=spec.competence_type,
            discipline_id=discipline.id,
            operation_ref=spec.operation_ref,
            subject_area_description=spec.subject_area_description,
        )
        session.add(element)
        session.flush()
        session.add(
            TopicKnowledgeElement(
                topic_id=topic.id,
                element_id=element.id,
                role=TopicKnowledgeElementRole.FORMED,
            )
        )
        elements[spec.key] = element

    session.flush()
    return topic, elements


def seed_element_relations(
    session: Session,
    topic: Topic,
    elements: dict[str, KnowledgeElement],
    relation_catalog: dict[KnowledgeElementRelationType, Relation],
) -> dict[tuple[str, str, KnowledgeElementRelationType], KnowledgeElementRelation]:
    specs = [
        ("graph", "vertex", KnowledgeElementRelationType.CONTAINS, "Граф состоит из вершин."),
        ("graph", "edge", KnowledgeElementRelationType.CONTAINS, "Граф состоит из рёбер."),
        ("adjacency", "edge", KnowledgeElementRelationType.RELIES_ON, "Смежность задаётся через наличие ребра."),
        ("incidence", "edge", KnowledgeElementRelationType.RELIES_ON, "Инцидентность проверяется по связи ребра и вершины."),
        ("path", "adjacency", KnowledgeElementRelationType.BUILDS_ON, "Путь строится на цепочке смежностей."),
        ("cycle", "path", KnowledgeElementRelationType.BUILDS_ON, "Цикл является частным случаем пути."),
        ("weighted_graph", "shortest_path", KnowledgeElementRelationType.USED_WITH, "Вес рёбер часто используется в задаче о кратчайшем пути."),
        ("spanning_tree", "graph", KnowledgeElementRelationType.BUILDS_ON, "Остовное дерево определяется на графе."),
        ("shortest_path", "path", KnowledgeElementRelationType.BUILDS_ON, "Кратчайший путь является разновидностью пути."),
        ("vertex_degree", "edge", KnowledgeElementRelationType.RELIES_ON, "Степень вершины считается через инцидентные рёбра."),
        (
            "directed_graph",
            "graph",
            KnowledgeElementRelationType.REFINES,
            "Ориентированный граф уточняет общее понятие графа.",
        ),
        (
            "identify_adjacency_structure",
            "adjacency",
            KnowledgeElementRelationType.AUTOMATES,
            "Умение автоматизирует проверку смежности.",
        ),
        (
            "build_incidence_representation",
            "incidence",
            KnowledgeElementRelationType.AUTOMATES,
            "Умение автоматизирует построение матрицы инцидентности.",
        ),
        (
            "compute_degree_sequence",
            "vertex_degree",
            KnowledgeElementRelationType.AUTOMATES,
            "Умение автоматизирует вычисление степеней вершин.",
        ),
        (
            "analyze_directed_degrees",
            "vertex_degree",
            KnowledgeElementRelationType.AUTOMATES,
            "Умение автоматизирует анализ входящих и исходящих степеней.",
        ),
        (
            "model_delivery_network",
            "identify_adjacency_structure",
            KnowledgeElementRelationType.AUTOMATES,
            "Владение опирается на умение читать структуру связей.",
        ),
        (
            "model_delivery_network",
            "weighted_graph",
            KnowledgeElementRelationType.RELIES_ON,
            "Модель доставки обычно использует веса.",
        ),
        (
            "model_delivery_network",
            "shortest_path",
            KnowledgeElementRelationType.RELIES_ON,
            "Модель доставки требует понимания кратчайших путей.",
        ),
        (
            "justify_route_choice",
            "analyze_directed_degrees",
            KnowledgeElementRelationType.AUTOMATES,
            "Обоснование маршрута опирается на умение анализировать орграф.",
        ),
        (
            "justify_route_choice",
            "path",
            KnowledgeElementRelationType.RELIES_ON,
            "Обоснование маршрута требует понимания путей.",
        ),
        (
            "justify_route_choice",
            "vertex_degree",
            KnowledgeElementRelationType.RELIES_ON,
            "Обоснование маршрута учитывает локальные характеристики вершин.",
        ),
    ]

    result: dict[tuple[str, str, KnowledgeElementRelationType], KnowledgeElementRelation] = {}
    for source_key, target_key, relation_type, description in specs:
        relation = KnowledgeElementRelation(
            topic_id=topic.id,
            source_element_id=elements[source_key].id,
            target_element_id=elements[target_key].id,
            relation_id=relation_catalog[relation_type].id,
            description=description,
        )
        session.add(relation)
        result[(source_key, target_key, relation_type)] = relation

    session.flush()
    return result


def seed_learning_trajectory(
    session: Session,
    discipline: Discipline,
    people: dict[str, object],
    topic: Topic,
    elements: dict[str, KnowledgeElement],
) -> tuple[LearningTrajectory, LearningTrajectoryTopic]:
    teacher: Teacher = people["teacher"]  # type: ignore[assignment]
    group: Group = people["group"]  # type: ignore[assignment]

    trajectory = LearningTrajectory(
        name="Adaptive control demo: one topic",
        status=LearningTrajectoryStatus.ACTIVE,
        graph_version=discipline.knowledge_graph_version,
        discipline_id=discipline.id,
        teacher_id=teacher.id,
        group_id=group.id,
    )
    session.add(trajectory)
    session.flush()

    trajectory_topic = LearningTrajectoryTopic(
        trajectory_id=trajectory.id,
        topic_id=topic.id,
        position=1,
        threshold=70,
    )
    session.add(trajectory_topic)
    session.flush()

    thresholds_by_key = {spec.key: spec.threshold for spec in ELEMENT_SPECS}
    for key, element in elements.items():
        session.add(
            LearningTrajectoryElement(
                trajectory_topic_id=trajectory_topic.id,
                element_id=element.id,
                threshold=thresholds_by_key[key],
            )
        )

    session.flush()
    return trajectory, trajectory_topic


def add_task(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
    checked_relations: list[KnowledgeElementRelation],
    task_type: LearningTrajectoryTaskType,
    template_kind: LearningTrajectoryTaskTemplateKind,
    title: str,
    prompt: str,
    difficulty: int,
    content: dict[str, Any],
) -> LearningTrajectoryTask:
    task = LearningTrajectoryTask(
        trajectory_id=trajectory.id,
        trajectory_topic_id=trajectory_topic.id,
        primary_element_id=primary_element.id,
        task_type=task_type,
        template_kind=template_kind,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content_json=json.dumps(content, ensure_ascii=False),
    )
    session.add(task)
    session.flush()

    seen_related_ids: set[object] = set()
    for element in related_elements:
        if element.id == primary_element.id or element.id in seen_related_ids:
            continue
        seen_related_ids.add(element.id)
        session.add(LearningTrajectoryTaskElement(task_id=task.id, element_id=element.id))

    seen_relation_ids: set[object] = set()
    for relation in checked_relations:
        if relation.id in seen_relation_ids:
            continue
        seen_relation_ids.add(relation.id)
        session.add(LearningTrajectoryTaskRelation(task_id=task.id, relation_id=relation.id))

    session.flush()
    return task


def add_single_choice_task(
    session: Session,
    tasks: dict[str, LearningTrajectoryTask],
    task_key: str,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    *,
    primary_key: str,
    option_keys: list[str],
    difficulty: int,
    title: str,
    prompt: str,
) -> None:
    primary = elements[primary_key]
    options = [elements[key] for key in option_keys]
    content = {
        "options": [
            {
                "id": str(option.id),
                "text": option.name,
                "is_correct": option.id == primary.id,
            }
            for option in options
        ],
        "correct_element_id": str(primary.id),
    }
    tasks[task_key] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=primary,
        related_elements=[option for option in options if option.id != primary.id],
        checked_relations=[],
        task_type=LearningTrajectoryTaskType.SINGLE_CHOICE,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content=content,
    )


def add_multiple_choice_task(
    session: Session,
    tasks: dict[str, LearningTrajectoryTask],
    task_key: str,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    *,
    primary_key: str,
    correct_keys: list[str],
    distractor_keys: list[str],
    difficulty: int,
    title: str,
    prompt: str,
    checked_relations: list[KnowledgeElementRelation] | None = None,
) -> None:
    related_elements = [elements[key] for key in [*correct_keys, *distractor_keys]]
    content = {
        "options": [
            {
                "id": str(elements[key].id),
                "text": elements[key].name,
                "is_correct": key in correct_keys,
            }
            for key in [*correct_keys, *distractor_keys]
        ],
        "correct_related_element_ids": [str(elements[key].id) for key in correct_keys],
        "distractor_element_ids": [str(elements[key].id) for key in distractor_keys],
    }
    tasks[task_key] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=elements[primary_key],
        related_elements=related_elements,
        checked_relations=checked_relations or [],
        task_type=LearningTrajectoryTaskType.MULTIPLE_CHOICE,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content=content,
    )


def add_matching_task(
    session: Session,
    tasks: dict[str, LearningTrajectoryTask],
    task_key: str,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    *,
    element_keys: list[str],
    difficulty: int,
    title: str,
    prompt: str,
) -> None:
    matching_elements = [elements[key] for key in element_keys]
    left = [{"id": str(element.id), "text": element.name} for element in matching_elements]
    right = [{"id": str(element.id), "text": element.description or ""} for element in matching_elements]
    RNG.shuffle(left)
    RNG.shuffle(right)
    content = {
        "left": left,
        "right": right,
        "pairs": [
            {"left_id": str(element.id), "right_id": str(element.id)}
            for element in matching_elements
        ],
    }
    tasks[task_key] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=matching_elements[0],
        related_elements=matching_elements[1:],
        checked_relations=[],
        task_type=LearningTrajectoryTaskType.MATCHING,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content=content,
    )


def add_ordering_task(
    session: Session,
    tasks: dict[str, LearningTrajectoryTask],
    task_key: str,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    relations: dict[tuple[str, str, KnowledgeElementRelationType], KnowledgeElementRelation],
    *,
    ordered_keys: list[str],
    relation_specs: list[tuple[str, str, KnowledgeElementRelationType]],
    difficulty: int,
    title: str,
    prompt: str,
) -> None:
    ordered_elements = [elements[key] for key in ordered_keys]
    items = [{"id": str(element.id), "text": element.name} for element in ordered_elements]
    RNG.shuffle(items)
    checked_relations = [relations[spec] for spec in relation_specs]
    content = {
        "items": items,
        "correct_order_ids": [str(element.id) for element in ordered_elements],
    }
    tasks[task_key] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=ordered_elements[-1],
        related_elements=ordered_elements[:-1],
        checked_relations=checked_relations,
        task_type=LearningTrajectoryTaskType.ORDERING,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content=content,
    )


def add_can_text_task(
    session: Session,
    tasks: dict[str, LearningTrajectoryTask],
    task_key: str,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    *,
    primary_key: str,
    related_keys: list[str],
    difficulty: int,
    title: str,
    prompt: str,
    input_payload: dict[str, Any],
) -> None:
    primary = elements[primary_key]
    tasks[task_key] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=primary,
        related_elements=[elements[key] for key in related_keys],
        checked_relations=[],
        task_type=LearningTrajectoryTaskType.TEXT,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content={
            "operation_ref": primary.operation_ref,
            "input_payload": input_payload,
            "placeholder": "Введите ответ в формате JSON.",
        },
    )


def add_master_text_task(
    session: Session,
    tasks: dict[str, LearningTrajectoryTask],
    task_key: str,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    relations: dict[tuple[str, str, KnowledgeElementRelationType], KnowledgeElementRelation],
    *,
    primary_key: str,
    related_keys: list[str],
    relation_specs: list[tuple[str, str, KnowledgeElementRelationType]],
    difficulty: int,
    title: str,
    prompt: str,
) -> None:
    tasks[task_key] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=elements[primary_key],
        related_elements=[elements[key] for key in related_keys],
        checked_relations=[relations[spec] for spec in relation_specs],
        task_type=LearningTrajectoryTaskType.TEXT,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content={
            "manual_review": True,
            "placeholder": "Прикрепите файл с решением и кратким пояснением.",
        },
    )


def seed_tasks(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    relations: dict[tuple[str, str, KnowledgeElementRelationType], KnowledgeElementRelation],
) -> dict[str, LearningTrajectoryTask]:
    tasks: dict[str, LearningTrajectoryTask] = {}

    add_single_choice_task(
        session,
        tasks,
        "graph_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="graph",
        option_keys=["graph", "vertex", "edge", "path"],
        difficulty=22,
        title="Граф: вариант A",
        prompt="Выбери понятие, которое обозначает структуру из вершин и связей между ними.",
    )
    add_single_choice_task(
        session,
        tasks,
        "graph_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="graph",
        option_keys=["graph", "cycle", "shortest_path", "weighted_graph"],
        difficulty=22,
        title="Граф: вариант B",
        prompt="Как называется базовый объект теории графов, состоящий из множества вершин и рёбер?",
    )
    add_single_choice_task(
        session,
        tasks,
        "graph_choice_c",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="graph",
        option_keys=["graph", "directed_graph", "spanning_tree", "vertex_degree"],
        difficulty=22,
        title="Граф: вариант C",
        prompt="Найди общее понятие, для которого вершины и рёбра являются составными частями.",
    )
    add_single_choice_task(
        session,
        tasks,
        "vertex_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="vertex",
        option_keys=["vertex", "edge", "path", "cycle"],
        difficulty=24,
        title="Вершина: вариант A",
        prompt="Выбери понятие, которое обозначает узел графовой модели.",
    )
    add_single_choice_task(
        session,
        tasks,
        "vertex_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="vertex",
        option_keys=["vertex", "graph", "adjacency", "incidence"],
        difficulty=24,
        title="Вершина: вариант B",
        prompt="Как называется базовый объект, к которому могут быть инцидентны рёбра?",
    )
    add_single_choice_task(
        session,
        tasks,
        "edge_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="edge",
        option_keys=["edge", "adjacency", "incidence", "path"],
        difficulty=25,
        title="Ребро: вариант A",
        prompt="Выбери понятие, которое задаёт связь между двумя вершинами.",
    )
    add_single_choice_task(
        session,
        tasks,
        "edge_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="edge",
        option_keys=["edge", "vertex", "shortest_path", "weighted_graph"],
        difficulty=25,
        title="Ребро: вариант B",
        prompt="Как называется связь в неориентированном графе?",
    )
    add_single_choice_task(
        session,
        tasks,
        "edge_choice_c",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="edge",
        option_keys=["edge", "cycle", "directed_graph", "spanning_tree"],
        difficulty=25,
        title="Ребро: вариант C",
        prompt="Найди термин для связи, которая соединяет две вершины.",
    )
    add_single_choice_task(
        session,
        tasks,
        "adjacency_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="adjacency",
        option_keys=["adjacency", "incidence", "edge", "path"],
        difficulty=28,
        title="Смежность: вариант A",
        prompt="Как называется отношение между двумя вершинами, если они соединены ребром?",
    )
    add_single_choice_task(
        session,
        tasks,
        "adjacency_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="adjacency",
        option_keys=["adjacency", "incidence", "cycle", "directed_graph"],
        difficulty=28,
        title="Смежность: вариант B",
        prompt="Выбери термин для отношения между вершинами, а не между вершиной и ребром.",
    )
    add_single_choice_task(
        session,
        tasks,
        "adjacency_choice_c",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="adjacency",
        option_keys=["adjacency", "incidence", "vertex_degree", "shortest_path"],
        difficulty=28,
        title="Смежность: вариант C",
        prompt="Что проверяют, когда хотят узнать, соединены ли две вершины ребром?",
    )
    add_single_choice_task(
        session,
        tasks,
        "incidence_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="incidence",
        option_keys=["incidence", "adjacency", "edge", "path"],
        difficulty=29,
        title="Инцидентность: вариант A",
        prompt="Как называется отношение между вершиной и ребром?",
    )
    add_single_choice_task(
        session,
        tasks,
        "incidence_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="incidence",
        option_keys=["incidence", "adjacency", "cycle", "shortest_path"],
        difficulty=29,
        title="Инцидентность: вариант B",
        prompt="Выбери термин для отношения между объектом и его концами ребра.",
    )
    add_single_choice_task(
        session,
        tasks,
        "path_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="path",
        option_keys=["path", "cycle", "shortest_path", "spanning_tree"],
        difficulty=31,
        title="Путь: вариант A",
        prompt="Как называется последовательность вершин и рёбер от одной вершины к другой?",
    )
    add_single_choice_task(
        session,
        tasks,
        "path_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="path",
        option_keys=["path", "adjacency", "vertex_degree", "shortest_path"],
        difficulty=31,
        title="Путь: вариант B",
        prompt="Выбери общее понятие, частным случаем которого является кратчайший путь.",
    )
    add_single_choice_task(
        session,
        tasks,
        "cycle_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="cycle",
        option_keys=["cycle", "path", "spanning_tree", "shortest_path"],
        difficulty=33,
        title="Цикл: вариант A",
        prompt="Как называется путь, который начинается и заканчивается в одной вершине?",
    )
    add_single_choice_task(
        session,
        tasks,
        "directed_graph_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="directed_graph",
        option_keys=["directed_graph", "graph", "edge", "vertex"],
        difficulty=34,
        title="Ориентированный граф: вариант A",
        prompt="Выбери понятие, где связи имеют направление.",
    )
    add_single_choice_task(
        session,
        tasks,
        "directed_graph_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="directed_graph",
        option_keys=["directed_graph", "weighted_graph", "cycle", "adjacency"],
        difficulty=34,
        title="Ориентированный граф: вариант B",
        prompt="Как называется граф, в котором у связи различают начало и конец?",
    )
    add_single_choice_task(
        session,
        tasks,
        "weighted_graph_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="weighted_graph",
        option_keys=["weighted_graph", "graph", "shortest_path", "spanning_tree"],
        difficulty=35,
        title="Взвешенный граф: вариант A",
        prompt="Как называется граф, в котором рёбрам или вершинам приписаны веса?",
    )
    add_single_choice_task(
        session,
        tasks,
        "vertex_degree_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="vertex_degree",
        option_keys=["vertex_degree", "edge", "incidence", "adjacency"],
        difficulty=36,
        title="Степень вершины: вариант A",
        prompt="Выбери термин для числа рёбер, инцидентных вершине.",
    )
    add_single_choice_task(
        session,
        tasks,
        "vertex_degree_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="vertex_degree",
        option_keys=["vertex_degree", "path", "cycle", "weighted_graph"],
        difficulty=36,
        title="Степень вершины: вариант B",
        prompt="Как называется локальная характеристика вершины, считающая её связи?",
    )
    add_single_choice_task(
        session,
        tasks,
        "spanning_tree_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="spanning_tree",
        option_keys=["spanning_tree", "cycle", "path", "graph"],
        difficulty=38,
        title="Остовное дерево: вариант A",
        prompt="Как называется подграф без циклов, содержащий все вершины исходного графа?",
    )
    add_single_choice_task(
        session,
        tasks,
        "shortest_path_choice_a",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="shortest_path",
        option_keys=["shortest_path", "path", "cycle", "weighted_graph"],
        difficulty=39,
        title="Кратчайший путь: вариант A",
        prompt="Выбери путь с минимальной суммарной длиной или стоимостью.",
    )
    add_single_choice_task(
        session,
        tasks,
        "shortest_path_choice_b",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="shortest_path",
        option_keys=["shortest_path", "spanning_tree", "path", "vertex_degree"],
        difficulty=39,
        title="Кратчайший путь: вариант B",
        prompt="Как называется оптимальный по длине путь между вершинами?",
    )

    add_multiple_choice_task(
        session,
        tasks,
        "graph_parts_multi",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="graph",
        correct_keys=["vertex", "edge"],
        distractor_keys=["path", "cycle", "shortest_path"],
        difficulty=30,
        title="Граф: составные части",
        prompt="Выбери элементы, которые непосредственно входят в базовое описание графа.",
        checked_relations=[
            relations[("graph", "vertex", KnowledgeElementRelationType.CONTAINS)],
            relations[("graph", "edge", KnowledgeElementRelationType.CONTAINS)],
        ],
    )
    add_multiple_choice_task(
        session,
        tasks,
        "path_components_multi",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="path",
        correct_keys=["adjacency", "edge"],
        distractor_keys=["weighted_graph", "spanning_tree", "vertex_degree"],
        difficulty=37,
        title="Путь: опорные понятия",
        prompt="Выбери понятия, без которых нельзя корректно объяснить обычный путь в графе.",
        checked_relations=[
            relations[("path", "adjacency", KnowledgeElementRelationType.BUILDS_ON)],
        ],
    )
    add_multiple_choice_task(
        session,
        tasks,
        "shortest_path_multi",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="shortest_path",
        correct_keys=["path", "weighted_graph"],
        distractor_keys=["incidence", "vertex", "cycle"],
        difficulty=42,
        title="Кратчайший путь: ключевые идеи",
        prompt="Что действительно связано с понятием кратчайшего пути?",
        checked_relations=[
            relations[("shortest_path", "path", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("weighted_graph", "shortest_path", KnowledgeElementRelationType.USED_WITH)],
        ],
    )
    add_multiple_choice_task(
        session,
        tasks,
        "directed_graph_multi",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="directed_graph",
        correct_keys=["graph", "vertex_degree"],
        distractor_keys=["cycle", "spanning_tree", "weighted_graph"],
        difficulty=40,
        title="Ориентированный граф: связанные идеи",
        prompt="Выбери понятия, которые помогают анализировать ориентированный граф.",
    )

    add_matching_task(
        session,
        tasks,
        "structure_matching",
        trajectory,
        trajectory_topic,
        elements,
        element_keys=["graph", "vertex", "edge", "adjacency"],
        difficulty=34,
        title="Сопоставление: базовая структура",
        prompt="Сопоставь базовые понятия и их определения.",
    )
    add_matching_task(
        session,
        tasks,
        "traversal_matching",
        trajectory,
        trajectory_topic,
        elements,
        element_keys=["path", "cycle", "shortest_path", "spanning_tree"],
        difficulty=43,
        title="Сопоставление: пути и структуры",
        prompt="Сопоставь понятия, связанные с путями и подграфами.",
    )
    add_matching_task(
        session,
        tasks,
        "representation_matching",
        trajectory,
        trajectory_topic,
        elements,
        element_keys=["incidence", "weighted_graph", "vertex_degree", "directed_graph"],
        difficulty=41,
        title="Сопоставление: представления и свойства",
        prompt="Сопоставь понятия, связанные с представлением графа и его свойствами.",
    )

    add_ordering_task(
        session,
        tasks,
        "shortest_path_ordering",
        trajectory,
        trajectory_topic,
        elements,
        relations,
        ordered_keys=["graph", "adjacency", "path", "shortest_path"],
        relation_specs=[
            ("path", "adjacency", KnowledgeElementRelationType.BUILDS_ON),
            ("shortest_path", "path", KnowledgeElementRelationType.BUILDS_ON),
        ],
        difficulty=45,
        title="Порядок зависимостей: к кратчайшему пути",
        prompt="Расположи понятия от более базового к более производному.",
    )
    add_ordering_task(
        session,
        tasks,
        "representation_ordering",
        trajectory,
        trajectory_topic,
        elements,
        relations,
        ordered_keys=["graph", "edge", "incidence"],
        relation_specs=[
            ("incidence", "edge", KnowledgeElementRelationType.RELIES_ON),
        ],
        difficulty=38,
        title="Порядок зависимостей: инцидентность",
        prompt="Расположи понятия по логике объяснения от общего к зависимому.",
    )
    add_ordering_task(
        session,
        tasks,
        "cycle_ordering",
        trajectory,
        trajectory_topic,
        elements,
        relations,
        ordered_keys=["graph", "path", "cycle"],
        relation_specs=[
            ("cycle", "path", KnowledgeElementRelationType.BUILDS_ON),
        ],
        difficulty=40,
        title="Порядок зависимостей: цикл",
        prompt="Расположи понятия так, чтобы цикл оказался после своих смысловых оснований.",
    )

    add_can_text_task(
        session,
        tasks,
        "can_adjacency_matrix_text",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="identify_adjacency_structure",
        related_keys=["adjacency", "graph", "vertex", "edge"],
        difficulty=48,
        title="Уметь: матрица смежности",
        prompt="Построй матрицу смежности по описанию неориентированного графа.",
        input_payload={
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "A", "target": "D"},
            ],
            "directed": False,
        },
    )
    add_can_text_task(
        session,
        tasks,
        "can_incidence_matrix_text",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="build_incidence_representation",
        related_keys=["incidence", "edge", "directed_graph"],
        difficulty=52,
        title="Уметь: матрица инцидентности",
        prompt="Построй матрицу инцидентности для ориентированного графа.",
        input_payload={
            "vertices": ["A", "B", "C"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "A", "target": "C"},
            ],
            "directed": True,
        },
    )
    add_can_text_task(
        session,
        tasks,
        "can_degree_sequence_text",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="compute_degree_sequence",
        related_keys=["vertex_degree", "edge", "graph"],
        difficulty=50,
        title="Уметь: степени вершин",
        prompt="Вычисли степени вершин в неориентированном графе.",
        input_payload={
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "C", "target": "D"},
            ],
            "directed": False,
        },
    )
    add_can_text_task(
        session,
        tasks,
        "can_directed_degree_text",
        trajectory,
        trajectory_topic,
        elements,
        primary_key="analyze_directed_degrees",
        related_keys=["directed_graph", "vertex_degree", "edge"],
        difficulty=54,
        title="Уметь: входящие и исходящие степени",
        prompt="Для орграфа найди входящие и исходящие степени вершин.",
        input_payload={
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "C", "target": "A"},
                {"source": "D", "target": "C"},
            ],
            "directed": True,
        },
    )

    add_master_text_task(
        session,
        tasks,
        "master_delivery_network",
        trajectory,
        trajectory_topic,
        elements,
        relations,
        primary_key="model_delivery_network",
        related_keys=["weighted_graph", "shortest_path", "identify_adjacency_structure"],
        relation_specs=[
            ("model_delivery_network", "identify_adjacency_structure", KnowledgeElementRelationType.AUTOMATES),
            ("model_delivery_network", "weighted_graph", KnowledgeElementRelationType.RELIES_ON),
            ("model_delivery_network", "shortest_path", KnowledgeElementRelationType.RELIES_ON),
        ],
        difficulty=66,
        title="Владеть: сеть доставки",
        prompt=(
            "Смоделируй графом сеть доставки между складами и пунктами выдачи, "
            "объясни выбор вершин, рёбер и весов."
        ),
    )
    add_master_text_task(
        session,
        tasks,
        "master_route_justification",
        trajectory,
        trajectory_topic,
        elements,
        relations,
        primary_key="justify_route_choice",
        related_keys=["path", "vertex_degree", "analyze_directed_degrees"],
        relation_specs=[
            ("justify_route_choice", "analyze_directed_degrees", KnowledgeElementRelationType.AUTOMATES),
            ("justify_route_choice", "path", KnowledgeElementRelationType.RELIES_ON),
            ("justify_route_choice", "vertex_degree", KnowledgeElementRelationType.RELIES_ON),
        ],
        difficulty=68,
        title="Владеть: обоснование маршрута",
        prompt=(
            "Опиши, почему найденный маршрут в ориентированной транспортной сети является разумным "
            "с точки зрения структуры графа."
        ),
    )

    session.flush()
    return tasks


def mastery_profile(
    *,
    know: int,
    can: int,
    master: int,
) -> dict[str, int]:
    result: dict[str, int] = {}
    for spec in ELEMENT_SPECS:
        if spec.competence_type == CompetenceType.KNOW:
            result[spec.key] = know
        elif spec.competence_type == CompetenceType.CAN:
            result[spec.key] = can
        else:
            result[spec.key] = master
    return result


def create_progress_with_attempt(
    session: Session,
    student: Student,
    task: LearningTrajectoryTask,
    *,
    answered_at: datetime,
    score: int,
    duration_seconds: int | None,
    answer_payload: dict[str, Any],
    feedback: dict[str, Any],
    status: StudentTaskProgressStatus,
    best_score: int | None = None,
    completed_at: datetime | None = None,
) -> None:
    instance = StudentTaskInstance(
        student_id=student.id,
        task_id=task.id,
        content_snapshot_json=task.content_json,
        issued_at=answered_at - timedelta(seconds=max(duration_seconds or 15, 1)),
        answered_at=answered_at,
    )
    session.add(instance)
    session.flush()

    session.add(
        StudentTaskAttempt(
            instance_id=instance.id,
            student_id=student.id,
            task_id=task.id,
            answer_payload_json=json.dumps(answer_payload, ensure_ascii=False),
            feedback_json=json.dumps(feedback, ensure_ascii=False),
            score=score,
            duration_seconds=duration_seconds,
            answered_at=answered_at,
        )
    )
    session.add(
        StudentTaskProgress(
            student_id=student.id,
            task_id=task.id,
            status=status,
            attempts_count=1,
            last_score=score,
            best_score=score if best_score is None else best_score,
            last_answered_at=answered_at,
            completed_at=completed_at,
            last_answer_payload=json.dumps(answer_payload, ensure_ascii=False),
            last_feedback_json=json.dumps(feedback, ensure_ascii=False),
        )
    )


def create_pending_review_progress(
    session: Session,
    student: Student,
    task: LearningTrajectoryTask,
    *,
    answered_at: datetime,
) -> None:
    answer_payload = {
        "submission_kind": "file",
        "stored_path": "uploads/demo/master_delivery_network_solution.pdf",
        "original_name": "master_delivery_network_solution.pdf",
        "mime_type": "application/pdf",
        "size_bytes": 24576,
        "uploaded_at": answered_at.isoformat(),
    }
    feedback = {
        "manual_review": True,
        "pending_review": True,
        "summary": "Файл отправлен и ожидает ручной проверки преподавателем.",
    }
    create_progress_with_attempt(
        session=session,
        student=student,
        task=task,
        answered_at=answered_at,
        score=100,
        duration_seconds=None,
        answer_payload=answer_payload,
        feedback=feedback,
        status=StudentTaskProgressStatus.PENDING_REVIEW,
        best_score=100,
        completed_at=None,
    )


def seed_student_mastery_and_progress(
    session: Session,
    discipline: Discipline,
    trajectory: LearningTrajectory,
    people: dict[str, object],
    elements: dict[str, KnowledgeElement],
    tasks: dict[str, LearningTrajectoryTask],
) -> None:
    students: list[Student] = people["students"]  # type: ignore[assignment]
    student_by_login = {student.login: student for student in students}

    profiles = {
        "adaptive_fresh": mastery_profile(know=0, can=0, master=0),
        "adaptive_error": mastery_profile(know=75, can=10, master=0),
        "adaptive_fragile": mastery_profile(know=76, can=10, master=0),
        "adaptive_can": mastery_profile(know=82, can=25, master=0),
        "adaptive_master": mastery_profile(know=92, can=88, master=20),
    }

    for login, profile in profiles.items():
        student = student_by_login[login]
        for key, element in elements.items():
            session.add(
                StudentElementMastery(
                    student_id=student.id,
                    discipline_id=discipline.id,
                    element_id=element.id,
                    mastery_value=profile.get(key, 0),
                )
            )

    now = utcnow_naive()
    create_progress_with_attempt(
        session=session,
        student=student_by_login["adaptive_error"],
        task=tasks["adjacency_choice_a"],
        answered_at=now - timedelta(minutes=12),
        score=0,
        duration_seconds=21,
        answer_payload={
            "selected_option_ids": [str(elements["incidence"].id)],
        },
        feedback={
            "is_correct": False,
            "summary": "Перепутана смежность с инцидентностью.",
            "error_signature": f"choice:wrong_option:{elements['incidence'].id}",
            "focus_element_ids": [str(elements["incidence"].id)],
            "adaptive_signal": {
                "kind": "error",
                "error_signature": f"choice:wrong_option:{elements['incidence'].id}",
                "focus_element_ids": [str(elements["incidence"].id)],
            },
            "duration_seconds": 21,
        },
        status=StudentTaskProgressStatus.IN_PROGRESS,
    )
    create_progress_with_attempt(
        session=session,
        student=student_by_login["adaptive_fragile"],
        task=tasks["edge_choice_a"],
        answered_at=now - timedelta(minutes=9),
        score=100,
        duration_seconds=95,
        answer_payload={
            "selected_option_ids": [str(elements["edge"].id)],
        },
        feedback={
            "is_correct": True,
            "summary": "Ответ верный, но слишком медленный для устойчивого mastery.",
            "adaptive_signal": {
                "kind": "fragile_success",
                "duration_seconds": 95,
                "expected_duration_seconds": 40,
            },
            "duration_seconds": 95,
        },
        status=StudentTaskProgressStatus.COMPLETED,
        completed_at=now - timedelta(minutes=9),
    )
    create_progress_with_attempt(
        session=session,
        student=student_by_login["adaptive_can"],
        task=tasks["graph_choice_a"],
        answered_at=now - timedelta(days=1),
        score=100,
        duration_seconds=18,
        answer_payload={
            "selected_option_ids": [str(elements["graph"].id)],
        },
        feedback={
            "is_correct": True,
            "summary": "Демонстрационная успешная попытка.",
            "duration_seconds": 18,
        },
        status=StudentTaskProgressStatus.COMPLETED,
        completed_at=now - timedelta(days=1),
    )
    create_pending_review_progress(
        session=session,
        student=student_by_login["adaptive_master"],
        task=tasks["master_delivery_network"],
        answered_at=now - timedelta(minutes=30),
    )

    session.flush()


def print_seed_summary(
    session: Session,
    discipline: Discipline,
    trajectory: LearningTrajectory,
    topic: Topic,
    tasks: dict[str, LearningTrajectoryTask],
    people: dict[str, object],
) -> None:
    students: list[Student] = people["students"]  # type: ignore[assignment]
    teacher: Teacher = people["teacher"]  # type: ignore[assignment]
    know_count = sum(1 for spec in ELEMENT_SPECS if spec.competence_type == CompetenceType.KNOW)
    can_count = sum(1 for spec in ELEMENT_SPECS if spec.competence_type == CompetenceType.CAN)
    master_count = sum(1 for spec in ELEMENT_SPECS if spec.competence_type == CompetenceType.MASTER)

    print("\n=== Adaptive control single-topic seed ===")
    print(f"Database: {DB_PATH.resolve()}")
    print(f"Discipline: {discipline.name}")
    print(f"Topic: {topic.name}")
    print(f"Trajectory: {trajectory.name}")
    print(f"Elements: know={know_count}, can={can_count}, master={master_count}")
    print(f"Knowledge relations: {session.query(KnowledgeElementRelation).count()}")
    print(f"Tasks total: {len(tasks)}")
    print(
        "Tasks by type: "
        f"single_choice={sum(1 for task in tasks.values() if task.task_type == LearningTrajectoryTaskType.SINGLE_CHOICE)}, "
        f"multiple_choice={sum(1 for task in tasks.values() if task.task_type == LearningTrajectoryTaskType.MULTIPLE_CHOICE)}, "
        f"matching={sum(1 for task in tasks.values() if task.task_type == LearningTrajectoryTaskType.MATCHING)}, "
        f"ordering={sum(1 for task in tasks.values() if task.task_type == LearningTrajectoryTaskType.ORDERING)}, "
        f"text={sum(1 for task in tasks.values() if task.task_type == LearningTrajectoryTaskType.TEXT)}"
    )
    print(f"Students: {len(students)}")
    print("\nLogins:")
    print(f"  {teacher.login} / {teacher.password}")
    for student in students:
        print(f"  {student.login} / {student.password}")

    print("\nManual QA scenarios:")
    print("  adaptive_fresh   -> старт с нуля; проверяй random tie-breaking и перемешивание вариантов.")
    print("  adaptive_error   -> у студента свежая ошибка по 'Смежности'; следующее задание должно снова бить в этот дефицит.")
    print("  adaptive_fragile -> у студента медленный, но правильный ответ по 'Ребру'; должно прийти подтверждающее задание.")
    print("  adaptive_can     -> все know-пороги уже закрыты; можно руками смотреть переход к заданиям 'Уметь'.")
    print("  adaptive_master  -> know/can уже закрыты; одно master-задание pending_review, второе должно оставаться доступным.")


if __name__ == "__main__":
    recreate_database()
