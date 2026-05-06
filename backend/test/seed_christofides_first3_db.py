from __future__ import annotations

import json
import os
import random
import sys
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Iterable

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

# Allow running the script directly from the test folder.
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core import Base
from app.core.slugs import transliterate_to_slug_base
from app.models import (
    Admin,
    Discipline,
    Expert,
    ExpertDiscipline,
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
    TopicDependency,
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
    TopicDependencyRelationType,
    TopicDependencySource,
    TopicKnowledgeElementRole,
)
from app.services.topic_dependencies import calculate_topic_dependency_pairs


DB_PATH = Path(
    os.environ.get(
        "COMPETENCE_HUB_DB_PATH",
        str(ROOT_DIR / "app_christofides_first3.db"),
    )
)
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"
RNG = random.Random(1978)


RELATION_DIRECTION_BY_TYPE: dict[KnowledgeElementRelationType, RelationDirectionType] = {
    KnowledgeElementRelationType.REQUIRES: RelationDirectionType.ONE_DIRECTION,
    KnowledgeElementRelationType.BUILDS_ON: RelationDirectionType.ONE_DIRECTION,
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


@dataclass(frozen=True)
class TopicSpec:
    key: str
    name: str
    description: str
    required: tuple[str, ...]
    formed: tuple[ElementSpec, ...]


TOPIC_SPECS: tuple[TopicSpec, ...] = (
    TopicSpec(
        key="basic_graph",
        name="Тема 1. Основные понятия графа",
        description=(
            "Базовая модель графа: вершины, ребра, инцидентность, смежность "
            "и первые числовые характеристики."
        ),
        required=(),
        formed=(
            ElementSpec("graph", "Граф", "Структура, заданная множеством вершин и множеством связей между ними."),
            ElementSpec("vertex", "Вершина", "Базовый объект графа, который может быть связан с другими вершинами."),
            ElementSpec("edge", "Ребро", "Неориентированная связь между двумя вершинами графа."),
            ElementSpec("vertex_set", "Множество вершин", "Совокупность всех вершин рассматриваемого графа."),
            ElementSpec("edge_set", "Множество ребер", "Совокупность всех ребер рассматриваемого графа."),
            ElementSpec("incidence", "Инцидентность", "Отношение между ребром и вершиной, если ребро имеет эту вершину концом."),
            ElementSpec("adjacency", "Смежность", "Отношение между двумя вершинами, если они соединены ребром."),
            ElementSpec("graph_order", "Порядок графа", "Количество вершин графа."),
            ElementSpec("graph_size", "Размер графа", "Количество ребер графа."),
            ElementSpec(
                "read_graph_notation",
                "Читать запись G = (V, E)",
                "Умение распознавать множество вершин и множество ребер по записи графа.",
                CompetenceType.CAN,
            ),
            ElementSpec(
                "identify_adjacency",
                "Определять смежность и инцидентность",
                "Умение находить смежные вершины и инцидентные вершинам ребра.",
                CompetenceType.CAN,
            ),
            ElementSpec(
                "interpret_graph_model",
                "Интерпретировать простую графовую модель",
                "Владение переводом простой прикладной ситуации на язык графа.",
                CompetenceType.MASTER,
            ),
        ),
    ),
    TopicSpec(
        key="directed_graph",
        name="Тема 2. Ориентированные графы и дуги",
        description=(
            "Ориентированный граф, дуга, направление связи, входящие и исходящие дуги, "
            "полустепени вершины."
        ),
        required=("graph", "vertex", "incidence", "adjacency"),
        formed=(
            ElementSpec("digraph", "Ориентированный граф", "Граф, в котором связи между вершинами имеют направление."),
            ElementSpec("arc", "Дуга", "Упорядоченная пара вершин, задающая направленную связь."),
            ElementSpec("arc_tail", "Начальная вершина дуги", "Вершина, из которой выходит дуга."),
            ElementSpec("arc_head", "Конечная вершина дуги", "Вершина, в которую входит дуга."),
            ElementSpec("direction", "Направление связи", "Свойство дуги, отличающее начальную вершину от конечной."),
            ElementSpec("incoming_arc", "Входящая дуга", "Дуга, для которой выбранная вершина является конечной."),
            ElementSpec("outgoing_arc", "Исходящая дуга", "Дуга, для которой выбранная вершина является начальной."),
            ElementSpec("indegree", "Полустепень захода", "Количество дуг, входящих в вершину."),
            ElementSpec("outdegree", "Полустепень исхода", "Количество дуг, выходящих из вершины."),
            ElementSpec("directed_path", "Ориентированный путь", "Последовательность дуг, согласованная по направлениям."),
            ElementSpec(
                "identify_arc_ends",
                "Определять начало и конец дуги",
                "Умение читать направление дуги и различать ее начальную и конечную вершины.",
                CompetenceType.CAN,
            ),
            ElementSpec(
                "count_semidegrees",
                "Считать полустепени вершины",
                "Умение вычислять полустепень захода и полустепень исхода по дугам.",
                CompetenceType.CAN,
            ),
            ElementSpec(
                "analyze_directions",
                "Анализировать направление связей в орграфе",
                "Владение устойчивой интерпретацией направленных отношений в графовой модели.",
                CompetenceType.MASTER,
            ),
        ),
    ),
    TopicSpec(
        key="undirected_and_bipartite",
        name="Тема 3. Неориентированные и двудольные графы",
        description=(
            "Типы неориентированных графов, простые графы, мультиграфы, двудольные графы "
            "и первые структурные классы."
        ),
        required=("graph", "vertex", "edge", "adjacency", "digraph"),
        formed=(
            ElementSpec("undirected_graph", "Неориентированный граф", "Граф, в котором связи не имеют направления."),
            ElementSpec("simple_graph", "Простой граф", "Неориентированный граф без петель и кратных ребер."),
            ElementSpec("multigraph", "Мультиграф", "Граф, в котором между одной парой вершин допускается несколько ребер."),
            ElementSpec("pseudograph", "Псевдограф", "Граф, в котором допускаются петли и кратные ребра."),
            ElementSpec("bipartite_graph", "Двудольный граф", "Граф, вершины которого можно разбить на две доли так, что ребра идут между долями."),
            ElementSpec("bipartition", "Доли двудольного графа", "Два множества вершин, образующие разбиение двудольного графа."),
            ElementSpec("complete_bipartite_graph", "Полный двудольный граф", "Двудольный граф, где каждая вершина одной доли соединена со всеми вершинами другой доли."),
            ElementSpec("matching", "Паросочетание", "Множество ребер, никакие два из которых не имеют общей вершины."),
            ElementSpec("vertex_degree", "Степень вершины", "Количество ребер, инцидентных вершине."),
            ElementSpec("regular_graph", "Регулярный граф", "Граф, в котором все вершины имеют одинаковую степень."),
            ElementSpec(
                "check_bipartition",
                "Проверять двудольность по разбиению",
                "Умение проверить, что все ребра идут между двумя долями вершин.",
                CompetenceType.CAN,
            ),
            ElementSpec(
                "classify_graph_type",
                "Отличать простой граф от мультиграфа",
                "Умение классифицировать граф по петлям, кратным ребрам и направлению.",
                CompetenceType.CAN,
            ),
            ElementSpec(
                "choose_graph_type",
                "Выбирать тип графа для прикладной модели",
                "Владение выбором подходящего класса графов под ограничения задачи.",
                CompetenceType.MASTER,
            ),
        ),
    ),
)


def recreate_database() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)

    if DB_PATH.exists():
        DB_PATH.unlink()

    engine = create_engine(DATABASE_URL, echo=False, future=True)
    Base.metadata.create_all(engine)

    session_local = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    with session_local() as session:
        seed_data(session)
        session.commit()

    print(f"Database recreated: {DB_PATH.resolve()}")


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def seed_data(session: Session) -> None:
    relation_catalog = seed_relation_catalog(session)
    people = seed_people(session)
    discipline = seed_discipline(session, people)
    topics, elements = seed_knowledge_graph(session, discipline, relation_catalog)
    seed_topic_dependencies(session, topics)
    trajectory = seed_learning_trajectory(session, discipline, people, topics, elements)
    seed_tasks(session, trajectory, topics, elements)
    seed_student_mastery_and_progress(session, discipline, trajectory, people, elements)
    print_seed_summary(session, discipline)


