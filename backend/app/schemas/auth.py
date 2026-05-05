from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field


class AuthLoginRequest(BaseModel):
    login: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=255)


class AuthLoginResponse(BaseModel):
    role: Literal["student", "teacher", "admin", "expert"]
    user_id: UUID | None = None
    display_name: str
