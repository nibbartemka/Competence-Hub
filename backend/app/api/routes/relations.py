from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.orm import lazyload

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import Relation
from app.schemas import RelationCreate, RelationRead, RelationUpdate


router = APIRouter(prefix="/relations", tags=["Relations"])


@router.get("/", response_model=list[RelationRead])
async def list_relations(session: DbSession) -> list[Relation]:
    result = await session.execute(
        select(Relation)
        .options(lazyload("*"))
        .order_by(Relation.relation_type)
    )
    return list(result.scalars().all())


@router.get("/{relation_id}", response_model=RelationRead)
async def get_relation(relation_id: UUID, session: DbSession) -> Relation:
    result = await session.execute(
        select(Relation)
        .options(lazyload("*"))
        .where(Relation.id == relation_id)
    )
    relation = result.scalar_one_or_none()
    if relation is None:
        raise not_found("Relation", relation_id)
    return relation


@router.post("/", response_model=RelationRead, status_code=status.HTTP_201_CREATED)
async def create_relation(payload: RelationCreate, session: DbSession) -> Relation:
    relation = Relation(
        relation_type=payload.relation_type,
        direction=payload.direction,
    )
    session.add(relation)
    await flush_or_409(session)
    await commit_or_409(session)
    await session.refresh(relation)
    return relation


@router.put("/{relation_id}", response_model=RelationRead)
async def update_relation(
    relation_id: UUID,
    payload: RelationUpdate,
    session: DbSession,
) -> Relation:
    relation = await session.get(Relation, relation_id)
    if relation is None:
        raise not_found("Relation", relation_id)
    relation.relation_type = payload.relation_type
    relation.direction = payload.direction
    await commit_or_409(session)
    await session.refresh(relation)
    return relation


@router.delete("/{relation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_relation(relation_id: UUID, session: DbSession) -> None:
    relation = await session.get(Relation, relation_id)
    if relation is None:
        raise not_found("Relation", relation_id)
    await session.delete(relation)
    await commit_or_409(session)