def seed_relation_catalog(session: Session) -> dict[KnowledgeElementRelationType, Relation]:
    relations: dict[KnowledgeElementRelationType, Relation] = {}
    for relation_type, direction in RELATION_DIRECTION_BY_TYPE.items():
        relation = Relation(relation_type=relation_type, direction=direction)
        session.add(relation)
        relations[relation_type] = relation
    session.flush()
    return relations


def seed_people(session: Session) -> dict[str, object]:
    admin = Admin(name="Главный администратор", login="admin", password="admin")
    expert = Expert(name="Эксперт по теории графов", login="expert_graph", password="expert_graph")
    group = Group(name="Б9124-09.03.04")
    session.add_all([admin, expert, group])
    session.flush()

    subgroup_1 = Subgroup(subgroup_num=1, group_id=group.id)
    subgroup_2 = Subgroup(subgroup_num=2, group_id=group.id)
    session.add_all([subgroup_1, subgroup_2])
    session.flush()

    teacher_1 = Teacher(
        name="Остроухова Светлана Николаевна",
        login="ostroukhova",
        password="ostroukhova",
    )
    teacher_2 = Teacher(
        name="Петров Александр Игоревич",
        login="petrov",
        password="petrov",
    )
    session.add_all([teacher_1, teacher_2])
    session.flush()

    students = [
        Student(
            name="Борщевский Никита",
            login="borshchevskiy",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup_1.id,
        ),
        Student(
            name="Пяткин Алексей",
            login="pyatkin",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup_1.id,
        ),
        Student(
            name="Федоров Иван",
            login="fedorov",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup_2.id,
        ),
        Student(
            name="Иванова Дарья",
            login="ivanova",
            password="student",
            group_id=group.id,
            subgroup_id=subgroup_2.id,
        ),
    ]
    session.add_all(students)
    session.flush()

    session.add_all(
        [
            TeacherGroup(teacher_id=teacher_1.id, group_id=group.id),
            TeacherGroup(teacher_id=teacher_2.id, group_id=group.id),
            TeacherSubgroup(teacher_id=teacher_1.id, subgroup_id=subgroup_1.id),
            TeacherSubgroup(teacher_id=teacher_2.id, subgroup_id=subgroup_2.id),
        ]
    )
    session.flush()

    return {
        "admin": admin,
        "expert": expert,
        "group": group,
        "subgroups": [subgroup_1, subgroup_2],
        "teachers": [teacher_1, teacher_2],
        "students": students,
    }


