from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import CompetenceType


class KnowledgeElementCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    competence_type: CompetenceType


class KnowledgeElementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    competence_type: CompetenceType
