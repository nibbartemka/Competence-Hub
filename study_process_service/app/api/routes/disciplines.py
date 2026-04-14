from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import Discipline
from app.schemas import DisciplineCreate, DisciplineRead


router = APIRouter(prefix="/disciplines", tags=["Disciplines"])


@router.get("/", response_model=list[DisciplineRead])
async def list_disciplines(session: DbSession) -> list[Discipline]:
    result = await session.execute(select(Discipline).order_by(Discipline.name))
    return list(result.scalars().all())


@router.post("/", response_model=DisciplineRead, status_code=status.HTTP_201_CREATED)
async def create_discipline(payload: DisciplineCreate, session: DbSession) -> Discipline:
    discipline = Discipline(name=payload.name)
    session.add(discipline)
    await commit_or_409(session)
    await session.refresh(discipline)
    return discipline


@router.get("/{discipline_id}", response_model=DisciplineRead)
async def get_discipline(discipline_id: UUID, session: DbSession) -> Discipline:
    discipline = await session.get(Discipline, discipline_id)
    if discipline is None:
        raise not_found("Discipline", discipline_id)
    return discipline


@router.delete("/{discipline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_discipline(discipline_id: UUID, session: DbSession) -> None:
    discipline = await session.get(Discipline, discipline_id)
    if discipline is None:
        raise not_found("Discipline", discipline_id)
    await delete_and_commit(session, discipline)