def seed_discipline(session: Session, people: dict[str, object]) -> Discipline:
    name = "Теория графов. Первые темы по Кристофидесу"
    discipline = Discipline(
        name=name,
        slug=transliterate_to_slug_base(name),
        knowledge_graph_version=1,
    )
    session.add(discipline)
    session.flush()

    group = people["group"]
    expert = people["expert"]
    teachers = people["teachers"]
    students = people["students"]

    session.add(GroupDiscipline(group_id=group.id, discipline_id=discipline.id))
    session.add(ExpertDiscipline(expert_id=expert.id, discipline_id=discipline.id))
    for teacher in teachers:
        session.add(TeacherDiscipline(teacher_id=teacher.id, discipline_id=discipline.id))
    for student in students:
        session.add(StudentDiscipline(student_id=student.id, discipline_id=discipline.id))
    session.flush()

    return discipline


def seed_knowledge_graph(
    session: Session,
    discipline: Discipline,
    relation_catalog: dict[KnowledgeElementRelationType, Relation],
) -> tuple[dict[str, Topic], dict[str, KnowledgeElement]]:
    topics: dict[str, Topic] = {}
    elements: dict[str, KnowledgeElement] = {}

    for topic_spec in TOPIC_SPECS:
        topic = Topic(
            name=topic_spec.name,
            description=topic_spec.description,
            discipline_id=discipline.id,
        )
        session.add(topic)
        session.flush()
        topics[topic_spec.key] = topic

        for element_spec in topic_spec.formed:
            element = KnowledgeElement(
                name=element_spec.name,
                description=element_spec.description,
                competence_type=element_spec.competence_type,
                discipline_id=discipline.id,
            )
            session.add(element)
            session.flush()
            elements[element_spec.key] = element

            session.add(
                TopicKnowledgeElement(
                    topic_id=topic.id,
                    element_id=element.id,
                    role=TopicKnowledgeElementRole.FORMED,
                    note="Формируется в этой теме.",
                )
            )

        for required_key in topic_spec.required:
            session.add(
                TopicKnowledgeElement(
                    topic_id=topic.id,
                    element_id=elements[required_key].id,
                    role=TopicKnowledgeElementRole.REQUIRED,
                    note="Необходимо для начала темы.",
                )
            )

    session.flush()

    add_element_relations(session, relation_catalog, elements)
    session.flush()
    return topics, elements


