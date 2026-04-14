from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app.api.routes import router as api_router
from app.core.bootstrap import initialize_database
from app.models import Discipline, TeacherThemeSelection, Theme, ThemeElement, User

app = FastAPI(
    title="Competence Hub - Study Process Service",
    version="0.1.0",
)

frontend_dir = Path(__file__).parent / "app" / "frontend"

initialize_database()

app.mount("/static", StaticFiles(directory=frontend_dir), name="static")
app.include_router(api_router, prefix="/api")


@app.get("/", include_in_schema=False)
def index() -> FileResponse:
    return FileResponse(frontend_dir / "index.html")


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}
