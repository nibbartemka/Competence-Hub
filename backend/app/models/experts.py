from uuid import UUID, uuid4

from sqlalchemy import Boolean, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class Expert(Base):
    __tablename__ = "experts"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    login: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    password: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    discipline_links: Mapped[list["ExpertDiscipline"]] = relationship(
        "ExpertDiscipline",
        back_populates="expert",
        cascade="all, delete-orphan",
        lazy="selectin",
    )
