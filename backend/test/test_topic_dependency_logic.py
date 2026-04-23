from types import SimpleNamespace
from uuid import uuid4

from app.models.enums import TopicKnowledgeElementRole
from app.services.topic_dependencies import (
    calculate_topic_dependency_pairs,
    find_topic_dependency_cycle,
)


def test_calculate_topic_dependency_pairs_uses_prerequisite_dependent_direction():
    prerequisite_topic_id = uuid4()
    dependent_topic_id = uuid4()
    shared_element_id = uuid4()

    pairs = calculate_topic_dependency_pairs(
        topics=[
            SimpleNamespace(id=prerequisite_topic_id),
            SimpleNamespace(id=dependent_topic_id),
        ],
        topic_knowledge_elements=[
            SimpleNamespace(
                topic_id=prerequisite_topic_id,
                element_id=shared_element_id,
                role=TopicKnowledgeElementRole.FORMED,
            ),
            SimpleNamespace(
                topic_id=dependent_topic_id,
                element_id=shared_element_id,
                role=TopicKnowledgeElementRole.REQUIRED,
            ),
        ],
    )

    assert pairs == {(prerequisite_topic_id, dependent_topic_id)}


def test_find_topic_dependency_cycle_returns_empty_list_for_acyclic_graph():
    topic_a_id = uuid4()
    topic_b_id = uuid4()
    topic_c_id = uuid4()

    assert find_topic_dependency_cycle(
        {
            (topic_a_id, topic_b_id),
            (topic_b_id, topic_c_id),
        }
    ) == []


def test_find_topic_dependency_cycle_detects_closed_loop():
    topic_a_id = uuid4()
    topic_b_id = uuid4()
    topic_c_id = uuid4()

    cycle = find_topic_dependency_cycle(
        {
            (topic_a_id, topic_b_id),
            (topic_b_id, topic_c_id),
            (topic_c_id, topic_a_id),
        }
    )

    assert cycle[0] == cycle[-1]
    assert {topic_a_id, topic_b_id, topic_c_id}.issubset(set(cycle))