def add_element_relations(
    session: Session,
    relation_catalog: dict[KnowledgeElementRelationType, Relation],
    elements: dict[str, KnowledgeElement],
) -> None:
    relation_specs: list[tuple[str, str, KnowledgeElementRelationType, str]] = [
        ("graph", "vertex_set", KnowledgeElementRelationType.CONTAINS, "Граф задается множеством вершин."),
        ("graph", "edge_set", KnowledgeElementRelationType.CONTAINS, "Граф задается множеством ребер."),
        ("vertex", "vertex_set", KnowledgeElementRelationType.PART_OF, "Вершина является элементом множества вершин."),
        ("edge", "edge_set", KnowledgeElementRelationType.PART_OF, "Ребро является элементом множества ребер."),
        ("incidence", "edge", KnowledgeElementRelationType.PROPERTY_OF, "Инцидентность описывает связь ребра с вершинами."),
        ("adjacency", "vertex", KnowledgeElementRelationType.PROPERTY_OF, "Смежность описывает отношение между вершинами."),
        ("graph_order", "graph", KnowledgeElementRelationType.PROPERTY_OF, "Порядок является числовой характеристикой графа."),
        ("graph_size", "graph", KnowledgeElementRelationType.PROPERTY_OF, "Размер является числовой характеристикой графа."),
        ("read_graph_notation", "graph", KnowledgeElementRelationType.IMPLEMENTS, "Умение реализует работу с понятием графа."),
        ("identify_adjacency", "incidence", KnowledgeElementRelationType.IMPLEMENTS, "Умение применяет понятие инцидентности."),
        ("identify_adjacency", "adjacency", KnowledgeElementRelationType.IMPLEMENTS, "Умение применяет понятие смежности."),
        ("interpret_graph_model", "read_graph_notation", KnowledgeElementRelationType.AUTOMATES, "Навык закрепляет чтение графовой модели."),
        ("digraph", "graph", KnowledgeElementRelationType.REFINES, "Ориентированный граф уточняет общее понятие графа."),
        ("digraph", "arc", KnowledgeElementRelationType.CONTAINS, "Ориентированный граф строится из дуг."),
        ("arc", "vertex", KnowledgeElementRelationType.REQUIRES, "Дуга задается через упорядоченную пару вершин."),
        ("arc", "arc_tail", KnowledgeElementRelationType.CONTAINS, "Дуга содержит начальную вершину."),
        ("arc", "arc_head", KnowledgeElementRelationType.CONTAINS, "Дуга содержит конечную вершину."),
        ("direction", "arc", KnowledgeElementRelationType.PROPERTY_OF, "Направление является свойством дуги."),
        ("incoming_arc", "arc", KnowledgeElementRelationType.REFINES, "Входящая дуга уточняет дугу относительно выбранной вершины."),
        ("outgoing_arc", "arc", KnowledgeElementRelationType.REFINES, "Исходящая дуга уточняет дугу относительно выбранной вершины."),
        ("indegree", "vertex", KnowledgeElementRelationType.PROPERTY_OF, "Полустепень захода является характеристикой вершины."),
        ("outdegree", "vertex", KnowledgeElementRelationType.PROPERTY_OF, "Полустепень исхода является характеристикой вершины."),
        ("directed_path", "arc", KnowledgeElementRelationType.REQUIRES, "Ориентированный путь строится из согласованных дуг."),
        ("identify_arc_ends", "arc", KnowledgeElementRelationType.IMPLEMENTS, "Умение реализует работу с дугой."),
        ("count_semidegrees", "indegree", KnowledgeElementRelationType.IMPLEMENTS, "Умение применяет полустепень захода."),
        ("count_semidegrees", "outdegree", KnowledgeElementRelationType.IMPLEMENTS, "Умение применяет полустепень исхода."),
        ("analyze_directions", "identify_arc_ends", KnowledgeElementRelationType.AUTOMATES, "Навык закрепляет анализ направленных связей."),
        ("undirected_graph", "graph", KnowledgeElementRelationType.REFINES, "Неориентированный граф уточняет общее понятие графа."),
        ("undirected_graph", "digraph", KnowledgeElementRelationType.CONTRASTS_WITH, "Важно различать наличие и отсутствие направления."),
        ("simple_graph", "undirected_graph", KnowledgeElementRelationType.REFINES, "Простой граф является частным случаем неориентированного графа."),
        ("multigraph", "simple_graph", KnowledgeElementRelationType.GENERALIZES, "Мультиграф обобщает простой граф за счет кратных ребер."),
        ("pseudograph", "multigraph", KnowledgeElementRelationType.GENERALIZES, "Псевдограф расширяет мультиграф петлями."),
        ("bipartite_graph", "undirected_graph", KnowledgeElementRelationType.REFINES, "Двудольный граф является специальным неориентированным графом."),
        ("bipartite_graph", "bipartition", KnowledgeElementRelationType.CONTAINS, "Двудольный граф содержит две доли вершин."),
        ("complete_bipartite_graph", "bipartite_graph", KnowledgeElementRelationType.REFINES, "Полный двудольный граф уточняет двудольный граф."),
        ("matching", "bipartite_graph", KnowledgeElementRelationType.REQUIRES, "Паросочетание удобно рассматривать на двудольных графах."),
        ("vertex_degree", "vertex", KnowledgeElementRelationType.PROPERTY_OF, "Степень является характеристикой вершины."),
        ("regular_graph", "vertex_degree", KnowledgeElementRelationType.REQUIRES, "Регулярность определяется через степени вершин."),
        ("check_bipartition", "bipartite_graph", KnowledgeElementRelationType.IMPLEMENTS, "Умение применяет понятие двудольного графа."),
        ("classify_graph_type", "simple_graph", KnowledgeElementRelationType.IMPLEMENTS, "Умение различает простой граф."),
        ("classify_graph_type", "multigraph", KnowledgeElementRelationType.IMPLEMENTS, "Умение различает мультиграф."),
        ("choose_graph_type", "classify_graph_type", KnowledgeElementRelationType.AUTOMATES, "Навык закрепляет классификацию графовых моделей."),
    ]

    for source_key, target_key, relation_type, description in relation_specs:
        session.add(
            KnowledgeElementRelation(
                source_element_id=elements[source_key].id,
                target_element_id=elements[target_key].id,
                relation_id=relation_catalog[relation_type].id,
                description=description,
            )
        )


