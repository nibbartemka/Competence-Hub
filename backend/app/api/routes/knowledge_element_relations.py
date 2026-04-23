from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import or_, select

from app.api.crud import commit_or_409, flush_or_409, not_found
from app.api.deps import DbSession
from app.models import KnowledgeElement, KnowledgeElementRelation
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

    if source_element.discipline_id != target_element.discipline_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Knowledge elements from different disciplines cannot be related.",
        )

    if not _is_allowed_relation(
        source_element.competence_type,
        target_element.competence_type,
        payload.relation_type,
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
        relation_type=payload.relation_type,
        description=payload.description,
    )
    session.add(relation)
    await flush_or_409(session)
    if source_element.discipline_id is not None:
        await bump_knowledge_graph_version(session, [source_element.discipline_id])
    await commit_or_409(session)
    await session.refresh(relation)
    return relation


@router.put("/{relation_id}", response_model=KnowledgeElementRelationRead)
async def update_knowledge_element_relation(
    relation_id: UUID,
    payload: KnowledgeElementRelationUpdate,
    session: DbSession,
) -> KnowledgeElementRelation:
    relation = await session.get(KnowledgeElementRelation, relation_id)
    if relation is None:
        raise not_found("Knowledge element relation", relation_id)

    source_element = await session.get(KnowledgeElement, payload.source_element_id)
    if source_element is None:
        raise not_found("Knowledge element", payload.source_element_id)

    target_element = await session.get(KnowledgeElement, payload.target_element_id)
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

    if not _is_allowed_relation(
        source_element.competence_type,
        target_element.competence_type,
        payload.relation_type,
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
    relation.relation_type = payload.relation_type
    relation.description = payload.description
    if source_element.discipline_id is not None:
        await bump_knowledge_graph_version(session, [source_element.discipline_id])
    await commit_or_409(session)
    await session.refresh(relation)
    return relation


@router.delete("/{relation_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_knowledge_element_relation(relation_id: UUID, session: DbSession) -> None:
    relation = await session.get(KnowledgeElementRelation, relation_id)
    if relation is None:
        raise not_found("Knowledge element relation", relation_id)
    source_element = await session.get(KnowledgeElement, relation.source_element_id)
    discipline_id = source_element.discipline_id if source_element is not None else None
    await session.delete(relation)
    await flush_or_409(session)
    if discipline_id is not None:
        await bump_knowledge_graph_version(session, [discipline_id])
    await commit_or_409(session)
