import json
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace
from uuid import uuid4

from app.models.enums import (
    CompetenceType,
    KnowledgeElementRelationType,
    LearningTrajectoryTaskType,
    StudentTaskProgressStatus,
)
from app.services import learning_tasks


def _make_task(
    *,
    primary_element_id,
    difficulty: int = 30,
    threshold: int = 70,
    task_type: LearningTrajectoryTaskType = LearningTrajectoryTaskType.SINGLE_CHOICE,
    competence_type: CompetenceType = CompetenceType.KNOW,
    related_element_ids: list | None = None,
    checked_relation_pairs: list[tuple[object, object]] | None = None,
):
    return SimpleNamespace(
        id=uuid4(),
        primary_element_id=primary_element_id,
        difficulty=difficulty,
        created_at=datetime.now(UTC),
        task_type=task_type,
        trajectory_topic=SimpleNamespace(
            elements=[
                SimpleNamespace(
                    element_id=primary_element_id,
                    threshold=threshold,
                )
            ]
        ),
        trajectory=SimpleNamespace(topics=[]),
        primary_element=SimpleNamespace(
            id=primary_element_id,
            competence_type=competence_type,
        ),
        related_elements=[
            SimpleNamespace(element_id=element_id)
            for element_id in (related_element_ids or [])
        ],
        checked_relations=[
            SimpleNamespace(
                relation=SimpleNamespace(
                    source_element_id=source_id,
                    target_element_id=target_id,
                    relation_type=KnowledgeElementRelationType.REQUIRES,
                )
            )
            for source_id, target_id in (checked_relation_pairs or [])
        ],
    )


def _make_progress(
    *,
    status=StudentTaskProgressStatus.IN_PROGRESS,
    attempts_count: int = 0,
    last_score: int | None = None,
    best_score: int | None = None,
    minutes_ago: int = 0,
    feedback: dict | None = None,
):
    resolved_feedback = feedback
    if resolved_feedback is None and last_score is not None and last_score < 100:
        resolved_feedback = {
            "adaptive_signal": {
                "kind": "error",
                "error_signature": "test:error",
                "focus_element_ids": [],
            }
        }
    return SimpleNamespace(
        status=status,
        attempts_count=attempts_count,
        last_score=last_score,
        best_score=best_score if best_score is not None else last_score,
        last_answered_at=datetime.now(UTC) - timedelta(minutes=minutes_ago),
        last_feedback_json=json.dumps(resolved_feedback) if resolved_feedback is not None else None,
    )


def test_build_student_task_content_from_snapshot_shuffles_choice_options_with_seed(monkeypatch):
    used_seeds: list[str] = []

    class ReverseRandom:
        def __init__(self, seed):
            used_seeds.append(seed)

        def shuffle(self, items):
            items.reverse()

    monkeypatch.setattr(learning_tasks.random, "Random", ReverseRandom)

    task = SimpleNamespace(
        id=uuid4(),
        task_type=LearningTrajectoryTaskType.SINGLE_CHOICE,
    )
    content = {
        "options": [
            {"id": "1", "text": "A", "is_correct": False},
            {"id": "2", "text": "B", "is_correct": True},
            {"id": "3", "text": "C", "is_correct": False},
        ]
    }

    result = learning_tasks.build_student_task_content_from_snapshot(
        task,
        content,
        seed="instance-seed",
    )

    assert used_seeds == ["instance-seed"]
    assert [option["id"] for option in result["options"]] == ["3", "2", "1"]
    assert result["debug_solution"]["correct_option_ids"] == ["2"]


def test_build_adaptive_candidate_pool_keeps_failed_element_after_threshold_reached():
    primary_element_id = uuid4()
    task = _make_task(primary_element_id=primary_element_id, threshold=70)
    progress = _make_progress(attempts_count=1, last_score=20)

    candidates = learning_tasks.build_adaptive_candidate_pool(
        [task],
        mastery_by_element_id={primary_element_id: 95},
        progress_by_task_id={task.id: progress},
        outgoing_by_source={},
    )

    assert candidates == [(task, progress)]


def test_select_next_task_prioritizes_recent_failed_primary_element():
    failed_element_id = uuid4()
    stronger_element_id = uuid4()
    failed_task = _make_task(primary_element_id=failed_element_id, threshold=70, difficulty=30)
    stronger_task = _make_task(primary_element_id=stronger_element_id, threshold=90, difficulty=30)
    failed_progress = _make_progress(attempts_count=1, last_score=10, minutes_ago=0)

    selected = learning_tasks.select_next_task(
        [
            (failed_task, failed_progress),
            (stronger_task, None),
        ],
        mastery_by_element_id={
            failed_element_id: 85,
            stronger_element_id: 0,
        },
        degree_by_element_id={},
    )

    assert selected is not None
    assert selected[0].primary_element_id == failed_element_id


