from datetime import datetime

from pydantic import BaseModel, ConfigDict


class DisciplineBase(BaseModel):
    name: str
    description: str | None = None


class DisciplineCreate(DisciplineBase):
    pass


class DisciplineRead(DisciplineBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    created_at: datetime
