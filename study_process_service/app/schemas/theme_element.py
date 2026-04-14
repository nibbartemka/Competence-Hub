from pydantic import BaseModel, ConfigDict, model_validator

from app.models.enums import AssessmentFormat, CompetencyType


class ThemeElementBase(BaseModel):
    title: str
    description: str | None = None
    competency_type: CompetencyType
    is_required: bool = True
    assessment_format: AssessmentFormat | None = None
    parent_element_id: int | None = None


class ThemeElementCreate(ThemeElementBase):
    competency_type: CompetencyType = CompetencyType.KNOW

    @model_validator(mode="after")
    def validate_competency_specific_fields(self) -> "ThemeElementCreate":
        if self.competency_type == CompetencyType.KNOW and self.assessment_format is None:
            self.assessment_format = AssessmentFormat.QUESTION_ANSWER

        if self.competency_type != CompetencyType.KNOW:
            self.assessment_format = None

        return self


class ThemeElementRead(ThemeElementBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    theme_id: int
    competency_type: CompetencyType
