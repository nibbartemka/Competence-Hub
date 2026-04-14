from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TopicDependencyCreate(BaseModel):
    prerequisite_topic_id: UUID
    dependent_topic_id: UUID
    description: str | None = None


class TopicDependencyRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    prerequisite_topic_id: UUID
    dependent_topic_id: UUID
    description: str | None
