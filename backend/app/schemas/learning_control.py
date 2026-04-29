from uuid import UUID

from pydantic import BaseModel, Field

from .learning_trajectory_tasks import StudentAssignedTaskRead


class StudentTopicControlElementRead(BaseModel):
    element_id: UUID
    name: str
    threshold: int
    mastery_value: int


class StudentTopicControlRead(BaseModel):
    student_id: UUID
    trajectory_id: UUID
    topic_id: UUID
    topic_name: str
    topic_threshold: int
    topic_mastery: int
    is_unlocked: bool
    has_tasks: bool = False
    continue_practice_available: bool = False
    is_extra_practice: bool = False
    elements: list[StudentTopicControlElementRead] = Field(default_factory=list)
    current_task: StudentAssignedTaskRead | None = None


class StudentTrajectoryMasteryElementRead(BaseModel):
    element_id: UUID
    threshold: int
    mastery_value: int


class StudentTrajectoryMasteryTopicRead(BaseModel):
    topic_id: UUID
    position: int
    threshold: int
    mastery_value: int
    is_unlocked: bool
    elements: list[StudentTrajectoryMasteryElementRead] = Field(default_factory=list)


class StudentTrajectoryMasteryRead(BaseModel):
    student_id: UUID
    trajectory_id: UUID
    topics: list[StudentTrajectoryMasteryTopicRead] = Field(default_factory=list)
