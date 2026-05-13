from collections import defaultdict
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


def build_adjacency_matrix(payload: dict[str, Any]) -> dict[str, Any]:
    vertices = _normalize_vertices(payload.get("vertices", []))
    edges = _normalize_edges(payload.get("edges", []))
    directed = bool(payload.get("directed", False))
    index_by_vertex = {vertex: index for index, vertex in enumerate(vertices)}
    matrix = [[0 for _ in vertices] for _ in vertices]

    for source, target in edges:
        if source not in index_by_vertex or target not in index_by_vertex:
            raise ValueError("All edges must reference vertices declared in the input graph.")
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
    vertices = _normalize_vertices(payload.get("vertices", []))
    edges = _normalize_edges(payload.get("edges", []))
    directed = bool(payload.get("directed", False))
    index_by_vertex = {vertex: index for index, vertex in enumerate(vertices)}
    matrix = [[0 for _ in edges] for _ in vertices]
    edge_labels: list[str] = []

    for edge_index, (source, target) in enumerate(edges):
        if source not in index_by_vertex or target not in index_by_vertex:
            raise ValueError("All edges must reference vertices declared in the input graph.")
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
    vertices = _normalize_vertices(payload.get("vertices", []))
    edges = _normalize_edges(payload.get("edges", []))
    directed = bool(payload.get("directed", False))
    degree_map: dict[str, dict[str, int]] = {
        vertex: {"degree": 0, "in_degree": 0, "out_degree": 0}
        for vertex in vertices
    }

    for source, target in edges:
        if source not in degree_map or target not in degree_map:
            raise ValueError("All edges must reference vertices declared in the input graph.")
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
