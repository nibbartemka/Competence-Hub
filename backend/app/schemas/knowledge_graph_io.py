from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.models.enums import CompetenceType, KnowledgeElementRelationType, TopicDependencyRelationType
from app.models.enums import TopicKnowledgeElementRole

from .disciplines import DisciplineRead
from .knowledge_element_relations import KnowledgeElementRelationRead
from .knowledge_elements import KnowledgeElementRead
from .topic_dependencies import TopicDependencyRead
from .topic_knowledge_elements import TopicKnowledgeElementRead
from .topics import TopicRead


class KnowledgeGraphExportFile(BaseModel):
    """JSON-файл экспорта графа знаний (совместим с телом DisciplineKnowledgeGraphRead)."""

    format_version: int = 1
    exported_at: datetime | None = None
    source_discipline: DisciplineRead | None = None
    topics: list[TopicRead] = Field(default_factory=list)
    topic_dependencies: list[TopicDependencyRead] = Field(default_factory=list)
    knowledge_elements: list[KnowledgeElementRead] = Field(default_factory=list)
    topic_knowledge_elements: list[TopicKnowledgeElementRead] = Field(default_factory=list)
    knowledge_element_relations: list[KnowledgeElementRelationRead] = Field(default_factory=list)


class ImportPreviewTopicRow(BaseModel):
    export_id: UUID
    name: str
    description: str | None = None
    is_duplicate: bool
    existing_topic_id: UUID | None = None


class ImportPreviewElementRow(BaseModel):
    export_id: UUID
    name: str
    competence_type: CompetenceType
    description: str | None = None
    is_duplicate: bool
    existing_element_id: UUID | None = None


class ImportPreviewTopicDependencyRow(BaseModel):
    export_id: UUID
    prerequisite_topic_export_id: UUID
    dependent_topic_export_id: UUID
    relation_type: TopicDependencyRelationType
    description: str | None = None
    is_duplicate: bool
    prerequisite_is_duplicate: bool
    dependent_is_duplicate: bool


class ImportPreviewTopicKnowledgeElementRow(BaseModel):
    export_id: UUID
    topic_export_id: UUID
    element_export_id: UUID
    role: TopicKnowledgeElementRole
    note: str | None = None
    is_duplicate: bool
    topic_is_duplicate: bool
    element_is_duplicate: bool


class ImportPreviewKnowledgeElementRelationRow(BaseModel):
    export_id: UUID
    source_element_export_id: UUID
    target_element_export_id: UUID
    relation_type: KnowledgeElementRelationType
    description: str | None = None
    is_duplicate: bool
    source_is_duplicate: bool
    target_is_duplicate: bool


class KnowledgeGraphImportPreviewResponse(BaseModel):
    target_discipline_id: UUID
    topics: list[ImportPreviewTopicRow]
    knowledge_elements: list[ImportPreviewElementRow]
    topic_dependencies: list[ImportPreviewTopicDependencyRow]
    topic_knowledge_elements: list[ImportPreviewTopicKnowledgeElementRow]
    knowledge_element_relations: list[ImportPreviewKnowledgeElementRelationRow]


class KnowledgeGraphImportRequest(BaseModel):
    export: KnowledgeGraphExportFile
    selected_topic_export_ids: list[UUID] = Field(default_factory=list)
    selected_element_export_ids: list[UUID] = Field(default_factory=list)
    selected_topic_dependency_export_ids: list[UUID] = Field(default_factory=list)
    selected_topic_knowledge_element_export_ids: list[UUID] = Field(default_factory=list)
    selected_knowledge_element_relation_export_ids: list[UUID] = Field(default_factory=list)


class KnowledgeGraphImportResult(BaseModel):
    created_topics: int
    created_knowledge_elements: int
    created_topic_dependencies: int
    created_topic_knowledge_elements: int
    created_knowledge_element_relations: int
    skipped_duplicate_topic_dependencies: int
    skipped_duplicate_topic_knowledge_elements: int
    skipped_duplicate_knowledge_element_relations: int
