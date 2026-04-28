from .disciplines import DisciplineCreate, DisciplineRead
from .groups import GroupCreate, GroupRead, SubgroupCreate, SubgroupRead
from .knowledge_element_relations import (
    KnowledgeElementRelationCreate,
    KnowledgeElementRelationRead,
    KnowledgeElementRelationUpdate,
)
from .knowledge_graph_view import DisciplineKnowledgeGraphRead
from .knowledge_elements import (
    KnowledgeElementCreate,
    KnowledgeElementRead,
    KnowledgeElementUpdate,
)
from .learning_trajectories import (
    LearningTrajectoryCreate,
    LearningTrajectoryRead,
    LearningTrajectorySummaryRead,
    LearningTrajectoryStatusUpdate,
    StudentLearningTrajectorySummaryRead,
    LearningTrajectoryTopicOrderUpdate,
    LearningTrajectoryTopicCreate,
    LearningTrajectoryTopicRead,
    LearningTrajectoryElementCreate,
    LearningTrajectoryElementRead,
)
from .learning_trajectory_tasks import (
    LearningTrajectoryTaskCreate,
    LearningTrajectoryTaskElementRead,
    LearningTrajectoryTaskRead,
    LearningTrajectoryTaskRelationRead,
    LearningTrajectoryTaskUpdate,
    StudentAssignedTaskRead,
    StudentTaskAnswerSubmit,
    StudentTaskElementStateRead,
    StudentTaskProgressRead,
)
from .learning_control import (
    StudentTrajectoryMasteryElementRead,
    StudentTrajectoryMasteryRead,
    StudentTrajectoryMasteryTopicRead,
    StudentTopicControlElementRead,
    StudentTopicControlRead,
)
from .topic_dependencies import TopicDependencyCreate, TopicDependencyRead
from .topic_knowledge_elements import (
    TopicKnowledgeElementCreate,
    TopicKnowledgeElementRead,
)
from .topics import TopicCreate, TopicRead, TopicUpdate
from .students import StudentCreate, StudentRead
from .teachers import TeacherCreate, TeacherRead

__all__ = [
    "DisciplineCreate",
    "DisciplineRead",
    "GroupCreate",
    "GroupRead",
    "SubgroupCreate",
    "SubgroupRead",
    "StudentCreate",
    "StudentRead",
    "TeacherCreate",
    "TeacherRead",
    "DisciplineKnowledgeGraphRead",
    "TopicCreate",
    "TopicRead",
    "TopicUpdate",
    "TopicDependencyCreate",
    "TopicDependencyRead",
    "KnowledgeElementCreate",
    "KnowledgeElementRead",
    "KnowledgeElementUpdate",
    "LearningTrajectoryCreate",
    "LearningTrajectoryRead",
    "LearningTrajectorySummaryRead",
    "LearningTrajectoryStatusUpdate",
    "StudentLearningTrajectorySummaryRead",
    "LearningTrajectoryTopicOrderUpdate",
    "LearningTrajectoryTopicCreate",
    "LearningTrajectoryTopicRead",
    "LearningTrajectoryElementCreate",
    "LearningTrajectoryElementRead",
    "LearningTrajectoryTaskCreate",
    "LearningTrajectoryTaskElementRead",
    "LearningTrajectoryTaskRead",
    "LearningTrajectoryTaskRelationRead",
    "LearningTrajectoryTaskUpdate",
    "StudentAssignedTaskRead",
    "StudentTaskAnswerSubmit",
    "StudentTaskElementStateRead",
    "StudentTaskProgressRead",
    "StudentTrajectoryMasteryElementRead",
    "StudentTrajectoryMasteryRead",
    "StudentTrajectoryMasteryTopicRead",
    "StudentTopicControlElementRead",
    "StudentTopicControlRead",
    "TopicKnowledgeElementCreate",
    "TopicKnowledgeElementRead",
    "KnowledgeElementRelationCreate",
    "KnowledgeElementRelationRead",
    "KnowledgeElementRelationUpdate",
]
