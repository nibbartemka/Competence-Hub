import RelationGraph, {
  type RGNode,
  type RGOptions,
  type RelationGraphComponent,
} from "relation-graph-react";
import { useEffect, useMemo, useRef, useState } from "react";

import {
  fetchDisciplines,
  fetchKnowledgeElements,
  fetchTopicKnowledgeElements,
} from "./api";
import { GraphEditor } from "./components/GraphEditor";
import { GraphNode } from "./components/GraphNode";
import { buildElementScene, buildTopicScene } from "./graphScene";
import type {
  DetailCard,
  Discipline,
  DisciplineKnowledgeGraph,
  KnowledgeElement,
  TopicKnowledgeElement,
  ViewMode,
} from "./types";

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "http://127.0.0.1:8000/api";

const KNOWLEDGE_PATH_PATTERN = /^\/disciplines\/([^/]+)\/knowledge\/?$/;

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
    title: "Стрелки",
    items: [
      {
        markerClass: "graph-legend-overlay__marker--topic-arrow",
        label: "Требуется",
        hint: "Обязательная зависимость между темами.",
      },
    ],
  },
  // {
  //   title: "Р¦РІРµС‚Р°",
  //   items: [
  //     {
  //       markerClass: "graph-legend-overlay__marker--topic-color",
  //       label: "РЎРёРЅРёР№",
  //       hint: "РўРµРјС‹ Рё РѕР±СЏР·Р°С‚РµР»СЊРЅС‹Рµ СЃРІСЏР·Рё РјРµР¶РґСѓ С‚РµРјР°РјРё.",
  //     },
  //     {
  //       markerClass: "graph-legend-overlay__marker--required-color",
  //       label: "РўРµРјРЅС‹Р№",
  //       hint: "РўСЂРµР±СѓРµРјС‹Рµ СЌР»РµРјРµРЅС‚С‹ РґРѕ РЅР°С‡Р°Р»Р° С‚РµРјС‹.",
  //     },
  //     {
  //       markerClass: "graph-legend-overlay__marker--formed-color",
  //       label: "Р—РµР»РµРЅС‹Р№",
  //       hint: "РќРѕРІС‹Рµ СЌР»РµРјРµРЅС‚С‹ Рё РІРѕР·РјРѕР¶РЅС‹Р№ РїСѓС‚СЊ РјРµР¶РґСѓ С‚РµРјР°РјРё.",
  //     },
  //   ],
  // },
];

