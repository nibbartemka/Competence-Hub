from uuid import UUID

from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import Group, Subgroup
from app.schemas import GroupCreate, GroupRead, SubgroupCreate, SubgroupRead


router = APIRouter(prefix="/groups", tags=["Groups"])


@router.get("/", response_model=list[GroupRead])
async def list_groups(session: DbSession) -> list[GroupRead]:
    result = await session.execute(select(Group.id, Group.name).order_by(Group.name))
    return [GroupRead(id=group_id, name=name) for group_id, name in result.all()]


@router.post("/", response_model=GroupRead, status_code=status.HTTP_201_CREATED)
async def create_group(payload: GroupCreate, session: DbSession) -> GroupRead:
    group = Group(name=payload.name)
    session.add(group)
    await commit_or_409(session)
    await session.refresh(group)
    return GroupRead(id=group.id, name=group.name)


@router.get("/{group_id}", response_model=GroupRead)
async def get_group(group_id: UUID, session: DbSession) -> GroupRead:
    result = await session.execute(select(Group.id, Group.name).where(Group.id == group_id))
    row = result.one_or_none()
    if row is None:
        raise not_found("Group", group_id)
    return GroupRead(id=row.id, name=row.name)


@router.get("/{group_id}/subgroups", response_model=list[SubgroupRead])
async def list_group_subgroups(
    group_id: UUID,
    session: DbSession,
) -> list[SubgroupRead]:
    group_exists = await session.execute(select(Group.id).where(Group.id == group_id))
    if group_exists.scalar_one_or_none() is None:
        raise not_found("Group", group_id)

    result = await session.execute(
        select(Subgroup.id, Subgroup.group_id, Subgroup.subgroup_num)
        .where(Subgroup.group_id == group_id)
        .order_by(Subgroup.subgroup_num)
    )
    return [
        SubgroupRead(id=subgroup_id, group_id=row_group_id, subgroup_num=subgroup_num)
        for subgroup_id, row_group_id, subgroup_num in result.all()
    ]


@router.post(
    "/{group_id}/subgroups",
    response_model=SubgroupRead,
    status_code=status.HTTP_201_CREATED,
)
async def create_group_subgroup(
    group_id: UUID,
    payload: SubgroupCreate,
    session: DbSession,
) -> SubgroupRead:
    if payload.group_id != group_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Payload group_id must match URL group_id.",
        )

    group_exists = await session.execute(select(Group.id).where(Group.id == group_id))
    if group_exists.scalar_one_or_none() is None:
        raise not_found("Group", group_id)

    subgroup = Subgroup(group_id=group_id, subgroup_num=payload.subgroup_num)
    session.add(subgroup)
    await commit_or_409(session)
    await session.refresh(subgroup)
    return SubgroupRead(
        id=subgroup.id,
        group_id=subgroup.group_id,
        subgroup_num=subgroup.subgroup_num,
    )
