from sqlalchemy import inspect, select, text

from app.core.db import Base, SessionLocal, engine
from app.core.security import hash_password
from app.models.user import User
from app.models.enums import UserRole


DEFAULT_USERS = (
    {
        "username": "expert",
        "password": "expert123",
        "full_name": "Системный эксперт",
        "role": UserRole.EXPERT,
    },
    {
        "username": "teacher",
        "password": "teacher123",
        "full_name": "Системный преподаватель",
        "role": UserRole.TEACHER,
    },
    {
        "username": "student",
        "password": "student123",
        "full_name": "Системный студент",
        "role": UserRole.STUDENT,
    },
)


def initialize_database() -> None:
    Base.metadata.create_all(bind=engine)
    migrate_existing_tables()
    seed_default_users()


def migrate_existing_tables() -> None:
    inspector = inspect(engine)
    migration_commands: list[str] = []

    if inspector.has_table("theme_elements"):
        theme_element_columns = {
            column["name"] for column in inspector.get_columns("theme_elements")
        }
        if "is_required" not in theme_element_columns:
            migration_commands.append(
                "ALTER TABLE theme_elements ADD COLUMN is_required BOOLEAN NOT NULL DEFAULT 1"
            )
        if "assessment_format" not in theme_element_columns:
            migration_commands.append(
                "ALTER TABLE theme_elements ADD COLUMN assessment_format VARCHAR(32)"
            )
        if "parent_element_id" not in theme_element_columns:
            migration_commands.append(
                "ALTER TABLE theme_elements ADD COLUMN parent_element_id INTEGER"
            )

    if inspector.has_table("users"):
        user_columns = {column["name"] for column in inspector.get_columns("users")}
        if "birth_date" not in user_columns:
            migration_commands.append("ALTER TABLE users ADD COLUMN birth_date DATE")

    if migration_commands:
        with engine.begin() as connection:
            for command in migration_commands:
                connection.execute(text(command))


def seed_default_users() -> None:
    with SessionLocal() as db:
        for payload in DEFAULT_USERS:
            existing = db.scalar(select(User).where(User.username == payload["username"]))
            if existing is not None:
                continue

            user = User(
                username=payload["username"],
                full_name=payload["full_name"],
                role=payload["role"],
                password_hash=hash_password(payload["password"]),
            )
            db.add(user)

        db.commit()
