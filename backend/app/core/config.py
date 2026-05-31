from enum import StrEnum
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, BaseModel


__all__ = [
    'settings',
]


class EnvironmentTypes(StrEnum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"


class PostgresSettings(BaseModel):
    HOST: str = "localhost"
    PORT: int = 5432
    USER: str = "competence_hub"
    PASSWORD: str = "competence_hub"
    DB: str = "competence_hub"

    @property
    def async_DSN(self) -> str:
        return (
            f"postgresql+asyncpg://{self.USER}:{self.PASSWORD}"
            f"@{self.HOST}:{self.PORT}/{self.DB}"
        )

    @property
    def DSN(self) -> str:
        return (
            f"postgresql://{self.USER}:{self.PASSWORD}"
            f"@{self.HOST}:{self.PORT}/{self.DB}"
        )


class SQLiteSettings(BaseModel):
    PATH: str = "app.db"

    @property
    def resolved_path(self) -> Path:
        configured_path = Path(self.PATH)
        if configured_path.is_absolute():
            return configured_path
        return Path(__file__).resolve().parents[2] / configured_path

    @property
    def async_DSN(self) -> str:
        return f"sqlite+aiosqlite:///{self.resolved_path.as_posix()}"

    @property
    def DSN(self) -> str:
        return f"sqlite:///{self.resolved_path.as_posix()}"


class AppSettings(BaseModel):
    HOST: str = "127.0.0.1"
    PORT: int = 8000


class RedisSettings(BaseModel):
    URL: str = "redis://localhost:6379/0"
    SESSION_TTL_SECONDS: int = 60 * 60 * 24
    ENABLED: bool = True


class Settings(BaseSettings):
    APP: AppSettings = AppSettings()
    SQLITE: SQLiteSettings = SQLiteSettings()
    POSTGRES: PostgresSettings = PostgresSettings()
    REDIS: RedisSettings = RedisSettings()
    BACKEND_CORS_ORIGINS: str = (
        "http://localhost:5173,"
        "http://127.0.0.1:5173,"
        "http://localhost:4173,"
        "http://127.0.0.1:4173"
    )

    ENVIRONMENT: EnvironmentTypes = Field(
        default=EnvironmentTypes.DEVELOPMENT,
        description="Тип среды разработки"
    )

    model_config = SettingsConfigDict(
        env_file='.env',
        env_nested_delimiter='__',
        env_file_encoding='utf-8',
        extra='ignore',
    )

    @property
    def cors_origins(self) -> list[str]:
        return [
            item.strip()
            for item in self.BACKEND_CORS_ORIGINS.split(",")
            if item.strip()
        ]

    @property
    def async_database_dsn(self) -> str:
        return self.POSTGRES.async_DSN

    @property
    def sync_database_dsn(self) -> str:
        return self.POSTGRES.DSN


settings: Settings = Settings()
