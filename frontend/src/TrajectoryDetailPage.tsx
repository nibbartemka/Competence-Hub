import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import RelationGraph, {
  type JsonLine,
  type JsonNode,
  type RGNode,
  type RGOptions,
  type RelationGraphComponent,
} from "relation-graph-react";

import {
  fetchDisciplineKnowledgeGraph,
  fetchLearningTrajectory,
  isAbortError,
  updateLearningTrajectoryStatus,
  updateLearningTrajectoryTopicOrder,
} from "./api";
import { GraphNode } from "./components/GraphNode";
import type {
  DetailCard,
  DisciplineKnowledgeGraph,
  KnowledgeElement,
  LearningTrajectory,
  LearningTrajectoryTopic,
  SceneNodeData,
  Topic,
} from "./types";

const GRAPH_OPTIONS: RGOptions = {
  debug: false,
  layout: { layoutName: "fixed" },
  defaultJunctionPoint: "border",
  defaultNodeShape: 1,
  defaultLineColor: "#365a95",
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
};

type ToastMessage = {
  id: string;
  kind: "error" | "success";
  text: string;
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось выполнить действие с траекторией.";
}

function estimateTrajectoryNodeHeight(topic: Topic) {
  const text = topic.description?.trim() || "Описание темы пока не добавлено.";
  return Math.min(360, 196 + Math.ceil(text.length / 30) * 16);
}

function topicName(topicById: Map<string, Topic>, topicId: string) {
  return topicById.get(topicId)?.name ?? "Тема не найдена";
}

function elementName(elementById: Map<string, KnowledgeElement>, elementId: string) {
  return elementById.get(elementId)?.name ?? "Элемент не найден";
}

function statusLabel(status: LearningTrajectory["status"]) {
  if (status === "active") return "Активна";
  if (status === "archived") return "Архив";
  return "Черновик";
}

function nextStatusAction(status: LearningTrajectory["status"]) {
  if (status === "draft") {
    return { label: "Активировать", status: "active" as const };
  }

  if (status === "active") {
    return { label: "Перевести в архив", status: "archived" as const };
  }

  return { label: "Вернуть в черновик", status: "draft" as const };
}

function validateTopicOrder(order: string[], graph: DisciplineKnowledgeGraph) {
  const elementById = new Map(graph.knowledge_elements.map((element) => [element.id, element]));
  const topicById = new Map(graph.topics.map((topic) => [topic.id, topic]));
  const formedElementIds = new Set<string>();

  for (const topicId of order) {
    const requiredLinks = graph.topic_knowledge_elements.filter(
      (link) => link.topic_id === topicId && link.role === "required",
    );
    const missingElements = requiredLinks
      .filter((link) => !formedElementIds.has(link.element_id))
      .map((link) => elementName(elementById, link.element_id));

    if (missingElements.length) {
      return `Тема "${topicName(topicById, topicId)}" не может стоять здесь: сначала должны быть сформированы элементы ${missingElements.join(", ")}.`;
    }

    for (const link of graph.topic_knowledge_elements) {
      if (link.topic_id === topicId && link.role === "formed") {
        formedElementIds.add(link.element_id);
      }
    }
  }

  return "";
}

