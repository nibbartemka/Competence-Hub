from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api import crud
from app.api.deps import get_current_user, require_roles
from app.core.db import get_db
from app.models.enums import UserRole
from app.models.user import User
from app.schemas.discipline import DisciplineCreate, DisciplineRead


router = APIRouter(prefix="/disciplines", tags=["disciplines"])


@router.get("", response_model=list[DisciplineRead])
def list_disciplines(
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> list[DisciplineRead]:
    return crud.list_disciplines(db)


@router.post(
    "",
    response_model=DisciplineRead,
    status_code=status.HTTP_201_CREATED,
)
def create_discipline(
    payload: DisciplineCreate,
    db: Session = Depends(get_db),
    _: User = Depends(require_roles(UserRole.EXPERT)),
) -> DisciplineRead:
    return crud.create_discipline(db, payload)


@router.get("/{discipline_id}", response_model=DisciplineRead)
def get_discipline(
    discipline_id: int,
    db: Session = Depends(get_db),
    _: User = Depends(get_current_user),
) -> DisciplineRead:
    return crud.get_discipline_or_404(db, discipline_id)
