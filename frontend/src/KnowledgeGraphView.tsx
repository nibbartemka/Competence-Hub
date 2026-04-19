import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import RelationGraph, {
    type RGNode,
    type RGOptions,
    type RelationGraphComponent,
} from "relation-graph-react";
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

const TOPIC_LEGEND_SECTIONS = [
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
];

const ELEMENT_LEGEND_SECTIONS = [
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

    if (!response.ok) {
        throw new Error(rawText || `HTTP ${response.status}`);
    }

    return {
        debug: `status=${response.status}; topics=${parsed.topics?.length ?? 0}`,
        graph: parsed,
    };
}

interface KnowledgeGraphViewProps {
    disciplineId: string;
}

export function KnowledgeGraphView({ disciplineId }: KnowledgeGraphViewProps) {
    const navigate = useNavigate();
    const graphRef = useRef<RelationGraphComponent>();

    const [disciplines, setDisciplines] = useState<Discipline[]>([]);
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

    const currentDiscipline = disciplines.find((d) => d.id === disciplineId);

    const unlinkedElements = useMemo(() => {
        const linkedElementIds = new Set(topicKnowledgeLinks.map((link) => link.element_id));
        return allElements.filter((element) => !linkedElementIds.has(element.id));
    }, [allElements, topicKnowledgeLinks]);

    const scene = useMemo(() => {
        if (!graphData) {
            return null;
        }

        const baseScene = buildSceneFromView(graphData, view, selectedNodeId || undefined);

        return {
            ...baseScene,
            nodes: baseScene.nodes.map((node) => {
                const data = node.data as any;
                
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

    // Загрузка списка дисциплин
    useEffect(() => {
        let cancelled = false;

        async function loadDisciplines() {
            try {
                const items = await fetchDisciplines();
                if (!cancelled) {
                    setDisciplines(items);
                    
                    const disciplineExists = items.some((d) => d.id === disciplineId);
                    if (!disciplineExists && items.length > 0) {
                        navigate(`/disciplines/${items[0].id}/knowledge`, { replace: true });
                    }
                }
            } catch (loadError) {
                if (!cancelled) {
                    setError(extractErrorMessage(loadError));
                }
            }
        }

        void loadDisciplines();

        return () => {
            cancelled = true;
        };
    }, [disciplineId, navigate]);

    // Загрузка метаданных
    useEffect(() => {
        let cancelled = false;

        async function loadElementMetadata() {
            try {
                setUnlinkedLoading(true);
                setUnlinkedError("");
                const [elements, links] = await Promise.all([
                    fetchKnowledgeElements(),
                    fetchTopicKnowledgeElements(),
                ]);
                if (cancelled) return;

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

    // Загрузка графа
    useEffect(() => {
        let cancelled = false;

        async function loadGraphData() {
            try {
                setLoading(true);
                setError("");
                setGraphFetchDebug("loading knowledge-graph...");

                const { debug, graph: nextGraph } = await fetchKnowledgeGraphDirect(disciplineId);
                if (cancelled) return;

                setGraphFetchDebug(debug);
                const nextScene = buildTopicScene(nextGraph);
                setGraphData(nextGraph);
                setView({ level: "topics" });
                setSelectedNodeId(nextScene.defaultSelectedNodeId);
            } catch (loadError) {
                if (cancelled) return;
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
    }, [disciplineId]);

    useEffect(() => {
        if (!scene) return;

        if (!selectedNodeId || !scene.detailsByNodeId[selectedNodeId]) {
            if (scene.defaultSelectedNodeId && scene.defaultSelectedNodeId !== selectedNodeId) {
                setSelectedNodeId(scene.defaultSelectedNodeId);
            }
        }
    }, [scene, selectedNodeId]);

    useEffect(() => {
        if (!scene || !graphRef.current) return;

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
        if (!selectedNodeId || !graphRef.current) return;
        graphRef.current.getInstance().setCheckedNode(selectedNodeId);
    }, [selectedNodeId]);

    async function applyView(nextView: ViewMode, preferredNodeId?: string) {
        if (!graphData) return;

        let activeGraph = graphData;
        let nextScene = buildSceneFromView(activeGraph, nextView, preferredNodeId);

        if (nextView.level === "elements" && nextScene.key.startsWith("missing-topic:") && disciplineId) {
            const { graph: freshGraph } = await fetchKnowledgeGraphDirect(disciplineId);
            activeGraph = freshGraph;
            nextScene = buildSceneFromView(freshGraph, nextView, preferredNodeId);
            setGraphData(freshGraph);
        }

        setView(nextView);
        setSelectedNodeId(nextScene.defaultSelectedNodeId);
    }

    function handleDisciplineChange(nextDisciplineId: string) {
        if (nextDisciplineId === disciplineId) return;
        navigate(`/disciplines/${nextDisciplineId}/knowledge`);
    }

    function handleNodeClick(node: RGNode) {
        setSelectedNodeId(node.id);
        return false;
    }

    async function refreshSelectedDisciplineGraph() {
        const { debug, graph: nextGraph } = await fetchKnowledgeGraphDirect(disciplineId);

        const nextView = view.level === "elements" &&
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
                fetchKnowledgeElements(),
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

    const detail: DetailCard | null = scene?.detailsByNodeId[selectedNodeId || scene.defaultSelectedNodeId] ?? null;
    const overlayLegendSections = view.level === "topics" ? TOPIC_LEGEND_SECTIONS : ELEMENT_LEGEND_SECTIONS;

    return (
        <div className={`page-shell page-shell--${view.level}`}>
            <header className="hero">
                <div>
                    <p className="hero__eyebrow">Competence Hub</p>
                    <h1>Граф знаний дисциплины</h1>
                </div>

                <div className="hero__controls">
                    <button
                        className="ghost-button hero__back-button"
                        onClick={() => navigate("/")}
                        type="button"
                    >
                        Назад на главную
                    </button>

                    <label className="field">
                        <span>Дисциплина</span>
                        <select
                            value={disciplineId}
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
                </div>
            </header>

            <div className="workspace">
                <aside className="inspector">
                    {/* Inspector content - same as before */}
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
                                disabled={!disciplineId}
                            >
                                Редактор
                            </button>
                        </div>

                        <h2>{scene?.title ?? currentDiscipline?.name ?? "Граф дисциплины"}</h2>
                        <p className="card__text">
                            {scene?.subtitle ?? "Выбери дисциплину, а затем кликни по теме, чтобы раскрыть ее элементы."}
                        </p>
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

                    <section className="card">
                        <div className="card__header">
                            <span className="card__eyebrow">Выбранная вершина</span>
                        </div>
                        {detail ? (
                            <>
                                <h3>{detail.title}</h3>
                                {detail.subtitle && <p className="card__lead">{detail.subtitle}</p>}
                                {detail.description && <p className="card__text">{detail.description}</p>}

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

                                {detail.footnote && <p className="card__footnote">{detail.footnote}</p>}
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
                                    <p>debug: disciplines={disciplines.length}, disciplineId={disciplineId || "empty"}</p>
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
                                                            <span className={`graph-legend-overlay__marker ${item.markerClass}`} />
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

            {editorOpen && disciplineId ? (
                <div className="modal-backdrop" onClick={() => setEditorOpen(false)} role="presentation">
                    <div className="modal-panel" onClick={(event) => event.stopPropagation()} role="dialog">
                        <div className="modal-panel__header">
                            <div>
                                <p className="card__eyebrow">Редактор</p>
                                <h2>Редактор графа знаний</h2>
                            </div>
                            <button className="ghost-button" onClick={() => setEditorOpen(false)} type="button">
                                Закрыть
                            </button>
                        </div>

                        <div className="modal-panel__body">
                            <GraphEditor
                                disciplineId={disciplineId}
                                topics={graphData?.topics ?? []}
                                disciplineElements={allElements}
                                onDataChanged={refreshSelectedDisciplineGraph}
                            />
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}
