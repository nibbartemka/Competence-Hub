from __future__ import annotations

import re
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession


CYRILLIC_TO_LATIN = {
    "\u0430": "a",
    "\u0431": "b",
    "\u0432": "v",
    "\u0433": "g",
    "\u0434": "d",
    "\u0435": "e",
    "\u0451": "e",
    "\u0436": "zh",
    "\u0437": "z",
    "\u0438": "i",
    "\u0439": "y",
    "\u043a": "k",
    "\u043b": "l",
    "\u043c": "m",
    "\u043d": "n",
    "\u043e": "o",
    "\u043f": "p",
    "\u0440": "r",
    "\u0441": "s",
    "\u0442": "t",
    "\u0443": "u",
    "\u0444": "f",
    "\u0445": "kh",
    "\u0446": "ts",
    "\u0447": "ch",
    "\u0448": "sh",
    "\u0449": "sch",
    "\u044a": "",
    "\u044b": "y",
    "\u044c": "",
    "\u044d": "e",
    "\u044e": "yu",
    "\u044f": "ya",
}


def transliterate_to_slug_base(value: str) -> str:
    normalized = value.strip().lower()
    transliterated = "".join(CYRILLIC_TO_LATIN.get(char, char) for char in normalized)
    transliterated = re.sub(r"[^a-z0-9]+", "-", transliterated)
    transliterated = re.sub(r"-{2,}", "-", transliterated).strip("-")
    return transliterated or "discipline"


async def build_unique_discipline_slug(
    session: AsyncSession,
    name: str,
    *,
    exclude_id: UUID | None = None,
) -> str:
    from app.models.disciplines import Discipline

    base_slug = transliterate_to_slug_base(name)
    candidate = base_slug
    suffix = 2

    while True:
        query = select(Discipline.id).where(Discipline.slug == candidate)
        if exclude_id is not None:
            query = query.where(Discipline.id != exclude_id)

        result = await session.execute(query)
        if result.scalar_one_or_none() is None:
            return candidate

        candidate = f"{base_slug}-{suffix}"
        suffix += 1
