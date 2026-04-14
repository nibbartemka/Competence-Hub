from pydantic import BaseModel, ConfigDict, Field


class ThemeBase(BaseModel):
    title: str
    description: str | None = None
    order_index: int = Field(default=1, ge=1)
    is_required: bool = True


class ThemeCreate(ThemeBase):
    pass


class ThemeRead(ThemeBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    discipline_id: int
