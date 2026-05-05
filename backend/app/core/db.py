from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    create_async_engine,
    AsyncSession,
    AsyncEngine,
    async_sessionmaker
)
from sqlalchemy.orm import declarative_base
from sqlalchemy import text

from .config import settings
from .slugs import transliterate_to_slug_base


__all__ = [
    'Base',
    'get_async_session',
    'init_db',
    'drop_db',
]


Base = declarative_base()

async_engine: AsyncEngine | None = None
AsyncSessionLocal: async_sessionmaker[AsyncSession] | None = None

SQLITE_RELATION_DIRECTIONS: dict[str, str] = {
    "REQUIRES": "ONE_DIRECTION",
    "BUILDS_ON": "ONE_DIRECTION",
    "CONTAINS": "ONE_DIRECTION",
    "PART_OF": "ONE_DIRECTION",
    "PROPERTY_OF": "ONE_DIRECTION",
    "REFINES": "ONE_DIRECTION",
    "GENERALIZES": "ONE_DIRECTION",
    "IMPLEMENTS": "ONE_DIRECTION",
    "AUTOMATES": "ONE_DIRECTION",
    "SIMILAR": "TWO_DIRECTION",
    "CONTRASTS_WITH": "TWO_DIRECTION",
    "USED_WITH": "TWO_DIRECTION",
}


def get_async_engine() -> AsyncEngine:
    global async_engine

    if async_engine is None:
        async_engine = create_async_engine(
            settings.SQLITE.async_DSN,
            pool_size=5,
            max_overflow=10,
            echo=False,
        )

    return async_engine


def get_async_session_maker() -> async_sessionmaker[AsyncSession]:
    global AsyncSessionLocal

    if AsyncSessionLocal is None:
        AsyncSessionLocal = async_sessionmaker(
            bind=get_async_engine(),
            class_=AsyncSession,
            expire_on_commit=False,
            autoflush=False,
            autocommit=False,
        )

    return AsyncSessionLocal


def _sqlite_has_column(connection, table_name: str, column_name: str) -> bool:
    rows = connection.execute(text(f"PRAGMA table_info({table_name})")).fetchall()
    return any(row[1] == column_name for row in rows)


def _sqlite_has_table(connection, table_name: str) -> bool:
    row = connection.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'table' AND name = :table_name"
        ),
        {"table_name": table_name},
    ).fetchone()
    return row is not None


def _sqlite_has_index(connection, index_name: str) -> bool:
    row = connection.execute(
        text(
            "SELECT name FROM sqlite_master "
            "WHERE type = 'index' AND name = :index_name"
        ),
        {"index_name": index_name},
    ).fetchone()
    return row is not None


def _rebuild_students_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE students_new (
                id CHAR(32) NOT NULL,
                name VARCHAR(255) NOT NULL,
                group_id CHAR(32) NOT NULL,
                subgroup_id CHAR(32),
                PRIMARY KEY (id),
                FOREIGN KEY(group_id) REFERENCES groups (id) ON DELETE CASCADE,
                FOREIGN KEY(subgroup_id) REFERENCES subgroups (id) ON DELETE SET NULL
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT INTO students_new (id, name, group_id, subgroup_id)
            SELECT id, name, group_id, subgroup_id
            FROM students
            """
        )
    )
    connection.execute(text("DROP TABLE students"))
    connection.execute(text("ALTER TABLE students_new RENAME TO students"))


def _rebuild_teacher_subgroups_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE teacher_subgroups_new (
                id CHAR(32) NOT NULL,
                teacher_id CHAR(32) NOT NULL,
                subgroup_id CHAR(32) NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT uq_teacher_subgroup_num UNIQUE (teacher_id, subgroup_id),
                FOREIGN KEY(teacher_id) REFERENCES teachers (id) ON DELETE CASCADE,
                FOREIGN KEY(subgroup_id) REFERENCES subgroups (id) ON DELETE CASCADE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT OR IGNORE INTO teacher_subgroups_new (id, teacher_id, subgroup_id)
            SELECT teacher_subgroups.id, teacher_subgroups.teacher_id, subgroups.id
            FROM teacher_subgroups
            JOIN subgroups ON subgroups.subgroup_num = teacher_subgroups.subgroup_num
            """
        )
    )
    connection.execute(text("DROP TABLE teacher_subgroups"))
    connection.execute(
        text("ALTER TABLE teacher_subgroups_new RENAME TO teacher_subgroups")
    )


