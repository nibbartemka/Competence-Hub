type SchemaValue = string | Record<string, unknown>;

type OperationInputEditorProps = {
  schema: Record<string, unknown>;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
};

type GraphEdge = {
  source: string;
  target: string;
};

function schemaType(schema: Record<string, unknown>) {
  return String(schema.type ?? "").trim();
}

function graphValue(value: Record<string, unknown>) {
  const vertices = Array.isArray(value.vertices)
    ? value.vertices.map((item) => String(item))
    : [];
  const edges = Array.isArray(value.edges)
    ? value.edges.map((item) => {
        const rawEdge = item && typeof item === "object" ? (item as Record<string, unknown>) : {};
        return {
          source: String(rawEdge.source ?? ""),
          target: String(rawEdge.target ?? ""),
        };
      })
    : [];

  return {
    vertices,
    edges,
    directed: Boolean(value.directed),
  };
}

function coerceScalarValue(type: string, rawValue: string) {
  if (type === "integer") {
    return rawValue.trim() === "" ? "" : Number.parseInt(rawValue, 10);
  }
  if (type === "number") {
    return rawValue.trim() === "" ? "" : Number(rawValue);
  }
  return rawValue;
}

function GraphInputEditor({
  value,
  onChange,
  disabled,
}: Omit<OperationInputEditorProps, "schema">) {
  const graph = graphValue(value);

  function commit(next: typeof graph) {
    onChange({
      vertices: next.vertices,
      edges: next.edges,
      directed: next.directed,
    });
  }

  function updateVertex(index: number, nextValue: string) {
    const vertices = graph.vertices.map((vertex, vertexIndex) =>
      vertexIndex === index ? nextValue : vertex,
    );
    commit({ ...graph, vertices });
  }

  function removeVertex(index: number) {
    const removedVertex = graph.vertices[index];
    commit({
      ...graph,
      vertices: graph.vertices.filter((_, vertexIndex) => vertexIndex !== index),
      edges: graph.edges.filter(
        (edge) => edge.source !== removedVertex && edge.target !== removedVertex,
      ),
    });
  }

  function updateEdge(index: number, patch: Partial<GraphEdge>) {
    commit({
      ...graph,
      edges: graph.edges.map((edge, edgeIndex) =>
        edgeIndex === index ? { ...edge, ...patch } : edge,
      ),
    });
  }

  return (
    <div className="operation-input-editor operation-input-editor--graph">
      <div className="operation-input-editor__section">
        <div className="operation-input-editor__head">
          <strong>Вершины</strong>
          <button
            className="ghost-button"
            disabled={disabled}
            onClick={() => commit({ ...graph, vertices: [...graph.vertices, ""] })}
            type="button"
          >
            Добавить вершину
          </button>
        </div>
        <div className="operation-input-editor__rows">
          {graph.vertices.map((vertex, index) => (
            <div className="operation-input-editor__row" key={`vertex-${index}`}>
              <input
                disabled={disabled}
                onChange={(event) => updateVertex(index, event.target.value)}
                placeholder={`Вершина ${index + 1}`}
                value={vertex}
              />
              <button
                className="secondary-button secondary-button--danger"
                disabled={disabled}
                onClick={() => removeVertex(index)}
                type="button"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="operation-input-editor__section">
        <div className="operation-input-editor__head">
          <strong>Ребра</strong>
          <button
            className="ghost-button"
            disabled={disabled}
            onClick={() =>
              commit({
                ...graph,
                edges: [...graph.edges, { source: "", target: "" }],
              })
            }
            type="button"
          >
            Добавить ребро
          </button>
        </div>
        <div className="operation-input-editor__rows">
          {graph.edges.map((edge, index) => (
            <div className="operation-input-editor__row operation-input-editor__row--edge" key={`edge-${index}`}>
              <select
                disabled={disabled}
                onChange={(event) => updateEdge(index, { source: event.target.value })}
                value={edge.source}
              >
                <option value="">Откуда</option>
                {graph.vertices.map((vertex, vertexIndex) => (
                  <option key={`edge-source-${vertexIndex}`} value={vertex}>
                    {vertex || `Вершина ${vertexIndex + 1}`}
                  </option>
                ))}
              </select>
              <select
                disabled={disabled}
                onChange={(event) => updateEdge(index, { target: event.target.value })}
                value={edge.target}
              >
                <option value="">Куда</option>
                {graph.vertices.map((vertex, vertexIndex) => (
                  <option key={`edge-target-${vertexIndex}`} value={vertex}>
                    {vertex || `Вершина ${vertexIndex + 1}`}
                  </option>
                ))}
              </select>
              <button
                className="secondary-button secondary-button--danger"
                disabled={disabled}
                onClick={() =>
                  commit({
                    ...graph,
                    edges: graph.edges.filter((_, edgeIndex) => edgeIndex !== index),
                  })
                }
                type="button"
              >
                Удалить
              </button>
            </div>
          ))}
        </div>
      </div>

      <label className="trajectory-task-template__check">
        <input
          checked={graph.directed}
          disabled={disabled}
          onChange={(event) => commit({ ...graph, directed: event.target.checked })}
          type="checkbox"
        />
        <span>Ориентированный граф</span>
      </label>
    </div>
  );
}

function ObjectInputEditor({
  schema,
  value,
  onChange,
  disabled,
}: OperationInputEditorProps) {
  const rawFields =
    schema.fields && typeof schema.fields === "object"
      ? (schema.fields as Record<string, SchemaValue>)
      : {};

  return (
    <div className="operation-input-editor">
      {Object.entries(rawFields).map(([fieldName, fieldSchema]) => {
        const type =
          typeof fieldSchema === "string"
            ? fieldSchema
            : String(fieldSchema.type ?? "string");
        const fieldValue = value[fieldName];

        if (type === "boolean") {
          return (
            <label className="trajectory-task-template__check" key={fieldName}>
              <input
                checked={Boolean(fieldValue)}
                disabled={disabled}
                onChange={(event) =>
                  onChange({ ...value, [fieldName]: event.target.checked })
                }
                type="checkbox"
              />
              <span>{fieldName}</span>
            </label>
          );
        }

        return (
          <label className="field" key={fieldName}>
            <span>{fieldName}</span>
            <input
              disabled={disabled}
              onChange={(event) =>
                onChange({
                  ...value,
                  [fieldName]: coerceScalarValue(type, event.target.value),
                })
              }
              type={type === "integer" || type === "number" ? "number" : "text"}
              value={String(fieldValue ?? "")}
            />
          </label>
        );
      })}
    </div>
  );
}

export function validateOperationInput(
  schema: Record<string, unknown> | null,
  value: Record<string, unknown>,
) {
  if (!schema) return "Для операции не найдена схема входных данных.";

  const type = schemaType(schema);
  if (type === "Graph") {
    const graph = graphValue(value);
    const vertices = graph.vertices.map((vertex) => vertex.trim());
    if (!vertices.length || vertices.some((vertex) => !vertex)) {
      return "Для графа нужно задать хотя бы одну непустую вершину.";
    }
    if (new Set(vertices).size !== vertices.length) {
      return "Названия вершин графа не должны повторяться.";
    }
    if (
      graph.edges.some(
        (edge) =>
          !edge.source ||
          !edge.target ||
          !vertices.includes(edge.source) ||
          !vertices.includes(edge.target),
      )
    ) {
      return "Каждое ребро должно соединять две существующие вершины.";
    }
  }

  if (type === "integer" && !Number.isInteger(value.value)) {
    return "Нужно указать целое число.";
  }

  return "";
}

export default function OperationInputEditor({
  schema,
  value,
  onChange,
  disabled,
}: OperationInputEditorProps) {
  const type = schemaType(schema);

  if (type === "Graph") {
    return <GraphInputEditor disabled={disabled} onChange={onChange} value={value} />;
  }

  if (type === "integer" || type === "number") {
    return (
      <label className="field operation-input-editor">
        <span>{type === "integer" ? "Целое число" : "Число"}</span>
        <input
          disabled={disabled}
          onChange={(event) =>
            onChange({
              value: coerceScalarValue(type, event.target.value),
            })
          }
          type="number"
          value={String(value.value ?? "")}
        />
      </label>
    );
  }

  return (
    <ObjectInputEditor disabled={disabled} onChange={onChange} schema={schema} value={value} />
  );
}
