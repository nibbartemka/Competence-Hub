from fastapi import HTTPException, status
from sqlalchemy import case, delete, select
from sqlalchemy.orm import Session

from app.models.discipline import Discipline
from app.models.enums import CompetencyType, UserRole
from app.models.teacher_theme_selection import TeacherThemeSelection
from app.models.theme import Theme
from app.models.theme_element import ThemeElement
from app.models.user import User
from app.core.security import generate_token, hash_password, verify_password
from app.schemas.auth import LoginRequest, RegisterRequest
from app.schemas.discipline import DisciplineCreate
from app.schemas.teacher import TeacherThemeSelectionUpdate
from app.schemas.theme import ThemeCreate
from app.schemas.theme_element import ThemeElementCreate


def authenticate_user(db: Session, payload: LoginRequest) -> tuple[User, str]:
    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid username or password.",
        )

    token = generate_token()
    user.auth_token = token
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, token


def register_user(db: Session, payload: RegisterRequest) -> tuple[User, str, str]:
    username = payload.username.strip()
    raw_password = payload.password

    existing = db.scalar(select(User).where(User.username == username))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username is already taken.",
        )

    user = User(
        username=username,
        full_name=payload.full_name.strip(),
        birth_date=payload.birth_date,
        role=payload.role,
        password_hash=hash_password(raw_password),
        auth_token=None,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user, username, raw_password


def is_username_available(
    db: Session,
    username: str,
    *,
    exclude_user_id: int | None = None,
) -> bool:
    normalized = username.strip()
    if not normalized:
        return False

    query = select(User.id).where(User.username == normalized)
    existing_id = db.scalar(query)
    if existing_id is None:
        return True
    if exclude_user_id is not None and existing_id == exclude_user_id:
        return True
    return False


def update_user_profile(
    db: Session,
    user: User,
    *,
    full_name: str,
    birth_date,
    username: str,
    password: str | None,
) -> User:
    normalized_username = username.strip()
    existing = db.scalar(select(User).where(User.username == normalized_username))
    if existing is not None and existing.id != user.id:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Username is already taken.",
        )

    user.full_name = full_name.strip()
    user.birth_date = birth_date
    user.username = normalized_username
    if password:
        user.password_hash = hash_password(password)
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def logout_user(db: Session, user: User) -> None:
    user.auth_token = None
    db.add(user)
    db.commit()


def list_disciplines(db: Session) -> list[Discipline]:
    return list(db.scalars(select(Discipline).order_by(Discipline.name)))


def get_discipline_or_404(db: Session, discipline_id: int) -> Discipline:
    discipline = db.get(Discipline, discipline_id)
    if discipline is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Discipline not found.",
        )
    return discipline


def create_discipline(db: Session, payload: DisciplineCreate) -> Discipline:
    existing = db.scalar(select(Discipline).where(Discipline.name == payload.name))
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Discipline with this name already exists.",
        )

    discipline = Discipline(**payload.model_dump())
    db.add(discipline)
    db.commit()
    db.refresh(discipline)
    return discipline


def list_themes_by_discipline(db: Session, discipline_id: int) -> list[Theme]:
    get_discipline_or_404(db, discipline_id)
    query = (
        select(Theme)
        .where(Theme.discipline_id == discipline_id)
        .order_by(Theme.order_index, Theme.id)
    )
    return list(db.scalars(query))


def get_theme_or_404(db: Session, theme_id: int) -> Theme:
    theme = db.get(Theme, theme_id)
    if theme is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Theme not found.",
        )
    return theme


def create_theme(db: Session, discipline_id: int, payload: ThemeCreate) -> Theme:
    get_discipline_or_404(db, discipline_id)

    theme = Theme(discipline_id=discipline_id, **payload.model_dump())
    db.add(theme)
    db.commit()
    db.refresh(theme)
    return theme


def list_theme_elements_by_theme(db: Session, theme_id: int) -> list[ThemeElement]:
    get_theme_or_404(db, theme_id)
    competency_order = case(
        (ThemeElement.competency_type == "know", 1),
        (ThemeElement.competency_type == "can", 2),
        (ThemeElement.competency_type == "master", 3),
        else_=99,
    )
    query = (
        select(ThemeElement)
        .where(ThemeElement.theme_id == theme_id)
        .order_by(competency_order, ThemeElement.id)
    )
    return list(db.scalars(query))


def create_theme_element(db: Session, theme_id: int, payload: ThemeElementCreate) -> ThemeElement:
    get_theme_or_404(db, theme_id)

    parent_element = None
    if payload.parent_element_id is not None:
        parent_element = db.get(ThemeElement, payload.parent_element_id)
        if parent_element is None or parent_element.theme_id != theme_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Parent element must belong to the same theme.",
            )

    if payload.competency_type == CompetencyType.KNOW:
        if parent_element is not None and parent_element.competency_type != CompetencyType.KNOW:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A 'know' element can only be linked to another 'know' element.",
            )
    elif payload.competency_type == CompetencyType.CAN:
        if parent_element is None or parent_element.competency_type != CompetencyType.KNOW:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A 'can' element must be linked to a 'know' element.",
            )
    elif payload.competency_type == CompetencyType.MASTER:
        if parent_element is None or parent_element.competency_type != CompetencyType.CAN:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="A 'master' element must be linked to a 'can' element.",
            )

    element = ThemeElement(
        theme_id=theme_id,
        title=payload.title,
        description=payload.description,
        is_required=payload.is_required,
        competency_type=payload.competency_type,
        assessment_format=payload.assessment_format,
        parent_element_id=payload.parent_element_id,
    )
    db.add(element)
    db.commit()
    db.refresh(element)
    return element


def get_teacher_selection(
    db: Session,
    teacher_id: int,
    discipline_id: int,
) -> list[int]:
    get_discipline_or_404(db, discipline_id)
    query = (
        select(TeacherThemeSelection.theme_id)
        .join(Theme, Theme.id == TeacherThemeSelection.theme_id)
        .where(
            TeacherThemeSelection.teacher_id == teacher_id,
            Theme.discipline_id == discipline_id,
        )
        .order_by(Theme.order_index, Theme.id)
    )
    return list(db.scalars(query))


def save_teacher_selection(
    db: Session,
    teacher: User,
    discipline_id: int,
    payload: TeacherThemeSelectionUpdate,
) -> list[int]:
    if teacher.role != UserRole.TEACHER:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Only teachers can save theme selections.",
        )

    get_discipline_or_404(db, discipline_id)

    requested_ids = sorted(set(payload.selected_theme_ids))
    if requested_ids:
        valid_ids = set(
            db.scalars(
                select(Theme.id).where(
                    Theme.discipline_id == discipline_id,
                    Theme.id.in_(requested_ids),
                )
            )
        )
        if valid_ids != set(requested_ids):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Selection contains themes outside the chosen discipline.",
            )

    existing_ids = list(
        db.scalars(
            select(TeacherThemeSelection.theme_id)
            .join(Theme, Theme.id == TeacherThemeSelection.theme_id)
            .where(
                TeacherThemeSelection.teacher_id == teacher.id,
                Theme.discipline_id == discipline_id,
            )
        )
    )

    if existing_ids:
        db.execute(
            delete(TeacherThemeSelection).where(
                TeacherThemeSelection.teacher_id == teacher.id,
                TeacherThemeSelection.theme_id.in_(existing_ids),
            )
        )

    for theme_id in requested_ids:
        db.add(TeacherThemeSelection(teacher_id=teacher.id, theme_id=theme_id))

    db.commit()
    return requested_ids
