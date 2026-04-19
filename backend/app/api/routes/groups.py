from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import Group, Subgroup
from app.schemas import GroupCreate, GroupRead, SubgroupCreate, SubgroupRead


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


@router.get("/{group_id}/subgroups", response_model=list[SubgroupRead])
async def list_group_subgroups(
    group_id: UUID,
    session: DbSession,
) -> list[Subgroup]:
    group = await session.get(Group, group_id)
    if group is None:
        raise not_found("Group", group_id)

    result = await session.execute(
        select(Subgroup)
        .where(Subgroup.group_id == group_id)
        .order_by(Subgroup.subgroup_num)
    )
    return list(result.scalars().all())


@router.post(
    "/{group_id}/subgroups",
    response_model=SubgroupRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_group_subgroup(
    group_id: UUID,
    payload: SubgroupCreate,
    session: DbSession,
) -> Subgroup:
    if payload.group_id != group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload group_id must match URL group_id.",
        )

    group = await session.get(Group, group_id)
    if group is None:
        raise not_found("Group", group_id)

    subgroup = Subgroup(group_id=group_id, subgroup_num=payload.subgroup_num)
    session.add(subgroup)
    await commit_or_409(session)
    await session.refresh(subgroup)
    return subgroup
