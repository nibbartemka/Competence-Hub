import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import RelationGraph, {
  type RelationGraphInstance,
  type RGOptions,
  type RelationGraphComponent,
} from "relation-graph-react";

import {
  createLearningTrajectory,
  fetchDisciplineKnowledgeGraph,
  fetchDisciplines,
  fetchGroups,
  fetchLearningTrajectories,
  fetchSubgroups,
  fetchTeachers,
  isAbortError,
} from "./api";
import {
  GraphNode,
  GraphNodeRuntimeStateProvider,
  type GraphNodeRuntimeState,
} from "./components/GraphNode";
import { buildElementScene, buildTopicScene } from "./graphScene";
import type {
  CompetenceType,
  Discipline,
  DisciplineKnowledgeGraph,
  Group,
  KnowledgeElement,
  KnowledgeElementRelationType,
  LearningTrajectory,
  SceneNodeData,
  Subgroup,
  Teacher,
  Topic,
  ViewMode,
} from "./types";

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
};

const COMPETENCE_ORDER: CompetenceType[] = ["know", "can", "master"];

const COMPETENCE_LABELS: Record<CompetenceType, string> = {
  know: "Знать",
  can: "Уметь",
  master: "Владеть",
};

const ELEMENT_PREREQUISITE_RELATIONS = new Set<KnowledgeElementRelationType>([
  "requires",
  "builds_on",
]);

const ELEMENT_RELATION_LABELS: Record<KnowledgeElementRelationType, string> = {
  requires: "требует",
  builds_on: "строится на",
  contains: "содержит",
  part_of: "является частью",
  property_of: "свойство объекта",
  refines: "уточняет",
  generalizes: "обобщает",
  similar: "родственно",
  contrasts_with: "противопоставляется",
  used_with: "используется вместе",
  implements: "реализует",
  automates: "переходит во владение",
};

type Feedback = {
  kind: "error" | "success";
  text: string;
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось выполнить запрос.";
}

