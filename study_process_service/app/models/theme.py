from sqlalchemy import Boolean, Column, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.db import Base


class Theme(Base):
    __tablename__ = "themes"

    id = Column(Integer, primary_key=True, index=True)
    discipline_id = Column(Integer, ForeignKey("disciplines.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    order_index = Column(Integer, nullable=False, default=1)
    is_required = Column(Boolean, nullable=False, default=True)

    discipline = relationship("Discipline", back_populates="themes")
    elements = relationship(
        "ThemeElement",
        back_populates="theme",
        cascade="all, delete-orphan",
        order_by="ThemeElement.id",
    )
    teacher_selections = relationship(
        "TeacherThemeSelection",
        back_populates="theme",
        cascade="all, delete-orphan",
    )
