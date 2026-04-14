from pydantic import BaseModel, Field


class TeacherThemeSelectionUpdate(BaseModel):
    selected_theme_ids: list[int] = Field(default_factory=list)


class TeacherThemeSelectionRead(BaseModel):
    discipline_id: int
    selected_theme_ids: list[int]
