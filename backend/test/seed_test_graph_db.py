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
    StudentTaskProgressStatus,
    TopicDependencyRelationType,
    TopicDependencySource,
    TopicKnowledgeElementRole,
)
from app.services.topic_dependencies import calculate_topic_dependency_pairs


DB_PATH = Path(os.environ.get("COMPETENCE_HUB_DB_PATH", str(ROOT_DIR / "app.db")))
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"
RNG = random.Random(42)


@dataclass(frozen=True)
class TopicBlueprint:
    index: int
    title: str
    summary: str
    know_core: str
    know_detail: str
    prerequisites: tuple[int, ...] = ()


TOPIC_BLUEPRINTS: list[TopicBlueprint] = [
    TopicBlueprint(1, "Введение в графы", "Базовые определения и способ чтения графовой модели.", "Понятие графа", "Вершина и ребро"),
    TopicBlueprint(2, "Ориентированные графы", "Направление связи и интерпретация дуг.", "Ориентированный граф", "Дуга и направление", (1,)),
    TopicBlueprint(3, "Неориентированные и двудольные графы", "Классические типы графов и их признаки.", "Неориентированный граф", "Двудольный граф", (1,)),
    TopicBlueprint(4, "Матричные представления", "Матрицы смежности и инцидентности.", "Матрица смежности", "Матрица инцидентности", (2, 3)),
    TopicBlueprint(5, "Степени и локальные характеристики", "Степени вершин, полустепени и локальные свойства.", "Степень вершины", "Полустепень вершины", (4,)),
    TopicBlueprint(6, "Маршруты и цепи", "Маршруты, цепи и длина пути.", "Маршрут в графе", "Цепь и путь", (4,)),
    TopicBlueprint(7, "Циклы и связность", "Связность, цикличность и компоненты.", "Цикл в графе", "Связность графа", (5, 6)),
    TopicBlueprint(8, "Достижимость", "Переходы между вершинами и достижимость.", "Достижимость вершины", "Контрдостижимость", (6,)),
    TopicBlueprint(9, "Сильная связность", "Сильные компоненты и их анализ.", "Сильная связность", "Компонента сильной связности", (7, 8)),
    TopicBlueprint(10, "Деревья", "Деревья, леса и корневые структуры.", "Дерево", "Лес графа", (7,)),
    TopicBlueprint(11, "Остовы", "Остовные подграфы и остовные деревья.", "Остовный подграф", "Остовное дерево", (10,)),
    TopicBlueprint(12, "Кратчайшие пути", "Постановка задач о кратчайшем пути.", "Кратчайший путь", "Вес пути", (11,)),
    TopicBlueprint(13, "Алгоритм Дейкстры", "Жадный подход для неотрицательных весов.", "Алгоритм Дейкстры", "Релаксация расстояний", (12,)),
    TopicBlueprint(14, "Алгоритм Беллмана-Форда", "Кратчайшие пути при возможных отрицательных весах.", "Алгоритм Беллмана-Форда", "Отрицательный цикл", (12,)),
    TopicBlueprint(15, "Флойд-Уоршелл", "Кратчайшие пути между всеми парами вершин.", "Алгоритм Флойда-Уоршелла", "Матрица кратчайших путей", (13, 14)),
    TopicBlueprint(16, "Независимые множества", "Независимость вершин и ограничения конфликтов.", "Независимое множество", "Максимальное независимое множество", (5, 7)),
    TopicBlueprint(17, "Доминирующие множества", "Покрытие графа через доминирование.", "Доминирующее множество", "Минимальное доминирующее множество", (16,)),
    TopicBlueprint(18, "Покрытия", "Покрытия вершин и ребер.", "Покрытие вершин", "Покрытие ребер", (16, 17)),
    TopicBlueprint(19, "Раскраски", "Назначение цветов и конфликтные ограничения.", "Раскраска графа", "Правильная раскраска", (4, 18)),
    TopicBlueprint(20, "Хроматическое число", "Минимальное число цветов для корректной раскраски.", "Хроматическое число", "Оценка хроматического числа", (19,)),
    TopicBlueprint(21, "Паросочетания", "Паросочетания и их свойства.", "Паросочетание", "Максимальное паросочетание", (18, 19)),
    TopicBlueprint(22, "Назначения", "Модель назначения как развитие задачи о паросочетаниях.", "Задача о назначениях", "Матрица стоимости назначения", (21,)),
    TopicBlueprint(23, "Потоки в сетях", "Сети, пропускные способности и допустимые потоки.", "Поток в сети", "Пропускная способность", (8, 11)),
    TopicBlueprint(24, "Максимальный поток", "Поиск максимального значения потока.", "Максимальный поток", "Увеличивающий путь", (23,)),
    TopicBlueprint(25, "Минимальный разрез", "Связь разрезов и потоков.", "Минимальный разрез", "Теорема max-flow min-cut", (23,)),
    TopicBlueprint(26, "Поток минимальной стоимости", "Потоки с учетом стоимости транспортировки.", "Поток минимальной стоимости", "Стоимость потока", (24, 25)),
    TopicBlueprint(27, "Эйлеровы цепи", "Эйлеровы обходы и условия существования.", "Эйлерова цепь", "Эйлеров цикл", (7, 10)),
    TopicBlueprint(28, "Гамильтоновы циклы", "Обходы по вершинам без повторений.", "Гамильтонов цикл", "Гамильтонова цепь", (7, 27)),
    TopicBlueprint(29, "Коммивояжер", "Маршрутные оптимизационные постановки.", "Задача коммивояжера", "Тур коммивояжера", (15, 28)),
    TopicBlueprint(30, "Планарные графы", "Плоские укладки и ограничения планарности.", "Планарный граф", "Формула Эйлера для планарных графов", (3, 19)),
    TopicBlueprint(31, "Специальные классы графов", "Классы графов с особыми структурными свойствами.", "Полный граф", "Регулярный граф", (3, 21)),
    TopicBlueprint(32, "Изоморфизм графов", "Сравнение структур графов по взаимно-однозначному соответствию.", "Изоморфизм графов", "Инварианты графа", (1, 3)),
    TopicBlueprint(33, "Центры и медианы", "Центральные вершины и оптимальное размещение.", "Центр графа", "Медиана графа", (6, 15)),
    TopicBlueprint(34, "Прикладное моделирование", "Связка графовых моделей с практическими задачами.", "Графовая модель задачи", "Интерпретация решения на графе", (23, 29, 33)),
]

