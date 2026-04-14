from enum import StrEnum

from pydantic import BaseModel, Field
from pydantic_settings import BaseSettings, SettingsConfigDict


__all__ = [
    'settings',
]


class EnvironmentTypes(StrEnum):
    DEVELOPMENT = "development"
    PRODUCTION = "production"


class PostgresSettings(BaseModel):
    HOST: str = "localhost"
    PORT: int = 5432
    USER: str = "postgres"
    PASSWORD: str = "postgres"
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


class AppSettings(BaseModel):
    HOST: str = "0.0.0.0"
    PORT: int = 8000


class Settings(BaseSettings):
    APP: AppSettings = AppSettings()
    POSTGRES: PostgresSettings = PostgresSettings()
    DATABASE_URL: str = "sqlite:///./competence_hub.db"

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
