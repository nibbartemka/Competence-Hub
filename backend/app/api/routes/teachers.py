from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import Group, Teacher, TeacherDiscipline, TeacherGroup
from app.schemas import TeacherCreate, TeacherRead


router = APIRouter(prefix="/teachers", tags=["Teachers"])


async def _build_teacher_reads(
    rows: list[tuple[UUID, str, str]],
    session: DbSession,
) -> list[TeacherRead]:
    if not rows:
        return []

    teacher_ids = [row[0] for row in rows]
    discipline_links_result = await session.execute(
        select(
            TeacherDiscipline.teacher_id,
            TeacherDiscipline.discipline_id,
        ).where(TeacherDiscipline.teacher_id.in_(teacher_ids))
    )
    group_links_result = await session.execute(
        select(
            TeacherGroup.teacher_id,
            TeacherGroup.group_id,
        ).where(TeacherGroup.teacher_id.in_(teacher_ids))
    )

    discipline_ids_by_teacher: dict[UUID, list[UUID]] = {
        teacher_id: [] for teacher_id in teacher_ids
    }
    group_ids_by_teacher: dict[UUID, list[UUID]] = {
        teacher_id: [] for teacher_id in teacher_ids
    }

    for teacher_id, discipline_id in discipline_links_result.all():
        discipline_ids_by_teacher.setdefault(teacher_id, []).append(discipline_id)
    for teacher_id, group_id in group_links_result.all():
        group_ids_by_teacher.setdefault(teacher_id, []).append(group_id)

    return [
        TeacherRead(
            id=teacher_id,
            name=name,
            login=login,
            discipline_ids=discipline_ids_by_teacher.get(teacher_id, []),
            group_ids=group_ids_by_teacher.get(teacher_id, []),
        )
        for teacher_id, name, login in rows
    ]


async def get_teacher_for_read(teacher_id: UUID, session: DbSession) -> TeacherRead:
    result = await session.execute(
        select(Teacher.id, Teacher.name, Teacher.login).where(Teacher.id == teacher_id)
    )
    row = result.one_or_none()
    if row is None:
        raise not_found("Teacher", teacher_id)
    return (await _build_teacher_reads([row], session))[0]


@router.get("/", response_model=list[TeacherRead])
async def list_teachers(session: DbSession) -> list[TeacherRead]:
    result = await session.execute(
        select(Teacher.id, Teacher.name, Teacher.login).order_by(Teacher.name)
    )
    return await _build_teacher_reads(list(result.all()), session)


@router.post("/", response_model=TeacherRead, status_code=status.HTTP_201_CREATED)
async def create_teacher(payload: TeacherCreate, session: DbSession) -> TeacherRead:
    teacher = Teacher(name=payload.name, login=payload.login, password=payload.password)
    session.add(teacher)

    group_ids = list(dict.fromkeys(payload.group_ids))
    for group_id in group_ids:
        group_exists = await session.execute(select(Group.id).where(Group.id == group_id))
        if group_exists.scalar_one_or_none() is None:
            raise not_found("Group", group_id)

    await session.flush()
    for group_id in group_ids:
        session.add(TeacherGroup(teacher_id=teacher.id, group_id=group_id))

    await commit_or_409(session)
    return await get_teacher_for_read(teacher.id, session)


@router.get("/{teacher_id}", response_model=TeacherRead)
async def get_teacher(teacher_id: UUID, session: DbSession) -> TeacherRead:
    return await get_teacher_for_read(teacher_id, session)
