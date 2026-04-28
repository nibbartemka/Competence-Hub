import type { JsonLine, JsonNode } from "relation-graph-react";

import type {
  DetailCard,
  DisciplineKnowledgeGraph,
  GraphScene,
  LegendItem,
  SceneNodeData,
  Topic,
  TopicDependency,
  TopicKnowledgeElement,
} from "./types";

function competenceLabel(type: string) {
  if (type === "know") return "Знать";
  if (type === "can") return "Уметь";
  return "Владеть";
}

function roleLabel(role: string) {
  return role === "required" ? "Требуется" : "Формируется";
}

export function relationLabel(type: string) {
  const labels: Record<string, string> = {
    requires: "Требует",
    builds_on: "Строится на",
    contains: "Содержит",
    part_of: "Часть",
    property_of: "Свойство",
    refines: "Уточняет",
    generalizes: "Обобщает",
    similar: "Родственно",
    contrasts_with: "Противопоставлено",
    used_with: "Используется вместе",
    implements: "Реализует",
    automates: "Автоматизирует",
    possible_flow: "Требуется",
  };
  return labels[type] ?? type;
}

export function isSupportedElementRelation(
  sourceType: string | undefined,
  targetType: string | undefined,
  relationType: string,
) {
  if (sourceType === "know" && targetType === "know") {
    return [
      "requires",
      "builds_on",
      "contains",
      "part_of",
      "property_of",
      "refines",
      "generalizes",
      "similar",
      "contrasts_with",
      "used_with",
    ].includes(relationType);
  }

  if (sourceType === "know" && targetType === "can") {
    return relationType === "implements";
  }

  if (sourceType === "can" && targetType === "master") {
    return relationType === "automates";
  }

  return false;
}

export function isBidirectionalRelation(type: string) {
  return type === "similar" || type === "contrasts_with" || type === "used_with";
}

export function buildRelatedElementNames(
  graph: DisciplineKnowledgeGraph,
  elementId: string,
  scopedElementIds?: ReadonlySet<string>,
) {
  const elementById = new Map(graph.knowledge_elements.map((element) => [element.id, element]));
  const relatedNames = new Set<string>();

  for (const relation of graph.knowledge_element_relations) {
    const isSourceMatch = relation.source_element_id === elementId;
    const isTargetMatch = relation.target_element_id === elementId;

    if (!isSourceMatch && !isTargetMatch) {
      continue;
    }

    const otherElementId = isSourceMatch
      ? relation.target_element_id
      : relation.source_element_id;

    if (scopedElementIds && !scopedElementIds.has(otherElementId)) {
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

    const relatedName = elementById.get(otherElementId)?.name;
    if (relatedName) {
      relatedNames.add(relatedName);
    }
  }

  return [...relatedNames].sort((left, right) => left.localeCompare(right, "ru"));
}

function fullText(value: string | null | undefined, fallback: string) {
  if (!value) return fallback;
  return value;
}

function estimateCardHeight(
  description: string | null | undefined,
  fallback: string,
  minHeight: number,
  maxHeight: number,
  charsPerLine: number,
) {
  const text = description?.trim() || fallback;
  const approximateLines = Math.max(2, Math.ceil(text.length / charsPerLine));
  return Math.min(maxHeight, minHeight + approximateLines * 18);
}

function estimateTopicNodeHeight(description: string | null | undefined) {
  return estimateCardHeight(
    description,
    "Открой тему, чтобы увидеть требуемые и формируемые элементы.",
    184,
    360,
    28,
  );
}

function estimateElementNodeHeight(description: string | null | undefined) {
  return estimateCardHeight(
    description,
    "Описание элемента пока не добавлено.",
    146,
    220,
    22,
  );
}

function estimateFocusNodeHeight(description: string | null | undefined) {
  return estimateCardHeight(
    description,
    "Клик по центральной теме вернет тебя к графу тем.",
    188,
    300,
    26,
  );
}

function topicDependencyVisual(type: string) {
  return {
    color: "#365a95",
    text: "Требуется",
  };
}

function computeTopicLevels(topics: Topic[], dependencies: TopicDependency[]) {
  const inDegree = new Map<string, number>();
  const levelById = new Map<string, number>();
  const children = new Map<string, string[]>();

  for (const topic of topics) {
    inDegree.set(topic.id, 0);
    children.set(topic.id, []);
  }

  for (const dependency of dependencies) {
    inDegree.set(
      dependency.dependent_topic_id,
      (inDegree.get(dependency.dependent_topic_id) ?? 0) + 1,
    );
    children.get(dependency.prerequisite_topic_id)?.push(dependency.dependent_topic_id);
  }

  const queue = topics
    .filter((topic) => (inDegree.get(topic.id) ?? 0) === 0)
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));

  for (const topic of queue) {
    levelById.set(topic.id, 0);
  }

  const processed = new Set<string>();

  while (queue.length) {
    const current = queue.shift()!;
    processed.add(current.id);
    const currentLevel = levelById.get(current.id) ?? 0;

    for (const childId of children.get(current.id) ?? []) {
      levelById.set(childId, Math.max(levelById.get(childId) ?? 0, currentLevel + 1));
      inDegree.set(childId, (inDegree.get(childId) ?? 0) - 1);
      if ((inDegree.get(childId) ?? 0) <= 0) {
        const child = topics.find((topic) => topic.id === childId);
        if (child) {
          queue.push(child);
        }
      }
    }
  }

  for (const topic of topics) {
    if (!processed.has(topic.id)) {
      const parentLevels = dependencies
        .filter((dependency) => dependency.dependent_topic_id === topic.id)
        .map((dependency) => levelById.get(dependency.prerequisite_topic_id) ?? 0);
      levelById.set(topic.id, parentLevels.length ? Math.max(...parentLevels) + 1 : 0);
    }
  }

  return levelById;
}

