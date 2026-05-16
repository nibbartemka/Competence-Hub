import type { StudentTaskContent } from "../types";

type OperationInputPreviewProps = {
  schema?: Record<string, unknown>;
  payload?: Record<string, unknown>;
};

type OperationAnswerEditorProps = {
  schema?: Record<string, unknown>;
  inputPayload?: Record<string, unknown>;
  valueText: string;
  onChangeText: (value: string) => void;
  disabled?: boolean;
};

type GraphEdge = {
  source: string;
  target: string;
};

type GraphPayload = {
  vertices: string[];
  edges: GraphEdge[];
  directed: boolean;
};

type GraphLayoutNode = {
  x: number;
  y: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function schemaType(schema?: Record<string, unknown>) {
  return String(schema?.type ?? "").trim();
}

function numberFromUnknown(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : "";
  }
  return "";
}

function stringifyScalar(value: unknown) {
  if (typeof value === "boolean") return value ? "Да" : "Нет";
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function normalizeGraphPayload(payload?: Record<string, unknown>): GraphPayload {
  const rawVertices = Array.isArray(payload?.vertices) ? payload.vertices : [];
  const rawEdges = Array.isArray(payload?.edges) ? payload.edges : [];

  return {
    vertices: rawVertices
      .map((item) => String(item ?? "").trim())
      .filter(Boolean),
    edges: rawEdges
      .map((item) => {
        const edge = isRecord(item) ? item : {};
        return {
          source: String(edge.source ?? "").trim(),
          target: String(edge.target ?? "").trim(),
        };
      })
      .filter((edge) => edge.source && edge.target),
    directed: Boolean(payload?.directed),
  };
}

function buildGraphEdgeLabels(graph: GraphPayload) {
  return graph.edges.map((edge, index) => ({
    id: `edge-${index + 1}`,
    label: graph.directed ? `${edge.source} -> ${edge.target}` : `${edge.source} - ${edge.target}`,
  }));
}

function buildGraphLayout(vertices: string[]): Record<string, GraphLayoutNode> {
  if (!vertices.length) return {};

  if (vertices.length === 1) {
    return { [vertices[0]]: { x: 160, y: 110 } };
  }

  const radius = vertices.length <= 3 ? 64 : vertices.length <= 6 ? 78 : 88;
  const centerX = 160;
  const centerY = 110;

  return Object.fromEntries(
    vertices.map((vertex, index) => {
      const angle = (-Math.PI / 2) + (index * (Math.PI * 2)) / vertices.length;
      return [
        vertex,
        {
          x: centerX + radius * Math.cos(angle),
          y: centerY + radius * Math.sin(angle),
        },
      ];
    }),
  );
}

function renderSignedTerm(value: number, powerLabel: string, isFirst: boolean) {
  if (value === 0) return "";
  const absolute = Math.abs(value);
  const sign = value < 0 ? (isFirst ? "-" : " - ") : isFirst ? "" : " + ";
  const coefficient = absolute === 1 && powerLabel ? "" : String(absolute);
  return `${sign}${coefficient}${powerLabel}`;
}

function isQuadraticCoefficients(payload?: Record<string, unknown>) {
  return (
    typeof payload?.a === "number" &&
    typeof payload?.b === "number" &&
    typeof payload?.c === "number"
  );
}

function GraphPreview({ graph }: { graph: GraphPayload }) {
  if (!graph.vertices.length) {
    return <div className="operation-task-schema__empty">Граф пока не задан.</div>;
  }

  const layout = buildGraphLayout(graph.vertices);

  return (
    <div className="operation-task-schema__graph">
      <div className="operation-task-schema__graph-canvas">
        <svg viewBox="0 0 320 220" role="img" aria-label="Граф входных данных">
          <defs>
            <marker
              id="operation-task-arrow"
              markerWidth="10"
              markerHeight="10"
              refX="8"
              refY="5"
              orient="auto"
              markerUnits="strokeWidth"
            >
              <path d="M0,0 L10,5 L0,10 z" fill="#35588f" />
            </marker>
          </defs>
          {graph.edges.map((edge, index) => {
            const source = layout[edge.source];
            const target = layout[edge.target];
            if (!source || !target) return null;
            return (
              <line
                key={`${edge.source}-${edge.target}-${index}`}
                x1={source.x}
                y1={source.y}
                x2={target.x}
                y2={target.y}
                className="operation-task-schema__graph-line"
                markerEnd={graph.directed ? "url(#operation-task-arrow)" : undefined}
              />
            );
          })}
          {graph.vertices.map((vertex) => {
            const node = layout[vertex];
            return (
              <g key={vertex}>
                <circle
                  cx={node.x}
                  cy={node.y}
                  r="22"
                  className="operation-task-schema__graph-node"
                />
                <text
                  x={node.x}
                  y={node.y + 5}
                  textAnchor="middle"
                  className="operation-task-schema__graph-label"
                >
                  {vertex}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <div className="operation-task-schema__graph-meta">
        <div className="operation-task-schema__chips">
          <span>{graph.directed ? "Ориентированный" : "Неориентированный"}</span>
          <span>Вершин: {graph.vertices.length}</span>
          <span>Ребер: {graph.edges.length}</span>
        </div>
        {graph.edges.length ? (
          <div className="operation-task-schema__edge-list">
            {buildGraphEdgeLabels(graph).map((edge) => (
              <span className="operation-task-schema__edge-chip" key={edge.id}>
                {edge.label}
              </span>
            ))}
          </div>
        ) : (
          <p className="operation-task-schema__hint">В графе пока нет ребер.</p>
        )}
      </div>
    </div>
  );
}

function ValuePreviewTable({
  rows,
  columns,
}: {
  rows: string[];
  columns: string[];
}) {
  return (
    <div className="operation-task-schema__matrix-shell">
      <table className="operation-task-schema__matrix">
        <thead>
          <tr>
            <th />
            {columns.map((column) => (
              <th key={column}>{column}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row}>
              <th>{row}</th>
              {columns.map((column) => (
                <td key={`${row}-${column}`}>?</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function GenericObjectPreview({ payload }: { payload: Record<string, unknown> }) {
  const entries = Object.entries(payload);
  if (!entries.length) {
    return <div className="operation-task-schema__empty">Входные данные не заданы.</div>;
  }

  return (
    <div className="operation-task-schema__fields">
      {entries.map(([key, value]) => (
        <div className="operation-task-schema__field-card" key={key}>
          <span>{key}</span>
          <strong>{stringifyScalar(value)}</strong>
        </div>
      ))}
    </div>
  );
}

function QuadraticEquationPreview({ payload }: { payload: Record<string, unknown> }) {
  const a = Number(payload.a);
  const b = Number(payload.b);
  const c = Number(payload.c);
  const expression = [
    renderSignedTerm(a, "x²", true),
    renderSignedTerm(b, "x", false),
    renderSignedTerm(c, "", false),
  ]
    .join("")
    .trim();

  return (
    <div className="operation-task-schema__equation">
      <span className="operation-task-schema__equation-label">Уравнение</span>
      <strong>{expression || "0"} = 0</strong>
      <div className="operation-task-schema__chips">
        <span>a = {a}</span>
        <span>b = {b}</span>
        <span>c = {c}</span>
      </div>
    </div>
  );
}

export function OperationInputPreview({ schema, payload }: OperationInputPreviewProps) {
  if (!schema || !payload) {
    return null;
  }

  const type = schemaType(schema);

  return (
    <section className="operation-task-schema">
      <div className="operation-task-schema__header">
        <div>
          <p className="card__eyebrow">Входные данные</p>
          <h3>Исходное условие</h3>
        </div>
        <span className="hero__chip">{type || "Схема"}</span>
      </div>

      {type === "Graph" ? <GraphPreview graph={normalizeGraphPayload(payload)} /> : null}
      {type !== "Graph" && isQuadraticCoefficients(payload) ? (
        <QuadraticEquationPreview payload={payload} />
      ) : null}
      {type !== "Graph" && !isQuadraticCoefficients(payload) ? (
        <GenericObjectPreview payload={payload} />
      ) : null}
    </section>
  );
}

function parseStructuredAnswer(
  valueText: string,
  fallbackFactory: () => Record<string, unknown>,
) {
  if (!valueText.trim()) {
    return fallbackFactory();
  }
  try {
    const parsed = JSON.parse(valueText);
    if (isRecord(parsed)) {
      return parsed;
    }
  } catch {
    // Переходим к черновику по схеме.
  }
  return fallbackFactory();
}

function serializeStructuredAnswer(value: Record<string, unknown>) {
  return JSON.stringify(value);
}

function buildAdjacencyDraft(inputPayload?: Record<string, unknown>, current?: Record<string, unknown>) {
  const graph = normalizeGraphPayload(inputPayload);
  const currentValues = Array.isArray(current?.values) ? current.values : [];

  return {
    vertices: graph.vertices,
    values: graph.vertices.map((_, rowIndex) =>
      graph.vertices.map((_, columnIndex) => {
        const row = Array.isArray(currentValues[rowIndex]) ? currentValues[rowIndex] : [];
        return numberFromUnknown(row[columnIndex]);
      }),
    ),
  };
}

function buildIncidenceDraft(inputPayload?: Record<string, unknown>, current?: Record<string, unknown>) {
  const graph = normalizeGraphPayload(inputPayload);
  const edgeLabels = buildGraphEdgeLabels(graph).map((edge) => edge.label);
  const currentValues = Array.isArray(current?.values) ? current.values : [];

  return {
    vertices: graph.vertices,
    edges: edgeLabels,
    values: graph.vertices.map((_, rowIndex) =>
      edgeLabels.map((_, columnIndex) => {
        const row = Array.isArray(currentValues[rowIndex]) ? currentValues[rowIndex] : [];
        return numberFromUnknown(row[columnIndex]);
      }),
    ),
  };
}

function buildDegreeSequenceDraft(inputPayload?: Record<string, unknown>, current?: Record<string, unknown>) {
  const graph = normalizeGraphPayload(inputPayload);
  const currentRows = Array.isArray(current?.sequence) ? current.sequence : [];

  return {
    vertices: graph.vertices,
    sequence: graph.vertices.map((vertex, index) => {
      const row = isRecord(currentRows[index]) ? currentRows[index] : {};
      const baseRow: Record<string, unknown> = {
        vertex,
        degree: numberFromUnknown(row.degree),
      };
      if (graph.directed) {
        baseRow.in_degree = numberFromUnknown(row.in_degree);
        baseRow.out_degree = numberFromUnknown(row.out_degree);
      }
      return baseRow;
    }),
  };
}

function buildScalarDraft(type: string, current?: Record<string, unknown>) {
  return {
    value: type === "integer" || type === "number" ? numberFromUnknown(current?.value) : current?.value ?? "",
  };
}

function buildObjectDraft(schema?: Record<string, unknown>, current?: Record<string, unknown>) {
  const fields = isRecord(schema?.fields) ? schema.fields : {};
  const result: Record<string, unknown> = {};

  for (const [fieldName, rawFieldSchema] of Object.entries(fields)) {
    const fieldType =
      typeof rawFieldSchema === "string"
        ? rawFieldSchema
        : String((isRecord(rawFieldSchema) ? rawFieldSchema.type : "") || "string");
    const currentValue = current?.[fieldName];

    if (fieldType === "boolean") {
      result[fieldName] = Boolean(currentValue);
    } else if (fieldType === "integer" || fieldType === "number") {
      result[fieldName] = numberFromUnknown(currentValue);
    } else {
      result[fieldName] = currentValue ?? "";
    }
  }

  return result;
}

function updateMatrixCell(
  matrix: Array<Array<number | string>>,
  rowIndex: number,
  columnIndex: number,
  rawValue: string,
) {
  return matrix.map((row, currentRowIndex) =>
    row.map((cell, currentColumnIndex) => {
      if (currentRowIndex !== rowIndex || currentColumnIndex !== columnIndex) {
        return cell;
      }
      return rawValue.trim() === "" ? "" : Number(rawValue);
    }),
  );
}

function MatrixAnswerEditor({
  title,
  rowLabels,
  columnLabels,
  values,
  onChange,
  disabled,
}: {
  title: string;
  rowLabels: string[];
  columnLabels: string[];
  values: Array<Array<number | string>>;
  onChange: (nextValues: Array<Array<number | string>>) => void;
  disabled?: boolean;
}) {
  return (
    <section className="operation-task-schema">
      <div className="operation-task-schema__header">
        <div>
          <p className="card__eyebrow">Ответ студента</p>
          <h3>{title}</h3>
        </div>
        <span className="hero__chip">Матрица</span>
      </div>
      <div className="operation-task-schema__matrix-shell">
        <table className="operation-task-schema__matrix">
          <thead>
            <tr>
              <th />
              {columnLabels.map((label) => (
                <th key={label}>{label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rowLabels.map((label, rowIndex) => (
              <tr key={label}>
                <th>{label}</th>
                {columnLabels.map((column, columnIndex) => (
                  <td key={`${label}-${column}`}>
                    <input
                      className="operation-task-schema__matrix-input"
                      disabled={disabled}
                      inputMode="numeric"
                      onChange={(event) =>
                        onChange(updateMatrixCell(values, rowIndex, columnIndex, event.target.value))
                      }
                      type="number"
                      value={String(values[rowIndex]?.[columnIndex] ?? "")}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function DegreeSequenceAnswerEditor({
  graph,
  draft,
  onChange,
  disabled,
}: {
  graph: GraphPayload;
  draft: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const rows = Array.isArray(draft.sequence) ? draft.sequence : [];

  return (
    <section className="operation-task-schema">
      <div className="operation-task-schema__header">
        <div>
          <p className="card__eyebrow">Ответ студента</p>
          <h3>Степени вершин</h3>
        </div>
        <span className="hero__chip">{graph.directed ? "Ориентированный" : "Неориентированный"}</span>
      </div>
      <div className="operation-task-schema__matrix-shell">
        <table className="operation-task-schema__matrix">
          <thead>
            <tr>
              <th>Вершина</th>
              {graph.directed ? <th>deg-</th> : null}
              {graph.directed ? <th>deg+</th> : null}
              <th>deg</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((rawRow, index) => {
              const row = isRecord(rawRow) ? rawRow : {};
              return (
                <tr key={String(row.vertex ?? index)}>
                  <th>{String(row.vertex ?? `V${index + 1}`)}</th>
                  {graph.directed ? (
                    <td>
                      <input
                        className="operation-task-schema__matrix-input"
                        disabled={disabled}
                        inputMode="numeric"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            sequence: rows.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...(isRecord(item) ? item : {}),
                                    in_degree:
                                      event.target.value.trim() === ""
                                        ? ""
                                        : Number(event.target.value),
                                  }
                                : item,
                            ),
                          })
                        }
                        type="number"
                        value={String(row.in_degree ?? "")}
                      />
                    </td>
                  ) : null}
                  {graph.directed ? (
                    <td>
                      <input
                        className="operation-task-schema__matrix-input"
                        disabled={disabled}
                        inputMode="numeric"
                        onChange={(event) =>
                          onChange({
                            ...draft,
                            sequence: rows.map((item, itemIndex) =>
                              itemIndex === index
                                ? {
                                    ...(isRecord(item) ? item : {}),
                                    out_degree:
                                      event.target.value.trim() === ""
                                        ? ""
                                        : Number(event.target.value),
                                  }
                                : item,
                            ),
                          })
                        }
                        type="number"
                        value={String(row.out_degree ?? "")}
                      />
                    </td>
                  ) : null}
                  <td>
                    <input
                      className="operation-task-schema__matrix-input"
                      disabled={disabled}
                      inputMode="numeric"
                      onChange={(event) =>
                        onChange({
                          ...draft,
                          sequence: rows.map((item, itemIndex) =>
                            itemIndex === index
                              ? {
                                  ...(isRecord(item) ? item : {}),
                                  degree:
                                    event.target.value.trim() === ""
                                      ? ""
                                      : Number(event.target.value),
                                }
                              : item,
                          ),
                        })
                      }
                      type="number"
                      value={String(row.degree ?? "")}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function GenericAnswerEditor({
  schema,
  draft,
  onChange,
  disabled,
}: {
  schema?: Record<string, unknown>;
  draft: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  disabled?: boolean;
}) {
  const type = schemaType(schema);
  if (type === "integer" || type === "number") {
    return (
      <section className="operation-task-schema">
        <div className="operation-task-schema__header">
          <div>
            <p className="card__eyebrow">Ответ студента</p>
            <h3>{type === "integer" ? "Целый результат" : "Числовой результат"}</h3>
          </div>
          <span className="hero__chip">{type}</span>
        </div>
        <label className="field">
          <span>Значение</span>
          <input
            disabled={disabled}
            inputMode="numeric"
            onChange={(event) =>
              onChange({
                value: event.target.value.trim() === "" ? "" : Number(event.target.value),
              })
            }
            type="number"
            value={String(draft.value ?? "")}
          />
        </label>
      </section>
    );
  }

  const fields = isRecord(schema?.fields) ? schema.fields : {};
  return (
    <section className="operation-task-schema">
      <div className="operation-task-schema__header">
        <div>
          <p className="card__eyebrow">Ответ студента</p>
          <h3>Структурированный ответ</h3>
        </div>
        <span className="hero__chip">{type || "Объект"}</span>
      </div>
      <div className="operation-task-schema__fields">
        {Object.entries(fields).map(([fieldName, rawFieldSchema]) => {
          const fieldType =
            typeof rawFieldSchema === "string"
              ? rawFieldSchema
              : String((isRecord(rawFieldSchema) ? rawFieldSchema.type : "") || "string");
          const currentValue = draft[fieldName];

          if (fieldType === "boolean") {
            return (
              <label className="trajectory-task-template__check" key={fieldName}>
                <input
                  checked={Boolean(currentValue)}
                  disabled={disabled}
                  onChange={(event) => onChange({ ...draft, [fieldName]: event.target.checked })}
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
                    ...draft,
                    [fieldName]:
                      fieldType === "integer" || fieldType === "number"
                        ? event.target.value.trim() === ""
                          ? ""
                          : Number(event.target.value)
                        : event.target.value,
                  })
                }
                type={fieldType === "integer" || fieldType === "number" ? "number" : "text"}
                value={String(currentValue ?? "")}
              />
            </label>
          );
        })}
      </div>
    </section>
  );
}

export function OperationAnswerEditor({
  schema,
  inputPayload,
  valueText,
  onChangeText,
  disabled,
}: OperationAnswerEditorProps) {
  if (!schema) {
    return null;
  }

  const type = schemaType(schema);

  if (type === "AdjacencyMatrix") {
    const draft = parseStructuredAnswer(valueText, () => buildAdjacencyDraft(inputPayload));
    const normalizedDraft = buildAdjacencyDraft(inputPayload, draft);
    return (
      <MatrixAnswerEditor
        columnLabels={normalizedDraft.vertices as string[]}
        disabled={disabled}
        onChange={(nextValues) =>
          onChangeText(
            serializeStructuredAnswer({
              ...normalizedDraft,
              values: nextValues,
            }),
          )
        }
        rowLabels={normalizedDraft.vertices as string[]}
        title="Построй матрицу смежности"
        values={normalizedDraft.values as Array<Array<number | string>>}
      />
    );
  }

  if (type === "IncidenceMatrix") {
    const draft = parseStructuredAnswer(valueText, () => buildIncidenceDraft(inputPayload));
    const normalizedDraft = buildIncidenceDraft(inputPayload, draft);
    return (
      <MatrixAnswerEditor
        columnLabels={normalizedDraft.edges as string[]}
        disabled={disabled}
        onChange={(nextValues) =>
          onChangeText(
            serializeStructuredAnswer({
              ...normalizedDraft,
              values: nextValues,
            }),
          )
        }
        rowLabels={normalizedDraft.vertices as string[]}
        title="Построй матрицу инцидентности"
        values={normalizedDraft.values as Array<Array<number | string>>}
      />
    );
  }

  if (type === "DegreeSequence") {
    const graph = normalizeGraphPayload(inputPayload);
    const draft = parseStructuredAnswer(valueText, () => buildDegreeSequenceDraft(inputPayload));
    const normalizedDraft = buildDegreeSequenceDraft(inputPayload, draft);
    return (
      <DegreeSequenceAnswerEditor
        disabled={disabled}
        draft={normalizedDraft}
        graph={graph}
        onChange={(nextValue) => onChangeText(serializeStructuredAnswer(nextValue))}
      />
    );
  }

  const draft = parseStructuredAnswer(valueText, () => {
    if (type === "integer" || type === "number") {
      return buildScalarDraft(type);
    }
    return buildObjectDraft(schema);
  });
  const normalizedDraft =
    type === "integer" || type === "number"
      ? buildScalarDraft(type, draft)
      : buildObjectDraft(schema, draft);

  return (
    <GenericAnswerEditor
      disabled={disabled}
      draft={normalizedDraft}
      onChange={(nextValue) => onChangeText(serializeStructuredAnswer(nextValue))}
      schema={schema}
    />
  );
}

export function hasStructuredOperationContent(content: StudentTaskContent) {
  return Boolean(content.input_payload && content.output_schema);
}

export function buildStructuredOperationAnswerText(
  currentAnswer: Record<string, unknown>,
  content: StudentTaskContent,
) {
  const text = String(currentAnswer.text ?? "");
  if (text.trim()) {
    return text;
  }

  const type = schemaType(content.output_schema);
  if (!content.input_payload || !content.output_schema) {
    return text;
  }

  if (type === "AdjacencyMatrix") {
    return serializeStructuredAnswer(buildAdjacencyDraft(content.input_payload));
  }
  if (type === "IncidenceMatrix") {
    return serializeStructuredAnswer(buildIncidenceDraft(content.input_payload));
  }
  if (type === "DegreeSequence") {
    return serializeStructuredAnswer(buildDegreeSequenceDraft(content.input_payload));
  }
  if (type === "integer" || type === "number") {
    return serializeStructuredAnswer(buildScalarDraft(type));
  }
  return serializeStructuredAnswer(buildObjectDraft(content.output_schema));
}

export function OperationOutputPreview({ content }: { content: StudentTaskContent }) {
  const type = schemaType(content.output_schema);
  if (!type) {
    return null;
  }

  if (type === "AdjacencyMatrix" || type === "IncidenceMatrix") {
    const graph = normalizeGraphPayload(content.input_payload);
    const columns =
      type === "AdjacencyMatrix"
        ? graph.vertices
        : buildGraphEdgeLabels(graph).map((edge) => edge.label);
    return (
      <section className="operation-task-schema operation-task-schema--compact">
        <div className="operation-task-schema__header">
          <div>
            <p className="card__eyebrow">Ожидаемый формат ответа</p>
            <h3>{type === "AdjacencyMatrix" ? "Матрица смежности" : "Матрица инцидентности"}</h3>
          </div>
          <span className="hero__chip">{type}</span>
        </div>
        <ValuePreviewTable columns={columns} rows={graph.vertices} />
      </section>
    );
  }

  if (type === "DegreeSequence") {
    const graph = normalizeGraphPayload(content.input_payload);
    return (
      <section className="operation-task-schema operation-task-schema--compact">
        <div className="operation-task-schema__header">
          <div>
            <p className="card__eyebrow">Ожидаемый формат ответа</p>
            <h3>Таблица степеней</h3>
          </div>
          <span className="hero__chip">{type}</span>
        </div>
        <div className="operation-task-schema__hint-list">
          <span>Вершины: {graph.vertices.join(", ") || "—"}</span>
          <span>{graph.directed ? "Укажи deg-, deg+ и общую степень." : "Укажи степень каждой вершины."}</span>
        </div>
      </section>
    );
  }

  return (
    <section className="operation-task-schema operation-task-schema--compact">
      <div className="operation-task-schema__header">
        <div>
          <p className="card__eyebrow">Ожидаемый формат ответа</p>
          <h3>Структура результата</h3>
        </div>
        <span className="hero__chip">{type}</span>
      </div>
    </section>
  );
}

export function OperationSolvedAnswerPreview({
  outputSchema,
  answer,
}: {
  outputSchema?: Record<string, unknown>;
  answer: unknown;
}) {
  const type = schemaType(outputSchema);
  const payload = isRecord(answer) ? answer : {};

  if (type === "AdjacencyMatrix") {
    const vertices = Array.isArray(payload.vertices)
      ? payload.vertices.map((item) => String(item))
      : [];
    const values = Array.isArray(payload.values) ? payload.values : [];
    return (
      <section className="operation-task-schema operation-task-schema--compact">
        <div className="operation-task-schema__header">
          <div>
            <p className="card__eyebrow">Правильный ответ</p>
            <h3>Матрица смежности</h3>
          </div>
          <span className="hero__chip">{type}</span>
        </div>
        <div className="operation-task-schema__matrix-shell">
          <table className="operation-task-schema__matrix">
            <thead>
              <tr>
                <th />
                {vertices.map((vertex) => (
                  <th key={vertex}>{vertex}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vertices.map((vertex, rowIndex) => {
                const row = Array.isArray(values[rowIndex]) ? values[rowIndex] : [];
                return (
                  <tr key={vertex}>
                    <th>{vertex}</th>
                    {vertices.map((columnVertex, columnIndex) => (
                      <td className="operation-task-schema__matrix-value" key={`${vertex}-${columnVertex}`}>
                        {String(row[columnIndex] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (type === "IncidenceMatrix") {
    const vertices = Array.isArray(payload.vertices)
      ? payload.vertices.map((item) => String(item))
      : [];
    const edges = Array.isArray(payload.edges)
      ? payload.edges.map((item) => String(item))
      : [];
    const values = Array.isArray(payload.values) ? payload.values : [];
    return (
      <section className="operation-task-schema operation-task-schema--compact">
        <div className="operation-task-schema__header">
          <div>
            <p className="card__eyebrow">Правильный ответ</p>
            <h3>Матрица инцидентности</h3>
          </div>
          <span className="hero__chip">{type}</span>
        </div>
        <div className="operation-task-schema__matrix-shell">
          <table className="operation-task-schema__matrix">
            <thead>
              <tr>
                <th />
                {edges.map((edge) => (
                  <th key={edge}>{edge}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {vertices.map((vertex, rowIndex) => {
                const row = Array.isArray(values[rowIndex]) ? values[rowIndex] : [];
                return (
                  <tr key={vertex}>
                    <th>{vertex}</th>
                    {edges.map((edge, columnIndex) => (
                      <td className="operation-task-schema__matrix-value" key={`${vertex}-${edge}`}>
                        {String(row[columnIndex] ?? "")}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (type === "DegreeSequence") {
    const rows = Array.isArray(payload.sequence) ? payload.sequence : [];
    return (
      <section className="operation-task-schema operation-task-schema--compact">
        <div className="operation-task-schema__header">
          <div>
            <p className="card__eyebrow">Правильный ответ</p>
            <h3>Степени вершин</h3>
          </div>
          <span className="hero__chip">{type}</span>
        </div>
        <div className="operation-task-schema__matrix-shell">
          <table className="operation-task-schema__matrix">
            <thead>
              <tr>
                <th>Вершина</th>
                <th>deg-</th>
                <th>deg+</th>
                <th>deg</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((rawRow, index) => {
                const row = isRecord(rawRow) ? rawRow : {};
                return (
                  <tr key={String(row.vertex ?? index)}>
                    <th>{String(row.vertex ?? `V${index + 1}`)}</th>
                    <td className="operation-task-schema__matrix-value">{String(row.in_degree ?? "—")}</td>
                    <td className="operation-task-schema__matrix-value">{String(row.out_degree ?? "—")}</td>
                    <td className="operation-task-schema__matrix-value">{String(row.degree ?? "")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  return (
    <section className="operation-task-schema operation-task-schema--compact">
      <div className="operation-task-schema__header">
        <div>
          <p className="card__eyebrow">Правильный ответ</p>
          <h3>Структурированный результат</h3>
        </div>
        <span className="hero__chip">{type || "Ответ"}</span>
      </div>
      <pre className="operation-task-schema__json">{JSON.stringify(answer, null, 2)}</pre>
    </section>
  );
}
