from datetime import datetime
from typing import Any
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import LearningTrajectoryTaskType, StudentTaskProgressStatus


class LearningTrajectoryTaskCreate(BaseModel):
    topic_id: UUID
    primary_element_id: UUID
    related_element_ids: list[UUID] = Field(default_factory=list)
    prompt: str = Field(min_length=1, max_length=5000)
    difficulty: int = Field(ge=0, le=100)
    task_type: LearningTrajectoryTaskType
    content: dict[str, Any] = Field(default_factory=dict)


class LearningTrajectoryTaskUpdate(BaseModel):
    topic_id: UUID
    primary_element_id: UUID
    related_element_ids: list[UUID] = Field(default_factory=list)
    prompt: str = Field(min_length=1, max_length=5000)
    difficulty: int = Field(ge=0, le=100)
    task_type: LearningTrajectoryTaskType
    content: dict[str, Any] = Field(default_factory=dict)


class LearningTrajectoryTaskElementRead(BaseModel):
    element_id: UUID
    name: str


class LearningTrajectoryTaskRead(BaseModel):
    id: UUID
    trajectory_id: UUID
    trajectory_topic_id: UUID
    topic_id: UUID
    topic_name: str
    prompt: str
    difficulty: int
    task_type: LearningTrajectoryTaskType
    content: dict[str, Any] = Field(default_factory=dict)
    created_at: datetime
    updated_at: datetime
    primary_element: LearningTrajectoryTaskElementRead
    related_elements: list[LearningTrajectoryTaskElementRead] = Field(default_factory=list)


class StudentTaskAnswerSubmit(BaseModel):
    answer_payload: dict[str, Any] = Field(default_factory=dict)


class StudentTaskProgressRead(BaseModel):
    status: StudentTaskProgressStatus
    attempts_count: int
    last_score: int | None
    best_score: int | None
    completed_at: datetime | None
    last_answer_payload: dict[str, Any] | None = None


class StudentTaskElementStateRead(BaseModel):
    element_id: UUID
    name: str
    mastery_value: int


class StudentAssignedTaskRead(BaseModel):
    id: UUID
    trajectory_id: UUID
    trajectory_name: str
    discipline_id: UUID
    discipline_name: str
    topic_id: UUID
    topic_name: str
    prompt: str
    difficulty: int
    task_type: LearningTrajectoryTaskType
    content: dict[str, Any] = Field(default_factory=dict)
    primary_element: StudentTaskElementStateRead
    related_elements: list[StudentTaskElementStateRead] = Field(default_factory=list)
    progress: StudentTaskProgressRead
    recommendation_score: float | None = None
