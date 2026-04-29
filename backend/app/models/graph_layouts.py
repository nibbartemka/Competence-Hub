from datetime import datetime
from uuid import UUID, uuid4

from sqlalchemy import DateTime, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.core import Base


class GraphLayout(Base):
    __tablename__ = "graph_layouts"
    __table_args__ = (
        UniqueConstraint(
            "scope_type",
            "scope_id",
            "scene_key",
            name="uq_graph_layout_scope_scene",
        ),
    )

    id: Mapped[UUID] = mapped_column(primary_key=True, default=uuid4)
    scope_type: Mapped[str] = mapped_column(String(64), nullable=False)
    scope_id: Mapped[UUID] = mapped_column(nullable=False)
    scene_key: Mapped[str] = mapped_column(String(255), nullable=False)
    payload_json: Mapped[str] = mapped_column(Text, nullable=False, default="{}")
    created_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime,
        nullable=False,
        default=datetime.utcnow,
        onupdate=datetime.utcnow,
    )
