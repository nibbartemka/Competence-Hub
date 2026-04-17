from fastapi import FastAPI
import uvicorn

from app import create_app
from app.core import settings


app: FastAPI = create_app()

if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host=settings.APP.HOST,
        port=settings.APP.PORT,
        reload=True
    )
