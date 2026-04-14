from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    AsyncEngine,
    async_sessionmaker
)
from sqlalchemy.orm import declarative_base

from .config import settings


__all__ = [
    'Base',
    'get_async_session',
    'init_db',
    'drop_db',
]


Base = declarative_base()


async_engine: AsyncEngine = create_async_engine(
    settings.SQLITE.async_DSN,
    pool_size=5,
    max_overflow=10,
    echo=False,
)


AsyncSessionLocal = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
    autocommit=False,
)


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with AsyncSessionLocal() as session:
        yield session


async def init_db() -> None:
    async with async_engine.begin() as connection:
        await connection.run_sync(Base.metadata.create_all)


async def drop_db() -> None:
    async with async_engine.begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
