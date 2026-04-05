from enum import StrEnum


class CompetencyType(StrEnum):
    KNOW = "know"
    CAN = "can"
    MASTER = "master"


class TaskType(StrEnum):
    SINGLE_OR_MULTIPLE_CHOICE = "single_or_multiple_choice"
    COMPLETION = "completion"
    MATCHING = "matching"
    INTERACTIVE = "interactive"
    CASE = "case"


class ThemeStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class ControlStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"