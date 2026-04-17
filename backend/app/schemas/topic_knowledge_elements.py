from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.enums import TopicKnowledgeElementRole


class TopicKnowledgeElementCreate(BaseModel):
    topic_id: UUID
    element_id: UUID
    role: TopicKnowledgeElementRole
    note: str | None = None


class TopicKnowledgeElementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    topic_id: UUID
    element_id: UUID
    role: TopicKnowledgeElementRole
    note: str | None