assert len(TOPIC_BLUEPRINTS) == 34


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


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


def seed_data(session: Session) -> None:
    discipline = Discipline(name="Теория графов. Демонстрационный контур", knowledge_graph_version=1)
    session.add(discipline)
    session.flush()

    topics_by_index, elements_by_topic = build_knowledge_graph(session, discipline)
    build_topic_dependencies(session, topics_by_index)

    people = build_people_and_group_data(session, discipline)
    trajectories = build_learning_trajectories(
        session=session,
        discipline=discipline,
        topics_by_index=topics_by_index,
        elements_by_topic=elements_by_topic,
        people=people,
    )
    seed_student_mastery_and_progress(
        session=session,
        discipline=discipline,
        trajectories=trajectories,
        people=people,
    )
    print_seed_summary(session, discipline)


def build_knowledge_graph(
    session: Session,
    discipline: Discipline,
) -> tuple[dict[int, Topic], dict[int, dict[str, KnowledgeElement]]]:
    topics_by_index: dict[int, Topic] = {}
    elements_by_topic: dict[int, dict[str, KnowledgeElement]] = {}

    for blueprint in TOPIC_BLUEPRINTS:
        topic = Topic(
            name=f"Тема {blueprint.index}. {blueprint.title}",
            description=blueprint.summary,
            discipline_id=discipline.id,
        )
        session.add(topic)
        session.flush()
        topics_by_index[blueprint.index] = topic

        topic_elements = {
            "know_core": KnowledgeElement(
                name=blueprint.know_core,
                description=f"Ключевое теоретическое понятие темы «{blueprint.title}».",
                competence_type=CompetenceType.KNOW,
                discipline_id=discipline.id,
            ),
            "know_detail": KnowledgeElement(
                name=blueprint.know_detail,
                description=f"Уточняющее или связанное понятие темы «{blueprint.title}».",
                competence_type=CompetenceType.KNOW,
                discipline_id=discipline.id,
            ),
            "can": KnowledgeElement(
                name=f"Решать задачи по теме «{blueprint.title}»",
                description=f"Умение применять идеи темы «{blueprint.title}» в задачах.",
                competence_type=CompetenceType.CAN,
                discipline_id=discipline.id,
            ),
            "master": KnowledgeElement(
                name=f"Моделировать прикладные случаи по теме «{blueprint.title}»",
                description=f"Владение устойчивым применением темы «{blueprint.title}» в моделировании.",
                competence_type=CompetenceType.MASTER,
                discipline_id=discipline.id,
            ),
        }
        session.add_all(topic_elements.values())
        session.flush()
        elements_by_topic[blueprint.index] = topic_elements

        required_elements: list[KnowledgeElement] = []
        for prerequisite_index in blueprint.prerequisites:
            prerequisite_elements = elements_by_topic[prerequisite_index]
            required_elements.append(prerequisite_elements["know_core"])
            required_elements.append(prerequisite_elements["know_detail"])

        topic_links = [
            TopicKnowledgeElement(
                topic_id=topic.id,
                element_id=element.id,
                role=TopicKnowledgeElementRole.FORMED,
            )
            for element in topic_elements.values()
        ]
        topic_links.extend(
            TopicKnowledgeElement(
                topic_id=topic.id,
                element_id=element.id,
                role=TopicKnowledgeElementRole.REQUIRED,
            )
            for element in required_elements
        )
        session.add_all(topic_links)
        session.flush()

    session.add_all(build_knowledge_relations(elements_by_topic))
    session.flush()
    return topics_by_index, elements_by_topic


