from __future__ import annotations

from pathlib import Path
import sys

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

# Allow running the script directly from the test folder.
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core import Base
from app.models import (
    Discipline,
    KnowledgeElement,
    KnowledgeElementRelation,
    Topic,
    TopicDependency,
    TopicKnowledgeElement,
    Group,
    GroupDiscipline,
    Teacher,
    Subgroup,
    Student,
    TeacherGroup,
    TeacherDiscipline,
    TeacherSubgroup,
    StudentDiscipline,
)
from app.models.enums import (
    CompetenceType,
    KnowledgeElementRelationType,
    TopicDependencyRelationType,
    TopicKnowledgeElementRole,
)
from app.services.topic_dependencies import calculate_topic_dependency_pairs


DB_PATH = ROOT_DIR / "app.db"
DATABASE_URL = f"sqlite:///{DB_PATH.as_posix()}"


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
    KNOW = CompetenceType.KNOW
    CAN = CompetenceType.CAN
    MASTER = CompetenceType.MASTER

    discipline = Discipline(name="Теория графов (Кристофидес)")
    session.add(discipline)
    session.flush()

    element_specs = [
        # ===== ГЛАВА 1. ВВЕДЕНИЕ =====
        (
            "Понятие графа",
            "Знание определения графа, вершин, ребер и базовых обозначений.",
            KNOW,
        ),
        (
            "Пути и маршруты",
            "Знание понятий путь, маршрут, простая цепь, длина пути.",
            KNOW,
        ),
        (
            "Циклы и петли",
            "Знание понятий цикл, ориентированный цикл, замкнутый путь, петля.",
            KNOW,
        ),
        (
            "Определять тип графа",
            "Умение различать ориентированный, неориентированный, полный, двудольный, планарный граф.",
            CAN,
        ),
        (
            "Представлять граф матрицей",
            "Умение строить матрицу смежности и матрицу инцидентности.",
            CAN,
        ),
        (
            "Свободно оперировать базовыми представлениями графа",
            "Владение переходом между рисунком графа, множественным и матричным представлением.",
            MASTER,
        ),

        # ===== ГЛАВА 2. ДОСТИЖИМОСТЬ И СВЯЗНОСТЬ =====
        (
            "Достижимость",
            "Знание понятия достижимости и контрадостижимости в ориентированном графе.",
            KNOW,
        ),
        (
            "Сильная компонента",
            "Знание понятия сильной компоненты и связности графа.",
            KNOW,
        ),
        (
            "Матрица достижимости",
            "Умение строить и использовать матрицу достижимости.",
            CAN,
        ),
        (
            "Находить сильные компоненты",
            "Умение выделять сильные компоненты графа.",
            CAN,
        ),
        (
            "Анализировать структуру связности графа",
            "Владение анализом баз, сильных компонент и ограниченной достижимости.",
            MASTER,
        ),

        # ===== ГЛАВА 3. НЕЗАВИСИМЫЕ / ДОМИНИРУЮЩИЕ МНОЖЕСТВА / ПОКРЫТИЕ =====
        (
            "Независимое множество",
            "Знание понятия независимого множества вершин.",
            KNOW,
        ),
        (
            "Доминирующее множество",
            "Знание понятия доминирующего множества.",
            KNOW,
        ),
        (
            "Покрытие в графе",
            "Знание задачи о покрытии и ее интерпретаций.",
            KNOW,
        ),
        (
            "Находить покрытия и независимые множества",
            "Умение формулировать и решать задачи на независимые, доминирующие множества и покрытия.",
            CAN,
        ),
        (
            "Моделировать прикладные задачи как покрытие",
            "Владение сведением прикладных задач к задачам покрытия.",
            MASTER,
        ),

        # ===== ГЛАВА 4. РАСКРАСКИ =====
        (
            "Хроматическое число",
            "Знание понятия хроматического числа и основных оценок.",
            KNOW,
        ),
        (
            "Раскраска графа",
            "Знание постановки задачи раскраски графа.",
            KNOW,
        ),
        (
            "Выполнять точную раскраску",
            "Умение применять точные алгоритмы раскраски.",
            CAN,
        ),
        (
            "Выполнять приближенную раскраску",
            "Умение применять приближенные алгоритмы раскраски.",
            CAN,
        ),
        (
            "Выбирать метод раскраски под задачу",
            "Владение выбором стратегии раскраски в зависимости от ограничений задачи.",
            MASTER,
        ),

        # ===== ГЛАВА 5. РАЗМЕЩЕНИЕ ЦЕНТРОВ =====
        (
            "Центр и радиус графа",
            "Знание понятий центр, радиус, абсолютный центр графа.",
            KNOW,
        ),
        (
            "p-центр",
            "Знание понятия кратного центра и абсолютного p-центра.",
            KNOW,
        ),
        (
            "Находить центр графа",
            "Умение находить центр, абсолютный центр и p-центр графа.",
            CAN,
        ),
        (
            "Решать задачи размещения центров",
            "Владение моделированием задач размещения сервисов и пунктов обслуживания через центры графа.",
            MASTER,
        ),

        # ===== ГЛАВА 6. РАЗМЕЩЕНИЕ МЕДИАН =====
        (
            "Медиана графа",
            "Знание понятия медианы и p-медианы графа.",
            KNOW,
        ),
        (
            "Обобщенная p-медиана",
            "Знание постановки задачи обобщенной p-медианы.",
            KNOW,
        ),
        (
            "Находить медиану графа",
            "Умение решать задачу о медиане и p-медиане.",
            CAN,
        ),
        (
            "Решать задачи размещения медиан",
            "Владение выбором медианных моделей для задач минимизации суммарных затрат.",
            MASTER,
        ),

        # ===== ГЛАВА 7. ДЕРЕВЬЯ =====
        (
            "Дерево и остов",
            "Знание понятий дерево, остовное дерево, остовный подграф.",
            KNOW,
        ),
        (
            "Кратчайший остов",
            "Знание постановки задачи о кратчайшем остове.",
            KNOW,
        ),
        (
            "Строить остовные деревья",
            "Умение строить остовные деревья и кратчайший остов.",
            CAN,
        ),
        (
            "Задача Штейнера",
            "Знание и понимание задачи Штейнера на графах.",
            KNOW,
        ),
        (
            "Применять остовные конструкции",
            "Владение использованием остовов и деревьев Штейнера в проектировании сетей.",
            MASTER,
        ),

        # ===== ГЛАВА 8. КРАТЧАЙШИЕ ПУТИ =====
        (
            "Кратчайший путь",
            "Знание постановки задачи о кратчайшем пути.",
            KNOW,
        ),
        (
            "Кратчайшие пути между всеми парами",
            "Знание постановки задачи кратчайших путей между всеми парами вершин.",
            KNOW,
        ),
        (
            "Находить кратчайшие пути",
            "Умение решать задачу кратчайшего пути между двумя вершинами и между всеми парами.",
            CAN,
        ),
        (
            "Обнаруживать отрицательные циклы",
            "Умение обнаруживать циклы отрицательного веса.",
            CAN,
        ),
        (
            "Применять модели кратчайших путей",
            "Владение использованием моделей кратчайших путей в маршрутизации и сетевом планировании.",
            MASTER,
        ),

        # ===== ГЛАВА 9. ЦИКЛЫ, РАЗРЕЗЫ И ЭЙЛЕР =====
        (
            "Цикломатическое число",
            "Знание цикломатического числа и фундаментальных циклов.",
            KNOW,
        ),
        (
            "Разрез графа",
            "Знание понятия разреза и матриц циклов и разрезов.",
            KNOW,
        ),
        (
            "Эйлеров цикл",
            "Знание условий существования эйлерова цикла.",
            KNOW,
        ),
        (
            "Находить эйлеровы циклы",
            "Умение строить эйлеровы циклы и решать задачу китайского почтальона.",
            CAN,
        ),
        (
            "Анализировать циклическую структуру графа",
            "Владение использованием циклов и разрезов для анализа структуры сети.",
            MASTER,
        ),

        # ===== ГЛАВА 10. ГАМИЛЬТОН / КОММИВОЯЖЕР =====
        (
            "Гамильтонов цикл",
            "Знание понятия гамильтонова цикла и цепи.",
            KNOW,
        ),
        (
            "Задача коммивояжера",
            "Знание постановки задачи коммивояжера.",
            KNOW,
        ),
        (
            "Искать гамильтоновы циклы",
            "Умение применять методы поиска гамильтоновых циклов.",
            CAN,
        ),
        (
            "Связывать TSP с остовом и назначениями",
            "Умение использовать связи задачи коммивояжера с задачей остова и назначений.",
            CAN,
        ),
        (
            "Проектировать маршруты обхода",
            "Владение выбором моделей обхода и транспортных маршрутов.",
            MASTER,
        ),

        # ===== ГЛАВА 11. ПОТОКИ В СЕТЯХ =====
        (
            "Поток в сети",
            "Знание понятий поток, источник, сток, пропускная способность.",
            KNOW,
        ),
        (
            "Максимальный поток",
            "Знание постановки задачи о максимальном потоке.",
            KNOW,
        ),
        (
            "Находить максимальный поток",
            "Умение решать задачу о максимальном потоке.",
            CAN,
        ),
        (
            "Поток минимальной стоимости",
            "Знание и понимание задачи о потоке минимальной стоимости.",
            KNOW,
        ),
        (
            "Моделировать сетевые потоки",
            "Владение моделями потоков для транспортных и производственных сетей.",
            MASTER,
        ),

        # ===== ГЛАВА 12. ПАРОСОЧЕТАНИЯ / НАЗНАЧЕНИЯ =====
        (
            "Паросочетание",
            "Знание понятия паросочетания и его видов.",
            KNOW,
        ),
        (
            "Задача о назначениях",
            "Знание постановки задачи о назначениях.",
            KNOW,
        ),
        (
            "Находить максимальное паросочетание",
            "Умение находить наибольшие и максимальные паросочетания.",
            CAN,
        ),
        (
            "Решать задачу о назначениях",
            "Умение решать задачу о назначениях и связанные транспортные задачи.",
            CAN,
        ),
        (
            "Использовать модели соответствия и назначения",
            "Владение сведением прикладных задач к паросочетаниям, назначениям и покрытиям.",
            MASTER,
        ),
    ]

    elements: dict[str, KnowledgeElement] = {}

    for name, description, competence_type in element_specs:
        element = KnowledgeElement(
            name=name,
            description=description,
            competence_type=competence_type,
            discipline_id=discipline.id,
        )
        session.add(element)
        elements[name] = element

    session.flush()

    topics_spec = [
        {
            "name": "Глава 1. Введение",
            "description": "Базовые понятия графов: определения, пути, циклы, степени, подграфы, типы графов, матричные представления.",
            "required": [],
            "formed": [
                "Понятие графа",
                "Пути и маршруты",
                "Циклы и петли",
                "Определять тип графа",
                "Представлять граф матрицей",
                "Свободно оперировать базовыми представлениями графа",
            ],
        },
        {
            "name": "Глава 2. Достижимость и связность",
            "description": "Достижимость, сильные компоненты, базы, ограниченная достижимость.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Циклы и петли",
                "Представлять граф матрицей",
            ],
            "formed": [
                "Достижимость",
                "Сильная компонента",
                "Матрица достижимости",
                "Находить сильные компоненты",
                "Анализировать структуру связности графа",
            ],
        },
        {
            "name": "Глава 3. Независимые и доминирующие множества. Покрытие",
            "description": "Независимые множества, доминирующие множества, задача о покрытии.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Определять тип графа",
            ],
            "formed": [
                "Независимое множество",
                "Доминирующее множество",
                "Покрытие в графе",
                "Находить покрытия и независимые множества",
                "Моделировать прикладные задачи как покрытие",
            ],
        },
        {
            "name": "Глава 4. Раскраски",
            "description": "Хроматическое число, точные и приближенные алгоритмы раскраски.",
            "required": [
                "Понятие графа",
                "Определять тип графа",
                "Независимое множество",
            ],
            "formed": [
                "Хроматическое число",
                "Раскраска графа",
                "Выполнять точную раскраску",
                "Выполнять приближенную раскраску",
                "Выбирать метод раскраски под задачу",
            ],
        },
        {
            "name": "Глава 5. Размещение центров",
            "description": "Центр, радиус, абсолютный центр, p-центры.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
            ],
            "formed": [
                "Центр и радиус графа",
                "p-центр",
                "Находить центр графа",
                "Решать задачи размещения центров",
            ],
        },
        {
            "name": "Глава 6. Размещение медиан в графе",
            "description": "Медианы и p-медианы графа.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Центр и радиус графа",
            ],
            "formed": [
                "Медиана графа",
                "Обобщенная p-медиана",
                "Находить медиану графа",
                "Решать задачи размещения медиан",
            ],
        },
        {
            "name": "Глава 7. Деревья",
            "description": "Остовные деревья, кратчайший остов, задача Штейнера.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Циклы и петли",
            ],
            "formed": [
                "Дерево и остов",
                "Кратчайший остов",
                "Строить остовные деревья",
                "Задача Штейнера",
                "Применять остовные конструкции",
            ],
        },
        {
            "name": "Глава 8. Кратчайшие пути",
            "description": "Кратчайшие пути между двумя вершинами и всеми парами, отрицательные циклы.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Представлять граф матрицей",
                "Дерево и остов",
            ],
            "formed": [
                "Кратчайший путь",
                "Кратчайшие пути между всеми парами",
                "Находить кратчайшие пути",
                "Обнаруживать отрицательные циклы",
                "Применять модели кратчайших путей",
            ],
        },
        {
            "name": "Глава 9. Циклы, разрезы и задача Эйлера",
            "description": "Цикломатическое число, разрезы, матрицы циклов и разрезов, эйлеровы циклы.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Циклы и петли",
                "Дерево и остов",
            ],
            "formed": [
                "Цикломатическое число",
                "Разрез графа",
                "Эйлеров цикл",
                "Находить эйлеровы циклы",
                "Анализировать циклическую структуру графа",
            ],
        },
        {
            "name": "Глава 10. Гамильтоновы циклы, цепи и задача коммивояжера",
            "description": "Гамильтоновы циклы, задача коммивояжера, связи с остовом и назначениями.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Циклы и петли",
                "Кратчайший остов",
            ],
            "formed": [
                "Гамильтонов цикл",
                "Задача коммивояжера",
                "Искать гамильтоновы циклы",
                "Связывать TSP с остовом и назначениями",
                "Проектировать маршруты обхода",
            ],
        },
        {
            "name": "Глава 11. Потоки в сетях",
            "description": "Максимальный поток, поток минимальной стоимости, потоки в графах с выигрышами.",
            "required": [
                "Понятие графа",
                "Пути и маршруты",
                "Разрез графа",
                "Представлять граф матрицей",
            ],
            "formed": [
                "Поток в сети",
                "Максимальный поток",
                "Находить максимальный поток",
                "Поток минимальной стоимости",
                "Моделировать сетевые потоки",
            ],
        },
        {
            "name": "Глава 12. Паросочетания, транспортная задача и задача о назначениях",
            "description": "Паросочетания, задача о назначениях, покрытия, остовные подграфы с предписанными степенями.",
            "required": [
                "Понятие графа",
                "Покрытие в графе",
                "Поток в сети",
                "Максимальный поток",
            ],
            "formed": [
                "Паросочетание",
                "Задача о назначениях",
                "Находить максимальное паросочетание",
                "Решать задачу о назначениях",
                "Использовать модели соответствия и назначения",
            ],
        },
    ]

    topics: dict[str, Topic] = {}

    for spec in topics_spec:
        topic = Topic(
            name=spec["name"],
            description=spec["description"],
            discipline_id=discipline.id,
        )
        session.add(topic)
        topics[spec["name"]] = topic

    session.flush()

    for spec in topics_spec:
        topic = topics[spec["name"]]

        for element_name in spec["required"]:
            session.add(
                TopicKnowledgeElement(
                    topic_id=topic.id,
                    element_id=elements[element_name].id,
                    role=TopicKnowledgeElementRole.REQUIRED,
                    note=f"'{element_name}' is required before starting topic '{topic.name}'",
                )
            )

        for element_name in spec["formed"]:
            session.add(
                TopicKnowledgeElement(
                    topic_id=topic.id,
                    element_id=elements[element_name].id,
                    role=TopicKnowledgeElementRole.FORMED,
                    note=f"'{element_name}' is formed while studying topic '{topic.name}'",
                )
            )

    session.flush()

    seed_knowledge_element_relations(session, elements)
    build_topic_dependencies(session)
    build_people_and_group_data(session, discipline)
    print_seed_summary(session)


