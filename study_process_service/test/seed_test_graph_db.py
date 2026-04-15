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
    KnowledgeElement,
    KnowledgeElementRelation,
    Topic,
    TopicDependency,
    TopicKnowledgeElement,
)
from app.models.enums import (
    CompetenceType,
    KnowledgeElementRelationType,
    TopicDependencyRelationType,
    TopicKnowledgeElementRole,
)


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
    discipline = Discipline(name="Graphs")
    session.add(discipline)
    session.flush()

    element_names = ["E1", "E2", "E3", "E4", "E5", "E6", "E7"]
    elements: dict[str, KnowledgeElement] = {}

    for name in element_names:
        element = KnowledgeElement(
            name=name,
            description=f"Seed knowledge element {name}",
            competence_type=CompetenceType.KNOW,
        )
        session.add(element)
        elements[name] = element

    session.flush()

    topics_spec = [
        {
            "name": "T1",
            "description": "Entry topic. Produces E1 and E2.",
            "required": [],
            "formed": ["E1", "E2"],
        },
        {
            "name": "T2",
            "description": "Requires E1 and E2. Produces E3 and E4.",
            "required": ["E1", "E2"],
            "formed": ["E3", "E4"],
        },
        {
            "name": "T3",
            "description": "Requires E1. Produces E5.",
            "required": ["E1"],
            "formed": ["E5"],
        },
        {
            "name": "T4",
            "description": "Requires E1, E2 and E3. Produces E6.",
            "required": ["E1", "E2", "E3"],
            "formed": ["E6"],
        },
        {
            "name": "T5",
            "description": "Requires E3 and E5. Produces E7.",
            "required": ["E3", "E5"],
            "formed": ["E7"],
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
                    note=f"{element_name} is required before starting topic {topic.name}",
                )
            )

        for element_name in spec["formed"]:
            session.add(
                TopicKnowledgeElement(
                    topic_id=topic.id,
                    element_id=elements[element_name].id,
                    role=TopicKnowledgeElementRole.FORMED,
                    note=f"{element_name} is formed while studying topic {topic.name}",
                )
            )

    session.flush()

    seed_knowledge_element_relations(session, elements)
    build_topic_dependencies(session)
    print_seed_summary(session)


def seed_knowledge_element_relations(
    session: Session,
    elements: dict[str, KnowledgeElement],
) -> None:
    relations_spec = [
        (
            "E1",
            "E2",
            KnowledgeElementRelationType.BUILDS_ON,
            "E2 builds on understanding of E1.",
        ),
        (
            "E2",
            "E3",
            KnowledgeElementRelationType.REQUIRES,
            "E3 requires prior understanding of E2.",
        ),
        (
            "E3",
            "E4",
            KnowledgeElementRelationType.CONTAINS,
            "E3 contains E4 as a component.",
        ),
        (
            "E4",
            "E3",
            KnowledgeElementRelationType.PART_OF,
            "E4 is part of E3.",
        ),
        (
            "E5",
            "E3",
            KnowledgeElementRelationType.REFINES,
            "E5 refines the broader idea represented by E3.",
        ),
        (
            "E3",
            "E6",
            KnowledgeElementRelationType.GENERALIZES,
            "E3 generalizes the more specific case represented by E6.",
        ),
        (
            "E6",
            "E7",
            KnowledgeElementRelationType.SIMILAR,
            "E6 and E7 are conceptually similar.",
        ),
        (
            "E2",
            "E5",
            KnowledgeElementRelationType.CONTRASTS_WITH,
            "E2 contrasts with E5 and should be distinguished.",
        ),
        (
            "E1",
            "E5",
            KnowledgeElementRelationType.USED_WITH,
            "E1 is often used together with E5.",
        ),
        (
            "E7",
            "E2",
            KnowledgeElementRelationType.PROPERTY_OF,
            "E7 can be treated as a property of E2.",
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

    required_map: dict[UUID, set[str]] = {}
    formed_map: dict[UUID, set[str]] = {}

    for topic in topics:
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
            if not covered:
                continue

            dependencies_to_add.append(
                TopicDependency(
                    prerequisite_topic_id=source.id,
                    dependent_topic_id=target.id,
                    relation_type=TopicDependencyRelationType.REQUIRES,
                    description=(
                        f"{source.name} -> {target.name}: covers required elements "
                        f"{', '.join(sorted(covered))}"
                    ),
                )
            )

    session.add_all(dependencies_to_add)
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
