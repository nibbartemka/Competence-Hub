from sqlalchemy import Column, ForeignKey, Integer
from sqlalchemy.orm import relationship

from app.core.db import Base


class TeacherThemeSelection(Base):
    __tablename__ = "teacher_theme_selections"

    teacher_id = Column(Integer, ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    theme_id = Column(Integer, ForeignKey("themes.id", ondelete="CASCADE"), primary_key=True)

    teacher = relationship("User", back_populates="theme_selections")
    theme = relationship("Theme", back_populates="teacher_selections")