function topicMetrics(
  topicId: string,
  allLinks: TopicKnowledgeElement[],
  dependencies: TopicDependency[],
) {
  const topicLinks = allLinks.filter((item) => item.topic_id === topicId);
  const requiredCount = topicLinks.filter((item) => item.role === "required").length;
  const formedCount = topicLinks.filter((item) => item.role === "formed").length;
  const incomingCount = dependencies.filter(
    (item) => item.prerequisite_topic_id === topicId,
  ).length;
  const outgoingCount = dependencies.filter(
    (item) => item.dependent_topic_id === topicId,
  ).length;

  return { requiredCount, formedCount, incomingCount, outgoingCount };
}

function findFormationTopicId(
  graph: DisciplineKnowledgeGraph,
  currentTopicId: string,
  elementId: string,
) {
  const topicById = new Map(graph.topics.map((topic) => [topic.id, topic]));
  const formedTopicIds = [
    ...new Set(
      graph.topic_knowledge_elements
        .filter((item) => item.element_id === elementId && item.role === "formed")
        .map((item) => item.topic_id),
    ),
  ];

  if (!formedTopicIds.length) {
    return undefined;
  }

  formedTopicIds.sort((left, right) => {
    if (left === currentTopicId) return -1;
    if (right === currentTopicId) return 1;

    const leftName = topicById.get(left)?.name ?? "";
    const rightName = topicById.get(right)?.name ?? "";
    return leftName.localeCompare(rightName, "ru");
  });

  return formedTopicIds[0];
}

function buildTopicDetailCard(
  topic: Topic,
  allLinks: TopicKnowledgeElement[],
  dependencies: TopicDependency[],
): DetailCard {
  const metrics = topicMetrics(topic.id, allLinks, dependencies);

  return {
    title: topic.name,
    subtitle: "Тема дисциплины",
    description: topic.description ?? "Описание темы пока не добавлено.",
    chips: [
      { label: `Требует ЗУН: ${metrics.requiredCount}`, tone: "required" },
      { label: `Формирует ЗУН: ${metrics.formedCount}`, tone: "formed" },
    ],
    stats: [
      { label: "Входящие дуги", value: String(metrics.incomingCount) },
      { label: "Исходящие дуги", value: String(metrics.outgoingCount) },
      { label: "Необходимые элементы", value: String(metrics.requiredCount) },
      { label: "Новые элементы", value: String(metrics.formedCount) },
    ],
    footnote:
      "Клик по карточке темы на графе выделяет ее, а внутренняя кнопка открывает уровень элементов.",
  };
}

