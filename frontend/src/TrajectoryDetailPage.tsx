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
  createLearningTrajectoryTask,
  deleteLearningTrajectoryTask,
  fetchDisciplineKnowledgeGraph,
  fetchLearningTrajectory,
  fetchLearningTrajectoryTasks,
  fetchStudentTasks,
  isAbortError,
  submitStudentTaskScore,
  updateLearningTrajectoryTask,
  updateLearningTrajectoryStatus,
  updateLearningTrajectoryTopicOrder,
} from "./api";
import { GraphNode } from "./components/GraphNode";
import type {
  DetailCard,
  DisciplineKnowledgeGraph,
  KnowledgeElement,
  LearningTrajectory,
  LearningTrajectoryTaskContent,
  LearningTrajectoryTaskMatchingPair,
  LearningTrajectoryTaskOption,
  LearningTrajectoryTaskType,
  LearningTrajectoryTask,
  LearningTrajectoryTopic,
  SceneNodeData,
  StudentAssignedTask,
  Topic,
  ViewMode,
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

const TASK_TYPE_LABELS: Record<LearningTrajectoryTaskType, string> = {
  single_choice: "Один выбор",
  multiple_choice: "Несколько выборов",
  matching: "Сопоставление",
  text: "Текстовый ответ",
};

function createLocalId() {
  return Math.random().toString(36).slice(2, 10);
}

function createEmptyOption(isCorrect = false): LearningTrajectoryTaskOption {
  return { id: createLocalId(), text: "", is_correct: isCorrect };
}

function createEmptyPair(): LearningTrajectoryTaskMatchingPair {
  return { id: createLocalId(), left: "", right: "" };
}

function buildStudentTaskAnswerDraft(task: StudentAssignedTask) {
  if (task.progress.last_answer_payload) {
    return task.progress.last_answer_payload;
  }

  if (task.task_type === "single_choice" || task.task_type === "multiple_choice") {
    return { selected_option_ids: [] as string[] };
  }
  if (task.task_type === "matching") {
    return { pairings: [] as Array<{ left_id: string; right_id: string }> };
  }
  return { text: "" };
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось выполнить действие с траекторией.";
}

function estimateTrajectoryNodeHeight(topic: Topic) {
  const text = topic.description?.trim() || "Описание темы пока не добавлено.";
  return Math.min(360, 196 + Math.ceil(text.length / 30) * 16);
}

function estimateTrajectoryElementNodeHeight(element: KnowledgeElement) {
  const text = element.description?.trim() || "Описание элемента пока не добавлено.";
  return Math.min(260, 176 + Math.ceil(text.length / 28) * 14);
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

function buildStudentTrajectoryTopicsScene(
  graph: DisciplineKnowledgeGraph,
  trajectory: LearningTrajectory,
  topicOrder: string[],
) {
  const topicById = new Map(graph.topics.map((topic) => [topic.id, topic]));
  const trajectoryTopicByTopicId = new Map(
    trajectory.topics.map((trajectoryTopic) => [trajectoryTopic.topic_id, trajectoryTopic]),
  );
  const nodes: JsonNode[] = [];
  const lines: JsonLine[] = [];
  const detailsByNodeId: Record<string, DetailCard> = {};

  topicOrder.forEach((topicId, index) => {
    const topic = topicById.get(topicId);
    const trajectoryTopic = trajectoryTopicByTopicId.get(topicId);
    if (!topic || !trajectoryTopic) return;

    const nodeId = `topic:${topic.id}`;
    const row = Math.floor(index / 3);
    const col = index % 3;

    const data: SceneNodeData = {
      entity: "topic",
      tone: "topic",
      badge: "Тема",
      title: topic.name,
      subtitle: `Шаг ${index + 1}`,
      description: topic.description ?? "Описание темы пока не добавлено.",
      metrics: [
        `${trajectoryTopic.elements.length} элементов`,
        `Порог ${trajectoryTopic.threshold}`,
      ],
      hint: "Открыть тему",
      isSelected: true,
      lockState: "open",
      sequenceNumber: index + 1,
      topicId: topic.id,
    };

    nodes.push({
      id: nodeId,
      text: topic.name,
      x: 180 + col * 330,
      y: 170 + row * 340,
      width: 270,
      height: estimateTrajectoryNodeHeight(topic),
      nodeShape: 1,
      data,
    });

    detailsByNodeId[nodeId] = {
      title: topic.name,
      subtitle: `Шаг ${index + 1} траектории`,
      description: topic.description ?? "Описание темы пока не добавлено.",
      chips: [{ label: `Порог темы: ${trajectoryTopic.threshold}`, tone: "topic" }],
      stats: [
        { label: "Элементов для изучения", value: String(trajectoryTopic.elements.length) },
      ],
      footnote: "Открой тему, чтобы увидеть формируемые элементы.",
    };
  });

  for (let index = 0; index < topicOrder.length - 1; index += 1) {
    lines.push({
      from: `topic:${topicOrder[index]}`,
      to: `topic:${topicOrder[index + 1]}`,
      text: "дальше",
      color: "#178364",
      fontColor: "#146c53",
      lineWidth: 2.8,
      animation: 1,
      showEndArrow: true,
      textOffset_y: -14,
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

function buildStudentTrajectoryElementsScene(
  graph: DisciplineKnowledgeGraph,
  trajectory: LearningTrajectory,
  topicId: string,
  elementById: Map<string, KnowledgeElement>,
) {
  const topicById = new Map(graph.topics.map((topic) => [topic.id, topic]));
  const trajectoryTopic = trajectory.topics.find((item) => item.topic_id === topicId);
  const topic = topicById.get(topicId);
  const detailsByNodeId: Record<string, DetailCard> = {};

  if (!trajectoryTopic || !topic) {
    return {
      rootId: "",
      nodes: [] as JsonNode[],
      lines: [] as JsonLine[],
      detailsByNodeId,
      defaultSelectedNodeId: "",
    };
  }

  const focusNodeId = `topic-focus:${topic.id}`;
  const selectedElements = trajectoryTopic.elements
    .map((item) => ({
      trajectoryElement: item,
      element: elementById.get(item.element_id),
    }))
    .filter(
      (item): item is { trajectoryElement: typeof trajectoryTopic.elements[number]; element: KnowledgeElement } =>
        Boolean(item.element),
    );

  const nodes: JsonNode[] = [
    {
      id: focusNodeId,
      text: topic.name,
      x: 420,
      y: 180,
      width: 280,
      height: estimateTrajectoryNodeHeight(topic),
      nodeShape: 1,
      data: {
        entity: "topic-focus",
        tone: "topic",
        badge: "Тема",
        title: topic.name,
        subtitle: "Формируемые элементы",
        description: topic.description ?? "Описание темы пока не добавлено.",
        metrics: [
          `${selectedElements.length} элементов`,
          `Порог ${trajectoryTopic.threshold}`,
        ],
        hint: "К темам",
        isSelected: true,
        lockState: "open",
        topicId: topic.id,
      } satisfies SceneNodeData,
    },
  ];
  const lines: JsonLine[] = [];

  detailsByNodeId[focusNodeId] = {
    title: topic.name,
    subtitle: "Формируемые элементы",
    description: topic.description ?? "Описание темы пока не добавлено.",
    chips: [{ label: `Порог темы: ${trajectoryTopic.threshold}`, tone: "topic" }],
    stats: [{ label: "Элементов для изучения", value: String(selectedElements.length) }],
    footnote: "Нажми на центральную карточку, чтобы вернуться к списку тем.",
  };

  selectedElements.forEach(({ trajectoryElement, element }, index) => {
    const nodeId = `element:${topic.id}:${element.id}`;
    const col = index % 3;
    const row = Math.floor(index / 3);

    nodes.push({
      id: nodeId,
      text: element.name,
      x: 140 + col * 280,
      y: 500 + row * 260,
      width: 230,
      height: estimateTrajectoryElementNodeHeight(element),
      nodeShape: 1,
      data: {
        entity: "element",
        tone: "formed",
        badge:
          element.competence_type === "know"
            ? "Знать"
            : element.competence_type === "can"
              ? "Уметь"
              : "Владеть",
        badgeTone: element.competence_type,
        accentTone: element.competence_type,
        title: element.name,
        subtitle: "Формируемый элемент",
        description: element.description ?? "Описание элемента пока не добавлено.",
        metrics: [`Порог ${trajectoryElement.threshold}`],
        isSelected: false,
        lockState: "open",
        topicId: topic.id,
      } satisfies SceneNodeData,
    });

    lines.push({
      from: focusNodeId,
      to: nodeId,
      text: "изучим",
      color: "#178364",
      fontColor: "#146c53",
      lineWidth: 2.2,
      animation: 1,
      showEndArrow: true,
      textOffset_y: -12,
    });

    detailsByNodeId[nodeId] = {
      title: element.name,
      subtitle: "Формируемый элемент",
      description: element.description ?? "Описание элемента пока не добавлено.",
      chips: [{ label: `Порог элемента: ${trajectoryElement.threshold}`, tone: "formed" }],
      stats: [{ label: "Компетенция", value: element.competence_type }],
      footnote: "Студент изучает этот элемент в рамках выбранной темы.",
    };
  });

  return {
    rootId: focusNodeId,
    nodes,
    lines,
    detailsByNodeId,
    defaultSelectedNodeId: focusNodeId,
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
  const [tasks, setTasks] = useState<LearningTrajectoryTask[]>([]);
  const [taskTopicId, setTaskTopicId] = useState("");
  const [taskPrimaryElementId, setTaskPrimaryElementId] = useState("");
  const [taskRelatedElementIds, setTaskRelatedElementIds] = useState<string[]>([]);
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskDifficulty, setTaskDifficulty] = useState(30);
  const [taskType, setTaskType] = useState<LearningTrajectoryTaskType>("single_choice");
  const [taskOptions, setTaskOptions] = useState<LearningTrajectoryTaskOption[]>([
    createEmptyOption(true),
    createEmptyOption(false),
  ]);
  const [taskMatchingPairs, setTaskMatchingPairs] = useState<LearningTrajectoryTaskMatchingPair[]>([
    createEmptyPair(),
    createEmptyPair(),
  ]);
  const [taskAcceptedAnswers, setTaskAcceptedAnswers] = useState<string[]>([""]);
  const [taskTextPlaceholder, setTaskTextPlaceholder] = useState("");
  const [editingTaskId, setEditingTaskId] = useState("");
  const [topicOrderModalOpen, setTopicOrderModalOpen] = useState(false);
  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [tasksModalSection, setTasksModalSection] = useState<"list" | "create">("list");
  const [studentTasks, setStudentTasks] = useState<StudentAssignedTask[]>([]);
  const [studentTaskAnswers, setStudentTaskAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [savingStudentTaskId, setSavingStudentTaskId] = useState("");
  const [studentTaskModalOpen, setStudentTaskModalOpen] = useState(false);
  const [studentView, setStudentView] = useState<ViewMode>({ level: "topics" });
  const studentIdFromQuery = searchParams.get("student") ?? "";
  const isStudentMode = Boolean(studentIdFromQuery);
  const showStudentView = isStudentMode || studentPreviewOpen;

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
    if (!showStudentView) {
      setStudentTaskModalOpen(false);
      return;
    }
    setStudentView({ level: "topics" });
  }, [showStudentView]);

  useEffect(() => {
    if (!isStudentMode) return;
    setStudentPreviewOpen(true);
    setStudentView({ level: "topics" });
    setTopicOrderModalOpen(false);
    setTasksModalOpen(false);
  }, [isStudentMode, trajectoryId]);

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

        try {
          const nextTasks = await fetchLearningTrajectoryTasks(trajectoryId!, controller.signal);
          setTasks(nextTasks);
        } catch (error) {
          if (!isAbortError(error)) {
            setTasks([]);
            pushNotification(
              "error",
              "Не удалось загрузить задания траектории. Сам граф открыт, но блок заданий временно недоступен.",
            );
          }
        }
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

  useEffect(() => {
    if (!showStudentView || !studentIdFromQuery || !disciplineId || !trajectoryId) return;
    const controller = new AbortController();

    async function loadStudentTasks() {
      try {
        const nextTasks = await fetchStudentTasks(studentIdFromQuery, controller.signal, disciplineId);
        const filteredTasks = nextTasks.filter((task) => task.trajectory_id === trajectoryId);
        setStudentTasks(filteredTasks);
        setStudentTaskAnswers(
          Object.fromEntries(filteredTasks.map((task) => [task.id, buildStudentTaskAnswerDraft(task)])),
        );
      } catch (error) {
        if (!isAbortError(error)) {
          pushNotification("error", extractErrorMessage(error));
        }
      }
    }

    void loadStudentTasks();
    return () => controller.abort();
  }, [disciplineId, showStudentView, studentIdFromQuery, trajectoryId]);

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
  const knowElementsByTrajectoryTopicId = useMemo(() => {
    const result = new Map<string, KnowledgeElement[]>();
    if (!trajectory) return result;

    for (const trajectoryTopic of trajectory.topics) {
      const items = trajectoryTopic.elements
        .map((element) => elementById.get(element.element_id))
        .filter((element): element is KnowledgeElement => Boolean(element))
        .filter((element) => element.competence_type === "know");
      result.set(trajectoryTopic.topic_id, items);
    }

    return result;
  }, [elementById, trajectory]);
  const allKnownTrajectoryElements = useMemo(() => {
    const byId = new Map<string, KnowledgeElement>();
    for (const elements of knowElementsByTrajectoryTopicId.values()) {
      for (const element of elements) {
        byId.set(element.id, element);
      }
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [knowElementsByTrajectoryTopicId]);
  const scene = useMemo(() => {
    if (!graph || !trajectory) return null;
    if (showStudentView) {
      if (studentView.level === "elements") {
        return buildStudentTrajectoryElementsScene(
          graph,
          trajectory,
          studentView.topicId,
          elementById,
        );
      }
      return buildStudentTrajectoryTopicsScene(graph, trajectory, topicOrder);
    }
    return buildTrajectoryScene(graph, trajectory, topicOrder);
  }, [elementById, graph, showStudentView, studentView, topicOrder, trajectory]);
  const canEditTrajectory = trajectory?.status === "draft" && trajectory.is_actual;

  const availablePrimaryElements = useMemo(
    () => knowElementsByTrajectoryTopicId.get(taskTopicId) ?? [],
    [knowElementsByTrajectoryTopicId, taskTopicId],
  );
  const selectedTopicId =
    showStudentView && studentView.level === "elements"
      ? studentView.topicId
      : selectedNodeId.startsWith("topic:")
        ? selectedNodeId.slice("topic:".length)
        : selectedNodeId.startsWith("topic-focus:")
          ? selectedNodeId.slice("topic-focus:".length)
          : topicOrder[0] ?? "";
  const selectedTopicStudentTasks = useMemo(
    () => studentTasks.filter((task) => task.topic_id === selectedTopicId),
    [selectedTopicId, studentTasks],
  );

  function resetTaskTemplate(nextType: LearningTrajectoryTaskType = "single_choice") {
    setTaskType(nextType);

    if (nextType === "single_choice") {
      setTaskOptions([createEmptyOption(true), createEmptyOption(false)]);
      setTaskMatchingPairs([createEmptyPair(), createEmptyPair()]);
      setTaskAcceptedAnswers([""]);
      setTaskTextPlaceholder("");
      return;
    }

    if (nextType === "multiple_choice") {
      setTaskOptions([createEmptyOption(true), createEmptyOption(true), createEmptyOption(false)]);
      setTaskMatchingPairs([createEmptyPair(), createEmptyPair()]);
      setTaskAcceptedAnswers([""]);
      setTaskTextPlaceholder("");
      return;
    }

    if (nextType === "matching") {
      setTaskOptions([createEmptyOption(true), createEmptyOption(false)]);
      setTaskMatchingPairs([createEmptyPair(), createEmptyPair()]);
      setTaskAcceptedAnswers([""]);
      setTaskTextPlaceholder("");
      return;
    }

    setTaskOptions([createEmptyOption(true), createEmptyOption(false)]);
    setTaskMatchingPairs([createEmptyPair(), createEmptyPair()]);
    setTaskAcceptedAnswers([""]);
    setTaskTextPlaceholder("Напиши краткий ответ");
  }

  function resetTaskForm() {
    setEditingTaskId("");
    setTaskPrompt("");
    setTaskDifficulty(30);
    setTaskRelatedElementIds([]);
    resetTaskTemplate("single_choice");

    const firstTopicId = trajectory?.topics.find(
      (topic) => (knowElementsByTrajectoryTopicId.get(topic.topic_id) ?? []).length > 0,
    )?.topic_id ?? "";
    setTaskTopicId(firstTopicId);

    const firstPrimaryElementId =
      (knowElementsByTrajectoryTopicId.get(firstTopicId) ?? [])[0]?.id ?? "";
    setTaskPrimaryElementId(firstPrimaryElementId);
  }

  function buildTaskContentPayload(): LearningTrajectoryTaskContent {
    if (taskType === "single_choice" || taskType === "multiple_choice") {
      return {
        options: taskOptions.map((option) => ({
          id: option.id,
          text: option.text.trim(),
          is_correct: option.is_correct,
        })),
      };
    }

    if (taskType === "matching") {
      return {
        pairs: taskMatchingPairs.map((pair) => ({
          id: pair.id,
          left: pair.left.trim(),
          right: pair.right.trim(),
        })),
      };
    }

    return {
      accepted_answers: taskAcceptedAnswers.map((answer) => answer.trim()).filter(Boolean),
      placeholder: taskTextPlaceholder.trim(),
    };
  }

  function validateTaskTemplate() {
    if (taskType === "single_choice" || taskType === "multiple_choice") {
      const filledOptions = taskOptions.filter((option) => option.text.trim());
      const correctCount = filledOptions.filter((option) => option.is_correct).length;
      if (filledOptions.length < 2) {
        return "Нужно минимум два заполненных варианта ответа.";
      }
      if (taskType === "single_choice" && correctCount !== 1) {
        return "Для задания с одним выбором нужен ровно один правильный вариант.";
      }
      if (taskType === "multiple_choice" && correctCount < 1) {
        return "Для задания с несколькими вариантами нужен хотя бы один правильный ответ.";
      }
      return "";
    }

    if (taskType === "matching") {
      const filledPairs = taskMatchingPairs.filter((pair) => pair.left.trim() && pair.right.trim());
      if (filledPairs.length < 2) {
        return "Для сопоставления нужны минимум две заполненные пары.";
      }
      return "";
    }

    const filledAnswers = taskAcceptedAnswers.map((answer) => answer.trim()).filter(Boolean);
    if (!filledAnswers.length) {
      return "Для текстового ответа нужен хотя бы один эталонный ответ.";
    }
    return "";
  }

  useEffect(() => {
    if (!trajectory) return;
    if (editingTaskId) return;
    if (!taskTopicId) {
      resetTaskForm();
    }
  }, [editingTaskId, taskTopicId, trajectory, knowElementsByTrajectoryTopicId]);

  useEffect(() => {
    const nextPrimaryElements = knowElementsByTrajectoryTopicId.get(taskTopicId) ?? [];
    if (!nextPrimaryElements.length) {
      setTaskPrimaryElementId("");
      return;
    }
    if (!nextPrimaryElements.some((element) => element.id === taskPrimaryElementId)) {
      setTaskPrimaryElementId(nextPrimaryElements[0].id);
    }
  }, [knowElementsByTrajectoryTopicId, taskPrimaryElementId, taskTopicId]);

  useEffect(() => {
    const allowedIds = new Set(
      allKnownTrajectoryElements
        .map((element) => element.id)
        .filter((elementId) => elementId !== taskPrimaryElementId),
    );
    setTaskRelatedElementIds((current) => current.filter((elementId) => allowedIds.has(elementId)));
  }, [allKnownTrajectoryElements, taskPrimaryElementId]);

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

  function returnStudentToTopics(topicId?: string) {
    setStudentView({ level: "topics" });
    if (topicId) {
      setSelectedNodeId(`topic:${topicId}`);
      return;
    }
    setSelectedNodeId(topicOrder[0] ? `topic:${topicOrder[0]}` : "");
  }

  function handleNodeClick(node: RGNode) {
    if (showStudentView) {
      if (node.id.startsWith("topic-focus:")) {
        const topicId = node.id.slice("topic-focus:".length);
        returnStudentToTopics(topicId);
        return false;
      }

      if (node.id.startsWith("topic:")) {
        const topicId = node.id.slice("topic:".length);
        setStudentView({ level: "elements", topicId });
        setSelectedNodeId(`topic-focus:${topicId}`);
        if (isStudentMode) {
          setStudentTaskModalOpen(true);
        }
        return false;
      }

      setSelectedNodeId(node.id);
      return false;
    }

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

  function startTaskEditing(task: LearningTrajectoryTask) {
    setEditingTaskId(task.id);
    setTasksModalSection("create");
    setTaskTopicId(task.topic_id);
    setTaskPrimaryElementId(task.primary_element.element_id);
    setTaskRelatedElementIds(task.related_elements.map((element) => element.element_id));
    setTaskPrompt(task.prompt);
    setTaskDifficulty(task.difficulty);
    setTaskType(task.task_type);
    setTaskOptions(
      task.content.options?.length
        ? task.content.options
        : [createEmptyOption(true), createEmptyOption(false)],
    );
    setTaskMatchingPairs(
      task.content.pairs?.length ? task.content.pairs : [createEmptyPair(), createEmptyPair()],
    );
    setTaskAcceptedAnswers(
      task.content.accepted_answers?.length ? task.content.accepted_answers : [""],
    );
    setTaskTextPlaceholder(task.content.placeholder ?? "");
  }

  function toggleTaskRelatedElement(elementId: string) {
    setTaskRelatedElementIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
  }

  function updateTaskOption(optionId: string, patch: Partial<LearningTrajectoryTaskOption>) {
    setTaskOptions((current) =>
      current.map((option) => (option.id === optionId ? { ...option, ...patch } : option)),
    );
  }

  function addTaskOption() {
    setTaskOptions((current) => [...current, createEmptyOption(false)]);
  }

  function removeTaskOption(optionId: string) {
    setTaskOptions((current) => current.filter((option) => option.id !== optionId));
  }

  function updateTaskPair(pairId: string, patch: Partial<LearningTrajectoryTaskMatchingPair>) {
    setTaskMatchingPairs((current) =>
      current.map((pair) => (pair.id === pairId ? { ...pair, ...patch } : pair)),
    );
  }

  function addTaskPair() {
    setTaskMatchingPairs((current) => [...current, createEmptyPair()]);
  }

  function removeTaskPair(pairId: string) {
    setTaskMatchingPairs((current) => current.filter((pair) => pair.id !== pairId));
  }

  function updateAcceptedAnswer(index: number, value: string) {
    setTaskAcceptedAnswers((current) =>
      current.map((answer, answerIndex) => (answerIndex === index ? value : answer)),
    );
  }

  function addAcceptedAnswer() {
    setTaskAcceptedAnswers((current) => [...current, ""]);
  }

  function removeAcceptedAnswer(index: number) {
    setTaskAcceptedAnswers((current) => current.filter((_, answerIndex) => answerIndex !== index));
  }

  async function handleSaveTask() {
    if (!trajectoryId) return;
    if (!taskTopicId || !taskPrimaryElementId || !taskPrompt.trim()) {
      pushNotification("error", "Для задания нужны тема, ключевой элемент и текст задания.");
      return;
    }

    const templateError = validateTaskTemplate();
    if (templateError) {
      pushNotification("error", templateError);
      return;
    }

    try {
      setSaving(true);
      const payload = {
        topic_id: taskTopicId,
        primary_element_id: taskPrimaryElementId,
        related_element_ids: taskRelatedElementIds,
        prompt: taskPrompt.trim(),
        difficulty: Math.max(0, Math.min(100, Number(taskDifficulty) || 0)),
        task_type: taskType,
        content: buildTaskContentPayload(),
      };
      const savedTask = editingTaskId
        ? await updateLearningTrajectoryTask(editingTaskId, payload)
        : await createLearningTrajectoryTask(trajectoryId, payload);

      setTasks((current) => {
        const next = editingTaskId
          ? current.map((item) => (item.id === savedTask.id ? savedTask : item))
          : [savedTask, ...current];
        return next;
      });
      resetTaskForm();
      pushNotification(
        "success",
        editingTaskId ? "Задание обновлено." : "Задание добавлено в траекторию.",
      );
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  async function handleDeleteTask(taskId: string) {
    try {
      setSaving(true);
      await deleteLearningTrajectoryTask(taskId);
      setTasks((current) => current.filter((task) => task.id !== taskId));
      if (editingTaskId === taskId) {
        resetTaskForm();
      }
      pushNotification("success", "Задание удалено.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setSaving(false);
    }
  }

  function updateStudentTaskAnswer(taskId: string, nextValue: Record<string, unknown>) {
    setStudentTaskAnswers((current) => ({ ...current, [taskId]: nextValue }));
  }

  function toggleStudentChoiceOption(task: StudentAssignedTask, optionId: string, checked: boolean) {
    const currentAnswer = studentTaskAnswers[task.id] ?? buildStudentTaskAnswerDraft(task);
    const currentIds = Array.isArray(currentAnswer.selected_option_ids)
      ? (currentAnswer.selected_option_ids as string[])
      : [];

    if (task.task_type === "single_choice") {
      updateStudentTaskAnswer(task.id, { selected_option_ids: checked ? [optionId] : [] });
      return;
    }

    const nextIds = checked
      ? [...new Set([...currentIds, optionId])]
      : currentIds.filter((item) => item !== optionId);
    updateStudentTaskAnswer(task.id, { selected_option_ids: nextIds });
  }

  function updateStudentMatchingAnswer(taskId: string, leftId: string, rightId: string) {
    const currentAnswer = studentTaskAnswers[taskId] ?? { pairings: [] };
    const currentPairings = Array.isArray(currentAnswer.pairings)
      ? (currentAnswer.pairings as Array<{ left_id: string; right_id: string }>)
      : [];
    const nextPairings = [
      ...currentPairings.filter((pairing) => pairing.left_id !== leftId),
      { left_id: leftId, right_id: rightId },
    ];
    updateStudentTaskAnswer(taskId, { pairings: nextPairings });
  }

  async function handleSubmitStudentTask(task: StudentAssignedTask) {
    if (!studentIdFromQuery) return;

    try {
      setSavingStudentTaskId(task.id);
      const updatedTask = await submitStudentTaskScore(
        task.id,
        studentIdFromQuery,
        studentTaskAnswers[task.id] ?? buildStudentTaskAnswerDraft(task),
      );
      setStudentTasks((current) =>
        current.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
      );
      setStudentTaskAnswers((current) => ({
        ...current,
        [task.id]: buildStudentTaskAnswerDraft(updatedTask),
      }));
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setSavingStudentTaskId("");
    }
  }

  function renderStudentTaskAnswerEditor(task: StudentAssignedTask) {
    const answer = studentTaskAnswers[task.id] ?? buildStudentTaskAnswerDraft(task);

    if (task.task_type === "single_choice" || task.task_type === "multiple_choice") {
      const selectedIds = Array.isArray(answer.selected_option_ids)
        ? (answer.selected_option_ids as string[])
        : [];
      return (
        <div className="student-task-answer">
          {(task.content.options ?? []).map((option) => (
            <label className="student-task-answer__option" key={option.id}>
              <input
                type={task.task_type === "single_choice" ? "radio" : "checkbox"}
                checked={selectedIds.includes(option.id)}
                onChange={(event) => toggleStudentChoiceOption(task, option.id, event.target.checked)}
              />
              <span>{option.text}</span>
            </label>
          ))}
        </div>
      );
    }

    if (task.task_type === "matching") {
      const pairings = Array.isArray(answer.pairings)
        ? (answer.pairings as Array<{ left_id: string; right_id: string }>)
        : [];
      return (
        <div className="student-task-answer">
          {(task.content.left_items ?? []).map((item) => (
            <label className="field" key={item.id}>
              <span>{item.text}</span>
              <select
                value={pairings.find((pairing) => pairing.left_id === item.id)?.right_id ?? ""}
                onChange={(event) => updateStudentMatchingAnswer(task.id, item.id, event.target.value)}
              >
                <option value="">Выбери соответствие</option>
                {(task.content.right_items ?? []).map((rightItem) => (
                  <option key={rightItem.id} value={rightItem.id}>
                    {rightItem.text}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      );
    }

    return (
      <div className="student-task-answer">
        <label className="field">
          <span>Ответ</span>
          <textarea
            rows={4}
            value={String(answer.text ?? "")}
            onChange={(event) => updateStudentTaskAnswer(task.id, { text: event.target.value })}
            placeholder={task.content.placeholder || "Напиши ответ"}
          />
        </label>
      </div>
    );
  }

  function renderTopicOrderModalBody() {
    return (
      <section className="card card--soft trajectory-selected-panel">
        <div className="card__header">
          <div>
            <p className="card__eyebrow">Мини-редактор</p>
            <h2>Порядок тем</h2>
          </div>
          <span className="hero__chip">{saving ? "Сохраняю..." : `${topicOrder.length} тем`}</span>
        </div>

        {trajectory ? (
          <div className="trajectory-status-row">
            <span>{statusLabel(trajectory.status)}</span>
            <span>
              Р’РµСЂСЃРёСЏ РіСЂР°С„Р°: {trajectory.graph_version}
              {graph ? ` / текущая ${graph.discipline.knowledge_graph_version}` : ""}
            </span>
            <span>{trajectory.is_actual ? "Актуальна" : "Устарела"}</span>
          </div>
        ) : null}

        {!canEditTrajectory && trajectory ? (
          <p className="card__text">
            РР·РјРµРЅРµРЅРёРµ РїРѕСЂСЏРґРєР° Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅРѕ: С‚СЂР°РµРєС‚РѕСЂРёСЏ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ С‡РµСЂРЅРѕРІРёРєРѕРј Рё СЃРѕРѕС‚РІРµС‚СЃС‚РІРѕРІР°С‚СЊ
            С‚РµРєСѓС‰РµР№ РІРµСЂСЃРёРё РіСЂР°С„Р° Р·РЅР°РЅРёР№.
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
                      <span>{trajectoryTopic?.elements.length ?? 0} СЌР»РµРјРµРЅС‚РѕРІ</span>
                    </div>
                    <button
                      aria-label={`Перетащить тему ${topicName(topicById, topicId)}`}
                      className="trajectory-drag-handle"
                      disabled={saving || !canEditTrajectory || topicOrder.length < 2}
                      draggable={!saving && canEditTrajectory && topicOrder.length > 1}
                      onDragEnd={handleTopicDragEnd}
                      onDragStart={(event) => handleTopicDragStart(event, topicId)}
                      type="button"
                    >
                      Перетащить
                    </button>
                  </div>

                  <div className="trajectory-detail-elements">
                    <span>РџРѕСЂРѕРі С‚РµРјС‹: {trajectoryTopic?.threshold ?? 100}</span>
                    {(trajectoryTopic?.elements ?? []).map((element) => (
                      <span key={element.id}>
                        {elementName(elementById, element.element_id)} В· РїРѕСЂРѕРі {element.threshold}
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
    );
  }

  function renderTasksModalBody() {
    return (
      <section className="card card--soft trajectory-task-panel">
        <div className="card__header">
          <div>
            <p className="card__eyebrow">Задания</p>
            <h2>{tasksModalSection === "create" ? "Создание задания" : "Список заданий"}</h2>
          </div>
          <span className="hero__chip">{tasks.length} заданий</span>
        </div>

        <div className="editor-tabs">
          <button
            className={`editor-tab ${tasksModalSection === "list" ? "editor-tab--active" : ""}`}
            onClick={() => setTasksModalSection("list")}
            type="button"
          >
            Список
          </button>
          <button
            className={`editor-tab ${tasksModalSection === "create" ? "editor-tab--active" : ""}`}
            onClick={() => setTasksModalSection("create")}
            type="button"
          >
            Создание
          </button>
        </div>

        {tasksModalSection === "create" ? (
          <>
            <p className="card__text">Задания создаются вручную для элементов компетенции «Знать».</p>

            {allKnownTrajectoryElements.length ? (
              <div className="trajectory-task-editor">
                <div className="trajectory-task-editor__grid">
                  <label className="field">
                    <span>Тема траектории</span>
                    <select value={taskTopicId} onChange={(event) => setTaskTopicId(event.target.value)} disabled={saving}>
                      {trajectory?.topics
                        .filter((topic) => (knowElementsByTrajectoryTopicId.get(topic.topic_id) ?? []).length > 0)
                        .map((topic) => (
                          <option key={topic.topic_id} value={topic.topic_id}>
                            {topicName(topicById, topic.topic_id)}
                          </option>
                        ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Ключевой элемент</span>
                    <select
                      value={taskPrimaryElementId}
                      onChange={(event) => setTaskPrimaryElementId(event.target.value)}
                      disabled={saving || !availablePrimaryElements.length}
                    >
                      {availablePrimaryElements.map((element) => (
                        <option key={element.id} value={element.id}>
                          {element.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="field">
                    <span>Сложность</span>
                    <input min={0} max={100} type="number" value={taskDifficulty} onChange={(event) => setTaskDifficulty(Number(event.target.value))} disabled={saving} />
                  </label>
                </div>
                <label className="field">
                  <span>Текст задания</span>
                  <textarea rows={4} value={taskPrompt} onChange={(event) => setTaskPrompt(event.target.value)} placeholder="Опиши задание для студента" disabled={saving} />
                </label>
                <div className="trajectory-task-template">
                  <label className="field">
                    <span>Тип задания</span>
                    <select value={taskType} onChange={(event) => resetTaskTemplate(event.target.value as LearningTrajectoryTaskType)} disabled={saving}>
                      {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                  </label>

                  {taskType === "single_choice" || taskType === "multiple_choice" ? (
                    <div className="trajectory-task-template__list">
                      <div className="trajectory-task-template__head">
                        <strong>Варианты ответа</strong>
                        <button className="ghost-button" type="button" onClick={addTaskOption} disabled={saving}>
                          Добавить вариант
                        </button>
                      </div>
                      {taskOptions.map((option, index) => (
                        <div className="trajectory-task-template__row" key={option.id}>
                          <span>{index + 1}</span>
                          <input
                            value={option.text}
                            onChange={(event) => updateTaskOption(option.id, { text: event.target.value })}
                            placeholder="Текст варианта"
                            disabled={saving}
                          />
                          <label className="trajectory-task-template__check">
                            <input
                              type={taskType === "single_choice" ? "radio" : "checkbox"}
                              checked={option.is_correct}
                              onChange={(event) => {
                                if (taskType === "single_choice" && event.target.checked) {
                                  setTaskOptions((current) =>
                                    current.map((item) => ({
                                      ...item,
                                      is_correct: item.id === option.id,
                                    })),
                                  );
                                  return;
                                }
                                updateTaskOption(option.id, { is_correct: event.target.checked });
                              }}
                              disabled={saving}
                            />
                            <span>Правильный</span>
                          </label>
                          <button
                            className="secondary-button secondary-button--danger"
                            type="button"
                            onClick={() => removeTaskOption(option.id)}
                            disabled={saving || taskOptions.length <= 2}
                          >
                            Удалить
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {taskType === "matching" ? (
                    <div className="trajectory-task-template__list">
                      <div className="trajectory-task-template__head">
                        <strong>Пары для сопоставления</strong>
                        <button className="ghost-button" type="button" onClick={addTaskPair} disabled={saving}>
                          Добавить пару
                        </button>
                      </div>
                      {taskMatchingPairs.map((pair, index) => (
                        <div className="trajectory-task-template__row trajectory-task-template__row--matching" key={pair.id}>
                          <span>{index + 1}</span>
                          <input
                            value={pair.left}
                            onChange={(event) => updateTaskPair(pair.id, { left: event.target.value })}
                            placeholder="Левый столбец"
                            disabled={saving}
                          />
                          <input
                            value={pair.right}
                            onChange={(event) => updateTaskPair(pair.id, { right: event.target.value })}
                            placeholder="Правый столбец"
                            disabled={saving}
                          />
                          <button
                            className="secondary-button secondary-button--danger"
                            type="button"
                            onClick={() => removeTaskPair(pair.id)}
                            disabled={saving || taskMatchingPairs.length <= 2}
                          >
                            Удалить
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {taskType === "text" ? (
                    <div className="trajectory-task-template__list">
                      <div className="trajectory-task-template__head">
                        <strong>Эталонные ответы</strong>
                        <button className="ghost-button" type="button" onClick={addAcceptedAnswer} disabled={saving}>
                          Добавить ответ
                        </button>
                      </div>
                      <label className="field">
                        <span>Подсказка в поле ответа</span>
                        <input
                          value={taskTextPlaceholder}
                          onChange={(event) => setTaskTextPlaceholder(event.target.value)}
                          placeholder="Напиши краткий ответ"
                          disabled={saving}
                        />
                      </label>
                      {taskAcceptedAnswers.map((answer, index) => (
                        <div className="trajectory-task-template__row" key={`${index}-${answer}`}>
                          <span>{index + 1}</span>
                          <input
                            value={answer}
                            onChange={(event) => updateAcceptedAnswer(index, event.target.value)}
                            placeholder="Правильный ответ"
                            disabled={saving}
                          />
                          <button
                            className="secondary-button secondary-button--danger"
                            type="button"
                            onClick={() => removeAcceptedAnswer(index)}
                            disabled={saving || taskAcceptedAnswers.length <= 1}
                          >
                            Удалить
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="trajectory-task-related">
                  <strong>Связанные элементы</strong>
                  <div className="trajectory-task-related__list">
                    {allKnownTrajectoryElements
                      .filter((element) => element.id !== taskPrimaryElementId)
                      .map((element) => (
                        <label className="trajectory-task-related__item" key={element.id}>
                          <input type="checkbox" checked={taskRelatedElementIds.includes(element.id)} onChange={() => toggleTaskRelatedElement(element.id)} disabled={saving} />
                          <span>{element.name}</span>
                        </label>
                      ))}
                  </div>
                </div>
                <div className="trajectory-task-editor__actions">
                  <button className="primary-button" type="button" disabled={saving || !taskTopicId || !taskPrimaryElementId || !taskPrompt.trim()} onClick={() => void handleSaveTask()}>
                    {editingTaskId ? "Сохранить задание" : "Добавить задание"}
                  </button>
                  {editingTaskId ? (
                    <button className="ghost-button" type="button" disabled={saving} onClick={resetTaskForm}>
                      Сбросить редактирование
                    </button>
                  ) : null}
                </div>
              </div>
            ) : (
              <p className="card__text">В этой траектории пока нет выбранных элементов «Знать».</p>
            )}
          </>
        ) : (
          <div className="trajectory-task-list">
            {tasks.length ? (
              tasks.map((task) => (
                <article className="trajectory-task-card" key={task.id}>
                  <div className="trajectory-task-card__header">
                    <div>
                      <strong>{task.topic_name}</strong>
                      <span>Ключевой элемент: {task.primary_element.name} · {TASK_TYPE_LABELS[task.task_type]} · Сложность {task.difficulty}</span>
                    </div>
                    <div className="trajectory-task-card__actions">
                      <button className="ghost-button" type="button" disabled={saving} onClick={() => startTaskEditing(task)}>Изменить</button>
                      <button className="secondary-button secondary-button--danger" type="button" disabled={saving} onClick={() => void handleDeleteTask(task.id)}>Удалить</button>
                    </div>
                  </div>
                  <p>{task.prompt}</p>
                  <div className="trajectory-task-card__chips">
                    <span>{task.primary_element.name}</span>
                    {task.related_elements.map((element) => (
                      <span key={element.element_id}>{element.name}</span>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="card__text">Для этой траектории задания пока не созданы.</p>
            )}
          </div>
        )}
      </section>
    );
  }
  if (!disciplineId || !trajectoryId) return null;

  return (
    <div className="page-shell trajectory-page trajectory-detail-page immersive-page immersive-page--trajectory">
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
                Г—
              </button>
            </article>
          ))}
        </div>
      ) : null}

      <header className="hero trajectory-hero immersive-page__hero">
        <div>
          <p className="hero__eyebrow">Learning path</p>
          <h1>{trajectory?.name ?? "Траектория изучения"}</h1>
          <p className="hero__subtitle">
            {isStudentMode
              ? "Студент видит только порядок тем и элементы, которые будут изучаться в каждой теме."
              : "Просмотр сохранённой траектории и быстрый редактор порядка тем."}
          </p>
        </div>

        <div className="hero__controls trajectory-detail-hero-actions">
          {isStudentMode ? (
            <>
              <button
                className="ghost-button"
                onClick={() => navigate(`/students/${studentIdFromQuery}`)}
                type="button"
              >
                К кабинету студента
              </button>
              {studentView.level === "elements" ? (
                <button
                  className="ghost-button"
                  onClick={() => returnStudentToTopics(selectedTopicId)}
                  type="button"
                >
                  К темам
                </button>
              ) : null}
            </>
          ) : (
            <>
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
              <button
                className="ghost-button"
                onClick={() => setTopicOrderModalOpen(true)}
                type="button"
              >
                Порядок тем
              </button>
              <button
                className="ghost-button"
                onClick={() => setTasksModalOpen(true)}
                type="button"
              >
                Задания
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
            </>
          )}
        </div>
      </header>

      <main className="trajectory-detail-layout immersive-page__grid immersive-page__grid--wide">
        <section className="graph-stage trajectory-graph-stage">
          <div className="graph-toolbar">
            <div>
              <span className="graph-toolbar__eyebrow">
                {isStudentMode ? "Траектория студента" : "Сохранённая траектория"}
              </span>
              <h2>{trajectory?.name ?? "Загрузка"}</h2>
            </div>
            <p className="graph-toolbar__hint">
              {showStudentView
                ? studentView.level === "topics"
                  ? "Открой тему, чтобы увидеть только те элементы, которые студент изучит на этом шаге."
                  : "Показаны только формируемые элементы выбранной темы. Нажми на центральную карточку темы, чтобы вернуться."
                : "Зелёные стрелки показывают порядок прохождения, синие пунктирные связи показывают зависимости."}
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

        {studentPreviewOpen && studentIdFromQuery && false ? (
          <section className="card card--soft trajectory-student-topic-panel">
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Текущая тема студента</p>
                <h2>{topicName(topicById, selectedTopicId)}</h2>
              </div>
              <span className="hero__chip">{selectedTopicStudentTasks.length} Р·Р°РґР°РЅРёР№</span>
            </div>
            <p className="card__text">
              Выбери тему на графе. Ниже показываются задания, связанные с элементами этой темы.
            </p>

            {selectedTopicStudentTasks.length ? (
              <div className="student-task-list">
                {selectedTopicStudentTasks.map((task) => (
                  <article className="student-task-card" key={task.id}>
                    <div className="student-task-card__header">
                      <div>
                        <strong>{task.topic_name}</strong>
                        <span>
                          Ключевой элемент: {task.primary_element.name} В· {TASK_TYPE_LABELS[task.task_type]}
                        </span>
                      </div>
                      <span className="hero__chip">Сложность {task.difficulty}</span>
                    </div>

                    <p>{task.prompt}</p>

                    <div className="student-task-card__progress">
                      <span>РЎС‚Р°С‚СѓСЃ: {task.progress.status}</span>
                      <span>РџРѕРїС‹С‚РѕРє: {task.progress.attempts_count}</span>
                      <span>РџРѕСЃР»РµРґРЅРёР№ Р±Р°Р»Р»: {task.progress.last_score ?? "еще нет"}</span>
                      <span>Р›СѓС‡С€РёР№ Р±Р°Р»Р»: {task.progress.best_score ?? "еще нет"}</span>
                    </div>

                    {renderStudentTaskAnswerEditor(task)}

                    <div className="student-task-card__actions">
                      <button
                        className="primary-button"
                        type="button"
                        disabled={savingStudentTaskId === task.id}
                        onClick={() => void handleSubmitStudentTask(task)}
                      >
                        {savingStudentTaskId === task.id ? "Проверяю..." : "Отправить ответ"}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p className="card__text">
                Для выбранной темы пока нет заданий или они еще не назначены этому студенту.
              </p>
            )}
          </section>
        ) : null}

        {studentPreviewOpen && trajectory && !studentIdFromQuery ? (
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
                        <span>РџРѕСЂРѕРі С‚РµРјС‹ {trajectoryTopic?.threshold ?? 100}</span>
                        <span>Статус: не начато</span>
                      </div>
                      <div className="trajectory-preview-elements">
                        {(trajectoryTopic?.elements ?? []).length ? (
                          trajectoryTopic!.elements.map((element) => (
                            <span key={element.id}>
                              {elementName(elementById, element.element_id)} В· РїРѕСЂРѕРі{" "}
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

        <section className="card card--soft trajectory-selected-panel trajectory-panel--inline">
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
                Р’РµСЂСЃРёСЏ РіСЂР°С„Р°: {trajectory.graph_version}
                {graph ? ` / текущая ${graph.discipline.knowledge_graph_version}` : ""}
              </span>
              <span>{trajectory.is_actual ? "Актуальна" : "Устарела"}</span>
            </div>
          ) : null}

          {!canEditTrajectory && trajectory ? (
            <p className="card__text">
              РР·РјРµРЅРµРЅРёРµ РїРѕСЂСЏРґРєР° Р·Р°Р±Р»РѕРєРёСЂРѕРІР°РЅРѕ: С‚СЂР°РµРєС‚РѕСЂРёСЏ РґРѕР»Р¶РЅР° Р±С‹С‚СЊ С‡РµСЂРЅРѕРІРёРєРѕРј Рё СЃРѕРѕС‚РІРµС‚СЃС‚РІРѕРІР°С‚СЊ
              С‚РµРєСѓС‰РµР№ РІРµСЂСЃРёРё РіСЂР°С„Р° Р·РЅР°РЅРёР№.
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
                        <span>{trajectoryTopic?.elements.length ?? 0} СЌР»РµРјРµРЅС‚РѕРІ</span>
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

                    <div className="trajectory-detail-elements">
                      <span>РџРѕСЂРѕРі С‚РµРјС‹: {trajectoryTopic?.threshold ?? 100}</span>
                      {(trajectoryTopic?.elements ?? []).map((element) => (
                        <span key={element.id}>
                          {elementName(elementById, element.element_id)} В· РїРѕСЂРѕРі {element.threshold}
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
        <section className="card card--soft trajectory-task-panel trajectory-panel--inline">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Задания</p>
              <h2>Ручное добавление заданий</h2>
            </div>
            <span className="hero__chip">{tasks.length} Р·Р°РґР°РЅРёР№</span>
          </div>

          <p className="card__text">
            Сейчас задания создаются вручную только для элементов компетенции «Знать»: тема траектории, ключевой элемент, связанные элементы, текст и сложность.
          </p>

          {allKnownTrajectoryElements.length ? (
            <div className="trajectory-task-editor">
              <div className="trajectory-task-editor__grid">
                <label className="field">
                  <span>Тема траектории</span>
                  <select
                    value={taskTopicId}
                    onChange={(event) => setTaskTopicId(event.target.value)}
                    disabled={saving}
                  >
                    {trajectory?.topics
                      .filter((topic) => (knowElementsByTrajectoryTopicId.get(topic.topic_id) ?? []).length > 0)
                      .map((topic) => (
                        <option key={topic.topic_id} value={topic.topic_id}>
                          {topicName(topicById, topic.topic_id)}
                        </option>
                      ))}
                  </select>
                </label>

                <label className="field">
                  <span>Ключевой элемент</span>
                  <select
                    value={taskPrimaryElementId}
                    onChange={(event) => setTaskPrimaryElementId(event.target.value)}
                    disabled={saving || !availablePrimaryElements.length}
                  >
                    {availablePrimaryElements.map((element) => (
                      <option key={element.id} value={element.id}>
                        {element.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Сложность</span>
                  <input
                    min={0}
                    max={100}
                    type="number"
                    value={taskDifficulty}
                    onChange={(event) => setTaskDifficulty(Number(event.target.value))}
                    disabled={saving}
                  />
                </label>
              </div>

              <label className="field">
                <span>Текст задания</span>
                <textarea
                  rows={4}
                  value={taskPrompt}
                  onChange={(event) => setTaskPrompt(event.target.value)}
                  placeholder="Опиши задание для студента"
                  disabled={saving}
                />
              </label>

              <div className="trajectory-task-template">
                <label className="field">
                  <span>Тип задания</span>
                  <select
                    value={taskType}
                    onChange={(event) => resetTaskTemplate(event.target.value as LearningTrajectoryTaskType)}
                    disabled={saving}
                  >
                    {Object.entries(TASK_TYPE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>

                {taskType === "single_choice" || taskType === "multiple_choice" ? (
                  <div className="trajectory-task-template__list">
                    <div className="trajectory-task-template__head">
                      <strong>Варианты ответа</strong>
                      <button className="ghost-button" type="button" onClick={addTaskOption} disabled={saving}>
                        Добавить вариант
                      </button>
                    </div>
                    {taskOptions.map((option, index) => (
                      <div className="trajectory-task-template__row" key={option.id}>
                        <span>{index + 1}</span>
                        <input
                          value={option.text}
                          onChange={(event) => updateTaskOption(option.id, { text: event.target.value })}
                          placeholder="Текст варианта"
                          disabled={saving}
                        />
                        <label className="trajectory-task-template__check">
                          <input
                            type={taskType === "single_choice" ? "radio" : "checkbox"}
                            checked={option.is_correct}
                            onChange={(event) => {
                              if (taskType === "single_choice" && event.target.checked) {
                                setTaskOptions((current) =>
                                  current.map((item) => ({
                                    ...item,
                                    is_correct: item.id === option.id,
                                  })),
                                );
                                return;
                              }
                              updateTaskOption(option.id, { is_correct: event.target.checked });
                            }}
                            disabled={saving}
                          />
                          <span>Правильный</span>
                        </label>
                        <button
                          className="secondary-button secondary-button--danger"
                          type="button"
                          onClick={() => removeTaskOption(option.id)}
                          disabled={saving || taskOptions.length <= 2}
                        >
                          Удалить
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {taskType === "matching" ? (
                  <div className="trajectory-task-template__list">
                    <div className="trajectory-task-template__head">
                      <strong>Пары для сопоставления</strong>
                      <button className="ghost-button" type="button" onClick={addTaskPair} disabled={saving}>
                        Добавить пару
                      </button>
                    </div>
                    {taskMatchingPairs.map((pair, index) => (
                      <div className="trajectory-task-template__row trajectory-task-template__row--matching" key={pair.id}>
                        <span>{index + 1}</span>
                        <input
                          value={pair.left}
                          onChange={(event) => updateTaskPair(pair.id, { left: event.target.value })}
                          placeholder="Левый столбец"
                          disabled={saving}
                        />
                        <input
                          value={pair.right}
                          onChange={(event) => updateTaskPair(pair.id, { right: event.target.value })}
                          placeholder="Правый столбец"
                          disabled={saving}
                        />
                        <button
                          className="secondary-button secondary-button--danger"
                          type="button"
                          onClick={() => removeTaskPair(pair.id)}
                          disabled={saving || taskMatchingPairs.length <= 2}
                        >
                          Удалить
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}

                {taskType === "text" ? (
                  <div className="trajectory-task-template__list">
                    <div className="trajectory-task-template__head">
                      <strong>Эталонные ответы</strong>
                      <button className="ghost-button" type="button" onClick={addAcceptedAnswer} disabled={saving}>
                        Добавить ответ
                      </button>
                    </div>
                    <label className="field">
                      <span>Подсказка в поле ответа</span>
                      <input
                        value={taskTextPlaceholder}
                        onChange={(event) => setTaskTextPlaceholder(event.target.value)}
                        placeholder="Напиши краткий ответ"
                        disabled={saving}
                      />
                    </label>
                    {taskAcceptedAnswers.map((answer, index) => (
                      <div className="trajectory-task-template__row" key={`${index}-${answer}`}>
                        <span>{index + 1}</span>
                        <input
                          value={answer}
                          onChange={(event) => updateAcceptedAnswer(index, event.target.value)}
                          placeholder="Правильный ответ"
                          disabled={saving}
                        />
                        <button
                          className="secondary-button secondary-button--danger"
                          type="button"
                          onClick={() => removeAcceptedAnswer(index)}
                          disabled={saving || taskAcceptedAnswers.length <= 1}
                        >
                          Удалить
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>

              <div className="trajectory-task-related">
                <strong>Связанные элементы</strong>
                <div className="trajectory-task-related__list">
                  {allKnownTrajectoryElements
                    .filter((element) => element.id !== taskPrimaryElementId)
                    .map((element) => (
                      <label className="trajectory-task-related__item" key={element.id}>
                        <input
                          type="checkbox"
                          checked={taskRelatedElementIds.includes(element.id)}
                          onChange={() => toggleTaskRelatedElement(element.id)}
                          disabled={saving}
                        />
                        <span>{element.name}</span>
                      </label>
                    ))}
                </div>
              </div>

              <div className="trajectory-task-editor__actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving || !taskTopicId || !taskPrimaryElementId || !taskPrompt.trim()}
                  onClick={() => void handleSaveTask()}
                >
                  {editingTaskId ? "Сохранить задание" : "Добавить задание"}
                </button>
                {editingTaskId ? (
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={saving}
                    onClick={resetTaskForm}
                  >
                    Сбросить редактирование
                  </button>
                ) : null}
              </div>
            </div>
          ) : (
            <p className="card__text">
              В этой траектории пока нет выбранных элементов «Знать», поэтому задания создать нельзя.
            </p>
          )}

          <div className="trajectory-task-list">
            {tasks.length ? (
              tasks.map((task) => (
                <article className="trajectory-task-card" key={task.id}>
                  <div className="trajectory-task-card__header">
                    <div>
                      <strong>{task.topic_name}</strong>
                      <span>
                        Ключевой элемент: {task.primary_element.name} В· Сложность {task.difficulty}
                      </span>
                    </div>
                    <div className="trajectory-task-card__actions">
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={saving}
                        onClick={() => startTaskEditing(task)}
                      >
                        РР·РјРµРЅРёС‚СЊ
                      </button>
                      <button
                        className="secondary-button secondary-button--danger"
                        type="button"
                        disabled={saving}
                        onClick={() => void handleDeleteTask(task.id)}
                      >
                        Удалить
                      </button>
                    </div>
                  </div>
                  <p>{task.prompt}</p>
                  <div className="trajectory-task-card__chips">
                    <span>{task.primary_element.name}</span>
                    {task.related_elements.map((element) => (
                      <span key={element.element_id}>{element.name}</span>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="card__text">Для этой траектории задания пока не созданы.</p>
            )}
          </div>
        </section>
      </main>

      {!isStudentMode && topicOrderModalOpen ? (
        <div className="modal-backdrop" onClick={() => setTopicOrderModalOpen(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-panel__header">
              <div>
                <p className="card__eyebrow">Траектория</p>
                <h2>Порядок тем</h2>
              </div>
              <button className="ghost-button" onClick={() => setTopicOrderModalOpen(false)} type="button">
                Закрыть
              </button>
            </div>
            <div className="modal-panel__body">{renderTopicOrderModalBody()}</div>
          </div>
        </div>
      ) : null}

      {isStudentMode && studentTaskModalOpen ? (
        <div className="modal-backdrop" onClick={() => setStudentTaskModalOpen(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-panel__header">
              <div>
                <p className="card__eyebrow">Студент</p>
                <h2>{topicName(topicById, selectedTopicId)}</h2>
              </div>
              <button className="ghost-button" onClick={() => setStudentTaskModalOpen(false)} type="button">
                Закрыть
              </button>
            </div>
            <div className="modal-panel__body">
              <section className="card card--soft trajectory-student-topic-modal">
                <p className="card__text">Выбрана тема траектории. Ниже показаны задания, связанные с ее элементами.</p>
                {selectedTopicStudentTasks.length ? (
                  <div className="student-task-list">
                    {selectedTopicStudentTasks.map((task) => (
                      <article className="student-task-card" key={task.id}>
                        <div className="student-task-card__header">
                          <div>
                            <strong>{task.topic_name}</strong>
                            <span>Ключевой элемент: {task.primary_element.name} · {TASK_TYPE_LABELS[task.task_type]}</span>
                          </div>
                          <span className="hero__chip">Сложность {task.difficulty}</span>
                        </div>
                        <p>{task.prompt}</p>
                        <div className="student-task-card__progress">
                          <span>Статус: {task.progress.status}</span>
                          <span>Попыток: {task.progress.attempts_count}</span>
                          <span>Последний балл: {task.progress.last_score ?? "еще нет"}</span>
                          <span>Лучший балл: {task.progress.best_score ?? "еще нет"}</span>
                        </div>
                        {renderStudentTaskAnswerEditor(task)}
                        <div className="student-task-card__actions">
                          <button className="primary-button" type="button" disabled={savingStudentTaskId === task.id} onClick={() => void handleSubmitStudentTask(task)}>
                            {savingStudentTaskId === task.id ? "Проверяю..." : "Отправить ответ"}
                          </button>
                        </div>
                      </article>
                    ))}
                  </div>
                ) : (
                  <p className="card__text">Для выбранной темы пока нет заданий или они еще не назначены этому студенту.</p>
                )}
              </section>
            </div>
          </div>
        </div>
      ) : null}

      {!isStudentMode && tasksModalOpen ? (
        <div className="modal-backdrop" onClick={() => setTasksModalOpen(false)}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-panel__header">
              <div>
                <p className="card__eyebrow">Траектория</p>
                <h2>Задания</h2>
              </div>
              <button className="ghost-button" onClick={() => setTasksModalOpen(false)} type="button">
                Закрыть
              </button>
            </div>
            <div className="modal-panel__body">{renderTasksModalBody()}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

