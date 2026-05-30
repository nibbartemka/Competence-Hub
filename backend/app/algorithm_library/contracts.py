from dataclasses import dataclass
from typing import Any, Callable

from . import graph_library


@dataclass(frozen=True)
class OperationContract:
    id: str
    title: str
    description: str
    input_schema: dict[str, Any]
    output_schema: dict[str, Any]
    example_input: dict[str, Any]
    executor_ref: str
    validator_ref: str
    executor: Callable[[dict[str, Any]], Any]
    validator: Callable[[dict[str, Any], Any], bool]


OPERATION_CONTRACTS: tuple[OperationContract, ...] = (
    OperationContract(
        id="graph.operation.build_adjacency_matrix",
        title="Построение матрицы смежности",
        description="Строит матрицу смежности по графу с вершинами и ребрами.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "AdjacencyMatrix",
            "fields": {
                "vertices": "string[]",
                "values": "number[][]",
            },
        },
        example_input={
            "vertices": ["A", "B", "C"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
            ],
            "directed": False,
        },
        executor_ref="graph_library.build_adjacency_matrix",
        validator_ref="graph_library.validate_adjacency_matrix",
        executor=graph_library.build_adjacency_matrix,
        validator=graph_library.validate_adjacency_matrix,
    ),
    OperationContract(
        id="graph.operation.build_incidence_matrix",
        title="Построение матрицы инцидентности",
        description="Строит матрицу инцидентности по описанию графа.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "IncidenceMatrix",
            "fields": {
                "vertices": "string[]",
                "edges": "string[]",
                "values": "number[][]",
            },
        },
        example_input={
            "vertices": ["A", "B", "C"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
            ],
            "directed": True,
        },
        executor_ref="graph_library.build_incidence_matrix",
        validator_ref="graph_library.validate_incidence_matrix",
        executor=graph_library.build_incidence_matrix,
        validator=graph_library.validate_incidence_matrix,
    ),
    OperationContract(
        id="graph.operation.build_degree_sequence",
        title="Вычисление степеней вершин",
        description="Вычисляет степени, а для ориентированного графа входящие и исходящие степени.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "DegreeSequence",
            "fields": {
                "vertices": "string[]",
                "sequence": "DegreeRow[]",
            },
        },
        example_input={
            "vertices": ["A", "B", "C"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
            ],
            "directed": True,
        },
        executor_ref="graph_library.build_degree_sequence",
        validator_ref="graph_library.validate_degree_sequence",
        executor=graph_library.build_degree_sequence,
        validator=graph_library.validate_degree_sequence,
    ),
)

CONTRACT_BY_ID = {contract.id: contract for contract in OPERATION_CONTRACTS}


def list_operation_contracts() -> list[OperationContract]:
    return list(OPERATION_CONTRACTS)


def get_operation_contract(contract_id: str) -> OperationContract | None:
    return CONTRACT_BY_ID.get(contract_id)
