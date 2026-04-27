from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import (
    KnowledgeElementRelationType,
    LearningTrajectoryTaskTemplateKind,
    LearningTrajectoryTaskType,
    StudentTaskProgressStatus,
)


class LearningTrajectoryTaskCreate(BaseModel):
    topic_id: UUID
    primary_element_id: UUID
    related_element_ids: list[UUID] = Field(default_factory=list)
    checked_relation_ids: list[UUID] = Field(default_factory=list)
    title: str = Field(default="", max_length=500)
    prompt: str = Field(min_length=1, max_length=5000)
    difficulty: int = Field(ge=0, le=100)
    task_type: LearningTrajectoryTaskType
    template_kind: LearningTrajectoryTaskTemplateKind = LearningTrajectoryTaskTemplateKind.MANUAL
    content: dict[str, Any] = Field(default_factory=dict)


class LearningTrajectoryTaskUpdate(BaseModel):
    topic_id: UUID
    primary_element_id: UUID
    related_element_ids: list[UUID] = Field(default_factory=list)
    checked_relation_ids: list[UUID] = Field(default_factory=list)
    title: str = Field(default="", max_length=500)
    prompt: str = Field(min_length=1, max_length=5000)
    difficulty: int = Field(ge=0, le=100)
    task_type: LearningTrajectoryTaskType
    template_kind: LearningTrajectoryTaskTemplateKind = LearningTrajectoryTaskTemplateKind.MANUAL
    content: dict[str, Any] = Field(default_factory=dict)


class LearningTrajectoryTaskElementRead(BaseModel):
    element_id: UUID
    name: str


class LearningTrajectoryTaskRelationRead(BaseModel):
    relation_id: UUID
    source_element_id: UUID
    source_element_name: str
    target_element_id: UUID
    target_element_name: str
    relation_type: KnowledgeElementRelationType


class LearningTrajectoryTaskRead(BaseModel):
    id: UUID
    trajectory_id: UUID
    trajectory_topic_id: UUID
    topic_id: UUID
    topic_name: str
    title: str
    prompt: str
    difficulty: int
    task_type: LearningTrajectoryTaskType
    template_kind: LearningTrajectoryTaskTemplateKind
    content: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    primary_element: LearningTrajectoryTaskElementRead
    related_elements: list[LearningTrajectoryTaskElementRead] = Field(default_factory=list)
    checked_relations: list[LearningTrajectoryTaskRelationRead] = Field(default_factory=list)


class StudentTaskAnswerSubmit(BaseModel):
    answer_payload: dict[str, Any] = Field(default_factory=dict)
    task_instance_id: UUID | None = None
    duration_seconds: int | None = Field(default=None, ge=0)


class StudentTaskProgressRead(BaseModel):
    status: StudentTaskProgressStatus
    attempts_count: int
    last_score: int | None
    best_score: int | None
    completed_at: datetime | None
    last_answer_payload: dict[str, Any] | None = None
    last_feedback: dict[str, Any] | None = None


class StudentTaskElementStateRead(BaseModel):
    element_id: UUID
    name: str
    mastery_value: int


class StudentAssignedTaskRead(BaseModel):
    id: UUID
    task_instance_id: UUID | None = None
    trajectory_id: UUID
    trajectory_name: str
    discipline_id: UUID
    discipline_name: str
    topic_id: UUID
    topic_name: str
    title: str
    prompt: str
    difficulty: int
    task_type: LearningTrajectoryTaskType
    template_kind: LearningTrajectoryTaskTemplateKind
    content: dict[str, Any] = Field(default_factory=dict)
    primary_element: StudentTaskElementStateRead
    related_elements: list[StudentTaskElementStateRead] = Field(default_factory=list)
    checked_relations: list[LearningTrajectoryTaskRelationRead] = Field(default_factory=list)
    progress: StudentTaskProgressRead
    recommendation_score: float | None = None
