import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
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
import { disciplinePathValue, matchesDisciplineIdentifier } from "./disciplineRouting";
import { GraphEditor } from "./components/GraphEditor";
import {
    GraphNode,
    GraphNodeRuntimeStateProvider,
    type GraphNodeRuntimeState,
} from "./components/GraphNode";
import {
    buildFocusedScene,
    hasConcreteNodeSelection,
    NO_NODE_SELECTION,
} from "./graphFocus";
import { usePersistedGraphViewport } from "./graphViewport";
import { buildElementScene, buildTopicScene } from "./graphScene";
import { actionHoverMotion, cardHoverMotion, revealMotion } from "./motionPresets";
import type {
    CompetenceType,
    DetailCard,
    Discipline,
    DisciplineKnowledgeGraph,
    GraphScene,
    KnowledgeElement,
    SceneNodeData,
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
    allowShowMiniToolBar: false,
    allowShowFullscreenMenu: false,
    allowShowZoomMenu: false,
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

const COMPETENCE_FILTER_OPTIONS: Array<{ label: string; value: CompetenceType }> = [
    { label: "Знать", value: "know" },
    { label: "Уметь", value: "can" },
    { label: "Владеть", value: "master" },
];

const DEFAULT_COMPETENCE_FILTERS: Record<CompetenceType, boolean> = {
    know: true,
    can: true,
    master: true,
};

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

function waitForPaint() {
    return new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

function isCompetenceType(value: unknown): value is CompetenceType {
    return value === "know" || value === "can" || value === "master";
}

function buildDetailValueKey(label: string, value: string) {
    return `${label}:${value}`;
}

function filterElementSceneByCompetence(
    scene: GraphScene,
    filters: Record<CompetenceType, boolean>,
) {
    const nodes = scene.nodes.filter((node) => {
        const data = node.data as SceneNodeData | undefined;
        if (data?.entity !== "element") {
            return true;
        }

        return isCompetenceType(data.badgeTone) ? filters[data.badgeTone] : true;
    });
    const visibleNodeIds = new Set(nodes.map((node) => node.id));
    const detailsByNodeId = Object.fromEntries(
        Object.entries(scene.detailsByNodeId).filter(([nodeId]) => visibleNodeIds.has(nodeId)),
    );
    const defaultSelectedNodeId = visibleNodeIds.has(scene.defaultSelectedNodeId)
        ? scene.defaultSelectedNodeId
        : visibleNodeIds.has(scene.rootId)
            ? scene.rootId
            : nodes[0]?.id ?? "";

    return {
        ...scene,
        rootId: visibleNodeIds.has(scene.rootId) ? scene.rootId : defaultSelectedNodeId,
        nodes,
        lines: scene.lines.filter(
            (line) => visibleNodeIds.has(line.from) && visibleNodeIds.has(line.to),
        ),
        defaultSelectedNodeId,
        detailsByNodeId,
    };
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
    const [exportingImage, setExportingImage] = useState(false);
    const [competenceFilters, setCompetenceFilters] = useState(DEFAULT_COMPETENCE_FILTERS);

    const currentDiscipline = disciplines.find((d) => matchesDisciplineIdentifier(d, disciplineId));
    const resolvedDiscipline = graphData?.discipline ?? currentDiscipline ?? null;
    const resolvedDisciplineId = resolvedDiscipline?.id ?? "";
    const resolvedDisciplinePath = disciplinePathValue(resolvedDiscipline, disciplineId);

    const unlinkedElements = useMemo(() => {
        const linkedElementIds = new Set(topicKnowledgeLinks.map((link) => link.element_id));
        return allElements.filter(
            (element) =>
                element.discipline_id === resolvedDisciplineId && !linkedElementIds.has(element.id),
        );
    }, [allElements, resolvedDisciplineId, topicKnowledgeLinks]);

    const { scene, dimmedNodeIds } = useMemo(() => {
        if (!graphData) {
            return {
                scene: null as GraphScene | null,
                dimmedNodeIds: new Set<string>(),
            };
        }

        const preferredNodeId = hasConcreteNodeSelection(selectedNodeId)
            ? selectedNodeId
            : undefined;
        const baseScene = buildSceneFromView(graphData, view, preferredNodeId);

        const nextScene = {
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

        const filteredScene = view.level === "elements"
            ? filterElementSceneByCompetence(nextScene, competenceFilters)
            : nextScene;

        return buildFocusedScene(filteredScene, selectedNodeId);
    }, [competenceFilters, graphData, selectedNodeId, view]);

    const graphNodeRuntimeState = useMemo<GraphNodeRuntimeState>(
        () => ({
            dimmedNodeIds,
        }),
        [dimmedNodeIds],
    );
    const {
        layoutLoading,
        onCanvasDragEnd,
        onCanvasDragging,
        onNodeDragEnd,
        onNodeDragging,
        onZoomEnd,
    } = usePersistedGraphViewport({
        graphRef,
        scene,
        scopeId: resolvedDisciplineId || disciplineId,
        scopeType: "discipline-knowledge",
    });
    const graphLoading = loading || layoutLoading;

    // Загрузка списка дисциплин
    useEffect(() => {
        let cancelled = false;

        async function loadDisciplines() {
            try {
                const items = await fetchDisciplines();
                if (!cancelled) {
                    setDisciplines(items);
                    
                    const disciplineExists = items.some((d) => matchesDisciplineIdentifier(d, disciplineId));
                    if (!disciplineExists && items.length > 0) {
                        navigate(`/disciplines/${disciplinePathValue(items[0], items[0].id)}/knowledge`, { replace: true });
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
                    fetchKnowledgeElements(undefined, resolvedDisciplineId || undefined),
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
    }, [resolvedDisciplineId]);

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

        if (selectedNodeId === NO_NODE_SELECTION) {
            return;
        }

        if (!selectedNodeId || !scene.detailsByNodeId[selectedNodeId]) {
            if (scene.defaultSelectedNodeId && scene.defaultSelectedNodeId !== selectedNodeId) {
                setSelectedNodeId(scene.defaultSelectedNodeId);
            }
        }
    }, [scene, selectedNodeId]);

    useEffect(() => {
        if (!graphRef.current) return;

        const graphInstance = graphRef.current.getInstance();
        if (!hasConcreteNodeSelection(selectedNodeId)) {
            graphInstance.setCheckedNode("");
            return;
        }

        graphInstance.setCheckedNode(selectedNodeId);
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

    function handleCanvasClick() {
        setSelectedNodeId(NO_NODE_SELECTION);
    }

    function toggleCompetenceFilter(competenceType: CompetenceType) {
        setCompetenceFilters((current) => ({
            ...current,
            [competenceType]: !current[competenceType],
        }));
    }

    async function handleDownloadGraphImage() {
        if (!graphRef.current || !scene) return;

        try {
            setExportingImage(true);
            setError("");
            const graphInstance = graphRef.current.getInstance();
            await graphInstance.zoomToFit();
            await waitForPaint();
            const filePrefix = view.level === "topics" ? "knowledge-topics" : "knowledge-elements";
            await graphInstance.downloadAsImage("png", `${filePrefix}-${Date.now()}`);
        } catch (downloadError) {
            setError(extractErrorMessage(downloadError));
        } finally {
            setExportingImage(false);
        }
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
                fetchKnowledgeElements(undefined, nextGraph.discipline.id),
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

    const detail: DetailCard | null =
        selectedNodeId === NO_NODE_SELECTION
            ? null
            : scene?.detailsByNodeId[selectedNodeId || scene.defaultSelectedNodeId] ?? null;
    const overlayLegendSections = view.level === "topics" ? TOPIC_LEGEND_SECTIONS : ELEMENT_LEGEND_SECTIONS;

    return (
        <div className={`page-shell immersive-page immersive-page--knowledge page-shell--${view.level}`}>
            <motion.header className="hero immersive-page__hero" {...revealMotion(0.04)}>
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
                            value={resolvedDisciplinePath}
                            onChange={(event) => handleDisciplineChange(event.target.value)}
                            disabled={!disciplines.length || loading}
                        >
                            {disciplines.map((discipline) => (
                                <option key={discipline.id} value={disciplinePathValue(discipline, discipline.id)}>
                                    {discipline.name}
                                </option>
                            ))}
                        </select>
                    </label>
                </div>
            </motion.header>

            <div className="workspace immersive-page__grid immersive-page__grid--knowledge graph-workspace">
                <motion.aside className="inspector" {...revealMotion(0.1, 22)}>
                    <motion.section className="card card--soft inspector-card inspector-card--nav" {...cardHoverMotion} layout>
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

                            <button
                                className="secondary-button"
                                onClick={() => navigate(`/disciplines/${resolvedDisciplinePath}/trajectory`)}
                                type="button"
                                disabled={!disciplineId}
                            >
                                Собрать траекторию
                            </button>
                        </div>

                        <h2>{scene?.title ?? resolvedDiscipline?.name ?? "Граф дисциплины"}</h2>
                        <p className="card__text">
                            {scene?.subtitle ?? "Выбери дисциплину, а затем кликни по теме, чтобы раскрыть ее элементы."}
                        </p>
                    </motion.section>

                    <motion.section className="card card--soft inspector-card inspector-card--orphans" {...cardHoverMotion} layout>
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
                    </motion.section>

                    <motion.section className="card inspector-card inspector-card--detail" {...cardHoverMotion} layout>
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
                                            {Array.isArray(stat.value) ? (
                                                <ul className="stat__value-list">
                                                    {stat.value.map((value) => (
                                                        <li key={buildDetailValueKey(stat.label, value)}>{value}</li>
                                                    ))}
                                                </ul>
                                            ) : (
                                                <strong>{stat.value}</strong>
                                            )}
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
                    </motion.section>
                </motion.aside>

                <motion.div className="workspace-main" {...revealMotion(0.16, 26)}>
                    <motion.section className="graph-stage" {...cardHoverMotion} layout>
                        <motion.div className="graph-toolbar" layout>
                            <div>
                                <span className="graph-toolbar__eyebrow">Текущий срез</span>
                                <h2>{scene?.title ?? "Построение графа"}</h2>
                            </div>
                            <div className="graph-toolbar__actions">
                                <button
                                    className="secondary-button graph-export-button"
                                    disabled={!scene || loading || exportingImage}
                                    onClick={() => void handleDownloadGraphImage()}
                                    type="button"
                                >
                                    {exportingImage ? "Сохраняю..." : "Сохранить PNG"}
                                </button>
                                <p className="graph-toolbar__hint">
                                    {view.level === "topics"
                                        ? "Кнопка внутри карточки темы открывает ее внутренний граф элементов."
                                        : "Кнопка в центральной теме возвращает на уровень тем."}
                                </p>
                            </div>
                        </motion.div>

                        <div className="graph-surface">
                            <div className="graph-surface__ambient graph-surface__ambient--primary" />
                            <div className="graph-surface__ambient graph-surface__ambient--secondary" />
                            <div className="graph-surface__grid" />
                            {graphLoading ? (
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
                                    <motion.div
                                        className="graph-frame"
                                        initial={{ opacity: 0 }}
                                        animate={{ opacity: 1 }}
                                        transition={{ duration: 0.32 }}
                                    >
                                        <GraphNodeRuntimeStateProvider value={graphNodeRuntimeState}>
                                            <RelationGraph
                                                ref={graphRef}
                                                options={GRAPH_OPTIONS}
                                                nodeSlot={GraphNode}
                                                onCanvasClick={handleCanvasClick}
                                                onCanvasDragEnd={onCanvasDragEnd}
                                                onCanvasDragging={onCanvasDragging}
                                                onNodeClick={handleNodeClick}
                                                onNodeDragEnd={onNodeDragEnd}
                                                onNodeDragging={onNodeDragging}
                                                onZoomEnd={onZoomEnd}
                                            />
                                        </GraphNodeRuntimeStateProvider>
                                    </motion.div>

                                    <motion.aside
                                        className="graph-legend-overlay"
                                        initial={{ opacity: 0, y: 18, scale: 0.96 }}
                                        animate={{ opacity: 1, y: 0, scale: 1 }}
                                        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
                                    >
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
                                    </motion.aside>

                                    {view.level === "elements" ? (
                                        <motion.aside
                                            className="graph-filter-overlay"
                                            aria-label="Фильтр элементов по типу компетенции"
                                        >
                                            {COMPETENCE_FILTER_OPTIONS.map((option) => (
                                                <label
                                                    className={`competence-filter__item competence-filter__item--${option.value}`}
                                                    key={option.value}
                                                >
                                                    <input
                                                        checked={competenceFilters[option.value]}
                                                        onChange={() => toggleCompetenceFilter(option.value)}
                                                        type="checkbox"
                                                    />
                                                    <span>{option.label}</span>
                                                </label>
                                            ))}
                                        </motion.aside>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </motion.section>
                </motion.div>
            </div>

            <AnimatePresence>
            {editorOpen && disciplineId ? (
                <motion.div
                    className="modal-backdrop"
                    onClick={() => setEditorOpen(false)}
                    role="presentation"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.22 }}
                >
                    <motion.div
                        className="modal-panel"
                        onClick={(event) => event.stopPropagation()}
                        role="dialog"
                        initial={{ opacity: 0, y: 24, scale: 0.97, filter: "blur(8px)" }}
                        animate={{ opacity: 1, y: 0, scale: 1, filter: "blur(0px)" }}
                        transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
                    >
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
                                disciplineId={resolvedDisciplineId || disciplineId}
                                topics={graphData?.topics ?? []}
                                disciplineElements={graphData?.knowledge_elements ?? []}
                                knowledgeElementRelations={
                                    graphData?.knowledge_element_relations ?? []
                                }
                                onDataChanged={refreshSelectedDisciplineGraph}
                            />
                        </div>
                    </motion.div>
                </motion.div>
            ) : null}
            </AnimatePresence>
        </div>
    );
}
