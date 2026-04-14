from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api import crud
from app.api.deps import require_roles
from app.core.db import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.teacher import TeacherThemeSelectionRead, TeacherThemeSelectionUpdate


router = APIRouter(prefix="/teacher", tags=["teacher"])


@router.get(
    "/disciplines/{discipline_id}/theme-selection",
    response_model=TeacherThemeSelectionRead,
)
def get_theme_selection(
    discipline_id: int,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TEACHER)),
) -> TeacherThemeSelectionRead:
    selected_theme_ids = crud.get_teacher_selection(db, current_user.id, discipline_id)
    return TeacherThemeSelectionRead(
        discipline_id=discipline_id,
        selected_theme_ids=selected_theme_ids,
    )


@router.put(
    "/disciplines/{discipline_id}/theme-selection",
    response_model=TeacherThemeSelectionRead,
)
def save_theme_selection(
    discipline_id: int,
    payload: TeacherThemeSelectionUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.TEACHER)),
) -> TeacherThemeSelectionRead:
    selected_theme_ids = crud.save_teacher_selection(db, current_user, discipline_id, payload)
    return TeacherThemeSelectionRead(
        discipline_id=discipline_id,
        selected_theme_ids=selected_theme_ids,
    )
