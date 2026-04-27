from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class Student(Base):
    __tablename__ = "students"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    group_id: Mapped[UUID] = mapped_column(
        ForeignKey("groups.id", ondelete="CASCADE"),
        nullable=False,
    )

    subgroup_id: Mapped[UUID | None] = mapped_column(
        ForeignKey("subgroups.id", ondelete="SET NULL"),
        nullable=True,
    )

    group: Mapped["Group"] = relationship(
        "Group",
        back_populates="students",
        lazy="selectin",
    )

    subgroup: Mapped["Subgroup | None"] = relationship(
        "Subgroup",
        back_populates="students",
        lazy="selectin",
    )

    discipline_links: Mapped[list["StudentDiscipline"]] = relationship(
        "StudentDiscipline",
        back_populates="student",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    ratings: Mapped[list["StudentDisciplineRating"]] = relationship(
        "StudentDisciplineRating",
        back_populates="student",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    element_masteries: Mapped[list["StudentElementMastery"]] = relationship(
        "StudentElementMastery",
        back_populates="student",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    task_progress_entries: Mapped[list["StudentTaskProgress"]] = relationship(
        "StudentTaskProgress",
        back_populates="student",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
