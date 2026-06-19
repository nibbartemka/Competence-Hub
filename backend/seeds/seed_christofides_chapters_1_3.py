from __future__ import annotations

import json
import os
import random
import sys
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any, Iterable

from sqlalchemy import create_engine, select
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session, sessionmaker

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
    Teacher,
    TeacherDiscipline,
    TeacherGroup,
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


DEFAULT_DB_PATH = Path(
    os.environ.get(
        "COMPETENCE_HUB_DB_PATH",
        str(ROOT_DIR / "app_christofides_chapters_1_3.db"),
    )
)
DATABASE_URL = os.environ.get(
    "COMPETENCE_HUB_DATABASE_URL",
    f"sqlite:///{DEFAULT_DB_PATH.as_posix()}",
)
RNG = random.Random(1978)


@dataclass(frozen=True)
class ElementSpec:
    key: str
    name: str
    description: str
    competence_type: CompetenceType = CompetenceType.KNOW
    operation_ref: str | None = None
    subject_area_description: str | None = None
    threshold: int = 60


@dataclass(frozen=True)
class TopicSpec:
    key: str
    name: str
    description: str
    required: tuple[str, ...]
    formed: tuple[ElementSpec, ...]
    threshold: int


@dataclass(frozen=True)
class SeededTrajectory:
    trajectory: LearningTrajectory
    group: Group
    teacher: Teacher
    tasks: dict[str, LearningTrajectoryTask]


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


