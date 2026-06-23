from itertools import combinations
from typing import Any


def _normalize_vertices(raw_vertices: list[Any]) -> list[str]:
    vertices: list[str] = []
    for item in raw_vertices:
        if isinstance(item, dict):
            value = item.get("id") or item.get("name")
        else:
            value = item
        text = str(value or "").strip()
        if not text:
            continue
        if text not in vertices:
            vertices.append(text)
    return vertices


def _normalize_edges(raw_edges: list[Any]) -> list[tuple[str, str]]:
    edges: list[tuple[str, str]] = []
    for item in raw_edges:
        if not isinstance(item, dict):
            continue
        source = str(item.get("source") or "").strip()
        target = str(item.get("target") or "").strip()
        if source and target:
            edges.append((source, target))
    return edges


def _graph_payload(payload: dict[str, Any]) -> tuple[list[str], list[tuple[str, str]], bool]:
    vertices = _normalize_vertices(payload.get("vertices", []))
    edges = _normalize_edges(payload.get("edges", []))
    directed = bool(payload.get("directed", False))

    vertex_set = set(vertices)
    for source, target in edges:
        if source not in vertex_set or target not in vertex_set:
            raise ValueError("All edges must reference vertices declared in the input graph.")

    return vertices, edges, directed


def _build_adjacency_list(
    vertices: list[str],
    edges: list[tuple[str, str]],
    *,
    directed: bool,
) -> dict[str, list[str]]:
    adjacency: dict[str, list[str]] = {vertex: [] for vertex in vertices}
    for source, target in edges:
        adjacency[source].append(target)
        if not directed:
            adjacency[target].append(source)
    return adjacency


def _transpose_adjacency(
    vertices: list[str],
    adjacency: dict[str, list[str]],
) -> dict[str, list[str]]:
    transposed: dict[str, list[str]] = {vertex: [] for vertex in vertices}
    for source, targets in adjacency.items():
        for target in targets:
            transposed[target].append(source)
    return transposed


def _dfs_order(
    start: str,
    adjacency: dict[str, list[str]],
    visited: set[str],
    order: list[str],
) -> None:
    visited.add(start)
    for neighbor in adjacency[start]:
        if neighbor not in visited:
            _dfs_order(neighbor, adjacency, visited, order)
    order.append(start)


def _dfs_component(
    start: str,
    adjacency: dict[str, list[str]],
    visited: set[str],
    component: list[str],
) -> None:
    visited.add(start)
    component.append(start)
    for neighbor in adjacency[start]:
        if neighbor not in visited:
            _dfs_component(neighbor, adjacency, visited, component)


def _sort_component(component: list[str], vertex_order: dict[str, int]) -> list[str]:
    return sorted(component, key=lambda vertex: vertex_order[vertex])


def _normalize_component_collection(components: Any) -> list[frozenset[str]] | None:
    if not isinstance(components, list):
        return None

    normalized: list[frozenset[str]] = []
    seen: set[frozenset[str]] = set()
    for component in components:
        if not isinstance(component, list) or not component:
            return None
        component_set = frozenset(str(vertex).strip() for vertex in component if str(vertex).strip())
        if not component_set or component_set in seen or len(component_set) != len(component):
            return None
        seen.add(component_set)
        normalized.append(component_set)
    return normalized


def _extract_components(answer: Any) -> list[frozenset[str]] | None:
    if isinstance(answer, dict):
        return _normalize_component_collection(answer.get("components"))
    return _normalize_component_collection(answer)


def _extract_basis(answer: Any) -> list[str] | None:
    if isinstance(answer, dict):
        raw_basis = answer.get("basis")
    else:
        raw_basis = answer

    if not isinstance(raw_basis, list) or not raw_basis:
        return None

    basis = [str(vertex).strip() for vertex in raw_basis if str(vertex).strip()]
    if len(basis) != len(raw_basis) or len(set(basis)) != len(basis):
        return None
    return basis


