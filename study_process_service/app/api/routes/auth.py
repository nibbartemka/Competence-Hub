from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.orm import Session

from app.api import crud
from app.api.deps import get_current_user
from app.core.db import get_db
from app.models.user import User
from app.schemas.auth import (
    LoginRequest,
    LoginResponse,
    ProfileUpdateRequest,
    RegisterRequest,
    RegisterResponse,
    UserRead,
    UsernameAvailabilityResponse,
)


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/login", response_model=LoginResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)) -> LoginResponse:
    user, token = crud.authenticate_user(db, payload)
    return LoginResponse(token=token, user=user)


@router.post("/register", response_model=RegisterResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)) -> RegisterResponse:
    user, username, password = crud.register_user(db, payload)
    return RegisterResponse(user=user, username=username, password=password)


@router.get("/username-availability", response_model=UsernameAvailabilityResponse)
def username_availability(
    username: str = Query(min_length=3, max_length=64),
    db: Session = Depends(get_db),
) -> UsernameAvailabilityResponse:
    return UsernameAvailabilityResponse(
        available=crud.is_username_available(db, username),
    )


@router.get("/me", response_model=UserRead)
def me(current_user: User = Depends(get_current_user)) -> UserRead:
    return current_user


@router.put("/profile", response_model=UserRead)
def update_profile(
    payload: ProfileUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> UserRead:
    return crud.update_user_profile(
        db,
        current_user,
        full_name=payload.full_name,
        birth_date=payload.birth_date,
        username=payload.username,
        password=payload.password,
    )


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
) -> Response:
    crud.logout_user(db, current_user)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
