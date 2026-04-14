from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api import crud
from app.api.deps import get_current_user, require_roles
from app.core.db import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.theme_element import ThemeElementCreate, ThemeElementRead


router = APIRouter(tags=["theme-elements"])


@router.get("/themes/{theme_id}/elements", response_model=list[ThemeElementRead])
def list_theme_elements(
    theme_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[ThemeElementRead]:
    return crud.list_theme_elements_by_theme(db, theme_id)


@router.post(
    "/themes/{theme_id}/elements",
    response_model=ThemeElementRead,
    status_code=status.HTTP_201_CREATED,
)
def create_theme_element(
    theme_id: int,
    payload: ThemeElementCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.EXPERT)),
) -> ThemeElementRead:
    return crud.create_theme_element(db, theme_id, payload)
