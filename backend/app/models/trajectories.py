from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, Enum, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base
from .enums import LearningTrajectoryStatus


class LearningTrajectory(Base):
    __tablename__ = "learning_trajectories"
    __table_args__ = (
        UniqueConstraint(
            "discipline_id",
            "teacher_id",
            "name",
            name="uq_learning_trajectory_discipline_teacher_name",
        ),
        CheckConstraint(
            "(group_id IS NOT NULL) OR (subgroup_id IS NOT NULL)",
            name="ck_learning_trajectory_has_target",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    status: Mapped[LearningTrajectoryStatus] = mapped_column(
        Enum(
            LearningTrajectoryStatus,
            name="learning_trajectory_status_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        default=LearningTrajectoryStatus.DRAFT,
    )
    graph_version: Mapped[int] = mapped_column(Integer, nullable=False, default=1)

    discipline_id: Mapped[UUID] = mapped_column(
        ForeignKey("disciplines.id", ondelete="CASCADE"),
        nullable=False,
    )
    teacher_id: Mapped[UUID] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
    )
    group_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=True,
    )
    subgroup_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("subgroups.id", ondelete="CASCADE"),
        nullable=True,
    )

    discipline: Mapped["Discipline"] = relationship("Discipline", lazy="selectin")
    teacher: Mapped["Teacher"] = relationship("Teacher", lazy="selectin")
    group: Mapped["Group | None"] = relationship("Group", lazy="selectin")
    subgroup: Mapped["Subgroup | None"] = relationship("Subgroup", lazy="selectin")

    topics: Mapped[list["LearningTrajectoryTopic"]] = relationship(
        "LearningTrajectoryTopic",
        back_populates="trajectory",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="LearningTrajectoryTopic.position",
    )
    tasks: Mapped[list["LearningTrajectoryTask"]] = relationship(
        "LearningTrajectoryTask",
        back_populates="trajectory",
        cascade="all, delete-orphan",
        lazy="selectin",
        order_by="LearningTrajectoryTask.created_at",
    )

    @property
    def is_actual(self) -> bool:
        return self.graph_version == self.discipline.knowledge_graph_version


class LearningTrajectoryTopic(Base):
    __tablename__ = "learning_trajectory_topics"
    __table_args__ = (
        UniqueConstraint("trajectory_id", "topic_id", name="uq_learning_trajectory_topic"),
        UniqueConstraint(
            "trajectory_id",
            "position",
            name="uq_learning_trajectory_topic_position",
        ),
        CheckConstraint("position > 0", name="ck_learning_trajectory_topic_position"),
        CheckConstraint(
            "threshold >= 0 AND threshold <= 100",
            name="ck_learning_trajectory_topic_threshold",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    trajectory_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectories.id", ondelete="CASCADE"),
        nullable=False,
    )
    topic_id: Mapped[UUID] = mapped_column(
        ForeignKey("topics.id", ondelete="CASCADE"),
        nullable=False,
    )

    position: Mapped[int] = mapped_column(Integer, nullable=False)
    threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    trajectory: Mapped["LearningTrajectory"] = relationship(
        "LearningTrajectory",
        back_populates="topics",
        lazy="selectin",
    )
    topic: Mapped["Topic"] = relationship("Topic", lazy="selectin")

    elements: Mapped[list["LearningTrajectoryElement"]] = relationship(
        "LearningTrajectoryElement",
        back_populates="trajectory_topic",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    tasks: Mapped[list["LearningTrajectoryTask"]] = relationship(
        "LearningTrajectoryTask",
        back_populates="trajectory_topic",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class LearningTrajectoryElement(Base):
    __tablename__ = "learning_trajectory_elements"
    __table_args__ = (
        UniqueConstraint(
            "trajectory_topic_id",
            "element_id",
            name="uq_learning_trajectory_topic_element",
        ),
        CheckConstraint(
            "threshold >= 0 AND threshold <= 100",
            name="ck_learning_trajectory_element_threshold",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    trajectory_topic_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectory_topics.id", ondelete="CASCADE"),
        nullable=False,
    )
    element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )

    threshold: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    trajectory_topic: Mapped["LearningTrajectoryTopic"] = relationship(
        "LearningTrajectoryTopic",
        back_populates="elements",
        lazy="selectin",
    )
    element: Mapped["KnowledgeElement"] = relationship("KnowledgeElement", lazy="selectin")
