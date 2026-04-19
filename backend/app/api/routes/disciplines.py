from uuid import UUID

from fastapi import APIRouter, status
from sqlalchemy import and_, select
from sqlalchemy.orm import selectinload

from app.api.crud import commit_or_409, delete_and_commit, not_found
from app.api.deps import DbSession
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


def _discipline_read_options():
    return (
        selectinload(Discipline.teacher_links),
        selectinload(Discipline.group_links),
    )


async def get_discipline_for_read(
    discipline_id: UUID,
    session: DbSession,
) -> Discipline:
    result = await session.execute(
        select(Discipline)
        .options(*_discipline_read_options())
        .where(Discipline.id == discipline_id)
    )
    discipline = result.scalar_one_or_none()
    if discipline is None:
        raise not_found("Discipline", discipline_id)
    return discipline


@router.get("/", response_model=list[DisciplineRead])
async def list_disciplines(session: DbSession) -> list[Discipline]:
    result = await session.execute(
        select(Discipline)
        .options(*_discipline_read_options())
        .order_by(Discipline.name)
    )
    return list(result.scalars().all())


@router.post("/", response_model=DisciplineRead, status_code=status.HTTP_201_CREATED)
async def create_discipline(payload: DisciplineCreate, session: DbSession) -> Discipline:
    discipline = Discipline(name=payload.name)
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
    return await get_discipline_for_read(discipline.id, session)


@router.get("/{discipline_id}", response_model=DisciplineRead)
async def get_discipline(discipline_id: UUID, session: DbSession) -> Discipline:
    return await get_discipline_for_read(discipline_id, session)


@router.get(
    "/{discipline_id}/knowledge-graph",
    response_model=DisciplineKnowledgeGraphRead,
)
async def get_discipline_knowledge_graph(
    discipline_id: UUID,
    session: DbSession,
) -> DisciplineKnowledgeGraphRead:
    discipline = await get_discipline_for_read(discipline_id, session)

    topics_result = await session.execute(
        select(Topic)
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
            .where(TopicKnowledgeElement.topic_id.in_(topic_ids))
            .order_by(TopicKnowledgeElement.topic_id, TopicKnowledgeElement.id)
        )
        topic_knowledge_elements = list(topic_elements_result.scalars().all())

        element_ids = [item.element_id for item in topic_knowledge_elements]
        if element_ids:
            elements_result = await session.execute(
                select(KnowledgeElement)
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
        discipline=DisciplineRead.model_validate(discipline),
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


@router.delete("/{discipline_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_discipline(discipline_id: UUID, session: DbSession) -> None:
    discipline = await session.get(Discipline, discipline_id)
    if discipline is None:
        raise not_found("Discipline", discipline_id)
    await delete_and_commit(session, discipline)