function buildTrajectoryScene(
  graph: DisciplineKnowledgeGraph,
  trajectory: LearningTrajectory,
  topicOrder: string[],
) {
  const topicById = new Map(graph.topics.map((topic) => [topic.id, topic]));
  const trajectoryTopicByTopicId = new Map(
    trajectory.topics.map((trajectoryTopic) => [trajectoryTopic.topic_id, trajectoryTopic]),
  );
  const selectedTopicIds = new Set(topicOrder);
  const nodes: JsonNode[] = [];
  const lines: JsonLine[] = [];
  const detailsByNodeId: Record<string, DetailCard> = {};

  topicOrder.forEach((topicId, index) => {
    const topic = topicById.get(topicId);
    const trajectoryTopic = trajectoryTopicByTopicId.get(topicId);
    if (!topic || !trajectoryTopic) return;

    const nodeId = `topic:${topic.id}`;
    const selectedElementsCount = trajectoryTopic.elements.length;
    const requiredCount = graph.topic_knowledge_elements.filter(
      (link) => link.topic_id === topic.id && link.role === "required",
    ).length;
    const formedCount = graph.topic_knowledge_elements.filter(
      (link) => link.topic_id === topic.id && link.role === "formed",
    ).length;
    const row = Math.floor(index / 3);
    const col = index % 3;

    const data: SceneNodeData = {
      entity: "topic",
      tone: "topic",
      badge: "Тема",
      title: topic.name,
      subtitle: `Шаг ${index + 1} в траектории`,
      description: topic.description ?? "Описание темы пока не добавлено.",
      metrics: [
        `Порог ${trajectoryTopic.threshold}`,
        `${selectedElementsCount} элементов`,
        `Req ${requiredCount}`,
        `New ${formedCount}`,
      ],
      hint: "В траектории",
      isSelected: true,
      lockState: "open",
      sequenceNumber: index + 1,
      topicId: topic.id,
    };

    nodes.push({
      id: nodeId,
      text: topic.name,
      x: 160 + col * 330,
      y: 170 + row * 340,
      width: 270,
      height: estimateTrajectoryNodeHeight(topic),
      nodeShape: 1,
      data,
    });

    detailsByNodeId[nodeId] = {
      title: topic.name,
      subtitle: `Шаг ${index + 1} в траектории`,
      description: topic.description ?? "Описание темы пока не добавлено.",
      chips: [
        { label: `Порог темы: ${trajectoryTopic.threshold}`, tone: "topic" },
        { label: `Элементов: ${selectedElementsCount}`, tone: "formed" },
      ],
      stats: [
        { label: "Требуется ЗУН", value: String(requiredCount) },
        { label: "Формируется ЗУН", value: String(formedCount) },
        { label: "Выбрано элементов", value: String(selectedElementsCount) },
      ],
      footnote: "Порядок тем можно поменять в мини-редакторе под графом.",
    };
  });

  for (let index = 0; index < topicOrder.length - 1; index += 1) {
    lines.push({
      from: `topic:${topicOrder[index]}`,
      to: `topic:${topicOrder[index + 1]}`,
      text: "следующий шаг",
      color: "#178364",
      fontColor: "#146c53",
      lineWidth: 2.6,
      animation: 1,
      showEndArrow: true,
      textOffset_y: -14,
    });
  }

  for (const dependency of graph.topic_dependencies) {
    if (
      !selectedTopicIds.has(dependency.dependent_topic_id) ||
      !selectedTopicIds.has(dependency.prerequisite_topic_id)
    ) {
      continue;
    }

    lines.push({
      from: `topic:${dependency.dependent_topic_id}`,
      to: `topic:${dependency.prerequisite_topic_id}`,
      text: "требует",
      color: "#365a95",
      fontColor: "#365a95",
      lineWidth: 2,
      dashType: 3,
      animation: 2,
      showEndArrow: true,
      textOffset_y: -18,
    });
  }

  return {
    rootId: nodes[0]?.id ?? "",
    nodes,
    lines,
    detailsByNodeId,
    defaultSelectedNodeId: nodes[0]?.id ?? "",
  };
}

