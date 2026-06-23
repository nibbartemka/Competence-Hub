from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

# Allow running the script directly from the seeds folder.
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core import Base
from app.algorithm_library import get_operation_contract
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
    TopicKnowledgeElementRole,
)


DEFAULT_DB_PATH = Path(
    os.environ.get(
        "COMPETENCE_HUB_DB_PATH",
        str(ROOT_DIR / "app_control_transition_demo.db"),
    )
)
DATABASE_URL = os.environ.get(
    "COMPETENCE_HUB_DATABASE_URL",
    f"sqlite:///{DEFAULT_DB_PATH.as_posix()}",
)


@dataclass(frozen=True)
class ElementSpec:
    key: str
    name: str
    description: str
    competence_type: CompetenceType
    threshold: int
    operation_ref: str | None = None
    subject_area_description: str | None = None


ELEMENT_SPECS: tuple[ElementSpec, ...] = (
    ElementSpec(
        key="graph",
        name="Граф",
        description="Структура из вершин и связей между ними.",
        competence_type=CompetenceType.KNOW,
        threshold=70,
    ),
    ElementSpec(
        key="vertex",
        name="Вершина",
        description="Узел графовой модели.",
        competence_type=CompetenceType.KNOW,
        threshold=70,
    ),
    ElementSpec(
        key="edge",
        name="Ребро",
        description="Связь между двумя вершинами.",
        competence_type=CompetenceType.KNOW,
        threshold=70,
    ),
    ElementSpec(
        key="adjacency",
        name="Смежность",
        description="Отношение между вершинами, соединенными ребром.",
        competence_type=CompetenceType.KNOW,
        threshold=70,
    ),
    ElementSpec(
        key="route",
        name="Маршрут в графе",
        description="Последовательность переходов по вершинам и ребрам.",
        competence_type=CompetenceType.KNOW,
        threshold=70,
    ),
    ElementSpec(
        key="build_adjacency_matrix",
        name="Строить матрицу смежности графа",
        description="Умение по описанию графа построить корректную матрицу смежности.",
        competence_type=CompetenceType.CAN,
        threshold=75,
        operation_ref="graph.operation.build_adjacency_matrix",
    ),
    ElementSpec(
        key="model_route_case",
        name="Моделировать прикладную задачу маршрута графом",
        description="Владение переводом прикладного кейса в графовую модель маршрутов.",
        competence_type=CompetenceType.MASTER,
        threshold=80,
        subject_area_description=(
            "Нужно описать, как представить сеть перемещений в виде графа: "
            "что будет вершинами, ребрами и по каким признакам выбирать маршрут."
        ),
    ),
    ElementSpec(
        key="justify_route_case",
        name="Обосновывать выбор маршрута в графовой модели",
        description="Владение аргументацией, почему выбранный маршрут корректен и уместен.",
        competence_type=CompetenceType.MASTER,
        threshold=80,
        subject_area_description=(
            "Нужно объяснить, почему выбранный маршрут лучше альтернатив и на какие свойства графа опирается решение."
        ),
    ),
)


RELATION_DIRECTION_BY_TYPE: dict[KnowledgeElementRelationType, RelationDirectionType] = {
    KnowledgeElementRelationType.CONTAINS: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.BUILDS_ON: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.RELIES_ON: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.AUTOMATES: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.IMPLEMENTS: RelationDirectionType.ONE_DIRECTION,
}


def recreate_database() -> None:
    seed_database(recreate=True)


