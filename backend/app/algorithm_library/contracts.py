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
        title="Построение матрицы инциденций",
        description="Строит матрицу инциденций по описанию графа.",
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
    OperationContract(
        id="graph.operation.build_reachability_matrix",
        title="Построение матрицы достижимости",
        description="Строит матрицу достижимости ориентированного или неориентированного графа.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "ReachabilityMatrix",
            "fields": {
                "vertices": "string[]",
                "values": "number[][]",
            },
        },
        example_input={
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "A", "target": "D"},
            ],
            "directed": True,
        },
        executor_ref="graph_library.build_reachability_matrix",
        validator_ref="graph_library.validate_reachability_matrix",
        executor=graph_library.build_reachability_matrix,
        validator=graph_library.validate_reachability_matrix,
    ),
    OperationContract(
        id="graph.operation.find_strong_components",
        title="Выделение сильных компонент",
        description="Находит сильные компоненты ориентированного графа.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "StrongComponents",
            "fields": {
                "components": "string[][]",
            },
        },
        example_input={
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "A"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "C"},
            ],
            "directed": True,
        },
        executor_ref="graph_library.find_strong_components",
        validator_ref="graph_library.validate_strong_components",
        executor=graph_library.find_strong_components,
        validator=graph_library.validate_strong_components,
    ),
    OperationContract(
        id="graph.operation.find_graph_basis",
        title="Нахождение базы графа",
        description="Находит базу графа через источниковые сильные компоненты конденсации.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "GraphBasis",
            "fields": {
                "basis": "string[]",
                "source_components": "string[][]",
                "strong_components": "string[][]",
            },
        },
        example_input={
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "A"},
                {"source": "B", "target": "C"},
                {"source": "D", "target": "C"},
                {"source": "C", "target": "E"},
            ],
            "directed": True,
        },
        executor_ref="graph_library.find_graph_basis",
        validator_ref="graph_library.validate_graph_basis",
        executor=graph_library.find_graph_basis,
        validator=graph_library.validate_graph_basis,
    ),
    OperationContract(
        id="graph.operation.solve_minimum_cover",
        title="Решение задачи о наименьшем покрытии",
        description="Находит покрытие вершин минимальной мощности для заданного графа.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "MinimumCover",
            "fields": {
                "cover": "string[]",
                "size": "number",
            },
        },
        example_input={
            "vertices": ["A", "B", "C", "D"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "A", "target": "C"},
                {"source": "B", "target": "D"},
                {"source": "C", "target": "D"},
            ],
            "directed": False,
        },
        executor_ref="graph_library.solve_minimum_cover",
        validator_ref="graph_library.validate_minimum_cover",
        executor=graph_library.solve_minimum_cover,
        validator=graph_library.validate_minimum_cover,
    ),
    OperationContract(
        id="graph.operation.find_domination_number",
        title="Нахождение числа доминирования",
        description="Находит число доминирования и одно наименьшее доминирующее множество графа.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "DominationNumber",
            "fields": {
                "domination_number": "number",
                "minimum_dominating_set": "string[]",
            },
        },
        example_input={
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "E"},
            ],
            "directed": False,
        },
        executor_ref="graph_library.find_domination_number",
        validator_ref="graph_library.validate_domination_number",
        executor=graph_library.find_domination_number,
        validator=graph_library.validate_domination_number,
    ),
    OperationContract(
        id="graph.operation.find_independent_vertex_set",
        title="Нахождение независимого множества вершин",
        description="Находит независимое множество вершин максимальной мощности для заданного графа.",
        input_schema={
            "type": "Graph",
            "fields": {
                "vertices": "Vertex[]",
                "edges": "Edge[]",
                "directed": "boolean",
            },
        },
        output_schema={
            "type": "IndependentVertexSet",
            "fields": {
                "independent_set": "string[]",
                "size": "number",
            },
        },
        example_input={
            "vertices": ["A", "B", "C", "D", "E"],
            "edges": [
                {"source": "A", "target": "B"},
                {"source": "B", "target": "C"},
                {"source": "C", "target": "D"},
                {"source": "D", "target": "E"},
            ],
            "directed": False,
        },
        executor_ref="graph_library.find_independent_vertex_set",
        validator_ref="graph_library.validate_independent_vertex_set",
        executor=graph_library.find_independent_vertex_set,
        validator=graph_library.validate_independent_vertex_set,
    ),
)

CONTRACT_BY_ID = {contract.id: contract for contract in OPERATION_CONTRACTS}


def list_operation_contracts() -> list[OperationContract]:
    return list(OPERATION_CONTRACTS)


def get_operation_contract(contract_id: str) -> OperationContract | None:
    return CONTRACT_BY_ID.get(contract_id)
