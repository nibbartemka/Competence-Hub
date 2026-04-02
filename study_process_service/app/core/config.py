from enum import StrEnum

from pydantic_settings import BaseSettings, SettingsConfigDict
from pydantic import Field, BaseModel


__all__ = [
    'settings'
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


class AppSettings(BaseModel):
    HOST: str = "0.0.0.0"
    PORT: int = 8000


class Settings(BaseSettings):
    APP: AppSettings

    POSTGRES: PostgresSettings

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
