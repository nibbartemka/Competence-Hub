from types import SimpleNamespace
from uuid import uuid4

import pytest

from app.api.routes import learning_control
from app.models.enums import CompetenceType, LearningTrajectoryStatus, LearningTrajectoryTaskType, TopicKnowledgeElementRole


def _make_element(*, name: str, competence_type: CompetenceType):
    return SimpleNamespace(
        id=uuid4(),
        name=name,
        competence_type=competence_type,
    )


def _make_topic_link(element, role: TopicKnowledgeElementRole):
    return SimpleNamespace(
        element_id=element.id,
        element=element,
        role=role,
    )


def _make_topic(*, name: str, element_links: list | None = None):
    return SimpleNamespace(
        id=uuid4(),
        name=name,
        element_links=element_links or [],
    )


def _make_trajectory_element(element, threshold: int):
    return SimpleNamespace(
        element_id=element.id,
        element=element,
        threshold=threshold,
    )


def _make_trajectory_topic(*, topic, position: int, threshold: int, elements: list):
    return SimpleNamespace(
        id=uuid4(),
        topic_id=topic.id,
        topic=topic,
        position=position,
        threshold=threshold,
        elements=elements,
    )


def _make_trajectory(*, discipline_name: str, topics: list, group_id, subgroup_id=None):
    return SimpleNamespace(
        id=uuid4(),
        name="Trajectory",
        discipline_id=uuid4(),
        discipline=SimpleNamespace(name=discipline_name),
        teacher=SimpleNamespace(name="Teacher"),
        status=LearningTrajectoryStatus.ACTIVE,
        group_id=group_id,
        subgroup_id=subgroup_id,
        topics=topics,
    )


def _make_task(*, trajectory, trajectory_topic, primary_element):
    return SimpleNamespace(
        id=uuid4(),
        trajectory_id=trajectory.id,
        trajectory_topic_id=trajectory_topic.id,
        trajectory_topic=trajectory_topic,
        trajectory=trajectory,
        primary_element=primary_element,
        primary_element_id=primary_element.id,
        task_type=LearningTrajectoryTaskType.SINGLE_CHOICE,
        template_kind="manual",
        title="Task title",
        prompt="Task prompt",
        difficulty=30,
        created_at=0,
        related_elements=[],
        checked_relations=[],
    )


async def _noop_commit(_session):
    return None


def _build_assigned_task_payload(task, mastery_value: int = 0):
    return {
        "id": task.id,
        "task_instance_id": uuid4(),
        "trajectory_id": task.trajectory.id,
        "trajectory_name": task.trajectory.name,
        "teacher_name": task.trajectory.teacher.name,
        "discipline_id": task.trajectory.discipline_id,
        "discipline_name": task.trajectory.discipline.name,
        "topic_id": task.trajectory_topic.topic_id,
        "topic_name": task.trajectory_topic.topic.name,
        "title": task.title,
        "prompt": task.prompt,
        "difficulty": task.difficulty,
        "task_type": task.task_type,
        "template_kind": task.template_kind,
        "content": {},
        "primary_element": {
            "element_id": task.primary_element.id,
            "name": task.primary_element.name,
            "mastery_value": mastery_value,
        },
        "related_elements": [],
        "checked_relations": [],
        "progress": {
            "status": "not_started",
            "attempts_count": 0,
            "last_score": None,
            "best_score": None,
            "completed_at": None,
            "last_answer_payload": None,
            "last_feedback": None,
        },
        "recommendation_score": None,
    }