export default function TrajectoryDetailPage() {
  const { disciplineId, trajectoryId } = useParams<{
    disciplineId: string;
    trajectoryId: string;
  }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const graphRef = useRef<RelationGraphComponent>();

  const [graph, setGraph] = useState<DisciplineKnowledgeGraph | null>(null);
  const [trajectory, setTrajectory] = useState<LearningTrajectory | null>(null);
  const [topicOrder, setTopicOrder] = useState<string[]>([]);
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggedTopicId, setDraggedTopicId] = useState("");
  const [dragOverTopicId, setDragOverTopicId] = useState("");
  const [studentPreviewOpen, setStudentPreviewOpen] = useState(false);
  const [notifications, setNotifications] = useState<ToastMessage[]>([]);

  function pushNotification(kind: ToastMessage["kind"], text: string) {
    setNotifications((current) => [
      ...current,
      { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, kind, text },
    ]);
  }

  function dismissNotification(id: string) {
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }

  useEffect(() => {
    if (searchParams.get("preview") === "student") {
      setStudentPreviewOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!disciplineId || !trajectoryId) return;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        const [nextGraph, nextTrajectory] = await Promise.all([
          fetchDisciplineKnowledgeGraph(disciplineId!, controller.signal),
          fetchLearningTrajectory(trajectoryId!, controller.signal),
        ]);
        const nextOrder = nextTrajectory.topics
          .slice()
          .sort((left, right) => left.position - right.position)
          .map((topic) => topic.topic_id);

        setGraph(nextGraph);
        setTrajectory(nextTrajectory);
        setTopicOrder(nextOrder);
        setSelectedNodeId(nextOrder[0] ? `topic:${nextOrder[0]}` : "");
      } catch (error) {
        if (!isAbortError(error)) {
          pushNotification("error", extractErrorMessage(error));
        }
      } finally {
        setLoading(false);
      }
    }

    void load();

    return () => controller.abort();
  }, [disciplineId, trajectoryId]);

  const topicById = useMemo(
    () => new Map((graph?.topics ?? []).map((topic) => [topic.id, topic])),
    [graph],
  );
  const elementById = useMemo(
    () => new Map((graph?.knowledge_elements ?? []).map((element) => [element.id, element])),
    [graph],
  );
  const trajectoryTopicByTopicId = useMemo(
    () => new Map((trajectory?.topics ?? []).map((topic) => [topic.topic_id, topic])),
    [trajectory],
  );
  const scene = useMemo(() => {
    if (!graph || !trajectory) return null;
    return buildTrajectoryScene(graph, trajectory, topicOrder);
  }, [graph, trajectory, topicOrder]);
  const canEditTrajectory = trajectory?.status === "draft" && trajectory.is_actual;

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

  async function persistTopicOrder(nextOrder: string[]) {
    if (!graph || !trajectory || !trajectoryId) return;
    if (!canEditTrajectory) {
      pushNotification(
        "error",
        trajectory.status === "draft"
          ? "Траектория устарела относительно текущей версии графа знаний. Сначала пересобери её."
          : "Редактировать можно только траектории в статусе «Черновик».",
      );
      return;
    }

    const error = validateTopicOrder(nextOrder, graph);
    if (error) {
      pushNotification("error", `Такой порядок невозможен. ${error}`);
      return;
    }

    try {
      setSaving(true);
      const updatedTrajectory = await updateLearningTrajectoryTopicOrder(trajectoryId, nextOrder);
      const savedOrder = updatedTrajectory.topics
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((topic) => topic.topic_id);

      setTrajectory(updatedTrajectory);
      setTopicOrder(savedOrder);
      setSelectedNodeId(savedOrder[0] ? `topic:${savedOrder[0]}` : "");
      pushNotification("success", "Порядок тем в траектории сохранён.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function moveTopic(topicId: string, direction: -1 | 1) {
    const index = topicOrder.indexOf(topicId);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= topicOrder.length) return;

    const nextOrder = topicOrder.slice();
    [nextOrder[index], nextOrder[nextIndex]] = [nextOrder[nextIndex], nextOrder[index]];
    void persistTopicOrder(nextOrder);
  }

  function reorderTopic(sourceTopicId: string, targetTopicId: string) {
    if (!sourceTopicId || sourceTopicId === targetTopicId) return;

    const sourceIndex = topicOrder.indexOf(sourceTopicId);
    const targetIndex = topicOrder.indexOf(targetTopicId);
    if (sourceIndex < 0 || targetIndex < 0) return;

    const nextOrder = topicOrder.slice();
    const [movedTopicId] = nextOrder.splice(sourceIndex, 1);
    nextOrder.splice(targetIndex, 0, movedTopicId);
    void persistTopicOrder(nextOrder);
  }

  function handleTopicDragStart(event: DragEvent<HTMLButtonElement>, topicId: string) {
    setDraggedTopicId(topicId);
    setDragOverTopicId("");
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", topicId);
  }

  function handleTopicDragOver(event: DragEvent<HTMLElement>, topicId: string) {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    if (draggedTopicId && draggedTopicId !== topicId) {
      setDragOverTopicId(topicId);
    }
  }

  function handleTopicDrop(event: DragEvent<HTMLElement>, targetTopicId: string) {
    event.preventDefault();
    const sourceTopicId = draggedTopicId || event.dataTransfer.getData("text/plain");
    setDraggedTopicId("");
    setDragOverTopicId("");
    reorderTopic(sourceTopicId, targetTopicId);
  }

  function handleTopicDragEnd() {
    setDraggedTopicId("");
    setDragOverTopicId("");
  }

  function handleNodeClick(node: RGNode) {
    setSelectedNodeId(node.id);
    return false;
  }

  async function handleStatusChange(status: LearningTrajectory["status"]) {
    if (!trajectoryId) return;

    try {
      setSaving(true);
      const updatedTrajectory = await updateLearningTrajectoryStatus(trajectoryId, status);
      setTrajectory(updatedTrajectory);
      pushNotification("success", `Статус траектории изменён: ${statusLabel(status)}.`);
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  if (!disciplineId || !trajectoryId) return null;

  return (
    <div className="page-shell trajectory-page trajectory-detail-page">
      {notifications.length ? (
        <div className="toast-stack" aria-live="polite" aria-label="Уведомления">
          {notifications.map((notification) => (
            <article
              className={`toast-message toast-message--${notification.kind}`}
              key={notification.id}
            >
              <p>{notification.text}</p>
              <button
                aria-label="Закрыть уведомление"
                onClick={() => dismissNotification(notification.id)}
                type="button"
              >
                ×
              </button>
            </article>
          ))}
        </div>
      ) : null}

      <header className="hero trajectory-hero">
        <div>
          <p className="hero__eyebrow">Learning path</p>
          <h1>{trajectory?.name ?? "Траектория изучения"}</h1>
          <p className="hero__subtitle">
            Просмотр сохранённой траектории и быстрый редактор порядка тем.
          </p>
        </div>

        <div className="hero__controls">
          <button
            className="ghost-button"
            onClick={() => navigate(`/disciplines/${disciplineId}/trajectory`)}
            type="button"
          >
            К списку траекторий
          </button>
          <button
            className="ghost-button"
            onClick={() => navigate(`/disciplines/${disciplineId}/knowledge`)}
            type="button"
          >
            К графу знаний
          </button>
          <button
            className="ghost-button"
            onClick={() => setStudentPreviewOpen((current) => !current)}
            type="button"
          >
            {studentPreviewOpen ? "Скрыть предпросмотр" : "Предпросмотр студента"}
          </button>
          {trajectory ? (
            <button
              className="primary-button"
              disabled={saving}
              onClick={() => void handleStatusChange(nextStatusAction(trajectory.status).status)}
              type="button"
            >
              {nextStatusAction(trajectory.status).label}
            </button>
          ) : null}
        </div>
      </header>

      <main className="trajectory-detail-layout">
        <section className="graph-stage trajectory-graph-stage">
          <div className="graph-toolbar">
            <div>
              <span className="graph-toolbar__eyebrow">Сохранённая траектория</span>
              <h2>{trajectory?.name ?? "Загрузка"}</h2>
            </div>
            <p className="graph-toolbar__hint">
              Зелёные стрелки показывают порядок прохождения, синие пунктирные связи показывают зависимости.
            </p>
          </div>

          <div className="graph-surface">
            {loading ? (
              <div className="status-view">
                <div className="status-view__pulse" />
                <h3>Загружаю траекторию</h3>
                <p>Собираю сохранённые темы, элементы и связи графа.</p>
              </div>
            ) : !scene || !scene.nodes.length ? (
              <div className="status-view">
                <h3>Нет данных для отображения</h3>
                <p>В этой траектории пока нет тем.</p>
              </div>
            ) : (
              <div className="graph-frame">
                <RelationGraph
                  ref={graphRef}
                  options={GRAPH_OPTIONS}
                  nodeSlot={GraphNode}
                  onNodeClick={handleNodeClick}
                />
              </div>
            )}
          </div>
        </section>

        {studentPreviewOpen && trajectory ? (
          <section className="card card--soft trajectory-student-preview">
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Предпросмотр глазами студента</p>
                <h2>{trajectory.name}</h2>
              </div>
              <span className="hero__chip">{statusLabel(trajectory.status)}</span>
            </div>
            <p className="card__text">
              Так студент увидит назначенную последовательность: темы идут по шагам, внутри каждой
              темы показаны выбранные формируемые элементы и их пороги.
            </p>

            {topicOrder.length ? (
              <div className="trajectory-preview-list">
                {topicOrder.map((topicId, index) => {
                  const topic = topicById.get(topicId);
                  const trajectoryTopic = trajectoryTopicByTopicId.get(topicId);

                  return (
                    <article className="trajectory-preview-topic" key={topicId}>
                      <span className="trajectory-preview-topic__step">{index + 1}</span>
                      <div>
                        <strong>{topic?.name ?? "Тема не найдена"}</strong>
                        <p>{topic?.description || "Описание темы пока не добавлено."}</p>
                      </div>
                      <div className="trajectory-preview-topic__meta">
                        <span>Порог темы {trajectoryTopic?.threshold ?? 100}</span>
                        <span>Статус: не начато</span>
                      </div>
                      <div className="trajectory-preview-elements">
                        {(trajectoryTopic?.elements ?? []).length ? (
                          trajectoryTopic!.elements.map((element) => (
                            <span key={element.id}>
                              {elementName(elementById, element.element_id)} · порог{" "}
                              {element.threshold}
                            </span>
                          ))
                        ) : (
                          <span>Элементы для студента не выбраны.</span>
                        )}
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="card__text">В траектории пока нет тем для предпросмотра.</p>
            )}
          </section>
        ) : null}

        <section className="card card--soft trajectory-selected-panel">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Мини-редактор</p>
              <h2>Порядок тем</h2>
            </div>
            <span className="hero__chip">
              {saving ? "Сохраняю..." : `${topicOrder.length} тем`}
            </span>
          </div>
          {trajectory ? (
            <div className="trajectory-status-row">
              <span>{statusLabel(trajectory.status)}</span>
              <span>
                Версия графа: {trajectory.graph_version}
                {graph ? ` / текущая ${graph.discipline.knowledge_graph_version}` : ""}
              </span>
              <span>{trajectory.is_actual ? "Актуальна" : "Устарела"}</span>
            </div>
          ) : null}

          {!canEditTrajectory && trajectory ? (
            <p className="card__text">
              Изменение порядка заблокировано: траектория должна быть черновиком и соответствовать
              текущей версии графа знаний.
            </p>
          ) : null}

          {topicOrder.length ? (
            <div className="trajectory-selected-list">
              {topicOrder.map((topicId, index) => {
                const trajectoryTopic = trajectoryTopicByTopicId.get(topicId);
                const selectedTopicClassName = [
                  "trajectory-selected-topic",
                  draggedTopicId === topicId ? "trajectory-selected-topic--dragging" : "",
                  dragOverTopicId === topicId ? "trajectory-selected-topic--drop-target" : "",
                ]
                  .filter(Boolean)
                  .join(" ");

                return (
                  <article
                    className={selectedTopicClassName}
                    key={topicId}
                    onDragOver={(event) => handleTopicDragOver(event, topicId)}
                    onDrop={(event) => handleTopicDrop(event, topicId)}
                  >
                    <div className="trajectory-selected-topic__head">
                      <div className="trajectory-selected-topic__title">
                        <strong>
                          {index + 1}. {topicName(topicById, topicId)}
                        </strong>
                        <span>{trajectoryTopic?.elements.length ?? 0} элементов</span>
                      </div>
                      <button
                        aria-label={`Перетащить тему ${topicName(topicById, topicId)}`}
                        className="trajectory-drag-handle"
                        disabled={saving || !canEditTrajectory || topicOrder.length < 2}
                        draggable={!saving && canEditTrajectory && topicOrder.length > 1}
                        onDragEnd={handleTopicDragEnd}
                        onDragStart={(event) => handleTopicDragStart(event, topicId)}
                        title="Перетащить тему"
                        type="button"
                      >
                        Перетащить
                      </button>
                    </div>

                    <div className="trajectory-topic-actions">
                      <button
                        className="secondary-button"
                        disabled={saving || !canEditTrajectory || index === 0}
                        onClick={() => moveTopic(topicId, -1)}
                        type="button"
                      >
                        Выше
                      </button>
                      <button
                        className="secondary-button"
                        disabled={saving || !canEditTrajectory || index === topicOrder.length - 1}
                        onClick={() => moveTopic(topicId, 1)}
                        type="button"
                      >
                        Ниже
                      </button>
                    </div>

                    <div className="trajectory-detail-elements">
                      <span>Порог темы: {trajectoryTopic?.threshold ?? 100}</span>
                      {(trajectoryTopic?.elements ?? []).map((element) => (
                        <span key={element.id}>
                          {elementName(elementById, element.element_id)} · порог {element.threshold}
                        </span>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="card__text">В траектории пока нет выбранных тем.</p>
          )}
        </section>
      </main>
    </div>
  );
}
