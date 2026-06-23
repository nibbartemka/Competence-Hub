from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class TeacherCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    login: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=255)
    group_ids: list[UUID] = Field(default_factory=list)


class TeacherUpdate(BaseModel):
    is_active: bool | None = None


class TeacherRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    login: str
    is_active: bool = True
    discipline_ids: list[UUID] = Field(default_factory=list)
    group_ids: list[UUID] = Field(default_factory=list)