TOPIC_SPECS: tuple[TopicSpec, ...] = (
    TopicSpec(
        key="chapter_1_intro",
        name="Глава 1. Введение",
        description=(
            "Определение графа, пути и маршруты, циклы, степени вершины, подграфы, "
            "типы графов и матричные представления."
        ),
        required=(),
        threshold=0,
        formed=(
            ElementSpec(
                "graph",
                "Граф",
                "Множество вершин вместе с заданным на них множеством ребер или дуг.",
                threshold=55,
            ),
            ElementSpec(
                "vertex",
                "Вершина",
                "Базовый объект графа, представляющий отдельную точку графовой структуры.",
                threshold=55,
            ),
            ElementSpec(
                "edge",
                "Ребро",
                "Связь между двумя вершинами неориентированного графа.",
                threshold=55,
            ),
            ElementSpec(
                "route",
                "Маршрут",
                "Последовательность ребер или дуг, которую можно пройти в графе шаг за шагом.",
                threshold=55,
            ),
            ElementSpec(
                "path",
                "Путь",
                "Маршрут, рассматриваемый как последовательность вершин и связей между ними.",
                threshold=55,
            ),
            ElementSpec(
                "cycle",
                "Цикл",
                "Замкнутый путь, возвращающийся в исходную вершину.",
                threshold=55,
            ),
            ElementSpec(
                "degree",
                "Степень вершины",
                "Количество ребер, инцидентных данной вершине.",
                threshold=60,
            ),
            ElementSpec(
                "subgraph",
                "Подграф",
                "Граф, образованный подмножеством вершин и ребер исходного графа.",
                threshold=60,
            ),
            ElementSpec(
                "adjacency_matrix",
                "Матрица смежности",
                "Матрица, показывающая, какие пары вершин графа соединены ребром или дугой.",
                threshold=60,
            ),
            ElementSpec(
                "incidence_matrix",
                "Матрица инциденций",
                "Матрица, отражающая связь между вершинами и ребрами графа.",
                threshold=60,
            ),
            ElementSpec(
                "build_intro_adjacency_matrix",
                "Строить матрицу смежности графа",
                "Умение представлять базовый граф в виде матрицы смежности.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_adjacency_matrix",
                threshold=72,
            ),
            ElementSpec(
                "build_intro_incidence_matrix",
                "Строить матрицу инциденций графа",
                "Умение представлять базовый граф в виде матрицы инциденций.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_incidence_matrix",
                threshold=72,
            ),
            ElementSpec(
                "compute_intro_degree_sequence",
                "Вычислять степени вершин графа",
                "Умение по описанию графа находить степени всех его вершин.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_degree_sequence",
                threshold=74,
            ),
            ElementSpec(
                "analyze_intro_graph_problem",
                "Анализировать граф по маршрутам, циклам и матрицам",
                "Владение комплексным разбором графа по его структуре и матричным представлениям.",
                competence_type=CompetenceType.MASTER,
                subject_area_description=(
                    "В первой главе рассматриваются определение графа, пути и маршруты, "
                    "циклы, степени вершины, подграфы и матричные представления. "
                    "Нужно уметь связать словесное описание графа с его структурой, "
                    "маршрутами, циклами и матрицами."
                ),
                threshold=82,
            ),
        ),
    ),
    TopicSpec(
        key="chapter_2_reachability",
        name="Глава 2. Достижимость и связность",
        description=(
            "Достижимость, матрицы достижимостей и контрадостижимостей, сильные "
            "компоненты, базы и ограниченная достижимость."
        ),
        required=("graph", "vertex", "edge", "path", "adjacency_matrix", "incidence_matrix", "degree"),
        threshold=45,
        formed=(
            ElementSpec(
                "reachability",
                "Достижимость",
                "Свойство вершины быть достижимой из другой вершины по направленному пути.",
                threshold=60,
            ),
            ElementSpec(
                "reachability_matrix",
                "Матрица достижимостей",
                "Матрица, показывающая, достижима ли одна вершина из другой.",
                threshold=62,
            ),
            ElementSpec(
                "contra_reachability_matrix",
                "Матрица контрадостижимостей",
                "Матрица, показывающая, из каких вершин можно попасть в выбранную вершину.",
                threshold=62,
            ),
            ElementSpec(
                "strong_component",
                "Сильная компонента",
                "Максимальный подграф, в котором каждая вершина достижима из любой другой.",
                threshold=64,
            ),
            ElementSpec(
                "basis",
                "База графа",
                "Минимальный по смыслу набор вершин, из которого достижимы остальные вершины графа.",
                threshold=66,
            ),
            ElementSpec(
                "contrabasis",
                "Антибаза графа",
                "Набор вершин, в которые достижимы остальные вершины графа.",
                threshold=66,
            ),
            ElementSpec(
                "transitive_closure",
                "Транзитивное замыкание графа",
                "Графовое представление всех отношений достижимости между вершинами.",
                threshold=66,
            ),
            ElementSpec(
                "prepare_reachability_adjacency_matrix",
                "Подготавливать матрицу смежности для анализа достижимости",
                "Умение строить матрицу смежности ориентированного графа как основу для анализа достижимости.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_adjacency_matrix",
                threshold=76,
            ),
            ElementSpec(
                "build_connectivity_incidence_matrix",
                "Строить матрицу инциденций для анализа связности",
                "Умение строить матрицу инциденций ориентированного графа при разборе связности.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_incidence_matrix",
                threshold=76,
            ),
            ElementSpec(
                "compute_connectivity_degree_sequence",
                "Вычислять локальные характеристики вершин для анализа связности",
                "Умение вычислять степени вершин как часть анализа структуры ориентированного графа.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_degree_sequence",
                threshold=78,
            ),
            ElementSpec(
                "analyze_organization_basis",
                "Исследовать структуру организации через достижимость и базу графа",
                "Владение интерпретацией ориентированного графа через сильные компоненты и базу.",
                competence_type=CompetenceType.MASTER,
                subject_area_description=(
                    "Во второй главе задача о достижимости связывается с анализом "
                    "структуры организации. Требуется выделять сильные компоненты, "
                    "объяснять достижимость между вершинами и обосновывать выбор базы графа."
                ),
                threshold=84,
            ),
        ),
    ),
    TopicSpec(
        key="chapter_3_sets_cover",
        name="Глава 3. Независимые и доминирующие множества. Задача о покрывающих множествах",
        description=(
            "Независимые множества, доминирующие множества, задача о наименьшем "
            "покрытии и ее приложения."
        ),
        required=("graph", "vertex", "edge", "subgraph", "degree", "adjacency_matrix", "incidence_matrix"),
        threshold=65,
        formed=(
            ElementSpec(
                "independent_set",
                "Независимое множество вершин",
                "Множество вершин, никакие две из которых не смежны.",
                threshold=64,
            ),
            ElementSpec(
                "maximal_independent_set",
                "Максимальное независимое множество",
                "Независимое множество, которое нельзя расширить добавлением новой вершины.",
                threshold=66,
            ),
            ElementSpec(
                "maximum_independent_set",
                "Наибольшее независимое множество",
                "Независимое множество наибольшей мощности среди всех независимых множеств графа.",
                threshold=68,
            ),
            ElementSpec(
                "dominating_set",
                "Доминирующее множество вершин",
                "Множество вершин, каждая вершина графа либо входит в него, либо смежна с его вершиной.",
                threshold=68,
            ),
            ElementSpec(
                "minimum_dominating_set",
                "Наименьшее доминирующее множество",
                "Доминирующее множество минимальной мощности.",
                threshold=70,
            ),
            ElementSpec(
                "covering_problem",
                "Задача о наименьшем покрытии",
                "Задача выбора минимального набора объектов, покрывающего все требуемые элементы.",
                threshold=70,
            ),
            ElementSpec(
                "clique",
                "Клика",
                "Полный подграф, в котором каждая вершина соединена со всеми остальными.",
                threshold=66,
            ),
            ElementSpec(
                "independence_number",
                "Число независимости",
                "Мощность наибольшего независимого множества графа.",
                threshold=70,
            ),
            ElementSpec(
                "domination_number",
                "Число доминирования",
                "Мощность наименьшего доминирующего множества графа.",
                threshold=70,
            ),
            ElementSpec(
                "build_independence_adjacency_matrix",
                "Строить матрицу смежности для анализа независимости",
                "Умение использовать матрицу смежности при разборе независимых множеств.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_adjacency_matrix",
                threshold=78,
            ),
            ElementSpec(
                "build_covering_incidence_matrix",
                "Строить матрицу инциденций для задачи о покрытии",
                "Умение использовать матрицу инциденций при разборе покрывающих множеств.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_incidence_matrix",
                threshold=78,
            ),
            ElementSpec(
                "compute_covering_vertex_degrees",
                "Вычислять степени вершин при выборе покрытия",
                "Умение использовать степени вершин как локальную подсказку при анализе покрытий и доминирования.",
                competence_type=CompetenceType.CAN,
                operation_ref="graph.operation.build_degree_sequence",
                threshold=80,
            ),
            ElementSpec(
                "justify_minimum_cover",
                "Обосновывать решение задачи о наименьшем покрытии",
                "Владение сведением прикладной постановки к покрытию и доказательством минимальности решения.",
                competence_type=CompetenceType.MASTER,
                subject_area_description=(
                    "В третьей главе задача о наименьшем покрытии применяется к "
                    "информационному поиску, сетевому планированию, синхронизации "
                    "линии сборки и государственному районированию. Требуется описать "
                    "сведение прикладной постановки к покрытию и объяснить, почему "
                    "выбранное покрытие является минимальным."
                ),
                threshold=86,
            ),
        ),
    ),
)

TOPIC_SPEC_BY_KEY = {spec.key: spec for spec in TOPIC_SPECS}
ELEMENT_SPEC_BY_KEY = {
    element_spec.key: element_spec
    for topic_spec in TOPIC_SPECS
    for element_spec in topic_spec.formed
}

