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


class TopicDependencySource(StrEnum):
    COMPUTED = "computed"
    MANUAL = "manual"


class LearningTrajectoryStatus(StrEnum):
    DRAFT = "draft"
    ACTIVE = "active"
    ARCHIVED = "archived"


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


class StudentTaskProgressStatus(StrEnum):
    NOT_STARTED = "not_started"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class LearningTrajectoryTaskType(StrEnum):
    SINGLE_CHOICE = "single_choice"
    MULTIPLE_CHOICE = "multiple_choice"
    MATCHING = "matching"
    ORDERING = "ordering"
    TEXT = "text"


class LearningTrajectoryTaskTemplateKind(StrEnum):
    DEFINITION_CHOICE = "definition_choice"
    TERM_CHOICE = "term_choice"
    RELATION_CHOICE = "relation_choice"
    REQUIRES_ORDERING = "requires_ordering"
    CONTAINS_MULTIPLE = "contains_multiple"
    MATCHING_DEFINITION = "matching_definition"
    CONTRAST_CHOICE = "contrast_choice"
    TEXT_DEFINITION = "text_definition"
    MANUAL = "manual"
