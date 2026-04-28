from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import or_, select
from sqlalchemy.orm import lazyload

from app.api.deps import DbSession
from app.models import TopicDependency
from app.schemas import TopicDependencyRead


router = APIRouter(prefix="/topic-dependencies", tags=["Topic Dependencies"])


@router.get("/", response_model=list[TopicDependencyRead])
async def list_topic_dependencies(
    session: DbSession,
    topic_id: UUID | None = None,
) -> list[TopicDependency]:
    query = select(TopicDependency).options(lazyload("*"))
    if topic_id is not None:
        query = query.where(
            or_(
                TopicDependency.prerequisite_topic_id == topic_id,
                TopicDependency.dependent_topic_id == topic_id,
            )
        )
    result = await session.execute(query.order_by(TopicDependency.id))
    return list(result.scalars().all())
