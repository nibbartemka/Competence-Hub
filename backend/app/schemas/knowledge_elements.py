from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.enums import CompetenceType


class KnowledgeElementCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    competence_type: CompetenceType
    discipline_id: UUID
    subject_area_description: str | None = None
    operation_ref: str | None = Field(default=None, max_length=255)


class KnowledgeElementUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    competence_type: CompetenceType
    subject_area_description: str | None = None
    operation_ref: str | None = Field(default=None, max_length=255)


class MasterElementDomainObjectCreate(BaseModel):
    object_name: str = Field(min_length=1, max_length=255)
    knowledge_element_id: UUID


class StructuredMasterKnowledgeElementCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    discipline_id: UUID
    topic_id: UUID
    subject_area_description: str = Field(min_length=1)
    automated_skill_element_ids: list[UUID] = Field(min_length=1)
    domain_objects: list[MasterElementDomainObjectCreate] = Field(min_length=1)


class StructuredMasterKnowledgeElementUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    topic_id: UUID
    subject_area_description: str = Field(min_length=1)
    automated_skill_element_ids: list[UUID] = Field(min_length=1)
    domain_objects: list[MasterElementDomainObjectCreate] = Field(min_length=1)


class StructuredSkillKnowledgeElementUpdate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = None
    topic_id: UUID
    operation_ref: str = Field(min_length=1, max_length=255)
    realized_knowledge_element_ids: list[UUID] = Field(min_length=1)


class KnowledgeElementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    name: str
    description: str | None
    competence_type: CompetenceType
    discipline_id: UUID | None
    subject_area_description: str | None
    operation_ref: str | None
