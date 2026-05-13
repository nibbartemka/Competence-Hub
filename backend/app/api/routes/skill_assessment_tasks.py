import json
from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import lazyload, selectinload

from app.algorithm_library import get_operation_contract
from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, KnowledgeElementRelation, Relation, SkillAssessmentTask
from app.models.enums import CompetenceType, KnowledgeElementRelationType
from app.schemas import SkillAssessmentTaskCreate, SkillAssessmentTaskRead


router = APIRouter(prefix="/skill-assessment-tasks", tags=["Skill Assessment Tasks"])


async def _load_skill_task_or_404(task_id: UUID, session: DbSession) -> SkillAssessmentTask:
    result = await session.execute(
        select(SkillAssessmentTask)
        .options(
            lazyload("*"),
            selectinload(SkillAssessmentTask.skill_element).options(lazyload("*")),
        )
        .where(SkillAssessmentTask.id == task_id)
    )
    task = result.scalar_one_or_none()
    if task is None:
        raise not_found("Skill assessment task", task_id)
    return task


async def _load_realizes_knowledge(
    skill_element_id: UUID,
    session: DbSession,
) -> tuple[list[UUID], list[str]]:
    result = await session.execute(
        select(KnowledgeElement)
        .join(
            KnowledgeElementRelation,
            KnowledgeElementRelation.target_element_id == KnowledgeElement.id,
        )
        .join(Relation, Relation.id == KnowledgeElementRelation.relation_id)
        .where(
            KnowledgeElementRelation.source_element_id == skill_element_id,
            Relation.relation_type == KnowledgeElementRelationType.IMPLEMENTS,
        )
        .order_by(KnowledgeElement.name)
    )
    elements = list(result.scalars().all())
    return ([element.id for element in elements], [element.name for element in elements])


async def _build_task_read(task: SkillAssessmentTask, session: DbSession) -> SkillAssessmentTaskRead:
    contract = get_operation_contract(task.operation_ref)
    realized_ids, realized_names = await _load_realizes_knowledge(task.skill_element_id, session)
    return SkillAssessmentTaskRead(
        id=task.id,
        skill_element_id=task.skill_element_id,
        skill_element_name=task.skill_element.name,
        title=task.title,
        prompt=task.prompt,
        operation_ref=task.operation_ref,
        contract_title=contract.title if contract is not None else task.operation_ref,
        input_payload=json.loads(task.input_payload_json or "{}"),
        expected_output=json.loads(task.expected_output_json or "{}"),
        realizes_knowledge_element_ids=realized_ids,
        realizes_knowledge_element_names=realized_names,
        created_at=task.created_at,
        updated_at=task.updated_at,
    )


@router.get("/", response_model=list[SkillAssessmentTaskRead])
async def list_skill_assessment_tasks(
    session: DbSession,
    discipline_id: UUID | None = None,
    skill_element_id: UUID | None = None,
) -> list[SkillAssessmentTaskRead]:
    query = (
        select(SkillAssessmentTask)
        .options(
            lazyload("*"),
            selectinload(SkillAssessmentTask.skill_element).options(lazyload("*")),
        )
        .join(KnowledgeElement, KnowledgeElement.id == SkillAssessmentTask.skill_element_id)
    )
    if discipline_id is not None:
        query = query.where(KnowledgeElement.discipline_id == discipline_id)
    if skill_element_id is not None:
        query = query.where(SkillAssessmentTask.skill_element_id == skill_element_id)

    result = await session.execute(query.order_by(SkillAssessmentTask.created_at.desc()))
    tasks = list(result.scalars().all())
    return [await _build_task_read(task, session) for task in tasks]


@router.post("/", response_model=SkillAssessmentTaskRead, status_code=status.HTTP_201_CREATED)
async def create_skill_assessment_task(
    payload: SkillAssessmentTaskCreate,
    session: DbSession,
) -> SkillAssessmentTaskRead:
    skill_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == payload.skill_element_id)
    )
    skill_element = skill_result.scalar_one_or_none()
    if skill_element is None:
        raise not_found("Knowledge element", payload.skill_element_id)

    if skill_element.competence_type != CompetenceType.CAN:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Assessment tasks can be created only for knowledge elements of competence 'can'.",
        )

    operation_ref = (skill_element.operation_ref or "").strip()
    if not operation_ref:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The selected skill element does not reference an operation contract.",
        )

    contract = get_operation_contract(operation_ref)
    if contract is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Operation contract '{operation_ref}' was not found in the local algorithm library.",
        )

    try:
        expected_output = contract.executor(payload.input_payload)
    except ValueError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(error),
        ) from error

    task = SkillAssessmentTask(
        skill_element_id=skill_element.id,
        title=payload.title.strip(),
        prompt=payload.prompt.strip(),
        operation_ref=operation_ref,
        input_payload_json=json.dumps(payload.input_payload, ensure_ascii=False),
        expected_output_json=json.dumps(expected_output, ensure_ascii=False),
    )
    session.add(task)
    await flush_or_409(session)
    await commit_or_409(session)
    await session.refresh(task)
    await session.refresh(task, attribute_names=["skill_element"])
    return await _build_task_read(task, session)


@router.delete("/{task_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_skill_assessment_task(task_id: UUID, session: DbSession) -> None:
    task = await _load_skill_task_or_404(task_id, session)
    await session.delete(task)
    await flush_or_409(session)
    await commit_or_409(session)
