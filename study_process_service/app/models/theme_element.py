from sqlalchemy import Boolean, Column, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.core.db import Base
from app.models.enums import AssessmentFormat, CompetencyType


class ThemeElement(Base):
    __tablename__ = "theme_elements"

    id = Column(Integer, primary_key=True, index=True)
    theme_id = Column(Integer, ForeignKey("themes.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_required = Column(Boolean, nullable=False, default=True)
    competency_type = Column(
        Enum(CompetencyType, native_enum=False),
        nullable=False,
        default=CompetencyType.KNOW,
    )
    assessment_format = Column(
        Enum(AssessmentFormat, native_enum=False),
        nullable=True,
    )
    parent_element_id = Column(
        Integer,
        ForeignKey("theme_elements.id", ondelete="SET NULL"),
        nullable=True,
        index=True,
    )

    theme = relationship("Theme", back_populates="elements")
    parent_element = relationship(
        "ThemeElement",
        remote_side=[id],
        back_populates="child_elements",
    )
    child_elements = relationship("ThemeElement", back_populates="parent_element")
