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