def env_flag(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def describe_database(database_url: str) -> str:
    url = make_url(database_url)
    if url.drivername.startswith("sqlite"):
        db_path = Path(url.database or DEFAULT_DB_PATH.as_posix())
        return str(db_path.resolve())
    return url.render_as_string(hide_password=True)


def seed_database(
    database_url: str = DATABASE_URL,
    *,
    recreate: bool = False,
    only_if_empty: bool = False,
) -> bool:
    url = make_url(database_url)
    if recreate and url.drivername.startswith("sqlite"):
        db_path = Path(url.database or DEFAULT_DB_PATH.as_posix())
        db_path.parent.mkdir(parents=True, exist_ok=True)
        if db_path.exists():
            db_path.unlink()

    engine = create_engine(database_url, echo=False, future=True)
    Base.metadata.create_all(engine)

    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    with session_local() as session:
        if only_if_empty and session.scalar(select(Discipline.id).limit(1)) is not None:
            print(f"Skip seed: database already contains disciplines ({describe_database(database_url)})")
            return False

        seed_data(session)
        session.commit()

    print(f"Database seeded: {describe_database(database_url)}")
    return True


def seed_data(session: Session) -> None:
    discipline = seed_discipline(session)
    people = seed_people(session, discipline)
    relation_catalog = seed_relation_catalog(session)
    topic, elements = seed_topic_and_elements(session, discipline)
    relations = seed_element_relations(session, topic, elements, relation_catalog)
    trajectory, trajectory_topic = seed_learning_trajectory(session, discipline, people, topic, elements)
    tasks = seed_tasks(session, trajectory, trajectory_topic, elements, relations)
    seed_student_mastery(session, discipline, people, elements)
    print_seed_summary(discipline, people, tasks)


def seed_discipline(session: Session) -> Discipline:
    name = "Адаптивный контроль. Демонстрация перехода знать-уметь-владеть"
    discipline = Discipline(
        name=name,
        slug=transliterate_to_slug_base(name),
        knowledge_graph_version=1,
    )
    session.add(discipline)
    session.flush()
    return discipline


def seed_people(session: Session, discipline: Discipline) -> dict[str, object]:
    group = Group(name="АДП-DEMO-01")
    session.add(group)
    session.flush()

    subgroup = Subgroup(subgroup_num=1, group_id=group.id)
    teacher = Teacher(
        name="Преподаватель Demo Control",
        login="demo_teacher",
        password="demo_teacher",
    )
    students = [
        Student(
            name="Demo Know Stage",
            login="demo_transition_know",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Demo Can Stage",
            login="demo_transition_can",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Demo Master Stage 1",
            login="demo_transition_master1",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Demo Master Stage 2",
            login="demo_transition_master2",
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
        relation = Relation(relation_type=relation_type, direction=direction)
        session.add(relation)
        relations[relation_type] = relation
    session.flush()
    return relations


def seed_topic_and_elements(
    session: Session,
    discipline: Discipline,
) -> tuple[Topic, dict[str, KnowledgeElement]]:
    topic = Topic(
        name="Тема 1. Представление графа и выбор маршрута",
        description=(
            "Компактная тема для ручной проверки adaptive control: "
            "сначала пять элементов знать, затем один уметь, затем два владеть."
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
    relation_specs = [
        ("graph", "vertex", KnowledgeElementRelationType.CONTAINS, "Граф содержит вершины."),
        ("graph", "edge", KnowledgeElementRelationType.CONTAINS, "Граф содержит ребра."),
        ("adjacency", "edge", KnowledgeElementRelationType.BUILDS_ON, "Смежность определяется через наличие ребра."),
        ("route", "adjacency", KnowledgeElementRelationType.BUILDS_ON, "Маршрут собирается из переходов по смежным вершинам."),
        ("build_adjacency_matrix", "graph", KnowledgeElementRelationType.BUILDS_ON, "Построение матрицы смежности требует понимания модели графа."),
        ("build_adjacency_matrix", "vertex", KnowledgeElementRelationType.BUILDS_ON, "Построение матрицы смежности опирается на понимание вершин."),
        ("build_adjacency_matrix", "edge", KnowledgeElementRelationType.BUILDS_ON, "Построение матрицы смежности опирается на понимание ребер."),
        ("build_adjacency_matrix", "adjacency", KnowledgeElementRelationType.IMPLEMENTS, "Умение реализует построение матрицы смежности."),
        ("model_route_case", "build_adjacency_matrix", KnowledgeElementRelationType.BUILDS_ON, "Моделирование кейса требует сначала уметь строить матрицу смежности."),
        ("model_route_case", "route", KnowledgeElementRelationType.BUILDS_ON, "Моделирование кейса требует понимания маршрута."),
        ("model_route_case", "graph", KnowledgeElementRelationType.RELIES_ON, "Прикладной кейс опирается на понятие графа."),
        ("justify_route_case", "model_route_case", KnowledgeElementRelationType.BUILDS_ON, "Обоснование маршрута идет после построения модели."),
        ("justify_route_case", "route", KnowledgeElementRelationType.BUILDS_ON, "Обоснование маршрута требует понимания маршрута."),
        ("justify_route_case", "adjacency", KnowledgeElementRelationType.RELIES_ON, "Обоснование использует структуру смежности."),
    ]

    relations: dict[tuple[str, str, KnowledgeElementRelationType], KnowledgeElementRelation] = {}
    for source_key, target_key, relation_type, description in relation_specs:
        relation = KnowledgeElementRelation(
            topic_id=topic.id,
            source_element_id=elements[source_key].id,
            target_element_id=elements[target_key].id,
            relation_id=relation_catalog[relation_type].id,
            description=description,
        )
        session.add(relation)
        relations[(source_key, target_key, relation_type)] = relation

    session.flush()
    return relations


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
        name="Control transition demo",
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
    title: str,
    prompt: str,
    difficulty: int,
    content: dict[str, Any],
) -> LearningTrajectoryTask:
    if task_type == LearningTrajectoryTaskType.TEXT:
        operation_ref = str(content.get("operation_ref", "")).strip()
        if operation_ref:
            contract = get_operation_contract(operation_ref)
            input_payload = content.get("input_payload")
            if contract is not None and isinstance(input_payload, dict):
                content = {
                    **content,
                    "contract_title": contract.title,
                    "input_schema": contract.input_schema,
                    "output_schema": contract.output_schema,
                    "expected_output": contract.executor(input_payload),
                }

    task = LearningTrajectoryTask(
        trajectory_id=trajectory.id,
        trajectory_topic_id=trajectory_topic.id,
        primary_element_id=primary_element.id,
        task_type=task_type,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content_json=json.dumps(content, ensure_ascii=False),
    )
    session.add(task)
    session.flush()

    for element in related_elements:
        if element.id == primary_element.id:
            continue
        session.add(LearningTrajectoryTaskElement(task_id=task.id, element_id=element.id))

    for relation in checked_relations:
        session.add(LearningTrajectoryTaskRelation(task_id=task.id, relation_id=relation.id))

    session.flush()
    return task


def seed_tasks(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements: dict[str, KnowledgeElement],
    relations: dict[tuple[str, str, KnowledgeElementRelationType], KnowledgeElementRelation],
) -> dict[str, LearningTrajectoryTask]:
    tasks: dict[str, LearningTrajectoryTask] = {}

    know_specs = [
        ("graph", ["graph", "vertex", "edge", "route"], "Что из перечисленного обозначает всю структуру из вершин и связей?"),
        ("vertex", ["edge", "vertex", "adjacency", "route"], "Как называется узел графовой модели?"),
        ("edge", ["graph", "route", "edge", "adjacency"], "Как называется связь между двумя вершинами?"),
        ("adjacency", ["route", "adjacency", "vertex", "graph"], "Как называется отношение между вершинами, соединенными ребром?"),
        ("route", ["edge", "graph", "route", "vertex"], "Как называется последовательность переходов по графу?"),
    ]
    for key, option_keys, prompt in know_specs:
        primary = elements[key]
        options = [elements[option_key] for option_key in option_keys]
        tasks[f"{key}_choice"] = add_task(
            session=session,
            trajectory=trajectory,
            trajectory_topic=trajectory_topic,
            primary_element=primary,
            related_elements=[option for option in options if option.id != primary.id],
            checked_relations=[],
            task_type=LearningTrajectoryTaskType.SINGLE_CHOICE,
            title=f"Знать: {primary.name}",
            prompt=prompt,
            difficulty=24,
            content={
                "options": [
                    {
                        "id": str(option.id),
                        "text": option.name,
                        "is_correct": option.id == primary.id,
                    }
                    for option in options
                ],
                "correct_element_id": str(primary.id),
            },
        )

    tasks["build_adjacency_matrix_text"] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=elements["build_adjacency_matrix"],
        related_elements=[
            elements["graph"],
            elements["vertex"],
            elements["edge"],
            elements["adjacency"],
        ],
        checked_relations=[
            relations[("build_adjacency_matrix", "graph", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("build_adjacency_matrix", "vertex", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("build_adjacency_matrix", "edge", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("build_adjacency_matrix", "adjacency", KnowledgeElementRelationType.IMPLEMENTS)],
        ],
        task_type=LearningTrajectoryTaskType.TEXT,
        title="Уметь: построить матрицу смежности",
        prompt=(
            "Для неориентированного графа с вершинами A, B, C, D и ребрами A-B, A-C, B-D построй матрицу смежности "
            "в порядке вершин A, B, C, D."
        ),
        difficulty=38,
        content={
            "operation_ref": elements["build_adjacency_matrix"].operation_ref,
            "input_payload": {
                "vertices": ["A", "B", "C", "D"],
                "edges": [
                    {"source": "A", "target": "B"},
                    {"source": "A", "target": "C"},
                    {"source": "B", "target": "D"},
                ],
                "directed": False,
            },
            "placeholder": "Введите JSON с полями vertices и values.",
        },
    )

    tasks["model_route_case_text"] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=elements["model_route_case"],
        related_elements=[
            elements["build_adjacency_matrix"],
            elements["route"],
            elements["graph"],
        ],
        checked_relations=[
            relations[("model_route_case", "build_adjacency_matrix", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("model_route_case", "route", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("model_route_case", "graph", KnowledgeElementRelationType.RELIES_ON)],
        ],
        task_type=LearningTrajectoryTaskType.TEXT,
        title="Владеть: построить модель маршрута",
        prompt=(
            "Опиши, как представить маршрут курьера между четырьмя точками в виде графа: "
            "что будет вершинами, какие ребра нужны и какие ограничения важны."
        ),
        difficulty=40,
        content={
            "manual_review": True,
            "placeholder": "Кратко опишите модель и логику выбора структуры графа.",
        },
    )

    tasks["justify_route_case_text"] = add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=elements["justify_route_case"],
        related_elements=[
            elements["model_route_case"],
            elements["route"],
            elements["adjacency"],
        ],
        checked_relations=[
            relations[("justify_route_case", "model_route_case", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("justify_route_case", "route", KnowledgeElementRelationType.BUILDS_ON)],
            relations[("justify_route_case", "adjacency", KnowledgeElementRelationType.RELIES_ON)],
        ],
        task_type=LearningTrajectoryTaskType.TEXT,
        title="Владеть: обосновать маршрут",
        prompt=(
            "Предположим, что модель маршрута уже построена. Объясни, почему выбранный путь корректен, "
            "какие смежности он использует и почему альтернативный путь хуже."
        ),
        difficulty=40,
        content={
            "manual_review": True,
            "placeholder": "Дайте краткое обоснование выбранного маршрута.",
        },
    )

    return tasks


def seed_student_mastery(
    session: Session,
    discipline: Discipline,
    people: dict[str, object],
    elements: dict[str, KnowledgeElement],
) -> None:
    students: list[Student] = people["students"]  # type: ignore[assignment]
    students_by_login = {student.login: student for student in students}

    profiles = {
        "demo_transition_know": {
            "graph": 20,
            "vertex": 15,
            "edge": 10,
            "adjacency": 5,
            "route": 25,
            "build_adjacency_matrix": 0,
            "model_route_case": 0,
            "justify_route_case": 0,
        },
        "demo_transition_can": {
            "graph": 82,
            "vertex": 78,
            "edge": 80,
            "adjacency": 76,
            "route": 74,
            "build_adjacency_matrix": 18,
            "model_route_case": 0,
            "justify_route_case": 0,
        },
        "demo_transition_master1": {
            "graph": 90,
            "vertex": 88,
            "edge": 85,
            "adjacency": 84,
            "route": 82,
            "build_adjacency_matrix": 72,
            "model_route_case": 12,
            "justify_route_case": 0,
        },
        "demo_transition_master2": {
            "graph": 94,
            "vertex": 92,
            "edge": 91,
            "adjacency": 90,
            "route": 88,
            "build_adjacency_matrix": 80,
            "model_route_case": 62,
            "justify_route_case": 18,
        },
    }

    for login, mastery_profile in profiles.items():
        student = students_by_login[login]
        for key, element in elements.items():
            session.add(
                StudentElementMastery(
                    student_id=student.id,
                    discipline_id=discipline.id,
                    element_id=element.id,
                    mastery_value=mastery_profile[key],
                )
            )

    session.flush()


def print_seed_summary(
    discipline: Discipline,
    people: dict[str, object],
    tasks: dict[str, LearningTrajectoryTask],
) -> None:
    students: list[Student] = people["students"]  # type: ignore[assignment]

    print(f"Discipline: {discipline.name}")
    print(f"Students: {len(students)}")
    print(f"Tasks: {len(tasks)}")
    print("Demo logins:")
    print("  demo_transition_know -> старт на элементах 'знать'")
    print("  demo_transition_can -> переход на элемент 'уметь'")
    print("  demo_transition_master1 -> переход на первый элемент 'владеть'")
    print("  demo_transition_master2 -> переход на второй элемент 'владеть'")


if __name__ == "__main__":
    if "COMPETENCE_HUB_DATABASE_URL" in os.environ:
        seed_database(
            recreate=env_flag("COMPETENCE_HUB_SEED_RECREATE", default=False),
            only_if_empty=env_flag("COMPETENCE_HUB_SEED_IF_EMPTY", default=False),
        )
    else:
        recreate_database()
