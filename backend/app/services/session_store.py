import json
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from typing import Literal
from uuid import UUID, uuid4

from app.core import settings


SessionRole = Literal["student", "teacher", "admin", "expert"]


@dataclass(slots=True)
class AuthSession:
    session_id: str
    role: SessionRole
    user_id: str
    display_name: str
    login: str
    expires_at: str


class SessionStore:
    def __init__(self) -> None:
        self._memory_sessions: dict[str, AuthSession] = {}
        self._redis = None
        self._redis_checked = False

    async def create(
        self,
        *,
        role: SessionRole,
        user_id: UUID,
        display_name: str,
        login: str,
    ) -> AuthSession:
        session = AuthSession(
            session_id=uuid4().hex,
            role=role,
            user_id=str(user_id),
            display_name=display_name,
            login=login,
            expires_at=self._expires_at().isoformat(),
        )
        redis = await self._get_redis()
        if redis is not None:
            await redis.setex(
                self._redis_key(session.session_id),
                settings.REDIS.SESSION_TTL_SECONDS,
                json.dumps(asdict(session)),
            )
            return session

        self._memory_sessions[session.session_id] = session
        self._cleanup_memory_sessions()
        return session

    async def get(self, session_id: str | None) -> AuthSession | None:
        if not session_id:
            return None

        redis = await self._get_redis()
        if redis is not None:
            raw_session = await redis.get(self._redis_key(session_id))
            if raw_session is None:
                return None
            if isinstance(raw_session, bytes):
                raw_session = raw_session.decode("utf-8")
            return self._deserialize(raw_session)

        session = self._memory_sessions.get(session_id)
        if session and datetime.fromisoformat(session.expires_at) > datetime.now(UTC):
            return session
        self._memory_sessions.pop(session_id, None)
        return None

    async def delete(self, session_id: str | None) -> None:
        if not session_id:
            return

        redis = await self._get_redis()
        if redis is not None:
            await redis.delete(self._redis_key(session_id))
            return

        self._memory_sessions.pop(session_id, None)

    async def close(self) -> None:
        if self._redis is not None:
            await self._redis.aclose()
            self._redis = None

    async def _get_redis(self):
        if not settings.REDIS.ENABLED:
            return None
        if self._redis_checked:
            return self._redis

        self._redis_checked = True
        try:
            from redis.asyncio import Redis

            redis = Redis.from_url(settings.REDIS.URL, decode_responses=True)
            await redis.ping()
            self._redis = redis
        except Exception:
            self._redis = None
        return self._redis

    def _expires_at(self) -> datetime:
        return datetime.now(UTC) + timedelta(seconds=settings.REDIS.SESSION_TTL_SECONDS)

    def _cleanup_memory_sessions(self) -> None:
        now = datetime.now(UTC)
        expired_session_ids = [
            session_id
            for session_id, session in self._memory_sessions.items()
            if datetime.fromisoformat(session.expires_at) <= now
        ]
        for session_id in expired_session_ids:
            self._memory_sessions.pop(session_id, None)

    @staticmethod
    def _redis_key(session_id: str) -> str:
        return f"competence-hub:session:{session_id}"

    @staticmethod
    def _deserialize(raw_session: str) -> AuthSession:
        payload = json.loads(raw_session)
        return AuthSession(**payload)


session_store = SessionStore()