function topicLegend(): LegendItem[] {
  return [
    // {
    //   label: "Тема",
    //   hint: "Клик по карточке только выделяет тему.",
    //   tone: "topic",
    // },
    // {
    //   label: "Требуется",
    //   hint: "Синяя стрелка показывает обязательную зависимость между темами.",
    //   tone: "line",
    // },
    // {
    //   label: "Возможен путь",
    //   hint: "Зеленая стрелка показывает допустимый, но не обязательный переход.",
    //   tone: "line",
    // },
  ];
}

function elementLegend(): LegendItem[] {
  return [
    // {
    //   label: "Требуемый элемент",
    //   hint: "Нужен, чтобы начать изучение темы. Линия направлена к теме.",
    //   tone: "required",
    // },
    // {
    //   label: "Формируемый элемент",
    //   hint: "Появляется в результате изучения темы. Линия направлена от темы.",
    //   tone: "formed",
    // },
    // {
    //   label: "Связь элементов",
    //   hint: "Дополнительная семантическая связь между элементами внутри темы.",
    //   tone: "relation",
    // },
  ];
}

function buildTopicNodeData(
  topic: Topic,
  allLinks: TopicKnowledgeElement[],
  dependencies: TopicDependency[],
): SceneNodeData {
  const metrics = topicMetrics(topic.id, allLinks, dependencies);

  return {
    entity: "topic",
    tone: "topic",
    badgeTone: "topic",
    accentTone: "topic",
    badge: "Тема",
    title: topic.name,
    subtitle: "Первый уровень графа",
    description: fullText(
      topic.description,
      "Открой тему, чтобы увидеть требуемые и формируемые элементы.",
    ),
    metrics: [`Треб. ЗУН ${metrics.requiredCount}`, `Форм. ЗУН ${metrics.formedCount}`],
    hint: "Открыть элементы",
    topicId: topic.id,
  };
}

export function buildTopicScene(
  graph: DisciplineKnowledgeGraph,
  preferredNodeId?: string,
): GraphScene {
  const levelById = computeTopicLevels(graph.topics, graph.topic_dependencies);
  const topicsByLevel = new Map<number, Topic[]>();

  for (const topic of graph.topics) {
    const level = levelById.get(topic.id) ?? 0;
    const bucket = topicsByLevel.get(level) ?? [];
    bucket.push(topic);
    topicsByLevel.set(level, bucket);
  }

  const levels = [...topicsByLevel.keys()].sort((left, right) => left - right);
  const nodes: JsonNode[] = [];
  const detailsByNodeId: Record<string, DetailCard> = {};
  const rootTopicId =
    graph.topics
      .slice()
      .sort((left, right) => (levelById.get(left.id) ?? 0) - (levelById.get(right.id) ?? 0))[0]
      ?.id ?? "";

  for (const level of levels) {
    const topics = (topicsByLevel.get(level) ?? []).sort((left, right) =>
      left.name.localeCompare(right.name, "ru"),
    );
    const x = 180 + level * 270;
    const totalHeight = Math.max((topics.length - 1) * 320, 0);

    topics.forEach((topic, index) => {
      const nodeHeight = estimateTopicNodeHeight(topic.description);
      const y = 170 + index * 320 - totalHeight / 2 + 260;
      const nodeId = `topic:${topic.id}`;

      nodes.push({
        id: nodeId,
        text: topic.name,
        x,
        y,
        width: 260,
        height: nodeHeight,
        nodeShape: 1,
        data: buildTopicNodeData(topic, graph.topic_knowledge_elements, graph.topic_dependencies),
      });

      detailsByNodeId[nodeId] = buildTopicDetailCard(
        topic,
        graph.topic_knowledge_elements,
        graph.topic_dependencies,
      );
    });
  }

  const lines: JsonLine[] = graph.topic_dependencies.map((dependency) => {
    const visual = topicDependencyVisual(dependency.relation_type);

    return {
      from: `topic:${dependency.dependent_topic_id}`,
      to: `topic:${dependency.prerequisite_topic_id}`,
      color: visual.color,
      fontColor: visual.color,
      lineWidth: 2,
      animation: 1,
      text: visual.text,
      textOffset_y: -16,
      showEndArrow: true,
      data: {
        kind: "topic-dependency",
        relationType: dependency.relation_type,
      },
    };
  });

  const defaultSelectedNodeId =
    preferredNodeId && detailsByNodeId[preferredNodeId]
      ? preferredNodeId
      : rootTopicId
        ? `topic:${rootTopicId}`
        : "";

  return {
    key: `topics:${graph.discipline.id}`,
    title: graph.discipline.name,
    subtitle:
      "Граф знаний дисциплины включает 2 уровня: темы и элементы ЗУН.",
    rootId: defaultSelectedNodeId,
    nodes,
    lines,
    defaultSelectedNodeId,
    detailsByNodeId,
    legend: topicLegend(),
  };
}