def build_knowledge_relations(
    elements_by_topic: dict[int, dict[str, KnowledgeElement]],
) -> list[KnowledgeElementRelation]:
    relations: list[KnowledgeElementRelation] = []

    for blueprint in TOPIC_BLUEPRINTS:
        current = elements_by_topic[blueprint.index]
        relations.extend(
            [
                KnowledgeElementRelation(
                    source_element_id=current["know_detail"].id,
                    target_element_id=current["know_core"].id,
                    relation_type=KnowledgeElementRelationType.REFINES,
                    description="Уточняющее понятие конкретизирует базовое.",
                ),
                KnowledgeElementRelation(
                    source_element_id=current["can"].id,
                    target_element_id=current["know_core"].id,
                    relation_type=KnowledgeElementRelationType.IMPLEMENTS,
                    description="Теоретическое знание выражается в действии.",
                ),
                KnowledgeElementRelation(
                    source_element_id=current["master"].id,
                    target_element_id=current["can"].id,
                    relation_type=KnowledgeElementRelationType.AUTOMATES,
                    description="Устойчивый навык вырастает из освоенного умения.",
                ),
            ]
        )

        for prerequisite_index in blueprint.prerequisites:
            prerequisite = elements_by_topic[prerequisite_index]
            relations.extend(
                [
                    KnowledgeElementRelation(
                        source_element_id=current["know_core"].id,
                        target_element_id=prerequisite["know_core"].id,
                        relation_type=KnowledgeElementRelationType.REQUIRES,
                        description="Новое понятие опирается на базу предыдущей темы.",
                    ),
                    KnowledgeElementRelation(
                        source_element_id=current["know_detail"].id,
                        target_element_id=prerequisite["know_detail"].id,
                        relation_type=KnowledgeElementRelationType.BUILDS_ON,
                        description="Уточнение строится на ранее изученном уточнении.",
                    ),
                    KnowledgeElementRelation(
                        source_element_id=current["know_core"].id,
                        target_element_id=prerequisite["know_detail"].id,
                        relation_type=KnowledgeElementRelationType.USED_WITH,
                        description="Понятия часто используются совместно в решении задач.",
                    ),
                ]
            )

    return relations


