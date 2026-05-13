from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field


class SkillAssessmentTaskCreate(BaseModel):
    skill_element_id: UUID
    title: str = Field(min_length=1, max_length=255)
    prompt: str = Field(min_length=1, max_length=5000)
    input_payload: dict[str, Any] = Field(default_factory=dict)


class SkillAssessmentTaskRead(BaseModel):
    id: UUID
    skill_element_id: UUID
    skill_element_name: str
    title: str
    prompt: str
    operation_ref: str
    contract_title: str
    input_payload: dict[str, Any] = Field(default_factory=dict)
    expected_output: Any = None
    realizes_knowledge_element_ids: list[UUID] = Field(default_factory=list)
    realizes_knowledge_element_names: list[str] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime
