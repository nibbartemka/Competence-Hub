from uuid import UUID, uuid4

from sqlalchemy import String
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

    teacher_links: Mapped[list["TeacherDiscipline"]] = relationship(
        "TeacherDiscipline",
        back_populates="discipline",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    group_links: Mapped[list["GroupDiscipline"]] = relationship(
        "GroupDiscipline",
        back_populates="discipline",
        cascade="all, delete-orphan",
        lazy="selectin",
    )

    @property
    def teacher_ids(self) -> list[UUID]:
        return [link.teacher_id for link in self.teacher_links]

    @property
    def group_ids(self) -> list[UUID]:
        return [link.group_id for link in self.group_links]
