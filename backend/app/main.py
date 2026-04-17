from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.openapi.docs import get_swagger_ui_html, get_redoc_html
from fastapi.openapi.utils import get_openapi
from sqlalchemy import select

from .api.routes import api_router
from .core import init_db
from .core.db import get_async_session_maker
from .models import Discipline
from .models import *  # noqa: F401,F403 - ensure ORM models are registered
from .services.topic_dependencies import sync_topic_dependencies_for_disciplines


@asynccontextmanager
async def lifespan(app: FastAPI):
    await init_db()
    async with get_async_session_maker()() as session:
        result = await session.execute(select(Discipline.id).order_by(Discipline.name))
        discipline_ids = list(result.scalars().all())
        await sync_topic_dependencies_for_disciplines(session, discipline_ids)
        await session.commit()
    yield


def create_app() -> FastAPI:
    app: FastAPI = FastAPI(
        title="Прототип",
        version="1.0.0",
        docs_url=None,  # Отключаем стандартные пути документации
        redoc_url=None,
        openapi_url=None,
        lifespan=lifespan,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:5173",
            "http://127.0.0.1:5173",
            "http://localhost:4173",
            "http://127.0.0.1:4173",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.get("/docs", include_in_schema=False)
    async def custom_swagger_ui_html():
        return get_swagger_ui_html(
            openapi_url="openapi.json",
            title="API Documentation",
        )

    @app.get("/redoc", include_in_schema=False)
    async def custom_redoc_html():
        return get_redoc_html(
            openapi_url="openapi.json",
            title="API Documentation",
        )

    @app.get("/openapi.json", include_in_schema=False)
    async def get_open_api_endpoint():
        return get_openapi(
            title=app.title,
            version=app.version,
            description=app.description,
            routes=app.routes,
        )

    app.include_router(api_router)

    return app