def build_topic_dependencies(session: Session, topics_by_index: dict[int, Topic]) -> None:
    topics = [topics_by_index[index] for index in sorted(topics_by_index)]
    topic_links = session.scalars(select(TopicKnowledgeElement)).all()
    dependency_pairs = calculate_topic_dependency_pairs(topics, topic_links)

    dependencies = [
        TopicDependency(
            prerequisite_topic_id=prerequisite_topic_id,
            dependent_topic_id=dependent_topic_id,
            relation_type=TopicDependencyRelationType.REQUIRES,
            source=TopicDependencySource.COMPUTED,
            description="Связь вычислена автоматически по пересечению требуемых и формируемых элементов.",
        )
        for prerequisite_topic_id, dependent_topic_id in sorted(
            dependency_pairs,
            key=lambda pair: (str(pair[0]), str(pair[1])),
        )
    ]
    session.add_all(dependencies)
    session.flush()


def build_people_and_group_data(session: Session, discipline: Discipline) -> dict[str, object]:
    group = Group(name="Б9124-09.03.04")
    session.add(group)
    session.flush()

    subgroup_1 = Subgroup(group_id=group.id, subgroup_num=1)
    subgroup_2 = Subgroup(group_id=group.id, subgroup_num=2)
    session.add_all([subgroup_1, subgroup_2])
    session.flush()

    teacher_1 = Teacher(name="Остроухова Светлана Николаевна")
    teacher_2 = Teacher(name="Петров Александр Игоревич")
    session.add_all([teacher_1, teacher_2])
    session.flush()

    students_subgroup_1 = [
        Student(name="Борщевский Кирилл", group_id=group.id, subgroup_id=subgroup_1.id),
        Student(name="Пяткин Алексей", group_id=group.id, subgroup_id=subgroup_1.id),
    ]
    students_subgroup_2 = [
        Student(name="Федоров Максим", group_id=group.id, subgroup_id=subgroup_2.id),
        Student(name="Иванова Дарья", group_id=group.id, subgroup_id=subgroup_2.id),
    ]
    session.add_all([*students_subgroup_1, *students_subgroup_2])
    session.flush()

    session.add(GroupDiscipline(group_id=group.id, discipline_id=discipline.id))
    session.add_all(
        [
            TeacherDiscipline(teacher_id=teacher_1.id, discipline_id=discipline.id),
            TeacherDiscipline(teacher_id=teacher_2.id, discipline_id=discipline.id),
            TeacherGroup(teacher_id=teacher_1.id, group_id=group.id),
            TeacherGroup(teacher_id=teacher_2.id, group_id=group.id),
            TeacherSubgroup(teacher_id=teacher_1.id, subgroup_id=subgroup_1.id),
            TeacherSubgroup(teacher_id=teacher_2.id, subgroup_id=subgroup_2.id),
        ]
    )
    session.add_all(
        StudentDiscipline(student_id=student.id, discipline_id=discipline.id)
        for student in [*students_subgroup_1, *students_subgroup_2]
    )
    session.flush()

    return {
        "group": group,
        "subgroups": [subgroup_1, subgroup_2],
        "teachers": [teacher_1, teacher_2],
        "students_by_subgroup": {
            subgroup_1.id: students_subgroup_1,
            subgroup_2.id: students_subgroup_2,
        },
    }


