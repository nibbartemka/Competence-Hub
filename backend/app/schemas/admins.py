from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class AdminCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    login: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=255)


class AdminUpdate(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    login: str | None = Field(default=None, min_length=1, max_length=255)
    password: str | None = Field(default=None, min_length=1, max_length=255)


class AdminRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    login: str
