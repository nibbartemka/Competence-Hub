import RelationGraph, {
  type RGNode,
  type RGOptions,
  type RelationGraphComponent,
} from "relation-graph-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { fetchDisciplines } from "./api";
import { GraphEditor } from "./components/GraphEditor";
import { GraphNode } from "./components/GraphNode";
import { buildElementScene, buildTopicScene } from "./graphScene";
import type {
  DetailCard,
  Discipline,
  DisciplineKnowledgeGraph,
  ViewMode,
} from "./types";

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "http://127.0.0.1:8000/api";

type OverlayLegendItem = {
  markerClass: string;
  label: string;
  hint: string;
};

type OverlayLegendSection = {
  title: string;
  items: OverlayLegendItem[];
};

const GRAPH_OPTIONS: RGOptions = {
  debug: false,
  layout: { layoutName: "fixed" },
  defaultJunctionPoint: "border",
  defaultNodeShape: 1,
  defaultLineColor: "#3a5a96",
  defaultLineWidth: 2,
  defaultLineFontColor: "#38527d",
  defaultNodeBorderWidth: 0,
  defaultShowLineLabel: true,
  moveToCenterWhenRefresh: true,
  zoomToFitWhenRefresh: true,
  useAnimationWhenRefresh: true,
  useAnimationWhenExpanded: true,
  allowShowMiniToolBar: true,
  allowShowFullscreenMenu: true,
  allowShowZoomMenu: true,
  hideNodeContentByZoom: false,
  lineUseTextPath: false,
  defaultLineTextOffset_y: -10,
  defaultLineTextOffset_x: 0,
};

const TOPIC_LEGEND_SECTIONS: OverlayLegendSection[] = [
  {
    title: "Arrows",
    items: [
      {
        markerClass: "graph-legend-overlay__marker--topic-arrow",
        label: "Topic dependency",
        hint: "One topic helps prepare the next topic.",
      },
    ],
  },
  {
    title: "Colors",
    items: [
      {
        markerClass: "graph-legend-overlay__marker--topic-color",
        label: "Blue",
        hint: "Topic nodes and topic graph connections.",
      },
      {
        markerClass: "graph-legend-overlay__marker--required-color",
        label: "Dark",
        hint: "Required elements before the topic starts.",
      },
      {
        markerClass: "graph-legend-overlay__marker--formed-color",
        label: "Green",
        hint: "Elements learned after the topic.",
      },
    ],
  },
];

const ELEMENT_LEGEND_SECTIONS: OverlayLegendSection[] = [
  {
    title: "Arrows",
    items: [
      {
        markerClass: "graph-legend-overlay__marker--required-arrow",
        label: "Required -> topic",
        hint: "Dark arrow points into the topic.",
      },
      {
        markerClass: "graph-legend-overlay__marker--formed-arrow",
        label: "Topic -> learned",
        hint: "Green arrow goes from topic to learned element.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-arrow",
        label: "Element relation",
        hint: "Orange dashed arrow shows semantic relation between know-elements.",
      },
    ],
  },
  {
    title: "Colors",
    items: [
      {
        markerClass: "graph-legend-overlay__marker--required-color",
        label: "Dark",
        hint: "Required elements.",
      },
      {
        markerClass: "graph-legend-overlay__marker--formed-color",
        label: "Green",
        hint: "Elements that will be learned.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "Orange",
        hint: "Relation labels and semantic connections.",
      },
    ],
  },
  {
    title: "Know relation types",
    items: [
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "requires",
        hint: "A depends on B.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "builds_on",
        hint: "A is built on B.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "contains / part_of",
        hint: "A contains B or A is part of B.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "property_of",
        hint: "A is a property of B.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "refines / generalizes",
        hint: "A is more specific or more general than B.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "similar",
        hint: "Concepts are related, not hierarchical.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "contrasts_with",
        hint: "Concepts should be distinguished.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-color",
        label: "used_with",
        hint: "Concepts are commonly used together.",
      },
    ],
  },
];

function buildSceneFromView(
  graphData: DisciplineKnowledgeGraph,
  view: ViewMode,
  preferredNodeId?: string,
) {
  if (view.level === "elements") {
    return buildElementScene(graphData, view.topicId, preferredNodeId);
  }

  return buildTopicScene(graphData, preferredNodeId);
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось загрузить данные графа.";
}

