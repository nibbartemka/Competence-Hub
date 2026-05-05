from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint, CheckConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class Teacher(Base):
    __tablename__ = "teachers"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    login: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password: Mapped[str] = mapped_column(String(255), nullable=False)

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

    @property
    def discipline_ids(self) -> list[UUID]:
        return [link.discipline_id for link in self.discipline_links]

    @property
    def group_ids(self) -> list[UUID]:
        return [link.group_id for link in self.group_links]


class TeacherSubgroup(Base):
    __tablename__ = "teacher_subgroups"
    __table_args__ = (
        UniqueConstraint("teacher_id", "subgroup_id", name="uq_teacher_subgroup_num"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)

    teacher_id: Mapped[UUID] = mapped_column(
        ForeignKey("teachers.id", ondelete="CASCADE"),
        nullable=False,
    )

    subgroup_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("subgroups.id", ondelete="CASCADE"),
        nullable=False,
    )

    teacher: Mapped["Teacher"] = relationship(
        "Teacher",
        back_populates="subgroup_links",
        lazy="selectin",
    )

    subgroup: Mapped["Subgroup"] = relationship(
        "Subgroup",
        back_populates="teacher_links",
        lazy="selectin",
    )