def _rebuild_knowledge_elements_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TEMP TABLE knowledge_element_discipline_map AS
            WITH linked AS (
                SELECT DISTINCT
                    topic_knowledge_elements.element_id AS old_id,
                    topics.discipline_id AS discipline_id
                FROM topic_knowledge_elements
                JOIN topics ON topics.id = topic_knowledge_elements.topic_id
            ),
            first_link AS (
                SELECT old_id, MIN(discipline_id) AS first_discipline_id
                FROM linked
                GROUP BY old_id
            )
            SELECT
                linked.old_id,
                linked.discipline_id,
                CASE
                    WHEN linked.discipline_id = first_link.first_discipline_id
                    THEN linked.old_id
                    ELSE lower(hex(randomblob(16)))
                END AS new_id
            FROM linked
            JOIN first_link ON first_link.old_id = linked.old_id
            UNION ALL
            SELECT
                knowledge_elements.id AS old_id,
                NULL AS discipline_id,
                knowledge_elements.id AS new_id
            FROM knowledge_elements
            WHERE NOT EXISTS (
                SELECT 1
                FROM linked
                WHERE linked.old_id = knowledge_elements.id
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE knowledge_elements_new (
                id CHAR(32) NOT NULL,
                name VARCHAR(255) NOT NULL,
                description TEXT,
                competence_type VARCHAR(6) NOT NULL,
                discipline_id CHAR(32),
                PRIMARY KEY (id),
                CONSTRAINT uq_knowledge_element_discipline_name_competence
                    UNIQUE (discipline_id, name, competence_type),
                FOREIGN KEY(discipline_id) REFERENCES disciplines (id) ON DELETE CASCADE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT OR IGNORE INTO knowledge_elements_new (
                id,
                name,
                description,
                competence_type,
                discipline_id
            )
            SELECT
                knowledge_element_discipline_map.new_id,
                knowledge_elements.name,
                knowledge_elements.description,
                knowledge_elements.competence_type,
                knowledge_element_discipline_map.discipline_id
            FROM knowledge_element_discipline_map
            JOIN knowledge_elements
                ON knowledge_elements.id = knowledge_element_discipline_map.old_id
            """
        )
    )
    connection.execute(
        text(
            """
            UPDATE topic_knowledge_elements
            SET element_id = (
                SELECT knowledge_element_discipline_map.new_id
                FROM knowledge_element_discipline_map
                JOIN topics ON topics.id = topic_knowledge_elements.topic_id
                WHERE knowledge_element_discipline_map.old_id =
                    topic_knowledge_elements.element_id
                    AND knowledge_element_discipline_map.discipline_id =
                    topics.discipline_id
                LIMIT 1
            )
            WHERE EXISTS (
                SELECT 1
                FROM knowledge_element_discipline_map
                JOIN topics ON topics.id = topic_knowledge_elements.topic_id
                WHERE knowledge_element_discipline_map.old_id =
                    topic_knowledge_elements.element_id
                    AND knowledge_element_discipline_map.discipline_id =
                    topics.discipline_id
            )
            """
        )
    )
    connection.execute(
        text(
            """
            CREATE TABLE knowledge_element_relations_new (
                id CHAR(32) NOT NULL,
                description TEXT,
                source_element_id CHAR(32) NOT NULL,
                target_element_id CHAR(32) NOT NULL,
                relation_id CHAR(32) NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT uq_knowledge_element_relation
                    UNIQUE (source_element_id, target_element_id, relation_id),
                CONSTRAINT ck_knowledge_element_relation_not_self
                    CHECK (source_element_id != target_element_id),
                FOREIGN KEY(source_element_id)
                    REFERENCES knowledge_elements (id) ON DELETE CASCADE,
                FOREIGN KEY(target_element_id)
                    REFERENCES knowledge_elements (id) ON DELETE CASCADE,
                FOREIGN KEY(relation_id)
                    REFERENCES relations (id) ON DELETE CASCADE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT OR IGNORE INTO knowledge_element_relations_new (
                id,
                description,
                source_element_id,
                target_element_id,
                relation_id
            )
            SELECT
                lower(hex(randomblob(16))),
                knowledge_element_relations.description,
                source_map.new_id,
                target_map.new_id,
                relations.id
            FROM knowledge_element_relations
            JOIN knowledge_element_discipline_map AS source_map
                ON source_map.old_id =
                knowledge_element_relations.source_element_id
            JOIN knowledge_element_discipline_map AS target_map
                ON target_map.old_id =
                knowledge_element_relations.target_element_id
            JOIN relations
                ON upper(relations.relation_type) = upper(knowledge_element_relations.relation_type)
            WHERE source_map.new_id != target_map.new_id
                AND (
                    source_map.discipline_id = target_map.discipline_id
                    OR (
                        source_map.discipline_id IS NULL
                        AND target_map.discipline_id IS NULL
                    )
                )
            """
        )
    )
    connection.execute(text("DROP TABLE knowledge_element_relations"))
    connection.execute(text("DROP TABLE knowledge_elements"))
    connection.execute(
        text("ALTER TABLE knowledge_elements_new RENAME TO knowledge_elements")
    )
    connection.execute(
        text(
            "ALTER TABLE knowledge_element_relations_new "
            "RENAME TO knowledge_element_relations"
        )
    )
    connection.execute(text("DROP TABLE knowledge_element_discipline_map"))


def _seed_relations_table(connection) -> None:
    if not _sqlite_has_table(connection, "relations"):
        return

    for relation_type, direction in SQLITE_RELATION_DIRECTIONS.items():
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO relations (id, relation_type, direction)
                VALUES (lower(hex(randomblob(16))), :relation_type, :direction)
                """
            ),
            {
                "relation_type": relation_type,
                "direction": direction,
            },
        )
        connection.execute(
            text(
                """
                UPDATE relations
                SET direction = :direction
                WHERE relation_type = :relation_type
                """
            ),
            {
                "relation_type": relation_type,
                "direction": direction,
            },
        )


def _sync_discipline_slugs(connection) -> None:
    if not _sqlite_has_table(connection, "disciplines"):
        return

    if not _sqlite_has_column(connection, "disciplines", "slug"):
        connection.execute(text("ALTER TABLE disciplines ADD COLUMN slug VARCHAR(255)"))

    rows = connection.execute(
        text("SELECT id, name, slug FROM disciplines ORDER BY name, id")
    ).fetchall()
    used_slugs: set[str] = set()
    for discipline_id, name, slug in rows:
        candidate = str(slug or "").strip()
        if not candidate or candidate in used_slugs:
            base_slug = transliterate_to_slug_base(str(name or ""))
            candidate = base_slug
            suffix = 2
            while candidate in used_slugs:
                candidate = f"{base_slug}-{suffix}"
                suffix += 1
        used_slugs.add(candidate)
        connection.execute(
            text("UPDATE disciplines SET slug = :slug WHERE id = :discipline_id"),
            {"slug": candidate, "discipline_id": discipline_id},
        )

    if not _sqlite_has_index(connection, "uq_disciplines_slug"):
        connection.execute(
            text("CREATE UNIQUE INDEX uq_disciplines_slug ON disciplines (slug)")
        )


def _sync_person_credentials(
    connection,
    table_name: str,
    name_column: str = "name",
) -> None:
    if not _sqlite_has_table(connection, table_name):
        return

    if not _sqlite_has_column(connection, table_name, "login"):
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN login VARCHAR(255)"))
    if not _sqlite_has_column(connection, table_name, "password"):
        connection.execute(text(f"ALTER TABLE {table_name} ADD COLUMN password VARCHAR(255)"))

    rows = connection.execute(
        text(f"SELECT id, {name_column}, login, password FROM {table_name} ORDER BY {name_column}, id")
    ).fetchall()

    used_logins: set[str] = set()
    for person_id, name, login, password in rows:
        candidate_login = str(login or "").strip()
        if not candidate_login or candidate_login in used_logins:
            base_login = transliterate_to_slug_base(str(name or "user"))
            candidate_login = base_login
            suffix = 2
            while candidate_login in used_logins:
                candidate_login = f"{base_login}-{suffix}"
                suffix += 1

        used_logins.add(candidate_login)
        candidate_password = str(password or "").strip() or candidate_login

        connection.execute(
            text(
                f"UPDATE {table_name} "
                "SET login = :login, password = :password "
                "WHERE id = :person_id"
            ),
            {
                "login": candidate_login,
                "password": candidate_password,
                "person_id": person_id,
            },
        )

    unique_index_name = f"uq_{table_name}_login"
    if not _sqlite_has_index(connection, unique_index_name):
        connection.execute(
            text(f"CREATE UNIQUE INDEX {unique_index_name} ON {table_name} (login)")
        )


def _seed_default_admin_record(connection) -> None:
    if not _sqlite_has_table(connection, "admins"):
        return

    row = connection.execute(
        text("SELECT id FROM admins WHERE login = 'admin' LIMIT 1")
    ).fetchone()
    if row is None:
        connection.execute(
            text(
                """
                INSERT INTO admins (id, name, login, password)
                VALUES (lower(hex(randomblob(16))), 'Администратор', 'admin', 'admin')
                """
            )
        )


def _normalize_relations_and_links(connection) -> None:
    if not _sqlite_has_table(connection, "relations"):
        return

    has_relation_links = _sqlite_has_table(
        connection, "knowledge_element_relations"
    ) and _sqlite_has_column(connection, "knowledge_element_relations", "relation_id")

    connection.execute(text("DROP TABLE IF EXISTS relation_normalization_map"))
    connection.execute(
        text(
            """
            CREATE TEMP TABLE relation_normalization_map AS
            WITH normalized AS (
                SELECT
                    id AS old_id,
                    upper(relation_type) AS normalized_relation_type,
                    CASE upper(direction)
                        WHEN 'ONE_DIRECTION' THEN 'ONE_DIRECTION'
                        WHEN 'TWO_DIRECTION' THEN 'TWO_DIRECTION'
                        ELSE upper(direction)
                    END AS normalized_direction
                FROM relations
            ),
            canonical AS (
                SELECT
                    normalized_relation_type,
                    MIN(old_id) AS canonical_id
                FROM normalized
                GROUP BY normalized_relation_type
            )
            SELECT
                normalized.old_id,
                canonical.canonical_id,
                normalized.normalized_relation_type,
                normalized.normalized_direction
            FROM normalized
            JOIN canonical
                ON canonical.normalized_relation_type = normalized.normalized_relation_type
            """
        )
    )

    connection.execute(text("DROP TABLE IF EXISTS relations_new"))
    connection.execute(
        text(
            """
            CREATE TABLE relations_new (
                id CHAR(32) NOT NULL,
                relation_type VARCHAR(32) NOT NULL,
                direction VARCHAR(32) NOT NULL,
                PRIMARY KEY (id),
                UNIQUE (relation_type)
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT OR IGNORE INTO relations_new (id, relation_type, direction)
            SELECT
                canonical_id,
                normalized_relation_type,
                normalized_direction
            FROM relation_normalization_map
            GROUP BY canonical_id, normalized_relation_type, normalized_direction
            """
        )
    )

    if has_relation_links:
        connection.execute(text("DROP TABLE IF EXISTS knowledge_element_relations_new"))
        connection.execute(
            text(
                """
                CREATE TABLE knowledge_element_relations_new (
                    id CHAR(32) NOT NULL,
                    description TEXT,
                    source_element_id CHAR(32) NOT NULL,
                    target_element_id CHAR(32) NOT NULL,
                    relation_id CHAR(32) NOT NULL,
                    PRIMARY KEY (id),
                    CONSTRAINT uq_knowledge_element_relation
                        UNIQUE (source_element_id, target_element_id, relation_id),
                    CONSTRAINT ck_knowledge_element_relation_not_self
                        CHECK (source_element_id != target_element_id),
                    FOREIGN KEY(source_element_id)
                        REFERENCES knowledge_elements (id) ON DELETE CASCADE,
                    FOREIGN KEY(target_element_id)
                        REFERENCES knowledge_elements (id) ON DELETE CASCADE,
                    FOREIGN KEY(relation_id)
                        REFERENCES relations (id) ON DELETE CASCADE
                )
                """
            )
        )
        connection.execute(
            text(
                """
                INSERT OR IGNORE INTO knowledge_element_relations_new (
                    id,
                    description,
                    source_element_id,
                    target_element_id,
                    relation_id
                )
                SELECT
                    ker.id,
                    ker.description,
                    ker.source_element_id,
                    ker.target_element_id,
                    map.canonical_id
                FROM knowledge_element_relations AS ker
                JOIN relation_normalization_map AS map
                    ON map.old_id = ker.relation_id
                """
            )
        )
        connection.execute(text("DROP TABLE knowledge_element_relations"))

    connection.execute(text("DROP TABLE relations"))
    connection.execute(text("ALTER TABLE relations_new RENAME TO relations"))

    if has_relation_links:
        connection.execute(
            text(
                "ALTER TABLE knowledge_element_relations_new "
                "RENAME TO knowledge_element_relations"
            )
        )

    connection.execute(text("DROP TABLE relation_normalization_map"))


def _rebuild_knowledge_element_relations_table(connection) -> None:
    connection.execute(
        text(
            """
            CREATE TABLE knowledge_element_relations_new (
                id CHAR(32) NOT NULL,
                description TEXT,
                source_element_id CHAR(32) NOT NULL,
                target_element_id CHAR(32) NOT NULL,
                relation_id CHAR(32) NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT uq_knowledge_element_relation
                    UNIQUE (source_element_id, target_element_id, relation_id),
                CONSTRAINT ck_knowledge_element_relation_not_self
                    CHECK (source_element_id != target_element_id),
                FOREIGN KEY(source_element_id)
                    REFERENCES knowledge_elements (id) ON DELETE CASCADE,
                FOREIGN KEY(target_element_id)
                    REFERENCES knowledge_elements (id) ON DELETE CASCADE,
                FOREIGN KEY(relation_id)
                    REFERENCES relations (id) ON DELETE CASCADE
            )
            """
        )
    )
    connection.execute(
        text(
            """
            INSERT OR IGNORE INTO knowledge_element_relations_new (
                id,
                description,
                source_element_id,
                target_element_id,
                relation_id
            )
            SELECT
                knowledge_element_relations.id,
                knowledge_element_relations.description,
                knowledge_element_relations.source_element_id,
                knowledge_element_relations.target_element_id,
                relations.id
            FROM knowledge_element_relations
            JOIN relations
                ON upper(relations.relation_type) = upper(knowledge_element_relations.relation_type)
            """
        )
    )
    connection.execute(text("DROP TABLE knowledge_element_relations"))
    connection.execute(
        text(
            "ALTER TABLE knowledge_element_relations_new "
            "RENAME TO knowledge_element_relations"
        )
    )


def _sync_sqlite_schema(connection) -> None:
    # Keep local SQLite schema compatible with the current SQLAlchemy models.
    _sync_discipline_slugs(connection)
    _sync_person_credentials(connection, "admins")
    _sync_person_credentials(connection, "experts")
    _sync_person_credentials(connection, "teachers")
    _sync_person_credentials(connection, "students")
    _seed_default_admin_record(connection)
    if not _sqlite_has_column(connection, "topics", "description"):
        connection.execute(text("ALTER TABLE topics ADD COLUMN description TEXT"))
    if not _sqlite_has_column(connection, "topic_knowledge_elements", "role"):
        connection.execute(
            text(
                "ALTER TABLE topic_knowledge_elements "
                "ADD COLUMN role TEXT NOT NULL DEFAULT 'formed'"
            )
        )
    if _sqlite_has_table(connection, "students") and _sqlite_has_column(
        connection, "students", "subgroup_num"
    ):
        _rebuild_students_table(connection)
    if _sqlite_has_table(connection, "teacher_subgroups"):
        if _sqlite_has_column(connection, "teacher_subgroups", "subgroup_num"):
            _rebuild_teacher_subgroups_table(connection)
        elif not _sqlite_has_column(connection, "teacher_subgroups", "subgroup_id"):
            connection.execute(
                text("ALTER TABLE teacher_subgroups ADD COLUMN subgroup_id CHAR(32)")
            )
    _normalize_relations_and_links(connection)
    _seed_relations_table(connection)
    if _sqlite_has_table(connection, "knowledge_elements") and not _sqlite_has_column(
        connection, "knowledge_elements", "discipline_id"
    ):
        _rebuild_knowledge_elements_table(connection)
    elif _sqlite_has_table(connection, "knowledge_element_relations") and not _sqlite_has_column(
        connection, "knowledge_element_relations", "relation_id"
    ):
        _rebuild_knowledge_element_relations_table(connection)
    if _sqlite_has_table(connection, "disciplines") and not _sqlite_has_column(
        connection, "disciplines", "knowledge_graph_version"
    ):
        connection.execute(
            text(
                "ALTER TABLE disciplines "
                "ADD COLUMN knowledge_graph_version INTEGER NOT NULL DEFAULT 1"
            )
        )
    if _sqlite_has_table(connection, "topic_dependencies") and not _sqlite_has_column(
        connection, "topic_dependencies", "source"
    ):
        connection.execute(
            text(
                "ALTER TABLE topic_dependencies "
                "ADD COLUMN source TEXT NOT NULL DEFAULT 'computed'"
            )
        )
    if _sqlite_has_table(connection, "learning_trajectories"):
        if not _sqlite_has_column(connection, "learning_trajectories", "status"):
            connection.execute(
                text(
                    "ALTER TABLE learning_trajectories "
                    "ADD COLUMN status TEXT NOT NULL DEFAULT 'draft'"
                )
            )
        if not _sqlite_has_column(connection, "learning_trajectories", "graph_version"):
            connection.execute(
                text(
                    "ALTER TABLE learning_trajectories "
                    "ADD COLUMN graph_version INTEGER NOT NULL DEFAULT 1"
                )
            )
    if _sqlite_has_table(connection, "learning_trajectory_tasks"):
        if not _sqlite_has_column(connection, "learning_trajectory_tasks", "task_type"):
            connection.execute(
                text(
                    "ALTER TABLE learning_trajectory_tasks "
                    "ADD COLUMN task_type TEXT NOT NULL DEFAULT 'text'"
                )
            )
        if not _sqlite_has_column(connection, "learning_trajectory_tasks", "content_json"):
            connection.execute(
                text(
                    "ALTER TABLE learning_trajectory_tasks "
                    "ADD COLUMN content_json TEXT NOT NULL DEFAULT '{}'"
                )
            )
        if not _sqlite_has_column(connection, "learning_trajectory_tasks", "title"):
            connection.execute(
                text(
                    "ALTER TABLE learning_trajectory_tasks "
                    "ADD COLUMN title TEXT NOT NULL DEFAULT ''"
                )
            )
        if not _sqlite_has_column(connection, "learning_trajectory_tasks", "template_kind"):
            connection.execute(
                text(
                    "ALTER TABLE learning_trajectory_tasks "
                    "ADD COLUMN template_kind TEXT NOT NULL DEFAULT 'manual'"
                )
            )
    if _sqlite_has_table(connection, "student_task_progress") and not _sqlite_has_column(
        connection, "student_task_progress", "last_answer_payload"
    ):
        connection.execute(
            text(
                "ALTER TABLE student_task_progress "
                "ADD COLUMN last_answer_payload TEXT"
            )
        )
    if _sqlite_has_table(connection, "student_task_progress") and not _sqlite_has_column(
        connection, "student_task_progress", "last_feedback_json"
    ):
        connection.execute(
            text(
                "ALTER TABLE student_task_progress "
                "ADD COLUMN last_feedback_json TEXT"
            )
        )


async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    async with get_async_session_maker()() as session:
        yield session


async def init_db() -> None:
    async with get_async_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
        if settings.SQLITE.async_DSN.startswith("sqlite"):
            await connection.run_sync(_sync_sqlite_schema)


async def drop_db() -> None:
    async with get_async_engine().begin() as connection:
        await connection.run_sync(Base.metadata.drop_all)