def build_learning_trajectories(
    session: Session,
    discipline: Discipline,
    topics_by_index: dict[int, Topic],
    elements_by_topic: dict[int, dict[str, KnowledgeElement]],
    people: dict[str, object],
) -> list[LearningTrajectory]:
    teachers = people["teachers"]
    subgroups = people["subgroups"]
    group = people["group"]

    trajectory_specs = [
        {
            "teacher": teachers[0],
            "subgroup": subgroups[0],
            "name": "Траектория Адаптивный старт",
            "topic_indices": [1, 2, 4, 6, 7, 10, 11, 12],
            "thresholds": [0, 40, 45, 50, 55, 60, 65, 70],
        },
        {
            "teacher": teachers[1],
            "subgroup": subgroups[1],
            "name": "Траектория Сетевые модели",
            "topic_indices": [1, 3, 5, 7, 8, 23, 24, 25, 26, 34],
            "thresholds": [0, 35, 40, 45, 50, 55, 60, 65, 70, 75],
        },
    ]

    trajectories: list[LearningTrajectory] = []
    for spec in trajectory_specs:
        trajectory = LearningTrajectory(
            name=spec["name"],
            status=LearningTrajectoryStatus.ACTIVE,
            graph_version=discipline.knowledge_graph_version,
            discipline_id=discipline.id,
            teacher_id=spec["teacher"].id,
            group_id=group.id,
            subgroup_id=spec["subgroup"].id,
        )
        session.add(trajectory)
        session.flush()

        trajectory_topics: list[LearningTrajectoryTopic] = []
        topic_index_by_topic_id: dict[object, int] = {}
        for position, (topic_index, threshold) in enumerate(
            zip(spec["topic_indices"], spec["thresholds"], strict=True),
            start=1,
        ):
            trajectory_topic = LearningTrajectoryTopic(
                trajectory_id=trajectory.id,
                topic_id=topics_by_index[topic_index].id,
                position=position,
                threshold=threshold,
            )
            session.add(trajectory_topic)
            session.flush()
            trajectory_topics.append(trajectory_topic)
            topic_index_by_topic_id[trajectory_topic.topic_id] = topic_index

            know_elements = [
                elements_by_topic[topic_index]["know_core"],
                elements_by_topic[topic_index]["know_detail"],
            ]
            element_thresholds = [0, max(20, threshold)]
            for element, element_threshold in zip(know_elements, element_thresholds, strict=True):
                session.add(
                    LearningTrajectoryElement(
                        trajectory_topic_id=trajectory_topic.id,
                        element_id=element.id,
                        threshold=element_threshold,
                    )
                )
            session.flush()

        session.refresh(trajectory)
        create_trajectory_tasks(
            session=session,
            trajectory=trajectory,
            trajectory_topics=trajectory_topics,
            elements_by_topic=elements_by_topic,
            topic_index_by_topic_id=topic_index_by_topic_id,
        )
        trajectories.append(trajectory)

    session.flush()
    return trajectories