function clampThreshold(value: number) {
  if (Number.isNaN(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

function buildElementKey(topicId: string, elementId: string) {
  return `${topicId}:${elementId}`;
}

function parseElementNodeId(nodeId: string) {
  const [, topicId, elementId] = nodeId.split(":");
  return topicId && elementId ? { topicId, elementId } : null;
}

function topicName(topicById: Map<string, Topic>, topicId: string) {
  return topicById.get(topicId)?.name ?? topicId.slice(0, 8);
}

export default function TrajectoryGraphBuilder() {
  const { disciplineId } = useParams<{ disciplineId: string }>();
  const navigate = useNavigate();
  const graphRef = useRef<RelationGraphComponent>();
  const previousSceneKeyRef = useRef("");

  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [graph, setGraph] = useState<DisciplineKnowledgeGraph | null>(null);
  const [trajectories, setTrajectories] = useState<LearningTrajectory[]>([]);

  const [trajectoryName, setTrajectoryName] = useState("");
  const [selectedTeacherId, setSelectedTeacherId] = useState("");
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [targetMode, setTargetMode] = useState<"group" | "subgroup">("group");
  const [selectedSubgroupId, setSelectedSubgroupId] = useState("");
  const [selectedTopicIds, setSelectedTopicIds] = useState<string[]>([]);
  const [topicThresholds, setTopicThresholds] = useState<Record<string, number>>({});
  const [selectedElementsByTopic, setSelectedElementsByTopic] = useState<
    Record<string, string[]>
  >({});
  const [elementThresholds, setElementThresholds] = useState<Record<string, number>>({});
  const [view, setView] = useState<ViewMode>({ level: "topics" });
  const [selectedNodeId, setSelectedNodeId] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const activeDiscipline = useMemo(
    () =>
      disciplines.find((discipline) => discipline.id === disciplineId) ??
      graph?.discipline ??
      null,
    [disciplines, disciplineId, graph],
  );

  const disciplineTeachers = useMemo(() => {
    if (!activeDiscipline) return [];

    return teachers.filter(
      (teacher) =>
        activeDiscipline.teacher_ids.includes(teacher.id) ||
        teacher.discipline_ids.includes(activeDiscipline.id),
    );
  }, [activeDiscipline, teachers]);

  const teacherById = useMemo(
    () => new Map(teachers.map((teacher) => [teacher.id, teacher])),
    [teachers],
  );

  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group])),
    [groups],
  );

  const topicById = useMemo(
    () => new Map((graph?.topics ?? []).map((topic) => [topic.id, topic])),
    [graph],
  );

  const elementById = useMemo(
    () => new Map((graph?.knowledge_elements ?? []).map((element) => [element.id, element])),
    [graph],
  );

  const selectedTeacher = selectedTeacherId ? teacherById.get(selectedTeacherId) : undefined;

  const availableGroups = useMemo(() => {
    if (!activeDiscipline || !selectedTeacher) return [];

    return groups.filter(
      (group) =>
        activeDiscipline.group_ids.includes(group.id) &&
        selectedTeacher.group_ids.includes(group.id),
    );
  }, [activeDiscipline, groups, selectedTeacher]);

  const formedElementsByTopic = useMemo(() => {
    const result = new Map<string, KnowledgeElement[]>();
    if (!graph) return result;

    for (const link of graph.topic_knowledge_elements) {
      if (link.role !== "formed") continue;
      const element = elementById.get(link.element_id);
      if (!element) continue;
      result.set(link.topic_id, [...(result.get(link.topic_id) ?? []), element]);
    }

    for (const [topicId, elements] of result) {
      result.set(
        topicId,
        elements.slice().sort((left, right) => {
          const competenceDelta =
            COMPETENCE_ORDER.indexOf(left.competence_type) -
            COMPETENCE_ORDER.indexOf(right.competence_type);
          return competenceDelta || left.name.localeCompare(right.name, "ru");
        }),
      );
    }

    return result;
  }, [elementById, graph]);

  const requiredElementsByTopic = useMemo(() => {
    const result = new Map<string, KnowledgeElement[]>();
    if (!graph) return result;

    for (const link of graph.topic_knowledge_elements) {
      if (link.role !== "required") continue;
      const element = elementById.get(link.element_id);
      if (!element) continue;
      result.set(link.topic_id, [...(result.get(link.topic_id) ?? []), element]);
    }

    return result;
  }, [elementById, graph]);

  const selectedTopicSet = useMemo(
    () => new Set(selectedTopicIds),
    [selectedTopicIds],
  );

  const selectedElementCount = selectedTopicIds.reduce(
    (sum, topicId) => sum + (selectedElementsByTopic[topicId]?.length ?? 0),
    0,
  );

  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (!trajectoryName.trim()) errors.push("Укажи название траектории.");
    if (!selectedTeacherId) errors.push("Выбери преподавателя.");
    if (!disciplineId) errors.push("Не выбрана дисциплина.");
    if (!selectedGroupId) errors.push("Выбери группу для назначения.");
    if (targetMode === "subgroup" && !selectedSubgroupId) {
      errors.push("Выбери подгруппу или назначь траекторию всей группе.");
    }
    if (!selectedTopicIds.length) {
      errors.push("Кликни по графу и выбери хотя бы одну тему.");
    }
    if (selectedTopicIds.length && !selectedTopicIds.some((id) => topicThresholds[id] === 0)) {
      errors.push("Хотя бы одна тема должна иметь порог 0.");
    }

    if (graph) {
      const positionByTopicId = new Map(
        selectedTopicIds.map((topicId, index) => [topicId, index]),
      );

      for (const [index, topicId] of selectedTopicIds.entries()) {
        const previousTopicIds = selectedTopicIds.slice(0, index);
        const missingElements = getMissingRequiredElementsForTopic(topicId, previousTopicIds);
        if (missingElements.length) {
          errors.push(buildMissingElementsMessage(topicId, missingElements));
        }
      }

      for (const dependency of graph.topic_dependencies) {
        if (dependency.relation_type !== "requires") continue;
        if (!selectedTopicSet.has(dependency.dependent_topic_id)) continue;

        if (!selectedTopicSet.has(dependency.prerequisite_topic_id)) {
          errors.push(
            `Тема "${topicName(topicById, dependency.dependent_topic_id)}" требует тему "${topicName(
              topicById,
              dependency.prerequisite_topic_id,
            )}", но она не выбрана.`,
          );
          continue;
        }

        const prerequisitePosition = positionByTopicId.get(dependency.prerequisite_topic_id) ?? 0;
        const dependentPosition = positionByTopicId.get(dependency.dependent_topic_id) ?? 0;
        if (prerequisitePosition >= dependentPosition) {
          errors.push(
            `Тема "${topicName(topicById, dependency.prerequisite_topic_id)}" должна стоять раньше темы "${topicName(
              topicById,
              dependency.dependent_topic_id,
            )}".`,
          );
        }
      }
    }

    const selectedElementRecords: Array<{
      competenceType: CompetenceType;
      threshold: number;
    }> = [];
    const availableCompetenceTypes = new Set<CompetenceType>();

    for (const topicId of selectedTopicIds) {
      for (const element of formedElementsByTopic.get(topicId) ?? []) {
        availableCompetenceTypes.add(element.competence_type);
      }

      for (const elementId of selectedElementsByTopic[topicId] ?? []) {
        const element = elementById.get(elementId);
        if (!element) continue;
        selectedElementRecords.push({
          competenceType: element.competence_type,
          threshold: elementThresholds[buildElementKey(topicId, elementId)] ?? 100,
        });
      }
    }

    if (!selectedElementRecords.length) {
      errors.push("Выбери хотя бы один формируемый элемент.");
    }

    for (const competenceType of COMPETENCE_ORDER.filter((type) =>
      availableCompetenceTypes.has(type),
    )) {
      const hasRequiredElement = selectedElementRecords.some(
        (record) => record.competenceType === competenceType && record.threshold === 0,
      );
      if (!hasRequiredElement) {
        errors.push(
          `Для компетенции "${COMPETENCE_LABELS[competenceType]}" нужен минимум один элемент с порогом 0.`,
        );
      }
    }

    return errors;
  }, [
    disciplineId,
    elementById,
    elementThresholds,
    formedElementsByTopic,
    graph,
    requiredElementsByTopic,
    selectedElementsByTopic,
    selectedGroupId,
    selectedSubgroupId,
    selectedTeacherId,
    selectedTopicIds,
    selectedTopicSet,
    targetMode,
    topicById,
    topicThresholds,
    trajectoryName,
  ]);

  const scene = useMemo(() => {
    if (!graph) return null;

    const baseScene =
      view.level === "topics"
        ? buildTopicScene(graph, selectedNodeId || undefined)
        : buildElementScene(graph, view.topicId, selectedNodeId || undefined);

    return {
      ...baseScene,
      nodes: baseScene.nodes.map((node) => {
        const data = node.data as SceneNodeData | undefined;
        if (!data?.entity) return node;

        if (data.entity === "topic" && data.topicId) {
          const topicId = data.topicId;
          const selectedIndex = selectedTopicIds.indexOf(topicId);
          const isSelected = selectedIndex >= 0;
          const missingElements = isSelected
            ? []
            : getMissingRequiredElementsForTopic(topicId);
          const isBlocked = missingElements.length > 0;

          return {
            ...node,
            data: {
              ...data,
              isSelected,
              isDisabled: isBlocked,
              lockState: isBlocked ? "locked" : "open",
              subtitle: isSelected
                ? `Шаг ${selectedIndex + 1} в траектории`
                : isBlocked
                  ? `Сначала нужно: ${missingElements.map((item) => item.name).join(", ")}`
                : data.subtitle,
              metrics: isSelected
                ? [...data.metrics, `Порог ${topicThresholds[topicId] ?? 100}`]
                : data.metrics,
              hint: isSelected ? "Убрать" : "Выбрать",
              secondaryHint: "Элементы",
            },
          };
        }

        if (data.entity === "topic-focus" && data.topicId) {
          return {
            ...node,
            data: {
              ...data,
              isSelected: selectedTopicSet.has(data.topicId),
              lockState: "open",
              hint: "К темам",
            },
          };
        }

        if (data.entity === "element") {
          const isFormed = data.tone === "formed";

          return {
            ...node,
            data: {
              ...data,
              isSelected: false,
              isDisabled: !isFormed,
              lockState: isFormed ? "open" : "locked",
              hint: isFormed ? "Выбрать" : "Предпосылка",
            },
          };
        }

        return node;
      }),
      lines:
        view.level === "topics"
          ? baseScene.lines.map((line) => {
              const activeLine = isTrajectoryLineActive(line.from, line.to);

              return {
                ...line,
                color: activeLine ? "#178364" : "#9aa3ad",
                fontColor: activeLine ? "#146c53" : "#7f8894",
                animation: activeLine ? line.animation : 0,
              };
            })
          : baseScene.lines,
    };
  }, [
    graph,
    requiredElementsByTopic,
    selectedNodeId,
    selectedTopicIds,
    selectedTopicSet,
    topicThresholds,
    view,
  ]);

  const graphNodeRuntimeState = useMemo<GraphNodeRuntimeState>(() => {
    const selectedNodeIds = new Set<string>();
    const disabledNodeIds = new Set<string>();
    const lockStateByNodeId = new Map<string, "locked" | "open">();
    const hintByNodeId = new Map<string, string | undefined>();
    const secondaryHintByNodeId = new Map<string, string | undefined>();
    const metricsByNodeId = new Map<string, string[]>();
    const cardActionByNodeId = new Map<string, () => void>();
    const hintActionByNodeId = new Map<string, () => void>();
    const secondaryHintActionByNodeId = new Map<string, () => void>();

    const showElementBlockedMessage = (
      elementName: string,
      missingPrerequisites: string[],
      isFormed: boolean,
    ) => {
      const reason = !isFormed
        ? "он является предпосылкой этой темы, а в траекторию добавляются только формируемые элементы."
        : `сначала выбери ${missingPrerequisites.join(", ")}.`;

      setFeedback({
        kind: "error",
        text: `Элемент "${elementName}" пока нельзя выбрать: ${reason}`,
      });
    };

    if (graph) {
      if (view.level === "topics") {
        for (const topic of graph.topics) {
          const nodeId = `topic:${topic.id}`;
          const selectedIndex = selectedTopicIds.indexOf(topic.id);
          const isSelected = selectedIndex >= 0;
          const missingElements = isSelected
            ? []
            : getMissingRequiredElementsForTopic(topic.id);
          const isBlocked = missingElements.length > 0;

          if (isSelected) {
            selectedNodeIds.add(nodeId);
          }
          if (isBlocked) {
            disabledNodeIds.add(nodeId);
          }

          lockStateByNodeId.set(nodeId, isBlocked ? "locked" : "open");
          hintByNodeId.set(nodeId, isBlocked ? "Почему закрыто" : isSelected ? "Убрать" : "Выбрать");
          hintActionByNodeId.set(nodeId, () => {
            if (isBlocked) {
              setFeedback({
                kind: "error",
                text: buildMissingElementsMessage(topic.id, missingElements),
              });
              return;
            }

            setSelectedNodeId(nodeId);
            toggleTopic(topic.id);
          });
          secondaryHintByNodeId.set(nodeId, "Элементы");
          secondaryHintActionByNodeId.set(nodeId, () =>
            setView({ level: "elements", topicId: topic.id }),
          );
        }
      } else {
        const topicId = view.topicId;
        const focusNodeId = `topic-focus:${topicId}`;
        const selectedElementIds = new Set(selectedElementsByTopic[topicId] ?? []);
        const formedElementIdsInTopic = new Set(
          graph.topic_knowledge_elements
            .filter((link) => link.topic_id === topicId && link.role === "formed")
            .map((link) => link.element_id),
        );

        if (selectedTopicSet.has(topicId)) {
          selectedNodeIds.add(focusNodeId);
        }

        lockStateByNodeId.set(focusNodeId, "open");
        hintByNodeId.set(focusNodeId, "К темам");
        hintActionByNodeId.set(focusNodeId, () => setView({ level: "topics" }));

        for (const link of graph.topic_knowledge_elements) {
          if (link.topic_id !== topicId) continue;

          const nodeId = `element:${topicId}:${link.element_id}`;
          const element = elementById.get(link.element_id);
          const isFormed = link.role === "formed";
          const missingPrerequisites = graph.knowledge_element_relations
            .filter(
              (relation) =>
                relation.source_element_id === link.element_id &&
                ELEMENT_PREREQUISITE_RELATIONS.has(relation.relation_type) &&
                formedElementIdsInTopic.has(relation.target_element_id) &&
                !selectedElementIds.has(relation.target_element_id),
            )
            .map((relation) => {
              const prerequisiteName =
                elementById.get(relation.target_element_id)?.name ?? relation.target_element_id;
              return `"${prerequisiteName}" (${ELEMENT_RELATION_LABELS[relation.relation_type]})`;
            });
          const isSelected = selectedElementIds.has(link.element_id);
          const isBlocked = !isSelected && (!isFormed || missingPrerequisites.length > 0);
          const toggleCurrentElement = () => toggleElement(topicId, link.element_id);

          if (isSelected) {
            selectedNodeIds.add(nodeId);
            metricsByNodeId.set(nodeId, [
              `Порог ${elementThresholds[buildElementKey(topicId, link.element_id)] ?? 100}`,
            ]);
          }
          if (isBlocked) {
            disabledNodeIds.add(nodeId);
          }

          lockStateByNodeId.set(nodeId, isBlocked ? "locked" : "open");
          hintByNodeId.set(
            nodeId,
            isBlocked ? "Почему закрыто" : isSelected ? "Убрать" : "Выбрать",
          );
          if (isBlocked) {
            const showBlockedReason = () =>
              showElementBlockedMessage(
                element?.name ?? link.element_id,
                missingPrerequisites,
                isFormed,
              );
            cardActionByNodeId.set(nodeId, showBlockedReason);
            hintActionByNodeId.set(nodeId, showBlockedReason);
          } else {
            hintActionByNodeId.set(nodeId, toggleCurrentElement);
          }
        }
      }
    }

    return {
      selectedNodeIds,
      disabledNodeIds,
      lockStateByNodeId,
      hintByNodeId,
      secondaryHintByNodeId,
      metricsByNodeId,
      cardActionByNodeId,
      hintActionByNodeId,
      secondaryHintActionByNodeId,
    };
  }, [
    elementThresholds,
    elementById,
    formedElementsByTopic,
    graph,
    requiredElementsByTopic,
    selectedElementsByTopic,
    selectedTopicIds,
    selectedTopicSet,
    view,
  ]);

  useEffect(() => {
    if (!disciplineId) {
      navigate("/", { replace: true });
      return;
    }

    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setFeedback(null);
        const [nextGraph, nextDisciplines, nextGroups, nextTeachers] = await Promise.all([
          fetchDisciplineKnowledgeGraph(disciplineId!, controller.signal),
          fetchDisciplines(controller.signal),
          fetchGroups(controller.signal),
          fetchTeachers(controller.signal),
        ]);

        setGraph(nextGraph);
        setDisciplines(nextDisciplines);
        setGroups(nextGroups);
        setTeachers(nextTeachers);
        setSelectedNodeId(buildTopicScene(nextGraph).defaultSelectedNodeId);
      } catch (error) {
        if (!isAbortError(error)) {
          setFeedback({ kind: "error", text: extractErrorMessage(error) });
          setGraph(null);
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, [disciplineId, navigate]);

  useEffect(() => {
    if (selectedTeacherId && disciplineTeachers.some((teacher) => teacher.id === selectedTeacherId)) {
      return;
    }

    setSelectedTeacherId(disciplineTeachers[0]?.id ?? "");
  }, [disciplineTeachers, selectedTeacherId]);

  useEffect(() => {
    if (selectedGroupId && availableGroups.some((group) => group.id === selectedGroupId)) {
      return;
    }

    setSelectedGroupId(availableGroups[0]?.id ?? "");
  }, [availableGroups, selectedGroupId]);

  useEffect(() => {
    if (!selectedGroupId) {
      setSubgroups([]);
      setSelectedSubgroupId("");
      setTargetMode("group");
      return;
    }

    const controller = new AbortController();

    async function loadSubgroups() {
      try {
        const items = await fetchSubgroups(selectedGroupId, controller.signal);
        setSubgroups(items);
        setSelectedSubgroupId((current) =>
          current && items.some((item) => item.id === current)
            ? current
            : items[0]?.id ?? "",
        );
        if (!items.length) {
          setTargetMode("group");
        }
      } catch (error) {
        if (!isAbortError(error)) {
          setSubgroups([]);
          setSelectedSubgroupId("");
          setTargetMode("group");
        }
      }
    }

    void loadSubgroups();

    return () => controller.abort();
  }, [selectedGroupId]);

  useEffect(() => {
    if (!disciplineId) return;

    const controller = new AbortController();

    async function loadTrajectories() {
      try {
        const items = await fetchLearningTrajectories(
          {
            discipline_id: disciplineId,
            teacher_id: selectedTeacherId || undefined,
            group_id: selectedGroupId || undefined,
          },
          controller.signal,
        );
        setTrajectories(items);
      } catch (error) {
        if (!isAbortError(error)) {
          setFeedback({ kind: "error", text: extractErrorMessage(error) });
        }
      }
    }

    void loadTrajectories();

    return () => controller.abort();
  }, [disciplineId, selectedGroupId, selectedTeacherId]);

  useEffect(() => {
    if (!scene || !graphRef.current) return;

    const graphComponent = graphRef.current;
    const graphInstance = graphComponent.getInstance();
    const sameScene = previousSceneKeyRef.current === scene.key;
    const previousPositions = new Map<string, { x: number; y: number }>();
    const previousOffset = sameScene ? graphInstance.getGraphOffet() : null;
    const previousZoom = sameScene ? graphInstance.options.canvasZoom : undefined;

    if (sameScene) {
      for (const node of graphInstance.getNodes()) {
        previousPositions.set(node.id, { x: node.x, y: node.y });
      }
    }

    const nodes = sameScene
      ? scene.nodes.map((node) => {
          const position = previousPositions.get(node.id);
          return position ? { ...node, x: position.x, y: position.y } : node;
        })
      : scene.nodes;

    const afterRefresh = (nextGraphInstance: RelationGraphInstance) => {
      if (sameScene && previousOffset) {
        nextGraphInstance.setCanvasOffset(previousOffset.offset_x, previousOffset.offset_y);
        if (previousZoom) {
          nextGraphInstance.setZoom(previousZoom);
        }
      }

      if (scene.defaultSelectedNodeId) {
        nextGraphInstance.setCheckedNode(scene.defaultSelectedNodeId);
      }
    };

    const graphData = {
      rootId: scene.rootId,
      nodes,
      lines: scene.lines,
    };

    if (sameScene) {
      graphComponent.setJsonData(graphData, false, afterRefresh);
    } else {
      graphComponent.setJsonData(graphData, afterRefresh);
    }

    previousSceneKeyRef.current = scene.key;
  }, [scene]);

  function hasSelectedElementForCompetence(competenceType: CompetenceType) {
    for (const topicId of selectedTopicIds) {
      for (const elementId of selectedElementsByTopic[topicId] ?? []) {
        const element = elementById.get(elementId);
        if (element?.competence_type === competenceType) {
          return true;
        }
      }
    }

    return false;
  }

  function getFormedElementIdsForTopics(topicIds: string[]) {
    const result = new Set<string>();

    for (const topicId of topicIds) {
      for (const element of formedElementsByTopic.get(topicId) ?? []) {
        result.add(element.id);
      }
    }

    return result;
  }

  function getMissingRequiredElementsForTopic(
    topicId: string,
    previousTopicIds = selectedTopicIds,
  ) {
    const formedElementIds = getFormedElementIdsForTopics(previousTopicIds);

    return (requiredElementsByTopic.get(topicId) ?? []).filter(
      (element) => !formedElementIds.has(element.id),
    );
  }

  function buildMissingElementsMessage(topicId: string, elements: KnowledgeElement[]) {
    return `Тему "${topicName(topicById, topicId)}" пока нельзя выбрать: не сформированы элементы ${elements
      .map((element) => `"${element.name}"`)
      .join(", ")}.`;
  }

  function isTopicNodeSelected(nodeId: string) {
    if (!nodeId.startsWith("topic:")) return false;
    return selectedTopicSet.has(nodeId.replace("topic:", ""));
  }

  function isElementNodeSelected(nodeId: string) {
    const parsed = parseElementNodeId(nodeId);
    if (!parsed) return false;
    return Boolean(selectedElementsByTopic[parsed.topicId]?.includes(parsed.elementId));
  }

  function isTrajectoryLineActive(from: string, to: string) {
    if (from.startsWith("topic:") && to.startsWith("topic:")) {
      return isTopicNodeSelected(from) && isTopicNodeSelected(to);
    }

    if (from.startsWith("topic-focus:") && to.startsWith("element:")) {
      return isElementNodeSelected(to);
    }

    if (from.startsWith("element:") && to.startsWith("topic-focus:")) {
      return false;
    }

    if (from.startsWith("element:") && to.startsWith("element:")) {
      return isElementNodeSelected(from) && isElementNodeSelected(to);
    }

    return false;
  }

  function toggleTopic(topicId: string) {
    const isAlreadySelected = selectedTopicIds.includes(topicId);

    if (isAlreadySelected) {
      setSelectedTopicIds((current) => current.filter((id) => id !== topicId));
      setSelectedElementsByTopic((current) => {
        const next = { ...current };
        delete next[topicId];
        return next;
      });
      return;
    }

    const missingElements = getMissingRequiredElementsForTopic(topicId);
    if (missingElements.length) {
      setFeedback({
        kind: "error",
        text: buildMissingElementsMessage(topicId, missingElements),
      });
      return;
    }

    setSelectedTopicIds((current) => [...current, topicId]);
    setTopicThresholds((current) => ({
      ...current,
      [topicId]: current[topicId] ?? (selectedTopicIds.length === 0 ? 0 : 100),
    }));
  }

  function moveTopic(topicId: string, direction: -1 | 1) {
    setSelectedTopicIds((current) => {
      const index = current.indexOf(topicId);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= current.length) {
        return current;
      }

      const next = current.slice();
      [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
      return next;
    });
  }

  function toggleElement(topicId: string, elementId: string) {
    const element = elementById.get(elementId);
    if (!element) return;

    if (!selectedTopicIds.includes(topicId)) {
      setFeedback({
        kind: "error",
        text: `Сначала выбери тему "${topicName(topicById, topicId)}" на уровне тем, потом добавляй ее элементы.`,
      });
      return;
    }

    setSelectedElementsByTopic((current) => {
      const selectedElements = current[topicId] ?? [];
      const nextElements = selectedElements.includes(elementId)
        ? selectedElements.filter((id) => id !== elementId)
        : [...selectedElements, elementId];

      return {
        ...current,
        [topicId]: nextElements,
      };
    });

    setElementThresholds((current) => {
      const key = buildElementKey(topicId, elementId);
      if (current[key] !== undefined) return current;

      return {
        ...current,
        [key]: hasSelectedElementForCompetence(element.competence_type) ? 100 : 0,
      };
    });
  }

  function updateTopicThreshold(topicId: string, value: number) {
    setTopicThresholds((current) => ({
      ...current,
      [topicId]: clampThreshold(value),
    }));
  }

  function updateElementThreshold(topicId: string, elementId: string, value: number) {
    setElementThresholds((current) => ({
      ...current,
      [buildElementKey(topicId, elementId)]: clampThreshold(value),
    }));
  }

  async function refreshTrajectories() {
    if (!disciplineId) return;

    const items = await fetchLearningTrajectories({
      discipline_id: disciplineId,
      teacher_id: selectedTeacherId || undefined,
      group_id: selectedGroupId || undefined,
    });
    setTrajectories(items);
  }

  async function handleCreateTrajectory() {
    if (!disciplineId) return;

    if (validationErrors.length) {
      setFeedback({ kind: "error", text: validationErrors[0] });
      return;
    }

    try {
      setSaving(true);
      setFeedback(null);
      await createLearningTrajectory({
        name: trajectoryName.trim(),
        discipline_id: disciplineId,
        teacher_id: selectedTeacherId,
        group_id: selectedGroupId,
        subgroup_id: targetMode === "subgroup" ? selectedSubgroupId : null,
        topics: selectedTopicIds.map((topicId, index) => ({
          topic_id: topicId,
          position: index + 1,
          threshold: topicThresholds[topicId] ?? 100,
          elements: (selectedElementsByTopic[topicId] ?? []).map((elementId) => ({
            element_id: elementId,
            threshold: elementThresholds[buildElementKey(topicId, elementId)] ?? 100,
          })),
        })),
      });

      setTrajectoryName("");
      setSelectedTopicIds([]);
      setTopicThresholds({});
      setSelectedElementsByTopic({});
      setElementThresholds({});
      await refreshTrajectories();
      setFeedback({ kind: "success", text: "Траектория изучения создана." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setSaving(false);
    }
  }

  if (!disciplineId) {
    return null;
  }

  return (
    <div className={`page-shell trajectory-page page-shell--${view.level}`}>
      <header className="hero trajectory-hero">
        <div>
          <p className="hero__eyebrow">Learning path</p>
          <h1>Конструктор траектории</h1>
          <p className="hero__subtitle">
            Собираем последовательность прямо из графа знаний: тема выбирается кликом
            по вершине, элементы выбираются внутри темы.
          </p>
        </div>

        <div className="hero__controls">
          <button
            className="ghost-button"
            onClick={() => navigate(`/disciplines/${disciplineId}/knowledge`)}
            type="button"
          >
            Назад к графу
          </button>
          <button className="ghost-button" onClick={() => navigate("/")} type="button">
            На главную
          </button>
        </div>
      </header>

      {feedback ? (
        <div className={`home-feedback home-feedback--${feedback.kind}`}>
          {feedback.text}
        </div>
      ) : null}

      <div className="trajectory-workspace">
        <aside className="trajectory-sidebar">
          <section className="card card--soft">
            <p className="card__eyebrow">Настройки</p>
            <h2>{activeDiscipline?.name ?? "Дисциплина"}</h2>

            <div className="trajectory-settings">
              <label className="field">
                <span>Название траектории</span>
                <input
                  value={trajectoryName}
                  onChange={(event) => setTrajectoryName(event.target.value)}
                  placeholder="Например: Базовая траектория"
                />
              </label>

              <label className="field">
                <span>Преподаватель</span>
                <select
                  value={selectedTeacherId}
                  onChange={(event) => setSelectedTeacherId(event.target.value)}
                  disabled={!disciplineTeachers.length}
                >
                  {disciplineTeachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Группа</span>
                <select
                  value={selectedGroupId}
                  onChange={(event) => setSelectedGroupId(event.target.value)}
                  disabled={!availableGroups.length}
                >
                  {availableGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Назначение</span>
                <select
                  value={targetMode}
                  onChange={(event) => setTargetMode(event.target.value as "group" | "subgroup")}
                  disabled={!selectedGroupId || !subgroups.length}
                >
                  <option value="group">Вся группа</option>
                  <option value="subgroup">Подгруппа</option>
                </select>
              </label>

              {targetMode === "subgroup" ? (
                <label className="field">
                  <span>Подгруппа</span>
                  <select
                    value={selectedSubgroupId}
                    onChange={(event) => setSelectedSubgroupId(event.target.value)}
                    disabled={!subgroups.length}
                  >
                    {subgroups.map((subgroup) => (
                      <option key={subgroup.id} value={subgroup.id}>
                        Подгруппа {subgroup.subgroup_num}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>
          </section>

          <section className="card card--soft">
            <div className="card__header">
              <p className="card__eyebrow">Выбрано</p>
              <span className="hero__chip">{selectedTopicIds.length} тем</span>
            </div>

            {selectedTopicIds.length ? (
              <div className="trajectory-selected-list">
                {selectedTopicIds.map((topicId, index) => {
                  const selectedElementIds = selectedElementsByTopic[topicId] ?? [];

                  return (
                    <article className="trajectory-selected-topic" key={topicId}>
                      <div>
                        <strong>
                          {index + 1}. {topicName(topicById, topicId)}
                        </strong>
                        <span>{selectedElementIds.length} элементов</span>
                      </div>

                      <div className="trajectory-topic-actions">
                        <button
                          className="secondary-button"
                          disabled={index === 0}
                          onClick={() => moveTopic(topicId, -1)}
                          type="button"
                        >
                          Выше
                        </button>
                        <button
                          className="secondary-button"
                          disabled={index === selectedTopicIds.length - 1}
                          onClick={() => moveTopic(topicId, 1)}
                          type="button"
                        >
                          Ниже
                        </button>
                      </div>

                      <label className="trajectory-threshold-field">
                        Порог темы
                        <input
                          max={100}
                          min={0}
                          onChange={(event) =>
                            updateTopicThreshold(topicId, Number(event.target.value))
                          }
                          type="number"
                          value={topicThresholds[topicId] ?? 100}
                        />
                      </label>

                      {selectedElementIds.length ? (
                        <div className="trajectory-selected-elements">
                          {selectedElementIds.map((elementId) => {
                            const element = elementById.get(elementId);
                            if (!element) return null;
                            const key = buildElementKey(topicId, elementId);

                            return (
                              <label key={elementId} className="trajectory-selected-element">
                                <span>
                                  {COMPETENCE_LABELS[element.competence_type]} · {element.name}
                                </span>
                                <input
                                  max={100}
                                  min={0}
                                  onChange={(event) =>
                                    updateElementThreshold(
                                      topicId,
                                      elementId,
                                      Number(event.target.value),
                                    )
                                  }
                                  type="number"
                                  value={elementThresholds[key] ?? 100}
                                />
                              </label>
                            );
                          })}
                        </div>
                      ) : (
                        <p className="home-hint">
                          Открой элементы темы и выбери формируемые элементы.
                        </p>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="card__text">
                Клик по теме на графе добавит ее сюда в конец траектории.
              </p>
            )}
          </section>

          <section className="card card--soft">
            <p className="card__eyebrow">Проверка</p>
            <div className="trajectory-validation trajectory-validation--compact">
              {validationErrors.length ? (
                validationErrors.slice(0, 5).map((error) => <span key={error}>{error}</span>)
              ) : (
                <strong>Траектория готова к сохранению.</strong>
              )}
            </div>

            <button
              className="primary-button trajectory-save-button"
              disabled={saving || validationErrors.length > 0}
              onClick={() => void handleCreateTrajectory()}
              type="button"
            >
              {saving ? "Сохраняю..." : "Создать траекторию"}
            </button>
          </section>

          <section className="card card--soft">
            <p className="card__eyebrow">Сохраненные</p>
            {trajectories.length ? (
              <div className="trajectory-saved-list">
                {trajectories.map((trajectory) => (
                  <article key={trajectory.id}>
                    <strong>{trajectory.name}</strong>
                    <span>
                      {trajectory.topics.length} тем · {trajectory.group_id
                        ? groupById.get(trajectory.group_id)?.name
                        : "без группы"}
                    </span>
                  </article>
                ))}
              </div>
            ) : (
              <p className="home-hint">Для выбранной группы траекторий пока нет.</p>
            )}
          </section>
        </aside>

        <main className="trajectory-graph-column">
          <section className="graph-stage trajectory-graph-stage">
            <div className="graph-toolbar">
              <div>
                <span className="graph-toolbar__eyebrow">
                  {view.level === "topics" ? "Выбор тем" : "Выбор элементов"}
                </span>
                <h2>{scene?.title ?? "Граф знаний"}</h2>
              </div>
              <div className="trajectory-toolbar-actions">
                {view.level === "elements" ? (
                  <button
                    className="ghost-button"
                    onClick={() => setView({ level: "topics" })}
                    type="button"
                  >
                    К темам
                  </button>
                ) : null}
                <p className="graph-toolbar__hint">
                  {view.level === "topics"
                    ? "Клик по карточке выбирает тему. Кнопка внутри карточки открывает элементы."
                    : "Клик по зеленому формируемому элементу добавляет его в траекторию."}
                </p>
              </div>
            </div>

            <div className="graph-surface">
              {loading ? (
                <div className="status-view">
                  <div className="status-view__pulse" />
                  <h3>Загружаю граф</h3>
                  <p>Собираю темы, связи и элементы дисциплины.</p>
                </div>
              ) : !scene ? (
                <div className="status-view">
                  <h3>Нет данных для конструктора</h3>
                  <p>Сначала добавь темы и формируемые элементы в граф знаний.</p>
                </div>
              ) : (
                <div className="graph-frame">
                  <GraphNodeRuntimeStateProvider value={graphNodeRuntimeState}>
                    <RelationGraph
                      ref={graphRef}
                      options={GRAPH_OPTIONS}
                      nodeSlot={GraphNode}
                    />
                  </GraphNodeRuntimeStateProvider>
                </div>
              )}

              {scene ? (
                <aside className="trajectory-state-legend" aria-label="Состояния вершин">
                  <strong>Состояния</strong>
                  <span>
                    <i className="trajectory-state-dot trajectory-state-dot--blocked" />
                    Заблокировано
                  </span>
                  <span>
                    <i className="trajectory-state-dot trajectory-state-dot--selected" />
                    Выбрано
                  </span>
                  <span>
                    <i className="trajectory-state-dot trajectory-state-dot--available" />
                    Можно выбрать
                  </span>
                </aside>
              ) : null}

              {scene ? (
                <aside className="trajectory-floating-summary">
                  <strong>Траектория</strong>
                  <span>{selectedTopicIds.length} тем</span>
                  <span>{selectedElementCount} элементов</span>
                </aside>
              ) : null}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
