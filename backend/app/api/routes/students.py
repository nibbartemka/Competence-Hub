from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.models import Group, Student, Subgroup
from app.schemas import StudentCreate, StudentRead, StudentUpdate


router = APIRouter(prefix="/students", tags=["Students"])


@router.get("/", response_model=list[StudentRead])
async def list_students(
    session: DbSession,
    group_id: UUID | None = None,
) -> list[StudentRead]:
    query = select(
        Student.id,
        Student.name,
        Student.login,
        Student.is_active,
        Student.group_id,
        Student.subgroup_id,
    ).order_by(Student.name)
    if group_id is not None:
        query = query.where(Student.group_id == group_id)
    result = await session.execute(query)
    return [
        StudentRead(
            id=student_id,
            name=name,
            login=login,
            is_active=is_active,
            group_id=row_group_id,
            subgroup_id=subgroup_id,
        )
        for student_id, name, login, is_active, row_group_id, subgroup_id in result.all()
    ]


@router.post("/", response_model=StudentRead, status_code=status.HTTP_201_CREATED)
async def create_student(payload: StudentCreate, session: DbSession) -> StudentRead:
    group_exists = await session.execute(select(Group.id).where(Group.id == payload.group_id))
    if group_exists.scalar_one_or_none() is None:
        raise not_found("Group", payload.group_id)

    if payload.subgroup_id is not None:
        subgroup_exists = await session.execute(
            select(Subgroup.id).where(Subgroup.id == payload.subgroup_id)
        )
        if subgroup_exists.scalar_one_or_none() is None:
            raise not_found("Subgroup", payload.subgroup_id)

    student = Student(
        name=payload.name,
        login=payload.login,
        password=payload.password,
        group_id=payload.group_id,
        subgroup_id=payload.subgroup_id,
    )
    session.add(student)
    await commit_or_409(session)
    await session.refresh(student)
    return StudentRead(
        id=student.id,
        name=student.name,
        login=student.login,
        is_active=student.is_active,
        group_id=student.group_id,
        subgroup_id=student.subgroup_id,
    )


@router.get("/{student_id}", response_model=StudentRead)
async def get_student(student_id: UUID, session: DbSession) -> StudentRead:
    result = await session.execute(
        select(Student.id, Student.name, Student.group_id, Student.subgroup_id)
        .add_columns(Student.login, Student.is_active)
        .where(Student.id == student_id)
    )
    row = result.one_or_none()
    if row is None:
        raise not_found("Student", student_id)
    return StudentRead(
        id=row.id,
        name=row.name,
        login=row.login,
        is_active=row.is_active,
        group_id=row.group_id,
        subgroup_id=row.subgroup_id,
    )


@router.put("/{student_id}", response_model=StudentRead)
async def update_student(
    student_id: UUID,
    payload: StudentUpdate,
    session: DbSession,
) -> StudentRead:
    student = await session.get(Student, student_id)
    if student is None:
        raise not_found("Student", student_id)
    if payload.is_active is not None:
        student.is_active = payload.is_active
    await commit_or_409(session)
    await session.refresh(student)
    return StudentRead(
        id=student.id,
        name=student.name,
        login=student.login,
        is_active=student.is_active,
        group_id=student.group_id,
        subgroup_id=student.subgroup_id,
    )


@router.delete("/{student_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_student(student_id: UUID, session: DbSession) -> None:
    student = await session.get(Student, student_id)
    if student is None:
        raise not_found("Student", student_id)
    await delete_and_commit(session, student)
