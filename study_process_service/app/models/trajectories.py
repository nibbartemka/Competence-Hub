"""
Модели траекторий временно отключены.

Сейчас проект сфокусирован только на графе знаний:
- Discipline
- Topic
- TopicDependency
- KnowledgeElement
- TopicKnowledgeElement
- KnowledgeElementRelation

Когда вернемся к траекториям обучения и контроля, этот файл можно
раскомментировать или пересобрать заново под актуальную доменную модель.

Ниже сохранен исходный код таблиц и отношений, связанных с траекториями.
"""

# from uuid import UUID, uuid4
#
# from sqlalchemy import ForeignKey, String, Integer, Enum, Text, Boolean, UniqueConstraint, CheckConstraint
# from sqlalchemy.orm import Mapped, mapped_column, relationship
#
# from app.core import Base
# from .enums import CompetenceType, TopicElementRelationType
#
#
# class DisciplineTrajectory(Base):
#     __tablename__ = "discipline_trajectories"
#     __table_args__ = (
#         UniqueConstraint("discipline_id", "name", name="uq_discipline_trajectory_name"),
#     )
#
#     id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
#
#     discipline_id: Mapped[UUID] = mapped_column(
#         ForeignKey("disciplines.id", ondelete="CASCADE"),
#         nullable=False,
#     )
#
#     name: Mapped[str] = mapped_column(String(255), nullable=False)
#
#     discipline: Mapped["Discipline"] = relationship(
#         "Discipline",
#         back_populates="trajectory_links",
#         lazy="selectin",
#     )
#
#     topics: Mapped[list["DisciplineTrajectoryTopic"]] = relationship(
#         "DisciplineTrajectoryTopic",
#         back_populates="trajectory",
#         cascade="all, delete-orphan",
#         lazy="selectin",
#         order_by="DisciplineTrajectoryTopic.position",
#     )
#
#     group_links: Mapped[list["GroupDisciplineTrajectory"]] = relationship(
#         "GroupDisciplineTrajectory",
#         back_populates="trajectory",
#         cascade="all, delete-orphan",
#         lazy="selectin",
#     )
#
#
# class DisciplineTrajectoryTopic(Base):
#     __tablename__ = "discipline_trajectory_topics"
#     __table_args__ = (
#         UniqueConstraint("trajectory_id", "position", name="uq_trajectory_position"),
#         UniqueConstraint("trajectory_id", "topic_id", name="uq_trajectory_topic"),
#         CheckConstraint("position > 0", name="ck_trajectory_position_positive"),
#         CheckConstraint(
#             "threshold_rating >= 0 AND threshold_rating <= 100",
#             name="ck_threshold_rating_range",
#         ),
#     )
#
#     id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
#
#     trajectory_id: Mapped[UUID] = mapped_column(
#         ForeignKey("discipline_trajectories.id", ondelete="CASCADE"),
#         nullable=False,
#     )
#
#     topic_id: Mapped[UUID] = mapped_column(
#         ForeignKey("topics.id", ondelete="CASCADE"),
#         nullable=False,
#     )
#
#     position: Mapped[int] = mapped_column(Integer, nullable=False)
#
#     is_required: Mapped[bool] = mapped_column(Boolean, nullable=False)
#
#     threshold_rating: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
#
#     trajectory: Mapped["DisciplineTrajectory"] = relationship(
#         "DisciplineTrajectory",
#         back_populates="topics",
#         lazy="selectin",
#     )
#
#     topic: Mapped["Topic"] = relationship(
#         "Topic",
#         lazy="selectin",
#     )
#
#
# class TrajectoryTopicElement(Base):
#     __tablename__ = "trajectory_topic_elements"
#     __table_args__ = (
#         UniqueConstraint(
#             "trajectory_topic_id",
#             "name",
#             "competence_type",
#             name="uq_trajectory_topic_element_name_competence",
#         ),
#     )
#
#     id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
#
#     trajectory_topic_id: Mapped[UUID] = mapped_column(
#         ForeignKey("discipline_trajectory_topics.id", ondelete="CASCADE"),
#         nullable=False,
#     )
#
#     name: Mapped[str] = mapped_column(String(255), nullable=False)
#     description: Mapped[str | None] = mapped_column(Text, nullable=True)
#
#     competence_type: Mapped[CompetenceType] = mapped_column(
#         Enum(CompetenceType, name="competence_type_enum"),
#         nullable=False,
#     )
#
#     trajectory_topic: Mapped["DisciplineTrajectoryTopic"] = relationship(
#         "DisciplineTrajectoryTopic",
#         back_populates="elements",
#         lazy="selectin",
#     )
#
#     outgoing_relations: Mapped[list["TrajectoryTopicElementRelation"]] = relationship(
#         "TrajectoryTopicElementRelation",
#         foreign_keys="TrajectoryTopicElementRelation.source_element_id",
#         back_populates="source_element",
#         cascade="all, delete-orphan",
#         lazy="selectin",
#     )
#
#     incoming_relations: Mapped[list["TrajectoryTopicElementRelation"]] = relationship(
#         "TrajectoryTopicElementRelation",
#         foreign_keys="TrajectoryTopicElementRelation.target_element_id",
#         back_populates="target_element",
#         cascade="all, delete-orphan",
#         lazy="selectin",
#     )
#
#
# class TrajectoryTopicElementRelation(Base):
#     __tablename__ = "trajectory_topic_element_relations"
#     __table_args__ = (
#         UniqueConstraint(
#             "source_element_id",
#             "target_element_id",
#             "relation_type",
#             name="uq_topic_element_relation",
#         ),
#         CheckConstraint(
#             "source_element_id != target_element_id",
#             name="ck_topic_element_relation_not_self",
#         ),
#     )
#
#     id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
#
#     source_element_id: Mapped[UUID] = mapped_column(
#         ForeignKey("trajectory_topic_elements.id", ondelete="CASCADE"),
#         nullable=False,
#     )
#
#     target_element_id: Mapped[UUID] = mapped_column(
#         ForeignKey("trajectory_topic_elements.id", ondelete="CASCADE"),
#         nullable=False,
#     )
#
#     relation_type: Mapped[TopicElementRelationType] = mapped_column(
#         Enum(TopicElementRelationType, name="topic_element_relation_type_enum"),
#         nullable=False,
#     )
#
#     source_element: Mapped["TrajectoryTopicElement"] = relationship(
#         "TrajectoryTopicElement",
#         foreign_keys=[source_element_id],
#         back_populates="outgoing_relations",
#         lazy="selectin",
#     )
#
#     target_element: Mapped["TrajectoryTopicElement"] = relationship(
#         "TrajectoryTopicElement",
#         foreign_keys=[target_element_id],
#         back_populates="incoming_relations",
#         lazy="selectin",
#     )