@pytest.mark.anyio
async def test_build_student_topic_control_shows_skill_stage_and_next_topic_prompt(monkeypatch):
    group_id = uuid4()
    student = SimpleNamespace(id=uuid4(), group_id=group_id, subgroup_id=None)
    know_element = _make_element(name="Know", competence_type=CompetenceType.KNOW)
    can_element = _make_element(name="Can", competence_type=CompetenceType.CAN)
    next_know_element = _make_element(name="Next Know", competence_type=CompetenceType.KNOW)

    current_topic = _make_topic(name="Topic 1")
    next_topic = _make_topic(
        name="Topic 2",
        element_links=[_make_topic_link(know_element, TopicKnowledgeElementRole.REQUIRED)],
    )
    current_trajectory_topic = _make_trajectory_topic(
        topic=current_topic,
        position=1,
        threshold=60,
        elements=[
            _make_trajectory_element(know_element, 60),
            _make_trajectory_element(can_element, 70),
        ],
    )
    next_trajectory_topic = _make_trajectory_topic(
        topic=next_topic,
        position=2,
        threshold=65,
        elements=[_make_trajectory_element(next_know_element, 65)],
    )
    trajectory = _make_trajectory(
        discipline_name="Adaptive Control",
        topics=[current_trajectory_topic, next_trajectory_topic],
        group_id=group_id,
    )
    know_task = _make_task(
        trajectory=trajectory,
        trajectory_topic=current_trajectory_topic,
        primary_element=know_element,
    )
    can_task = _make_task(
        trajectory=trajectory,
        trajectory_topic=current_trajectory_topic,
        primary_element=can_element,
    )

    async def get_student(*args, **kwargs):
        return student

    async def get_trajectory(*args, **kwargs):
        return trajectory

    async def load_mastery(*args, **kwargs):
        return {
            know_element.id: 60,
            can_element.id: 20,
            next_know_element.id: 0,
        }

    async def load_tasks(*args, **kwargs):
        return [know_task, can_task]

    async def load_progress(*args, **kwargs):
        return {}

    async def load_relations(*args, **kwargs):
        return ({}, {})

    monkeypatch.setattr(learning_control, "_get_student_for_control", get_student)
    monkeypatch.setattr(learning_control, "_get_trajectory_for_control", get_trajectory)
    monkeypatch.setattr(learning_control, "_load_control_mastery_map", load_mastery)
    monkeypatch.setattr(learning_control, "_load_control_tasks", load_tasks)
    monkeypatch.setattr(learning_control, "_load_control_progress", load_progress)
    monkeypatch.setattr(learning_control, "_load_control_relation_map", load_relations)

    result = await learning_control._build_student_topic_control(
        student.id,
        trajectory.id,
        session=object(),
        topic_id=current_topic.id,
    )

    assert result.is_unlocked is True
    assert result.knowledge_threshold_passed is True
    assert result.skill_practice_available is True
    assert result.show_next_topic_prompt is True
    assert result.next_topic is not None
    assert result.next_topic.is_unlocked is True


@pytest.mark.anyio
async def test_build_student_topic_control_opens_master_stage_after_skill_threshold(monkeypatch):
    group_id = uuid4()
    student = SimpleNamespace(id=uuid4(), group_id=group_id, subgroup_id=None)
    can_element = _make_element(name="Can", competence_type=CompetenceType.CAN)
    master_element = _make_element(name="Master", competence_type=CompetenceType.MASTER)
    topic = _make_topic(name="Topic")
    trajectory_topic = _make_trajectory_topic(
        topic=topic,
        position=1,
        threshold=70,
        elements=[
            _make_trajectory_element(can_element, 70),
            _make_trajectory_element(master_element, 80),
        ],
    )
    trajectory = _make_trajectory(
        discipline_name="Adaptive Control",
        topics=[trajectory_topic],
        group_id=group_id,
    )
    can_task = _make_task(trajectory=trajectory, trajectory_topic=trajectory_topic, primary_element=can_element)
    master_task = _make_task(trajectory=trajectory, trajectory_topic=trajectory_topic, primary_element=master_element)

    async def get_student(*args, **kwargs):
        return student

    async def get_trajectory(*args, **kwargs):
        return trajectory

    async def load_mastery(*args, **kwargs):
        return {
            can_element.id: 70,
            master_element.id: 10,
        }

    async def load_tasks(*args, **kwargs):
        return [can_task, master_task]

    async def load_progress(*args, **kwargs):
        return {}

    async def load_relations(*args, **kwargs):
        return ({}, {})

    monkeypatch.setattr(learning_control, "_get_student_for_control", get_student)
    monkeypatch.setattr(learning_control, "_get_trajectory_for_control", get_trajectory)
    monkeypatch.setattr(learning_control, "_load_control_mastery_map", load_mastery)
    monkeypatch.setattr(learning_control, "_load_control_tasks", load_tasks)
    monkeypatch.setattr(learning_control, "_load_control_progress", load_progress)
    monkeypatch.setattr(learning_control, "_load_control_relation_map", load_relations)

    result = await learning_control._build_student_topic_control(
        student.id,
        trajectory.id,
        session=object(),
        topic_id=topic.id,
        practice_stage="can",
    )

    assert result.practice_stage == "can"
    assert result.skill_threshold_passed is True
    assert result.master_practice_available is True


