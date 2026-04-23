from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class LearningTrajectoryElementCreate(BaseModel):
    element_id: UUID
    threshold: int = Field(ge=0, le=100)


class LearningTrajectoryTopicCreate(BaseModel):
    topic_id: UUID
    position: int = Field(gt=0)
    threshold: int = Field(ge=0, le=100)
    elements: list[LearningTrajectoryElementCreate] = Field(default_factory=list)


class LearningTrajectoryCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    discipline_id: UUID
    teacher_id: UUID
    group_id: UUID | None = None
    subgroup_id: UUID | None = None
    topics: list[LearningTrajectoryTopicCreate] = Field(min_length=1)


class LearningTrajectoryTopicOrderUpdate(BaseModel):
    topic_ids: list[UUID] = Field(min_length=1)


class LearningTrajectoryElementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trajectory_topic_id: UUID
    element_id: UUID
    threshold: int


class LearningTrajectoryTopicRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    trajectory_id: UUID
    topic_id: UUID
    position: int
    threshold: int
    elements: list[LearningTrajectoryElementRead] = Field(default_factory=list)


class LearningTrajectoryRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    discipline_id: UUID
    teacher_id: UUID
    group_id: UUID | None
    subgroup_id: UUID | None
    topics: list[LearningTrajectoryTopicRead] = Field(default_factory=list)
