from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import or_, select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import Topic, TopicDependency
from app.schemas import TopicDependencyCreate, TopicDependencyRead


router = APIRouter(prefix="/topic-dependencies", tags=["Topic Dependencies"])


@router.get("/", response_model=list[TopicDependencyRead])
async def list_topic_dependencies(
    session: DbSession,
    topic_id: UUID | None = None,
) -> list[TopicDependency]:
    query = select(TopicDependency)
    if topic_id is not None:
        query = query.where(
            or_(
                TopicDependency.prerequisite_topic_id == topic_id,
                TopicDependency.dependent_topic_id == topic_id,
            )
        )
    result = await session.execute(query.order_by(TopicDependency.id))
    return list(result.scalars().all())


@router.post("/", response_model=TopicDependencyRead, status_code=status.HTTP_201_CREATED)
async def create_topic_dependency(
    payload: TopicDependencyCreate,
    session: DbSession,
) -> TopicDependency:
    prerequisite_topic = await session.get(Topic, payload.prerequisite_topic_id)
    if prerequisite_topic is None:
        raise not_found("Topic", payload.prerequisite_topic_id)

    dependent_topic = await session.get(Topic, payload.dependent_topic_id)
    if dependent_topic is None:
        raise not_found("Topic", payload.dependent_topic_id)

    dependency = TopicDependency(
        prerequisite_topic_id=payload.prerequisite_topic_id,
        dependent_topic_id=payload.dependent_topic_id,
        description=payload.description,
    )
    session.add(dependency)
    await commit_or_409(session)
    await session.refresh(dependency)
    return dependency


@router.delete("/{dependency_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_topic_dependency(dependency_id: UUID, session: DbSession) -> None:
    dependency = await session.get(TopicDependency, dependency_id)
    if dependency is None:
        raise not_found("Topic dependency", dependency_id)
    await delete_and_commit(session, dependency)
