from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import Group, Teacher, TeacherGroup
from app.schemas import TeacherCreate, TeacherRead


router = APIRouter(prefix="/teachers", tags=["Teachers"])


def _teacher_read_options():
    return (
        selectinload(Teacher.discipline_links),
        selectinload(Teacher.group_links),
    )


async def get_teacher_for_read(teacher_id: UUID, session: DbSession) -> Teacher:
    result = await session.execute(
        select(Teacher)
        .options(*_teacher_read_options())
        .where(Teacher.id == teacher_id)
    )
    teacher = result.scalar_one_or_none()
    if teacher is None:
        raise not_found("Teacher", teacher_id)
    return teacher


@router.get("/", response_model=list[TeacherRead])
async def list_teachers(session: DbSession) -> list[Teacher]:
    result = await session.execute(
        select(Teacher)
        .options(*_teacher_read_options())
        .order_by(Teacher.name)
    )
    return list(result.scalars().all())


@router.post("/", response_model=TeacherRead, status_code=status.HTTP_201_CREATED)
async def create_teacher(payload: TeacherCreate, session: DbSession) -> Teacher:
    teacher = Teacher(name=payload.name)
    session.add(teacher)

    group_ids = list(dict.fromkeys(payload.group_ids))
    for group_id in group_ids:
        group = await session.get(Group, group_id)
        if group is None:
            raise not_found("Group", group_id)

    await session.flush()
    for group_id in group_ids:
        session.add(TeacherGroup(teacher_id=teacher.id, group_id=group_id))

    await commit_or_409(session)
    return await get_teacher_for_read(teacher.id, session)


@router.get("/{teacher_id}", response_model=TeacherRead)
async def get_teacher(teacher_id: UUID, session: DbSession) -> Teacher:
    return await get_teacher_for_read(teacher_id, session)
