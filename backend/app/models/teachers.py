from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    discipline_links: Mapped[list["TeacherDiscipline"]] = relationship(
        "TeacherDiscipline",
        back_populates="teacher",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    group_links: Mapped[list["TeacherGroup"]] = relationship(
        "TeacherGroup",
        back_populates="teacher",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    subgroup_links: Mapped[list["TeacherSubgroup"]] = relationship(
        "TeacherSubgroup",
        back_populates="teacher",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class TeacherSubgroup(Base):
    __tablename__ = "teacher_subgroups"
    __table_args__ = (
        UniqueConstraint("teacher_id", "subgroup_num", name="uq_teacher_subgroup_num"),
        CheckConstraint("subgroup_num > 0", name="ck_teacher_subgroup_num_positive"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    teacher_id: Mapped[UUID] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
    )

    subgroup_num: Mapped[int] = mapped_column(Integer, nullable=False)

    teacher: Mapped["Teacher"] = relationship(
        "Teacher",
        back_populates="subgroup_links",
        lazy="selectin",
    )
