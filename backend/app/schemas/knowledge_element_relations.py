from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.enums import KnowledgeElementRelationType
from .relations import RelationRead


class KnowledgeElementRelationCreate(BaseModel):
    source_element_id: UUID
    target_element_id: UUID
    relation_id: UUID
    description: str | None = None


class KnowledgeElementRelationUpdate(BaseModel):
    source_element_id: UUID
    target_element_id: UUID
    relation_id: UUID
    description: str | None = None


class KnowledgeElementRelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    source_element_id: UUID
    target_element_id: UUID
    relation_id: UUID
    relation_type: KnowledgeElementRelationType
    relation: RelationRead
    description: str | None
