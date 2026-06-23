from pydantic import BaseModel

from .disciplines import DisciplineRead
from .knowledge_element_relations import KnowledgeElementRelationRead
from .knowledge_elements import KnowledgeElementRead
from .topic_dependencies import TopicDependencyRead
from .topic_knowledge_elements import TopicKnowledgeElementRead
from .topics import TopicRead


class DisciplineKnowledgeGraphRead(BaseModel):
    discipline: DisciplineRead
    topics: list[TopicRead]
    topic_dependencies: list[TopicDependencyRead]
    knowledge_elements: list[KnowledgeElementRead]
    topic_knowledge_elements: list[TopicKnowledgeElementRead]
    knowledge_element_relations: list[KnowledgeElementRelationRead]
