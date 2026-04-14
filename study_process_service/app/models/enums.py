from enum import StrEnum


class UserRole(StrEnum):
    EXPERT = "expert"
    TEACHER = "teacher"
    STUDENT = "student"


class AssessmentFormat(StrEnum):
    QUESTION_ANSWER = "question_answer"
    TEST = "test"


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
