from datetime import date

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.enums import UserRole


class LoginRequest(BaseModel):
    username: str
    password: str


class RegisterRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    birth_date: date
    role: UserRole
    username: str = Field(min_length=3, max_length=64)
    password: str = Field(min_length=6, max_length=128)

    @field_validator("birth_date", mode="before")
    @classmethod
    def normalize_birth_date(cls, value: object) -> object:
        if isinstance(value, str):
            raw = value.strip()
            if "." in raw:
                day, month, year = raw.split(".")
                return date(int(year), int(month), int(day))
        return value


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    username: str
    full_name: str
    birth_date: date | None = None
    role: UserRole


class LoginResponse(BaseModel):
    token: str
    user: UserRead


class RegisterResponse(BaseModel):
    user: UserRead
    username: str
    password: str


class UsernameAvailabilityResponse(BaseModel):
    available: bool


class ProfileUpdateRequest(BaseModel):
    full_name: str = Field(min_length=2, max_length=255)
    birth_date: date
    username: str = Field(min_length=3, max_length=64)
    password: str | None = Field(default=None, min_length=6, max_length=128)

    @field_validator("birth_date", mode="before")
    @classmethod
    def normalize_birth_date(cls, value: object) -> object:
        if isinstance(value, str):
            raw = value.strip()
            if "." in raw:
                day, month, year = raw.split(".")
                return date(int(year), int(month), int(day))
        return value