def seed_topic_dependencies(session: Session, topics: dict[str, Topic]) -> None:
    topic_list = list(topics.values())
    topic_elements = session.scalars(
        select(TopicKnowledgeElement).where(
            TopicKnowledgeElement.topic_id.in_([topic.id for topic in topic_list])
        )
    ).all()

    for prerequisite_topic_id, dependent_topic_id in calculate_topic_dependency_pairs(topic_list, topic_elements):
        session.add(
            TopicDependency(
                prerequisite_topic_id=prerequisite_topic_id,
                dependent_topic_id=dependent_topic_id,
                relation_type=TopicDependencyRelationType.REQUIRES,
                source=TopicDependencySource.COMPUTED,
                description="Автоматически построено по пересечению формируемых и требуемых элементов.",
            )
        )
    session.flush()


def seed_learning_trajectory(
    session: Session,
    discipline: Discipline,
    people: dict[str, object],
    topics: dict[str, Topic],
    elements: dict[str, KnowledgeElement],
) -> LearningTrajectory:
    teacher = people["teachers"][0]
    group = people["group"]
    subgroup = people["subgroups"][0]

    trajectory = LearningTrajectory(
        name="Базовая траектория: первые темы Кристофидеса",
        status=LearningTrajectoryStatus.ACTIVE,
        graph_version=discipline.knowledge_graph_version,
        discipline_id=discipline.id,
        teacher_id=teacher.id,
        group_id=group.id,
        subgroup_id=subgroup.id,
    )
    session.add(trajectory)
    session.flush()

    topic_order = ("basic_graph", "directed_graph", "undirected_and_bipartite")
    topic_thresholds = (0, 45, 60)
    trajectory_topics: dict[str, LearningTrajectoryTopic] = {}
    for position, (topic_key, threshold) in enumerate(zip(topic_order, topic_thresholds), start=1):
        trajectory_topic = LearningTrajectoryTopic(
            trajectory_id=trajectory.id,
            topic_id=topics[topic_key].id,
            position=position,
            threshold=threshold,
        )
        session.add(trajectory_topic)
        session.flush()
        trajectory_topics[topic_key] = trajectory_topic

        formed_know = get_topic_formed_elements(session, topics[topic_key], CompetenceType.KNOW)
        for element_index, element in enumerate(formed_know):
            element_threshold = 0 if element_index == 0 else min(70, 20 + position * 10)
            session.add(
                LearningTrajectoryElement(
                    trajectory_topic_id=trajectory_topic.id,
                    element_id=element.id,
                    threshold=element_threshold,
                )
            )

    session.flush()
    return trajectory