async function fetchKnowledgeGraphDirect(
  disciplineId: string,
): Promise<{ debug: string; graph: DisciplineKnowledgeGraph }> {
  const response = await fetch(
    `${API_BASE}/disciplines/${disciplineId}/knowledge-graph?ts=${Date.now()}`,
    {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
      },
    },
  );

  const rawText = await response.text();
  const parsed = JSON.parse(rawText) as DisciplineKnowledgeGraph;
  const topicsCount = Array.isArray(parsed.topics) ? parsed.topics.length : "not-array";
  const topicNames = Array.isArray(parsed.topics)
    ? parsed.topics.map((topic) => topic.name).join(", ") || "none"
    : "not-array";

  if (!response.ok) {
    throw new Error(rawText || `HTTP ${response.status}`);
  }

  return {
    debug:
      `status=${response.status}; keys=${Object.keys(parsed).join(",")}; ` +
      `topics=${topicsCount}; topicNames=${topicNames}`,
    graph: parsed,
  };
}

export default function App() {
  const graphRef = useRef<RelationGraphComponent>();

  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [selectedDisciplineId, setSelectedDisciplineId] = useState("");
  const [graphData, setGraphData] = useState<DisciplineKnowledgeGraph | null>(null);
  const [view, setView] = useState<ViewMode>({ level: "topics" });
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [graphFetchDebug, setGraphFetchDebug] = useState("");

  const activeDisciplineId = selectedDisciplineId || disciplines[0]?.id || "";

  const scene = useMemo(() => {
    if (!graphData) {
      return null;
    }
    return buildSceneFromView(graphData, view, selectedNodeId || undefined);
  }, [graphData, view, selectedNodeId]);

  useEffect(() => {
    let cancelled = false;

    async function loadDisciplines() {
      try {
        setLoading(true);
        setError("");
        const items = await fetchDisciplines();
        if (cancelled) {
          return;
        }

        setDisciplines(items);
        if (!items.length) {
          setSelectedDisciplineId("");
          setGraphData(null);
          return;
        }

        setSelectedDisciplineId((current) => current || items[0].id);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(extractErrorMessage(loadError));
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadDisciplines();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!activeDisciplineId) {
      return;
    }

    let cancelled = false;

    async function loadGraphData() {
      try {
        setLoading(true);
        setError("");
        setGraphFetchDebug("loading knowledge-graph...");

        const { debug, graph: nextGraph } = await fetchKnowledgeGraphDirect(activeDisciplineId);
        if (cancelled) {
          return;
        }

        setGraphFetchDebug(debug);
        const nextScene = buildTopicScene(nextGraph);
        setGraphData(nextGraph);
        setView({ level: "topics" });
        setSelectedNodeId(nextScene.defaultSelectedNodeId);
      } catch (loadError) {
        if (cancelled) {
          return;
        }
        setError(extractErrorMessage(loadError));
        setGraphFetchDebug((current) => `${current} | error=${extractErrorMessage(loadError)}`);
        setGraphData(null);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void loadGraphData();

    return () => {
      cancelled = true;
    };
  }, [activeDisciplineId]);

  useEffect(() => {
    if (!scene) {
      return;
    }

    if (!selectedNodeId || !scene.detailsByNodeId[selectedNodeId]) {
      if (scene.defaultSelectedNodeId && scene.defaultSelectedNodeId !== selectedNodeId) {
        setSelectedNodeId(scene.defaultSelectedNodeId);
      }
    }
  }, [scene, selectedNodeId]);

  useEffect(() => {
    if (!scene || !graphRef.current) {
      return;
    }

    graphRef.current.setJsonData(
      {
        rootId: scene.rootId,
        nodes: scene.nodes,
        lines: scene.lines,
      },
      (graphInstance) => {
        if (scene.defaultSelectedNodeId) {
          graphInstance.setCheckedNode(scene.defaultSelectedNodeId);
        }
      },
    );
  }, [scene]);

  useEffect(() => {
    if (!selectedNodeId || !graphRef.current) {
      return;
    }

    graphRef.current.getInstance().setCheckedNode(selectedNodeId);
  }, [selectedNodeId]);

  async function applyView(nextView: ViewMode, preferredNodeId?: string) {
    if (!graphData) {
      return;
    }

    let activeGraph = graphData;
    let nextScene = buildSceneFromView(activeGraph, nextView, preferredNodeId);

    if (
      nextView.level === "elements" &&
      nextScene.key.startsWith("missing-topic:") &&
      activeDisciplineId
    ) {
      const { graph: freshGraph } = await fetchKnowledgeGraphDirect(activeDisciplineId);
      activeGraph = freshGraph;
      nextScene = buildSceneFromView(freshGraph, nextView, preferredNodeId);
      setGraphData(freshGraph);
    }

    setView(nextView);
    setSelectedNodeId(nextScene.defaultSelectedNodeId);
  }

  function handleDisciplineChange(nextDisciplineId: string) {
    if (nextDisciplineId === activeDisciplineId) {
      return;
    }

    setSelectedDisciplineId(nextDisciplineId);
    setGraphData(null);
    setSelectedNodeId("");
    setView({ level: "topics" });
    setError("");
  }

  function handleNodeClick(node: RGNode) {
    const payload = node.data as { entity?: string; topicId?: string } | undefined;
    if (!payload?.entity) {
      setSelectedNodeId(node.id);
      return;
    }

    if (payload.entity === "topic" && payload.topicId) {
      void applyView({ level: "elements", topicId: payload.topicId });
      return false;
    }

    if (payload.entity === "topic-focus" && payload.topicId) {
      void applyView({ level: "topics" }, `topic:${payload.topicId}`);
      return false;
    }

    setSelectedNodeId(node.id);
    return false;
  }

  async function refreshSelectedDisciplineGraph() {
    if (!activeDisciplineId) {
      return;
    }

    const { debug, graph: nextGraph } = await fetchKnowledgeGraphDirect(activeDisciplineId);
    const nextView =
      view.level === "elements" &&
      nextGraph.topics.some((topic) => topic.id === view.topicId)
        ? view
        : { level: "topics" as const };
    const nextScene = buildSceneFromView(nextGraph, nextView, selectedNodeId || undefined);
    setGraphFetchDebug(debug);
    setGraphData(nextGraph);
    setView(nextView);
    setSelectedNodeId(nextScene.defaultSelectedNodeId);
    setError("");
  }

  const selectedDiscipline = disciplines.find(
    (discipline) => discipline.id === activeDisciplineId,
  );
  const detail: DetailCard | null =
    scene?.detailsByNodeId[selectedNodeId || scene.defaultSelectedNodeId] ?? null;
  const overlayLegendSections =
    view.level === "topics" ? TOPIC_LEGEND_SECTIONS : ELEMENT_LEGEND_SECTIONS;

  return (
    <div className={`page-shell page-shell--${view.level}`}>
      <header className="hero">
        <div>
          <p className="hero__eyebrow">Competence Hub</p>
          <h1>Визуализация графа знаний</h1>
          <p className="hero__subtitle">
            Первый уровень показывает темы дисциплины, второй уровень раскрывает
            знания, умения и владения конкретной темы.
          </p>
        </div>

        <div className="hero__controls">
          <label className="field">
            <span>Дисциплина</span>
            <select
              value={activeDisciplineId}
              onChange={(event) => handleDisciplineChange(event.target.value)}
              disabled={!disciplines.length || loading}
            >
              {disciplines.map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.name}
                </option>
              ))}
            </select>
          </label>

          <div className="hero__chip">
            {view.level === "topics"
              ? "Режим тем"
              : `Элементы темы: ${detail?.title ?? ""}`}
          </div>
        </div>
      </header>

      <div className="workspace">
        <aside className="inspector">
          <section className="card card--soft">
            <div className="card__header">
              <span className="card__eyebrow">Навигация</span>
              {view.level === "elements" && (
                <button
                  className="ghost-button"
                  onClick={() => void applyView({ level: "topics" })}
                  type="button"
                >
                  Назад к темам
                </button>
              )}
            </div>

            <h2>{scene?.title ?? selectedDiscipline?.name ?? "Граф дисциплины"}</h2>
            <p className="card__text">
              {scene?.subtitle ??
                "Выбери дисциплину, а затем кликни по теме, чтобы раскрыть ее элементы."}
            </p>

            {scene?.legend.length ? (
              <div className="legend">
                {scene.legend.map((item) => (
                  <div className="legend__item" key={item.label}>
                    <span className={`legend__swatch legend__swatch--${item.tone}`} />
                    <div>
                      <strong>{item.label}</strong>
                      <p>{item.hint}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          <section className="card" key={`${scene?.key ?? "empty"}-${selectedNodeId}`}>
            <div className="card__header">
              <span className="card__eyebrow">Выбранная вершина</span>
            </div>
            {detail ? (
              <>
                <h3>{detail.title}</h3>
                {detail.subtitle ? <p className="card__lead">{detail.subtitle}</p> : null}
                {detail.description ? (
                  <p className="card__text">{detail.description}</p>
                ) : null}

                <div className="chip-row">
                  {detail.chips.map((chip) => (
                    <span className={`chip chip--${chip.tone}`} key={chip.label}>
                      {chip.label}
                    </span>
                  ))}
                </div>

                <div className="stat-grid">
                  {detail.stats.map((stat) => (
                    <div className="stat" key={stat.label}>
                      <span>{stat.label}</span>
                      <strong>{stat.value}</strong>
                    </div>
                  ))}
                </div>

                {detail.footnote ? (
                  <p className="card__footnote">{detail.footnote}</p>
                ) : null}
              </>
            ) : (
              <p className="card__text">
                Кликни по вершине графа, чтобы увидеть детали и перейти между
                уровнями.
              </p>
            )}
          </section>

          <section className="card card--accent">
            <div className="card__header">
              <span className="card__eyebrow">Замечание</span>
            </div>
            <p className="card__text">
              Для больших дисциплин стоит добавить отдельный backend-метод,
              который будет считать уровни тем и метрики покрытия требований
              заранее. Тогда UI останется быстрым даже на очень плотных графах.
            </p>
          </section>
        </aside>

        <div className="workspace-main">
          {activeDisciplineId ? (
            <GraphEditor
              disciplineId={activeDisciplineId}
              topics={graphData?.topics ?? []}
              disciplineElements={graphData?.knowledge_elements ?? []}
              onDataChanged={refreshSelectedDisciplineGraph}
            />
          ) : null}

          <section className="graph-stage">
            <div className="graph-toolbar">
              <div>
                <span className="graph-toolbar__eyebrow">Текущий срез</span>
                <h2>{scene?.title ?? "Построение графа"}</h2>
              </div>
              <p className="graph-toolbar__hint">
                {view.level === "topics"
                  ? "Клик по теме открывает ее внутренний граф элементов."
                  : "Клик по центральной теме возвращает на уровень тем."}
              </p>
            </div>

            <div className="graph-surface">
              {loading ? (
                <div className="status-view">
                  <div className="status-view__pulse" />
                  <h3>Загружаю граф</h3>
                  <p>Собираю темы, зависимости и элементы дисциплины.</p>
                </div>
              ) : error ? (
                <div className="status-view status-view--error">
                  <h3>Не удалось открыть граф</h3>
                  <p>{error}</p>
                </div>
              ) : !scene ? (
                <div className="status-view">
                  <h3>Нет данных для визуализации</h3>
                  <p>Добавь дисциплины и темы, затем страница покажет их граф.</p>
                  <p>
                    debug: disciplines={disciplines.length}, activeDisciplineId=
                    {activeDisciplineId || "empty"}, topics=
                    {graphData?.topics.length ?? 0}
                  </p>
                  <p>fetch-debug: {graphFetchDebug || "empty"}</p>
                </div>
              ) : (
                <>
                  <div className="graph-frame">
                    <RelationGraph
                      ref={graphRef}
                      options={GRAPH_OPTIONS}
                      nodeSlot={GraphNode}
                      onNodeClick={handleNodeClick}
                    />
                  </div>

                  <aside className="graph-legend-overlay">
                    <p className="graph-legend-overlay__eyebrow">Legend</p>
                    {overlayLegendSections.map((section) => (
                      <section className="graph-legend-overlay__section" key={section.title}>
                        <h3>{section.title}</h3>
                        <div className="graph-legend-overlay__items">
                          {section.items.map((item) => (
                            <div className="graph-legend-overlay__item" key={item.label}>
                              <span
                                className={`graph-legend-overlay__marker ${item.markerClass}`}
                              />
                              <div>
                                <strong>{item.label}</strong>
                                <p>{item.hint}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      </section>
                    ))}
                  </aside>
                </>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