@pytest.mark.anyio
async def test_build_student_topic_control_falls_back_to_know_stage_for_invalid_stage(monkeypatch):
    group_id = uuid4()
    student = SimpleNamespace(id=uuid4(), group_id=group_id, subgroup_id=None)
    know_element = _make_element(name="Know", competence_type=CompetenceType.KNOW)
    topic = _make_topic(name="Topic")
    trajectory_topic = _make_trajectory_topic(
        topic=topic,
        position=1,
        threshold=50,
        elements=[_make_trajectory_element(know_element, 50)],
    )
    trajectory = _make_trajectory(
        discipline_name="Adaptive Control",
        topics=[trajectory_topic],
        group_id=group_id,
    )
    know_task = _make_task(trajectory=trajectory, trajectory_topic=trajectory_topic, primary_element=know_element)
    instance = SimpleNamespace(id=uuid4(), content_snapshot_json="{}")

    async def get_student(*args, **kwargs):
        return student

    async def get_trajectory(*args, **kwargs):
        return trajectory

    async def load_mastery(*args, **kwargs):
        return {know_element.id: 10}

    async def load_tasks(*args, **kwargs):
        return [know_task]

    async def load_progress(*args, **kwargs):
        return {}

    async def load_relations(*args, **kwargs):
        return ({}, {})

    async def get_instance(*args, **kwargs):
        return instance

    async def get_task(*args, **kwargs):
        return know_task

    monkeypatch.setattr(learning_control, "_get_student_for_control", get_student)
    monkeypatch.setattr(learning_control, "_get_trajectory_for_control", get_trajectory)
    monkeypatch.setattr(learning_control, "_load_control_mastery_map", load_mastery)
    monkeypatch.setattr(learning_control, "_load_control_tasks", load_tasks)
    monkeypatch.setattr(learning_control, "_load_control_progress", load_progress)
    monkeypatch.setattr(learning_control, "_load_control_relation_map", load_relations)
    monkeypatch.setattr(learning_control, "_get_or_create_task_instance", get_instance)
    monkeypatch.setattr(learning_control, "commit_or_409", _noop_commit)
    monkeypatch.setattr(learning_control, "_get_task_for_read", get_task)
    monkeypatch.setattr(
        learning_control,
        "build_student_task_read",
        lambda **kwargs: _build_assigned_task_payload(kwargs["task"], mastery_value=10),
    )

    result = await learning_control._build_student_topic_control(
        student.id,
        trajectory.id,
        session=object(),
        topic_id=topic.id,
        practice_stage="unsupported",
    )

    assert result.practice_stage == "know"
    assert result.current_task is not None
    assert result.current_task.id == know_task.id


@pytest.mark.anyio
async def test_build_student_topic_control_offers_continue_practice_when_regular_pool_is_empty(monkeypatch):
    group_id = uuid4()
    student = SimpleNamespace(id=uuid4(), group_id=group_id, subgroup_id=None)
    know_element = _make_element(name="Know", competence_type=CompetenceType.KNOW)
    topic = _make_topic(name="Topic")
    trajectory_topic = _make_trajectory_topic(
        topic=topic,
        position=1,
        threshold=70,
        elements=[_make_trajectory_element(know_element, 70)],
    )
    trajectory = _make_trajectory(
        discipline_name="Adaptive Control",
        topics=[trajectory_topic],
        group_id=group_id,
    )
    know_task = _make_task(trajectory=trajectory, trajectory_topic=trajectory_topic, primary_element=know_element)

    async def get_student(*args, **kwargs):
        return student

    async def get_trajectory(*args, **kwargs):
        return trajectory

    async def load_mastery(*args, **kwargs):
        return {know_element.id: 70}

    async def load_tasks(*args, **kwargs):
        return [know_task]

    async def load_progress(*args, **kwargs):
        return {}

    async def load_relations(*args, **kwargs):
        return ({}, {})

    monkeypatch.setattr(learning_control, "_get_student_for_control", get_student)
    monkeypatch.setattr(learning_control, "_get_trajectory_for_control", get_trajectory)
    monkeypatch.setattr(learning_control, "_load_control_mastery_map", load_mastery)
    monkeypatch.setattr(learning_control, "_load_control_tasks", load_tasks)
    monkeypatch.setattr(learning_control, "_load_control_progress", load_progress)
    monkeypatch.setattr(learning_control, "_load_control_relation_map", load_relations)

    def fake_build_pool(tasks, mastery_by_element_id, progress_by_task_id, outgoing_by_source, **kwargs):
        if kwargs.get("ignore_target_mastery"):
            return [(know_task, None)]
        return []

    monkeypatch.setattr(learning_control, "build_adaptive_candidate_pool", fake_build_pool)

    result = await learning_control._build_student_topic_control(
        student.id,
        trajectory.id,
        session=object(),
        topic_id=topic.id,
    )

    assert result.current_task is None
    assert result.continue_practice_available is True
    assert result.is_extra_practice is False


