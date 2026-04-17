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
    HOST: str
    PORT: int = 5432
    USER: str
    PASSWORD: str
    DB: str

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
    HOST: str = "0.0.0.0"
    PORT: int = 8000


class Settings(BaseSettings):
    APP: AppSettings = AppSettings()
    SQLITE: SQLiteSettings = SQLiteSettings()

    # POSTGRES: PostgresSettings

    ENVIRONMENT: EnvironmentTypes = Field(
        default=EnvironmentTypes.DEVELOPMENT,
        description="Тип среды разработки"
    )

    model_config = SettingsConfigDict(
        env_file='.env',
        env_nested_delimiter='__',
        env_file_encoding='utf-8',
    )


settings: Settings = Settings()