def create_trajectory_tasks(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topics: list[LearningTrajectoryTopic],
    elements_by_topic: dict[int, dict[str, KnowledgeElement]],
    topic_index_by_topic_id: dict[object, int],
) -> None:
    relation_by_key = build_relation_lookup(
        session.scalars(select(KnowledgeElementRelation)).all()
    )

    all_trajectory_know_elements = []
    for trajectory_topic in trajectory_topics:
        topic_index = topic_index_by_topic_id[trajectory_topic.topic_id]
        all_trajectory_know_elements.extend(
            [
                elements_by_topic[topic_index]["know_core"],
                elements_by_topic[topic_index]["know_detail"],
            ]
        )

    for trajectory_topic in trajectory_topics:
        topic_index = topic_index_by_topic_id[trajectory_topic.topic_id]
        current_elements = elements_by_topic[topic_index]
        primary_core = current_elements["know_core"]
        primary_detail = current_elements["know_detail"]
        distractors = pick_distractors(
            pool=all_trajectory_know_elements,
            excluded_ids={primary_core.id, primary_detail.id},
            count=3,
        )

        add_task(
            session=session,
            trajectory=trajectory,
            trajectory_topic=trajectory_topic,
            primary_element=primary_core,
            related_elements=distractors,
            checked_relations=[],
            task_type=LearningTrajectoryTaskType.SINGLE_CHOICE,
            template_kind=LearningTrajectoryTaskTemplateKind.DEFINITION_CHOICE,
            title=f"Определи понятие «{primary_core.name}»",
            prompt=f"Какое из перечисленных понятий соответствует формулировке: {primary_core.description}",
            difficulty=min(70, 20 + trajectory_topic.position * 5),
            content={
                "options": shuffle_options(
                    [
                        {
                            "id": str(primary_core.id),
                            "text": primary_core.name,
                            "is_correct": True,
                        },
                        *[
                            {
                                "id": str(element.id),
                                "text": element.name,
                                "is_correct": False,
                            }
                            for element in distractors
                        ],
                    ]
                )
            },
        )

        add_task(
            session=session,
            trajectory=trajectory,
            trajectory_topic=trajectory_topic,
            primary_element=primary_detail,
            related_elements=[primary_core, *distractors[:1]],
            checked_relations=collect_relations(
                relation_by_key,
                [
                    (primary_detail.id, primary_core.id, KnowledgeElementRelationType.REFINES),
                ],
            ),
            task_type=LearningTrajectoryTaskType.MULTIPLE_CHOICE,
            template_kind=LearningTrajectoryTaskTemplateKind.CONTAINS_MULTIPLE,
            title=f"Выбери связанные понятия для темы «{trajectory_topic.topic.name}»",
            prompt="Какие понятия относятся к текущему шагу траектории и должны быть удержаны вместе?",
            difficulty=min(80, 30 + trajectory_topic.position * 5),
            content={
                "options": shuffle_options(
                    [
                        {
                            "id": str(primary_core.id),
                            "text": primary_core.name,
                            "is_correct": True,
                        },
                        {
                            "id": str(primary_detail.id),
                            "text": primary_detail.name,
                            "is_correct": True,
                        },
                        *[
                            {
                                "id": str(element.id),
                                "text": element.name,
                                "is_correct": False,
                            }
                            for element in distractors[:2]
                        ],
                    ]
                )
            },
        )

        matching_pairs = [primary_core, primary_detail]
        add_task(
            session=session,
            trajectory=trajectory,
            trajectory_topic=trajectory_topic,
            primary_element=primary_core,
            related_elements=[primary_detail],
            checked_relations=collect_relations(
                relation_by_key,
                [
                    (primary_detail.id, primary_core.id, KnowledgeElementRelationType.REFINES),
                ],
            ),
            task_type=LearningTrajectoryTaskType.MATCHING,
            template_kind=LearningTrajectoryTaskTemplateKind.MATCHING_DEFINITION,
            title=f"Соотнеси термины и определения по теме «{trajectory_topic.topic.name}»",
            prompt="Установи соответствие между терминами и их определениями.",
            difficulty=min(85, 35 + trajectory_topic.position * 5),
            content={
                "pairs": [
                    {
                        "id": f"pair-{index + 1}",
                        "left": element.name,
                        "right": element.description or element.name,
                    }
                    for index, element in enumerate(matching_pairs)
                ]
            },
        )

        prerequisite_order = build_ordering_elements(
            trajectory_topic=trajectory_topic,
            trajectory_topics=trajectory_topics,
            elements_by_topic=elements_by_topic,
            topic_index_by_topic_id=topic_index_by_topic_id,
        )
        if len(prerequisite_order) >= 2:
            primary_for_order = prerequisite_order[-1]
            related_for_order = prerequisite_order[:-1]
            ordering_relation_keys: list[tuple[object, object, KnowledgeElementRelationType]] = []
            for previous, current in zip(prerequisite_order, prerequisite_order[1:], strict=False):
                ordering_relation_keys.append(
                    (current.id, previous.id, KnowledgeElementRelationType.REQUIRES)
                )
            add_task(
                session=session,
                trajectory=trajectory,
                trajectory_topic=trajectory_topic,
                primary_element=primary_for_order,
                related_elements=related_for_order,
                checked_relations=collect_relations(relation_by_key, ordering_relation_keys),
                task_type=LearningTrajectoryTaskType.ORDERING,
                template_kind=LearningTrajectoryTaskTemplateKind.REQUIRES_ORDERING,
                title=f"Выстрой базу для темы «{trajectory_topic.topic.name}»",
                prompt="Расположи понятия от базовых к более поздним по логике освоения.",
                difficulty=min(90, 40 + trajectory_topic.position * 5),
                content={
                    "items": shuffle_ordering_items(prerequisite_order),
                    "correct_order_ids": [str(element.id) for element in prerequisite_order],
                },
            )


