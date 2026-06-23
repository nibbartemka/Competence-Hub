from __future__ import annotations

import json

from app.algorithm_library.contracts import get_operation_contract
from app.services.learning_tasks import _normalized_matching_pairs, _score_matching, _score_text


def test_score_text_computes_expected_output_for_operation_tasks_when_missing() -> None:
    content = {
        "operation_ref": "graph.operation.build_adjacency_matrix",
        "input_payload": {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "C", "target": "D"},
            ],
            "directed": False,
        },
    }
    contract = get_operation_contract(content["operation_ref"])
    assert contract is not None
    expected_output = contract.executor(content["input_payload"])

    score, feedback = _score_text(
        content,
        {"text": json.dumps(expected_output, ensure_ascii=False)},
    )

    assert score == 100
    assert feedback["is_correct"] is True
    assert feedback["expected_output"] == expected_output


def test_normalized_matching_pairs_supports_legacy_snapshot_shape() -> None:
    content = {
        "left": [
            {"id": "graph", "text": "Граф"},
            {"id": "vertex", "text": "Вершина"},
        ],
        "right": [
            {"id": "graph", "text": "Множество вершин и ребер."},
            {"id": "vertex", "text": "Базовая точка графа."},
        ],
        "pairs": [
            {"left_id": "graph", "right_id": "graph"},
            {"left_id": "vertex", "right_id": "vertex"},
        ],
    }

    assert _normalized_matching_pairs(content) == [
        {"id": "graph", "left": "Граф", "right": "Множество вершин и ребер."},
        {"id": "vertex", "left": "Вершина", "right": "Базовая точка графа."},
    ]


def test_score_matching_supports_legacy_snapshot_shape() -> None:
    content = {
        "left": [
            {"id": "graph", "text": "Граф"},
            {"id": "vertex", "text": "Вершина"},
        ],
        "right": [
            {"id": "graph", "text": "Множество вершин и ребер."},
            {"id": "vertex", "text": "Базовая точка графа."},
        ],
        "pairs": [
            {"left_id": "graph", "right_id": "graph"},
            {"left_id": "vertex", "right_id": "vertex"},
        ],
    }

    score, feedback = _score_matching(
        content,
        {
            "pairings": [
                {"left_id": "graph", "right_id": "graph"},
                {"left_id": "vertex", "right_id": "vertex"},
            ]
        },
    )

    assert score == 100
    assert feedback["is_correct"] is True
