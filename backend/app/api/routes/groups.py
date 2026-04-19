from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import Group
from app.schemas import GroupCreate, GroupRead


router = APIRouter(prefix="/groups", tags=["Groups"])


@router.get("/", response_model=list[GroupRead])
async def list_groups(session: DbSession) -> list[Group]:
    result = await session.execute(select(Group).order_by(Group.name))
    return list(result.scalars().all())


@router.post("/", response_model=GroupRead, status_code=status.HTTP_201_CREATED)
async def create_group(payload: GroupCreate, session: DbSession) -> Group:
    group = Group(name=payload.name)
    session.add(group)
    await commit_or_409(session)
    await session.refresh(group)
    return group


@router.get("/{group_id}", response_model=GroupRead)
async def get_group(group_id: UUID, session: DbSession) -> Group:
    group = await session.get(Group, group_id)
    if group is None:
        raise not_found("Group", group_id)
    return group