CAN_TASK_SPECS: dict[str, dict[str, Any]] = {
    "build_intro_adjacency_matrix": {
        "title": "Уметь: матрица смежности базового графа",
        "prompt": (
            "Построй матрицу смежности для неориентированного графа с вершинами "
            "A, B, C, D и ребрами A-B, A-C, C-D."
        ),
        "difficulty": 36,
        "related_keys": ["graph", "vertex", "edge", "adjacency_matrix"],
        "relation_specs": [
            ("build_intro_adjacency_matrix", "graph", KnowledgeElementRelationType.IMPLEMENTS),
            ("build_intro_adjacency_matrix", "adjacency_matrix", KnowledgeElementRelationType.IMPLEMENTS),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "C", "target": "D"},
            ],
            "directed": False,
        },
    },
    "build_intro_incidence_matrix": {
        "title": "Уметь: матрица инциденций базового графа",
        "prompt": (
            "Построй матрицу инциденций для неориентированного графа с вершинами "
            "A, B, C, D и ребрами A-B, B-C, C-D."
        ),
        "difficulty": 38,
        "related_keys": ["graph", "vertex", "edge", "incidence_matrix"],
        "relation_specs": [
            ("build_intro_incidence_matrix", "graph", KnowledgeElementRelationType.IMPLEMENTS),
            ("build_intro_incidence_matrix", "incidence_matrix", KnowledgeElementRelationType.IMPLEMENTS),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
            ],
            "directed": False,
        },
    },
    "compute_intro_degree_sequence": {
        "title": "Уметь: степени вершин базового графа",
        "prompt": (
            "Вычисли степени вершин для неориентированного графа с вершинами "
            "A, B, C, D и ребрами A-B, A-C, B-D."
        ),
        "difficulty": 40,
        "related_keys": ["graph", "vertex", "degree"],
        "relation_specs": [
            ("compute_intro_degree_sequence", "graph", KnowledgeElementRelationType.IMPLEMENTS),
            ("compute_intro_degree_sequence", "degree", KnowledgeElementRelationType.IMPLEMENTS),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "B", "target": "D"},
            ],
            "directed": False,
        },
    },
    "prepare_reachability_adjacency_matrix": {
        "title": "Уметь: матрица смежности для анализа достижимости",
        "prompt": (
            "Построй матрицу смежности ориентированного графа A, B, C, D с дугами "
            "A->B, B->C, A->D, D->C как подготовительный шаг к анализу достижимости."
        ),
        "difficulty": 46,
        "related_keys": ["reachability", "reachability_matrix", "adjacency_matrix"],
        "relation_specs": [
            ("prepare_reachability_adjacency_matrix", "adjacency_matrix", KnowledgeElementRelationType.IMPLEMENTS),
            ("prepare_reachability_adjacency_matrix", "reachability_matrix", KnowledgeElementRelationType.BUILDS_ON),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "A", "target": "D"},
                {"source": "D", "target": "C"},
            ],
            "directed": True,
        },
    },
    "build_connectivity_incidence_matrix": {
        "title": "Уметь: матрица инциденций для анализа связности",
        "prompt": (
            "Построй матрицу инциденций ориентированного графа A, B, C, D с дугами "
            "A->B, B->A, B->C, C->D как подготовительный шаг к анализу сильных компонент."
        ),
        "difficulty": 48,
        "related_keys": ["strong_component", "incidence_matrix", "reachability"],
        "relation_specs": [
            ("build_connectivity_incidence_matrix", "incidence_matrix", KnowledgeElementRelationType.IMPLEMENTS),
            ("build_connectivity_incidence_matrix", "strong_component", KnowledgeElementRelationType.RELIES_ON),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "A"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
            ],
            "directed": True,
        },
    },
    "compute_connectivity_degree_sequence": {
        "title": "Уметь: характеристики вершин для анализа связности",
        "prompt": (
            "Для ориентированного графа A, B, C, D с дугами A->B, C->B, B->D, D->C "
            "вычисли входящие и исходящие степени вершин."
        ),
        "difficulty": 50,
        "related_keys": ["basis", "degree", "reachability"],
        "relation_specs": [
            ("compute_connectivity_degree_sequence", "degree", KnowledgeElementRelationType.IMPLEMENTS),
            ("compute_connectivity_degree_sequence", "basis", KnowledgeElementRelationType.RELIES_ON),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "C", "target": "B"},
                {"source": "B", "target": "D"},
                {"source": "D", "target": "C"},
            ],
            "directed": True,
        },
    },
    "build_independence_adjacency_matrix": {
        "title": "Уметь: матрица смежности для независимых множеств",
        "prompt": (
            "Построй матрицу смежности неориентированного графа A, B, C, D, E с "
            "ребрами A-B, B-C, C-D, D-E и A-E для последующего анализа независимых множеств."
        ),
        "difficulty": 54,
        "related_keys": ["independent_set", "adjacency_matrix", "clique"],
        "relation_specs": [
            ("build_independence_adjacency_matrix", "adjacency_matrix", KnowledgeElementRelationType.IMPLEMENTS),
            ("build_independence_adjacency_matrix", "independent_set", KnowledgeElementRelationType.RELIES_ON),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "E"},
                {"source": "A", "target": "E"},
            ],
            "directed": False,
        },
    },
    "build_covering_incidence_matrix": {
        "title": "Уметь: матрица инциденций для задачи о покрытии",
        "prompt": (
            "Построй матрицу инциденций для графа A, B, C, D с ребрами A-B, A-C, "
            "B-C, C-D как подготовительный шаг к анализу покрывающего множества."
        ),
        "difficulty": 56,
        "related_keys": ["covering_problem", "incidence_matrix", "dominating_set"],
        "relation_specs": [
            ("build_covering_incidence_matrix", "incidence_matrix", KnowledgeElementRelationType.IMPLEMENTS),
            ("build_covering_incidence_matrix", "covering_problem", KnowledgeElementRelationType.RELIES_ON),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
            ],
            "directed": False,
        },
    },
    "compute_covering_vertex_degrees": {
        "title": "Уметь: степени вершин для анализа покрытия",
        "prompt": (
            "Вычисли степени вершин графа A, B, C, D, E с ребрами A-B, A-C, B-D, "
            "C-D, D-E и используй результат как локальную характеристику при анализе покрытия."
        ),
        "difficulty": 58,
        "related_keys": ["degree", "dominating_set", "covering_problem"],
        "relation_specs": [
            ("compute_covering_vertex_degrees", "degree", KnowledgeElementRelationType.IMPLEMENTS),
            ("compute_covering_vertex_degrees", "dominating_set", KnowledgeElementRelationType.RELIES_ON),
        ],
        "input_payload": {
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "B", "target": "D"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "E"},
            ],
            "directed": False,
        },
    },
}


