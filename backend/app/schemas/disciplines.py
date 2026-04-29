from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DisciplineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    teacher_id: UUID | None = None
    group_ids: list[UUID] = Field(default_factory=list)


class DisciplineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    slug: str
    knowledge_graph_version: int = 1
    teacher_ids: list[UUID] = Field(default_factory=list)
    group_ids: list[UUID] = Field(default_factory=list)
