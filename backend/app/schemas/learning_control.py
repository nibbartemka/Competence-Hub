from uuid import UUID

from pydantic import BaseModel, Field

from .learning_trajectory_tasks import StudentAssignedTaskRead


class StudentTopicControlElementRead(BaseModel):
    element_id: UUID
    name: str
    threshold: int
    mastery_value: int


class StudentTopicControlNextTopicRead(BaseModel):
    topic_id: UUID
    topic_name: str
    position: int
    is_unlocked: bool


class StudentAdaptiveStatusRead(BaseModel):
    mode: str = "regular"
    title: str
    summary: str
    signal_kind: str | None = None
    recommendation_score: float | None = None
    last_duration_seconds: int | None = None
    expected_duration_seconds: int | None = None


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
    practice_stage: str = "know"
    knowledge_threshold_passed: bool = False
    skill_threshold_passed: bool = False
    skill_practice_available: bool = False
    master_practice_available: bool = False
    show_next_topic_prompt: bool = False
    next_topic: StudentTopicControlNextTopicRead | None = None
    adaptive_status: StudentAdaptiveStatusRead | None = None
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