def seed_tasks(
    session: Session,
    trajectory: LearningTrajectory,
    topics: dict[str, Topic],
    elements: dict[str, KnowledgeElement],
) -> None:
    relation_by_key = build_relation_lookup(
        session.scalars(select(KnowledgeElementRelation)).all()
    )
    trajectory_topics = {
        trajectory_topic.topic_id: trajectory_topic
        for trajectory_topic in session.scalars(
            select(LearningTrajectoryTopic).where(LearningTrajectoryTopic.trajectory_id == trajectory.id)
        ).all()
    }
    all_know_elements = [
        element
        for element in elements.values()
        if element.competence_type == CompetenceType.KNOW
    ]

    for topic_key, topic in topics.items():
        trajectory_topic = trajectory_topics[topic.id]
        topic_know = get_topic_formed_elements(session, topic, CompetenceType.KNOW)
        for element in topic_know:
            distractors = pick_distractors(all_know_elements, {element.id}, 3)
            add_choice_task(
                session=session,
                trajectory=trajectory,
                trajectory_topic=trajectory_topic,
                primary_element=element,
                related_elements=distractors,
                checked_relations=[],
                template_kind=LearningTrajectoryTaskTemplateKind.TERM_CHOICE,
                title=f"Понятие по определению: {element.name}",
                prompt=f"Какое понятие соответствует определению: {element.description}",
                difficulty=25 + trajectory_topic.position * 5,
                options=[element] + distractors,
                correct_ids={element.id},
            )

        add_matching_task(session, trajectory, trajectory_topic, topic_know[:4])

    add_multiple_choice_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topics[topics["basic_graph"].id],
        primary_element=elements["graph"],
        correct_elements=[elements["vertex_set"], elements["edge_set"]],
        distractors=[elements["arc"], elements["bipartite_graph"], elements["indegree"]],
        checked_relations=collect_relations(
            relation_by_key,
            [
                ("graph", "vertex_set", KnowledgeElementRelationType.CONTAINS),
                ("graph", "edge_set", KnowledgeElementRelationType.CONTAINS),
            ],
            elements,
        ),
        title="Части графа",
        prompt="Какие элементы входят в базовую запись графа?",
        difficulty=35,
        template_kind=LearningTrajectoryTaskTemplateKind.CONTAINS_MULTIPLE,
    )
    add_multiple_choice_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topics[topics["directed_graph"].id],
        primary_element=elements["arc"],
        correct_elements=[elements["arc_tail"], elements["arc_head"]],
        distractors=[elements["indegree"], elements["outdegree"], elements["edge"]],
        checked_relations=collect_relations(
            relation_by_key,
            [
                ("arc", "arc_tail", KnowledgeElementRelationType.CONTAINS),
                ("arc", "arc_head", KnowledgeElementRelationType.CONTAINS),
            ],
            elements,
        ),
        title="Состав дуги",
        prompt="Какие понятия описывают концы дуги?",
        difficulty=45,
        template_kind=LearningTrajectoryTaskTemplateKind.CONTAINS_MULTIPLE,
    )
    add_multiple_choice_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topics[topics["undirected_and_bipartite"].id],
        primary_element=elements["bipartite_graph"],
        correct_elements=[elements["bipartition"]],
        distractors=[elements["arc"], elements["indegree"], elements["graph_size"]],
        checked_relations=collect_relations(
            relation_by_key,
            [("bipartite_graph", "bipartition", KnowledgeElementRelationType.CONTAINS)],
            elements,
        ),
        title="Части двудольного графа",
        prompt="Что обязательно задает разбиение двудольного графа?",
        difficulty=55,
        template_kind=LearningTrajectoryTaskTemplateKind.CONTAINS_MULTIPLE,
    )
    add_ordering_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topics[topics["directed_graph"].id],
        ordered_elements=[elements["graph"], elements["digraph"], elements["arc"], elements["directed_path"]],
        checked_relations=collect_relations(
            relation_by_key,
            [
                ("digraph", "graph", KnowledgeElementRelationType.REFINES),
                ("arc", "vertex", KnowledgeElementRelationType.REQUIRES),
                ("directed_path", "arc", KnowledgeElementRelationType.REQUIRES),
            ],
            elements,
        ),
        title="От базы к ориентированному пути",
        prompt="Расположи понятия от базового к производному.",
        difficulty=60,
    )
    add_ordering_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topics[topics["undirected_and_bipartite"].id],
        ordered_elements=[
            elements["graph"],
            elements["undirected_graph"],
            elements["bipartite_graph"],
            elements["complete_bipartite_graph"],
        ],
        checked_relations=collect_relations(
            relation_by_key,
            [
                ("undirected_graph", "graph", KnowledgeElementRelationType.REFINES),
                ("bipartite_graph", "undirected_graph", KnowledgeElementRelationType.REFINES),
                ("complete_bipartite_graph", "bipartite_graph", KnowledgeElementRelationType.REFINES),
            ],
            elements,
        ),
        title="Классы неориентированных графов",
        prompt="Расположи классы графов от общего к частному.",
        difficulty=70,
    )


def get_topic_formed_elements(
    session: Session,
    topic: Topic,
    competence_type: CompetenceType,
) -> list[KnowledgeElement]:
    return list(
        session.scalars(
            select(KnowledgeElement)
            .join(TopicKnowledgeElement, TopicKnowledgeElement.element_id == KnowledgeElement.id)
            .where(
                TopicKnowledgeElement.topic_id == topic.id,
                TopicKnowledgeElement.role == TopicKnowledgeElementRole.FORMED,
                KnowledgeElement.competence_type == competence_type,
            )
            .order_by(KnowledgeElement.name)
        ).all()
    )


