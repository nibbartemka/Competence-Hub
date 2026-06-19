from app.algorithm_library.graph_library import (
    build_reachability_matrix,
    find_domination_number,
    find_graph_basis,
    find_independent_vertex_set,
    find_strong_components,
    solve_minimum_cover,
    validate_domination_number,
    validate_graph_basis,
    validate_independent_vertex_set,
    validate_minimum_cover,
    validate_reachability_matrix,
    validate_strong_components,
)


def test_build_reachability_matrix_marks_transitive_paths() -> None:
    expected = {
        "vertices": ["A", "B", "C", "D"],
        "values": [
            [1, 1, 1, 1],
            [0, 1, 1, 0],
            [0, 0, 1, 0],
            [0, 0, 1, 1],
        ],
    }
    result = build_reachability_matrix(
        {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "A", "target": "D"},
                {"source": "D", "target": "C"},
            ],
            "directed": True,
        }
    )

    assert result == expected
    assert validate_reachability_matrix(
        {
            "vertices": ["A", "B", "C", "D"],
            "values": [[True, 1, 1, 1], [0, True, 1, 0], [0, 0, True, 0], [0, 0, 1, True]],
        },
        expected,
    )


def test_find_strong_components_validator_ignores_component_order() -> None:
    expected = find_strong_components(
        {
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "A"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "C"},
                {"source": "D", "target": "E"},
            ],
            "directed": True,
        }
    )

    assert expected == {"components": [["A", "B"], ["C", "D"], ["E"]]}
    assert validate_strong_components({"components": [["E"], ["D", "C"], ["B", "A"]]}, expected)


def test_find_graph_basis_accepts_any_representative_of_source_component() -> None:
    expected = find_graph_basis(
        {
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "A"},
                {"source": "B", "target": "C"},
                {"source": "D", "target": "C"},
                {"source": "C", "target": "E"},
            ],
            "directed": True,
        }
    )

    assert expected["basis"] == ["A", "D"]
    assert expected["source_components"] == [["A", "B"], ["D"]]
    assert validate_graph_basis({"basis": ["B", "D"]}, expected)
    assert not validate_graph_basis({"basis": ["C", "D"]}, expected)


def test_solve_minimum_cover_accepts_any_minimum_cover() -> None:
    expected = solve_minimum_cover(
        {
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "B", "target": "D"},
                {"source": "C", "target": "D"},
            ],
            "directed": False,
        }
    )

    assert expected["size"] == 2
    assert validate_minimum_cover({"cover": ["A", "D"], "size": 2}, expected)
    assert not validate_minimum_cover({"cover": ["A", "B"], "size": 2}, expected)


def test_find_domination_number_accepts_number_or_minimum_set() -> None:
    expected = find_domination_number(
        {
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "E"},
            ],
            "directed": False,
        }
    )

    assert expected["domination_number"] == 2
    assert validate_domination_number(2, expected)
    assert validate_domination_number({"minimum_dominating_set": ["B", "D"], "domination_number": 2}, expected)
    assert not validate_domination_number({"minimum_dominating_set": ["A", "C"], "domination_number": 2}, expected)


def test_find_independent_vertex_set_accepts_any_maximum_solution() -> None:
    expected = find_independent_vertex_set(
        {
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "E"},
                {"source": "A", "target": "E"},
            ],
            "directed": False,
        }
    )

    assert expected["size"] == 2
    assert validate_independent_vertex_set({"independent_set": ["A", "C"], "size": 2}, expected)
    assert validate_independent_vertex_set({"independent_set": ["B", "D"], "size": 2}, expected)
    assert not validate_independent_vertex_set({"independent_set": ["A", "C", "E"], "size": 3}, expected)
