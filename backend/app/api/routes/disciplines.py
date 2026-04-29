from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import lazyload, selectinload

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
from app.core.slugs import build_unique_discipline_slug
from app.models import (
    Discipline,
    Group,
    GroupDiscipline,
    KnowledgeElement,
    KnowledgeElementRelation,
    Teacher,
    TeacherDiscipline,
    TeacherGroup,
    Topic,
    TopicDependency,
    TopicKnowledgeElement,
)
from app.schemas import (
    DisciplineCreate,
    DisciplineKnowledgeGraphRead,
    DisciplineRead,
    KnowledgeElementRead,
    KnowledgeElementRelationRead,
    TopicDependencyRead,
    TopicKnowledgeElementRead,
    TopicRead,
)


router = APIRouter(prefix="/disciplines", tags=["Disciplines"])


async def _build_discipline_reads(
    rows: list[tuple[UUID, str, str, int]],
    session: DbSession,
) -> list[DisciplineRead]:
    if not rows:
        return []

    discipline_ids = [row[0] for row in rows]
    teacher_links_result = await session.execute(
        select(
            TeacherDiscipline.discipline_id,
            TeacherDiscipline.teacher_id,
        ).where(TeacherDiscipline.discipline_id.in_(discipline_ids))
    )
    group_links_result = await session.execute(
        select(
            GroupDiscipline.discipline_id,
            GroupDiscipline.group_id,
        ).where(GroupDiscipline.discipline_id.in_(discipline_ids))
    )

    teacher_ids_by_discipline: dict[UUID, list[UUID]] = {
        discipline_id: [] for discipline_id in discipline_ids
    }
    group_ids_by_discipline: dict[UUID, list[UUID]] = {
        discipline_id: [] for discipline_id in discipline_ids
    }

    for discipline_id, teacher_id in teacher_links_result.all():
        teacher_ids_by_discipline.setdefault(discipline_id, []).append(teacher_id)
    for discipline_id, group_id in group_links_result.all():
        group_ids_by_discipline.setdefault(discipline_id, []).append(group_id)

    return [
        DisciplineRead(
            id=discipline_id,
            name=name,
            slug=slug,
            knowledge_graph_version=knowledge_graph_version,
            teacher_ids=teacher_ids_by_discipline.get(discipline_id, []),
            group_ids=group_ids_by_discipline.get(discipline_id, []),
        )
        for discipline_id, name, slug, knowledge_graph_version in rows
    ]


def _discipline_identifier_filter(discipline_identifier: str):
    try:
        discipline_uuid = UUID(discipline_identifier)
    except ValueError:
        return Discipline.slug == discipline_identifier
    return or_(
        Discipline.id == discipline_uuid,
        Discipline.slug == discipline_identifier,
    )


async def get_discipline_for_read(
    discipline_identifier: str,
    session: DbSession,
) -> DisciplineRead:
    result = await session.execute(
        select(
            Discipline.id,
            Discipline.name,
            Discipline.slug,
            Discipline.knowledge_graph_version,
        )
        .where(_discipline_identifier_filter(discipline_identifier))
    )
    row = result.one_or_none()
    if row is None:
        raise not_found("Discipline", discipline_identifier)
    return (await _build_discipline_reads([row], session))[0]


async def get_discipline_model(
    discipline_identifier: str,
    session: DbSession,
) -> Discipline:
    result = await session.execute(
        select(Discipline)
        .options(lazyload("*"))
        .where(_discipline_identifier_filter(discipline_identifier))
    )
    discipline = result.scalar_one_or_none()
    if discipline is None:
        raise not_found("Discipline", discipline_identifier)
    return discipline


@router.get("/", response_model=list[DisciplineRead])
async def list_disciplines(session: DbSession) -> list[DisciplineRead]:
    result = await session.execute(
        select(
            Discipline.id,
            Discipline.name,
            Discipline.slug,
            Discipline.knowledge_graph_version,
        )
        .order_by(Discipline.name)
    )
    return await _build_discipline_reads(list(result.all()), session)


@router.post("/", response_model=DisciplineRead, status_code=status.HTTP_201_CREATED)
async def create_discipline(payload: DisciplineCreate, session: DbSession) -> DisciplineRead:
    discipline = Discipline(
        name=payload.name,
        slug=await build_unique_discipline_slug(session, payload.name),
    )
    session.add(discipline)

    if payload.teacher_id is not None:
        teacher = await session.get(Teacher, payload.teacher_id)
        if teacher is None:
            raise not_found("Teacher", payload.teacher_id)

    group_ids = list(dict.fromkeys(payload.group_ids))
    for group_id in group_ids:
        group = await session.get(Group, group_id)
        if group is None:
            raise not_found("Group", group_id)

    await session.flush()

    if payload.teacher_id is not None:
        session.add(
            TeacherDiscipline(
                teacher_id=payload.teacher_id,
                discipline_id=discipline.id,
            )
        )

    for group_id in group_ids:
        session.add(GroupDiscipline(group_id=group_id, discipline_id=discipline.id))

        if payload.teacher_id is not None:
            existing_link = await session.execute(
                select(TeacherGroup).where(
                    and_(
                        TeacherGroup.teacher_id == payload.teacher_id,
                        TeacherGroup.group_id == group_id,
                    )
                )
            )
            if existing_link.scalar_one_or_none() is None:
                session.add(TeacherGroup(teacher_id=payload.teacher_id, group_id=group_id))

    await commit_or_409(session)
    return await get_discipline_for_read(str(discipline.id), session)