@pytest.mark.anyio
async def test_build_student_topic_control_returns_task_in_continue_practice_mode(monkeypatch):
    group_id = uuid4()
    student = SimpleNamespace(id=uuid4(), group_id=group_id, subgroup_id=None)
    know_element = _make_element(name="Know", competence_type=CompetenceType.KNOW)
    topic = _make_topic(name="Topic")
    trajectory_topic = _make_trajectory_topic(
        topic=topic,
        position=1,
        threshold=70,
        elements=[_make_trajectory_element(know_element, 70)],
    )
    trajectory = _make_trajectory(
        discipline_name="Adaptive Control",
        topics=[trajectory_topic],
        group_id=group_id,
    )
    know_task = _make_task(trajectory=trajectory, trajectory_topic=trajectory_topic, primary_element=know_element)
    instance = SimpleNamespace(id=uuid4(), content_snapshot_json="{}")

    async def get_student(*args, **kwargs):
        return student

    async def get_trajectory(*args, **kwargs):
        return trajectory

    async def load_mastery(*args, **kwargs):
        return {know_element.id: 70}

    async def load_tasks(*args, **kwargs):
        return [know_task]

    async def load_progress(*args, **kwargs):
        return {}

    async def load_relations(*args, **kwargs):
        return ({}, {})

    async def get_instance(*args, **kwargs):
        return instance

    async def get_task(*args, **kwargs):
        return know_task

    monkeypatch.setattr(learning_control, "_get_student_for_control", get_student)
    monkeypatch.setattr(learning_control, "_get_trajectory_for_control", get_trajectory)
    monkeypatch.setattr(learning_control, "_load_control_mastery_map", load_mastery)
    monkeypatch.setattr(learning_control, "_load_control_tasks", load_tasks)
    monkeypatch.setattr(learning_control, "_load_control_progress", load_progress)
    monkeypatch.setattr(learning_control, "_load_control_relation_map", load_relations)
    monkeypatch.setattr(learning_control, "_get_or_create_task_instance", get_instance)
    monkeypatch.setattr(learning_control, "commit_or_409", _noop_commit)
    monkeypatch.setattr(learning_control, "_get_task_for_read", get_task)
    monkeypatch.setattr(
        learning_control,
        "build_student_task_read",
        lambda **kwargs: _build_assigned_task_payload(kwargs["task"], mastery_value=70),
    )

    result = await learning_control._build_student_topic_control(
        student.id,
        trajectory.id,
        session=object(),
        topic_id=topic.id,
        continue_practice=True,
    )

    assert result.is_extra_practice is True
    assert result.continue_practice_available is True
    assert result.current_task is not None
    assert result.current_task.id == know_task.id


@pytest.mark.anyio
async def test_build_student_topic_control_keeps_topic_locked_when_required_knowledge_is_missing(monkeypatch):
    group_id = uuid4()
    student = SimpleNamespace(id=uuid4(), group_id=group_id, subgroup_id=None)
    prerequisite_element = _make_element(name="Prerequisite", competence_type=CompetenceType.KNOW)
    current_element = _make_element(name="Current", competence_type=CompetenceType.KNOW)
    locked_topic = _make_topic(
        name="Locked Topic",
        element_links=[_make_topic_link(prerequisite_element, TopicKnowledgeElementRole.REQUIRED)],
    )
    current_trajectory_topic = _make_trajectory_topic(
        topic=locked_topic,
        position=2,
        threshold=60,
        elements=[_make_trajectory_element(current_element, 60)],
    )
    prerequisite_topic = _make_topic(name="Prerequisite Topic")
    prerequisite_trajectory_topic = _make_trajectory_topic(
        topic=prerequisite_topic,
        position=1,
        threshold=80,
        elements=[_make_trajectory_element(prerequisite_element, 80)],
    )
    trajectory = _make_trajectory(
        discipline_name="Adaptive Control",
        topics=[prerequisite_trajectory_topic, current_trajectory_topic],
        group_id=group_id,
    )

    async def get_student(*args, **kwargs):
        return student

    async def get_trajectory(*args, **kwargs):
        return trajectory

    async def load_mastery(*args, **kwargs):
        return {
            prerequisite_element.id: 50,
            current_element.id: 0,
        }

    monkeypatch.setattr(learning_control, "_get_student_for_control", get_student)
    monkeypatch.setattr(learning_control, "_get_trajectory_for_control", get_trajectory)
    monkeypatch.setattr(learning_control, "_load_control_mastery_map", load_mastery)

    result = await learning_control._build_student_topic_control(
        student.id,
        trajectory.id,
        session=object(),
        topic_id=locked_topic.id,
    )

    assert result.is_unlocked is False
    assert result.has_tasks is False
    assert result.current_task is None