def build_adjacency_matrix(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, directed = _graph_payload(payload)
    index_by_vertex = {vertex: index for index, vertex in enumerate(vertices)}
    matrix = [[0 for _ in vertices] for _ in vertices]

    for source, target in edges:
        source_index = index_by_vertex[source]
        target_index = index_by_vertex[target]
        matrix[source_index][target_index] += 1
        if not directed:
            matrix[target_index][source_index] += 1

    return {
        "vertices": vertices,
        "values": matrix,
    }


def validate_adjacency_matrix(answer: dict[str, Any], expected: dict[str, Any]) -> bool:
    return answer == expected


def build_incidence_matrix(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, directed = _graph_payload(payload)
    index_by_vertex = {vertex: index for index, vertex in enumerate(vertices)}
    matrix = [[0 for _ in edges] for _ in vertices]
    edge_labels: list[str] = []

    for edge_index, (source, target) in enumerate(edges):
        edge_labels.append(f"{source}->{target}" if directed else f"{source}-{target}")
        if directed:
            matrix[index_by_vertex[source]][edge_index] = -1
            matrix[index_by_vertex[target]][edge_index] = 1
        else:
            matrix[index_by_vertex[source]][edge_index] = 1
            matrix[index_by_vertex[target]][edge_index] = 1

    return {
        "vertices": vertices,
        "edges": edge_labels,
        "values": matrix,
    }


def validate_incidence_matrix(answer: dict[str, Any], expected: dict[str, Any]) -> bool:
    return answer == expected


def build_degree_sequence(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, directed = _graph_payload(payload)
    degree_map: dict[str, dict[str, int]] = {
        vertex: {"degree": 0, "in_degree": 0, "out_degree": 0}
        for vertex in vertices
    }

    for source, target in edges:
        if directed:
            degree_map[source]["out_degree"] += 1
            degree_map[target]["in_degree"] += 1
            degree_map[source]["degree"] += 1
            degree_map[target]["degree"] += 1
        else:
            degree_map[source]["degree"] += 1
            degree_map[target]["degree"] += 1

    if directed:
        sequence = [
            {
                "vertex": vertex,
                "in_degree": degree_map[vertex]["in_degree"],
                "out_degree": degree_map[vertex]["out_degree"],
                "degree": degree_map[vertex]["degree"],
            }
            for vertex in vertices
        ]
    else:
        sequence = [
            {
                "vertex": vertex,
                "degree": degree_map[vertex]["degree"],
            }
            for vertex in vertices
        ]

    return {
        "vertices": vertices,
        "sequence": sequence,
    }


def validate_degree_sequence(answer: dict[str, Any], expected: dict[str, Any]) -> bool:
    return answer == expected


def build_reachability_matrix(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, directed = _graph_payload(payload)
    adjacency = _build_adjacency_list(vertices, edges, directed=directed)
    index_by_vertex = {vertex: index for index, vertex in enumerate(vertices)}
    matrix = [[0 for _ in vertices] for _ in vertices]

    for start in vertices:
        stack = [start]
        visited = {start}
        while stack:
            current = stack.pop()
            for neighbor in adjacency[current]:
                if neighbor in visited:
                    continue
                visited.add(neighbor)
                stack.append(neighbor)
        for reachable in visited:
            matrix[index_by_vertex[start]][index_by_vertex[reachable]] = 1

    return {
        "vertices": vertices,
        "values": matrix,
    }


def validate_reachability_matrix(answer: Any, expected: dict[str, Any]) -> bool:
    if not isinstance(answer, dict):
        return False
    if answer.get("vertices") != expected.get("vertices"):
        return False

    raw_values = answer.get("values")
    expected_values = expected.get("values")
    if not isinstance(raw_values, list) or not isinstance(expected_values, list):
        return False
    if len(raw_values) != len(expected_values):
        return False

    normalized_values: list[list[int]] = []
    for row, expected_row in zip(raw_values, expected_values, strict=False):
        if not isinstance(row, list) or len(row) != len(expected_row):
            return False
        normalized_row: list[int] = []
        for value in row:
            if isinstance(value, bool):
                normalized_row.append(int(value))
            elif isinstance(value, int) and value in {0, 1}:
                normalized_row.append(value)
            else:
                return False
        normalized_values.append(normalized_row)

    return {
        "vertices": answer["vertices"],
        "values": normalized_values,
    } == expected


def find_strong_components(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, directed = _graph_payload(payload)
    adjacency = _build_adjacency_list(vertices, edges, directed=directed)
    transposed = _transpose_adjacency(vertices, adjacency)
    visited: set[str] = set()
    order: list[str] = []
    vertex_order = {vertex: index for index, vertex in enumerate(vertices)}

    for vertex in vertices:
        if vertex not in visited:
            _dfs_order(vertex, adjacency, visited, order)

    visited.clear()
    components: list[list[str]] = []
    for vertex in reversed(order):
        if vertex in visited:
            continue
        component: list[str] = []
        _dfs_component(vertex, transposed, visited, component)
        components.append(_sort_component(component, vertex_order))

    components.sort(key=lambda component: min(vertex_order[vertex] for vertex in component))
    return {
        "components": components,
    }


def validate_strong_components(answer: Any, expected: dict[str, Any]) -> bool:
    expected_components = _extract_components(expected)
    answer_components = _extract_components(answer)
    if expected_components is None or answer_components is None:
        return False
    return set(answer_components) == set(expected_components)


def find_graph_basis(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, directed = _graph_payload(payload)
    strong_components = find_strong_components(
        {
            "vertices": vertices,
            "edges": [{"source": source, "target": target} for source, target in edges],
            "directed": directed,
        }
    )["components"]
    component_index_by_vertex = {
        vertex: index
        for index, component in enumerate(strong_components)
        for vertex in component
    }
    incoming_to_component = [False for _ in strong_components]

    for source, target in edges:
        source_component = component_index_by_vertex[source]
        target_component = component_index_by_vertex[target]
        if source_component != target_component:
            incoming_to_component[target_component] = True

    source_components = [
        component
        for index, component in enumerate(strong_components)
        if not incoming_to_component[index]
    ]
    basis = [component[0] for component in source_components]

    return {
        "basis": basis,
        "source_components": source_components,
        "strong_components": strong_components,
    }


def validate_graph_basis(answer: Any, expected: dict[str, Any]) -> bool:
    basis = _extract_basis(answer)
    source_components = _extract_components({"components": expected.get("source_components")})
    if basis is None or source_components is None:
        return False
    if len(basis) != len(source_components):
        return False

    matched_components = 0
    for component in source_components:
        selected = [vertex for vertex in basis if vertex in component]
        if len(selected) != 1:
            return False
        matched_components += 1

    return matched_components == len(source_components)


def _build_undirected_neighbor_map(
    vertices: list[str],
    edges: list[tuple[str, str]],
) -> dict[str, set[str]]:
    neighbors: dict[str, set[str]] = {vertex: set() for vertex in vertices}
    for source, target in edges:
        neighbors[source].add(target)
        neighbors[target].add(source)
    return neighbors


def _iterate_vertex_subsets(
    vertices: list[str],
    *,
    descending: bool = False,
):
    sizes = range(len(vertices), -1, -1) if descending else range(len(vertices) + 1)
    for size in sizes:
        for subset in combinations(vertices, size):
            yield list(subset)


def _normalize_unique_vertex_answer(raw_vertices: Any) -> list[str] | None:
    if not isinstance(raw_vertices, list):
        return None
    vertices = [str(vertex).strip() for vertex in raw_vertices if str(vertex).strip()]
    if len(vertices) != len(raw_vertices) or len(set(vertices)) != len(vertices):
        return None
    return vertices


def _extract_cover_vertices(answer: Any) -> list[str] | None:
    if isinstance(answer, dict):
        raw_cover = answer.get('cover')
        if raw_cover is None:
            raw_cover = answer.get('vertex_cover')
    else:
        raw_cover = answer
    return _normalize_unique_vertex_answer(raw_cover)


def _extract_independent_vertices(answer: Any) -> list[str] | None:
    if isinstance(answer, dict):
        raw_set = answer.get('independent_set')
        if raw_set is None:
            raw_set = answer.get('vertices')
    else:
        raw_set = answer
    return _normalize_unique_vertex_answer(raw_set)


def _extract_dominating_vertices(answer: Any) -> list[str] | None:
    if isinstance(answer, dict):
        raw_set = answer.get('minimum_dominating_set')
        if raw_set is None:
            raw_set = answer.get('dominating_set')
    else:
        raw_set = answer
    return _normalize_unique_vertex_answer(raw_set)


def _serialize_edges(edges: list[tuple[str, str]]) -> list[dict[str, str]]:
    return [{'source': source, 'target': target} for source, target in edges]


def _is_vertex_cover(selected: set[str], edges: list[tuple[str, str]]) -> bool:
    return all(source in selected or target in selected for source, target in edges)


def _is_dominating_set(selected: set[str], neighbors: dict[str, set[str]]) -> bool:
    covered: set[str] = set(selected)
    for vertex in selected:
        covered.update(neighbors[vertex])
    return covered == set(neighbors)


def _is_independent_set(selected: set[str], neighbors: dict[str, set[str]]) -> bool:
    for vertex in selected:
        if neighbors[vertex] & (selected - {vertex}):
            return False
    return True


def solve_minimum_cover(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, _ = _graph_payload(payload)
    for cover in _iterate_vertex_subsets(vertices):
        if _is_vertex_cover(set(cover), edges):
            return {
                'cover': cover,
                'size': len(cover),
                'vertices': vertices,
                'edges': _serialize_edges(edges),
            }
    raise ValueError('Unable to find a cover for the provided graph.')


def validate_minimum_cover(answer: Any, expected: dict[str, Any]) -> bool:
    cover = _extract_cover_vertices(answer)
    if cover is None:
        return False

    vertices = _normalize_vertices(expected.get('vertices', []))
    edges = _normalize_edges(expected.get('edges', []))
    if any(vertex not in vertices for vertex in cover):
        return False

    answer_size = None
    if isinstance(answer, dict) and 'size' in answer:
        if not isinstance(answer['size'], int):
            return False
        answer_size = answer['size']
    if answer_size is not None and answer_size != len(cover):
        return False

    return len(cover) == expected.get('size') and _is_vertex_cover(set(cover), edges)


def find_domination_number(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, _ = _graph_payload(payload)
    neighbors = _build_undirected_neighbor_map(vertices, edges)

    for dominating_set in _iterate_vertex_subsets(vertices):
        if _is_dominating_set(set(dominating_set), neighbors):
            return {
                'domination_number': len(dominating_set),
                'minimum_dominating_set': dominating_set,
                'vertices': vertices,
                'edges': _serialize_edges(edges),
            }
    raise ValueError('Unable to find a dominating set for the provided graph.')


def validate_domination_number(answer: Any, expected: dict[str, Any]) -> bool:
    expected_number = expected.get('domination_number')
    if not isinstance(expected_number, int):
        return False

    if isinstance(answer, int):
        return answer == expected_number

    if not isinstance(answer, dict):
        return False

    stated_number = answer.get('domination_number')
    if stated_number is not None and (not isinstance(stated_number, int) or stated_number != expected_number):
        return False

    dominating_vertices = _extract_dominating_vertices(answer)
    if dominating_vertices is None:
        return stated_number == expected_number

    vertices = _normalize_vertices(expected.get('vertices', []))
    edges = _normalize_edges(expected.get('edges', []))
    if any(vertex not in vertices for vertex in dominating_vertices):
        return False

    neighbors = _build_undirected_neighbor_map(vertices, edges)
    return len(dominating_vertices) == expected_number and _is_dominating_set(set(dominating_vertices), neighbors)


def find_independent_vertex_set(payload: dict[str, Any]) -> dict[str, Any]:
    vertices, edges, _ = _graph_payload(payload)
    neighbors = _build_undirected_neighbor_map(vertices, edges)

    for independent_set in _iterate_vertex_subsets(vertices, descending=True):
        if _is_independent_set(set(independent_set), neighbors):
            return {
                'independent_set': independent_set,
                'size': len(independent_set),
                'vertices': vertices,
                'edges': _serialize_edges(edges),
            }
    raise ValueError('Unable to find an independent set for the provided graph.')


def validate_independent_vertex_set(answer: Any, expected: dict[str, Any]) -> bool:
    independent_vertices = _extract_independent_vertices(answer)
    if independent_vertices is None:
        return False

    vertices = _normalize_vertices(expected.get('vertices', []))
    edges = _normalize_edges(expected.get('edges', []))
    if any(vertex not in vertices for vertex in independent_vertices):
        return False

    answer_size = None
    if isinstance(answer, dict) and 'size' in answer:
        if not isinstance(answer['size'], int):
            return False
        answer_size = answer['size']
    if answer_size is not None and answer_size != len(independent_vertices):
        return False

    neighbors = _build_undirected_neighbor_map(vertices, edges)
    return len(independent_vertices) == expected.get('size') and _is_independent_set(set(independent_vertices), neighbors)
