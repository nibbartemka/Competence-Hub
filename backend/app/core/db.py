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


__all__ = [
    'Base',
    'get_async_session',
    'init_db',
    'drop_db',
]


Base = declarative_base()

async_engine: AsyncEngine | None = None
AsyncSessionLocal: async_sessionmaker[AsyncSession] | None = None


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
                relation_type VARCHAR(14) NOT NULL,
                PRIMARY KEY (id),
                CONSTRAINT uq_knowledge_element_relation
                    UNIQUE (source_element_id, target_element_id, relation_type),
                CONSTRAINT ck_knowledge_element_relation_not_self
                    CHECK (source_element_id != target_element_id),
                FOREIGN KEY(source_element_id)
                    REFERENCES knowledge_elements (id) ON DELETE CASCADE,
                FOREIGN KEY(target_element_id)
                    REFERENCES knowledge_elements (id) ON DELETE CASCADE
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
                relation_type
            )
            SELECT
                lower(hex(randomblob(16))),
                knowledge_element_relations.description,
                source_map.new_id,
                target_map.new_id,
                knowledge_element_relations.relation_type
            FROM knowledge_element_relations
            JOIN knowledge_element_discipline_map AS source_map
                ON source_map.old_id =
                knowledge_element_relations.source_element_id
            JOIN knowledge_element_discipline_map AS target_map
                ON target_map.old_id =
                knowledge_element_relations.target_element_id
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


def _sync_sqlite_schema(connection) -> None:
    # Keep local SQLite schema compatible with the current SQLAlchemy models.
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
    if _sqlite_has_table(connection, "knowledge_elements") and not _sqlite_has_column(
        connection, "knowledge_elements", "discipline_id"
    ):
        _rebuild_knowledge_elements_table(connection)
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
