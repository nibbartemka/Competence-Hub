from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Enum, ForeignKey, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base
from .enums import (
    CompetenceType,
    KnowledgeElementRelationType,
    TopicKnowledgeElementRole,
    TopicDependencyRelationType,
)


class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = (
        UniqueConstraint("discipline_id", "name", name="uq_topic_name_discipline"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    discipline_id: Mapped[UUID] = mapped_column(
        ForeignKey("disciplines.id", ondelete="CASCADE"),
        nullable=False,
    )

    discipline: Mapped["Discipline"] = relationship(
        "Discipline",
        back_populates="topics",
        lazy="selectin",
    )

    prerequisite_links: Mapped[list["TopicDependency"]] = relationship(
        "TopicDependency",
        foreign_keys="TopicDependency.prerequisite_topic_id",
        back_populates="prerequisite_topic",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    dependent_links: Mapped[list["TopicDependency"]] = relationship(
        "TopicDependency",
        foreign_keys="TopicDependency.dependent_topic_id",
        back_populates="dependent_topic",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    element_links: Mapped[list["TopicKnowledgeElement"]] = relationship(
        "TopicKnowledgeElement",
        back_populates="topic",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class TopicDependency(Base):
    __tablename__ = "topic_dependencies"
    __table_args__ = (
        UniqueConstraint(
            "prerequisite_topic_id",
            "dependent_topic_id",
            name="uq_topic_dependency",
        ),
        CheckConstraint(
            "prerequisite_topic_id != dependent_topic_id",
            name="ck_topic_dependency_not_self",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    relation_type: Mapped[TopicDependencyRelationType] = mapped_column(
        Enum(TopicDependencyRelationType, name="relation_type_enum"),
        nullable=False,
    )

    prerequisite_topic_id: Mapped[UUID] = mapped_column(
        ForeignKey("topics.id", ondelete="CASCADE"),
        nullable=False,
    )
    dependent_topic_id: Mapped[UUID] = mapped_column(
        ForeignKey("topics.id", ondelete="CASCADE"),
        nullable=False,
    )

    prerequisite_topic: Mapped["Topic"] = relationship(
        "Topic",
        foreign_keys=[prerequisite_topic_id],
        back_populates="prerequisite_links",
        lazy="selectin",
    )

    dependent_topic: Mapped["Topic"] = relationship(
        "Topic",
        foreign_keys=[dependent_topic_id],
        back_populates="dependent_links",
        lazy="selectin",
    )


class KnowledgeElement(Base):
    __tablename__ = "knowledge_elements"
    __table_args__ = (
        UniqueConstraint(
            "name",
            "competence_type",
            name="uq_knowledge_element_name_competence",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    competence_type: Mapped[CompetenceType] = mapped_column(
        Enum(CompetenceType, name="competence_type_enum"),
        nullable=False,
    )

    topic_links: Mapped[list["TopicKnowledgeElement"]] = relationship(
        "TopicKnowledgeElement",
        back_populates="element",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    outgoing_relations: Mapped[list["KnowledgeElementRelation"]] = relationship(
        "KnowledgeElementRelation",
        foreign_keys="KnowledgeElementRelation.source_element_id",
        back_populates="source_element",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    incoming_relations: Mapped[list["KnowledgeElementRelation"]] = relationship(
        "KnowledgeElementRelation",
        foreign_keys="KnowledgeElementRelation.target_element_id",
        back_populates="target_element",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class TopicKnowledgeElement(Base):
    __tablename__ = "topic_knowledge_elements"
    __table_args__ = (
        UniqueConstraint("topic_id", "element_id", name="uq_topic_knowledge_element"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    note: Mapped[str | None] = mapped_column(Text, nullable=True)
    role: Mapped[TopicKnowledgeElementRole] = mapped_column(
        Enum(
            TopicKnowledgeElementRole,
            name="topic_knowledge_element_role_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        default=TopicKnowledgeElementRole.FORMED,
    )

    topic_id: Mapped[UUID] = mapped_column(
        ForeignKey("topics.id", ondelete="CASCADE"),
        nullable=False,
    )
    element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )

    topic: Mapped["Topic"] = relationship(
        "Topic",
        back_populates="element_links",
        lazy="selectin",
    )

    element: Mapped["KnowledgeElement"] = relationship(
        "KnowledgeElement",
        back_populates="topic_links",
        lazy="selectin",
    )


class KnowledgeElementRelation(Base):
    __tablename__ = "knowledge_element_relations"
    __table_args__ = (
        UniqueConstraint(
            "source_element_id",
            "target_element_id",
            "relation_type",
            name="uq_knowledge_element_relation",
        ),
        CheckConstraint(
            "source_element_id != target_element_id",
            name="ck_knowledge_element_relation_not_self",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)

    source_element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )
    target_element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )

    relation_type: Mapped[KnowledgeElementRelationType] = mapped_column(
        Enum(
            KnowledgeElementRelationType,
            name="knowledge_element_relation_type_enum",
        ),
        nullable=False,
    )

    source_element: Mapped["KnowledgeElement"] = relationship(
        "KnowledgeElement",
        foreign_keys=[source_element_id],
        back_populates="outgoing_relations",
        lazy="selectin",
    )

    target_element: Mapped["KnowledgeElement"] = relationship(
        "KnowledgeElement",
        foreign_keys=[target_element_id],
        back_populates="incoming_relations",
        lazy="selectin",
    )