def test_select_next_task_chooses_random_among_equal_candidates(monkeypatch):
    first_task = _make_task(primary_element_id=uuid4(), threshold=70, difficulty=30)
    second_task = _make_task(primary_element_id=uuid4(), threshold=70, difficulty=30)
    seen_candidate_ids: list[object] = []

    def pick_last(items):
        seen_candidate_ids.extend(item[0].id for item in items)
        return items[-1]

    monkeypatch.setattr(learning_tasks.random, "choice", pick_last)

    selected = learning_tasks.select_next_task(
        [
            (first_task, None),
            (second_task, None),
        ],
        mastery_by_element_id={
            first_task.primary_element_id: 20,
            second_task.primary_element_id: 20,
        },
        degree_by_element_id={},
    )

    assert selected is not None
    assert seen_candidate_ids == [first_task.id, second_task.id]
    assert selected[0].id == second_task.id


def test_derive_adaptive_error_details_for_single_choice_returns_wrong_option():
    task = _make_task(primary_element_id=uuid4(), task_type=LearningTrajectoryTaskType.SINGLE_CHOICE)

    result = learning_tasks.derive_adaptive_error_details(
        task,
        {"selected_option_ids": ["wrong-id"]},
        {"is_correct": False},
    )

    assert result == ("choice:wrong_option:wrong-id", ["wrong-id"])


def test_derive_adaptive_error_details_for_multiple_choice_tracks_extra_and_missed():
    task = _make_task(primary_element_id=uuid4(), task_type=LearningTrajectoryTaskType.MULTIPLE_CHOICE)

    result = learning_tasks.derive_adaptive_error_details(
        task,
        {"selected_option_ids": ["extra-id", "correct-a"]},
        {"correct_option_ids": ["correct-a", "correct-b"]},
    )

    assert result == (
        "multiple:extra:extra-id|missed:correct-b",
        ["correct-b", "extra-id"],
    )


def test_derive_adaptive_error_details_for_matching_tracks_mismatch_pair():
    task = _make_task(primary_element_id=uuid4(), task_type=LearningTrajectoryTaskType.MATCHING)

    result = learning_tasks.derive_adaptive_error_details(
        task,
        {"pairings": [{"left_id": "left-a", "right_id": "right-b"}]},
        {},
    )

    assert result == (
        "matching:left-a->right-b",
        ["left-a", "right-b"],
    )


def test_derive_adaptive_error_details_for_ordering_tracks_first_wrong_position():
    task = _make_task(primary_element_id=uuid4(), task_type=LearningTrajectoryTaskType.ORDERING)

    result = learning_tasks.derive_adaptive_error_details(
        task,
        {"ordered_item_ids": ["actual-a", "expected-b"]},
        {"correct_order_ids": ["expected-a", "expected-b"]},
    )

    assert result == (
        "ordering:position:0:expected:expected-a:actual:actual-a",
        ["expected-a", "actual-a"],
    )


def test_task_stage_unlocked_requires_mastery_or_successful_basic_sibling():
    primary_element_id = uuid4()
    advanced_task = _make_task(primary_element_id=primary_element_id, difficulty=65)
    basic_sibling = _make_task(primary_element_id=primary_element_id, difficulty=20)

    assert not learning_tasks.task_stage_unlocked(
        advanced_task,
        mastery_by_element_id={primary_element_id: 20},
        sibling_tasks=[advanced_task, basic_sibling],
        progress_by_task_id={},
    )

    assert learning_tasks.task_stage_unlocked(
        advanced_task,
        mastery_by_element_id={primary_element_id: 20},
        sibling_tasks=[advanced_task, basic_sibling],
        progress_by_task_id={
                basic_sibling.id: _make_progress(
                    status=StudentTaskProgressStatus.COMPLETED,
                    attempts_count=1,
                    last_score=100,
                    best_score=100,
                )
            },
        )


def test_build_adaptive_candidate_pool_excludes_pending_review_tasks():
    primary_element_id = uuid4()
    task = _make_task(primary_element_id=primary_element_id)
    pending_progress = _make_progress(
        status=StudentTaskProgressStatus.PENDING_REVIEW,
        attempts_count=1,
        last_score=None,
    )

    candidates = learning_tasks.build_adaptive_candidate_pool(
        [task],
        mastery_by_element_id={primary_element_id: 10},
        progress_by_task_id={task.id: pending_progress},
        outgoing_by_source={},
    )

    assert candidates == []


def test_build_adaptive_candidate_pool_keeps_fragile_success_after_threshold_reached():
    primary_element_id = uuid4()
    task = _make_task(primary_element_id=primary_element_id, threshold=70)
    fragile_progress = _make_progress(
        attempts_count=1,
        last_score=100,
        feedback={
            "adaptive_signal": {
                "kind": "fragile_success",
                "duration_seconds": 120,
                "expected_duration_seconds": 40,
            }
        },
    )

    candidates = learning_tasks.build_adaptive_candidate_pool(
        [task],
        mastery_by_element_id={primary_element_id: 90},
        progress_by_task_id={task.id: fragile_progress},
        outgoing_by_source={},
    )

    assert candidates == [(task, fragile_progress)]


