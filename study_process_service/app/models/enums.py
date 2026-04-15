from enum import StrEnum


class CompetenceType(StrEnum):
    KNOW = "know"
    CAN = "can"
    MASTER = "master"


class TopicKnowledgeElementRole(StrEnum):
    REQUIRED = "required"
    FORMED = "formed"


class KnowledgeElementRelationType(StrEnum):
    REQUIRES = "requires"
    BUILDS_ON = "builds_on"
    CONTAINS = "contains"
    PART_OF = "part_of"
    PROPERTY_OF = "property_of"
    REFINES = "refines"
    GENERALIZES = "generalizes"
    SIMILAR = "similar"
    CONTRASTS_WITH = "contrasts_with"
    USED_WITH = "used_with"
    IMPLEMENTS = "implements"
    AUTOMATES = "automates"


class TopicDependencyRelationType(StrEnum):
    REQUIRES = "requires"
    POSSIBLE_FLOW = "possible_flow"


# Backward-compatible alias for older code that still uses the previous name.
TopicElementRelationType = KnowledgeElementRelationType


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
