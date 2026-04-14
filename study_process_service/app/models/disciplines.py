from uuid import UUID, uuid4

from sqlalchemy import ForeignKey, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class Discipline(Base):
    __tablename__ = "disciplines"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)

    topics: Mapped[list["Topic"]] = relationship(
        "Topic",
        back_populates="discipline",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    trajectory_links: Mapped[list["DisciplineTrajectory"]] = relationship(
        "DisciplineTrajectory",
        back_populates="discipline",
        cascade="all, delete-orphan",
        lazy="selectin",
    )


class Topic(Base):
    __tablename__ = "topics"
    __table_args__ = (
        UniqueConstraint("name", "discipline_id", name="uq_topic_name_discipline"),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False)

    discipline_id: Mapped[UUID] = mapped_column(
        ForeignKey("disciplines.id", ondelete="CASCADE"),
        nullable=False,
    )

    discipline: Mapped["Discipline"] = relationship(
        "Discipline",
        back_populates="topics",
        lazy="selectin",
    )
