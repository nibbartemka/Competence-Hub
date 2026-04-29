from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field


class GraphLayoutNodePosition(BaseModel):
    x: float
    y: float


class GraphLayoutPayload(BaseModel):
    offset_x: float = 0
    offset_y: float = 0
    zoom: float | None = None
    positions: dict[str, GraphLayoutNodePosition] = Field(default_factory=dict)


class GraphLayoutUpsert(BaseModel):
    scene_key: str = Field(min_length=1, max_length=255)
    payload: GraphLayoutPayload


class GraphLayoutRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: UUID
    scope_type: str
    scope_id: UUID
    scene_key: str
    payload: GraphLayoutPayload
    updated_at: datetime