MASTER_TASK_SPECS: dict[str, dict[str, Any]] = {
    "analyze_intro_graph_problem": {
        "title": "Владеть: анализ структуры графа первой главы",
        "prompt": (
            "Для графа G = (V, E), где V = {A, B, C, D}, E = {AB, AC, BD, CD}, "
            "объясни, какие вершины смежны, какие маршруты образуют цикл, какие "
            "степени имеют вершины и как это отражается в матрицах смежности и инциденций."
        ),
        "difficulty": 64,
        "related_keys": ["route", "path", "cycle", "adjacency_matrix", "incidence_matrix"],
        "relation_specs": [
            ("analyze_intro_graph_problem", "build_intro_adjacency_matrix", KnowledgeElementRelationType.AUTOMATES),
            ("analyze_intro_graph_problem", "build_intro_incidence_matrix", KnowledgeElementRelationType.AUTOMATES),
            ("analyze_intro_graph_problem", "compute_intro_degree_sequence", KnowledgeElementRelationType.AUTOMATES),
        ],
        "placeholder": "Кратко объясните структуру графа, маршруты, цикл, степени и матричные представления.",
    },
    "analyze_organization_basis": {
        "title": "Владеть: структура организации через базу графа",
        "prompt": (
            "Структура организации задана ориентированным графом подчинения. "
            "Опиши, как по такому графу выделять сильные компоненты, объяснять "
            "достижимость между подразделениями и выбирать базу графа."
        ),
        "difficulty": 68,
        "related_keys": ["reachability", "strong_component", "basis"],
        "relation_specs": [
            ("analyze_organization_basis", "prepare_reachability_adjacency_matrix", KnowledgeElementRelationType.AUTOMATES),
            ("analyze_organization_basis", "strong_component", KnowledgeElementRelationType.BUILDS_ON),
            ("analyze_organization_basis", "basis", KnowledgeElementRelationType.BUILDS_ON),
        ],
        "placeholder": "Опишите, как определяются достижимость, сильные компоненты и база графа в этой постановке.",
    },
    "justify_minimum_cover": {
        "title": "Владеть: обоснование минимального покрытия",
        "prompt": (
            "Опиши, как прикладную постановку из приложений третьей главы можно "
            "свести к задаче о наименьшем покрытии, и объясни, почему выбранное покрытие минимально."
        ),
        "difficulty": 72,
        "related_keys": ["covering_problem", "minimum_dominating_set", "independent_set"],
        "relation_specs": [
            ("justify_minimum_cover", "build_covering_incidence_matrix", KnowledgeElementRelationType.AUTOMATES),
            ("justify_minimum_cover", "covering_problem", KnowledgeElementRelationType.BUILDS_ON),
            ("justify_minimum_cover", "minimum_dominating_set", KnowledgeElementRelationType.BUILDS_ON),
        ],
        "placeholder": "Опишите сведение к покрытию и обоснование минимальности выбранного решения.",
    },
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


def utcnow_naive() -> datetime:
    return datetime.now(UTC).replace(tzinfo=None)


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
    relation_catalog = seed_relation_catalog(session)
    people = seed_people(session)
    discipline = seed_discipline(session, people)
    topics, elements = seed_knowledge_graph(session, discipline, relation_catalog)
    seed_topic_dependencies(session, topics)
    trajectories = seed_learning_trajectories(session, discipline, people, topics, elements)
    seed_student_mastery_and_progress(session, discipline, trajectories, people, elements)
    print_seed_summary(session, discipline, trajectories, people)


def seed_relation_catalog(session: Session) -> dict[KnowledgeElementRelationType, Relation]:
    relations: dict[KnowledgeElementRelationType, Relation] = {}
    for relation_type, direction in RELATION_DIRECTION_BY_TYPE.items():
        relation = Relation(relation_type=relation_type, direction=direction)
        session.add(relation)
        relations[relation_type] = relation
    session.flush()
    return relations


def seed_people(session: Session) -> dict[str, object]:
    admin = Admin(name="Администратор", login="admin", password="admin")
    expert = Expert(name="Эксперт по теории графов", login="expert_graph", password="expert_graph")

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

    group_1 = Group(name="ГРАФ-101")
    group_2 = Group(name="ГРАФ-102")

    session.add_all([admin, expert, teacher_1, teacher_2, group_1, group_2])
    session.flush()

    students = [
        Student(name="Смирнов Илья", login="smirnov", password="student", group_id=group_1.id),
        Student(name="Орлова Мария", login="orlova", password="student", group_id=group_1.id),
        Student(name="Егоров Павел", login="egorov", password="student", group_id=group_2.id),
        Student(name="Лебедева Анна", login="lebedeva", password="student", group_id=group_2.id),
    ]
    session.add_all(students)
    session.flush()

    session.add_all(
        [
            TeacherGroup(teacher_id=teacher_1.id, group_id=group_1.id),
            TeacherGroup(teacher_id=teacher_2.id, group_id=group_2.id),
        ]
    )
    session.flush()

    return {
        "admin": admin,
        "expert": expert,
        "teachers": [teacher_1, teacher_2],
        "groups": [group_1, group_2],
        "students": students,
        "students_by_group": {
            group_1.id: [student for student in students if student.group_id == group_1.id],
            group_2.id: [student for student in students if student.group_id == group_2.id],
        },
    }


def seed_discipline(session: Session, people: dict[str, object]) -> Discipline:
    name = "Теория графов. Алгоритмический подход"
    discipline = Discipline(
        name=name,
        slug=transliterate_to_slug_base(name),
        knowledge_graph_version=1,
    )
    session.add(discipline)
    session.flush()

    session.add(ExpertDiscipline(expert_id=people["expert"].id, discipline_id=discipline.id))

    for group in people["groups"]:
        session.add(GroupDiscipline(group_id=group.id, discipline_id=discipline.id))
    for teacher in people["teachers"]:
        session.add(TeacherDiscipline(teacher_id=teacher.id, discipline_id=discipline.id))
    for student in people["students"]:
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
                operation_ref=element_spec.operation_ref,
                subject_area_description=element_spec.subject_area_description,
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
                    note="Требуется для освоения темы.",
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
        ("graph", "vertex", KnowledgeElementRelationType.CONTAINS, "Граф описывается через множество вершин."),
        ("graph", "edge", KnowledgeElementRelationType.CONTAINS, "Граф описывается через множество ребер."),
        ("route", "vertex", KnowledgeElementRelationType.REQUIRES, "Маршрут задается через вершины графа."),
        ("route", "edge", KnowledgeElementRelationType.REQUIRES, "Маршрут задается через связи между вершинами."),
        ("path", "route", KnowledgeElementRelationType.REFINES, "Путь рассматривается как специальный вид маршрута."),
        ("cycle", "path", KnowledgeElementRelationType.REFINES, "Цикл является замкнутым путем."),
        ("degree", "vertex", KnowledgeElementRelationType.PROPERTY_OF, "Степень является характеристикой вершины."),
        ("subgraph", "graph", KnowledgeElementRelationType.PART_OF, "Подграф выделяется из исходного графа."),
        ("adjacency_matrix", "graph", KnowledgeElementRelationType.PROPERTY_OF, "Матрица смежности описывает структуру графа."),
        ("incidence_matrix", "graph", KnowledgeElementRelationType.PROPERTY_OF, "Матрица инциденций описывает связь вершин и ребер."),
        ("build_intro_adjacency_matrix", "graph", KnowledgeElementRelationType.IMPLEMENTS, "Умение работает с описанием графа."),
        ("build_intro_adjacency_matrix", "vertex", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует вершины графа."),
        ("build_intro_adjacency_matrix", "edge", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует ребра графа."),
        ("build_intro_adjacency_matrix", "adjacency_matrix", KnowledgeElementRelationType.IMPLEMENTS, "Умение выражает граф матрицей смежности."),
        ("build_intro_incidence_matrix", "graph", KnowledgeElementRelationType.IMPLEMENTS, "Умение работает с описанием графа."),
        ("build_intro_incidence_matrix", "vertex", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует вершины графа."),
        ("build_intro_incidence_matrix", "edge", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует ребра графа."),
        ("build_intro_incidence_matrix", "incidence_matrix", KnowledgeElementRelationType.IMPLEMENTS, "Умение выражает граф матрицей инциденций."),
        ("compute_intro_degree_sequence", "graph", KnowledgeElementRelationType.IMPLEMENTS, "Умение опирается на модель графа."),
        ("compute_intro_degree_sequence", "vertex", KnowledgeElementRelationType.IMPLEMENTS, "Умение вычисляет характеристики вершин."),
        ("compute_intro_degree_sequence", "degree", KnowledgeElementRelationType.IMPLEMENTS, "Умение вычисляет степени вершин."),
        ("analyze_intro_graph_problem", "build_intro_adjacency_matrix", KnowledgeElementRelationType.AUTOMATES, "Владение включает построение матрицы смежности."),
        ("analyze_intro_graph_problem", "build_intro_incidence_matrix", KnowledgeElementRelationType.AUTOMATES, "Владение включает построение матрицы инциденций."),
        ("analyze_intro_graph_problem", "compute_intro_degree_sequence", KnowledgeElementRelationType.AUTOMATES, "Владение включает вычисление степеней."),
        ("reachability", "path", KnowledgeElementRelationType.BUILDS_ON, "Достижимость определяется через существование пути."),
        ("reachability_matrix", "adjacency_matrix", KnowledgeElementRelationType.BUILDS_ON, "Матрица достижимостей строится на основе матричного представления графа."),
        ("contra_reachability_matrix", "reachability_matrix", KnowledgeElementRelationType.CONTRASTS_WITH, "Контрадостижимость рассматривает достижение в обратном направлении."),
        ("strong_component", "reachability", KnowledgeElementRelationType.BUILDS_ON, "Сильная компонента описывается через взаимную достижимость."),
        ("basis", "strong_component", KnowledgeElementRelationType.BUILDS_ON, "База определяется с учетом структуры сильных компонент."),
        ("contrabasis", "basis", KnowledgeElementRelationType.CONTRASTS_WITH, "Антибаза противопоставляется базе по направлению достижимости."),
        ("transitive_closure", "reachability_matrix", KnowledgeElementRelationType.BUILDS_ON, "Транзитивное замыкание выражает все отношения достижимости."),
        ("prepare_reachability_adjacency_matrix", "adjacency_matrix", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует матрицу смежности."),
        ("prepare_reachability_adjacency_matrix", "reachability_matrix", KnowledgeElementRelationType.BUILDS_ON, "Умение подготавливает основу для матрицы достижимостей."),
        ("build_connectivity_incidence_matrix", "incidence_matrix", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует матрицу инциденций."),
        ("build_connectivity_incidence_matrix", "strong_component", KnowledgeElementRelationType.RELIES_ON, "Умение применяется при анализе сильных компонент."),
        ("compute_connectivity_degree_sequence", "degree", KnowledgeElementRelationType.IMPLEMENTS, "Умение вычисляет локальные характеристики вершин."),
        ("compute_connectivity_degree_sequence", "basis", KnowledgeElementRelationType.RELIES_ON, "Умение помогает анализировать базу графа."),
        ("analyze_organization_basis", "prepare_reachability_adjacency_matrix", KnowledgeElementRelationType.AUTOMATES, "Владение включает матричную подготовку анализа достижимости."),
        ("analyze_organization_basis", "strong_component", KnowledgeElementRelationType.BUILDS_ON, "Владение использует понятие сильной компоненты."),
        ("analyze_organization_basis", "basis", KnowledgeElementRelationType.BUILDS_ON, "Владение использует понятие базы графа."),
        ("independent_set", "graph", KnowledgeElementRelationType.REQUIRES, "Независимое множество определяется в графе."),
        ("maximal_independent_set", "independent_set", KnowledgeElementRelationType.REFINES, "Максимальное независимое множество уточняет независимое множество."),
        ("maximum_independent_set", "independent_set", KnowledgeElementRelationType.REFINES, "Наибольшее независимое множество уточняет независимое множество по мощности."),
        ("dominating_set", "graph", KnowledgeElementRelationType.REQUIRES, "Доминирующее множество определяется в графе."),
        ("minimum_dominating_set", "dominating_set", KnowledgeElementRelationType.REFINES, "Наименьшее доминирующее множество уточняет доминирующее множество."),
        ("covering_problem", "graph", KnowledgeElementRelationType.BUILDS_ON, "Задача о покрытии ставится на графовой модели."),
        ("clique", "independent_set", KnowledgeElementRelationType.CONTRASTS_WITH, "Клика противопоставляется независимому множеству."),
        ("independence_number", "independent_set", KnowledgeElementRelationType.PROPERTY_OF, "Число независимости характеризует независимые множества графа."),
        ("domination_number", "dominating_set", KnowledgeElementRelationType.PROPERTY_OF, "Число доминирования характеризует доминирующие множества графа."),
        ("build_independence_adjacency_matrix", "adjacency_matrix", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует матрицу смежности."),
        ("build_independence_adjacency_matrix", "independent_set", KnowledgeElementRelationType.RELIES_ON, "Умение применяется при анализе независимых множеств."),
        ("build_covering_incidence_matrix", "incidence_matrix", KnowledgeElementRelationType.IMPLEMENTS, "Умение использует матрицу инциденций."),
        ("build_covering_incidence_matrix", "covering_problem", KnowledgeElementRelationType.RELIES_ON, "Умение применяется при разборе покрытия."),
        ("compute_covering_vertex_degrees", "degree", KnowledgeElementRelationType.IMPLEMENTS, "Умение вычисляет степени вершин."),
        ("compute_covering_vertex_degrees", "dominating_set", KnowledgeElementRelationType.RELIES_ON, "Умение помогает анализировать доминирование."),
        ("justify_minimum_cover", "build_covering_incidence_matrix", KnowledgeElementRelationType.AUTOMATES, "Владение включает матричную подготовку задачи о покрытии."),
        ("justify_minimum_cover", "covering_problem", KnowledgeElementRelationType.BUILDS_ON, "Владение строится на понятии покрытия."),
        ("justify_minimum_cover", "minimum_dominating_set", KnowledgeElementRelationType.BUILDS_ON, "Владение использует идею минимальности доминирующего набора."),
    ]

    topic_ids_by_element_id: dict[object, set[object]] = {}
    for link in session.scalars(select(TopicKnowledgeElement)).all():
        topic_ids_by_element_id.setdefault(link.element_id, set()).add(link.topic_id)

    for source_key, target_key, relation_type, description in relation_specs:
        shared_topic_ids = (
            topic_ids_by_element_id.get(elements[source_key].id, set())
            & topic_ids_by_element_id.get(elements[target_key].id, set())
        )
        if not shared_topic_ids:
            continue
        session.add(
            KnowledgeElementRelation(
                topic_id=sorted(shared_topic_ids, key=str)[0],
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


def seed_learning_trajectories(
    session: Session,
    discipline: Discipline,
    people: dict[str, object],
    topics: dict[str, Topic],
    elements: dict[str, KnowledgeElement],
) -> list[SeededTrajectory]:
    threshold_by_key = {
        element_spec.key: element_spec.threshold
        for topic_spec in TOPIC_SPECS
        for element_spec in topic_spec.formed
    }

    seeded: list[SeededTrajectory] = []
    topic_order = [spec.key for spec in TOPIC_SPECS]

    for teacher, group in zip(people["teachers"], people["groups"], strict=True):
        trajectory = LearningTrajectory(
            name=f"Главы 1-3 Кристофидеса: {group.name}",
            status=LearningTrajectoryStatus.ACTIVE,
            graph_version=discipline.knowledge_graph_version,
            discipline_id=discipline.id,
            teacher_id=teacher.id,
            group_id=group.id,
        )
        session.add(trajectory)
        session.flush()

        trajectory_topics: dict[str, LearningTrajectoryTopic] = {}
        for position, topic_key in enumerate(topic_order, start=1):
            topic_spec = TOPIC_SPEC_BY_KEY[topic_key]
            trajectory_topic = LearningTrajectoryTopic(
                trajectory_id=trajectory.id,
                topic_id=topics[topic_key].id,
                position=position,
                threshold=topic_spec.threshold,
            )
            session.add(trajectory_topic)
            session.flush()
            trajectory_topics[topic_key] = trajectory_topic

            for element_spec in topic_spec.formed:
                session.add(
                    LearningTrajectoryElement(
                        trajectory_topic_id=trajectory_topic.id,
                        element_id=elements[element_spec.key].id,
                        threshold=threshold_by_key[element_spec.key],
                    )
                )

        session.flush()
        tasks = seed_tasks_for_trajectory(session, trajectory, trajectory_topics, topics, elements)
        seeded.append(
            SeededTrajectory(
                trajectory=trajectory,
                group=group,
                teacher=teacher,
                tasks=tasks,
            )
        )

    session.flush()
    return seeded


def seed_tasks_for_trajectory(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topics: dict[str, LearningTrajectoryTopic],
    topics: dict[str, Topic],
    elements: dict[str, KnowledgeElement],
) -> dict[str, LearningTrajectoryTask]:
    relation_by_key = build_relation_lookup(
        session.scalars(select(KnowledgeElementRelation)).all()
    )
    all_know_elements = [
        element
        for element in elements.values()
        if element.competence_type == CompetenceType.KNOW
    ]

    created: dict[str, LearningTrajectoryTask] = {}
    for topic_spec in TOPIC_SPECS:
        topic = topics[topic_spec.key]
        trajectory_topic = trajectory_topics[topic_spec.key]
        know_elements = get_topic_formed_elements(session, topic, CompetenceType.KNOW)

        for element_key in [
            spec.key
            for spec in topic_spec.formed
            if spec.competence_type == CompetenceType.KNOW
        ]:
            element = elements[element_key]
            distractors = pick_distractors(all_know_elements, {element.id}, 3)
            created[f"definition:{element_key}:{trajectory.id}"] = add_single_choice_task(
                session=session,
                trajectory=trajectory,
                trajectory_topic=trajectory_topic,
                primary_element=element,
                related_elements=distractors,
                checked_relations=[],
                title=f"Определение: {element.name}",
                prompt=f"Какое понятие соответствует определению: {element.description}",
                difficulty=min(70, 24 + trajectory_topic.position * 4),
                options=[element, *distractors],
                correct_ids={element.id},
            )

        matching_selection = know_elements[:4]
        if len(matching_selection) >= 2:
            created[f"matching:{topic_spec.key}:{trajectory.id}"] = add_matching_task(
                session=session,
                trajectory=trajectory,
                trajectory_topic=trajectory_topic,
                elements_for_matching=matching_selection,
            )

        for element_spec in topic_spec.formed:
            if element_spec.competence_type == CompetenceType.CAN:
                task_spec = CAN_TASK_SPECS[element_spec.key]
                primary_element = elements[element_spec.key]
                related_elements = [elements[key] for key in task_spec["related_keys"]]
                checked_relations = collect_relations(
                    relation_by_key,
                    [
                        (element_spec.key, target_key, relation_type)
                        for _, target_key, relation_type in task_spec["relation_specs"]
                    ],
                    elements,
                )
                created[f"can:{element_spec.key}:{trajectory.id}"] = add_text_task(
                    session=session,
                    trajectory=trajectory,
                    trajectory_topic=trajectory_topic,
                    primary_element=primary_element,
                    related_elements=related_elements,
                    checked_relations=checked_relations,
                    title=task_spec["title"],
                    prompt=task_spec["prompt"],
                    difficulty=task_spec["difficulty"],
                    content={
                        "operation_ref": primary_element.operation_ref,
                        "input_payload": task_spec["input_payload"],
                        "placeholder": "Введите JSON-ответ, соответствующий контракту операции.",
                    },
                )
            elif element_spec.competence_type == CompetenceType.MASTER:
                task_spec = MASTER_TASK_SPECS[element_spec.key]
                checked_relations = collect_relations(
                    relation_by_key,
                    [
                        (element_spec.key, target_key, relation_type)
                        for _, target_key, relation_type in task_spec["relation_specs"]
                    ],
                    elements,
                )
                created[f"master:{element_spec.key}:{trajectory.id}"] = add_text_task(
                    session=session,
                    trajectory=trajectory,
                    trajectory_topic=trajectory_topic,
                    primary_element=elements[element_spec.key],
                    related_elements=[elements[key] for key in task_spec["related_keys"]],
                    checked_relations=checked_relations,
                    title=task_spec["title"],
                    prompt=task_spec["prompt"],
                    difficulty=task_spec["difficulty"],
                    content={
                        "manual_review": True,
                        "placeholder": task_spec["placeholder"],
                    },
                )

    session.flush()
    return created


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
    collected: list[KnowledgeElementRelation] = []
    seen_ids: set[object] = set()
    for source_key, target_key, relation_type in specs:
        relation = relation_by_key.get((elements[source_key].id, elements[target_key].id, relation_type))
        if relation is None or relation.id in seen_ids:
            continue
        seen_ids.add(relation.id)
        collected.append(relation)
    return collected


def pick_distractors(
    pool: list[KnowledgeElement],
    excluded_ids: set[object],
    count: int,
) -> list[KnowledgeElement]:
    candidates = [element for element in pool if element.id not in excluded_ids]
    RNG.shuffle(candidates)
    return candidates[:count]


def add_single_choice_task(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
    checked_relations: list[KnowledgeElementRelation],
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
        template_kind=LearningTrajectoryTaskTemplateKind.TERM_CHOICE,
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
) -> LearningTrajectoryTask:
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
        difficulty=min(80, 36 + trajectory_topic.position * 4),
        content={"left": left, "right": right, "pairs": pairs},
    )


def add_text_task(
    session: Session,
    trajectory: LearningTrajectory,
    trajectory_topic: LearningTrajectoryTopic,
    primary_element: KnowledgeElement,
    related_elements: list[KnowledgeElement],
    checked_relations: list[KnowledgeElementRelation],
    title: str,
    prompt: str,
    difficulty: int,
    content: dict[str, Any],
) -> LearningTrajectoryTask:
    return add_task(
        session=session,
        trajectory=trajectory,
        trajectory_topic=trajectory_topic,
        primary_element=primary_element,
        related_elements=related_elements,
        checked_relations=checked_relations,
        task_type=LearningTrajectoryTaskType.TEXT,
        template_kind=LearningTrajectoryTaskTemplateKind.MANUAL,
        title=title,
        prompt=prompt,
        difficulty=difficulty,
        content=content,
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

    for relation in checked_relations:
        session.add(LearningTrajectoryTaskRelation(task_id=task.id, relation_id=relation.id))

    session.flush()
    return task


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
        "submission_kind": "text",
        "summary": "Демонстрационный ответ для ручной проверки.",
    }
    feedback = {
        "manual_review": True,
        "pending_review": True,
        "summary": "Ответ ожидает ручной проверки преподавателем.",
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


def mastery_profile(*, know: int, can: int, master: int) -> dict[str, int]:
    profile: dict[str, int] = {}
    for topic_spec in TOPIC_SPECS:
        for element_spec in topic_spec.formed:
            if element_spec.competence_type == CompetenceType.KNOW:
                profile[element_spec.key] = know
            elif element_spec.competence_type == CompetenceType.CAN:
                profile[element_spec.key] = can
            else:
                profile[element_spec.key] = master
    return profile


def seed_student_mastery_and_progress(
    session: Session,
    discipline: Discipline,
    trajectories: list[SeededTrajectory],
    people: dict[str, object],
    elements: dict[str, KnowledgeElement],
) -> None:
    students: list[Student] = people["students"]
    student_by_login = {student.login: student for student in students}

    profiles = {
        "smirnov": mastery_profile(know=15, can=0, master=0),
        "orlova": mastery_profile(know=72, can=24, master=0),
        "egorov": mastery_profile(know=82, can=58, master=12),
        "lebedeva": mastery_profile(know=90, can=82, master=48),
    }

    for login, profile in profiles.items():
        student = student_by_login[login]
        for element_key, element in elements.items():
            session.add(
                StudentElementMastery(
                    student_id=student.id,
                    discipline_id=discipline.id,
                    element_id=element.id,
                    mastery_value=profile.get(element_key, 0),
                )
            )

    trajectory_by_group_id = {
        seeded_trajectory.group.id: seeded_trajectory
        for seeded_trajectory in trajectories
    }
    now = utcnow_naive()

    group_1_trajectory = trajectory_by_group_id[people["groups"][0].id]
    group_2_trajectory = trajectory_by_group_id[people["groups"][1].id]

    create_progress_with_attempt(
        session=session,
        student=student_by_login["orlova"],
        task=group_1_trajectory.tasks[f"definition:graph:{group_1_trajectory.trajectory.id}"],
        answered_at=now - timedelta(hours=3),
        score=100,
        duration_seconds=18,
        answer_payload={"selected_option_ids": ["correct"]},
        feedback={"is_correct": True, "summary": "Демонстрационная успешная попытка."},
        status=StudentTaskProgressStatus.COMPLETED,
        completed_at=now - timedelta(hours=3),
    )

    create_progress_with_attempt(
        session=session,
        student=student_by_login["egorov"],
        task=group_2_trajectory.tasks[f"can:prepare_reachability_adjacency_matrix:{group_2_trajectory.trajectory.id}"],
        answered_at=now - timedelta(hours=2),
        score=80,
        duration_seconds=64,
        answer_payload={"seed": True},
        feedback={"is_correct": True, "summary": "Демонстрационная попытка по теме достижимости."},
        status=StudentTaskProgressStatus.COMPLETED,
        completed_at=now - timedelta(hours=2),
    )

    create_pending_review_progress(
        session=session,
        student=student_by_login["lebedeva"],
        task=group_2_trajectory.tasks[f"master:justify_minimum_cover:{group_2_trajectory.trajectory.id}"],
        answered_at=now - timedelta(minutes=40),
    )

    session.flush()


def print_seed_summary(
    session: Session,
    discipline: Discipline,
    trajectories: list[SeededTrajectory],
    people: dict[str, object],
) -> None:
    print("\n=== Christofides chapters 1-3 seed ===")
    print(f"Discipline: {discipline.name}")
    print(f"Topics: {session.query(Topic).count()}")
    print(f"Knowledge elements: {session.query(KnowledgeElement).count()}")
    print(f"Element relations: {session.query(KnowledgeElementRelation).count()}")
    print(f"Topic dependencies: {session.query(TopicDependency).count()}")
    print(f"Learning trajectories: {session.query(LearningTrajectory).count()}")
    print(f"Trajectory tasks: {session.query(LearningTrajectoryTask).count()}")
    print(f"Teachers: {len(people['teachers'])}")
    print(f"Students: {len(people['students'])}")
    print(f"Groups: {len(people['groups'])}")
    print("\nLogins:")
    print("  admin / admin")
    print("  expert_graph / expert_graph")
    print("  ostroukhova / ostroukhova")
    print("  petrov / petrov")
    print("  smirnov / student")
    print("  orlova / student")
    print("  egorov / student")
    print("  lebedeva / student")

    print("\nTrajectories:")
    for seeded_trajectory in trajectories:
        print(f"  {seeded_trajectory.trajectory.name} -> {seeded_trajectory.teacher.login}")


if __name__ == "__main__":
    if "COMPETENCE_HUB_DATABASE_URL" in os.environ:
        seed_database(
            recreate=env_flag("COMPETENCE_HUB_SEED_RECREATE", default=False),
            only_if_empty=env_flag("COMPETENCE_HUB_SEED_IF_EMPTY", default=False),
        )
    else:
        recreate_database()
