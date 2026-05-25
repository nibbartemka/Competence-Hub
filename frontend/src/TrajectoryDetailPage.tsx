import { type DragEvent, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import RelationGraph, {
  type JsonLine,
  type JsonNode,
  type RGOptions,
  type RelationGraphComponent,
} from "relation-graph-react";

import {
  createLearningTrajectoryTask,
  deleteLearningTrajectoryTask,
  downloadStudentTaskSubmissionFile,
  fetchDisciplineKnowledgeGraph,
  fetchLearningTrajectory,
  fetchLearningTrajectoryTasks,
  fetchOperationContracts,
  fetchRecommendedStudentTask,
  fetchStudentTasks,
  fetchStudentTrajectoryMastery,
  isAbortError,
  reviewStudentTaskSubmission,
  submitStudentTaskFileSubmission,
  submitStudentTaskScore,
  updateLearningTrajectoryTask,
  updateLearningTrajectoryStatus,
  updateLearningTrajectoryTopicOrder,
} from "./api";
import {
  GraphNode,
  GraphNodeRuntimeStateProvider,
  type GraphNodeRuntimeState,
} from "./components/GraphNode";
import OperationInputEditor, {
  validateOperationInput,
} from "./components/OperationInputEditor";
import {
  buildStructuredOperationAnswerText,
  hasStructuredOperationContent,
  OperationAnswerEditor,
  OperationInputPreview,
  OperationOutputPreview,
} from "./components/OperationTaskSchemaViews";
import StudentTaskDebugAnswerModal from "./components/StudentTaskDebugAnswerModal";
import { useNotifications } from "./notifications";
import { getSessionHomePath, readSession } from "./session";
import { disciplinePathValue } from "./disciplineRouting";
import {
  buildFocusedScene,
  hasConcreteNodeSelection,
  NO_NODE_SELECTION,
} from "./graphFocus";
import {
  buildRelatedElementNames,
  isBidirectionalRelation,
  isSupportedElementRelation,
  relationLabel,
} from "./graphScene";
import { usePersistedGraphViewport } from "./graphViewport";
import type {
  DetailCard,
  DisciplineKnowledgeGraph,
  KnowledgeElement,
  KnowledgeElementRelation,
  KnowledgeElementRelationType,
  LearningTrajectory,
  LearningTrajectoryTaskContent,
  LearningTrajectoryTaskMatchingPair,
  LearningTrajectoryTaskOption,
  LearningTrajectoryTaskTemplateKind,
  LearningTrajectoryTaskType,
  LearningTrajectoryTask,
  OperationContract,
  LearningTrajectoryTopic,
  SceneNodeData,
  StudentAssignedTask,
  StudentTrajectoryMastery,
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
  moveToCenterWhenRefresh: false,
  zoomToFitWhenRefresh: false,
  useAnimationWhenRefresh: false,
  useAnimationWhenExpanded: true,
  allowShowMiniToolBar: false,
  allowShowFullscreenMenu: false,
  allowShowZoomMenu: false,
  hideNodeContentByZoom: false,
  lineUseTextPath: false,
  defaultLineTextOffset_y: -10,
};

const TASK_DIFFICULTY_MIN = 0;
const TASK_DIFFICULTY_MAX = 100;

const TASK_TYPE_LABELS = {
  single_choice: "Один выбор",
  multiple_choice: "Несколько выборов",
  matching: "Сопоставление",
  ordering: "Порядок",
  text: "Текст / файл",
} as Record<LearningTrajectoryTaskType, string>;

const TASK_TEMPLATE_LABELS = {
  definition_choice: "Выбрать правильное определение",
  term_choice: "Выбрать понятие по определению",
  property_multiple: "Выбор характеристик объекта",
  relation_choice: "Выбрать отношение между элементами",
  requires_ordering: "Расположить от базового к производному",
  contains_multiple: "Определить части целого",
  matching_definition: "Сопоставить понятия и определения",
  contrast_choice: "Выбрать верное различие",
  manual: "Ручной шаблон",
} as Record<LearningTrajectoryTaskTemplateKind, string>;

const TASK_TEMPLATE_TYPE = {
  definition_choice: "single_choice",
  term_choice: "single_choice",
  property_multiple: "multiple_choice",
  relation_choice: "single_choice",
  requires_ordering: "ordering",
  contains_multiple: "multiple_choice",
  matching_definition: "matching",
  contrast_choice: "single_choice",
  manual: "single_choice",
} as Record<LearningTrajectoryTaskTemplateKind, LearningTrajectoryTaskType>;

const VISIBLE_TASK_TEMPLATE_KINDS: LearningTrajectoryTaskTemplateKind[] = [
  "definition_choice",
  "term_choice",
  "property_multiple",
  "contains_multiple",
  "matching_definition",
  "manual",
];

const MANUAL_TASK_TYPE_OPTIONS: LearningTrajectoryTaskType[] = [
  "single_choice",
  "multiple_choice",
  "matching",
];

TASK_TYPE_LABELS.text = "Текстовый ответ";
TASK_TEMPLATE_LABELS.text_definition = "Текстовый ответ";
TASK_TEMPLATE_TYPE.text_definition = "text";

TASK_TYPE_LABELS.text = "Текстовый ответ";
TASK_TEMPLATE_LABELS.text_definition = "Текстовый ответ";
TASK_TEMPLATE_TYPE.text_definition = "text";
MANUAL_TASK_TYPE_OPTIONS.push("text");

const CHECKED_TASK_RELATION_LABELS: Partial<Record<KnowledgeElementRelationType, string>> = {
  requires: "требует",
  builds_on: "строится на",
  relies_on: "опирается на",
  contains: "содержит",
  part_of: "является частью",
  property_of: "свойство объекта",
  refines: "уточняет",
  generalizes: "обобщает",
  similar: "родственно",
  contrasts_with: "противопоставляется",
  used_with: "используется вместе",
  implements: "реализует",
  automates: "автоматизирует",
};

type TaskCompetenceTab = KnowledgeElement["competence_type"];

const TASK_COMPETENCE_TABS: Array<{
  value: TaskCompetenceTab;
  label: string;
}> = [
  { value: "know", label: "Знать" },
  { value: "can", label: "Уметь" },
  { value: "master", label: "Владеть" },
];

function createLocalId() {
  return Math.random().toString(36).slice(2, 10);
}

function createEmptyOption(isCorrect = false): LearningTrajectoryTaskOption {
  return { id: createLocalId(), text: "", is_correct: isCorrect };
}

function createEmptyPair(): LearningTrajectoryTaskMatchingPair {
  return { id: createLocalId(), left: "", right: "" };
}

function buildEmptyStudentTaskAnswer(task: StudentAssignedTask) {
  if (task.task_type === "single_choice" || task.task_type === "multiple_choice") {
    return { selected_option_ids: [] as string[] };
  }
  if (task.task_type === "matching") {
    return { pairings: [] as Array<{ left_id: string; right_id: string }> };
  }
  if (task.task_type === "text") {
    return { text: "" };
  }
  return { ordered_item_ids: [] as string[] };
}

function buildStudentTaskAnswerDraft(task: StudentAssignedTask) {
  if (task.task_instance_id) {
    return buildEmptyStudentTaskAnswer(task);
  }

  if (task.progress.last_answer_payload) {
    return task.progress.last_answer_payload;
  }

  return buildEmptyStudentTaskAnswer(task);
}

function isManualMasterTask(task: StudentAssignedTask) {
  return (
    task.task_type === "text" &&
    task.primary_element &&
    task.content.manual_review === true &&
    task.content.submission_kind === "file"
  );
}

function extractSubmittedFileMeta(task: StudentAssignedTask) {
  const payload = task.progress.last_answer_payload;
  if (!payload || payload.submission_kind !== "file") {
    return null;
  }
  return {
    originalName: String(payload.original_name ?? ""),
    uploadedAt: String(payload.uploaded_at ?? ""),
    sizeBytes: Number(payload.size_bytes ?? 0),
  };
}

function studentTaskProgressLabel(status: StudentAssignedTask["progress"]["status"]) {
  if (status === "not_started") return "Не начато";
  if (status === "in_progress") return "В работе";
  if (status === "pending_review") return "Ждет проверки";
  return "Проверено";
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось выполнить действие с траекторией.";
}

function clampTaskDifficulty(value: number) {
  return Math.max(TASK_DIFFICULTY_MIN, Math.min(TASK_DIFFICULTY_MAX, Number(value) || 0));
}

function estimateTrajectoryNodeHeight(topic: Topic) {
  const text = topic.description?.trim() || "Описание темы пока не добавлено.";
  return Math.min(360, 196 + Math.ceil(text.length / 30) * 16);
}

function estimateTrajectoryElementNodeHeight(element: KnowledgeElement) {
  const text = element.description?.trim() || "Описание элемента пока не добавлено.";
  return Math.min(260, 176 + Math.ceil(text.length / 28) * 14);
}

function competenceLabel(type: KnowledgeElement["competence_type"]) {
  if (type === "know") return "Знать";
  if (type === "can") return "Уметь";
  return "Владеть";
}

function buildDetailValueKey(label: string, value: string) {
  return `${label}:${value}`;
}

function trajectoryTopicColumnCount(totalTopics: number) {
  if (totalTopics <= 3) return totalTopics || 1;
  if (totalTopics <= 8) return 4;
  return 5;
}

function topicName(topicById: Map<string, Topic>, topicId: string) {
  return topicById.get(topicId)?.name ?? "Тема не найдена";
}

function elementName(elementById: Map<string, KnowledgeElement>, elementId: string) {
  return elementById.get(elementId)?.name ?? "Элемент не найден";
}

function checkedRelationLabel(
  relation: KnowledgeElementRelation,
  elementById: Map<string, KnowledgeElement>,
) {
  const sourceName = elementName(elementById, relation.source_element_id);
  const targetName = elementName(elementById, relation.target_element_id);
  const label = CHECKED_TASK_RELATION_LABELS[relation.relation_type] ?? relation.relation_type;
  return `${sourceName} ${label} ${targetName}`;
}

function templateUsesDefinitions(templateKind: LearningTrajectoryTaskTemplateKind) {
  return (
    templateKind === "definition_choice" ||
    templateKind === "term_choice" ||
    templateKind === "matching_definition"
  );
}

function isElementDirectlyRelated(
  graph: DisciplineKnowledgeGraph | null,
  primaryElementId: string,
  elementId: string,
) {
  if (!graph || !primaryElementId || !elementId) return false;
  return graph.knowledge_element_relations.some(
    (relation) =>
      (relation.source_element_id === primaryElementId && relation.target_element_id === elementId) ||
      (relation.source_element_id === elementId && relation.target_element_id === primaryElementId),
  );
}

function buildAutoMultipleChoiceBuckets(
  graph: DisciplineKnowledgeGraph | null,
  templateKind: LearningTrajectoryTaskTemplateKind,
  primaryElementId: string,
  selectedElementIds: string[],
) {
  const correctIds = new Set<string>();
  const distractorIds = new Set<string>();

  if (!graph || !primaryElementId) {
    return { correctIds: [] as string[], distractorIds: selectedElementIds };
  }

  for (const elementId of selectedElementIds) {
    const isCorrect = graph.knowledge_element_relations.some((relation) => {
      if (templateKind === "property_multiple") {
        return (
          relation.relation_type === "property_of" &&
          relation.source_element_id === elementId &&
          relation.target_element_id === primaryElementId
        );
      }

      if (templateKind === "contains_multiple") {
        return (
          (relation.relation_type === "contains" &&
            relation.source_element_id === primaryElementId &&
            relation.target_element_id === elementId) ||
          (relation.relation_type === "part_of" &&
            relation.source_element_id === elementId &&
            relation.target_element_id === primaryElementId)
        );
      }

      return false;
    });

    if (isCorrect) {
      correctIds.add(elementId);
    } else {
      distractorIds.add(elementId);
    }
  }

  return {
    correctIds: [...correctIds],
    distractorIds: [...distractorIds],
  };
}

function getAvailableKnowTemplateKinds(
  graph: DisciplineKnowledgeGraph | null,
  primaryElementId: string,
  availableElements: KnowledgeElement[],
): LearningTrajectoryTaskTemplateKind[] {
  const availableElementIds = availableElements.map((element) => element.id);
  const hasExtraElements = availableElementIds.length > 0;
  const hasEnoughElementsForMultiple = availableElementIds.length >= 2;

  const propertyBuckets = hasEnoughElementsForMultiple
    ? buildAutoMultipleChoiceBuckets(
        graph,
        "property_multiple",
        primaryElementId,
        availableElementIds,
      )
    : { correctIds: [], distractorIds: [] as string[] };

  const containsBuckets = hasEnoughElementsForMultiple
    ? buildAutoMultipleChoiceBuckets(
        graph,
        "contains_multiple",
        primaryElementId,
        availableElementIds,
      )
    : { correctIds: [], distractorIds: [] as string[] };

  const availableTemplateKinds: LearningTrajectoryTaskTemplateKind[] = VISIBLE_TASK_TEMPLATE_KINDS.filter((templateKind) => {
    if (
      templateKind === "definition_choice" ||
      templateKind === "term_choice" ||
      templateKind === "matching_definition"
    ) {
      return hasExtraElements;
    }

    if (templateKind === "property_multiple") {
      return (
        propertyBuckets.correctIds.length > 0
      );
    }

    if (templateKind === "contains_multiple") {
      return (
        containsBuckets.correctIds.length > 0
      );
    }

    return false;
  });

  return availableTemplateKinds.length ? availableTemplateKinds : ["manual"];
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

function studentTopicMastery(
  trajectoryTopic: LearningTrajectoryTopic,
  masteryByElementId: Map<string, number>,
) {
  const topicElements = trajectoryTopic.elements ?? [];
  if (!topicElements.length) {
    return 100;
  }

  const total = topicElements.reduce(
    (sum, element) => sum + (masteryByElementId.get(element.element_id) ?? 0),
    0,
  );
  return Math.round(total / topicElements.length);
}

function studentTopicLockReason(
  graph: DisciplineKnowledgeGraph | null,
  trajectory: LearningTrajectory,
  trajectoryTopic: LearningTrajectoryTopic,
  masteryByElementId: Map<string, number>,
) {
  if (!graph) {
    return "";
  }

  const elementNameById = new Map(graph.knowledge_elements.map((element) => [element.id, element.name]));
  const thresholdsByElementId = new Map<string, number>();
  for (const topic of trajectory.topics) {
    for (const element of topic.elements ?? []) {
      const current = thresholdsByElementId.get(element.element_id) ?? -1;
      if (element.threshold > current) {
        thresholdsByElementId.set(element.element_id, element.threshold);
      }
    }
  }

  const requiredLinks = graph.topic_knowledge_elements.filter(
    (link) => link.topic_id === trajectoryTopic.topic_id && link.role === "required",
  );
  if (!requiredLinks.length) {
    return "";
  }

  const missingElementNames = requiredLinks
    .filter((link) => {
      const threshold = thresholdsByElementId.get(link.element_id);
      if (threshold == null) {
        return true;
      }
      return (masteryByElementId.get(link.element_id) ?? 0) < threshold;
    })
    .map((link) => elementNameById.get(link.element_id) ?? "неизвестный элемент");

  if (!missingElementNames.length) {
    return "";
  }

  return `Тема откроется, когда будут освоены требуемые элементы: ${missingElementNames.join(", ")}.`;
}

function studentTopicUnlocked(
  graph: DisciplineKnowledgeGraph | null,
  trajectory: LearningTrajectory,
  trajectoryTopic: LearningTrajectoryTopic,
  masteryByElementId: Map<string, number>,
) {
  return !studentTopicLockReason(graph, trajectory, trajectoryTopic, masteryByElementId);
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
  const columns = trajectoryTopicColumnCount(topicOrder.length);

  topicOrder.forEach((topicId, index) => {
    const topic = topicById.get(topicId);
    const trajectoryTopic = trajectoryTopicByTopicId.get(topicId);
    if (!topic || !trajectoryTopic) return;
    const topicElements = trajectoryTopic.elements ?? [];

    const nodeId = `topic:${topic.id}`;
    const selectedElementsCount = topicElements.length;
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
      x: 120 + col * 300,
      y: 160 + row * 312,
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
    key: `trajectory-topics:${trajectory.id}`,
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
  masteryByElementId: Map<string, number>,
) {
  const topicById = new Map(graph.topics.map((topic) => [topic.id, topic]));
  const trajectoryTopicByTopicId = new Map(
    trajectory.topics.map((trajectoryTopic) => [trajectoryTopic.topic_id, trajectoryTopic]),
  );
  const nodes: JsonNode[] = [];
  const lines: JsonLine[] = [];
  const detailsByNodeId: Record<string, DetailCard> = {};
  const sequentialLineKeys = new Set<string>();
  let defaultSelectedNodeId = "";
  const columns = trajectoryTopicColumnCount(topicOrder.length);

  topicOrder.forEach((topicId, index) => {
    const topic = topicById.get(topicId);
    const trajectoryTopic = trajectoryTopicByTopicId.get(topicId);
    if (!topic || !trajectoryTopic) return;
    const topicElements = trajectoryTopic.elements ?? [];

    const nodeId = `topic:${topic.id}`;
    const row = Math.floor(index / columns);
    const col = index % columns;
    const topicMastery = studentTopicMastery(trajectoryTopic, masteryByElementId);
    const lockReason = studentTopicLockReason(
      graph,
      trajectory,
      trajectoryTopic,
      masteryByElementId,
    );
    const isUnlocked = !lockReason;

    if (!defaultSelectedNodeId && isUnlocked) {
      defaultSelectedNodeId = nodeId;
    }

    const data: SceneNodeData = {
      entity: "topic",
      tone: "topic",
      badge: "Тема",
      title: topic.name,
      subtitle: `Шаг ${index + 1}`,
      description: topic.description ?? "Описание темы пока не добавлено.",
      metrics: [`${topicElements.length} элементов`, `Балл ${topicMastery}`],
      progressValue: topicMastery,
      progressLabel: "Прогресс темы",
      hint: isUnlocked ? "Открыть тему" : "Тема закрыта",
      isSelected: false,
      isDisabled: !isUnlocked,
      lockState: isUnlocked ? "open" : "locked",
      sequenceNumber: index + 1,
      topicId: topic.id,
    };

    nodes.push({
      id: nodeId,
      text: topic.name,
      x: 120 + col * 300,
      y: 160 + row * 312,
      width: 270,
      height: estimateTrajectoryNodeHeight(topic),
      nodeShape: 1,
      data,
    });

    detailsByNodeId[nodeId] = {
      title: topic.name,
      subtitle: `Шаг ${index + 1} траектории`,
      description: topic.description ?? "Описание темы пока не добавлено.",
      chips: [
        { label: `Балл темы: ${topicMastery}`, tone: isUnlocked ? "formed" : "required" },
      ],
      stats: [
        { label: "Элементов для изучения", value: String(topicElements.length) },
        { label: "Текущий балл", value: String(topicMastery) },
      ],
      footnote: isUnlocked
        ? "Открой тему, чтобы увидеть элементы, которые студент изучает на этом шаге."
        : lockReason,
    };
  });

  for (let index = 0; index < topicOrder.length - 1; index += 1) {
    const fromId = `topic:${topicOrder[index]}`;
    const toId = `topic:${topicOrder[index + 1]}`;
    const lineId = `student-step:${topicOrder[index]}:${topicOrder[index + 1]}`;
    if (sequentialLineKeys.has(lineId)) {
      continue;
    }
    sequentialLineKeys.add(lineId);

    lines.push({
      id: lineId,
      from: fromId,
      to: toId,
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
    key: `student-trajectory-topics:${trajectory.id}`,
    rootId: defaultSelectedNodeId || (nodes[0]?.id ?? ""),
    nodes,
    lines,
    detailsByNodeId,
    defaultSelectedNodeId: defaultSelectedNodeId || (nodes[0]?.id ?? ""),
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
      key: `student-trajectory-elements-missing:${trajectory.id}:${topicId}`,
      rootId: "",
      nodes: [] as JsonNode[],
      lines: [] as JsonLine[],
      detailsByNodeId,
      defaultSelectedNodeId: "",
    };
  }

  const focusNodeId = `topic-focus:${topic.id}`;
  const trajectoryElements = trajectoryTopic.elements ?? [];
  const selectedElements = trajectoryElements
    .map((item) => ({
      trajectoryElement: item,
      element: elementById.get(item.element_id),
    }))
    .filter(
      (item): item is { trajectoryElement: typeof trajectoryElements[number]; element: KnowledgeElement } =>
        Boolean(item.element),
    );
  const selectedElementIds = new Set(selectedElements.map((item) => item.element.id));

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
    chips: [],
    subtitle: "Формируемые элементы",
    description: topic.description ?? "Описание темы пока не добавлено.",
    stats: [{ label: "Элементов для изучения", value: String(selectedElements.length) }],
    footnote: "Нажми на центральную карточку, чтобы вернуться к списку тем.",
  };

  selectedElements.forEach(({ trajectoryElement, element }, index) => {
    const nodeId = `element:${topic.id}:${element.id}`;
    const col = index % 3;
    const row = Math.floor(index / 3);
    const relatedElementNames = buildRelatedElementNames(graph, element.id, selectedElementIds);

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
      stats: [
        { label: "Компетенция", value: competenceLabel(element.competence_type) },
        {
          label: "Связи с элементами",
          value: relatedElementNames.length
            ? relatedElementNames
            : "В текущем графе траектории связей нет.",
        },
      ],
      footnote: "Студент изучает этот элемент в рамках выбранной темы.",
    };
  });

  for (const relation of graph.knowledge_element_relations) {
    if (
      !selectedElementIds.has(relation.source_element_id) ||
      !selectedElementIds.has(relation.target_element_id)
    ) {
      continue;
    }

    const sourceElement = elementById.get(relation.source_element_id);
    const targetElement = elementById.get(relation.target_element_id);
    if (
      !isSupportedElementRelation(
        sourceElement?.competence_type,
        targetElement?.competence_type,
        relation.relation_type,
      )
    ) {
      continue;
    }

    lines.push({
      from: `element:${topic.id}:${relation.source_element_id}`,
      to: `element:${topic.id}:${relation.target_element_id}`,
      text: relationLabel(relation.relation_type),
      color: "#d37b34",
      fontColor: "#91521c",
      lineWidth: 2,
      dashType: 4,
      animation: 3,
      textOffset_y: -16,
      showStartArrow: isBidirectionalRelation(relation.relation_type),
      showEndArrow: true,
    });
  }

  return {
    key: `student-trajectory-elements:${trajectory.id}:${topic.id}`,
    rootId: focusNodeId,
    nodes,
    lines,
    detailsByNodeId,
    defaultSelectedNodeId: focusNodeId,
  };
}

function buildTrajectoryElementsScene(
  graph: DisciplineKnowledgeGraph,
  trajectory: LearningTrajectory,
  topicId: string,
  elementById: Map<string, KnowledgeElement>,
) {
  const scene = buildStudentTrajectoryElementsScene(graph, trajectory, topicId, elementById);
  return {
    ...scene,
    key: `trajectory-elements:${trajectory.id}:${topicId}`,
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
  const [view, setView] = useState<ViewMode>({ level: "topics" });
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [draggedTopicId, setDraggedTopicId] = useState("");
  const [dragOverTopicId, setDragOverTopicId] = useState("");
  const [studentPreviewOpen, setStudentPreviewOpen] = useState(false);
  const [tasks, setTasks] = useState<LearningTrajectoryTask[]>([]);
  const [taskTopicId, setTaskTopicId] = useState("");
  const [taskPrimaryElementId, setTaskPrimaryElementId] = useState("");
  const [taskRelatedElementIds, setTaskRelatedElementIds] = useState<string[]>([]);
  const [taskCheckedRelationIds, setTaskCheckedRelationIds] = useState<string[]>([]);
  const [taskCompetenceTab, setTaskCompetenceTab] = useState<TaskCompetenceTab>("know");
  const [taskTemplateKind, setTaskTemplateKind] = useState<LearningTrajectoryTaskTemplateKind>("definition_choice");
  const [taskSingleCorrectElementId, setTaskSingleCorrectElementId] = useState("");
  const [taskMultipleCorrectRelatedElementIds, setTaskMultipleCorrectRelatedElementIds] = useState<string[]>([]);
  const [taskDistractorElementIds, setTaskDistractorElementIds] = useState<string[]>([]);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPrompt, setTaskPrompt] = useState("");
  const [taskDifficulty, setTaskDifficulty] = useState(30);
  const [taskType, setTaskType] = useState<LearningTrajectoryTaskType>("single_choice");
  const [taskPreviewOpen, setTaskPreviewOpen] = useState(false);
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
  const [taskSkillInputPayload, setTaskSkillInputPayload] = useState<Record<string, unknown>>({});
  const [operationContracts, setOperationContracts] = useState<OperationContract[]>([]);
  const [editingTaskId, setEditingTaskId] = useState("");
  const [topicOrderModalOpen, setTopicOrderModalOpen] = useState(false);
  const [tasksModalOpen, setTasksModalOpen] = useState(false);
  const [tasksModalSection, setTasksModalSection] = useState<"list" | "create">("list");
  const [taskListTopicFilter, setTaskListTopicFilter] = useState("all");
  const [taskListSearch, setTaskListSearch] = useState("");
  const [taskListCompetenceFilters, setTaskListCompetenceFilters] = useState<Record<KnowledgeElement["competence_type"], boolean>>({
    know: true,
    can: true,
    master: true,
  });
  const [studentTasks, setStudentTasks] = useState<StudentAssignedTask[]>([]);
  const [recommendedStudentTask, setRecommendedStudentTask] = useState<StudentAssignedTask | null>(null);
  const [studentTrajectoryMastery, setStudentTrajectoryMastery] =
    useState<StudentTrajectoryMastery | null>(null);
  const [studentTaskAnswers, setStudentTaskAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [studentTaskFiles, setStudentTaskFiles] = useState<Record<string, File | null>>({});
  const [teacherReviewDrafts, setTeacherReviewDrafts] = useState<
    Record<string, { score: number; reviewComment: string }>
  >({});
  const [debugStudentTask, setDebugStudentTask] = useState<StudentAssignedTask | null>(null);
  const [savingStudentTaskId, setSavingStudentTaskId] = useState("");
  const [studentDataLoading, setStudentDataLoading] = useState(false);
  const [studentTaskModalOpen, setStudentTaskModalOpen] = useState(false);
  const [studentView, setStudentView] = useState<ViewMode>({ level: "topics" });
  const [autoReviewFocusApplied, setAutoReviewFocusApplied] = useState(false);
  const studentIdFromQuery = searchParams.get("student") ?? "";
  const reviewModeFromQuery = searchParams.get("review") ?? "";
  const isStudentMode = Boolean(studentIdFromQuery);
  const showStudentView = isStudentMode || studentPreviewOpen;
  const activeSession = readSession();
  const isTeacherReviewMode =
    Boolean(studentIdFromQuery) &&
    activeSession?.role === "teacher" &&
    activeSession.userId === trajectory?.teacher_id;
  const resolvedDisciplineId = graph?.discipline.id ?? "";
  const resolvedDisciplinePath = disciplinePathValue(graph?.discipline, disciplineId ?? "");
  const { pushNotification } = useNotifications();

  useEffect(() => {
    if (searchParams.get("preview") === "student") {
      setStudentPreviewOpen(true);
    }
  }, [searchParams]);

  useEffect(() => {
    if (!showStudentView) {
      setStudentTaskModalOpen(false);
      setStudentDataLoading(false);
      setStudentTrajectoryMastery(null);
      setStudentTaskFiles({});
      setTeacherReviewDrafts({});
      setView({ level: "topics" });
      return;
    }
    setStudentView({ level: "topics" });
  }, [showStudentView]);

  useEffect(() => {
    setAutoReviewFocusApplied(false);
  }, [studentIdFromQuery, trajectoryId, reviewModeFromQuery]);

  useEffect(() => {
    if (!topicOrder.length) {
      setSelectedNodeId(NO_NODE_SELECTION);
      return;
    }

    const firstTopicNodeId = `topic:${topicOrder[0]}`;

    if (showStudentView) {
      setSelectedNodeId(firstTopicNodeId);
      return;
    }

    if (
      selectedNodeId.startsWith("element:") ||
      selectedNodeId.startsWith("topic-focus:")
    ) {
      setSelectedNodeId(firstTopicNodeId);
    }
  }, [showStudentView, topicOrder]);

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
        const [nextGraph, nextTrajectory, nextContracts] = await Promise.all([
          fetchDisciplineKnowledgeGraph(disciplineId!, controller.signal),
          fetchLearningTrajectory(trajectoryId!, controller.signal),
          fetchOperationContracts(controller.signal),
        ]);
        const nextOrder = nextTrajectory.topics
          .slice()
          .sort((left, right) => left.position - right.position)
          .map((topic) => topic.topic_id);

        setGraph(nextGraph);
        setTrajectory(nextTrajectory);
        setOperationContracts(nextContracts);
        setTopicOrder(nextOrder);
        setSelectedNodeId(nextOrder[0] ? `topic:${nextOrder[0]}` : "");

        if (isStudentMode) {
          setTasks([]);
        } else {
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
  }, [disciplineId, isStudentMode, trajectoryId]);

  useEffect(() => {
    if (!showStudentView || !studentIdFromQuery || !disciplineId || !trajectoryId) return;
    const currentTrajectoryId = trajectoryId;
    const controller = new AbortController();

    async function loadStudentMastery() {
      try {
        setStudentDataLoading(true);
        const [nextMastery, nextStudentTasks, nextRecommendedTask] = await Promise.all([
          fetchStudentTrajectoryMastery(
            studentIdFromQuery,
            currentTrajectoryId,
            controller.signal,
          ),
          fetchStudentTasks(
            studentIdFromQuery,
            controller.signal,
            undefined,
            currentTrajectoryId,
          ),
          fetchRecommendedStudentTask(
            studentIdFromQuery,
            controller.signal,
            undefined,
            currentTrajectoryId,
          ).catch(() => null),
        ]);
        setStudentTrajectoryMastery(nextMastery);
        setStudentTasks(nextStudentTasks);
        setRecommendedStudentTask(nextRecommendedTask);
        setStudentTaskAnswers({});
        setStudentTaskFiles({});
      } catch (error) {
        if (!isAbortError(error)) {
          pushNotification("error", extractErrorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) {
          setStudentDataLoading(false);
        }
      }
    }

    void loadStudentMastery();
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
  const studentMasteryByElementId = useMemo(() => {
    const mastery = new Map<string, number>();

    if (studentTrajectoryMastery) {
      for (const topic of studentTrajectoryMastery.topics) {
        for (const element of topic.elements) {
          mastery.set(element.element_id, element.mastery_value);
        }
      }
      return mastery;
    }

    for (const task of studentTasks) {
      mastery.set(task.primary_element.element_id, task.primary_element.mastery_value);
      for (const relatedElement of task.related_elements) {
        mastery.set(relatedElement.element_id, relatedElement.mastery_value);
      }
    }

    return mastery;
  }, [studentTasks, studentTrajectoryMastery]);
  const trajectoryElementsByTopicId = useMemo(() => {
    const result = new Map<string, KnowledgeElement[]>();
    if (!trajectory) return result;

    for (const trajectoryTopic of trajectory.topics) {
      const items = trajectoryTopic.elements
        .map((element) => elementById.get(element.element_id))
        .filter((element): element is KnowledgeElement => Boolean(element));
      result.set(trajectoryTopic.topic_id, items);
    }

    return result;
  }, [elementById, trajectory]);
  const knowElementsByTrajectoryTopicId = useMemo(() => {
    const result = new Map<string, KnowledgeElement[]>();
    for (const [topicId, elements] of trajectoryElementsByTopicId.entries()) {
      result.set(
        topicId,
        elements.filter((element) => element.competence_type === "know"),
      );
    }
    return result;
  }, [trajectoryElementsByTopicId]);
  const allKnownTrajectoryElements = useMemo(() => {
    const byId = new Map<string, KnowledgeElement>();
    for (const elements of knowElementsByTrajectoryTopicId.values()) {
      for (const element of elements) {
        byId.set(element.id, element);
      }
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [knowElementsByTrajectoryTopicId]);
  const allTrajectoryPrimaryElements = useMemo(() => {
    const byId = new Map<string, KnowledgeElement>();
    for (const elements of trajectoryElementsByTopicId.values()) {
      for (const element of elements) {
        byId.set(element.id, element);
      }
    }
    return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [trajectoryElementsByTopicId]);
  const { scene, dimmedNodeIds } = useMemo(() => {
    if (!graph || !trajectory) {
      return {
        scene: null as ReturnType<typeof buildTrajectoryScene> | null,
        dimmedNodeIds: new Set<string>(),
      };
    }

    let baseScene: ReturnType<typeof buildTrajectoryScene>;
    if (showStudentView) {
      if (studentView.level === "elements") {
        baseScene = buildStudentTrajectoryElementsScene(
          graph,
          trajectory,
          studentView.topicId,
          elementById,
        );
      } else {
        baseScene = buildStudentTrajectoryTopicsScene(
          graph,
          trajectory,
          topicOrder,
          studentMasteryByElementId,
        );
      }
    } else {
      if (view.level === "elements") {
        baseScene = buildTrajectoryElementsScene(
          graph,
          trajectory,
          view.topicId,
          elementById,
        );
      } else {
        baseScene = buildTrajectoryScene(graph, trajectory, topicOrder);
      }
    }

    const actionScene = {
      ...baseScene,
      nodes: baseScene.nodes.map((node) => {
        const data = node.data as SceneNodeData | undefined;
        if (!data?.entity) {
          return node;
        }

        if (showStudentView && data.entity === "topic" && data.topicId) {
          return {
            ...node,
            data: {
              ...data,
              onHintClick: () => {
                if (data.isDisabled) {
                  pushNotification(
                    "error",
                    "Тема пока закрыта. Сначала нужно набрать порог по предыдущим темам.",
                  );
                  return;
                }

                if (isTeacherReviewMode) {
                  setSelectedNodeId(`topic:${data.topicId}`);
                  setStudentTaskModalOpen(true);
                  return;
                }

                if (isStudentMode && trajectoryId) {
                  const trajectoryTopic = trajectory.topics.find(
                    (item) => item.topic_id === data.topicId,
                  );
                  if (studentIdFromQuery) {
                    localStorage.setItem("competence-hub:last-student-id", studentIdFromQuery);
                  }
                  navigate(`/learn/${trajectoryId}/step/${trajectoryTopic?.position ?? 1}`);
                  return;
                }

                setStudentView({ level: "elements", topicId: data.topicId! });
                setSelectedNodeId(`topic-focus:${data.topicId}`);
              },
            } satisfies SceneNodeData,
          };
        }

        if (!showStudentView && data.entity === "topic" && data.topicId) {
          return {
            ...node,
            data: {
              ...data,
              secondaryHint: "Элементы",
              onSecondaryHintClick: () => {
                setView({ level: "elements", topicId: data.topicId! });
                setSelectedNodeId(`topic-focus:${data.topicId}`);
              },
            } satisfies SceneNodeData,
          };
        }

        if (!showStudentView && data.entity === "topic-focus" && data.topicId) {
          return {
            ...node,
            data: {
              ...data,
              hint: "К темам",
              onHintClick: () => {
                setView({ level: "topics" });
                setSelectedNodeId(`topic:${data.topicId}`);
              },
            } satisfies SceneNodeData,
          };
        }

        return node;
      }),
    };

    return buildFocusedScene(actionScene, selectedNodeId);
  }, [
    elementById,
    graph,
    isStudentMode,
    isTeacherReviewMode,
    navigate,
    pushNotification,
    selectedNodeId,
    studentIdFromQuery,
    view,
    showStudentView,
    studentMasteryByElementId,
    studentView,
    topicOrder,
    trajectoryId,
    trajectory,
  ]);
  const graphNodeRuntimeState = useMemo<GraphNodeRuntimeState>(
    () => ({
      selectedNodeIds: hasConcreteNodeSelection(selectedNodeId)
        ? new Set<string>([selectedNodeId])
        : new Set<string>(),
      dimmedNodeIds,
      cardActionByNodeId: new Map(
        (scene?.nodes ?? []).map((node) => [
          node.id,
          () => {
            if (showStudentView) {
              if (node.id.startsWith("topic-focus:")) {
                const topicId = node.id.slice("topic-focus:".length);
                returnStudentToTopics(topicId);
                return;
              }

              if (isTeacherReviewMode && node.id.startsWith("topic:")) {
                setSelectedNodeId(node.id);
                setStudentTaskModalOpen(true);
                return;
              }

              setSelectedNodeId(node.id);
              return;
            }

            if (node.id.startsWith("topic-focus:")) {
              const topicId = node.id.slice("topic-focus:".length);
              setView({ level: "topics" });
              setSelectedNodeId(`topic:${topicId}`);
              return;
            }

            setSelectedNodeId(node.id);
          },
        ]),
      ),
    }),
    [dimmedNodeIds, isTeacherReviewMode, scene, selectedNodeId, showStudentView],
  );
  const detail: DetailCard | null =
    selectedNodeId === NO_NODE_SELECTION
      ? null
      : scene?.detailsByNodeId[selectedNodeId || scene?.defaultSelectedNodeId] ?? null;
  const canEditTrajectory = trajectory?.status === "draft" && trajectory.is_actual;
  const graphLayoutScopeType = isStudentMode
    ? "trajectory-student"
    : "trajectory-detail";
  const {
    layoutLoading,
    onCanvasDragEnd,
    onCanvasDragging,
    onNodeDragEnd,
    onNodeDragging,
    onZoomEnd,
  } = usePersistedGraphViewport({
    enabled: Boolean(trajectoryId),
    graphRef,
    scene,
    scopeId: trajectoryId,
    scopeType: graphLayoutScopeType,
  });

  const topicTrajectoryElements = useMemo(
    () => trajectoryElementsByTopicId.get(taskTopicId) ?? [],
    [taskTopicId, trajectoryElementsByTopicId],
  );
  const availablePrimaryElements = useMemo(
    () =>
      topicTrajectoryElements
        .filter((element) => element.competence_type === taskCompetenceTab)
        .sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [taskCompetenceTab, topicTrajectoryElements],
  );
  const availableTaskElements = useMemo(
    () =>
      availablePrimaryElements
        .filter(
          (element) =>
            element.id !== taskPrimaryElementId &&
            element.competence_type === "know",
        )
        .sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [availablePrimaryElements, taskPrimaryElementId],
  );
  const selectedPrimaryElement = useMemo(
    () => availablePrimaryElements.find((element) => element.id === taskPrimaryElementId) ?? null,
    [availablePrimaryElements, taskPrimaryElementId],
  );
  const selectedPrimaryOperation = useMemo(
    () =>
      operationContracts.find(
        (contract) => contract.id === (selectedPrimaryElement?.operation_ref ?? ""),
      ) ?? null,
    [operationContracts, selectedPrimaryElement],
  );
  const topicTrajectoryElementIds = useMemo(
    () => new Set(topicTrajectoryElements.map((element) => element.id)),
    [topicTrajectoryElements],
  );
  const mandatorySkillRelations = useMemo(() => {
    if (!graph || !taskTopicId || !taskPrimaryElementId) return [];
    return graph.knowledge_element_relations.filter((relation) => {
      const targetElement = elementById.get(relation.target_element_id);
      return (
        relation.topic_id === taskTopicId &&
        relation.source_element_id === taskPrimaryElementId &&
        relation.relation_type === "implements" &&
        targetElement?.competence_type === "know" &&
        topicTrajectoryElementIds.has(relation.target_element_id)
      );
    });
  }, [elementById, graph, taskPrimaryElementId, taskTopicId, topicTrajectoryElementIds]);
  const availableSkillKnowledgeElements = useMemo(
    () =>
      mandatorySkillRelations
        .map((relation) => elementById.get(relation.target_element_id))
        .filter((element): element is KnowledgeElement => Boolean(element))
        .sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [elementById, mandatorySkillRelations],
  );
  const optionalSkillRelations = useMemo(() => {
    if (!graph || !taskTopicId || !taskPrimaryElementId) return [];
    return graph.knowledge_element_relations.filter((relation) => {
      if (
        relation.topic_id !== taskTopicId ||
        relation.relation_type !== "implements" ||
        relation.source_element_id !== taskPrimaryElementId &&
          relation.target_element_id !== taskPrimaryElementId
      ) {
        return false;
      }
      const otherElementId =
        relation.source_element_id === taskPrimaryElementId
          ? relation.target_element_id
          : relation.source_element_id;
      return (
        topicTrajectoryElementIds.has(otherElementId) &&
        elementById.get(otherElementId)?.competence_type === "can"
      );
    });
  }, [elementById, graph, taskPrimaryElementId, taskTopicId, topicTrajectoryElementIds]);
  const mandatoryMasterSkillRelations = useMemo(() => {
    if (!graph || !taskTopicId || !taskPrimaryElementId) return [];
    return graph.knowledge_element_relations.filter((relation) => {
      const targetElement = elementById.get(relation.target_element_id);
      return (
        relation.topic_id === taskTopicId &&
        relation.source_element_id === taskPrimaryElementId &&
        relation.relation_type === "automates" &&
        targetElement?.competence_type === "can" &&
        topicTrajectoryElementIds.has(relation.target_element_id)
      );
    });
  }, [elementById, graph, taskPrimaryElementId, taskTopicId, topicTrajectoryElementIds]);
  const mandatoryMasterKnowledgeRelations = useMemo(() => {
    if (!graph || !taskTopicId || !taskPrimaryElementId) return [];
    return graph.knowledge_element_relations.filter((relation) => {
      const targetElement = elementById.get(relation.target_element_id);
      return (
        relation.topic_id === taskTopicId &&
        relation.source_element_id === taskPrimaryElementId &&
        relation.relation_type === "relies_on" &&
        targetElement?.competence_type === "know" &&
        topicTrajectoryElementIds.has(relation.target_element_id)
      );
    });
  }, [elementById, graph, taskPrimaryElementId, taskTopicId, topicTrajectoryElementIds]);
  const mandatoryMasterRelations = useMemo(
    () => [...mandatoryMasterSkillRelations, ...mandatoryMasterKnowledgeRelations],
    [mandatoryMasterKnowledgeRelations, mandatoryMasterSkillRelations],
  );
  const availableMasterSkillElements = useMemo(
    () =>
      mandatoryMasterSkillRelations
        .map((relation) => elementById.get(relation.target_element_id))
        .filter((element): element is KnowledgeElement => Boolean(element))
        .sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [elementById, mandatoryMasterSkillRelations],
  );
  const availableMasterKnowledgeElements = useMemo(
    () =>
      mandatoryMasterKnowledgeRelations
        .map((relation) => elementById.get(relation.target_element_id))
        .filter((element): element is KnowledgeElement => Boolean(element))
        .sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [elementById, mandatoryMasterKnowledgeRelations],
  );
  const optionalMasterRelations = useMemo(() => {
    if (!graph || !taskTopicId || !taskPrimaryElementId) return [];
    return graph.knowledge_element_relations.filter((relation) => {
      if (
        relation.topic_id !== taskTopicId ||
        relation.source_element_id !== taskPrimaryElementId &&
          relation.target_element_id !== taskPrimaryElementId
      ) {
        return false;
      }
      const otherElementId =
        relation.source_element_id === taskPrimaryElementId
          ? relation.target_element_id
          : relation.source_element_id;
      return (
        topicTrajectoryElementIds.has(otherElementId) &&
        elementById.get(otherElementId)?.competence_type === "master" &&
        relation.relation_type !== "implements"
      );
    });
  }, [elementById, graph, taskPrimaryElementId, taskTopicId, topicTrajectoryElementIds]);
  const relevantTaskElements = useMemo(
    () =>
      availableTaskElements.filter((element) =>
        isElementDirectlyRelated(graph, taskPrimaryElementId, element.id),
      ),
    [availableTaskElements, graph, taskPrimaryElementId],
  );
  const otherTaskElements = useMemo(
    () =>
      availableTaskElements.filter(
        (element) => !isElementDirectlyRelated(graph, taskPrimaryElementId, element.id),
      ),
    [availableTaskElements, graph, taskPrimaryElementId],
  );
  const availableKnowTemplateKinds = useMemo(
    () =>
      getAvailableKnowTemplateKinds(graph, taskPrimaryElementId, availableTaskElements),
    [availableTaskElements, graph, taskPrimaryElementId],
  );
  const selectedTaskElementIds = useMemo(() => {
    return new Set([taskPrimaryElementId, ...taskRelatedElementIds].filter(Boolean));
  }, [
    taskPrimaryElementId,
    taskRelatedElementIds,
  ]);
  const autoMultipleChoiceBuckets = useMemo(
    () =>
      buildAutoMultipleChoiceBuckets(
        graph,
        taskTemplateKind,
        taskPrimaryElementId,
        taskRelatedElementIds,
      ),
    [graph, taskPrimaryElementId, taskRelatedElementIds, taskTemplateKind],
  );
  const availableCheckedRelations = useMemo(() => {
    if (!graph || selectedTaskElementIds.size < 2) return [];
    return graph.knowledge_element_relations.filter(
      (relation) =>
        CHECKED_TASK_RELATION_LABELS[relation.relation_type] &&
        relation.relation_type !== "implements" &&
        selectedTaskElementIds.has(relation.source_element_id) &&
        selectedTaskElementIds.has(relation.target_element_id),
    );
  }, [graph, selectedTaskElementIds]);
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
  const pendingMasterReviewCount = useMemo(
    () =>
      studentTasks.filter(
        (task) => isManualMasterTask(task) && task.progress.status === "pending_review",
      ).length,
    [studentTasks],
  );
  const selectedTopicRecommendedTask = useMemo(() => {
    if (recommendedStudentTask?.topic_id === selectedTopicId) {
      return recommendedStudentTask;
    }
    if (isStudentMode) {
      return null;
    }
    return (
      selectedTopicStudentTasks.find((task) => task.progress.status !== "completed") ??
      selectedTopicStudentTasks[0] ??
      null
    );
  }, [isStudentMode, recommendedStudentTask, selectedTopicId, selectedTopicStudentTasks]);

  useEffect(() => {
    if (!isTeacherReviewMode || reviewModeFromQuery !== "master" || autoReviewFocusApplied) {
      return;
    }
    const firstPendingTask = studentTasks.find(
      (task) => isManualMasterTask(task) && task.progress.status === "pending_review",
    );
    if (!firstPendingTask) {
      setAutoReviewFocusApplied(true);
      return;
    }
    setSelectedNodeId(`topic:${firstPendingTask.topic_id}`);
    setStudentTaskModalOpen(true);
    setAutoReviewFocusApplied(true);
  }, [
    autoReviewFocusApplied,
    isTeacherReviewMode,
    reviewModeFromQuery,
    studentTasks,
  ]);
  const graphLoading = loading || layoutLoading || (showStudentView && studentDataLoading);
  const filteredTasks = useMemo(() => {
    const normalizedSearch = taskListSearch.trim().toLocaleLowerCase("ru");

    return tasks.filter((task) => {
      if (taskListTopicFilter !== "all" && task.topic_id !== taskListTopicFilter) {
        return false;
      }

      const competenceType =
        elementById.get(task.primary_element.element_id)?.competence_type ?? "know";
      if (!taskListCompetenceFilters[competenceType]) {
        return false;
      }

      if (!normalizedSearch) {
        return true;
      }

      const haystack = [
        task.title,
        task.prompt,
        task.topic_name,
        task.primary_element.name,
        ...(task.related_elements ?? []).map((element) => element.name),
        ...(task.checked_relations ?? []).map(
          (relation) =>
            `${relation.source_element_name} ${CHECKED_TASK_RELATION_LABELS[relation.relation_type] ?? relation.relation_type} ${relation.target_element_name}`,
        ),
      ]
        .join(" ")
        .toLocaleLowerCase("ru");

      return haystack.includes(normalizedSearch);
    });
  }, [elementById, taskListCompetenceFilters, taskListSearch, taskListTopicFilter, tasks]);
  const uncoveredTrajectoryElementsByTopic = useMemo(() => {
    if (!trajectory) return [];

    const coveredPrimaryElementIds = new Set(tasks.map((task) => task.primary_element.element_id));

    return trajectory.topics
      .map((trajectoryTopic) => {
        const uncoveredElements = trajectoryTopic.elements
          .map((trajectoryElement) => {
            const element = elementById.get(trajectoryElement.element_id);
            if (!element) return null;
            if (coveredPrimaryElementIds.has(element.id)) return null;
            return {
              id: element.id,
              name: element.name,
              competence_type: element.competence_type,
              threshold: trajectoryElement.threshold,
            };
          })
          .filter(
            (
              item,
            ): item is {
              id: string;
              name: string;
              competence_type: KnowledgeElement["competence_type"];
              threshold: number;
            } => Boolean(item),
          );

        if (!uncoveredElements.length) {
          return null;
        }

        return {
          topicId: trajectoryTopic.topic_id,
          topicName: topicName(topicById, trajectoryTopic.topic_id),
          elements: uncoveredElements.sort((left, right) => left.name.localeCompare(right.name, "ru")),
        };
      })
      .filter(
        (
          item,
        ): item is {
          topicId: string;
          topicName: string;
          elements: Array<{
            id: string;
            name: string;
            competence_type: KnowledgeElement["competence_type"];
            threshold: number;
          }>;
        } => Boolean(item),
      );
  }, [elementById, tasks, topicById, trajectory]);
  const uncoveredTrajectoryElementsCount = useMemo(
    () =>
      uncoveredTrajectoryElementsByTopic.reduce(
        (sum, topicGroup) => sum + topicGroup.elements.length,
        0,
      ),
    [uncoveredTrajectoryElementsByTopic],
  );

  function resetTaskTemplate(nextType: LearningTrajectoryTaskType = "single_choice") {
    setTaskType(nextType);
    setTaskOptions([createEmptyOption(true), createEmptyOption(false)]);
    setTaskMatchingPairs([createEmptyPair(), createEmptyPair()]);
    setTaskAcceptedAnswers([""]);
    setTaskTextPlaceholder("");
    setTaskSkillInputPayload({});
  }

  function resetTaskForm() {
    setEditingTaskId("");
    setTaskCompetenceTab("know");
    setTaskTemplateKind("definition_choice");
    setTaskTitle("");
    setTaskPrompt("");
    setTaskDifficulty(30);
    setTaskRelatedElementIds([]);
    setTaskCheckedRelationIds([]);
    setTaskSingleCorrectElementId("");
    setTaskMultipleCorrectRelatedElementIds([]);
    setTaskDistractorElementIds([]);
    setTaskPreviewOpen(false);
    resetTaskTemplate("single_choice");

    const firstTopicId = trajectory?.topics.find(
      (topic) => (trajectoryElementsByTopicId.get(topic.topic_id) ?? []).length > 0,
    )?.topic_id ?? "";
    setTaskTopicId(firstTopicId);

    const firstPrimaryElementId =
      (trajectoryElementsByTopicId.get(firstTopicId) ?? []).find(
        (element) => element.competence_type === "know",
      )?.id ?? "";
    setTaskPrimaryElementId(firstPrimaryElementId);
    setTaskSingleCorrectElementId(firstPrimaryElementId);
  }

  function buildTaskContentPayload(): LearningTrajectoryTaskContent {
    if (selectedPrimaryElement?.competence_type === "master") {
      return {
        placeholder: taskTextPlaceholder.trim(),
        manual_review: true,
        submission_kind: "file",
      };
    }

    if (taskType === "text") {
      return {
        input_payload: taskSkillInputPayload,
        placeholder: taskTextPlaceholder.trim(),
      };
    }

    if (taskTemplateKind !== "manual") {
      return {};
    }

    if (taskType === "single_choice") {
      return {
        correct_element_id: taskSingleCorrectElementId || taskPrimaryElementId,
      };
    }

    if (taskType === "multiple_choice") {
      return {
        correct_related_element_ids: taskMultipleCorrectRelatedElementIds,
        distractor_element_ids: taskRelatedElementIds.filter(
          (elementId) => !taskMultipleCorrectRelatedElementIds.includes(elementId),
        ),
      };
    }

    if (taskType === "matching") {
      return {};
    }

    if (taskType === "ordering") {
      return {
        correct_order_ids: [...taskRelatedElementIds, taskPrimaryElementId].filter(Boolean),
      };
    }

    return {};
  }

  function validateTaskTemplate() {
    if (selectedPrimaryElement?.competence_type === "master") {
      if (!mandatoryMasterSkillRelations.length) {
        return "У выбранного элемента «Владеть» нет обязательных связей «автоматизирует» с элементами «Уметь» в этой теме.";
      }
      if (!mandatoryMasterKnowledgeRelations.length) {
        return "У выбранного элемента «Владеть» нет обязательных связей «опирается на» с элементами «Знать» в этой теме.";
      }
      return "";
    }

    if (selectedPrimaryElement?.competence_type === "can") {
      if (!selectedPrimaryElement.operation_ref) {
        return "У выбранного элемента «Уметь» не задана операция алгоритмической библиотеки.";
      }
      if (!availableSkillKnowledgeElements.length) {
        return "У выбранного элемента «Уметь» нет связанных формируемых элементов «Знать» в этой теме.";
      }
      return validateOperationInput(selectedPrimaryOperation?.input_schema ?? null, taskSkillInputPayload);
    }

    if (taskType === "text") {
      return "Текстовый ответ сейчас используется только для заданий уровня «Уметь» и «Владеть».";
    }

    if (
      taskTemplateKind === "definition_choice" ||
      taskTemplateKind === "term_choice" ||
      taskTemplateKind === "matching_definition"
    ) {
      if (!taskRelatedElementIds.length) {
        return "Нужно выбрать минимум один дополнительный элемент темы.";
      }
      return "";
    }

    if (taskTemplateKind === "property_multiple" || taskTemplateKind === "contains_multiple") {
      if (taskRelatedElementIds.length < 2) {
        return "Для этого шаблона нужны минимум два дополнительных элемента темы.";
      }
      if (!autoMultipleChoiceBuckets.correctIds.length) {
        return "Среди выбранных элементов нет ни одного подходящего правильного варианта по связям графа.";
      }
      return "";
    }

    if (taskType === "single_choice") {
      if (!taskRelatedElementIds.length) {
        return "Для задания с одним выбором нужен минимум один дополнительный элемент темы.";
      }
      const allowedIds = new Set([taskPrimaryElementId, ...taskRelatedElementIds]);
      if (!allowedIds.has(taskSingleCorrectElementId || taskPrimaryElementId)) {
        return "Правильный вариант должен быть ключевым или выбранным элементом.";
      }
      return "";
    }

    if (taskType === "multiple_choice") {
      if (taskRelatedElementIds.length < 2) {
        return "Для задания с несколькими вариантами нужны минимум два выбранных элемента.";
      }
      if (!taskMultipleCorrectRelatedElementIds.length) {
        return "Нужно отметить хотя бы один правильный вариант.";
      }
      return "";
    }

    if (taskType === "matching") {
      if (!taskRelatedElementIds.length) {
        return "Для сопоставления нужен минимум один дополнительный элемент темы.";
      }
      return "";
    }

    return "Неподдерживаемый тип задания.";
  }

  useEffect(() => {
    if (!trajectory) return;
    if (editingTaskId) return;
    if (!taskTopicId) {
      resetTaskForm();
    }
  }, [editingTaskId, taskTopicId, trajectory, trajectoryElementsByTopicId]);

  useEffect(() => {
    const nextPrimaryElements = availablePrimaryElements;
    if (!nextPrimaryElements.length) {
      setTaskPrimaryElementId("");
      return;
    }
    if (!nextPrimaryElements.some((element) => element.id === taskPrimaryElementId)) {
      setTaskPrimaryElementId(nextPrimaryElements[0].id);
    }
  }, [availablePrimaryElements, taskPrimaryElementId]);

  useEffect(() => {
    const allowedIds = new Set(
      availableTaskElements
        .map((element) => element.id)
    );
    setTaskRelatedElementIds((current) => current.filter((elementId) => allowedIds.has(elementId)));
    setTaskMultipleCorrectRelatedElementIds((current) =>
      current.filter((elementId) => allowedIds.has(elementId)),
    );
    setTaskDistractorElementIds((current) => current.filter((elementId) => allowedIds.has(elementId)));
  }, [availableTaskElements]);

  useEffect(() => {
    const availableIds = new Set(availableCheckedRelations.map((relation) => relation.id));
    setTaskCheckedRelationIds((current) => current.filter((relationId) => availableIds.has(relationId)));
  }, [availableCheckedRelations]);

  useEffect(() => {
    if (taskCompetenceTab !== "know") {
      return;
    }
    if (availableKnowTemplateKinds.includes(taskTemplateKind)) {
      return;
    }

    const nextTemplateKind = availableKnowTemplateKinds[0] ?? "manual";
    setTaskTemplateKind(nextTemplateKind);
    setTaskPreviewOpen(false);
    resetTaskTemplate(TASK_TEMPLATE_TYPE[nextTemplateKind]);
    setTaskMultipleCorrectRelatedElementIds([]);
  }, [availableKnowTemplateKinds, taskCompetenceTab, taskTemplateKind]);

  useEffect(() => {
    const allowedIds = new Set([taskPrimaryElementId, ...taskRelatedElementIds]);
    if (!allowedIds.has(taskSingleCorrectElementId)) {
      setTaskSingleCorrectElementId(taskPrimaryElementId);
    }
  }, [taskPrimaryElementId, taskRelatedElementIds, taskSingleCorrectElementId]);

  useEffect(() => {
    if (selectedPrimaryElement?.competence_type !== "can") {
      return;
    }
    if (taskTemplateKind !== "manual") {
      setTaskTemplateKind("manual");
    }
    if (taskType !== "text") {
      setTaskType("text");
    }
  }, [selectedPrimaryElement, taskTemplateKind, taskType]);

  useEffect(() => {
    if (selectedPrimaryElement?.competence_type !== "can") {
      return;
    }
    const mandatoryRelationIds = mandatorySkillRelations.map((relation) => relation.id);
    const optionalRelationIds = new Set(optionalSkillRelations.map((relation) => relation.id));
    const selectedOptionalRelations = taskCheckedRelationIds.filter((relationId) =>
      optionalRelationIds.has(relationId),
    );
    const nextRelationIds = [...mandatoryRelationIds, ...selectedOptionalRelations];
    const nextIds = [
      ...mandatorySkillRelations.map((relation) => relation.target_element_id),
      ...optionalSkillRelations
        .filter((relation) => selectedOptionalRelations.includes(relation.id))
        .map((relation) =>
          relation.source_element_id === taskPrimaryElementId
            ? relation.target_element_id
            : relation.source_element_id,
        ),
    ];
    setTaskRelatedElementIds((current) =>
      current.length === nextIds.length && current.every((item, index) => item === nextIds[index])
        ? current
        : nextIds,
    );
    setTaskCheckedRelationIds((current) =>
      current.length === nextRelationIds.length &&
      current.every((item, index) => item === nextRelationIds[index])
        ? current
        : nextRelationIds,
    );
  }, [
    mandatorySkillRelations,
    optionalSkillRelations,
    selectedPrimaryElement,
    taskCheckedRelationIds,
    taskPrimaryElementId,
  ]);

  useEffect(() => {
    if (selectedPrimaryElement?.competence_type !== "master") {
      return;
    }
    const mandatoryRelationIds = mandatoryMasterRelations.map((relation) => relation.id);
    const optionalRelationIds = new Set(optionalMasterRelations.map((relation) => relation.id));
    const selectedOptionalRelations = taskCheckedRelationIds.filter((relationId) =>
      optionalRelationIds.has(relationId),
    );
    const nextRelationIds = [...mandatoryRelationIds, ...selectedOptionalRelations];
    const nextIds = [
      ...mandatoryMasterRelations.map((relation) => relation.target_element_id),
      ...optionalMasterRelations
        .filter((relation) => selectedOptionalRelations.includes(relation.id))
        .map((relation) =>
          relation.source_element_id === taskPrimaryElementId
            ? relation.target_element_id
            : relation.source_element_id,
        ),
    ];
    setTaskRelatedElementIds((current) =>
      current.length === nextIds.length && current.every((item, index) => item === nextIds[index])
        ? current
        : nextIds,
    );
    setTaskCheckedRelationIds((current) =>
      current.length === nextRelationIds.length &&
      current.every((item, index) => item === nextRelationIds[index])
        ? current
        : nextRelationIds,
    );
  }, [
    mandatoryMasterRelations,
    optionalMasterRelations,
    selectedPrimaryElement,
    taskCheckedRelationIds,
    taskPrimaryElementId,
  ]);

  useEffect(() => {
    if (selectedPrimaryElement?.competence_type !== "can" || !selectedPrimaryOperation) {
      return;
    }
    setTaskSkillInputPayload((current) =>
      Object.keys(current).length
        ? current
        : selectedPrimaryOperation.example_input ?? {},
    );
    setTaskTextPlaceholder((current) =>
      current.trim() ? current : "Введите ответ в формате JSON"
    );
  }, [selectedPrimaryElement, selectedPrimaryOperation]);

  useEffect(() => {
    if (selectedPrimaryElement?.competence_type !== "master") {
      return;
    }
    setTaskTextPlaceholder((current) =>
      current.trim() ? current : "Опиши решение и результат."
    );
  }, [selectedPrimaryElement]);

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

  function handleCanvasClick() {
    setSelectedNodeId(NO_NODE_SELECTION);
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
    setTaskPreviewOpen(false);
    setTasksModalSection("create");
    setTaskTopicId(task.topic_id);
    setTaskPrimaryElementId(task.primary_element.element_id);
    setTaskCompetenceTab(
      elementById.get(task.primary_element.element_id)?.competence_type ?? "know",
    );
    setTaskRelatedElementIds((task.related_elements ?? []).map((element) => element.element_id));
    setTaskCheckedRelationIds((task.checked_relations ?? []).map((relation) => relation.relation_id));
    setTaskSingleCorrectElementId(task.content.correct_element_id ?? task.primary_element.element_id);
    setTaskMultipleCorrectRelatedElementIds(task.content.correct_related_element_ids ?? []);
    setTaskDistractorElementIds(task.content.distractor_element_ids ?? []);
    setTaskTitle(task.title);
    setTaskPrompt(task.prompt);
    setTaskDifficulty(clampTaskDifficulty(task.difficulty));
    setTaskType(task.task_type);
    setTaskTemplateKind(task.template_kind);
    setTaskOptions(
      task.content.options?.length
        ? task.content.options
        : [createEmptyOption(true), createEmptyOption(false)],
    );
    setTaskMatchingPairs(
      task.content.pairs?.length ? task.content.pairs : [createEmptyPair(), createEmptyPair()],
    );
    setTaskAcceptedAnswers(task.content.accepted_answers?.length ? task.content.accepted_answers : [""]);
    setTaskTextPlaceholder(task.content.placeholder ?? "");
    setTaskSkillInputPayload(task.content.input_payload ?? {});
  }

  function toggleTaskRelatedElement(elementId: string) {
    setTaskRelatedElementIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
  }

  function toggleTaskCheckedRelation(relationId: string) {
    setTaskCheckedRelationIds((current) =>
      current.includes(relationId)
        ? current.filter((item) => item !== relationId)
        : [...current, relationId],
    );
  }

  function toggleSkillOptionalRelation(relationId: string) {
    const mandatoryRelationIds = new Set(mandatorySkillRelations.map((relation) => relation.id));
    if (mandatoryRelationIds.has(relationId)) return;
    toggleTaskCheckedRelation(relationId);
  }

  function toggleMasterOptionalRelation(relationId: string) {
    const mandatoryRelationIds = new Set(mandatoryMasterRelations.map((relation) => relation.id));
    if (mandatoryRelationIds.has(relationId)) return;
    toggleTaskCheckedRelation(relationId);
  }

  function handleTaskCompetenceTabChange(nextTab: TaskCompetenceTab) {
    setTaskCompetenceTab(nextTab);
    setTaskPreviewOpen(false);
    setTaskRelatedElementIds([]);
    setTaskCheckedRelationIds([]);
    setTaskSingleCorrectElementId("");
    setTaskMultipleCorrectRelatedElementIds([]);
    setTaskDistractorElementIds([]);

    if (nextTab === "can") {
      setTaskTemplateKind("manual");
      resetTaskTemplate("text");
      return;
    }

    if (nextTab === "know") {
      const nextTemplateKind = availableKnowTemplateKinds[0] ?? "manual";
      setTaskTemplateKind(nextTemplateKind);
      resetTaskTemplate(TASK_TEMPLATE_TYPE[nextTemplateKind]);
      return;
    }

    setTaskTemplateKind("manual");
    resetTaskTemplate("text");
  }

  function handleTaskTemplateKindChange(nextTemplateKind: LearningTrajectoryTaskTemplateKind) {
    setTaskTemplateKind(nextTemplateKind);
    setTaskPreviewOpen(false);
    resetTaskTemplate(TASK_TEMPLATE_TYPE[nextTemplateKind]);
    setTaskMultipleCorrectRelatedElementIds([]);
  }

  function toggleMultipleCorrectRelatedElement(elementId: string) {
    setTaskMultipleCorrectRelatedElementIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
    setTaskDistractorElementIds((current) => current.filter((item) => item !== elementId));
  }

  function toggleTaskDistractorElement(elementId: string) {
    setTaskDistractorElementIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
    setTaskMultipleCorrectRelatedElementIds((current) =>
      current.filter((item) => item !== elementId),
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
    if (!taskTopicId || !taskPrimaryElementId || !taskTitle.trim() || !taskPrompt.trim()) {
      pushNotification("error", "Для задания нужны тема, ключевой элемент, заголовок и текст задания.");
      return;
    }

    const templateError = validateTaskTemplate();
    if (templateError) {
      pushNotification("error", templateError);
      return;
    }

    try {
      setSaving(true);
      const normalizedTemplateKind =
        selectedPrimaryElement?.competence_type === "can" ||
        selectedPrimaryElement?.competence_type === "master"
          ? "manual"
          : taskTemplateKind;
      const normalizedTaskType =
        selectedPrimaryElement?.competence_type === "can" ||
        selectedPrimaryElement?.competence_type === "master"
          ? "text"
          : normalizedTemplateKind === "manual"
            ? taskType
            : TASK_TEMPLATE_TYPE[normalizedTemplateKind];
      const payload = {
        topic_id: taskTopicId,
        primary_element_id: taskPrimaryElementId,
        related_element_ids: taskRelatedElementIds,
        checked_relation_ids: taskCheckedRelationIds,
        title: taskTitle.trim(),
        prompt: taskPrompt.trim(),
        difficulty: clampTaskDifficulty(taskDifficulty),
        task_type: normalizedTaskType,
        template_kind: normalizedTemplateKind,
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

  function updateStudentOrderingAnswer(task: StudentAssignedTask, index: number, itemId: string) {
    const currentAnswer = studentTaskAnswers[task.id] ?? buildStudentTaskAnswerDraft(task);
    const currentOrder = Array.isArray(currentAnswer.ordered_item_ids)
      ? [...(currentAnswer.ordered_item_ids as string[])]
      : [];
    currentOrder[index] = itemId;
    updateStudentTaskAnswer(task.id, { ordered_item_ids: currentOrder });
  }

  function updateStudentTextAnswer(taskId: string, value: string) {
    updateStudentTaskAnswer(taskId, { text: value });
  }

  function updateStudentTaskFile(taskId: string, file: File | null) {
    setStudentTaskFiles((current) => ({ ...current, [taskId]: file }));
  }

  function updateTeacherReviewDraft(
    taskId: string,
    patch: Partial<{ score: number; reviewComment: string }>,
  ) {
    setTeacherReviewDrafts((current) => ({
      ...current,
      [taskId]: {
        score: current[taskId]?.score ?? 60,
        reviewComment: current[taskId]?.reviewComment ?? "",
        ...patch,
      },
    }));
  }

  async function handleDownloadStudentSubmission(task: StudentAssignedTask) {
    if (!studentIdFromQuery) return;
    try {
      const { blob, fileName } = await downloadStudentTaskSubmissionFile(task.id, studentIdFromQuery);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    }
  }

  async function handleTeacherReviewTask(task: StudentAssignedTask) {
    if (!studentIdFromQuery) return;
    const draft = teacherReviewDrafts[task.id] ?? { score: 60, reviewComment: "" };
    try {
      setSavingStudentTaskId(task.id);
      const updatedTask = await reviewStudentTaskSubmission(task.id, studentIdFromQuery, {
        score: draft.score,
        review_comment: draft.reviewComment,
      });
      setStudentTasks((current) =>
        current.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
      );
      if (recommendedStudentTask?.id === updatedTask.id) {
        setRecommendedStudentTask(updatedTask);
      }
      pushNotification("success", "Оценка сохранена.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setSavingStudentTaskId("");
    }
  }

  async function handleSubmitStudentTask(task: StudentAssignedTask) {
    if (!studentIdFromQuery) return;

    try {
      setSavingStudentTaskId(task.id);
      if (isManualMasterTask(task)) {
        const file = studentTaskFiles[task.id];
        if (!file) {
          pushNotification("error", "Сначала выбери файл с решением.");
          return;
        }
        const updatedTask = await submitStudentTaskFileSubmission(
          task.id,
          studentIdFromQuery,
          file,
          task.task_instance_id,
        );
        setStudentTasks((current) =>
          current.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
        );
        if (recommendedStudentTask?.id === updatedTask.id) {
          setRecommendedStudentTask(updatedTask);
        } else {
          const nextRecommendedTask = await fetchRecommendedStudentTask(
            studentIdFromQuery,
            undefined,
            resolvedDisciplineId || undefined,
            trajectoryId,
            selectedTopicId,
          );
          setRecommendedStudentTask(nextRecommendedTask);
        }
        setStudentTaskFiles((current) => ({ ...current, [task.id]: null }));
        const teacherName = task.teacher_name?.trim();
        pushNotification(
          "success",
          teacherName
            ? `Работа отправлена на проверку преподавателю: ${teacherName}.`
            : "Работа отправлена на проверку вашему преподавателю.",
        );
        return;
      }
      const rawAnswer = studentTaskAnswers[task.id] ?? buildStudentTaskAnswerDraft(task);
      const nextAnswer =
        task.task_type === "text" && hasStructuredOperationContent(task.content)
          ? {
              text: buildStructuredOperationAnswerText(rawAnswer, task.content),
            }
          : rawAnswer;
      const updatedTask = await submitStudentTaskScore(
        task.id,
        studentIdFromQuery,
        nextAnswer,
        task.task_instance_id,
      );
      setStudentTasks((current) =>
        current.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
      );
      const nextRecommendedTask = await fetchRecommendedStudentTask(
        studentIdFromQuery,
        undefined,
        resolvedDisciplineId || undefined,
        trajectoryId,
        selectedTopicId,
      );
      setRecommendedStudentTask(nextRecommendedTask);
      setStudentTaskAnswers((current) => ({
        ...current,
        [task.id]: buildStudentTaskAnswerDraft(updatedTask),
        ...(nextRecommendedTask
          ? { [nextRecommendedTask.id]: buildStudentTaskAnswerDraft(nextRecommendedTask) }
          : {}),
      }));
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setSavingStudentTaskId("");
    }
  }

  function renderStudentTaskAnswerEditor(task: StudentAssignedTask) {
    const answer = studentTaskAnswers[task.id] ?? buildStudentTaskAnswerDraft(task);

    if (task.task_type === "text") {
      return renderDetachedTextTaskAnswer(task, answer);
    }

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

    if (task.task_type === "ordering") {
      const orderedIds = Array.isArray(answer.ordered_item_ids)
        ? (answer.ordered_item_ids as string[])
        : [];
      const items = task.content.items ?? [];
      return (
        <div className="student-task-answer">
          {items.map((_, index) => (
            <label className="field" key={index}>
              <span>Позиция {index + 1}</span>
              <select
                value={orderedIds[index] ?? ""}
                onChange={(event) => updateStudentOrderingAnswer(task, index, event.target.value)}
              >
                <option value="">Выбери элемент</option>
                {items.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.text}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      );
    }

    return <p className="form-error">Неподдерживаемый тип задания.</p>;
  }

  function renderDetachedTextTaskAnswer(task: StudentAssignedTask, answer: Record<string, unknown>) {
    if (task.task_type === "text") {
      if (isManualMasterTask(task)) {
        const submittedFile = extractSubmittedFileMeta(task);
        const selectedFile = studentTaskFiles[task.id];
        return (
          <div className="student-task-answer">
            <div className="teacher-review-checklist">
              <div className="teacher-review-checklist__section">
                <span className="card__eyebrow">Предметная область</span>
                <p>{task.content.manual_review_context?.subject_area_description || "Не заполнена."}</p>
              </div>
            </div>
            <label className="field">
              <span>Файл решения</span>
              <input
                type="file"
                disabled={savingStudentTaskId === task.id || task.progress.status === "pending_review"}
                onChange={(event) =>
                  updateStudentTaskFile(task.id, event.target.files?.[0] ?? null)
                }
              />
            </label>
            {selectedFile ? (
              <p className="card__text">Выбран файл: {selectedFile.name}</p>
            ) : null}
            {submittedFile?.originalName ? (
              <p className="card__text">
                Последняя отправка: {submittedFile.originalName}
                {task.progress.status === "pending_review" ? " · ждёт проверки" : ""}
              </p>
            ) : null}
          </div>
        );
      }
      const hasStructuredContent = hasStructuredOperationContent(task.content);
      const answerText = buildStructuredOperationAnswerText(answer, task.content);
      return (
        <div className="student-task-answer">
          {task.content.contract_title ? (
            <p className="card__text">Операция: {task.content.contract_title}</p>
          ) : null}
          <OperationInputPreview payload={task.content.input_payload} schema={task.content.input_schema} />
          {hasStructuredContent ? <OperationOutputPreview content={task.content} /> : null}
          {hasStructuredContent ? (
            <OperationAnswerEditor
              disabled={savingStudentTaskId === task.id}
              inputPayload={task.content.input_payload}
              onChangeText={(value) => updateStudentTextAnswer(task.id, value)}
              schema={task.content.output_schema}
              valueText={answerText}
            />
          ) : null}
          {hasStructuredContent ? (
            <textarea
              className="visually-hidden"
              aria-hidden="true"
              disabled
              rows={6}
              value={answerText}
              onChange={() => undefined}
              placeholder={task.content.placeholder ?? "Введите ответ"}
            />
          ) : (
            <label className="field">
              <span>Ответ студента</span>
              <textarea
                rows={6}
                value={String(answer.text ?? "")}
                onChange={(event) => updateStudentTextAnswer(task.id, event.target.value)}
                placeholder={task.content.placeholder ?? "Введите ответ"}
              />
            </label>
          )}
        </div>
      );
    }
    return null;
  }

  function renderTeacherManualReview(task: StudentAssignedTask) {
    if (!isManualMasterTask(task) || !studentIdFromQuery) {
      return null;
    }

    const reviewContext = task.content.manual_review_context;
    const reviewDraft = teacherReviewDrafts[task.id] ?? { score: 60, reviewComment: "" };
    const submittedFile = extractSubmittedFileMeta(task);

    return (
      <div className="teacher-review-card">
        <div className="teacher-review-card__header">
          <strong>Ручная проверка преподавателем</strong>
          <span className="hero__chip">{studentTaskProgressLabel(task.progress.status)}</span>
        </div>

        {submittedFile?.originalName ? (
          <div className="teacher-review-card__actions">
            <button
              className="secondary-button"
              type="button"
              onClick={() => void handleDownloadStudentSubmission(task)}
            >
              Скачать файл
            </button>
            <span className="card__text">{submittedFile.originalName}</span>
          </div>
        ) : (
          <p className="card__text">Студент ещё не отправил файл по этому заданию.</p>
        )}

        {reviewContext ? (
          <div className="teacher-review-checklist">
            <div className="teacher-review-checklist__section">
              <span className="card__eyebrow">Предметная область</span>
              <p>{reviewContext.subject_area_description || "Не заполнена."}</p>
            </div>
            <div className="teacher-review-checklist__section">
              <span className="card__eyebrow">Элемент «Уметь»</span>
              {(reviewContext.skill_elements ?? []).length ? (
                (reviewContext.skill_elements ?? []).map((item) => (
                  <div className="teacher-review-checklist__item" key={item.element_id}>
                    <strong>{item.name}</strong>
                    <span>{item.description || "Описание не добавлено."}</span>
                  </div>
                ))
              ) : (
                <p>Не найден.</p>
              )}
            </div>
            <div className="teacher-review-checklist__section">
              <span className="card__eyebrow">Связанные элементы «Знать»</span>
              {(reviewContext.knowledge_elements ?? []).length ? (
                (reviewContext.knowledge_elements ?? []).map((item) => (
                  <div className="teacher-review-checklist__item" key={item.element_id}>
                    <strong>{item.name}</strong>
                    <span>{item.description || "Описание не добавлено."}</span>
                  </div>
                ))
              ) : (
                <p>Не найдены.</p>
              )}
            </div>
            <div className="teacher-review-checklist__section">
              <span className="card__eyebrow">Сопоставления объект → «Знать»</span>
              {(reviewContext.domain_object_mappings ?? []).length ? (
                (reviewContext.domain_object_mappings ?? []).map((item, index) => (
                  <div className="teacher-review-checklist__item" key={`${item.object_name}-${index}`}>
                    <strong>{item.object_name}</strong>
                    <span>
                      {item.knowledge_element_name}
                      {item.knowledge_element_description
                        ? ` — ${item.knowledge_element_description}`
                        : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p>Сопоставления не найдены.</p>
              )}
            </div>
          </div>
        ) : null}

        <div className="teacher-review-form">
          <label className="field">
            <span>Оценка</span>
            <input
              type="number"
              min={0}
              max={100}
              value={reviewDraft.score}
              onChange={(event) =>
                updateTeacherReviewDraft(task.id, {
                  score: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                })
              }
            />
          </label>
          <label className="field">
            <span>Комментарий преподавателя</span>
            <textarea
              rows={4}
              value={reviewDraft.reviewComment}
              onChange={(event) =>
                updateTeacherReviewDraft(task.id, { reviewComment: event.target.value })
              }
              placeholder="Кратко отметь сильные стороны, ошибки и что стоит доработать."
            />
          </label>
        </div>

        {task.progress.last_feedback?.review_comment ? (
          <div className="student-task-card__feedback">
            {String(task.progress.last_feedback.review_comment)}
          </div>
        ) : null}

        <div className="teacher-review-card__actions">
          <button
            className="primary-button"
            type="button"
            disabled={!submittedFile || savingStudentTaskId === task.id}
            onClick={() => void handleTeacherReviewTask(task)}
          >
            {savingStudentTaskId === task.id ? "Сохраняю..." : "Сохранить оценку"}
          </button>
        </div>
      </div>
    );
  }

  function toggleTaskListCompetenceFilter(type: KnowledgeElement["competence_type"]) {
    setTaskListCompetenceFilters((current) => ({ ...current, [type]: !current[type] }));
  }

  function renderTaskDraftPreview() {
    return (
      <div className="trajectory-task-preview trajectory-task-preview--student">
        <div className="trajectory-task-preview__header">
          <div>
            <strong>Предпросмотр глазами студента</strong>
            <p>{taskTitle || "Заголовок задания"}</p>
          </div>
          <span className="hero__chip">
            {TASK_TYPE_LABELS[taskTemplateKind === "manual" ? taskType : TASK_TEMPLATE_TYPE[taskTemplateKind]]}
          </span>
        </div>
        <span>{taskPrompt || "Текст задания"}</span>

        {(taskTemplateKind === "definition_choice" ||
          taskTemplateKind === "term_choice" ||
          (taskTemplateKind === "manual" && taskType === "single_choice")) ? (
          <div className="trajectory-task-preview__list">
            {[taskPrimaryElementId, ...taskRelatedElementIds].filter(Boolean).map((elementId) => {
              const element = elementById.get(elementId);
              const optionText =
                taskTemplateKind === "definition_choice"
                  ? element?.description || element?.name || "Определение"
                  : element?.name || "Элемент";
              const isCorrect =
                elementId ===
                (taskTemplateKind === "manual"
                  ? taskSingleCorrectElementId || taskPrimaryElementId
                  : taskPrimaryElementId);
              return (
                <div className="trajectory-task-preview__row" key={elementId}>
                  <span className="trajectory-task-preview__marker" />
                  <span>{optionText}</span>
                  {isCorrect ? (
                    <span className="trajectory-task-preview__answer-tag">Правильный вариант</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {(taskTemplateKind === "property_multiple" ||
          taskTemplateKind === "contains_multiple" ||
          (taskTemplateKind === "manual" && taskType === "multiple_choice")) ? (
          <div className="trajectory-task-preview__list">
            {taskRelatedElementIds.map((elementId) => {
              const isCorrect =
                taskTemplateKind === "manual"
                  ? taskMultipleCorrectRelatedElementIds.includes(elementId)
                  : autoMultipleChoiceBuckets.correctIds.includes(elementId);
              return (
                <div className="trajectory-task-preview__row" key={elementId}>
                  <span className="trajectory-task-preview__marker trajectory-task-preview__marker--check" />
                  <span>{elementName(elementById, elementId)}</span>
                  {isCorrect ? (
                    <span className="trajectory-task-preview__answer-tag">Правильный вариант</span>
                  ) : null}
                </div>
              );
            })}
          </div>
        ) : null}

        {(taskTemplateKind === "matching_definition" ||
          (taskTemplateKind === "manual" && taskType === "matching")) ? (
          <div className="trajectory-task-preview__pairs">
            {[taskPrimaryElementId, ...taskRelatedElementIds].filter(Boolean).map((elementId) => {
              const element = elementById.get(elementId);
              return (
                <div className="trajectory-task-preview__pair" key={elementId}>
                  <strong>{element?.name ?? "Элемент"}</strong>
                  <span>{element?.description || element?.name || "Описание"}</span>
                </div>
              );
            })}
          </div>
        ) : null}

        {(taskCompetenceTab === "can" || taskTemplateKind === "text_definition") && selectedPrimaryOperation ? (
          <>
            <OperationInputPreview
              payload={taskSkillInputPayload}
              schema={selectedPrimaryOperation.input_schema}
            />
            <OperationOutputPreview
              content={{
                input_payload: taskSkillInputPayload,
                output_schema: selectedPrimaryOperation.output_schema,
              }}
            />
          </>
        ) : null}

        {taskCheckedRelationIds.length ? (
          <div className="trajectory-task-preview__relations">
            <strong>Проверяемые связи</strong>
            <div className="trajectory-task-preview__items">
              {availableCheckedRelations
                .filter((relation) => taskCheckedRelationIds.includes(relation.id))
                .map((relation) => (
                  <span className="trajectory-task-preview__item" key={relation.id}>
                    {checkedRelationLabel(relation, elementById)}
                  </span>
                ))}
            </div>
          </div>
        ) : null}
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
              Версия графа: {trajectory.graph_version}
              {graph ? ` / текущая ${graph.discipline.knowledge_graph_version}` : ""}
            </span>
            <span>{trajectory.is_actual ? "Актуальна" : "Устарела"}</span>
          </div>
        ) : null}

        {!canEditTrajectory && trajectory ? (
          <p className="card__text">
            Изменение порядка заблокировано: траектория должна быть черновиком и
            соответствовать текущей версии графа знаний.
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
                      <span>{trajectoryTopic?.elements?.length ?? 0} элементов</span>
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

        <details className="editor-block trajectory-task-coverage">
          <summary>
            Непокрытые элементы траектории
            {uncoveredTrajectoryElementsCount ? ` (${uncoveredTrajectoryElementsCount})` : " (0)"}
          </summary>
          <div className="editor-form">
            {uncoveredTrajectoryElementsByTopic.length ? (
              <div className="trajectory-task-coverage__topics">
                {uncoveredTrajectoryElementsByTopic.map((topicGroup) => (
                  <div className="trajectory-task-coverage__topic" key={topicGroup.topicId}>
                    <strong>{topicGroup.topicName}</strong>
                    <div className="trajectory-task-coverage__items">
                      {topicGroup.elements.map((element) => (
                        <span className="trajectory-task-preview__item" key={element.id}>
                          {element.name} · {competenceLabel(element.competence_type)} · порог {element.threshold}
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="card__text">Все элементы траектории уже покрыты заданиями.</p>
            )}
          </div>
        </details>

        {tasksModalSection === "create" ? (
          <>
            {allTrajectoryPrimaryElements.length ? (
              <div className="trajectory-task-editor">
                <div className="editor-tabs trajectory-task-competence-tabs">
                  {TASK_COMPETENCE_TABS.map((tab) => (
                    <button
                      className={`editor-tab ${taskCompetenceTab === tab.value ? "editor-tab--active" : ""}`}
                      key={tab.value}
                      onClick={() => handleTaskCompetenceTabChange(tab.value)}
                      type="button"
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                <section className="trajectory-task-step">
                  <div className="trajectory-task-step__header">
                    <span className="trajectory-task-step__eyebrow">Шаг 1</span>
                    <strong>Тема и ключевой элемент</strong>
                  </div>
                <div className="trajectory-task-editor__grid trajectory-task-editor__grid--two">
                  <label className="field">
                    <span>Тема траектории</span>
                    <select value={taskTopicId} onChange={(event) => setTaskTopicId(event.target.value)} disabled={saving}>
                      {trajectory?.topics
                        .filter((topic) => (trajectoryElementsByTopicId.get(topic.topic_id) ?? []).length > 0)
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
                  {taskCompetenceTab === "know" ? (
                    <label className="field trajectory-task-editor__field--template">
                      <span>Шаблон задания</span>
                      <select
                        value={taskTemplateKind}
                        onChange={(event) =>
                          handleTaskTemplateKindChange(event.target.value as LearningTrajectoryTaskTemplateKind)
                        }
                        disabled={saving}
                      >
                        {availableKnowTemplateKinds.map((value) => (
                          <option key={value} value={value}>
                            {TASK_TEMPLATE_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : null}
                </div>
                </section>

                <section className="trajectory-task-step">
                  <div className="trajectory-task-step__header">
                    <span className="trajectory-task-step__eyebrow">Шаг 2</span>
                    <strong>Формулировка задания</strong>
                  </div>
                <div className="trajectory-task-editor__grid">
                  {taskCompetenceTab === "know" ? (
                    <label className="field trajectory-task-editor__field--task-type">
                      <span>Тип задания</span>
                      {taskTemplateKind === "manual" ? (
                        <select
                          value={taskType}
                          onChange={(event) => resetTaskTemplate(event.target.value as LearningTrajectoryTaskType)}
                          disabled={saving}
                        >
                          {MANUAL_TASK_TYPE_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {TASK_TYPE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={TASK_TYPE_LABELS[TASK_TEMPLATE_TYPE[taskTemplateKind]]}
                          disabled
                          readOnly
                        />
                      )}
                    </label>
                  ) : null}
                  <label className="field">
                    <span>Заголовок задания</span>
                    <input
                      value={taskTitle}
                      onChange={(event) => setTaskTitle(event.target.value)}
                      placeholder="Например: Определение базового понятия"
                      disabled={saving}
                    />
                  </label>
                  <label className="field trajectory-task-editor__field--difficulty-inline">
                    <span>Сложность</span>
                    <input
                      min={TASK_DIFFICULTY_MIN}
                      max={TASK_DIFFICULTY_MAX}
                      step={1}
                      type="number"
                      value={taskDifficulty}
                      onChange={(event) =>
                        setTaskDifficulty(clampTaskDifficulty(Number(event.target.value)))
                      }
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
                </section>
                <section className="trajectory-task-step">
                  <div className="trajectory-task-step__header">
                    <span className="trajectory-task-step__eyebrow">Шаг 3</span>
                    <strong>Параметры по типу компетенции</strong>
                  </div>
                {taskCompetenceTab === "know" ? (
                  <div className="trajectory-task-editor__grid trajectory-task-editor__grid--two">
                    <label className="field">
                      <span>Шаблон задания</span>
                      <select
                        value={taskTemplateKind}
                        onChange={(event) =>
                          handleTaskTemplateKindChange(event.target.value as LearningTrajectoryTaskTemplateKind)
                        }
                        disabled={saving}
                      >
                        {availableKnowTemplateKinds.map((value) => (
                          <option key={value} value={value}>
                            {TASK_TEMPLATE_LABELS[value]}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="field">
                      <span>Тип задания</span>
                      {taskTemplateKind === "manual" ? (
                        <select
                          value={taskType}
                          onChange={(event) => resetTaskTemplate(event.target.value as LearningTrajectoryTaskType)}
                          disabled={saving}
                        >
                          {MANUAL_TASK_TYPE_OPTIONS.map((value) => (
                            <option key={value} value={value}>
                              {TASK_TYPE_LABELS[value]}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          value={TASK_TYPE_LABELS[TASK_TEMPLATE_TYPE[taskTemplateKind]]}
                          disabled
                          readOnly
                        />
                      )}
                    </label>
                  </div>
                ) : null}
                {taskCompetenceTab === "can" ? (
                  <div className="trajectory-task-related">
                    <strong>Настройка задания уровня «Уметь»</strong>
                    {!availablePrimaryElements.length ? (
                      <p className="form-error">
                        В выбранной теме траектории пока нет элементов «Уметь».
                      </p>
                    ) : selectedPrimaryOperation ? (
                      <p className="card__text">Операция: {selectedPrimaryOperation.title}</p>
                    ) : (
                      <p className="form-error">У выбранного элемента «Уметь» не найдена операция алгоритмической библиотеки.</p>
                    )}
                    <div className="trajectory-task-related">
                      <strong>Входные значения</strong>
                      {selectedPrimaryOperation ? (
                        <OperationInputEditor
                          disabled={saving}
                          onChange={setTaskSkillInputPayload}
                          schema={selectedPrimaryOperation.input_schema}
                          value={taskSkillInputPayload}
                        />
                      ) : null}
                    </div>
                    <label className="field">
                      <span>Подсказка в поле ответа</span>
                      <input
                        value={taskTextPlaceholder}
                        onChange={(event) => setTaskTextPlaceholder(event.target.value)}
                        placeholder="Например: Введите ответ в формате JSON"
                        disabled={saving}
                      />
                    </label>
                    <div className="trajectory-task-preview__items">
                      {availableSkillKnowledgeElements.map((element) => (
                        <span className="trajectory-task-preview__item trajectory-task-preview__item--correct" key={element.id}>
                          {element.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}
                {taskCompetenceTab === "master" ? (
                  <div className="trajectory-task-related">
                    <strong>Настройка задания уровня «Владеть»</strong>
                    <label className="field">
                      <span>Подсказка в поле ответа</span>
                      <input
                        value={taskTextPlaceholder}
                        onChange={(event) => setTaskTextPlaceholder(event.target.value)}
                        placeholder="Например: Опиши решение и результат"
                        disabled={saving}
                      />
                    </label>
                    <strong>Обязательные элементы «Уметь»</strong>
                    <div className="trajectory-task-preview__items">
                      {availableMasterSkillElements.length ? (
                        availableMasterSkillElements.map((element) => (
                          <span className="trajectory-task-preview__item trajectory-task-preview__item--correct" key={`master-skill-${element.id}`}>
                            {element.name}
                          </span>
                        ))
                      ) : (
                        <p className="card__text">
                          Для выбранного элемента пока не найдено обязательных связей «автоматизирует» с элементами «Уметь».
                        </p>
                      )}
                    </div>
                    <strong>Обязательные элементы «Знать»</strong>
                    <div className="trajectory-task-preview__items">
                      {availableMasterKnowledgeElements.length ? (
                        availableMasterKnowledgeElements.map((element) => (
                          <span className="trajectory-task-preview__item trajectory-task-preview__item--correct" key={`master-know-${element.id}`}>
                            {element.name}
                          </span>
                        ))
                      ) : (
                        <p className="card__text">
                          Для выбранного элемента пока не найдено обязательных связей «опирается на» с элементами «Знать».
                        </p>
                      )}
                    </div>
                  </div>
                ) : null}
                </section>

                <section className="trajectory-task-step">
                  <div className="trajectory-task-step__header">
                    <span className="trajectory-task-step__eyebrow">Шаг 4</span>
                    <strong>Связанные элементы и связи</strong>
                  </div>
                {taskCompetenceTab === "know" ? (
                  <div className="trajectory-task-related">
                  <strong>Релевантные связанные элементы</strong>
                  <div className="trajectory-task-related__list">
                    {relevantTaskElements.length ? (
                      relevantTaskElements.map((element) => (
                        <label className="trajectory-task-related__item" key={element.id}>
                          <input
                            type="checkbox"
                            checked={taskRelatedElementIds.includes(element.id)}
                            onChange={() => toggleTaskRelatedElement(element.id)}
                            disabled={saving}
                          />
                          <span>
                            <strong>{element.name}</strong>
                            {templateUsesDefinitions(taskTemplateKind) && element.description ? (
                              <> · {element.description}</>
                            ) : null}
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="card__text">Для ключевого элемента пока не найдено прямых связей внутри этой темы.</p>
                    )}
                  </div>

                  <strong>Другие элементы темы</strong>
                  <div className="trajectory-task-related__list">
                    {otherTaskElements.length ? (
                      otherTaskElements.map((element) => (
                        <label className="trajectory-task-related__item" key={element.id}>
                          <input
                            type="checkbox"
                            checked={taskRelatedElementIds.includes(element.id)}
                            onChange={() => toggleTaskRelatedElement(element.id)}
                            disabled={saving}
                          />
                          <span>
                            <strong>{element.name}</strong>
                            {templateUsesDefinitions(taskTemplateKind) && element.description ? (
                              <> · {element.description}</>
                            ) : null}
                          </span>
                        </label>
                      ))
                    ) : (
                      <p className="card__text">Других элементов в этой теме нет.</p>
                    )}
                  </div>
                  </div>
                ) : null}

                {taskCompetenceTab === "know" && taskTemplateKind === "manual" && taskType === "single_choice" ? (
                  <div className="trajectory-task-related">
                    <strong>Правильный вариант</strong>
                    <label className="field">
                      <span>Выбери элемент, который будет правильным ответом</span>
                      <select
                        value={taskSingleCorrectElementId || taskPrimaryElementId}
                        onChange={(event) => setTaskSingleCorrectElementId(event.target.value)}
                        disabled={saving}
                      >
                        {[taskPrimaryElementId, ...taskRelatedElementIds].filter(Boolean).map((elementId) => (
                          <option key={elementId} value={elementId}>
                            {elementName(elementById, elementId)}
                          </option>
                        ))}
                      </select>
                    </label>
                  </div>
                ) : null}

                {taskCompetenceTab === "know" && taskTemplateKind === "manual" && taskType === "multiple_choice" ? (
                  <div className="trajectory-task-related">
                    <strong>Правильные варианты</strong>
                    <div className="trajectory-task-related__list">
                      {taskRelatedElementIds.length ? (
                        taskRelatedElementIds.map((elementId) => (
                          <label className="trajectory-task-related__item" key={elementId}>
                            <input
                              type="checkbox"
                              checked={taskMultipleCorrectRelatedElementIds.includes(elementId)}
                              onChange={() => toggleMultipleCorrectRelatedElement(elementId)}
                              disabled={saving}
                            />
                            <span>{elementName(elementById, elementId)}</span>
                          </label>
                        ))
                      ) : (
                        <p className="card__text">Сначала выбери элементы темы для вариантов ответа.</p>
                      )}
                    </div>
                  </div>
                ) : null}

                {taskCompetenceTab === "know" && (taskTemplateKind === "property_multiple" || taskTemplateKind === "contains_multiple") ? (
                  <div className="trajectory-task-related">
                    <strong>Автоматическое определение правильных вариантов</strong>
                    <div className="trajectory-task-preview__items">
                      {autoMultipleChoiceBuckets.correctIds.map((elementId) => (
                        <span className="trajectory-task-preview__item trajectory-task-preview__item--correct" key={`auto-correct-${elementId}`}>
                          {elementName(elementById, elementId)}
                        </span>
                      ))}
                      {autoMultipleChoiceBuckets.distractorIds.map((elementId) => (
                        <span className="trajectory-task-preview__item" key={`auto-distractor-${elementId}`}>
                          {elementName(elementById, elementId)}
                        </span>
                      ))}
                    </div>
                  </div>
                ) : null}

                {taskCompetenceTab === "know" ? (
                  <div className="trajectory-task-related">
                    <strong>Проверяемые связи</strong>
                    {availableCheckedRelations.length ? (
                      <div className="trajectory-task-related__list">
                        {availableCheckedRelations.map((relation) => (
                          <label className="trajectory-task-related__item" key={relation.id}>
                            <input
                              type="checkbox"
                              checked={taskCheckedRelationIds.includes(relation.id)}
                              onChange={() => toggleTaskCheckedRelation(relation.id)}
                              disabled={saving}
                            />
                            <span>{checkedRelationLabel(relation, elementById)}</span>
                          </label>
                        ))}
                      </div>
                    ) : (
                      <p className="card__text">
                        Для выбранных элементов пока нет связей, которые можно зафиксировать в задании.
                      </p>
                    )}
                  </div>
                ) : null}

                {taskCompetenceTab === "can" ? (
                  <div className="trajectory-task-related">
                    <strong>Проверяемые связи</strong>
                    <div className="trajectory-task-related__list">
                      {mandatorySkillRelations.map((relation) => (
                        <label className="trajectory-task-related__item" key={relation.id}>
                          <input checked disabled type="checkbox" />
                          <span>{checkedRelationLabel(relation, elementById)}</span>
                        </label>
                      ))}
                    </div>
                    {optionalSkillRelations.length ? (
                      <>
                        <strong>Дополнительные связи с «Уметь»</strong>
                        <div className="trajectory-task-related__list">
                          {optionalSkillRelations.map((relation) => (
                            <label className="trajectory-task-related__item" key={relation.id}>
                              <input
                                checked={taskCheckedRelationIds.includes(relation.id)}
                                disabled={saving}
                                onChange={() => toggleSkillOptionalRelation(relation.id)}
                                type="checkbox"
                              />
                              <span>{checkedRelationLabel(relation, elementById)}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="card__text">
                        У выбранного элемента пока нет дополнительных связей с другими элементами «Уметь» этой темы.
                      </p>
                    )}
                  </div>
                ) : null}
                {taskCompetenceTab === "master" ? (
                  <div className="trajectory-task-related">
                    <strong>Проверяемые связи</strong>
                    <div className="trajectory-task-related__list">
                      {mandatoryMasterRelations.map((relation) => (
                        <label className="trajectory-task-related__item" key={`master-mandatory-${relation.id}`}>
                          <input checked disabled type="checkbox" />
                          <span>{checkedRelationLabel(relation, elementById)}</span>
                        </label>
                      ))}
                    </div>
                    {optionalMasterRelations.length ? (
                      <>
                        <strong>Дополнительные связи с «Владеть»</strong>
                        <div className="trajectory-task-related__list">
                          {optionalMasterRelations.map((relation) => (
                            <label className="trajectory-task-related__item" key={`master-optional-${relation.id}`}>
                              <input
                                checked={taskCheckedRelationIds.includes(relation.id)}
                                disabled={saving}
                                onChange={() => toggleMasterOptionalRelation(relation.id)}
                                type="checkbox"
                              />
                              <span>{checkedRelationLabel(relation, elementById)}</span>
                            </label>
                          ))}
                        </div>
                      </>
                    ) : (
                      <p className="card__text">
                        У выбранного элемента пока нет дополнительных связей с другими элементами «Владеть» этой темы.
                      </p>
                    )}
                  </div>
                ) : null}
                </section>
                <section className="trajectory-task-step">
                  <div className="trajectory-task-step__header">
                    <span className="trajectory-task-step__eyebrow">Шаг 5</span>
                    <strong>Сложность</strong>
                  </div>
                  <div className="trajectory-task-editor__grid trajectory-task-editor__grid--single-two">
                    <label className="field">
                      <span>Диапазон сложности от 0 до 100</span>
                      <input
                        min={TASK_DIFFICULTY_MIN}
                        max={TASK_DIFFICULTY_MAX}
                        step={1}
                        type="number"
                        value={taskDifficulty}
                        onChange={(event) =>
                          setTaskDifficulty(clampTaskDifficulty(Number(event.target.value)))
                        }
                        disabled={saving}
                      />
                    </label>
                  </div>
                </section>
                <div className="trajectory-task-editor__actions">
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={!taskTopicId || !taskPrimaryElementId || !taskTitle.trim() || !taskPrompt.trim()}
                    onClick={() => setTaskPreviewOpen((current) => !current)}
                  >
                    {taskPreviewOpen ? "Скрыть предпросмотр" : "Предпросмотр"}
                  </button>
                  <button className="primary-button" type="button" disabled={saving || !taskTopicId || !taskPrimaryElementId || !taskTitle.trim() || !taskPrompt.trim()} onClick={() => void handleSaveTask()}>
                    {editingTaskId ? "Сохранить задание" : "Добавить задание"}
                  </button>
                  {editingTaskId ? (
                    <button className="ghost-button" type="button" disabled={saving} onClick={resetTaskForm}>
                      Сбросить редактирование
                    </button>
                  ) : null}
                </div>
                {taskPreviewOpen ? renderTaskDraftPreview() : null}
              </div>
            ) : (
              <p className="card__text">В этой траектории пока нет выбранных элементов «Знать».</p>
            )}
          </>
        ) : (
          <div className="trajectory-task-list">
            <div className="trajectory-task-filters">
              <label className="field">
                <span>Поиск</span>
                <input
                  value={taskListSearch}
                  onChange={(event) => setTaskListSearch(event.target.value)}
                  placeholder="Название, текст, тема, элемент"
                  type="search"
                />
              </label>
              <label className="field">
                <span>Тема</span>
                <select
                  value={taskListTopicFilter}
                  onChange={(event) => setTaskListTopicFilter(event.target.value)}
                >
                  <option value="all">Все темы</option>
                  {trajectory?.topics.map((topic) => (
                    <option key={topic.topic_id} value={topic.topic_id}>
                      {topicName(topicById, topic.topic_id)}
                    </option>
                  ))}
                </select>
              </label>
              <div className="trajectory-task-filters__competence">
                <span>Компетенция</span>
                <div className="competence-filter">
                  {(["know", "can", "master"] as const).map((type) => (
                    <label
                      className={`competence-filter__item competence-filter__item--${
                        type === "know" ? "know" : type === "can" ? "can" : "master"
                      }`}
                      key={type}
                    >
                      <input
                        checked={taskListCompetenceFilters[type]}
                        onChange={() => toggleTaskListCompetenceFilter(type)}
                        type="checkbox"
                      />
                      <span>{competenceLabel(type)}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>

            {filteredTasks.length ? (
              filteredTasks.map((task) => (
                <article className="trajectory-task-card" key={task.id}>
                  <div className="trajectory-task-card__header">
                    <div>
                      <strong>{task.title || task.topic_name}</strong>
                      <span>
                        Ключевой элемент: {task.primary_element.name} ·{" "}
                        {TASK_TEMPLATE_LABELS[task.template_kind] ?? TASK_TYPE_LABELS[task.task_type]} ·{" "}
                        Сложность {task.difficulty}
                      </span>
                    </div>
                    <div className="trajectory-task-card__actions">
                      <button className="ghost-button" type="button" disabled={saving} onClick={() => startTaskEditing(task)}>Изменить</button>
                      <button className="secondary-button secondary-button--danger" type="button" disabled={saving} onClick={() => void handleDeleteTask(task.id)}>Удалить</button>
                    </div>
                  </div>
                  <p>{task.prompt}</p>
                  <div className="trajectory-task-card__chips">
                    <span>{topicName(topicById, task.topic_id)}</span>
                    <span>
                      {competenceLabel(
                        elementById.get(task.primary_element.element_id)?.competence_type ?? "know",
                      )}
                    </span>
                    <span>{task.primary_element.name}</span>
                    {(task.checked_relations ?? []).map((relation) => (
                      <span key={relation.relation_id}>
                        {relation.source_element_name} {CHECKED_TASK_RELATION_LABELS[relation.relation_type] ?? relation.relation_type} {relation.target_element_name}
                      </span>
                    ))}
                    {(task.related_elements ?? []).map((element) => (
                      <span key={element.element_id}>{element.name}</span>
                    ))}
                  </div>
                </article>
              ))
            ) : (
              <p className="card__text">
                {tasks.length
                  ? "По текущим фильтрам задания не найдены."
                  : "Для этой траектории задания пока не созданы."}
              </p>
            )}
          </div>
        )}
      </section>
    );
  }
  if (!disciplineId || !trajectoryId) return null;

  return (
    <div className="page-shell trajectory-page trajectory-detail-page immersive-page immersive-page--trajectory">
      <div className="trajectory-detail-shell immersive-page__grid immersive-page__grid--wide">
        <aside className="card card--soft trajectory-detail-sidebar-nav">
        <div>
          <p className="hero__eyebrow">Навигация</p>
          <h1>{trajectory?.name ?? "Траектория изучения"}</h1>
        </div>

        <div className="hero__controls trajectory-detail-hero-actions">
          {isStudentMode ? (
            <>
              {isTeacherReviewMode ? (
                <span className="hero__chip">
                  Ожидают проверки: {pendingMasterReviewCount}
                </span>
              ) : null}
              <button
                className="ghost-button"
                onClick={() => navigate(getSessionHomePath())}
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
              {view.level === "elements" ? (
                <button
                  className="ghost-button"
                  onClick={() => {
                    setView({ level: "topics" });
                    if (selectedTopicId) {
                      setSelectedNodeId(`topic:${selectedTopicId}`);
                    }
                  }}
                  type="button"
                >
                  К темам
                </button>
              ) : null}
              <button
                className="ghost-button"
                onClick={() => navigate(`/disciplines/${resolvedDisciplinePath}/trajectory`)}
                type="button"
              >
                К списку траекторий
              </button>
              <button
                className="ghost-button"
                onClick={() => navigate(`/disciplines/${resolvedDisciplinePath}/knowledge`)}
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
        </aside>

        <main className="trajectory-detail-layout">
        <section className="graph-stage trajectory-graph-stage">
          <div className="graph-toolbar">
            <div>
              <span className="graph-toolbar__eyebrow">
                {isStudentMode ? "Траектория студента" : "Сохранённая траектория"}
              </span>
              <h2>{trajectory?.name ?? "Загрузка"}</h2>
            </div>
          </div>

          <div className="graph-surface">
            {graphLoading ? (
              <div className="status-view">
                <div className="status-view__pulse" />
                <h3>
                  {showStudentView ? "Загружаю траекторию студента" : "Загружаю траекторию"}
                </h3>
                <p>
                  {showStudentView
                    ? "Собираю темы, прогресс студента и доступные шаги обучения."
                    : "Собираю сохранённые темы, элементы и связи графа."}
                </p>
              </div>
            ) : !scene || !scene.nodes.length ? (
              <div className="status-view">
                <h3>Нет данных для отображения</h3>
                <p>В этой траектории пока нет тем.</p>
              </div>
            ) : (
              <div className="graph-frame">
                <GraphNodeRuntimeStateProvider value={graphNodeRuntimeState}>
                  <RelationGraph
                    ref={graphRef}
                    options={GRAPH_OPTIONS}
                    nodeSlot={GraphNode}
                    onCanvasClick={handleCanvasClick}
                    onCanvasDragEnd={onCanvasDragEnd}
                    onCanvasDragging={onCanvasDragging}
                    onNodeDragEnd={onNodeDragEnd}
                    onNodeDragging={onNodeDragging}
                    onZoomEnd={onZoomEnd}
                  />
                </GraphNodeRuntimeStateProvider>
              </div>
            )}
          </div>
        </section>

        <aside className="inspector">
          <section className="card card--soft">
            <div className="card__header">
              <span className="card__eyebrow">Выбранная вершина</span>
            </div>
            {detail ? (
              <>
                <h2>{detail.title}</h2>
                {detail.subtitle ? <p className="card__lead">{detail.subtitle}</p> : null}
                {detail.description ? <p className="card__text">{detail.description}</p> : null}

                <div className="chip-row">
                  {(detail.chips ?? []).map((chip) => (
                    <span className={`chip chip--${chip.tone}`} key={chip.label}>
                      {chip.label}
                    </span>
                  ))}
                </div>

                <div className="stat-grid">
                  {(detail.stats ?? []).map((stat) => (
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

                {detail.footnote ? <p className="card__footnote">{detail.footnote}</p> : null}
              </>
            ) : null}
          </section>
        </aside>

        {studentPreviewOpen && studentIdFromQuery && false ? (
          <section className="card card--soft trajectory-student-topic-panel">
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Текущая тема студента</p>
                <h2>{topicName(topicById, selectedTopicId)}</h2>
              </div>
              <span className="hero__chip">{selectedTopicStudentTasks.length} Р·Р°РґР°РЅРёР№</span>
            </div>
            {selectedTopicStudentTasks.length ? (
              <div className="student-task-list">
                {selectedTopicStudentTasks.map((task) => (
                  <article className="student-task-card" key={task.id}>
                    <div className="student-task-card__header">
                      <div>
                        <strong>{task.topic_name}</strong>
                        <span>
                          Ключевой элемент: {task.primary_element.name} · {TASK_TYPE_LABELS[task.task_type]}
                        </span>
                      </div>
                      <span className="hero__chip">Сложность {task.difficulty}</span>
                    </div>

                    <p>{task.prompt}</p>

                    <div className="student-task-card__progress">
                      <span>Статус: {studentTaskProgressLabel(task.progress.status)}</span>
                      <span>Попыток: {task.progress.attempts_count}</span>
                      <span>Последний балл: {task.progress.last_score ?? "еще нет"}</span>
                      <span>Лучший балл: {task.progress.best_score ?? "еще нет"}</span>
                    </div>

                    {renderStudentTaskAnswerEditor(task)}

                    <div className="student-task-card__actions">
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={savingStudentTaskId === task.id}
                        onClick={() => setDebugStudentTask(task)}
                      >
                        Показать эталон
                      </button>
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
                          (trajectoryTopic?.elements ?? []).map((element) => (
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
                Версия графа: {trajectory.graph_version}
                {graph ? ` / текущая ${graph.discipline.knowledge_graph_version}` : ""}
              </span>
              <span>{trajectory.is_actual ? "Актуальна" : "Устарела"}</span>
            </div>
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
                        <span>{trajectoryTopic?.elements?.length ?? 0} элементов</span>
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
        <section className="card card--soft trajectory-task-panel trajectory-panel--inline">
          <div className="card__header">
            <div>
              <p className="card__eyebrow">Задания</p>
              <h2>Ручное добавление заданий</h2>
            </div>
            <span className="hero__chip">{tasks.length} Р·Р°РґР°РЅРёР№</span>
          </div>

          {allTrajectoryPrimaryElements.length ? (
            <div className="trajectory-task-editor">
              <div className="editor-tabs trajectory-task-competence-tabs">
                {TASK_COMPETENCE_TABS.map((tab) => (
                  <button
                    className={`editor-tab ${taskCompetenceTab === tab.value ? "editor-tab--active" : ""}`}
                    key={`inline-${tab.value}`}
                    onClick={() => handleTaskCompetenceTabChange(tab.value)}
                    type="button"
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              <div className="trajectory-task-editor__grid">
                <label className="field">
                  <span>Тема траектории</span>
                  <select
                    value={taskTopicId}
                    onChange={(event) => setTaskTopicId(event.target.value)}
                    disabled={saving}
                  >
                    {trajectory?.topics
                      .filter((topic) => (trajectoryElementsByTopicId.get(topic.topic_id) ?? []).length > 0)
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
                    min={TASK_DIFFICULTY_MIN}
                    max={TASK_DIFFICULTY_MAX}
                    step={1}
                    type="number"
                    value={taskDifficulty}
                    onChange={(event) =>
                      setTaskDifficulty(clampTaskDifficulty(Number(event.target.value)))
                    }
                    disabled={saving}
                  />
                </label>
              </div>

              <label className="field">
                <span>Заголовок задания</span>
                <input
                  value={taskTitle}
                  onChange={(event) => setTaskTitle(event.target.value)}
                  placeholder="Например: Определение базового понятия"
                  disabled={saving}
                />
              </label>

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

              {taskCompetenceTab === "know" ? (
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

              </div>
              ) : null}

              {taskCompetenceTab === "can" ? (
                <div className="trajectory-task-related">
                  <strong>Настройка задания уровня «Уметь»</strong>
                  <p className="card__text">
                    Преподаватель задает входные данные операции. Студент увидит их и отправит итоговый ответ.
                  </p>
                  {!availablePrimaryElements.length ? (
                    <p className="form-error">
                      В выбранной теме траектории пока нет элементов «Уметь».
                    </p>
                  ) : selectedPrimaryOperation ? (
                    <p className="card__text">Операция: {selectedPrimaryOperation.title}</p>
                  ) : (
                    <p className="form-error">У выбранного элемента «Уметь» не найдена операция алгоритмической библиотеки.</p>
                  )}
                  <div className="trajectory-task-related">
                    <strong>Входные значения</strong>
                    {selectedPrimaryOperation ? (
                      <OperationInputEditor
                        disabled={saving}
                        onChange={setTaskSkillInputPayload}
                        schema={selectedPrimaryOperation.input_schema}
                        value={taskSkillInputPayload}
                      />
                    ) : null}
                  </div>
                  <label className="field">
                    <span>Подсказка в поле ответа</span>
                    <input
                      value={taskTextPlaceholder}
                      onChange={(event) => setTaskTextPlaceholder(event.target.value)}
                      placeholder="Например: Введите ответ в формате JSON"
                      disabled={saving}
                    />
                  </label>
                  <div className="trajectory-task-preview__items">
                    {availableSkillKnowledgeElements.map((element) => (
                      <span className="trajectory-task-preview__item trajectory-task-preview__item--correct" key={element.id}>
                        {element.name}
                      </span>
                    ))}
                  </div>
                </div>
              ) : null}
              {taskCompetenceTab === "master" ? (
                <div className="trajectory-task-related">
                  <strong>Настройка задания уровня «Владеть»</strong>
                  <p className="card__text">
                    Обязательные связанные элементы подставляются автоматически: элементы «Уметь» по связи
                    «автоматизирует» и элементы «Знать» по связи «опирается на» в рамках этой темы.
                    Дополнительно можно отметить связи с другими элементами «Владеть» этой же темы.
                  </p>
                  <label className="field">
                    <span>Подсказка в поле ответа</span>
                    <input
                      value={taskTextPlaceholder}
                      onChange={(event) => setTaskTextPlaceholder(event.target.value)}
                      placeholder="Например: Опиши решение и результат"
                      disabled={saving}
                    />
                  </label>
                  <strong>Обязательные элементы «Уметь»</strong>
                  <div className="trajectory-task-preview__items">
                    {availableMasterSkillElements.length ? (
                      availableMasterSkillElements.map((element) => (
                        <span className="trajectory-task-preview__item trajectory-task-preview__item--correct" key={`inline-master-skill-${element.id}`}>
                          {element.name}
                        </span>
                      ))
                    ) : (
                      <p className="card__text">
                        Для выбранного элемента пока не найдено обязательных связей «автоматизирует» с элементами «Уметь».
                      </p>
                    )}
                  </div>
                  <strong>Обязательные элементы «Знать»</strong>
                  <div className="trajectory-task-preview__items">
                    {availableMasterKnowledgeElements.length ? (
                      availableMasterKnowledgeElements.map((element) => (
                        <span className="trajectory-task-preview__item trajectory-task-preview__item--correct" key={`inline-master-know-${element.id}`}>
                          {element.name}
                        </span>
                      ))
                    ) : (
                      <p className="card__text">
                        Для выбранного элемента пока не найдено обязательных связей «опирается на» с элементами «Знать».
                      </p>
                    )}
                  </div>
                </div>
              ) : null}
              {taskCompetenceTab === "know" ? (
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
              ) : null}

              {taskCompetenceTab === "can" ? (
                <div className="trajectory-task-related">
                  <strong>Проверяемые связи</strong>
                  <p className="card__text">
                    Связи «реализует» с элементами «Знать» подставляются автоматически и остаются обязательными.
                    Дополнительно можно отметить связи с другими элементами «Уметь» этой темы.
                  </p>
                  <div className="trajectory-task-related__list">
                    {mandatorySkillRelations.map((relation) => (
                      <label className="trajectory-task-related__item" key={`inline-mandatory-${relation.id}`}>
                        <input checked disabled type="checkbox" />
                        <span>{checkedRelationLabel(relation, elementById)}</span>
                      </label>
                    ))}
                  </div>
                  {optionalSkillRelations.length ? (
                    <>
                      <strong>Дополнительные связи с «Уметь»</strong>
                      <div className="trajectory-task-related__list">
                        {optionalSkillRelations.map((relation) => (
                          <label className="trajectory-task-related__item" key={`inline-optional-${relation.id}`}>
                            <input
                              checked={taskCheckedRelationIds.includes(relation.id)}
                              disabled={saving}
                              onChange={() => toggleSkillOptionalRelation(relation.id)}
                              type="checkbox"
                            />
                            <span>{checkedRelationLabel(relation, elementById)}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="card__text">
                      У выбранного элемента пока нет дополнительных связей с другими элементами «Уметь» этой темы.
                    </p>
                  )}
                </div>
              ) : null}
              {taskCompetenceTab === "master" ? (
                <div className="trajectory-task-related">
                  <strong>Проверяемые связи</strong>
                  <p className="card__text">
                    Связи «автоматизирует» и «опирается на» подставляются автоматически и остаются обязательными.
                    Дополнительно можно отметить связи с другими элементами «Владеть» этой темы.
                  </p>
                  <div className="trajectory-task-related__list">
                    {mandatoryMasterRelations.map((relation) => (
                      <label className="trajectory-task-related__item" key={`inline-master-mandatory-${relation.id}`}>
                        <input checked disabled type="checkbox" />
                        <span>{checkedRelationLabel(relation, elementById)}</span>
                      </label>
                    ))}
                  </div>
                  {optionalMasterRelations.length ? (
                    <>
                      <strong>Дополнительные связи с «Владеть»</strong>
                      <div className="trajectory-task-related__list">
                        {optionalMasterRelations.map((relation) => (
                          <label className="trajectory-task-related__item" key={`inline-master-optional-${relation.id}`}>
                            <input
                              checked={taskCheckedRelationIds.includes(relation.id)}
                              disabled={saving}
                              onChange={() => toggleMasterOptionalRelation(relation.id)}
                              type="checkbox"
                            />
                            <span>{checkedRelationLabel(relation, elementById)}</span>
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="card__text">
                      У выбранного элемента пока нет дополнительных связей с другими элементами «Владеть» этой темы.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="trajectory-task-editor__actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving || !taskTopicId || !taskPrimaryElementId || !taskTitle.trim() || !taskPrompt.trim()}
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
                        Ключевой элемент: {task.primary_element.name} · Сложность {task.difficulty}
                      </span>
                    </div>
                    <div className="trajectory-task-card__actions">
                      <button
                        className="ghost-button"
                        type="button"
                        disabled={saving}
                        onClick={() => startTaskEditing(task)}
                      >
                        Изменить
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
                    {(task.related_elements ?? []).map((element) => (
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
      </div>

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
              {isTeacherReviewMode ? (
                <span className="hero__chip">
                  Ожидают проверки: {selectedTopicStudentTasks.filter(
                    (task) => isManualMasterTask(task) && task.progress.status === "pending_review",
                  ).length}
                </span>
              ) : null}
              <button className="ghost-button" onClick={() => setStudentTaskModalOpen(false)} type="button">
                Закрыть
              </button>
            </div>
            <div className="modal-panel__body">
              <section className="card card--soft trajectory-student-topic-modal">
                <p className="card__text">
                  {isTeacherReviewMode
                    ? "Здесь можно просмотреть отправки студента по заданиям этой темы и вручную проверить задания уровня «Владеть»."
                    : "Система выбирает следующее задание по текущему уровню освоения элементов этой темы."}
                </p>
                {isTeacherReviewMode ? (
                  selectedTopicStudentTasks.length ? (
                    <div className="student-task-list">
                      {selectedTopicStudentTasks.map((task) => (
                        <article className="student-task-card" key={task.id}>
                          <div className="student-task-card__header">
                            <div>
                              <strong>{task.title || task.topic_name}</strong>
                              <span>
                                Ключевой элемент: {task.primary_element.name} ·{" "}
                                {TASK_TYPE_LABELS[task.task_type]}
                              </span>
                            </div>
                            <span className="hero__chip">Сложность {task.difficulty}</span>
                          </div>
                          <p>{task.prompt}</p>
                          <div className="student-task-card__progress">
                            <span>Статус: {studentTaskProgressLabel(task.progress.status)}</span>
                            <span>Попыток: {task.progress.attempts_count}</span>
                            <span>Последний балл: {task.progress.last_score ?? "еще нет"}</span>
                            <span>Лучший балл: {task.progress.best_score ?? "еще нет"}</span>
                            <span>Освоение элемента: {task.primary_element.mastery_value}</span>
                          </div>
                          {task.progress.last_feedback ? (
                            <div className="student-task-card__feedback">
                              {String(task.progress.last_feedback.message ?? "")}
                            </div>
                          ) : null}
                          {isManualMasterTask(task)
                            ? renderTeacherManualReview(task)
                            : renderDetachedTextTaskAnswer(
                                task,
                                studentTaskAnswers[task.id] ?? buildStudentTaskAnswerDraft(task),
                              )}
                        </article>
                      ))}
                    </div>
                  ) : (
                    <p className="card__text">
                      Для выбранной темы у студента пока нет заданий.
                    </p>
                  )
                ) : selectedTopicRecommendedTask ? (
                  <div className="student-task-list">
                      <article className="student-task-card" key={selectedTopicRecommendedTask.id}>
                        <div className="student-task-card__header">
                          <div>
                            <strong>{selectedTopicRecommendedTask.title || selectedTopicRecommendedTask.topic_name}</strong>
                            <span>
                              Ключевой элемент: {selectedTopicRecommendedTask.primary_element.name} ·{" "}
                              {TASK_TYPE_LABELS[selectedTopicRecommendedTask.task_type]}
                            </span>
                          </div>
                          <span className="hero__chip">Сложность {selectedTopicRecommendedTask.difficulty}</span>
                        </div>
                        <p>{selectedTopicRecommendedTask.prompt}</p>
                        <div className="student-task-card__progress">
                          <span>Статус: {studentTaskProgressLabel(selectedTopicRecommendedTask.progress.status)}</span>
                          <span>Попыток: {selectedTopicRecommendedTask.progress.attempts_count}</span>
                          <span>Последний балл: {selectedTopicRecommendedTask.progress.last_score ?? "еще нет"}</span>
                          <span>Лучший балл: {selectedTopicRecommendedTask.progress.best_score ?? "еще нет"}</span>
                          <span>Освоение элемента: {selectedTopicRecommendedTask.primary_element.mastery_value}</span>
                        </div>
                        {selectedTopicRecommendedTask.progress.last_feedback ? (
                          <div className="student-task-card__feedback">
                            {String(selectedTopicRecommendedTask.progress.last_feedback.message ?? "")}
                          </div>
                        ) : null}
                        {renderStudentTaskAnswerEditor(selectedTopicRecommendedTask)}
                        <div className="student-task-card__actions">
                          <button
                            className="ghost-button"
                            type="button"
                            disabled={savingStudentTaskId === selectedTopicRecommendedTask.id}
                            onClick={() => setDebugStudentTask(selectedTopicRecommendedTask)}
                          >
                            Показать эталон
                          </button>
                          <button
                            className="primary-button"
                            type="button"
                            disabled={savingStudentTaskId === selectedTopicRecommendedTask.id}
                            onClick={() => void handleSubmitStudentTask(selectedTopicRecommendedTask)}
                          >
                            {savingStudentTaskId === selectedTopicRecommendedTask.id
                              ? "Проверяю..."
                              : "Отправить ответ"}
                          </button>
                        </div>
                      </article>
                  </div>
                ) : (
                  <p className="card__text">
                    Для выбранной темы сейчас нет доступного задания. Возможная причина: предыдущие темы еще не набрали нужный порог.
                  </p>
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

      <StudentTaskDebugAnswerModal onClose={() => setDebugStudentTask(null)} task={debugStudentTask} />
    </div>
  );
}