def build_relation_lookup(
    relations: Iterable[KnowledgeElementRelation],
) -> dict[tuple[object, object, KnowledgeElementRelationType], KnowledgeElementRelation]:
    return {
        (relation.source_element_id, relation.target_element_id, relation.relation_type): relation
        for relation in relations
    }


def pick_distractors(
    pool: list[KnowledgeElement],
    excluded_ids: set[object],
    count: int,
) -> list[KnowledgeElement]:
    result: list[KnowledgeElement] = []
    for element in pool:
        if element.id in excluded_ids:
            continue
        result.append(element)
        if len(result) == count:
            break
    return result


def shuffle_options(options: list[dict[str, object]]) -> list[dict[str, object]]:
    shuffled = list(options)
    RNG.shuffle(shuffled)
    return shuffled


def shuffle_ordering_items(elements: list[KnowledgeElement]) -> list[dict[str, str]]:
    items = [{"id": str(element.id), "text": element.name} for element in elements]
    RNG.shuffle(items)
    return items


def build_ordering_elements(
    trajectory_topic: LearningTrajectoryTopic,
    trajectory_topics: list[LearningTrajectoryTopic],
    elements_by_topic: dict[int, dict[str, KnowledgeElement]],
    topic_index_by_topic_id: dict[object, int],
) -> list[KnowledgeElement]:
    current_topic_index = topic_index_by_topic_id.get(trajectory_topic.topic_id)
    if current_topic_index is None:
        return []

    available_previous_indices = {
        topic_index_by_topic_id[item.topic_id]
        for item in trajectory_topics
        if item.position < trajectory_topic.position
    }
    prerequisite_indices = [
        index
        for index in TOPIC_BLUEPRINTS[current_topic_index - 1].prerequisites
        if index in available_previous_indices
    ]
    ordered_elements = [
        elements_by_topic[index]["know_core"]
        for index in prerequisite_indices
    ]
    ordered_elements.append(elements_by_topic[current_topic_index]["know_core"])
    return ordered_elements


def collect_relations(
    relation_by_key: dict[tuple[object, object, KnowledgeElementRelationType], KnowledgeElementRelation],
    keys: list[tuple[object, object, KnowledgeElementRelationType]],
) -> list[KnowledgeElementRelation]:
    collected: list[KnowledgeElementRelation] = []
    seen_ids: set[object] = set()
    for key in keys:
        relation = relation_by_key.get(key)
        if relation is None or relation.id in seen_ids:
            continue
        seen_ids.add(relation.id)
        collected.append(relation)
    return collected


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

    seen_related_ids: set[object] = set()
    for element in related_elements:
        if element.id == primary_element.id or element.id in seen_related_ids:
            continue
        seen_related_ids.add(element.id)
        session.add(
            LearningTrajectoryTaskElement(
                task_id=task.id,
                element_id=element.id,
            )
        )

    for relation in checked_relations:
        session.add(
            LearningTrajectoryTaskRelation(
                task_id=task.id,
                relation_id=relation.id,
            )
        )

    session.flush()
    return task