def seed_knowledge_element_relations(
    session: Session,
    elements: dict[str, KnowledgeElement],
) -> None:
    relations_spec = [
        (
            "Пути и маршруты",
            "Понятие графа",
            KnowledgeElementRelationType.REQUIRES,
            "The concept of a path is defined only after mastering the concept of a graph.",
        ),
        (
            "Циклы и петли",
            "Пути и маршруты",
            KnowledgeElementRelationType.BUILDS_ON,
            "The concept of a cycle is built on the concept of a path and route.",
        ),
        (
            "Определять тип графа",
            "Понятие графа",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Knowledge of the graph concept is expressed in the ability to classify graphs.",
        ),
        (
            "Представлять граф матрицей",
            "Понятие графа",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Basic graph knowledge is expressed in matrix representation.",
        ),
        (
            "Матрица достижимости",
            "Достижимость",
            KnowledgeElementRelationType.IMPLEMENTS,
            "The reachability concept is implemented in constructing the reachability matrix.",
        ),
        (
            "Сильная компонента",
            "Достижимость",
            KnowledgeElementRelationType.REQUIRES,
            "The concept of a strongly connected component requires understanding reachability.",
        ),
        (
            "Находить сильные компоненты",
            "Сильная компонента",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Understanding strong connectivity is expressed in the ability to find components.",
        ),
        (
            "Покрытие в графе",
            "Независимое множество",
            KnowledgeElementRelationType.CONTRASTS_WITH,
            "Covering and independent sets must be distinguished.",
        ),
        (
            "Доминирующее множество",
            "Покрытие в графе",
            KnowledgeElementRelationType.SIMILAR,
            "Dominating sets are conceptually related to covering problems.",
        ),
        (
            "Раскраска графа",
            "Независимое множество",
            KnowledgeElementRelationType.BUILDS_ON,
            "Graph coloring is closely related to partitioning into independent sets.",
        ),
        (
            "Хроматическое число",
            "Раскраска графа",
            KnowledgeElementRelationType.PROPERTY_OF,
            "The chromatic number is a property of graph coloring.",
        ),
        (
            "Выполнять точную раскраску",
            "Раскраска графа",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Knowledge of graph coloring is expressed in the ability to perform exact coloring.",
        ),
        (
            "Выполнять приближенную раскраску",
            "Выполнять точную раскраску",
            KnowledgeElementRelationType.CONTRASTS_WITH,
            "Approximate and exact coloring are different solution strategies.",
        ),
        (
            "p-центр",
            "Центр и радиус графа",
            KnowledgeElementRelationType.REFINES,
            "The p-center refines the broader center concept.",
        ),
        (
            "Медиана графа",
            "Центр и радиус графа",
            KnowledgeElementRelationType.CONTRASTS_WITH,
            "Center-based and median-based models solve different optimization problems.",
        ),
        (
            "Дерево и остов",
            "Циклы и петли",
            KnowledgeElementRelationType.CONTRASTS_WITH,
            "A tree is characterized by the absence of cycles.",
        ),
        (
            "Кратчайший остов",
            "Дерево и остов",
            KnowledgeElementRelationType.REFINES,
            "A minimum spanning tree refines the spanning tree concept.",
        ),
        (
            "Строить остовные деревья",
            "Кратчайший остов",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Understanding spanning trees is expressed in the ability to construct them.",
        ),
        (
            "Кратчайший путь",
            "Пути и маршруты",
            KnowledgeElementRelationType.REFINES,
            "The shortest path is a refinement of the general path concept.",
        ),
        (
            "Находить кратчайшие пути",
            "Кратчайший путь",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Knowledge of shortest paths is expressed in algorithmic solving ability.",
        ),
        (
            "Обнаруживать отрицательные циклы",
            "Кратчайший путь",
            KnowledgeElementRelationType.USED_WITH,
            "Negative cycle detection is used together with shortest path problems.",
        ),
        (
            "Эйлеров цикл",
            "Циклы и петли",
            KnowledgeElementRelationType.REFINES,
            "An Eulerian cycle refines the general cycle concept.",
        ),
        (
            "Гамильтонов цикл",
            "Циклы и петли",
            KnowledgeElementRelationType.REFINES,
            "A Hamiltonian cycle refines the general cycle concept.",
        ),
        (
            "Гамильтонов цикл",
            "Эйлеров цикл",
            KnowledgeElementRelationType.CONTRASTS_WITH,
            "Hamiltonian and Eulerian cycles must be distinguished.",
        ),
        (
            "Задача коммивояжера",
            "Гамильтонов цикл",
            KnowledgeElementRelationType.BUILDS_ON,
            "The traveling salesman problem is built on the idea of a Hamiltonian tour.",
        ),
        (
            "Связывать TSP с остовом и назначениями",
            "Задача коммивояжера",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Knowledge of TSP is expressed in the ability to relate it to spanning tree and assignment models.",
        ),
        (
            "Максимальный поток",
            "Поток в сети",
            KnowledgeElementRelationType.REFINES,
            "Maximum flow refines the general flow model.",
        ),
        (
            "Поток минимальной стоимости",
            "Поток в сети",
            KnowledgeElementRelationType.REFINES,
            "Minimum-cost flow refines the general flow model.",
        ),
        (
            "Находить максимальный поток",
            "Максимальный поток",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Understanding maximum flow is expressed in the ability to solve it algorithmically.",
        ),
        (
            "Паросочетание",
            "Покрытие в графе",
            KnowledgeElementRelationType.USED_WITH,
            "Matchings are tightly related to covering problems.",
        ),
        (
            "Находить максимальное паросочетание",
            "Паросочетание",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Matching knowledge is expressed in the ability to find maximum matchings.",
        ),
        (
            "Задача о назначениях",
            "Паросочетание",
            KnowledgeElementRelationType.BUILDS_ON,
            "The assignment problem is built on the matching model.",
        ),
        (
            "Решать задачу о назначениях",
            "Задача о назначениях",
            KnowledgeElementRelationType.IMPLEMENTS,
            "Knowledge of the assignment problem is expressed in the ability to solve it.",
        ),
        (
            "Использовать модели соответствия и назначения",
            "Решать задачу о назначениях",
            KnowledgeElementRelationType.AUTOMATES,
            "A stable skill of solving assignment problems turns into mastery of applied modeling.",
        ),
    ]

    session.add_all(
        [
            KnowledgeElementRelation(
                source_element_id=elements[source_name].id,
                target_element_id=elements[target_name].id,
                relation_type=relation_type,
                description=description,
            )
            for source_name, target_name, relation_type, description in relations_spec
        ]
    )
    session.flush()


