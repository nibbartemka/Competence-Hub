from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import Expert
from app.schemas import ExpertCreate, ExpertRead, ExpertUpdate


router = APIRouter(prefix="/experts", tags=["Experts"])


async def get_expert_model(expert_id: UUID, session: DbSession) -> Expert:
    expert = await session.get(Expert, expert_id)
    if expert is None:
        raise not_found("Expert", expert_id)
    return expert


@router.get("/", response_model=list[ExpertRead])
async def list_experts(session: DbSession) -> list[ExpertRead]:
    result = await session.execute(select(Expert).order_by(Expert.name))
    return [ExpertRead.model_validate(item) for item in result.scalars().all()]


@router.post("/", response_model=ExpertRead, status_code=status.HTTP_201_CREATED)
async def create_expert(payload: ExpertCreate, session: DbSession) -> ExpertRead:
    expert = Expert(name=payload.name, login=payload.login, password=payload.password)
    session.add(expert)
    await commit_or_409(session)
    await session.refresh(expert)
    return ExpertRead.model_validate(expert)


@router.get("/{expert_id}", response_model=ExpertRead)
async def get_expert(expert_id: UUID, session: DbSession) -> ExpertRead:
    return ExpertRead.model_validate(await get_expert_model(expert_id, session))


@router.put("/{expert_id}", response_model=ExpertRead)
async def update_expert(
    expert_id: UUID,
    payload: ExpertUpdate,
    session: DbSession,
) -> ExpertRead:
    expert = await get_expert_model(expert_id, session)
    if payload.name is not None:
        expert.name = payload.name
    if payload.login is not None:
        expert.login = payload.login
    if payload.password is not None:
        expert.password = payload.password
    await commit_or_409(session)
    await session.refresh(expert)
    return ExpertRead.model_validate(expert)


@router.delete("/{expert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expert(expert_id: UUID, session: DbSession) -> None:
    expert = await get_expert_model(expert_id, session)
    await delete_and_commit(session, expert)