def seed_student_mastery_and_progress(
    session: Session,
    discipline: Discipline,
    trajectories: list[LearningTrajectory],
    people: dict[str, object],
) -> None:
    students_by_subgroup = people["students_by_subgroup"]

    mastery_profiles = [
        [(82, 74), (46, 38), (15, 10)],
        [(68, 58), (22, 14)],
    ]

    for trajectory in trajectories:
        students = students_by_subgroup[trajectory.subgroup_id]
        for student_index, student in enumerate(students):
            profile = mastery_profiles[student_index]
            for topic_position, trajectory_topic in enumerate(trajectory.topics, start=1):
                base_pair = profile[min(topic_position - 1, len(profile) - 1)] if topic_position <= len(profile) else (0, 0)
                know_elements = session.scalars(
                    select(KnowledgeElement)
                    .join(
                        LearningTrajectoryElement,
                        LearningTrajectoryElement.element_id == KnowledgeElement.id,
                    )
                    .where(
                        LearningTrajectoryElement.trajectory_topic_id == trajectory_topic.id,
                    )
                    .order_by(KnowledgeElement.name)
                ).all()
                for element_index, element in enumerate(know_elements):
                    session.add(
                        StudentElementMastery(
                            student_id=student.id,
                            discipline_id=discipline.id,
                            element_id=element.id,
                            mastery_value=base_pair[element_index] if topic_position <= len(profile) else 0,
                        )
                    )

            first_task = session.scalars(
                select(LearningTrajectoryTask)
                .where(LearningTrajectoryTask.trajectory_id == trajectory.id)
                .order_by(LearningTrajectoryTask.created_at)
            ).first()
            if first_task is None:
                continue
            instance = StudentTaskInstance(
                student_id=student.id,
                task_id=first_task.id,
                content_snapshot_json=first_task.content_json,
                issued_at=utcnow_naive(),
                answered_at=utcnow_naive(),
            )
            session.add(instance)
            session.flush()

            feedback = {"summary": "Эталонная попытка для тестового набора данных."}
            session.add(
                StudentTaskAttempt(
                    instance_id=instance.id,
                    student_id=student.id,
                    task_id=first_task.id,
                    answer_payload_json=json.dumps({"seed": True}, ensure_ascii=False),
                    feedback_json=json.dumps(feedback, ensure_ascii=False),
                    score=100 if student_index == 0 else 60,
                    duration_seconds=45 + student_index * 15,
                )
            )
            session.add(
                StudentTaskProgress(
                    student_id=student.id,
                    task_id=first_task.id,
                    status=StudentTaskProgressStatus.COMPLETED if student_index == 0 else StudentTaskProgressStatus.IN_PROGRESS,
                    attempts_count=1,
                    last_score=100 if student_index == 0 else 60,
                    best_score=100 if student_index == 0 else 60,
                    last_answered_at=utcnow_naive(),
                    completed_at=utcnow_naive() if student_index == 0 else None,
                    last_answer_payload=json.dumps({"seed": True}, ensure_ascii=False),
                    last_feedback_json=json.dumps(feedback, ensure_ascii=False),
                )
            )

    session.flush()


def print_seed_summary(session: Session, discipline: Discipline) -> None:
    topics_count = session.query(Topic).count()
    elements_count = session.query(KnowledgeElement).count()
    relations_count = session.query(KnowledgeElementRelation).count()
    dependencies_count = session.query(TopicDependency).count()
    trajectories_count = session.query(LearningTrajectory).count()
    tasks_count = session.query(LearningTrajectoryTask).count()
    students_count = session.query(Student).count()
    teachers_count = session.query(Teacher).count()
    subgroups_count = session.query(Subgroup).count()

    print("\n=== Seed summary ===")
    print(f"Discipline: {discipline.name}")
    print(f"Topics: {topics_count}")
    print(f"Knowledge elements: {elements_count}")
    print(f"Element relations: {relations_count}")
    print(f"Topic dependencies: {dependencies_count}")
    print(f"Subgroups: {subgroups_count}")
    print(f"Teachers: {teachers_count}")
    print(f"Students: {students_count}")
    print(f"Learning trajectories: {trajectories_count}")
    print(f"Trajectory tasks: {tasks_count}")


if __name__ == "__main__":
    recreate_database()
