from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import Admin
from app.schemas import AdminCreate, AdminRead, AdminUpdate


router = APIRouter(prefix="/admins", tags=["Admins"])


async def get_admin_model(admin_id: UUID, session: DbSession) -> Admin:
    admin = await session.get(Admin, admin_id)
    if admin is None:
        raise not_found("Admin", admin_id)
    return admin


@router.get("/", response_model=list[AdminRead])
async def list_admins(session: DbSession) -> list[AdminRead]:
    result = await session.execute(select(Admin).order_by(Admin.name))
    return [AdminRead.model_validate(item) for item in result.scalars().all()]


@router.post("/", response_model=AdminRead, status_code=status.HTTP_201_CREATED)
async def create_admin(payload: AdminCreate, session: DbSession) -> AdminRead:
    admin = Admin(name=payload.name, login=payload.login, password=payload.password)
    session.add(admin)
    await commit_or_409(session)
    await session.refresh(admin)
    return AdminRead.model_validate(admin)


@router.get("/{admin_id}", response_model=AdminRead)
async def get_admin(admin_id: UUID, session: DbSession) -> AdminRead:
    return AdminRead.model_validate(await get_admin_model(admin_id, session))


@router.put("/{admin_id}", response_model=AdminRead)
async def update_admin(
    admin_id: UUID,
    payload: AdminUpdate,
    session: DbSession,
) -> AdminRead:
    admin = await get_admin_model(admin_id, session)
    if payload.name is not None:
        admin.name = payload.name
    if payload.login is not None:
        admin.login = payload.login
    if payload.password is not None:
        admin.password = payload.password
    await commit_or_409(session)
    await session.refresh(admin)
    return AdminRead.model_validate(admin)


@router.delete("/{admin_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_admin(admin_id: UUID, session: DbSession) -> None:
    admin = await get_admin_model(admin_id, session)
    await delete_and_commit(session, admin)
