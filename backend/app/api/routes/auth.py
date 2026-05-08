from uuid import UUID

from fastapi import APIRouter, Header, HTTPException, Response, status
from sqlalchemy import select

from app.api.deps import DbSession
from app.models import Admin, Expert, Student, Teacher
from app.schemas import AuthLoginRequest, AuthLoginResponse, AuthSessionRead
from app.services.session_store import SessionRole, session_store


router = APIRouter(prefix="/auth", tags=["Auth"])


ROLE_MODELS: dict[SessionRole, type[Admin] | type[Expert] | type[Teacher] | type[Student]] = {
    "admin": Admin,
    "expert": Expert,
    "teacher": Teacher,
    "student": Student,
}


async def build_login_response(
    *,
    role: SessionRole,
    user_id: UUID,
    display_name: str,
    login: str,
) -> AuthLoginResponse:
    auth_session = await session_store.create(
        role=role,
        user_id=user_id,
        display_name=display_name,
        login=login,
    )
    return AuthLoginResponse(
        role=role,
        user_id=user_id,
        display_name=display_name,
        login=login,
        session_id=auth_session.session_id,
    )


@router.post("/login", response_model=AuthLoginResponse)
async def login(payload: AuthLoginRequest, session: DbSession) -> AuthLoginResponse:
    admin_result = await session.execute(
        select(Admin.id, Admin.name, Admin.login).where(
            Admin.login == payload.login,
            Admin.password == payload.password,
            Admin.is_active.is_(True),
        )
    )
    admin_row = admin_result.one_or_none()
    if admin_row is not None:
        return await build_login_response(
            role="admin",
            user_id=admin_row.id,
            display_name=admin_row.name,
            login=admin_row.login,
        )

    expert_result = await session.execute(
        select(Expert.id, Expert.name, Expert.login).where(
            Expert.login == payload.login,
            Expert.password == payload.password,
            Expert.is_active.is_(True),
        )
    )
    expert_row = expert_result.one_or_none()
    if expert_row is not None:
        return await build_login_response(
            role="expert",
            user_id=expert_row.id,
            display_name=expert_row.name,
            login=expert_row.login,
        )

    teacher_result = await session.execute(
        select(Teacher.id, Teacher.name, Teacher.login).where(
            Teacher.login == payload.login,
            Teacher.password == payload.password,
            Teacher.is_active.is_(True),
        )
    )
    teacher_row = teacher_result.one_or_none()
    if teacher_row is not None:
        return await build_login_response(
            role="teacher",
            user_id=teacher_row.id,
            display_name=teacher_row.name,
            login=teacher_row.login,
        )

    student_result = await session.execute(
        select(Student.id, Student.name, Student.login).where(
            Student.login == payload.login,
            Student.password == payload.password,
            Student.is_active.is_(True),
        )
    )
    student_row = student_result.one_or_none()
    if student_row is not None:
        return await build_login_response(
            role="student",
            user_id=student_row.id,
            display_name=student_row.name,
            login=student_row.login,
        )

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Неверный логин или пароль.",
    )


@router.get("/session", response_model=AuthSessionRead)
async def get_current_session(
    session: DbSession,
    x_session_id: str | None = Header(default=None),
) -> AuthSessionRead:
    auth_session = await session_store.get(x_session_id)
    if auth_session is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Сессия не найдена. Выполните вход заново.",
        )

    user_id = UUID(auth_session.user_id)
    owner_model = ROLE_MODELS[auth_session.role]
    owner_result = await session.execute(
        select(owner_model.is_active).where(owner_model.id == user_id)
    )
    if owner_result.scalar_one_or_none() is not True:
        await session_store.delete(x_session_id)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Профиль отключен. Обратитесь к администратору.",
        )

    return AuthSessionRead(
        role=auth_session.role,
        user_id=user_id,
        display_name=auth_session.display_name,
        login=auth_session.login,
        expires_at=auth_session.expires_at,
    )


@router.delete("/session", status_code=status.HTTP_204_NO_CONTENT)
async def logout(
    response: Response,
    x_session_id: str | None = Header(default=None),
) -> None:
    await session_store.delete(x_session_id)
    response.status_code = status.HTTP_204_NO_CONTENT