@router.get("/{discipline_identifier}", response_model=DisciplineRead)
async def get_discipline(discipline_identifier: str, session: DbSession) -> DisciplineRead:
    return await get_discipline_for_read(discipline_identifier, session)


@router.get(
    "/{discipline_identifier}/knowledge-graph",
    response_model=DisciplineKnowledgeGraphRead,
)
async def get_discipline_knowledge_graph(
    discipline_identifier: str,
    session: DbSession,
) -> DisciplineKnowledgeGraphRead:
    discipline_model = await get_discipline_model(discipline_identifier, session)
    discipline_id = discipline_model.id
    discipline = await get_discipline_for_read(str(discipline_id), session)

    topics_result = await session.execute(
        select(Topic)
        .options(lazyload("*"))
        .where(Topic.discipline_id == discipline_id)
        .order_by(Topic.name)
    )
    topics = list(topics_result.scalars().all())
    topic_ids = [topic.id for topic in topics]

    topic_dependencies: list[TopicDependency] = []
    topic_knowledge_elements: list[TopicKnowledgeElement] = []
    knowledge_elements: list[KnowledgeElement] = []
    knowledge_element_relations: list[KnowledgeElementRelation] = []

    if topic_ids:
        dependencies_result = await session.execute(
            select(TopicDependency)
            .options(lazyload("*"))
            .where(
                and_(
                    TopicDependency.prerequisite_topic_id.in_(topic_ids),
                    TopicDependency.dependent_topic_id.in_(topic_ids),
                )
            )
            .order_by(TopicDependency.id)
        )
        topic_dependencies = list(dependencies_result.scalars().all())

        topic_elements_result = await session.execute(
            select(TopicKnowledgeElement)
            .options(lazyload("*"))
            .where(TopicKnowledgeElement.topic_id.in_(topic_ids))
            .order_by(TopicKnowledgeElement.topic_id, TopicKnowledgeElement.id)
        )
        topic_knowledge_elements = list(topic_elements_result.scalars().all())

        element_ids = [item.element_id for item in topic_knowledge_elements]
        if element_ids:
            elements_result = await session.execute(
                select(KnowledgeElement)
                .options(lazyload("*"))
                .where(
                    and_(
                        KnowledgeElement.id.in_(element_ids),
                        KnowledgeElement.discipline_id == discipline_id,
                    )
                )
                .order_by(
                    KnowledgeElement.competence_type,
                    KnowledgeElement.name,
                )
            )
            knowledge_elements = list(elements_result.scalars().all())

            relations_result = await session.execute(
                select(KnowledgeElementRelation)
                .options(selectinload(KnowledgeElementRelation.relation))
                .where(
                    and_(
                        KnowledgeElementRelation.source_element_id.in_(element_ids),
                        KnowledgeElementRelation.target_element_id.in_(element_ids),
                    )
                )
                .order_by(KnowledgeElementRelation.id)
            )
            knowledge_element_relations = list(relations_result.scalars().all())
    # print (DisciplineKnowledgeGraphRead(
    #     discipline=DisciplineRead.model_validate(discipline),
    #     topics=[TopicRead.model_validate(item) for item in topics],
    #     topic_dependencies=[
    #         TopicDependencyRead.model_validate(item) for item in topic_dependencies
    #     ],
    #     knowledge_elements=[
    #         KnowledgeElementRead.model_validate(item) for item in knowledge_elements
    #     ],
    #     topic_knowledge_elements=[
    #         TopicKnowledgeElementRead.model_validate(item)
    #         for item in topic_knowledge_elements
    #     ],
    #     knowledge_element_relations=[
    #         KnowledgeElementRelationRead.model_validate(item)
    #         for item in knowledge_element_relations
    #     ],
    # ))
    return DisciplineKnowledgeGraphRead(
        discipline=discipline,
        topics=[TopicRead.model_validate(item) for item in topics],
        topic_dependencies=[
            TopicDependencyRead.model_validate(item) for item in topic_dependencies
        ],
        knowledge_elements=[
            KnowledgeElementRead.model_validate(item) for item in knowledge_elements
        ],
        topic_knowledge_elements=[
            TopicKnowledgeElementRead.model_validate(item)
            for item in topic_knowledge_elements
        ],
        knowledge_element_relations=[
            KnowledgeElementRelationRead.model_validate(item)
            for item in knowledge_element_relations
        ],
    )


@router.delete("/{discipline_identifier}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_discipline(discipline_identifier: str, session: DbSession) -> None:
    discipline = await get_discipline_model(discipline_identifier, session)
    await delete_and_commit(session, discipline)
