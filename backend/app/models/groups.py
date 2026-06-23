from uuid import UUID, uuid4

from sqlalchemy import CheckConstraint, ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class Group(Base):
    __tablename__ = "groups"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    subgroups: Mapped[list["Subgroup"]] = relationship(
        "Subgroup",
        back_populates="group",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    students: Mapped[list["Student"]] = relationship(
        "Student",
        back_populates="group",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    discipline_links: Mapped[list["GroupDiscipline"]] = relationship(
        "GroupDiscipline",
        back_populates="group",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    teacher_links: Mapped[list["TeacherGroup"]] = relationship(
        "TeacherGroup",
        back_populates="group",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class Subgroup(Base):
    __tablename__ = "subgroups"
    __table_args__ = (
        UniqueConstraint("subgroup_num", "group_id", name="uq_subgroup_num_group_id"),
        CheckConstraint("subgroup_num > 0", name="ck_subgroup_num_positive"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    subgroup_num: Mapped[int] = mapped_column(nullable=False)

    group_id: Mapped[UUID] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
    )

    group: Mapped["Group"] = relationship(
        "Group",
        back_populates="subgroups",
        lazy="selectin",
    )

    students: Mapped[list["Student"]] = relationship(
        "Student",
        back_populates="subgroup",
        lazy="selectin",
    )

    teacher_links: Mapped[list["TeacherSubgroup"]] = relationship(
        "TeacherSubgroup",
        back_populates="subgroup",
        cascade="all, delete-orphan",
        lazy="selectin",
    )