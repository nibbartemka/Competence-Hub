from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, DateTime, Enum, ForeignKey, Integer, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base

from .enums import (
    LearningTrajectoryTaskTemplateKind,
    LearningTrajectoryTaskType,
    StudentTaskProgressStatus,
)


class LearningTrajectoryTask(Base):
    __tablename__ = "learning_trajectory_tasks"
    __table_args__ = (
        CheckConstraint(
            "difficulty >= 0 AND difficulty <= 100",
            name="ck_learning_trajectory_task_difficulty",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    trajectory_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectories.id", ondelete="CASCADE"),
        nullable=False,
    )
    trajectory_topic_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectory_topics.id", ondelete="CASCADE"),
        nullable=False,
    )
    primary_element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )

    task_type: Mapped[LearningTrajectoryTaskType] = mapped_column(
        Enum(
            LearningTrajectoryTaskType,
            name="learning_trajectory_task_type_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        default=LearningTrajectoryTaskType.SINGLE_CHOICE,
    )
    template_kind: Mapped[LearningTrajectoryTaskTemplateKind] = mapped_column(
        Enum(
            LearningTrajectoryTaskTemplateKind,
            name="learning_trajectory_task_template_kind_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        default=LearningTrajectoryTaskTemplateKind.MANUAL,
    )
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    content_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    difficulty: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    trajectory: Mapped["LearningTrajectory"] = relationship(
        "LearningTrajectory",
        back_populates="tasks",
        lazy="selectin",
    )
    trajectory_topic: Mapped["LearningTrajectoryTopic"] = relationship(
        "LearningTrajectoryTopic",
        back_populates="tasks",
        lazy="selectin",
    )
    primary_element: Mapped["KnowledgeElement"] = relationship(
        "KnowledgeElement",
        lazy="selectin",
    )

    related_elements: Mapped[list["LearningTrajectoryTaskElement"]] = relationship(
        "LearningTrajectoryTaskElement",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    checked_relations: Mapped[list["LearningTrajectoryTaskRelation"]] = relationship(
        "LearningTrajectoryTaskRelation",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    student_progress_entries: Mapped[list["StudentTaskProgress"]] = relationship(
        "StudentTaskProgress",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    student_instances: Mapped[list["StudentTaskInstance"]] = relationship(
        "StudentTaskInstance",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
    student_attempts: Mapped[list["StudentTaskAttempt"]] = relationship(
        "StudentTaskAttempt",
        back_populates="task",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class LearningTrajectoryTaskElement(Base):
    __tablename__ = "learning_trajectory_task_elements"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "element_id",
            name="uq_learning_trajectory_task_element",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectory_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )

    task: Mapped["LearningTrajectoryTask"] = relationship(
        "LearningTrajectoryTask",
        back_populates="related_elements",
        lazy="selectin",
    )
    element: Mapped["KnowledgeElement"] = relationship(
        "KnowledgeElement",
        lazy="selectin",
    )


class LearningTrajectoryTaskRelation(Base):
    __tablename__ = "learning_trajectory_task_relations"
    __table_args__ = (
        UniqueConstraint(
            "task_id",
            "relation_id",
            name="uq_learning_trajectory_task_relation",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectory_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    relation_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_element_relations.id", ondelete="CASCADE"),
        nullable=False,
    )

    task: Mapped["LearningTrajectoryTask"] = relationship(
        "LearningTrajectoryTask",
        back_populates="checked_relations",
        lazy="selectin",
    )
    relation: Mapped["KnowledgeElementRelation"] = relationship(
        "KnowledgeElementRelation",
        lazy="selectin",
    )


class StudentElementMastery(Base):
    __tablename__ = "student_element_masteries"
    __table_args__ = (
        UniqueConstraint(
            "student_id",
            "discipline_id",
            "element_id",
            name="uq_student_element_mastery",
        ),
        CheckConstraint(
            "mastery_value >= 0 AND mastery_value <= 100",
            name="ck_student_element_mastery_value",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    student_id: Mapped[UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
    )
    discipline_id: Mapped[UUID] = mapped_column(
        ForeignKey("disciplines.id", ondelete="CASCADE"),
        nullable=False,
    )
    element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )

    mastery_value: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    student: Mapped["Student"] = relationship(
        "Student",
        back_populates="element_masteries",
        lazy="selectin",
    )
    discipline: Mapped["Discipline"] = relationship("Discipline", lazy="selectin")
    element: Mapped["KnowledgeElement"] = relationship("KnowledgeElement", lazy="selectin")


class StudentTaskProgress(Base):
    __tablename__ = "student_task_progress"
    __table_args__ = (
        UniqueConstraint("student_id", "task_id", name="uq_student_task_progress"),
        CheckConstraint(
            "attempts_count >= 0",
            name="ck_student_task_progress_attempts",
        ),
        CheckConstraint(
            "last_score IS NULL OR (last_score >= 0 AND last_score <= 100)",
            name="ck_student_task_progress_last_score",
        ),
        CheckConstraint(
            "best_score IS NULL OR (best_score >= 0 AND best_score <= 100)",
            name="ck_student_task_progress_best_score",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    student_id: Mapped[UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectory_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    status: Mapped[StudentTaskProgressStatus] = mapped_column(
        Enum(
            StudentTaskProgressStatus,
            name="student_task_progress_status_enum",
            values_callable=lambda enum_cls: [item.value for item in enum_cls],
        ),
        nullable=False,
        default=StudentTaskProgressStatus.NOT_STARTED,
    )
    attempts_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    last_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    best_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    last_answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_answer_payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_feedback_json: Mapped[str | None] = mapped_column(Text, nullable=True)

    student: Mapped["Student"] = relationship(
        "Student",
        back_populates="task_progress_entries",
        lazy="selectin",
    )
    task: Mapped["LearningTrajectoryTask"] = relationship(
        "LearningTrajectoryTask",
        back_populates="student_progress_entries",
        lazy="selectin",
    )


class StudentTaskInstance(Base):
    __tablename__ = "student_task_instances"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    student_id: Mapped[UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectory_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    content_snapshot_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    issued_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )
    answered_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    student: Mapped["Student"] = relationship("Student", lazy="selectin")
    task: Mapped["LearningTrajectoryTask"] = relationship(
        "LearningTrajectoryTask",
        back_populates="student_instances",
        lazy="selectin",
    )
    attempts: Mapped[list["StudentTaskAttempt"]] = relationship(
        "StudentTaskAttempt",
        back_populates="instance",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class StudentTaskAttempt(Base):
    __tablename__ = "student_task_attempts"
    __table_args__ = (
        CheckConstraint(
            "score >= 0 AND score <= 100",
            name="ck_student_task_attempt_score",
        ),
        CheckConstraint(
            "duration_seconds IS NULL OR duration_seconds >= 0",
            name="ck_student_task_attempt_duration",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    instance_id: Mapped[UUID] = mapped_column(
        ForeignKey("student_task_instances.id", ondelete="CASCADE"),
        nullable=False,
    )
    student_id: Mapped[UUID] = mapped_column(
        ForeignKey("students.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_id: Mapped[UUID] = mapped_column(
        ForeignKey("learning_trajectory_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )

    answer_payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    feedback_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    score: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    duration_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)
    answered_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )

    instance: Mapped["StudentTaskInstance"] = relationship(
        "StudentTaskInstance",
        back_populates="attempts",
        lazy="selectin",
    )
    student: Mapped["Student"] = relationship("Student", lazy="selectin")
    task: Mapped["LearningTrajectoryTask"] = relationship(
        "LearningTrajectoryTask",
        back_populates="student_attempts",
        lazy="selectin",
    )
