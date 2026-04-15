from __future__ import annotations

from pathlib import Path
import sys
from uuid import UUID

from sqlalchemy import create_engine, select
from sqlalchemy.orm import Session, sessionmaker

# Allow running the script directly from the test folder.
ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.core import Base
from app.models import (
    Discipline,
    Topic,
    TopicDependency,
    KnowledgeElement,
    TopicKnowledgeElement,
)
from app.models.enums import (
    CompetenceType,
    TopicKnowledgeElementRole,
    TopicDependencyRelationType,
)


DB_PATH = Path("../app.db")
DATABASE_URL = f"sqlite:///{DB_PATH}"


def recreate_database() -> None:
    if DB_PATH.exists():
        DB_PATH.unlink()

    engine = create_engine(DATABASE_URL, echo=False, future=True)
    Base.metadata.create_all(engine)

    SessionLocal = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

    with SessionLocal() as session:
        seed_data(session)
        session.commit()

    print(f"База создана: {DB_PATH.resolve()}")


def seed_data(session: Session) -> None:
    # 1. Дисциплина
    discipline = Discipline(name="Графы")
    session.add(discipline)
    session.flush()

    # 2. Элементы знаний
    # Для простоты все элементы делаем competence_type=KNOW.
    # При желании потом можно часть перевести в CAN / MASTER.
    element_names = ["Э1", "Э2", "Э3", "Э4", "Э5", "Э6", "Э7"]
    elements: dict[str, KnowledgeElement] = {}

    for name in element_names:
        element = KnowledgeElement(
            name=name,
            description=f"Тестовый элемент знаний {name}",
            competence_type=CompetenceType.KNOW,
        )
        session.add(element)
        elements[name] = element

    session.flush()

    # 3. Темы и их Req/New множества
    topics_spec = [
        {
            "name": "Т1",
            "description": "Стартовая тема. Формирует Э1 и Э2.",
            "required": [],
            "formed": ["Э1", "Э2"],
        },
        {
            "name": "Т2",
            "description": "Требует Э1 и Э2. Формирует Э3 и Э4.",
            "required": ["Э1", "Э2"],
            "formed": ["Э3", "Э4"],
        },
        {
            "name": "Т3",
            "description": "Требует Э1. Формирует Э5.",
            "required": ["Э1"],
            "formed": ["Э5"],
        },
        {
            "name": "Т4",
            "description": "Требует Э1, Э2, Э3. Формирует Э6.",
            "required": ["Э1", "Э2", "Э3"],
            "formed": ["Э6"],
        },
        {
            "name": "Т5",
            "description": "Требует Э3 и Э5. Формирует Э7.",
            "required": ["Э3", "Э5"],
            "formed": ["Э7"],
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

    # 4. Привязка элементов к темам
    # required -> role=REQUIRED
    # formed   -> role=FORMED
    for spec in topics_spec:
        topic = topics[spec["name"]]

        for element_name in spec["required"]:
            session.add(
                TopicKnowledgeElement(
                    topic_id=topic.id,
                    element_id=elements[element_name].id,
                    role=TopicKnowledgeElementRole.REQUIRED,
                    note=f"{element_name} необходим для начала изучения темы {topic.name}",
                )
            )

        for element_name in spec["formed"]:
            session.add(
                TopicKnowledgeElement(
                    topic_id=topic.id,
                    element_id=elements[element_name].id,
                    role=TopicKnowledgeElementRole.FORMED,
                    note=f"{element_name} формируется при изучении темы {topic.name}",
                )
            )

    session.flush()

    # 5. Автоматическое построение topic_dependencies
    build_topic_dependencies(session)

    # 6. Печать результата в консоль
    print_seed_summary(session)


def build_topic_dependencies(session: Session) -> None:
    topics = session.scalars(select(Topic)).all()

    # Собираем множества:
    # topic_id -> set(required element names)
    required_map: dict[UUID, set[str]] = {}
    formed_map: dict[UUID, set[str]] = {}
    topic_name_map: dict[UUID, str] = {}

    for topic in topics:
        topic_name_map[topic.id] = topic.name
        required_map[topic.id] = set()
        formed_map[topic.id] = set()

        for link in topic.element_links:
            element_name = link.element.name
            if link.role == TopicKnowledgeElementRole.REQUIRED:
                required_map[topic.id].add(element_name)
            elif link.role == TopicKnowledgeElementRole.FORMED:
                formed_map[topic.id].add(element_name)

    dependencies_to_add: list[TopicDependency] = []

    for source in topics:
        for target in topics:
            if source.id == target.id:
                continue

            covered = formed_map[source.id] & required_map[target.id]

            if covered:
                dep = TopicDependency(
                    prerequisite_topic_id=source.id,
                    dependent_topic_id=target.id,
                    relation_type=TopicDependencyRelationType.REQUIRES,
                    description=(
                        f"{source.name} -> {target.name}: "
                        f"покрывает требуемые элементы {', '.join(sorted(covered))}"
                    ),
                )
                dependencies_to_add.append(dep)

    session.add_all(dependencies_to_add)
    session.flush()


def print_seed_summary(session: Session) -> None:
    print("\n=== Темы и элементы ===")
    topics = session.scalars(select(Topic)).all()

    for topic in topics:
        required = []
        formed = []

        for link in topic.element_links:
            if link.role == TopicKnowledgeElementRole.REQUIRED:
                required.append(link.element.name)
            elif link.role == TopicKnowledgeElementRole.FORMED:
                formed.append(link.element.name)

        print(f"{topic.name}")
        print(f"  required: {sorted(required)}")
        print(f"  formed:   {sorted(formed)}")

    print("\n=== Зависимости тем ===")
    dependencies = session.scalars(select(TopicDependency)).all()
    for dep in dependencies:
        print(
            f"{dep.prerequisite_topic.name} -> {dep.dependent_topic.name} "
            f"[{dep.relation_type.value}] | {dep.description}"
        )


if __name__ == "__main__":
    recreate_database()