def build_topic_dependencies(session: Session) -> None:
    topics = session.scalars(select(Topic)).all()
    topic_links = session.scalars(select(TopicKnowledgeElement)).all()
    topic_by_id = {topic.id: topic for topic in topics}
    dependency_pairs = calculate_topic_dependency_pairs(topics, topic_links)

    dependencies_to_add = [
        TopicDependency(
            prerequisite_topic_id=prerequisite_topic_id,
            dependent_topic_id=dependent_topic_id,
            relation_type=TopicDependencyRelationType.REQUIRES,
            description=(
                f"Auto-built from formed elements of "
                f"'{topic_by_id[prerequisite_topic_id].name}' and required elements of "
                f"'{topic_by_id[dependent_topic_id].name}'"
            ),
        )
        for prerequisite_topic_id, dependent_topic_id in sorted(
            dependency_pairs,
            key=lambda pair: (
                topic_by_id[pair[0]].name,
                topic_by_id[pair[1]].name,
            ),
        )
    ]

    session.add_all(dependencies_to_add)
    session.flush()


def build_people_and_group_data(session: Session, discipline: Discipline) -> None:
    group = Group(name="Б9124-09.03.04прогин")
    session.add(group)
    session.flush()

    subgroup = Subgroup(group_id=group.id, subgroup_num=1)
    session.add(subgroup)
    session.flush()

    teacher = Teacher(name="Крестникова О.А.")
    session.add(teacher)
    session.flush()

    students = [
        Student(
            name="Гаффоров Тимур",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Исихара Никита",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
        Student(
            name="Голомидов Никита",
            group_id=group.id,
            subgroup_id=subgroup.id,
        ),
    ]
    session.add_all(students)
    session.flush()

    session.add(GroupDiscipline(group_id=group.id, discipline_id=discipline.id))
    session.add(TeacherDiscipline(teacher_id=teacher.id, discipline_id=discipline.id))
    session.add(TeacherGroup(teacher_id=teacher.id, group_id=group.id))
    session.add(TeacherSubgroup(teacher_id=teacher.id, subgroup_id=subgroup.id))
    
    session.add_all(
        [
            StudentDiscipline(student_id=student.id, discipline_id=discipline.id)
            for student in students
        ]
    )

    session.flush()


def print_seed_summary(session: Session) -> None:
    print("\n=== Topics and elements ===")
    topics = session.scalars(select(Topic)).all()

    for topic in topics:
        required: list[str] = []
        formed: list[str] = []

        for link in topic.element_links:
            if link.role == TopicKnowledgeElementRole.REQUIRED:
                required.append(link.element.name)
            elif link.role == TopicKnowledgeElementRole.FORMED:
                formed.append(link.element.name)

        print(topic.name)
        print(f"  required: {sorted(required)}")
        print(f"  formed:   {sorted(formed)}")

    print("\n=== Topic dependencies ===")
    dependencies = session.scalars(select(TopicDependency)).all()
    for dependency in dependencies:
        print(
            f"{dependency.prerequisite_topic.name} -> {dependency.dependent_topic.name} "
            f"[{dependency.relation_type.value}] | {dependency.description}"
        )

    print("\n=== Knowledge element relations ===")
    relations = session.scalars(select(KnowledgeElementRelation)).all()
    for relation in relations:
        print(
            f"{relation.source_element.name} -> {relation.target_element.name} "
            f"[{relation.relation_type.value}] | {relation.description}"
        )


if __name__ == "__main__":
    recreate_database()
