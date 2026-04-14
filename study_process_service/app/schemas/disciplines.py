from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class DisciplineCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)


class DisciplineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
