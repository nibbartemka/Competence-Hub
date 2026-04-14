from sqlalchemy import Column, Date, DateTime, Enum, Integer, String, func
from sqlalchemy.orm import relationship

from app.core.db import Base
from app.models.enums import UserRole


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), nullable=False, unique=True, index=True)
    full_name = Column(String(255), nullable=False)
    birth_date = Column(Date, nullable=True)
    role = Column(Enum(UserRole, native_enum=False), nullable=False, index=True)
    password_hash = Column(String(255), nullable=False)
    auth_token = Column(String(255), nullable=True, unique=True, index=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    theme_selections = relationship(
        "TeacherThemeSelection",
        back_populates="teacher",
        cascade="all, delete-orphan",
    )
