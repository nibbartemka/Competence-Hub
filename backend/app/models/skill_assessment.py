from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, ForeignKey, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core import Base


class SkillAssessmentTask(Base):
    __tablename__ = "skill_assessment_tasks"

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    skill_element_id: Mapped[UUID] = mapped_column(
        ForeignKey("knowledge_elements.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    prompt: Mapped[str] = mapped_column(Text, nullable=False)
    operation_ref: Mapped[str] = mapped_column(String(255), nullable=False)
    input_payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    expected_output_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )

    skill_element: Mapped["KnowledgeElement"] = relationship(
        "KnowledgeElement",
        back_populates="skill_assessment_tasks",
        lazy="selectin",
    )