function createElementNodeData(
  name: string,
  competenceType: string,
  role: string,
  description?: string | null,
  _actionTopicId?: string,
): SceneNodeData {
  return {
    entity: "element",
    tone: role === "required" ? "required" : "formed",
    badgeTone: competenceType as "know" | "can" | "master",
    accentTone: competenceType as "know" | "can" | "master",
    badge: competenceLabel(competenceType),
    title: name,
    subtitle: roleLabel(role),
    description: fullText(description, "Описание элемента пока не добавлено."),
    metrics: [],
    hint: "Показать детали",
  };
}

function createElementNavigationNodeData(
  name: string,
  competenceType: string,
  role: string,
  description?: string | null,
  actionTopicId?: string,
): SceneNodeData {
  const nodeData = createElementNodeData(
    name,
    competenceType,
    role,
    description,
    actionTopicId,
  );

  return {
    ...nodeData,
    hint: actionTopicId ? "Где изучается" : undefined,
    actionTopicId,
  };
}

function buildElementDetailCard(
  topic: Topic,
  link: TopicKnowledgeElement,
  graph: DisciplineKnowledgeGraph,
): DetailCard {
  const element = graph.knowledge_elements.find((item) => item.id === link.element_id);
  const topicElementIds = new Set(
    graph.topic_knowledge_elements
      .filter((item) => item.topic_id === topic.id)
      .map((item) => item.element_id),
  );
  const relatedElementNames = buildRelatedElementNames(graph, link.element_id, topicElementIds);

  return {
    title: element?.name ?? "Элемент",
    subtitle: `${competenceLabel(element?.competence_type ?? "know")} • ${roleLabel(link.role)}`,
    description: element?.description ?? "Описание элемента пока не задано.",
    chips: [
      {
        label: competenceLabel(element?.competence_type ?? "know"),
        tone: "topic",
      },
      {
        label: roleLabel(link.role),
        tone: link.role === "required" ? "required" : "formed",
      },
    ],
    stats: [
      { label: "Роль в теме", value: roleLabel(link.role) },
      { label: "Тип компетенции", value: competenceLabel(element?.competence_type ?? "know") },
      {
        label: "Связи с элементами",
        value: relatedElementNames.length
          ? relatedElementNames
          : "В текущем графе темы связей нет.",
      },
      { label: "Текущая тема", value: topic.name },
    ],
    footnote:
      "Элемент может переиспользоваться в других темах, но здесь показана его роль именно в выбранной теме.",
  };
}

function buildTopicFocusDetail(topic: Topic, topicLinks: TopicKnowledgeElement[]): DetailCard {
  const requiredCount = topicLinks.filter((item) => item.role === "required").length;
  const formedCount = topicLinks.filter((item) => item.role === "formed").length;

  return {
    title: topic.name,
    subtitle: "Центр второго уровня",
    description:
      topic.description ??
      "Эта тема связана с требуемыми и формируемыми элементами компетенций.",
    chips: [
      { label: `Необходимых элементов - ${requiredCount}`, tone: "required" },
      { label: `Новых элементов - ${formedCount}`, tone: "formed" },
    ],
    stats: [
      { label: "Требуемых элементов", value: String(requiredCount) },
      { label: "Формируемых элементов", value: String(formedCount) },
      { label: "Всего элементов", value: String(topicLinks.length) },
      { label: "Переход", value: "Клик вернет к темам" },
    ],
    footnote:
      "Линии к теме читаются как предпосылки, линии от темы как результат изучения.",
  };
}

function positionColumn(
  items: TopicKnowledgeElement[],
  x: number,
  startY: number,
  rowGap: number,
) {
  const totalHeight = Math.max((items.length - 1) * rowGap, 0);
  return items.map((item, index) => ({
    link: item,
    x,
    y: startY + index * rowGap - totalHeight / 2,
  }));
}