def build_relation_lookup(
    relations: Iterable[KnowledgeElementRelation],
) -> dict[tuple[object, object, KnowledgeElementRelationType], KnowledgeElementRelation]:
    return {
        (relation.source_element_id, relation.target_element_id, relation.relation_type): relation
        for relation in relations
    }


def collect_relations(
    relation_by_key: dict[tuple[object, object, KnowledgeElementRelationType], KnowledgeElementRelation],
    specs: list[tuple[str, str, KnowledgeElementRelationType]],
    elements: dict[str, KnowledgeElement],
) -> list[KnowledgeElementRelation]:
    result: list[KnowledgeElementRelation] = []
    seen_ids: set[object] = set()
    for source_key, target_key, relation_type in specs:
        relation = relation_by_key.get((elements[source_key].id, elements[target_key].id, relation_type))
        if relation is None or relation.id in seen_ids:
            continue
        seen_ids.add(relation.id)
        result.append(relation)
    return result


def pick_distractors(
    pool: list[KnowledgeElement],
    excluded_ids: set[object],
    count: int,
) -> list[KnowledgeElement]:
    candidates = [element for element in pool if element.id not in excluded_ids]
    RNG.shuffle(candidates)
    return candidates[:count]


def add_choice_task(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
    checked_relations: list[KnowledgeElementRelation],
    template_kind: LearningTrajectoryTaskTemplateKind,
    title: str,
    prompt: str,
    difficulty: int,
    options: list[KnowledgeElement],
    correct_ids: set[object],
) -> LearningTrajectoryTask:
    option_payload = [
        {
            "id": str(element.id),
            "text": element.name,
            "is_correct": element.id in correct_ids,
        }
        for element in options
    ]
    RNG.shuffle(option_payload)
    return add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=primary_element,
        related_elements=related_elements,
        checked_relations=checked_relations,
        task_type=LearningTrajectoryTaskType.SINGLE_CHOICE,
        template_kind=template_kind,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content={"options": option_payload},
    )


def add_multiple_choice_task(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    primary_element: KnowledgeElement,
    correct_elements: list[KnowledgeElement],
    distractors: list[KnowledgeElement],
    checked_relations: list[KnowledgeElementRelation],
    title: str,
    prompt: str,
    difficulty: int,
    template_kind: LearningTrajectoryTaskTemplateKind,
) -> LearningTrajectoryTask:
    correct_ids = {element.id for element in correct_elements}
    options = correct_elements + distractors
    option_payload = [
        {
            "id": str(element.id),
            "text": element.name,
            "is_correct": element.id in correct_ids,
        }
        for element in options
    ]
    RNG.shuffle(option_payload)
    return add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=primary_element,
        related_elements=correct_elements + distractors,
        checked_relations=checked_relations,
        task_type=LearningTrajectoryTaskType.MULTIPLE_CHOICE,
        template_kind=template_kind,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content={"options": option_payload},
    )


def add_matching_task(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    elements_for_matching: list[KnowledgeElement],
) -> LearningTrajectoryTask | None:
    if len(elements_for_matching) < 2:
        return None

    left = [{"id": str(element.id), "text": element.name} for element in elements_for_matching]
    right = [{"id": str(element.id), "text": element.description or ""} for element in elements_for_matching]
    RNG.shuffle(left)
    RNG.shuffle(right)
    pairs = [
        {"left_id": str(element.id), "right_id": str(element.id)}
        for element in elements_for_matching
    ]
    return add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=elements_for_matching[0],
        related_elements=elements_for_matching[1:],
        checked_relations=[],
        task_type=LearningTrajectoryTaskType.MATCHING,
        template_kind=LearningTrajectoryTaskTemplateKind.MATCHING_DEFINITION,
        title=f"Сопоставление понятий: {trajectory_topic.topic.name}",
        prompt="Сопоставь понятия и их определения.",
        difficulty=50 + trajectory_topic.position * 5,
        content={"left": left, "right": right, "pairs": pairs},
    )


def add_ordering_task(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    ordered_elements: list[KnowledgeElement],
    checked_relations: list[KnowledgeElementRelation],
    title: str,
    prompt: str,
    difficulty: int,
) -> LearningTrajectoryTask:
    items = [{"id": str(element.id), "text": element.name} for element in ordered_elements]
    RNG.shuffle(items)
    return add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=ordered_elements[-1],
        related_elements=ordered_elements[:-1],
        checked_relations=checked_relations,
        task_type=LearningTrajectoryTaskType.ORDERING,
        template_kind=LearningTrajectoryTaskTemplateKind.REQUIRES_ORDERING,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content={
            "items": items,
            "correct_order_ids": [str(element.id) for element in ordered_elements],
        },
    )


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
    content: dict[str, object],
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

    seen_related: set[object] = set()
    for element in related_elements:
        if element.id == primary_element.id or element.id in seen_related:
            continue
        seen_related.add(element.id)
        session.add(LearningTrajectoryTaskElement(task_id=task.id, element_id=element.id))

    for relation in checked_relations:
        session.add(LearningTrajectoryTaskRelation(task_id=task.id, relation_id=relation.id))

    session.flush()
    return task


