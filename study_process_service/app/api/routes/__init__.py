from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.disciplines import router as disciplines_router
from app.api.routes.teachers import router as teachers_router
from app.api.routes.theme_elements import router as theme_elements_router
from app.api.routes.themes import router as themes_router


router = APIRouter()
router.include_router(auth_router)
router.include_router(disciplines_router)
router.include_router(themes_router)
router.include_router(theme_elements_router)
router.include_router(teachers_router)


__all__ = ["router"]
