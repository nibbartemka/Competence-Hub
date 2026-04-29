from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.orm import lazyload, selectinload

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, KnowledgeElementRelation, Relation
from app.models.enums import CompetenceType, KnowledgeElementRelationType
from app.schemas import (
    KnowledgeElementRelationCreate,
    KnowledgeElementRelationRead,
    KnowledgeElementRelationUpdate,
)
from app.services.knowledge_graph_integrity import bump_knowledge_graph_version


router = APIRouter(
    prefix="/knowledge-element-relations",
    tags=["Knowledge Element Relations"],
)


async def _get_relation_for_read(
    session: DbSession,
    relation_id: UUID,
) -> KnowledgeElementRelation:
    result = await session.execute(
        select(KnowledgeElementRelation)
        .options(selectinload(KnowledgeElementRelation.relation))
        .where(KnowledgeElementRelation.id == relation_id)
    )
    relation = result.scalar_one_or_none()
    if relation is None:
        raise not_found("Knowledge element relation", relation_id)
    return relation


def _is_allowed_relation(
    source_type: CompetenceType,
    target_type: CompetenceType,
    relation_type: KnowledgeElementRelationType,
) -> bool:
    if source_type == CompetenceType.KNOW and target_type == CompetenceType.KNOW:
        return relation_type in {
            KnowledgeElementRelationType.REQUIRES,
            KnowledgeElementRelationType.BUILDS_ON,
            KnowledgeElementRelationType.CONTAINS,
            KnowledgeElementRelationType.PART_OF,
            KnowledgeElementRelationType.PROPERTY_OF,
            KnowledgeElementRelationType.REFINES,
            KnowledgeElementRelationType.GENERALIZES,
            KnowledgeElementRelationType.SIMILAR,
            KnowledgeElementRelationType.CONTRASTS_WITH,
            KnowledgeElementRelationType.USED_WITH,
        }

    if source_type == CompetenceType.KNOW and target_type == CompetenceType.CAN:
        return relation_type == KnowledgeElementRelationType.IMPLEMENTS

    if source_type == CompetenceType.CAN and target_type == CompetenceType.MASTER:
        return relation_type == KnowledgeElementRelationType.AUTOMATES

    return False


@router.get("/", response_model=list[KnowledgeElementRelationRead])
async def list_knowledge_element_relations(
    session: DbSession,
    element_id: UUID | None = None,
) -> list[KnowledgeElementRelation]:
    query = select(KnowledgeElementRelation).options(
        selectinload(KnowledgeElementRelation.relation)
    )
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
    source_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == payload.source_element_id)
    )
    source_element = source_result.scalar_one_or_none()
    if source_element is None:
        raise not_found("Knowledge element", payload.source_element_id)

    target_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == payload.target_element_id)
    )
    target_element = target_result.scalar_one_or_none()
    if target_element is None:
        raise not_found("Knowledge element", payload.target_element_id)

    if source_element.discipline_id != target_element.discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge elements from different disciplines cannot be related.",
        )

    if source_element.id == target_element.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge element relation cannot point to itself.",
        )

    relation_definition_result = await session.execute(
        select(Relation)
        .options(lazyload("*"))
        .where(Relation.id == payload.relation_id)
    )
    relation_definition = relation_definition_result.scalar_one_or_none()
    if relation_definition is None:
        raise not_found("Relation", payload.relation_id)

    if not _is_allowed_relation(
        source_element.competence_type,
        target_element.competence_type,
        relation_definition.relation_type,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported relation for the selected element pair. "
                "Allowed combinations: know->know, know->can (implements), "
                "can->master (automates)."
            ),
        )

    relation = KnowledgeElementRelation(
        source_element_id=payload.source_element_id,
        target_element_id=payload.target_element_id,
        relation_id=payload.relation_id,
        description=payload.description,
    )
    session.add(relation)
    await flush_or_409(session)
    if source_element.discipline_id is not None:
        await bump_knowledge_graph_version(session, [source_element.discipline_id])
    await commit_or_409(session)
    return await _get_relation_for_read(session, relation.id)


@router.put("/{relation_id}", response_model=KnowledgeElementRelationRead)
async def update_knowledge_element_relation(
    relation_id: UUID,
    payload: KnowledgeElementRelationUpdate,
    session: DbSession,
) -> KnowledgeElementRelation:
    relation_result = await session.execute(
        select(KnowledgeElementRelation)
        .options(lazyload("*"))
        .where(KnowledgeElementRelation.id == relation_id)
    )
    relation = relation_result.scalar_one_or_none()
    if relation is None:
        raise not_found("Knowledge element relation", relation_id)

    source_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == payload.source_element_id)
    )
    source_element = source_result.scalar_one_or_none()
    if source_element is None:
        raise not_found("Knowledge element", payload.source_element_id)

    target_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == payload.target_element_id)
    )
    target_element = target_result.scalar_one_or_none()
    if target_element is None:
        raise not_found("Knowledge element", payload.target_element_id)

    if source_element.id == target_element.id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge element relation cannot point to itself.",
        )

    if source_element.discipline_id != target_element.discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge elements from different disciplines cannot be related.",
        )

    relation_definition_result = await session.execute(
        select(Relation)
        .options(lazyload("*"))
        .where(Relation.id == payload.relation_id)
    )
    relation_definition = relation_definition_result.scalar_one_or_none()
    if relation_definition is None:
        raise not_found("Relation", payload.relation_id)

    if not _is_allowed_relation(
        source_element.competence_type,
        target_element.competence_type,
        relation_definition.relation_type,
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                "Unsupported relation for the selected element pair. "
                "Allowed combinations: know->know, know->can (implements), "
                "can->master (automates)."
            ),
        )

    relation.source_element_id = payload.source_element_id
    relation.target_element_id = payload.target_element_id
    relation.relation_id = payload.relation_id
    relation.description = payload.description
    if source_element.discipline_id is not None:
        await bump_knowledge_graph_version(session, [source_element.discipline_id])
    await commit_or_409(session)
    return await _get_relation_for_read(session, relation.id)


@router.delete("/{relation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_element_relation(relation_id: UUID, session: DbSession) -> None:
    relation_result = await session.execute(
        select(KnowledgeElementRelation)
        .options(lazyload("*"))
        .where(KnowledgeElementRelation.id == relation_id)
    )
    relation = relation_result.scalar_one_or_none()
    if relation is None:
        raise not_found("Knowledge element relation", relation_id)
    source_result = await session.execute(
        select(KnowledgeElement)
        .options(lazyload("*"))
        .where(KnowledgeElement.id == relation.source_element_id)
    )
    source_element = source_result.scalar_one_or_none()
    discipline_id = source_element.discipline_id if source_element is not None else None
    await session.delete(relation)
    await flush_or_409(session)
    if discipline_id is not None:
        await bump_knowledge_graph_version(session, [discipline_id])
    await commit_or_409(session)