export function buildElementScene(
  graph: DisciplineKnowledgeGraph,
  topicId: string,
  preferredNodeId?: string,
): GraphScene {
  const topic = graph.topics.find((item) => item.id === topicId);

  if (!topic) {
    return {
      key: `missing-topic:${topicId}`,
      title: "Тема не найдена",
      subtitle: "Вернись к списку тем и выбери существующую вершину.",
      rootId: "",
      nodes: [],
      lines: [],
      defaultSelectedNodeId: "",
      detailsByNodeId: {},
      legend: elementLegend(),
    };
  }

  const links = graph.topic_knowledge_elements.filter((item) => item.topic_id === topic.id);
  const elementsById = new Map(graph.knowledge_elements.map((element) => [element.id, element]));

  const requiredLinks = links.filter((item) => item.role === "required");
  const formedLinks = links.filter((item) => item.role === "formed");

  const nodes: JsonNode[] = [];
  const detailsByNodeId: Record<string, DetailCard> = {};
  const focusNodeId = `topic-focus:${topic.id}`;

  nodes.push({
    id: focusNodeId,
    text: topic.name,
    x: 530,
    y: 360,
    width: 286,
    height: estimateFocusNodeHeight(topic.description),
    nodeShape: 1,
    data: {
      entity: "topic-focus",
      tone: "topic",
      badgeTone: "topic",
      accentTone: "topic",
      badge: "Тема",
      title: topic.name,
      subtitle: "Второй уровень графа",
      description: fullText(topic.description, "Клик по центральной теме вернет тебя к графу тем."),
      metrics: [`Req ${requiredLinks.length}`, `New ${formedLinks.length}`],
      hint: "Вернуться к темам",
      topicId: topic.id,
    } satisfies SceneNodeData,
  });
  detailsByNodeId[focusNodeId] = buildTopicFocusDetail(topic, links);

  const positionedRequired = positionColumn(requiredLinks, 150, 360, 210);
  const positionedFormed = positionColumn(formedLinks, 930, 360, 210);

  for (const item of [...positionedRequired, ...positionedFormed]) {
    const element = elementsById.get(item.link.element_id);
    if (!element) {
      continue;
    }

    const actionTopicId = findFormationTopicId(graph, topic.id, element.id);

    const nodeId = `element:${topic.id}:${element.id}`;
    nodes.push({
      id: nodeId,
      text: element.name,
      x: item.x,
      y: item.y,
      width: 210,
      height: estimateElementNodeHeight(element.description),
      nodeShape: 1,
      data: createElementNavigationNodeData(
        element.name,
        element.competence_type,
        item.link.role,
        element.description,
        actionTopicId,
      ),
    });
    detailsByNodeId[nodeId] = buildElementDetailCard(topic, item.link, graph);
  }

  const lines: JsonLine[] = [];

  for (const link of requiredLinks) {
    lines.push({
      from: `element:${topic.id}:${link.element_id}`,
      to: focusNodeId,
      text: "требуется",
      color: "#7a8bb3",
      fontColor: "#607091",
      dashType: 2,
      animation: 2,
      lineWidth: 2,
      showEndArrow: true,
    });
  }

  for (const link of formedLinks) {
    lines.push({
      from: focusNodeId,
      to: `element:${topic.id}:${link.element_id}`,
      text: "формирует",
      color: "#178364",
      fontColor: "#146c53",
      lineWidth: 2.4,
      animation: 1,
      showEndArrow: true,
    });
  }

  const scopedElementIds = new Set(links.map((item) => item.element_id));
  for (const relation of graph.knowledge_element_relations) {
    if (
      !scopedElementIds.has(relation.source_element_id) ||
      !scopedElementIds.has(relation.target_element_id)
    ) {
      continue;
    }

    const sourceElement = elementsById.get(relation.source_element_id);
    const targetElement = elementsById.get(relation.target_element_id);
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

  const defaultSelectedNodeId =
    preferredNodeId && detailsByNodeId[preferredNodeId] ? preferredNodeId : focusNodeId;

  return {
    key: `elements:${graph.discipline.id}:${topic.id}`,
    title: `${graph.discipline.name} / ${topic.name}`,
    subtitle:
      "Здесь видно, какие элементы нужны до старта темы, а какие формируются в результате ее изучения.",
    rootId: focusNodeId,
    nodes,
    lines,
    defaultSelectedNodeId,
    detailsByNodeId,
    legend: elementLegend(),
  };
}
