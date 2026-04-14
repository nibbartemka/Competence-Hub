from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api import crud
from app.api.deps import get_current_user, require_roles
from app.core.db import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.theme import ThemeCreate, ThemeRead


router = APIRouter(tags=["themes"])


@router.get("/disciplines/{discipline_id}/themes", response_model=list[ThemeRead])
def list_themes_by_discipline(
    discipline_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ThemeRead]:
    return crud.list_themes_by_discipline(db, discipline_id)


@router.post(
    "/disciplines/{discipline_id}/themes",
    response_model=ThemeRead,
    status_code=status.HTTP_201_CREATED,
)
def create_theme(
    discipline_id: int,
    payload: ThemeCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.EXPERT)),
) -> ThemeRead:
    return crud.create_theme(db, discipline_id, payload)


@router.get("/themes/{theme_id}", response_model=ThemeRead)
def get_theme(
    theme_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> ThemeRead:
    return crud.get_theme_or_404(db, theme_id)
