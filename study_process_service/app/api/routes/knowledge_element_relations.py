from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import or_, select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, KnowledgeElementRelation
from app.schemas import KnowledgeElementRelationCreate, KnowledgeElementRelationRead


router = APIRouter(
    prefix="/knowledge-element-relations",
    tags=["Knowledge Element Relations"],
)


@router.get("/", response_model=list[KnowledgeElementRelationRead])
async def list_knowledge_element_relations(
    session: DbSession,
    element_id: UUID | None = None,
) -> list[KnowledgeElementRelation]:
    query = select(KnowledgeElementRelation)
    if element_id is not None:
        query = query.where(
            or_(
                KnowledgeElementRelation.source_element_id == element_id,
                KnowledgeElementRelation.target_element_id == element_id,
            )
        )
    result = await session.execute(query.order_by(KnowledgeElementRelation.id))
    return list(result.scalars().all())


@router.post(
    "/",
    response_model=KnowledgeElementRelationRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_knowledge_element_relation(
    payload: KnowledgeElementRelationCreate,
    session: DbSession,
) -> KnowledgeElementRelation:
    source_element = await session.get(KnowledgeElement, payload.source_element_id)
    if source_element is None:
        raise not_found("Knowledge element", payload.source_element_id)

    target_element = await session.get(KnowledgeElement, payload.target_element_id)
    if target_element is None:
        raise not_found("Knowledge element", payload.target_element_id)

    relation = KnowledgeElementRelation(
        source_element_id=payload.source_element_id,
        target_element_id=payload.target_element_id,
        relation_type=payload.relation_type,
        description=payload.description,
    )
    session.add(relation)
    await commit_or_409(session)
    await session.refresh(relation)
    return relation


@router.delete("/{relation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_element_relation(relation_id: UUID, session: DbSession) -> None:
    relation = await session.get(KnowledgeElementRelation, relation_id)
    if relation is None:
        raise not_found("Knowledge element relation", relation_id)
    await delete_and_commit(session, relation)
