from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class GroupDiscipline(Base):
    __tablename__ = "group_disciplines"
    __table_args__ = (
        UniqueConstraint("group_id", "discipline_id", name="uq_group_discipline"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    group_id: Mapped[UUID] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
    )
    discipline_id: Mapped[UUID] = mapped_column(
        ForeignKey("disciplines.id", ondelete="CASCADE"),
        nullable=False,
    )

    group: Mapped["Group"] = relationship(
        "Group",
        back_populates="discipline_links",
        lazy="selectin",
    )

    discipline: Mapped["Discipline"] = relationship(
        "Discipline",
        lazy="selectin",
    )


class StudentDiscipline(Base):
    __tablename__ = "student_disciplines"
    __table_args__ = (
        UniqueConstraint("student_id", "discipline_id", name="uq_student_discipline"),
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

    student: Mapped["Student"] = relationship(
        "Student",
        back_populates="discipline_links",
        lazy="selectin",
    )

    discipline: Mapped["Discipline"] = relationship(
        "Discipline",
        lazy="selectin",
    )


class StudentDisciplineRating(Base):
    __tablename__ = "student_discipline_ratings"
    __table_args__ = (
        UniqueConstraint("student_id", "discipline_id", name="uq_student_rating_discipline"),
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

    rating: Mapped[int] = mapped_column(Integer, nullable=False)

    student: Mapped["Student"] = relationship(
        "Student",
        back_populates="ratings",
        lazy="selectin",
    )

    discipline: Mapped["Discipline"] = relationship(
        "Discipline",
        lazy="selectin",
    )


class TeacherDiscipline(Base):
    __tablename__ = "teacher_disciplines"
    __table_args__ = (
        UniqueConstraint("teacher_id", "discipline_id", name="uq_teacher_discipline"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    teacher_id: Mapped[UUID] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
    )
    discipline_id: Mapped[UUID] = mapped_column(
        ForeignKey("disciplines.id", ondelete="CASCADE"),
        nullable=False,
    )

    teacher: Mapped["Teacher"] = relationship(
        "Teacher",
        back_populates="discipline_links",
        lazy="selectin",
    )

    discipline: Mapped["Discipline"] = relationship(
        "Discipline",
        lazy="selectin",
    )


class TeacherGroup(Base):
    __tablename__ = "teacher_groups"
    __table_args__ = (
        UniqueConstraint("teacher_id", "group_id", name="uq_teacher_group"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    teacher_id: Mapped[UUID] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
    )
    group_id: Mapped[UUID] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
    )

    teacher: Mapped["Teacher"] = relationship(
        "Teacher",
        back_populates="group_links",
        lazy="selectin",
    )

    group: Mapped["Group"] = relationship(
        "Group",
        back_populates="teacher_links",
        lazy="selectin",
    )
