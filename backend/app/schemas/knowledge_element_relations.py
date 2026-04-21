from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.enums import KnowledgeElementRelationType


class KnowledgeElementRelationCreate(BaseModel):
    source_element_id: UUID
    target_element_id: UUID
    relation_type: KnowledgeElementRelationType
    description: str | None = None


class KnowledgeElementRelationUpdate(BaseModel):
    source_element_id: UUID
    target_element_id: UUID
    relation_type: KnowledgeElementRelationType
    description: str | None = None


class KnowledgeElementRelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_element_id: UUID
    target_element_id: UUID
    relation_type: KnowledgeElementRelationType
    description: str | None
