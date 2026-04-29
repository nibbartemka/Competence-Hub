from uuid import UUID

from pydantic import BaseModel, ConfigDict

from app.models.enums import KnowledgeElementRelationType, RelationDirectionType


class RelationCreate(BaseModel):
    relation_type: KnowledgeElementRelationType
    direction: RelationDirectionType


class RelationUpdate(BaseModel):
    relation_type: KnowledgeElementRelationType
    direction: RelationDirectionType


class RelationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    relation_type: KnowledgeElementRelationType
    direction: RelationDirectionType