const ELEMENT_LEGEND_SECTIONS: OverlayLegendSection[] = [
  {
    title: "Стрелки",
    items: [
      {
        markerClass: "graph-legend-overlay__marker--required-arrow",
        label: "Требуемый элемент -> тема",
        hint: "Темная стрелка указывает на предпосылку для темы.",
      },
      {
        markerClass: "graph-legend-overlay__marker--formed-arrow",
        label: "Тема -> новый элемент",
        hint: "Зеленая стрелка показывает сформированный результат.",
      },
      {
        markerClass: "graph-legend-overlay__marker--relation-arrow",
        label: "Связь между элементами",
        hint: "Оранжевая пунктирная стрелка показывает семантическую связь.",
      },
    ],
  },
  // {
  //   title: "Р¦РІРµС‚Р°",
  //   items: [
  //     {
  //       markerClass: "graph-legend-overlay__marker--required-color",
  //       label: "РўРµРјРЅС‹Р№",
  //       hint: "РўСЂРµР±СѓРµРјС‹Рµ СЌР»РµРјРµРЅС‚С‹.",
  //     },
  //     {
  //       markerClass: "graph-legend-overlay__marker--formed-color",
  //       label: "Р—РµР»РµРЅС‹Р№",
  //       hint: "Р­Р»РµРјРµРЅС‚С‹, РєРѕС‚РѕСЂС‹Рµ Р±СѓРґСѓС‚ СЃС„РѕСЂРјРёСЂРѕРІР°РЅС‹.",
  //     },
  //     {
  //       markerClass: "graph-legend-overlay__marker--relation-color",
  //       label: "РћСЂР°РЅР¶РµРІС‹Р№",
  //       hint: "РџРѕРґРїРёСЃРё Рё СЃРІСЏР·Рё РјРµР¶РґСѓ СЌР»РµРјРµРЅС‚Р°РјРё.",
  //     },
  //   ],
  // },
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

function parseDisciplineIdFromPath(pathname: string) {
  const match = pathname.match(KNOWLEDGE_PATH_PATTERN);
  return match?.[1] ?? "";
}

function buildKnowledgePath(disciplineId: string) {
  return `/disciplines/${disciplineId}/knowledge`;
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
  const [selectedDisciplineId, setSelectedDisciplineId] = useState(() =>
    parseDisciplineIdFromPath(window.location.pathname),
  );
  const [graphData, setGraphData] = useState<DisciplineKnowledgeGraph | null>(null);
  const [view, setView] = useState<ViewMode>({ level: "topics" });
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [graphFetchDebug, setGraphFetchDebug] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);
  const [allElements, setAllElements] = useState<KnowledgeElement[]>([]);
  const [topicKnowledgeLinks, setTopicKnowledgeLinks] = useState<TopicKnowledgeElement[]>([]);
  const [unlinkedLoading, setUnlinkedLoading] = useState(true);
  const [unlinkedError, setUnlinkedError] = useState("");

  const activeDisciplineId = selectedDisciplineId || disciplines[0]?.id || "";

  useEffect(() => {
    function syncDisciplineFromLocation() {
      setSelectedDisciplineId(parseDisciplineIdFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", syncDisciplineFromLocation);

    return () => {
      window.removeEventListener("popstate", syncDisciplineFromLocation);
    };
  }, []);

  useEffect(() => {
    if (!activeDisciplineId) {
      return;
    }

    const nextPath = buildKnowledgePath(activeDisciplineId);
    if (window.location.pathname !== nextPath) {
      window.history.replaceState({}, "", nextPath);
    }
  }, [activeDisciplineId]);

  const unlinkedElements = useMemo(() => {
    const linkedElementIds = new Set(topicKnowledgeLinks.map((link) => link.element_id));
    return allElements.filter(
      (element) =>
        element.discipline_id === activeDisciplineId && !linkedElementIds.has(element.id),
    );
  }, [activeDisciplineId, allElements, topicKnowledgeLinks]);

  const scene = useMemo(() => {
    if (!graphData) {
      return null;
    }

    const baseScene = buildSceneFromView(graphData, view, selectedNodeId || undefined);

    return {
      ...baseScene,
      nodes: baseScene.nodes.map((node) => {
        const data = node.data as
          | ({
              entity?: string;
              topicId?: string;
              actionTopicId?: string;
              onHintClick?: () => void;
            } & Record<
              string,
              unknown
            >)
          | undefined;

        if (!data?.entity) {
          return node;
        }

        if (data.entity === "topic" && data.topicId) {
          return {
            ...node,
            data: {
              ...data,
              onHintClick: () => {
                void applyView({ level: "elements", topicId: data.topicId! }, node.id);
              },
            },
          };
        }

        if (data.entity === "topic-focus" && data.topicId) {
          return {
            ...node,
            data: {
              ...data,
              onHintClick: () => {
                void applyView({ level: "topics" }, `topic:${data.topicId}`);
              },
            },
          };
        }

        if (data.entity === "element" && data.actionTopicId) {
          return {
            ...node,
            data: {
              ...data,
              onHintClick: () => {
                void applyView(
                  { level: "elements", topicId: data.actionTopicId! },
                  `topic-focus:${data.actionTopicId}`,
                );
              },
            },
          };
        }

        return node;
      }),
    };
  }, [graphData, selectedNodeId, view]);

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

        const routeDisciplineId = parseDisciplineIdFromPath(window.location.pathname);
        const currentDisciplineId = selectedDisciplineId || routeDisciplineId;
        const hasCurrentDiscipline = items.some(
          (discipline) => discipline.id === currentDisciplineId,
        );
        const nextDisciplineId = hasCurrentDiscipline
          ? currentDisciplineId
          : items[0].id;

        setSelectedDisciplineId(nextDisciplineId);

        const nextPath = buildKnowledgePath(nextDisciplineId);
        if (window.location.pathname !== nextPath) {
          window.history.replaceState({}, "", nextPath);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(extractErrorMessage(loadError));
        }
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
    let cancelled = false;

    async function loadElementMetadata() {
      try {
        setUnlinkedLoading(true);
        setUnlinkedError("");
        const [elements, links] = await Promise.all([
          fetchKnowledgeElements(undefined, activeDisciplineId),
          fetchTopicKnowledgeElements(),
        ]);
        if (cancelled) {
          return;
        }

        setAllElements(elements);
        setTopicKnowledgeLinks(links);
      } catch (loadError) {
        if (!cancelled) {
          setUnlinkedError(extractErrorMessage(loadError));
        }
      } finally {
        if (!cancelled) {
          setUnlinkedLoading(false);
        }
      }
    }

    void loadElementMetadata();

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

    window.history.pushState({}, "", buildKnowledgePath(nextDisciplineId));
    setSelectedDisciplineId(nextDisciplineId);
    setGraphData(null);
    setSelectedNodeId("");
    setView({ level: "topics" });
    setError("");
  }

  function handleNodeClick(node: RGNode) {
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

    try {
      setUnlinkedLoading(true);
      const [elements, links] = await Promise.all([
        fetchKnowledgeElements(undefined, activeDisciplineId),
        fetchTopicKnowledgeElements(),
      ]);
      setAllElements(elements);
      setTopicKnowledgeLinks(links);
      setUnlinkedError("");
    } catch (loadError) {
      setUnlinkedError(extractErrorMessage(loadError));
    } finally {
      setUnlinkedLoading(false);
    }
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
          <h1>Граф знаний дисциплины</h1>
          {/* <p className="hero__subtitle">
            РџРµСЂРІС‹Р№ СѓСЂРѕРІРµРЅСЊ РїРѕРєР°Р·С‹РІР°РµС‚ С‚РµРјС‹ РґРёСЃС†РёРїР»РёРЅС‹, РІС‚РѕСЂРѕР№ СѓСЂРѕРІРµРЅСЊ СЂР°СЃРєСЂС‹РІР°РµС‚ Р·РЅР°РЅРёСЏ,
            СѓРјРµРЅРёСЏ Рё РІР»Р°РґРµРЅРёСЏ РєРѕРЅРєСЂРµС‚РЅРѕР№ С‚РµРјС‹.
          </p> */}
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

          {/* <div className="hero__chip">
            {view.level === "topics"
              ? "Р РµР¶РёРј С‚РµРј"
              : `Р­Р»РµРјРµРЅС‚С‹ С‚РµРјС‹: ${detail?.title ?? ""}`}
          </div> */}
        </div>
      </header>

      <div className="workspace">
        <aside className="inspector">
          <section className="card card--soft">
            <div className="card__header">
              <span className="card__eyebrow">Навигация</span>
            </div>

            <div className="inspector-actions">
              {view.level === "elements" ? (
                <button
                  className="ghost-button"
                  onClick={() => void applyView({ level: "topics" })}
                  type="button"
                >
                  Назад к темам
                </button>
              ) : null}

              <button
                className="primary-button inspector-actions__editor"
                onClick={() => setEditorOpen(true)}
                type="button"
                disabled={!activeDisciplineId}
              >
                Редактор
              </button>
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
          <section className="card card--soft">
            <div className="card__header">
              <span className="card__eyebrow">Непривязанные элементы</span>
            </div>

            {unlinkedLoading ? (
              <p className="card__text">Проверяю элементы...</p>
            ) : unlinkedError ? (
              <p className="card__text">{unlinkedError}</p>
            ) : unlinkedElements.length ? (
              <div className="orphan-list">
                {unlinkedElements.map((element) => (
                  <span className="orphan-list__chip" key={element.id}>
                    {element.name}
                  </span>
                ))}
              </div>
            ) : (
              <p className="card__text">Все элементы уже привязаны к темам.</p>
            )}
          </section>

          <section className="card" key={`${scene?.key ?? "empty"}-${selectedNodeId}`}>
            <div className="card__header">
              <span className="card__eyebrow">Выбранная вершина</span>
            </div>
            {detail ? (
              <>
                <h3>{detail.title}</h3>
                {detail.subtitle ? <p className="card__lead">{detail.subtitle}</p> : null}
                {detail.description ? <p className="card__text">{detail.description}</p> : null}

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

                {detail.footnote ? <p className="card__footnote">{detail.footnote}</p> : null}
              </>
            ) : (
              <p className="card__text">
                Кликни по вершине графа, чтобы увидеть детали и перейти между уровнями.
              </p>
            )}
          </section>
        </aside>

        <div className="workspace-main">
          <section className="graph-stage">
            <div className="graph-toolbar">
              <div>
                <span className="graph-toolbar__eyebrow">Текущий срез</span>
                <h2>{scene?.title ?? "Построение графа"}</h2>
              </div>
              <p className="graph-toolbar__hint">
                {view.level === "topics"
                  ? "Кнопка внутри карточки темы открывает ее внутренний граф элементов."
                  : "Кнопка в центральной теме возвращает на уровень тем."}
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
                    <p className="graph-legend-overlay__eyebrow">Легенда</p>
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

      {editorOpen && activeDisciplineId ? (
        <div
          className="modal-backdrop"
          onClick={() => setEditorOpen(false)}
          role="presentation"
        >
          <div
            className="modal-panel"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Редактор графа"
          >
            <div className="modal-panel__header">
              <div>
                <p className="card__eyebrow">Редактор</p>
                <h2>Редактор графа знаний</h2>
              </div>
              <button
                className="ghost-button"
                onClick={() => setEditorOpen(false)}
                type="button"
              >
                Закрыть
              </button>
            </div>

            <div className="modal-panel__body">
              <GraphEditor
                disciplineId={activeDisciplineId}
                topics={graphData?.topics ?? []}
                disciplineElements={graphData?.knowledge_elements ?? []}
                onDataChanged={refreshSelectedDisciplineGraph}
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
