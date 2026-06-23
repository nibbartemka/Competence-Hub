import json
from uuid import UUID

from fastapi import APIRouter
from sqlalchemy import select

from app.api.crud import commit_or_409
from app.api.deps import DbSession
from app.models import GraphLayout
from app.schemas import GraphLayoutRead, GraphLayoutUpsert


router = APIRouter(prefix="/graph-layouts", tags=["Graph layouts"])


def _build_graph_layout_read(layout: GraphLayout) -> GraphLayoutRead:
    return GraphLayoutRead(
        id=layout.id,
        scope_type=layout.scope_type,
        scope_id=layout.scope_id,
        scene_key=layout.scene_key,
        payload=json.loads(layout.payload_json),
        updated_at=layout.updated_at,
    )


@router.get("/{scope_type}/{scope_id}", response_model=list[GraphLayoutRead])
async def list_graph_layouts(
    scope_type: str,
    scope_id: UUID,
    session: DbSession,
) -> list[GraphLayoutRead]:
    result = await session.execute(
        select(GraphLayout)
        .where(
            GraphLayout.scope_type == scope_type,
            GraphLayout.scope_id == scope_id,
        )
        .order_by(GraphLayout.scene_key)
    )
    return [_build_graph_layout_read(layout) for layout in result.scalars().all()]


@router.put("/{scope_type}/{scope_id}", response_model=GraphLayoutRead)
async def upsert_graph_layout(
    scope_type: str,
    scope_id: UUID,
    payload: GraphLayoutUpsert,
    session: DbSession,
) -> GraphLayoutRead:
    result = await session.execute(
        select(GraphLayout).where(
            GraphLayout.scope_type == scope_type,
            GraphLayout.scope_id == scope_id,
            GraphLayout.scene_key == payload.scene_key,
        )
    )
    layout = result.scalar_one_or_none()

    if layout is None:
        layout = GraphLayout(
            scope_type=scope_type,
            scope_id=scope_id,
            scene_key=payload.scene_key,
            payload_json=payload.payload.model_dump_json(),
        )
        session.add(layout)
    else:
        layout.payload_json = payload.payload.model_dump_json()

    await commit_or_409(session)
    await session.refresh(layout)
    return _build_graph_layout_read(layout)
