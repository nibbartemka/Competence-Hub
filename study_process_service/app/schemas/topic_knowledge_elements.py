from uuid import UUID

from pydantic import BaseModel, ConfigDict


class TopicKnowledgeElementCreate(BaseModel):
    topic_id: UUID
    element_id: UUID
    note: str | None = None


class TopicKnowledgeElementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    topic_id: UUID
    element_id: UUID
    note: str | None
