from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import Expert, ExpertDiscipline
from app.schemas import ExpertCreate, ExpertRead, ExpertUpdate


router = APIRouter(prefix="/experts", tags=["Experts"])


async def get_expert_model(expert_id: UUID, session: DbSession) -> Expert:
    expert = await session.get(Expert, expert_id)
    if expert is None:
        raise not_found("Expert", expert_id)
    return expert


async def _build_expert_reads(
    rows: list[tuple[UUID, str, str]],
    session: DbSession,
) -> list[ExpertRead]:
    if not rows:
        return []

    expert_ids = [row[0] for row in rows]
    links_result = await session.execute(
        select(
            ExpertDiscipline.expert_id,
            ExpertDiscipline.discipline_id,
        ).where(ExpertDiscipline.expert_id.in_(expert_ids))
    )
    discipline_ids_by_expert: dict[UUID, list[UUID]] = {
        expert_id: [] for expert_id in expert_ids
    }
    for expert_id, discipline_id in links_result.all():
        discipline_ids_by_expert.setdefault(expert_id, []).append(discipline_id)

    return [
        ExpertRead(
            id=expert_id,
            name=name,
            login=login,
            discipline_ids=discipline_ids_by_expert.get(expert_id, []),
        )
        for expert_id, name, login in rows
    ]


@router.get("/", response_model=list[ExpertRead])
async def list_experts(session: DbSession) -> list[ExpertRead]:
    result = await session.execute(
        select(Expert.id, Expert.name, Expert.login).order_by(Expert.name)
    )
    return await _build_expert_reads(list(result.all()), session)


@router.post("/", response_model=ExpertRead, status_code=status.HTTP_201_CREATED)
async def create_expert(payload: ExpertCreate, session: DbSession) -> ExpertRead:
    expert = Expert(name=payload.name, login=payload.login, password=payload.password)
    session.add(expert)
    await commit_or_409(session)
    await session.refresh(expert)
    return (await _build_expert_reads([(expert.id, expert.name, expert.login)], session))[0]


@router.get("/{expert_id}", response_model=ExpertRead)
async def get_expert(expert_id: UUID, session: DbSession) -> ExpertRead:
    expert = await get_expert_model(expert_id, session)
    return (await _build_expert_reads([(expert.id, expert.name, expert.login)], session))[0]


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
    return (await _build_expert_reads([(expert.id, expert.name, expert.login)], session))[0]


@router.delete("/{expert_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_expert(expert_id: UUID, session: DbSession) -> None:
    expert = await get_expert_model(expert_id, session)
    await delete_and_commit(session, expert)