def test_prerequisites_ready_requires_minimum_mastery():
    primary_element_id = uuid4()
    prerequisite_element_id = uuid4()
    task = _make_task(primary_element_id=primary_element_id)
    relation = SimpleNamespace(
        relation_type=learning_tasks.KnowledgeElementRelationType.REQUIRES,
        target_element_id=prerequisite_element_id,
    )

    assert not learning_tasks.prerequisites_ready(
        task,
        mastery_by_element_id={prerequisite_element_id: 39},
        outgoing_by_source={primary_element_id: [relation]},
    )
    assert learning_tasks.prerequisites_ready(
        task,
        mastery_by_element_id={prerequisite_element_id: 40},
        outgoing_by_source={primary_element_id: [relation]},
    )


def test_select_next_task_prefers_candidate_matching_error_focus_elements():
    primary_element_id = uuid4()
    focus_element_id = uuid4()
    other_element_id = uuid4()
    focused_task = _make_task(
        primary_element_id=primary_element_id,
        threshold=70,
        related_element_ids=[focus_element_id],
    )
    other_task = _make_task(
        primary_element_id=primary_element_id,
        threshold=70,
        related_element_ids=[other_element_id],
    )
    error_progress = _make_progress(
        attempts_count=1,
        last_score=20,
        feedback={
            "adaptive_signal": {
                "kind": "error",
                "error_signature": "choice:wrong_option:x",
                "focus_element_ids": [str(focus_element_id)],
            }
        },
    )

    selected = learning_tasks.select_next_task(
        [
            (focused_task, error_progress),
            (other_task, None),
        ],
        mastery_by_element_id={
            primary_element_id: 85,
        },
        degree_by_element_id={},
    )

    assert selected is not None
    assert selected[0].id == focused_task.id


def test_select_next_task_uses_most_recent_failed_element_when_multiple_failed():
    older_failed_element_id = uuid4()
    recent_failed_element_id = uuid4()
    older_failed_task = _make_task(primary_element_id=older_failed_element_id, threshold=70)
    recent_failed_task = _make_task(primary_element_id=recent_failed_element_id, threshold=70)

    selected = learning_tasks.select_next_task(
        [
            (older_failed_task, _make_progress(attempts_count=1, last_score=10, minutes_ago=5)),
            (recent_failed_task, _make_progress(attempts_count=1, last_score=20, minutes_ago=0)),
        ],
        mastery_by_element_id={
            older_failed_element_id: 85,
            recent_failed_element_id: 85,
        },
        degree_by_element_id={},
    )

    assert selected is not None
    assert selected[0].primary_element_id == recent_failed_element_id


def test_task_matches_focus_elements_skips_unloaded_relationships(monkeypatch):
    class GuardedTask:
        primary_element_id = uuid4()

        @property
        def related_elements(self):
            raise AssertionError("related_elements should not be lazily accessed")

        @property
        def checked_relations(self):
            raise AssertionError("checked_relations should not be lazily accessed")

    class FakeInspection:
        unloaded = {"related_elements", "checked_relations"}

    monkeypatch.setattr(learning_tasks, "sa_inspect", lambda _task: FakeInspection())

    assert (
        learning_tasks._task_matches_focus_elements(GuardedTask(), {str(uuid4())})
        is False
    )


def test_is_fragile_success_detects_slow_but_correct_answer():
    task = _make_task(primary_element_id=uuid4(), difficulty=20)

    assert learning_tasks.is_fragile_success(task, score=100, duration_seconds=80) is True
    assert learning_tasks.is_fragile_success(task, score=100, duration_seconds=20) is False
    assert learning_tasks.is_fragile_success(task, score=80, duration_seconds=80) is False


def test_expected_duration_seconds_is_longer_for_can_stage():
    know_task = _make_task(
        primary_element_id=uuid4(),
        difficulty=30,
        competence_type=CompetenceType.KNOW,
    )
    can_task = _make_task(
        primary_element_id=uuid4(),
        difficulty=30,
        competence_type=CompetenceType.CAN,
    )

    know_duration = learning_tasks.expected_duration_seconds(know_task)
    can_duration = learning_tasks.expected_duration_seconds(can_task)

    assert know_duration is not None
    assert can_duration is not None
    assert can_duration > know_duration
    assert can_duration >= 60


def test_master_stage_disables_duration_tracking_and_fragile_success():
    master_task = _make_task(
        primary_element_id=uuid4(),
        difficulty=30,
        competence_type=CompetenceType.MASTER,
        task_type=LearningTrajectoryTaskType.TEXT,
    )

    assert learning_tasks.duration_tracking_enabled(master_task) is False
    assert learning_tasks.expected_duration_seconds(master_task) is None
    assert learning_tasks.is_fragile_success(master_task, score=100, duration_seconds=999) is False

    feedback = learning_tasks.enrich_feedback_for_adaptive_control(
        master_task,
        answer_payload={"text": "answer"},
        feedback={"is_correct": True, "message": "ok"},
        score=100,
        duration_seconds=999,
    )

    assert "duration_seconds" not in feedback
    assert "adaptive_signal" not in feedback
