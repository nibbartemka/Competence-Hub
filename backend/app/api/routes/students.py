from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import select

from app.api.crud import commit_or_409, not_found
from app.api.deps import DbSession
from app.models import Group, Student, Subgroup
from app.schemas import StudentCreate, StudentRead


router = APIRouter(prefix="/students", tags=["Students"])


@router.get("/", response_model=list[StudentRead])
async def list_students(
    session: DbSession,
    group_id: UUID | None = None,
) -> list[Student]:
    query = select(Student).order_by(Student.name)
    if group_id is not None:
        query = query.where(Student.group_id == group_id)
    result = await session.execute(query)
    return list(result.scalars().all())


@router.post("/", response_model=StudentRead, status_code=status.HTTP_201_CREATED)
async def create_student(payload: StudentCreate, session: DbSession) -> Student:
    group = await session.get(Group, payload.group_id)
    if group is None:
        raise not_found("Group", payload.group_id)

    if payload.subgroup_id is not None:
        subgroup = await session.get(Subgroup, payload.subgroup_id)
        if subgroup is None:
            raise not_found("Subgroup", payload.subgroup_id)

    student = Student(
        name=payload.name,
        group_id=payload.group_id,
        subgroup_id=payload.subgroup_id,
    )
    session.add(student)
    await commit_or_409(session)
    await session.refresh(student)
    return student


@router.get("/{student_id}", response_model=StudentRead)
async def get_student(student_id: UUID, session: DbSession) -> Student:
    student = await session.get(Student, student_id)
    if student is None:
        raise not_found("Student", student_id)
    return student