def seed_student_mastery_and_progress(
    session: Session,
    discipline: Discipline,
    trajectory: LearningTrajectory,
    people: dict[str, object],
    elements: dict[str, KnowledgeElement],
) -> None:
    students = people["students"]
    base_mastery_profiles: list[dict[str, int]] = [
        {"graph": 65, "vertex": 60, "edge": 55, "vertex_set": 50, "edge_set": 50},
        {"graph": 25, "vertex": 20, "edge": 15},
        {"graph": 0, "vertex": 0},
        {"graph": 40, "vertex": 35, "edge": 30},
    ]

    trajectory_elements = session.scalars(
        select(KnowledgeElement)
        .join(LearningTrajectoryElement, LearningTrajectoryElement.element_id == KnowledgeElement.id)
        .join(
            LearningTrajectoryTopic,
            LearningTrajectoryTopic.id == LearningTrajectoryElement.trajectory_topic_id,
        )
        .where(LearningTrajectoryTopic.trajectory_id == trajectory.id)
    ).all()

    for student, profile in zip(students, base_mastery_profiles, strict=True):
        for element in trajectory_elements:
            mastery = profile.get(find_element_key(elements, element), 0)
            session.add(
                StudentElementMastery(
                    student_id=student.id,
                    discipline_id=discipline.id,
                    element_id=element.id,
                    mastery_value=mastery,
                )
            )

    first_task = session.scalars(
        select(LearningTrajectoryTask)
        .where(LearningTrajectoryTask.trajectory_id == trajectory.id)
        .order_by(LearningTrajectoryTask.created_at)
    ).first()
    if first_task is not None:
        student = students[0]
        now = utcnow_naive()
        instance = StudentTaskInstance(
            student_id=student.id,
            task_id=first_task.id,
            content_snapshot_json=first_task.content_json,
            issued_at=now,
            answered_at=now,
        )
        session.add(instance)
        session.flush()
        feedback = {"summary": "Демонстрационная попытка для проверки истории адаптивного контроля."}
        session.add(
            StudentTaskAttempt(
                instance_id=instance.id,
                student_id=student.id,
                task_id=first_task.id,
                answer_payload_json=json.dumps({"seed": True}, ensure_ascii=False),
                feedback_json=json.dumps(feedback, ensure_ascii=False),
                score=80,
                duration_seconds=38,
                answered_at=now,
            )
        )
        session.add(
            StudentTaskProgress(
                student_id=student.id,
                task_id=first_task.id,
                status=StudentTaskProgressStatus.COMPLETED,
                attempts_count=1,
                last_score=80,
                best_score=80,
                last_answered_at=now,
                completed_at=now,
                last_answer_payload=json.dumps({"seed": True}, ensure_ascii=False),
                last_feedback_json=json.dumps(feedback, ensure_ascii=False),
            )
        )

    session.flush()


def find_element_key(elements: dict[str, KnowledgeElement], target: KnowledgeElement) -> str:
    for key, element in elements.items():
        if element.id == target.id:
            return key
    return ""


def print_seed_summary(session: Session, discipline: Discipline) -> None:
    print("\n=== Christofides first-three-topics seed ===")
    print(f"Database: {DB_PATH.resolve()}")
    print(f"Discipline: {discipline.name}")
    print(f"Slug: {discipline.slug}")
    print(f"Topics: {session.query(Topic).count()}")
    print(f"Knowledge elements: {session.query(KnowledgeElement).count()}")
    print(f"Element relations: {session.query(KnowledgeElementRelation).count()}")
    print(f"Topic dependencies: {session.query(TopicDependency).count()}")
    print(f"Learning trajectories: {session.query(LearningTrajectory).count()}")
    print(f"Trajectory tasks: {session.query(LearningTrajectoryTask).count()}")
    print(f"Teachers: {session.query(Teacher).count()}")
    print(f"Students: {session.query(Student).count()}")
    print("\nLogins:")
    print("  admin / admin")
    print("  expert_graph / expert_graph")
    print("  ostroukhova / ostroukhova")
    print("  petrov / petrov")
    print("  borshchevskiy / student")


if __name__ == "__main__":
    recreate_database()
