from fastapi import APIRouter, HTTPException, status
from sqlalchemy import select

from app.api.deps import DbSession
from app.models import Admin, Expert, Student, Teacher
from app.schemas import AuthLoginRequest, AuthLoginResponse


router = APIRouter(prefix="/auth", tags=["Auth"])


@router.post("/login", response_model=AuthLoginResponse)
async def login(payload: AuthLoginRequest, session: DbSession) -> AuthLoginResponse:
    admin_result = await session.execute(
        select(Admin.id, Admin.name).where(
            Admin.login == payload.login,
            Admin.password == payload.password,
        )
    )
    admin_row = admin_result.one_or_none()
    if admin_row is not None:
        return AuthLoginResponse(
            role="admin",
            user_id=admin_row.id,
            display_name=admin_row.name,
        )

    expert_result = await session.execute(
        select(Expert.id, Expert.name).where(
            Expert.login == payload.login,
            Expert.password == payload.password,
        )
    )
    expert_row = expert_result.one_or_none()
    if expert_row is not None:
        return AuthLoginResponse(
            role="expert",
            user_id=expert_row.id,
            display_name=expert_row.name,
        )

    teacher_result = await session.execute(
        select(Teacher.id, Teacher.name).where(
            Teacher.login == payload.login,
            Teacher.password == payload.password,
        )
    )
    teacher_row = teacher_result.one_or_none()
    if teacher_row is not None:
        return AuthLoginResponse(
            role="teacher",
            user_id=teacher_row.id,
            display_name=teacher_row.name,
        )

    student_result = await session.execute(
        select(Student.id, Student.name).where(
            Student.login == payload.login,
            Student.password == payload.password,
        )
    )
    student_row = student_result.one_or_none()
    if student_row is not None:
        return AuthLoginResponse(
            role="student",
            user_id=student_row.id,
            display_name=student_row.name,
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверный логин или пароль.",
    )
