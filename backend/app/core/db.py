from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    AsyncEngine,
    async_sessionmaker
)
from sqlalchemy.orm import declarative_base
from sqlalchemy import text

from .config import settings


__all__ = [
    'Base',
    'get_async_session',
    'init_db',
    'drop_db',
]


Base = declarative_base()

async_engine: AsyncEngine | None = None
AsyncSessionLocal: async_sessionmaker[AsyncSession] | None = None


def get_async_engine() -> AsyncEngine:
    global async_engine

    if async_engine is None:
        async_engine = create_async_engine(
            settings.SQLITE.async_DSN,
            pool_size=5,
            max_overflow=10,
            echo=False,
        )

    return async_engine


def get_async_session_maker() -> async_sessionmaker[AsyncSession]:
    global AsyncSessionLocal

    if AsyncSessionLocal is None:
        AsyncSessionLocal = async_sessionmaker(
            bind=get_async_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
            autocommit=False,
        )

    return AsyncSessionLocal


def _sqlite_has_column(connection, table_name: str, column_name: str) -> bool:
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return any(row[1] == column_name for row in rows)


def _sqlite_has_table(connection, table_name: str) -> bool:
    row = connection.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name = :table_name"
        ),
        {"table_name": table_name},
    ).fetchone()
    return row is not None


def _rebuild_students_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE students_new (
                id CHAR(32) NOT NULL,
                name VARCHAR(255) NOT NULL,
                group_id CHAR(32) NOT NULL,
                subgroup_id CHAR(32),
                PRIMARY KEY (id),
                FOREIGN KEY(group_id) REFERENCES groups (id) ON DELETE CASCADE,
                FOREIGN KEY(subgroup_id) REFERENCES subgroups (id) ON DELETE SET NULL
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO students_new (id, name, group_id, subgroup_id)
            SELECT id, name, group_id, subgroup_id
            FROM students
            """
        )
    )
    connection.execute(text("DROP TABLE students"))
    connection.execute(text("ALTER TABLE students_new RENAME TO students"))


def _rebuild_teacher_subgroups_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE teacher_subgroups_new (
                id CHAR(32) NOT NULL,
                teacher_id CHAR(32) NOT NULL,
                subgroup_id CHAR(32) NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT uq_teacher_subgroup_num UNIQUE (teacher_id, subgroup_id),
                FOREIGN KEY(teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
                FOREIGN KEY(subgroup_id) REFERENCES subgroups (id) ON DELETE CASCADE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT OR IGNORE INTO teacher_subgroups_new (id, teacher_id, subgroup_id)
            SELECT teacher_subgroups.id, teacher_subgroups.teacher_id, subgroups.id
            FROM teacher_subgroups
            JOIN subgroups ON subgroups.subgroup_num = teacher_subgroups.subgroup_num
            """
        )
    )
    connection.execute(text("DROP TABLE teacher_subgroups"))
    connection.execute(
        text("ALTER TABLE teacher_subgroups_new RENAME TO teacher_subgroups")
    )


def _sync_sqlite_schema(connection) -> None:
    # Keep local SQLite schema compatible with the current SQLAlchemy models.
    if not _sqlite_has_column(connection, "topics", "description"):
        connection.execute(text("ALTER TABLE topics ADD COLUMN description TEXT"))
    if not _sqlite_has_column(connection, "topic_knowledge_elements", "role"):
        connection.execute(
            text(
                "ALTER TABLE topic_knowledge_elements "
                "ADD COLUMN role TEXT NOT NULL DEFAULT 'formed'"
            )
        )
    if _sqlite_has_table(connection, "students") and _sqlite_has_column(
        connection, "students", "subgroup_num"
    ):
        _rebuild_students_table(connection)
    if _sqlite_has_table(connection, "teacher_subgroups"):
        if _sqlite_has_column(connection, "teacher_subgroups", "subgroup_num"):
            _rebuild_teacher_subgroups_table(connection)
        elif not _sqlite_has_column(connection, "teacher_subgroups", "subgroup_id"):
            connection.execute(
                text("ALTER TABLE teacher_subgroups ADD COLUMN subgroup_id CHAR(32)")
            )


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_async_session_maker()() as session:
        yield session


async def init_db() -> None:
    async with get_async_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        if settings.SQLITE.async_DSN.startswith("sqlite"):
            await connection.run_sync(_sync_sqlite_schema)


async def drop_db() -> None:
    async with get_async_engine().begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
