import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createKnowledgeElement,
  createKnowledgeElementRelation,
  createStructuredMasterKnowledgeElement,
  createTopic,
  createTopicKnowledgeElement,
  deleteKnowledgeElement,
  deleteKnowledgeElementRelation,
  deleteTopic,
  deleteTopicWithFormedElements,
  fetchKnowledgeElements,
  fetchOperationContracts,
  fetchRelations,
  isAbortError,
  updateKnowledgeElement,
  updateStructuredMasterKnowledgeElement,
  updateStructuredSkillKnowledgeElement,
  updateKnowledgeElementRelation,
  updateTopic,
} from "../api";
import { useNotifications } from "../notifications";
import type {
  CompetenceType,
  KnowledgeElement,
  KnowledgeElementRelation,
  KnowledgeElementRelationType,
  OperationContract,
  Relation,
  Topic,
  TopicDependency,
  TopicKnowledgeElement,
  TopicKnowledgeElementRole,
} from "../types";

type GraphEditorProps = {
  disciplineId: string;
  disciplineElements: KnowledgeElement[];
  initialTab?: EditorTab;
  knowledgeElementRelations: KnowledgeElementRelation[];
  onDataChanged: () => Promise<void>;
  topicDependencies: TopicDependency[];
  topicKnowledgeElements: TopicKnowledgeElement[];
  topics: Topic[];
};

type Feedback = {
  kind: "error" | "success";
  text: string;
};

type EditorTab = "topics" | "elements" | "relations";

type ConfirmDeleteState =
  | {
      entityId: string;
      entityName: string;
      entityType: "topic" | "topic-with-elements" | "element" | "element-relation";
      relationNames?: string[];
      text?: string;
    }
  | null;

type ConfirmCompetenceChangeState = {
  nextCompetence: CompetenceType;
  relationNames: string[];
} | null;

type TopicNewElementDraft = {
  automatedSkillDraftIds: string[];
  clientId: string;
  competenceType: CompetenceType;
  description: string;
  masterDomainObjects: MasterDomainObjectDraft[];
  name: string;
  operationRef: string;
  realizedKnowledgeDraftIds: string[];
  subjectAreaDescription: string;
};

type MasterDomainObjectDraft = {
  clientId: string;
  knowledgeElementId: string;
  objectName: string;
};

type RelationDirection = "element1_to_element2" | "element2_to_element1";

type SearchableOption = {
  id: string;
  label: string;
};

type TopicDraftKnowledgeOption = {
  description: string;
  id: string;
  label: string;
};

const COMPETENCE_OPTIONS: Array<{ label: string; value: CompetenceType }> = [
  { label: "Знать", value: "know" },
  { label: "Уметь", value: "can" },
  { label: "Владеть", value: "master" },
];

const TOPIC_LINK_ROLE_OPTIONS: Array<{ label: string; value: TopicKnowledgeElementRole }> = [
  { label: "Требуется", value: "required" },
  { label: "Формируется", value: "formed" },
];

const KNOW_TO_KNOW_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [
  { label: "Требует", value: "requires" },
  { label: "Строится на", value: "builds_on" },
  { label: "Содержит", value: "contains" },
  { label: "Является частью", value: "part_of" },
  { label: "Свойство объекта", value: "property_of" },
  { label: "Уточняет", value: "refines" },
  { label: "Обобщает", value: "generalizes" },
  { label: "Родственно", value: "similar" },
  { label: "Противопоставляется", value: "contrasts_with" },
  { label: "Используется вместе", value: "used_with" },
];

const CAN_TO_CAN_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [
  { label: "Требует", value: "requires" },
  { label: "Строится на", value: "builds_on" },
  { label: "Содержит", value: "contains" },
  { label: "Является частью", value: "part_of" },
  { label: "Уточняет", value: "refines" },
  { label: "Обобщает", value: "generalizes" },
  { label: "Родственно", value: "similar" },
  { label: "Противопоставляется", value: "contrasts_with" },
  { label: "Используется вместе", value: "used_with" },
];

const MASTER_TO_MASTER_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [
  { label: "Требует", value: "requires" },
  { label: "Содержит", value: "contains" },
  { label: "Является частью", value: "part_of" },
  { label: "Уточняет", value: "refines" },
  { label: "Обобщает", value: "generalizes" },
  { label: "Родственно", value: "similar" },
  { label: "Противопоставляется", value: "contrasts_with" },
  { label: "Используется вместе", value: "used_with" },
];

const CAN_TO_KNOW_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [{ label: "Реализует", value: "implements" }];

const MASTER_TO_CAN_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [{ label: "Автоматизирует", value: "automates" }];

const MASTER_TO_KNOW_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [{ label: "Опирается на", value: "relies_on" }];

const TOPIC_DRAFT_KNOWLEDGE_EXISTING_PREFIX = "existing:";
const TOPIC_DRAFT_KNOWLEDGE_NEW_PREFIX = "draft:";

function competenceLabel(value: CompetenceType) {
  return COMPETENCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function relationTypeLabel(value: KnowledgeElementRelationType) {
  return (
    [
      ...KNOW_TO_KNOW_RELATION_OPTIONS,
      ...CAN_TO_CAN_RELATION_OPTIONS,
      ...MASTER_TO_MASTER_RELATION_OPTIONS,
      ...CAN_TO_KNOW_RELATION_OPTIONS,
      ...MASTER_TO_CAN_RELATION_OPTIONS,
      ...MASTER_TO_KNOW_RELATION_OPTIONS,
    ].find((option) => option.value === value)?.label ?? value
  );
}

function topicDependencyRelationLabel(value: TopicDependency["relation_type"]) {
  if (value === "requires") {
    return "Требует";
  }
  if (value === "possible_flow") {
    return "Возможный переход";
  }
  return value;
}

function isDeletionBlockedByRelation(
  element: KnowledgeElement,
  relation: KnowledgeElementRelation,
  elementById: Map<string, KnowledgeElement>,
) {
  if (relation.target_element_id !== element.id) {
    return false;
  }

  const sourceElement = elementById.get(relation.source_element_id);
  if (!sourceElement) {
    return false;
  }

  return (
    (element.competence_type === "know" &&
      (sourceElement.competence_type === "can" ||
        sourceElement.competence_type === "master")) ||
    (element.competence_type === "can" &&
      sourceElement.competence_type === "master")
  );
}

const RELATION_DIRECTION_OPTIONS: Array<{
  label: string;
  value: RelationDirection;
}> = [
  { label: "Элемент 1 -> Элемент 2", value: "element1_to_element2" },
  { label: "Элемент 2 -> Элемент 1", value: "element2_to_element1" },
];

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось выполнить запрос.";
}

function uniqueElements(
  disciplineElements: KnowledgeElement[],
  allElements: KnowledgeElement[],
  disciplineId: string,
) {
  const byId = new Map<string, KnowledgeElement>();

  // Elements coming from the discipline graph are already scoped by backend.
  for (const element of disciplineElements) {
    byId.set(element.id, element);
  }

  for (const element of allElements) {
    if (element.discipline_id === disciplineId) {
      byId.set(element.id, element);
    }
  }

  return [...byId.values()].sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

function createDraft(): TopicNewElementDraft {
  return {
    automatedSkillDraftIds: [],
    clientId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    competenceType: "know",
    description: "",
    masterDomainObjects: [],
    name: "",
    operationRef: "",
    realizedKnowledgeDraftIds: [],
    subjectAreaDescription: "",
  };
}

function createMasterDomainObjectDraft(
  knowledgeElementId = "",
): MasterDomainObjectDraft {
  return {
    clientId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    knowledgeElementId,
    objectName: "",
  };
}

function topicDraftOptionLabel(draft: TopicNewElementDraft) {
  const fallbackName = draft.competenceType === "know"
    ? "Новое знание"
    : draft.competenceType === "can"
      ? "Новое умение"
      : "Новый элемент владения";

  return draft.name.trim() || fallbackName;
}

function createExistingTopicDraftKnowledgeOption(element: KnowledgeElement): TopicDraftKnowledgeOption {
  return {
    description: element.description?.trim() ?? "",
    id: `${TOPIC_DRAFT_KNOWLEDGE_EXISTING_PREFIX}${element.id}`,
    label: element.name,
  };
}

function createNewTopicDraftKnowledgeOption(draft: TopicNewElementDraft): TopicDraftKnowledgeOption {
  return {
    description: draft.description.trim(),
    id: `${TOPIC_DRAFT_KNOWLEDGE_NEW_PREFIX}${draft.clientId}`,
    label: topicDraftOptionLabel(draft),
  };
}

function resolveTopicDraftKnowledgeElementId(
  knowledgeReferenceId: string,
  createdDraftElementIds: Map<string, string>,
) {
  if (knowledgeReferenceId.startsWith(TOPIC_DRAFT_KNOWLEDGE_EXISTING_PREFIX)) {
    return knowledgeReferenceId.slice(TOPIC_DRAFT_KNOWLEDGE_EXISTING_PREFIX.length);
  }

  if (knowledgeReferenceId.startsWith(TOPIC_DRAFT_KNOWLEDGE_NEW_PREFIX)) {
    return createdDraftElementIds.get(
      knowledgeReferenceId.slice(TOPIC_DRAFT_KNOWLEDGE_NEW_PREFIX.length),
    );
  }

  return createdDraftElementIds.get(knowledgeReferenceId) ?? knowledgeReferenceId;
}

function uniqueTopicOptions(topicsList: Topic[]) {
  return topicsList
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name, "ru"));
}

function elementOptionLabel(element: KnowledgeElement) {
  return `${element.name} (${competenceLabel(element.competence_type)})`;
}

function matchesElementFilter(element: KnowledgeElement, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  return `${element.name} ${competenceLabel(element.competence_type)}`
    .toLowerCase()
    .includes(normalized);
}

function matchesRelationFilter(
  relation: KnowledgeElementRelation,
  elementById: Map<string, KnowledgeElement>,
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) {
    return true;
  }

  const sourceName = elementById.get(relation.source_element_id)?.name ?? "";
  const targetName = elementById.get(relation.target_element_id)?.name ?? "";
  const relationName = relationTypeLabel(relation.relation.relation_type);
  return `${sourceName} ${targetName} ${relationName}`.toLowerCase().includes(normalized);
}

type SearchableSelectFieldProps = {
  disabled?: boolean;
  emptyText: string;
  label: string;
  onSelect: (id: string) => void;
  onValueChange: (value: string) => void;
  options: SearchableOption[];
  placeholder: string;
  value: string;
};

function SearchableSelectField({
  disabled = false,
  emptyText,
  label,
  onSelect,
  onValueChange,
  options,
  placeholder,
  value,
}: SearchableSelectFieldProps) {
  const [isOpen, setIsOpen] = useState(false);

  const filteredOptions = useMemo(() => {
    const normalized = value.trim().toLowerCase();
    if (!normalized) {
      return options;
    }

    return options.filter((option) => option.label.toLowerCase().startsWith(normalized));
  }, [options, value]);

  return (
    <label className="field searchable-select">
      <span>{label}</span>
      <div className="searchable-select__control">
        <input
          autoComplete="off"
          spellCheck={false}
          value={value}
          onBlur={() => {
            window.setTimeout(() => setIsOpen(false), 120);
          }}
          onChange={(event) => {
            const nextValue = event.target.value;
            onValueChange(nextValue);
            const exactMatch = options.find(
              (option) => option.label.toLowerCase() === nextValue.trim().toLowerCase(),
            );
            onSelect(exactMatch?.id ?? "");
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          disabled={disabled}
        />
        {value && !disabled ? (
          <button
            className="searchable-select__clear"
            type="button"
            aria-label={`Очистить поле ${label}`}
            onMouseDown={(event) => {
              event.preventDefault();
              onValueChange("");
              onSelect("");
              setIsOpen(true);
            }}
          >
            ×
          </button>
        ) : null}

        {isOpen && !disabled ? (
          <div className="searchable-select__menu">
            {filteredOptions.length ? (
              filteredOptions.map((option) => (
                <button
                  className="searchable-select__option"
                  key={option.id}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    onValueChange(option.label);
                    onSelect(option.id);
                    setIsOpen(false);
                  }}
                  type="button"
                >
                  {option.label}
                </button>
              ))
            ) : (
              <div className="searchable-select__empty">{emptyText}</div>
            )}
          </div>
        ) : null}
      </div>
    </label>
  );
}

function canAttachElementAsFormed(
  formedTopicIdsByElementId: Map<string, string[]>,
  {
    elementId,
    topicId,
  }: {
    elementId: string;
    topicId: string;
  },
) {
  return !(formedTopicIdsByElementId.get(elementId) ?? []).some(
    (formedTopicId) => formedTopicId !== topicId,
  );
}

function canAttachElementAsRequired(
  formedTopicIdsByElementId: Map<string, string[]>,
  {
    elementId,
    topicId,
  }: {
    elementId: string;
    topicId?: string;
  },
) {
  return (formedTopicIdsByElementId.get(elementId) ?? []).some(
    (formedTopicId) => !topicId || formedTopicId !== topicId,
  );
}

function getAttachableRolesForTopicElement(
  formedTopicIdsByElementId: Map<string, string[]>,
  {
    elementId,
    topicId,
  }: {
    elementId: string;
    topicId?: string;
  },
): TopicKnowledgeElementRole[] {
  if (!topicId) {
    return [];
  }

  return TOPIC_LINK_ROLE_OPTIONS.filter((option) => {
    if (option.value === "formed") {
      return canAttachElementAsFormed(formedTopicIdsByElementId, {
        elementId,
        topicId,
      });
    }

    return canAttachElementAsRequired(formedTopicIdsByElementId, {
      elementId,
      topicId,
    });
  }).map((option) => option.value);
}

function getRelationOptions(
  relations: Relation[],
  sourceType?: CompetenceType,
  targetType?: CompetenceType,
): Array<{ label: string; value: string; relation: Relation }> {
  let allowedTypes: KnowledgeElementRelationType[] = [];

  if (sourceType === "know" && targetType === "know") {
    allowedTypes = KNOW_TO_KNOW_RELATION_OPTIONS.map((option) => option.value);
  } else if (sourceType === "can" && targetType === "can") {
    allowedTypes = CAN_TO_CAN_RELATION_OPTIONS.map((option) => option.value);
  } else if (sourceType === "can" && targetType === "know") {
    allowedTypes = CAN_TO_KNOW_RELATION_OPTIONS.map((option) => option.value);
  } else if (sourceType === "master" && targetType === "master") {
    allowedTypes = MASTER_TO_MASTER_RELATION_OPTIONS.map((option) => option.value);
  } else if (sourceType === "master" && targetType === "can") {
    allowedTypes = MASTER_TO_CAN_RELATION_OPTIONS.map((option) => option.value);
  } else if (sourceType === "master" && targetType === "know") {
    allowedTypes = MASTER_TO_KNOW_RELATION_OPTIONS.map((option) => option.value);
  }

  const allowedSet = new Set(allowedTypes);
  return relations
    .filter((relation) => allowedSet.has(relation.relation_type))
    .map((relation) => ({
      label: relationTypeLabel(relation.relation_type),
      value: relation.id,
      relation,
    }));
}

function resolveRelationEndpoints(
  element1Id: string,
  element2Id: string,
  direction: RelationDirection,
) {
  if (direction === "element2_to_element1") {
    return {
      sourceElementId: element2Id,
      targetElementId: element1Id,
    };
  }

  return {
    sourceElementId: element1Id,
    targetElementId: element2Id,
  };
}

function resolveRelationElements(
  element1: KnowledgeElement | undefined,
  element2: KnowledgeElement | undefined,
  direction: RelationDirection,
) {
  if (direction === "element2_to_element1") {
    return {
      sourceElement: element2,
      targetElement: element1,
    };
  }

  return {
    sourceElement: element1,
    targetElement: element2,
  };
}

function isDuplicateRelationDefinition(
  relations: KnowledgeElementRelation[],
  {
    topicId,
    sourceElementId,
    targetElementId,
    relationId,
    excludeRelationId,
  }: {
    topicId: string;
    sourceElementId: string;
    targetElementId: string;
    relationId: string;
    excludeRelationId?: string;
  },
) {
  return relations.some((relation) => {
    if (excludeRelationId && relation.id === excludeRelationId) {
      return false;
    }
    return (
      relation.topic_id === topicId &&
      relation.source_element_id === sourceElementId &&
      relation.target_element_id === targetElementId &&
      relation.relation_id === relationId
    );
  });
}

export function GraphEditor({
  disciplineId,
  disciplineElements,
  initialTab = "topics",
  knowledgeElementRelations,
  onDataChanged,
  topicDependencies,
  topicKnowledgeElements,
  topics,
}: GraphEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>(initialTab);
  const [allElements, setAllElements] = useState<KnowledgeElement[]>([]);
  const [operationContracts, setOperationContracts] = useState<OperationContract[]>([]);
  const [relationCatalog, setRelationCatalog] = useState<Relation[]>([]);
  const [busyAction, setBusyAction] = useState("");
  const { pushNotification } = useNotifications();

  function setFeedback(nextFeedback: Feedback | null) {
    if (!nextFeedback) {
      return;
    }

    pushNotification(nextFeedback.kind, nextFeedback.text);
  }

  const [topicName, setTopicName] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [selectedRequiredElementIds, setSelectedRequiredElementIds] = useState<string[]>([]);
  const [topicNewElements, setTopicNewElements] = useState<TopicNewElementDraft[]>([]);
  const [editTopicId, setEditTopicId] = useState("");
  const [editTopicName, setEditTopicName] = useState("");
  const [editTopicDescription, setEditTopicDescription] = useState("");
  const [deleteTopicId, setDeleteTopicId] = useState("");

  const [elementName, setElementName] = useState("");
  const [elementDescription, setElementDescription] = useState("");
  const [elementCompetence, setElementCompetence] = useState<CompetenceType>("know");
  const [elementOperationRef, setElementOperationRef] = useState("");
  const [elementCreateTopicId, setElementCreateTopicId] = useState("");
  const [elementRealizedKnowledgeIds, setElementRealizedKnowledgeIds] = useState<string[]>([]);
  const [elementSubjectAreaDescription, setElementSubjectAreaDescription] = useState("");
  const [elementAutomatedSkillIds, setElementAutomatedSkillIds] = useState<string[]>([]);
  const [elementMasterDomainObjects, setElementMasterDomainObjects] = useState<
    MasterDomainObjectDraft[]
  >([]);
  const [topicElementTopicId, setTopicElementTopicId] = useState("");
  const [topicElementElementId, setTopicElementElementId] = useState("");
  const [topicElementRole, setTopicElementRole] =
    useState<TopicKnowledgeElementRole>("required");
  const [topicElementNote, setTopicElementNote] = useState("");
  const [editElementId, setEditElementId] = useState("");
  const [editElementName, setEditElementName] = useState("");
  const [editElementDescription, setEditElementDescription] = useState("");
  const [editElementCompetence, setEditElementCompetence] =
    useState<CompetenceType>("know");
  const [editElementTopicId, setEditElementTopicId] = useState("");
  const [editElementRealizedKnowledgeIds, setEditElementRealizedKnowledgeIds] = useState<string[]>([]);
  const [editElementSubjectAreaDescription, setEditElementSubjectAreaDescription] =
    useState("");
  const [editElementOperationRef, setEditElementOperationRef] = useState("");
  const [editElementAutomatedSkillIds, setEditElementAutomatedSkillIds] = useState<string[]>([]);
  const [editElementMasterDomainObjects, setEditElementMasterDomainObjects] = useState<
    MasterDomainObjectDraft[]
  >([]);
  const [deleteElementIds, setDeleteElementIds] = useState<string[]>([]);

  const [relationSourceElementId, setRelationSourceElementId] = useState("");
  const [relationTargetElementId, setRelationTargetElementId] = useState("");
  const [relationSourceFilter, setRelationSourceFilter] = useState("");
  const [relationTargetFilter, setRelationTargetFilter] = useState("");
  const [relationTopicId, setRelationTopicId] = useState("");
  const [relationDirection, setRelationDirection] =
    useState<RelationDirection>("element1_to_element2");
  const [relationDefinitionId, setRelationDefinitionId] = useState("");
  const [relationDescription, setRelationDescription] = useState("");
  const [editRelationId, setEditRelationId] = useState("");
  const [editRelationFilter, setEditRelationFilter] = useState("");
  const [editRelationSourceElementId, setEditRelationSourceElementId] = useState("");
  const [editRelationTargetElementId, setEditRelationTargetElementId] = useState("");
  const [editRelationSourceFilter, setEditRelationSourceFilter] = useState("");
  const [editRelationTargetFilter, setEditRelationTargetFilter] = useState("");
  const [editRelationTopicId, setEditRelationTopicId] = useState("");
  const [editRelationDirection, setEditRelationDirection] =
    useState<RelationDirection>("element1_to_element2");
  const [editRelationDefinitionId, setEditRelationDefinitionId] = useState("");
  const [editRelationDescription, setEditRelationDescription] = useState("");
  const [deleteRelationId, setDeleteRelationId] = useState("");
  const [deleteRelationFilter, setDeleteRelationFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<ConfirmDeleteState>(null);
  const [confirmCompetenceChange, setConfirmCompetenceChange] =
    useState<ConfirmCompetenceChangeState>(null);

  const sortedTopics = useMemo(
    () => topics.slice().sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [topics],
  );

  const sortedAllElements = useMemo(
    () => uniqueElements(disciplineElements, allElements, disciplineId),
    [allElements, disciplineElements, disciplineId],
  );

  const elementById = useMemo(
    () => new Map(sortedAllElements.map((element) => [element.id, element])),
    [sortedAllElements],
  );

  const topicById = useMemo(
    () => new Map(sortedTopics.map((topic) => [topic.id, topic])),
    [sortedTopics],
  );

  const topicKnowledgeElementsByTopicId = useMemo(() => {
    const result = new Map<string, TopicKnowledgeElement[]>();
    for (const link of topicKnowledgeElements) {
      result.set(link.topic_id, [...(result.get(link.topic_id) ?? []), link]);
    }
    return result;
  }, [topicKnowledgeElements]);

  const topicIdsByElementId = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const link of topicKnowledgeElements) {
      result.set(link.element_id, [...(result.get(link.element_id) ?? []), link.topic_id]);
    }
    return result;
  }, [topicKnowledgeElements]);

  const formedTopicIdsByElementId = useMemo(() => {
    const result = new Map<string, string[]>();
    for (const link of topicKnowledgeElements) {
      if (link.role !== "formed") {
        continue;
      }
      result.set(link.element_id, [...(result.get(link.element_id) ?? []), link.topic_id]);
    }
    return result;
  }, [topicKnowledgeElements]);

  const availableRequiredElementsForTopicCreation = useMemo(
    () =>
      sortedAllElements.filter((element) =>
        canAttachElementAsRequired(formedTopicIdsByElementId, {
          elementId: element.id,
        }),
      ),
    [formedTopicIdsByElementId, sortedAllElements],
  );

  const implementsRelation = useMemo(
    () => relationCatalog.find((relation) => relation.relation_type === "implements") ?? null,
    [relationCatalog],
  );
  const automatesRelation = useMemo(
    () => relationCatalog.find((relation) => relation.relation_type === "automates") ?? null,
    [relationCatalog],
  );
  const reliesOnRelation = useMemo(
    () => relationCatalog.find((relation) => relation.relation_type === "relies_on") ?? null,
    [relationCatalog],
  );

  const availableKnowledgeForNewSkillElement = useMemo(() => {
    if (!elementCreateTopicId) {
      return [];
    }
    return (topicKnowledgeElementsByTopicId.get(elementCreateTopicId) ?? [])
      .map((link) => elementById.get(link.element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element && (element.competence_type === "know" || element.competence_type === "can"),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [elementById, elementCreateTopicId, topicKnowledgeElementsByTopicId]);

  const editAvailableKnowledgeForSkillElement = useMemo(() => {
    if (!editElementTopicId) {
      return [];
    }
    return (topicKnowledgeElementsByTopicId.get(editElementTopicId) ?? [])
      .map((link) => elementById.get(link.element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element &&
          element.id !== editElementId &&
          element.competence_type === "know",
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [editElementId, editElementTopicId, elementById, topicKnowledgeElementsByTopicId]);

  const availableSkillElementsForMaster = useMemo(() => {
    if (!elementCreateTopicId) {
      return [];
    }
    return (topicKnowledgeElementsByTopicId.get(elementCreateTopicId) ?? [])
      .map((link) => elementById.get(link.element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element &&
          element.competence_type === "can" &&
          !!element.operation_ref,
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [elementById, elementCreateTopicId, topicKnowledgeElementsByTopicId]);

  const requiredKnowledgeForMaster = useMemo(() => {
    if (!elementCreateTopicId || !elementAutomatedSkillIds.length || !implementsRelation) {
      return [];
    }

    const topicKnowledgeIds = new Set(
      (topicKnowledgeElementsByTopicId.get(elementCreateTopicId) ?? [])
        .map((link) => link.element_id),
    );

    return Array.from(
      new Map(
        knowledgeElementRelations
          .filter(
            (relation) =>
              relation.topic_id === elementCreateTopicId &&
              elementAutomatedSkillIds.includes(relation.source_element_id) &&
              relation.relation_id === implementsRelation.id,
          )
          .map((relation) => elementById.get(relation.target_element_id) ?? null)
          .filter(
            (element): element is KnowledgeElement =>
              !!element &&
              element.competence_type === "know" &&
              topicKnowledgeIds.has(element.id),
          )
          .sort((left, right) => left.name.localeCompare(right.name, "ru"))
          .map((element) => [element.id, element]),
      ).values(),
    );
  }, [
    elementAutomatedSkillIds,
    elementById,
    elementCreateTopicId,
    implementsRelation,
    knowledgeElementRelations,
    topicKnowledgeElementsByTopicId,
  ]);

  const availableKnowledgeForMaster = useMemo(() => {
    if (!elementCreateTopicId) {
      return [];
    }

    return (topicKnowledgeElementsByTopicId.get(elementCreateTopicId) ?? [])
      .map((link) => elementById.get(link.element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element && element.competence_type === "know",
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [elementById, elementCreateTopicId, topicKnowledgeElementsByTopicId]);

  const editAvailableSkillElementsForMaster = useMemo(() => {
    if (!editElementTopicId) {
      return [];
    }
    return (topicKnowledgeElementsByTopicId.get(editElementTopicId) ?? [])
      .map((link) => elementById.get(link.element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element &&
          element.competence_type === "can" &&
          !!element.operation_ref &&
          element.id !== editElementId,
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [editElementId, editElementTopicId, elementById, topicKnowledgeElementsByTopicId]);

  const editRequiredKnowledgeForMaster = useMemo(() => {
    if (!editElementTopicId || !editElementAutomatedSkillIds.length || !implementsRelation) {
      return [];
    }

    const topicKnowledgeIds = new Set(
      (topicKnowledgeElementsByTopicId.get(editElementTopicId) ?? []).map(
        (link) => link.element_id,
      ),
    );

    return Array.from(
      new Map(
        knowledgeElementRelations
          .filter(
            (relation) =>
              relation.topic_id === editElementTopicId &&
              editElementAutomatedSkillIds.includes(relation.source_element_id) &&
              relation.relation_id === implementsRelation.id,
          )
          .map((relation) => elementById.get(relation.target_element_id) ?? null)
          .filter(
            (element): element is KnowledgeElement =>
              !!element &&
              element.competence_type === "know" &&
              topicKnowledgeIds.has(element.id),
          )
          .sort((left, right) => left.name.localeCompare(right.name, "ru"))
          .map((element) => [element.id, element]),
      ).values(),
    );
  }, [
    editElementAutomatedSkillIds,
    editElementTopicId,
    elementById,
    implementsRelation,
    knowledgeElementRelations,
    topicKnowledgeElementsByTopicId,
  ]);

  const editAvailableKnowledgeForMaster = useMemo(() => {
    if (!editElementTopicId) {
      return [];
    }

    return (topicKnowledgeElementsByTopicId.get(editElementTopicId) ?? [])
      .map((link) => elementById.get(link.element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element && element.competence_type === "know",
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [editElementTopicId, elementById, topicKnowledgeElementsByTopicId]);

  const uncoveredKnowledgeForMaster = useMemo(() => {
    const coveredKnowledgeIds = new Set(
      elementMasterDomainObjects
        .map((item) => item.knowledgeElementId)
        .filter((item) => item),
    );
    return requiredKnowledgeForMaster.filter(
      (element) => !coveredKnowledgeIds.has(element.id),
    );
  }, [elementMasterDomainObjects, requiredKnowledgeForMaster]);

  const editUncoveredKnowledgeForMaster = useMemo(() => {
    const coveredKnowledgeIds = new Set(
      editElementMasterDomainObjects
        .map((item) => item.knowledgeElementId)
        .filter((item) => item),
    );
    return editRequiredKnowledgeForMaster.filter(
      (element) => !coveredKnowledgeIds.has(element.id),
    );
  }, [editElementMasterDomainObjects, editRequiredKnowledgeForMaster]);

  const duplicateMasterDomainObjectMappings = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of elementMasterDomainObjects) {
      const normalizedObjectName = item.objectName.trim().toLocaleLowerCase("ru");
      if (!normalizedObjectName || !item.knowledgeElementId) {
        continue;
      }
      const key = `${normalizedObjectName}::${item.knowledgeElementId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return elementMasterDomainObjects.filter((item) => {
      const normalizedObjectName = item.objectName.trim().toLocaleLowerCase("ru");
      if (!normalizedObjectName || !item.knowledgeElementId) {
        return false;
      }
      const key = `${normalizedObjectName}::${item.knowledgeElementId}`;
      return (counts.get(key) ?? 0) > 1;
    });
  }, [elementMasterDomainObjects]);

  const editDuplicateMasterDomainObjectMappings = useMemo(() => {
    const counts = new Map<string, number>();
    for (const item of editElementMasterDomainObjects) {
      const normalizedObjectName = item.objectName.trim().toLocaleLowerCase("ru");
      if (!normalizedObjectName || !item.knowledgeElementId) {
        continue;
      }
      const key = `${normalizedObjectName}::${item.knowledgeElementId}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

    return editElementMasterDomainObjects.filter((item) => {
      const normalizedObjectName = item.objectName.trim().toLocaleLowerCase("ru");
      if (!normalizedObjectName || !item.knowledgeElementId) {
        return false;
      }
      const key = `${normalizedObjectName}::${item.knowledgeElementId}`;
      return (counts.get(key) ?? 0) > 1;
    });
  }, [editElementMasterDomainObjects]);

  const topicNewElementById = useMemo(
    () => new Map(topicNewElements.map((draft) => [draft.clientId, draft])),
    [topicNewElements],
  );

  const topicDraftKnowledgeOptionsById = useMemo(() => {
    const requiredKnowledgeOptions = selectedRequiredElementIds
      .map((elementId) => elementById.get(elementId) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element && element.competence_type === "know",
      )
      .map((element) => createExistingTopicDraftKnowledgeOption(element));

    const result = new Map<string, TopicDraftKnowledgeOption[]>();
    for (const draft of topicNewElements) {
      const options = [
        ...requiredKnowledgeOptions,
        ...topicNewElements
          .filter(
            (item) =>
              item.clientId !== draft.clientId &&
              item.competenceType === "know" &&
              item.name.trim(),
          )
          .map((item) => createNewTopicDraftKnowledgeOption(item)),
      ].sort((left, right) => left.label.localeCompare(right.label, "ru"));
      result.set(draft.clientId, options);
    }
    return result;
  }, [elementById, selectedRequiredElementIds, topicNewElements]);

  const topicDraftSkillOptionsById = useMemo(() => {
    const result = new Map<string, TopicNewElementDraft[]>();
    for (const draft of topicNewElements) {
      const options = topicNewElements
        .filter(
          (item) =>
            item.clientId !== draft.clientId &&
            item.competenceType === "can" &&
            item.name.trim() &&
            item.operationRef,
        )
        .sort((left, right) => left.name.localeCompare(right.name, "ru"));
      result.set(draft.clientId, options);
    }
    return result;
  }, [topicNewElements]);

  const topicDraftRequiredKnowledgeById = useMemo(() => {
    const result = new Map<string, TopicDraftKnowledgeOption[]>();
    const availableKnowledgeOptionsById = new Map<string, TopicDraftKnowledgeOption>(
      [
        ...selectedRequiredElementIds
          .map((elementId) => elementById.get(elementId) ?? null)
          .filter(
            (element): element is KnowledgeElement =>
              !!element && element.competence_type === "know",
          )
          .map((element) => createExistingTopicDraftKnowledgeOption(element)),
        ...topicNewElements
          .filter((item) => item.competenceType === "know" && item.name.trim())
          .map((item) => createNewTopicDraftKnowledgeOption(item)),
      ].map((option) => [option.id, option]),
    );

    for (const draft of topicNewElements) {
      if (draft.competenceType !== "master") {
        result.set(draft.clientId, []);
        continue;
      }

      const requiredKnowledge = Array.from(
        new Map(
          draft.automatedSkillDraftIds
            .map((skillDraftId) => topicNewElementById.get(skillDraftId) ?? null)
            .filter((skillDraft): skillDraft is TopicNewElementDraft => Boolean(skillDraft))
            .flatMap((skillDraft) => skillDraft.realizedKnowledgeDraftIds)
            .map((knowledgeReferenceId) => availableKnowledgeOptionsById.get(knowledgeReferenceId) ?? null)
            .filter(
              (option): option is TopicDraftKnowledgeOption => Boolean(option),
            )
            .sort((left, right) => left.label.localeCompare(right.label, "ru"))
            .map((option) => [option.id, option]),
        ).values(),
      );

      result.set(draft.clientId, requiredKnowledge);
    }

    return result;
  }, [elementById, selectedRequiredElementIds, topicNewElementById, topicNewElements]);

  const topicDraftDuplicateMasterDomainMappingsById = useMemo(() => {
    const result = new Map<string, MasterDomainObjectDraft[]>();

    for (const draft of topicNewElements) {
      const counts = new Map<string, number>();
      for (const item of draft.masterDomainObjects) {
        const normalizedObjectName = item.objectName.trim().toLocaleLowerCase("ru");
        if (!normalizedObjectName || !item.knowledgeElementId) {
          continue;
        }
        const key = `${normalizedObjectName}::${item.knowledgeElementId}`;
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }

      result.set(
        draft.clientId,
        draft.masterDomainObjects.filter((item) => {
          const normalizedObjectName = item.objectName.trim().toLocaleLowerCase("ru");
          if (!normalizedObjectName || !item.knowledgeElementId) {
            return false;
          }
          const key = `${normalizedObjectName}::${item.knowledgeElementId}`;
          return (counts.get(key) ?? 0) > 1;
        }),
      );
    }

    return result;
  }, [topicNewElements]);

  const topicDraftUncoveredKnowledgeById = useMemo(() => {
    const result = new Map<string, TopicDraftKnowledgeOption[]>();

    for (const draft of topicNewElements) {
      const requiredKnowledge = topicDraftRequiredKnowledgeById.get(draft.clientId) ?? [];
      const coveredKnowledgeIds = new Set(
        draft.masterDomainObjects
          .map((item) => item.knowledgeElementId)
          .filter((item) => item),
      );
      result.set(
        draft.clientId,
        requiredKnowledge.filter((knowledgeDraft) => !coveredKnowledgeIds.has(knowledgeDraft.id)),
      );
    }

    return result;
  }, [topicDraftRequiredKnowledgeById, topicNewElements]);

  const relationElements = sortedAllElements;
  const relationElementOptions = useMemo(
    () =>
      relationElements.map((element) => ({
        id: element.id,
        label: elementOptionLabel(element),
      })),
    [relationElements],
  );
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  const sortedElementRelations = useMemo(
    () =>
      knowledgeElementRelations
        .filter(
          (relation) =>
            elementById.has(relation.source_element_id) &&
            elementById.has(relation.target_element_id),
        )
        .slice()
        .sort((left, right) => {
          const leftSource = elementById.get(left.source_element_id)?.name ?? "";
          const rightSource = elementById.get(right.source_element_id)?.name ?? "";
          const sourceCompare = leftSource.localeCompare(rightSource, "ru");
          if (sourceCompare !== 0) {
            return sourceCompare;
          }

          const leftTarget = elementById.get(left.target_element_id)?.name ?? "";
          const rightTarget = elementById.get(right.target_element_id)?.name ?? "";
          return leftTarget.localeCompare(rightTarget, "ru");
        }),
    [elementById, knowledgeElementRelations],
  );

  const filteredEditRelations = useMemo(
    () =>
      sortedElementRelations.filter((relation) =>
        matchesRelationFilter(relation, elementById, editRelationFilter),
      ),
    [editRelationFilter, elementById, sortedElementRelations],
  );

  const filteredDeleteRelations = useMemo(
    () =>
      sortedElementRelations.filter((relation) =>
        matchesRelationFilter(relation, elementById, deleteRelationFilter),
      ),
    [deleteRelationFilter, elementById, sortedElementRelations],
  );

  const editingElement = useMemo(
    () => sortedAllElements.find((element) => element.id === editElementId) ?? null,
    [editElementId, sortedAllElements],
  );
  const affectedRelationsOnCompetenceChange = useMemo(() => {
    if (!editingElement || editingElement.competence_type === editElementCompetence) {
      return [];
    }
    return knowledgeElementRelations.filter(
      (relation) =>
        relation.source_element_id === editingElement.id ||
        relation.target_element_id === editingElement.id,
    );
  }, [editElementCompetence, editingElement, knowledgeElementRelations]);

  const relationSourceElement = useMemo(
    () => relationElements.find((element) => element.id === relationSourceElementId),
    [relationElements, relationSourceElementId],
  );
  const relationTargetElement = useMemo(
    () => relationElements.find((element) => element.id === relationTargetElementId),
    [relationElements, relationTargetElementId],
  );
  const resolvedCreateRelationElements = useMemo(
    () =>
      resolveRelationElements(
        relationSourceElement,
        relationTargetElement,
        relationDirection,
      ),
    [relationDirection, relationSourceElement, relationTargetElement],
  );
  const relationOptions = useMemo(
    () =>
      getRelationOptions(
        relationCatalog,
        resolvedCreateRelationElements.sourceElement?.competence_type,
        resolvedCreateRelationElements.targetElement?.competence_type,
      ),
    [
      relationCatalog,
      resolvedCreateRelationElements.sourceElement?.competence_type,
      resolvedCreateRelationElements.targetElement?.competence_type,
    ],
  );

  const availableRelationTopics = useMemo(() => {
    if (!relationSourceElementId || !relationTargetElementId) {
      return [];
    }
    const sourceTopicIds = new Set(topicIdsByElementId.get(relationSourceElementId) ?? []);
    const targetTopicIds = new Set(topicIdsByElementId.get(relationTargetElementId) ?? []);
    return uniqueTopicOptions(
      [...sourceTopicIds]
        .filter((topicId) => targetTopicIds.has(topicId))
        .map((topicId) => topicById.get(topicId) ?? null)
        .filter((topic): topic is Topic => !!topic),
    );
  }, [relationSourceElementId, relationTargetElementId, topicById, topicIdsByElementId]);

  const editRelationSourceElement = useMemo(
    () => relationElements.find((element) => element.id === editRelationSourceElementId),
    [editRelationSourceElementId, relationElements],
  );
  const filteredEditRelationSourceElements = useMemo(
    () =>
      relationElements.filter((element) => matchesElementFilter(element, editRelationSourceFilter)),
    [editRelationSourceFilter, relationElements],
  );
  const filteredEditRelationTargetElements = useMemo(
    () =>
      relationElements.filter((element) => matchesElementFilter(element, editRelationTargetFilter)),
    [editRelationTargetFilter, relationElements],
  );

  const editRelationTargetElement = useMemo(
    () => relationElements.find((element) => element.id === editRelationTargetElementId),
    [editRelationTargetElementId, relationElements],
  );
  const resolvedEditRelationElements = useMemo(
    () =>
      resolveRelationElements(
        editRelationSourceElement,
        editRelationTargetElement,
        editRelationDirection,
      ),
    [editRelationDirection, editRelationSourceElement, editRelationTargetElement],
  );
  const editRelationOptions = useMemo(
    () =>
      getRelationOptions(
        relationCatalog,
        resolvedEditRelationElements.sourceElement?.competence_type,
        resolvedEditRelationElements.targetElement?.competence_type,
      ),
    [
      relationCatalog,
      resolvedEditRelationElements.sourceElement?.competence_type,
      resolvedEditRelationElements.targetElement?.competence_type,
    ],
  );

  const availableEditRelationTopics = useMemo(() => {
    if (!editRelationSourceElementId || !editRelationTargetElementId) {
      return [];
    }
    const sourceTopicIds = new Set(topicIdsByElementId.get(editRelationSourceElementId) ?? []);
    const targetTopicIds = new Set(topicIdsByElementId.get(editRelationTargetElementId) ?? []);
    return uniqueTopicOptions(
      [...sourceTopicIds]
        .filter((topicId) => targetTopicIds.has(topicId))
        .map((topicId) => topicById.get(topicId) ?? null)
        .filter((topic): topic is Topic => !!topic),
    );
  }, [editRelationSourceElementId, editRelationTargetElementId, topicById, topicIdsByElementId]);

  const attachableElementsForTopic = useMemo(() => {
    if (!topicElementTopicId) {
      return [];
    }

    const linkedElementIds = new Set(
      (topicKnowledgeElementsByTopicId.get(topicElementTopicId) ?? []).map(
        (link) => link.element_id,
      ),
    );

    return sortedAllElements.filter((element) => {
      if (linkedElementIds.has(element.id)) {
        return false;
      }

      return getAttachableRolesForTopicElement(formedTopicIdsByElementId, {
        elementId: element.id,
        topicId: topicElementTopicId,
      }).length > 0;
    });
  }, [
    formedTopicIdsByElementId,
    sortedAllElements,
    topicElementTopicId,
    topicKnowledgeElementsByTopicId,
  ]);

  const attachableRolesForTopicElement = useMemo(
    () =>
      getAttachableRolesForTopicElement(formedTopicIdsByElementId, {
        elementId: topicElementElementId,
        topicId: topicElementTopicId,
      }),
    [formedTopicIdsByElementId, topicElementElementId, topicElementTopicId],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadEditorData() {
      try {
        const [items, contracts, relations] = await Promise.all([
          fetchKnowledgeElements(controller.signal, disciplineId),
          fetchOperationContracts(controller.signal),
          fetchRelations(controller.signal),
        ]);
        if (controller.signal.aborted) {
          return;
        }
        setAllElements(items);
        setOperationContracts(contracts);
        setRelationCatalog(relations);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setFeedback({ kind: "error", text: extractErrorMessage(error) });
      }
    }

    void loadEditorData();

    return () => controller.abort();
  }, [disciplineId]);

  useEffect(() => {
    if (!sortedTopics.length) {
      setElementCreateTopicId("");
      setTopicElementTopicId("");
      setEditTopicId("");
      setDeleteTopicId("");
      return;
    }

    if (
      elementCreateTopicId &&
      !sortedTopics.some((topic) => topic.id === elementCreateTopicId)
    ) {
      setElementCreateTopicId("");
    }

    if (!sortedTopics.some((topic) => topic.id === topicElementTopicId)) {
      setTopicElementTopicId(sortedTopics[0].id);
    }

    if (!sortedTopics.some((topic) => topic.id === editTopicId)) {
      setEditTopicId(sortedTopics[0].id);
    }

    if (!sortedTopics.some((topic) => topic.id === deleteTopicId)) {
      setDeleteTopicId(sortedTopics[0].id);
    }
  }, [
    deleteTopicId,
    elementCreateTopicId,
    editTopicId,
    sortedTopics,
    topicElementTopicId,
  ]);

  useEffect(() => {
    const selectedTopic = sortedTopics.find((topic) => topic.id === editTopicId);
    setEditTopicName(selectedTopic?.name ?? "");
    setEditTopicDescription(selectedTopic?.description ?? "");
  }, [editTopicId, sortedTopics]);

  useEffect(() => {
    if (!sortedAllElements.length) {
      setTopicElementElementId("");
      setSelectedRequiredElementIds([]);
      setEditElementId("");
      setDeleteElementIds([]);
      return;
    }

    setSelectedRequiredElementIds((current) =>
      current.filter((elementId) =>
        availableRequiredElementsForTopicCreation.some((element) => element.id === elementId),
      ),
    );

    if (!sortedAllElements.some((element) => element.id === editElementId)) {
      setEditElementId(sortedAllElements[0].id);
    }

    setDeleteElementIds((current) =>
      current.filter((elementId) =>
        sortedAllElements.some((element) => element.id === elementId)
      ),
    );
  }, [
    availableRequiredElementsForTopicCreation,
    editElementId,
    sortedAllElements,
  ]);

  useEffect(() => {
    if (!attachableElementsForTopic.length) {
      setTopicElementElementId("");
      return;
    }

    if (
      !attachableElementsForTopic.some((element) => element.id === topicElementElementId)
    ) {
      setTopicElementElementId(attachableElementsForTopic[0].id);
    }
  }, [attachableElementsForTopic, topicElementElementId]);

  useEffect(() => {
    if (!attachableRolesForTopicElement.length) {
      setTopicElementRole("required");
      return;
    }

    if (!attachableRolesForTopicElement.includes(topicElementRole)) {
      setTopicElementRole(attachableRolesForTopicElement[0]);
    }
  }, [attachableRolesForTopicElement, topicElementRole]);

  useEffect(() => {
    const selectedElement = sortedAllElements.find((element) => element.id === editElementId);
    const selectedElementTopicLinks = topicKnowledgeElements.filter(
      (link) => link.element_id === editElementId,
    );
    const preferredTopicLink =
      selectedElementTopicLinks.find((link) => link.role === "formed") ??
      selectedElementTopicLinks[0] ??
      null;

    setEditElementName(selectedElement?.name ?? "");
    setEditElementDescription(selectedElement?.description ?? "");
    setEditElementCompetence(selectedElement?.competence_type ?? "know");
    setEditElementSubjectAreaDescription(
      selectedElement?.subject_area_description ?? "",
    );
    setEditElementTopicId(preferredTopicLink?.topic_id ?? "");
    setEditElementOperationRef(
      selectedElement?.competence_type === "can" ? selectedElement.operation_ref ?? "" : "",
    );
    setEditElementRealizedKnowledgeIds(
      selectedElement?.competence_type === "can"
        ? knowledgeElementRelations
            .filter(
              (relation) =>
                relation.topic_id === (preferredTopicLink?.topic_id ?? "") &&
                relation.source_element_id === editElementId &&
                relation.relation.relation_type === "implements",
            )
            .map((relation) => relation.target_element_id)
        : [],
    );
    setEditElementAutomatedSkillIds([]);
    setEditElementMasterDomainObjects([]);
  }, [editElementId, knowledgeElementRelations, sortedAllElements, topicKnowledgeElements]);

  useEffect(() => {
    if (elementCompetence !== "can" && elementOperationRef) {
      setElementOperationRef("");
    }
  }, [elementCompetence, elementOperationRef]);

  useEffect(() => {
    if (
      !["can", "master"].includes(elementCompetence) ||
      !sortedTopics.length ||
      elementCreateTopicId
    ) {
      return;
    }
    setElementCreateTopicId(sortedTopics[0].id);
  }, [elementCompetence, elementCreateTopicId, sortedTopics]);

  useEffect(() => {
    if (elementCompetence !== "can") {
      if (elementRealizedKnowledgeIds.length) {
        setElementRealizedKnowledgeIds([]);
      }
      return;
    }

    const allowedIds = new Set(availableKnowledgeForNewSkillElement.map((element) => element.id));
    setElementRealizedKnowledgeIds((current) =>
      current.filter((elementId) => allowedIds.has(elementId)),
    );
  }, [availableKnowledgeForNewSkillElement, elementCompetence, elementRealizedKnowledgeIds.length]);

  useEffect(() => {
    if (elementCompetence !== "master") {
      if (elementSubjectAreaDescription) {
        setElementSubjectAreaDescription("");
      }
      if (elementAutomatedSkillIds.length) {
        setElementAutomatedSkillIds([]);
      }
      if (elementMasterDomainObjects.length) {
        setElementMasterDomainObjects([]);
      }
      return;
    }

    const allowedSkillIds = new Set(availableSkillElementsForMaster.map((element) => element.id));
    setElementAutomatedSkillIds((current) =>
      current.filter((elementId) => allowedSkillIds.has(elementId)),
    );
  }, [
    availableSkillElementsForMaster,
    elementAutomatedSkillIds.length,
    elementCompetence,
    elementMasterDomainObjects.length,
    elementSubjectAreaDescription,
  ]);

  useEffect(() => {
    if (elementCompetence !== "master") {
      return;
    }

    const allowedIds = new Set(availableKnowledgeForMaster.map((element) => element.id));
    setElementMasterDomainObjects((current) => {
      const fallbackKnowledgeId =
        requiredKnowledgeForMaster[0]?.id ?? availableKnowledgeForMaster[0]?.id ?? "";
      const next = current.map((item) => ({
        ...item,
        knowledgeElementId: allowedIds.has(item.knowledgeElementId)
          ? item.knowledgeElementId
          : fallbackKnowledgeId,
      }));
      const coveredKnowledgeIds = new Set(
        next.map((item) => item.knowledgeElementId).filter((item) => item),
      );

      for (const knowledgeElement of requiredKnowledgeForMaster) {
        if (coveredKnowledgeIds.has(knowledgeElement.id)) {
          continue;
        }
        next.push(createMasterDomainObjectDraft(knowledgeElement.id));
        coveredKnowledgeIds.add(knowledgeElement.id);
      }

      return next;
    });
  }, [availableKnowledgeForMaster, elementCompetence, requiredKnowledgeForMaster]);

  useEffect(() => {
    if (editElementCompetence !== "can" && editElementOperationRef) {
      setEditElementOperationRef("");
    }
  }, [editElementCompetence, editElementOperationRef]);

  useEffect(() => {
    if (editElementCompetence !== "can") {
      if (editElementRealizedKnowledgeIds.length) {
        setEditElementRealizedKnowledgeIds([]);
      }
      return;
    }

    if (!editElementTopicId && sortedTopics.length) {
      setEditElementTopicId(sortedTopics[0].id);
    }

    const allowedIds = new Set(
      editAvailableKnowledgeForSkillElement.map((element) => element.id),
    );
    setEditElementRealizedKnowledgeIds((current) =>
      current.filter((elementId) => allowedIds.has(elementId)),
    );
  }, [
    editAvailableKnowledgeForSkillElement,
    editElementCompetence,
    editElementRealizedKnowledgeIds.length,
    editElementTopicId,
    sortedTopics,
  ]);

  useEffect(() => {
    if (editElementCompetence !== "master") {
      if (editElementTopicId && editElementCompetence !== "can") {
        setEditElementTopicId("");
      }
      if (editElementSubjectAreaDescription) {
        setEditElementSubjectAreaDescription("");
      }
      if (editElementAutomatedSkillIds.length) {
        setEditElementAutomatedSkillIds([]);
      }
      if (editElementMasterDomainObjects.length) {
        setEditElementMasterDomainObjects([]);
      }
      return;
    }

    if (!editElementTopicId && sortedTopics.length) {
      setEditElementTopicId(sortedTopics[0].id);
    }

    const allowedSkillIds = new Set(
      editAvailableSkillElementsForMaster.map((element) => element.id),
    );
    setEditElementAutomatedSkillIds((current) =>
      current.filter((elementId) => allowedSkillIds.has(elementId)),
    );
  }, [
    editAvailableSkillElementsForMaster,
    editElementAutomatedSkillIds.length,
    editElementCompetence,
    editElementMasterDomainObjects.length,
    editElementSubjectAreaDescription,
    editElementTopicId,
    sortedTopics,
  ]);

  useEffect(() => {
    if (editElementCompetence !== "master") {
      return;
    }

    const allowedIds = new Set(editAvailableKnowledgeForMaster.map((element) => element.id));
    setEditElementMasterDomainObjects((current) => {
      const fallbackKnowledgeId =
        editRequiredKnowledgeForMaster[0]?.id ?? editAvailableKnowledgeForMaster[0]?.id ?? "";
      const next = current.map((item) => ({
        ...item,
        knowledgeElementId: allowedIds.has(item.knowledgeElementId)
          ? item.knowledgeElementId
          : fallbackKnowledgeId,
      }));
      const coveredKnowledgeIds = new Set(
        next.map((item) => item.knowledgeElementId).filter((item) => item),
      );

      for (const knowledgeElement of editRequiredKnowledgeForMaster) {
        if (coveredKnowledgeIds.has(knowledgeElement.id)) {
          continue;
        }
        next.push(createMasterDomainObjectDraft(knowledgeElement.id));
        coveredKnowledgeIds.add(knowledgeElement.id);
      }

      return next;
    });
  }, [
    editAvailableKnowledgeForMaster,
    editElementCompetence,
    editRequiredKnowledgeForMaster,
  ]);

  useEffect(() => {
    setTopicNewElements((current) => {
      let changed = false;

      const next = current.map((draft) => {
        const availableKnowledgeOptions = topicDraftKnowledgeOptionsById.get(draft.clientId) ?? [];
        const availableSkillDrafts = topicDraftSkillOptionsById.get(draft.clientId) ?? [];
        const requiredKnowledgeOptions = topicDraftRequiredKnowledgeById.get(draft.clientId) ?? [];

        let nextDraft = draft;

        if (draft.competenceType !== "can") {
          if (draft.operationRef || draft.realizedKnowledgeDraftIds.length) {
            nextDraft = {
              ...nextDraft,
              operationRef: "",
              realizedKnowledgeDraftIds: [],
            };
            changed = true;
          }
        } else {
          const allowedKnowledgeIds = new Set(availableKnowledgeOptions.map((item) => item.id));
          const nextRealizedKnowledgeDraftIds = draft.realizedKnowledgeDraftIds.filter((item) =>
            allowedKnowledgeIds.has(item),
          );
          if (
            nextRealizedKnowledgeDraftIds.length !== draft.realizedKnowledgeDraftIds.length ||
            nextRealizedKnowledgeDraftIds.some(
              (item, index) => item !== draft.realizedKnowledgeDraftIds[index],
            )
          ) {
            nextDraft = {
              ...nextDraft,
              realizedKnowledgeDraftIds: nextRealizedKnowledgeDraftIds,
            };
            changed = true;
          }
        }

        if (draft.competenceType !== "master") {
          if (
            draft.subjectAreaDescription ||
            draft.automatedSkillDraftIds.length ||
            draft.masterDomainObjects.length
          ) {
            nextDraft = {
              ...nextDraft,
              subjectAreaDescription: "",
              automatedSkillDraftIds: [],
              masterDomainObjects: [],
            };
            changed = true;
          }
          return nextDraft;
        }

        const allowedSkillIds = new Set(availableSkillDrafts.map((item) => item.clientId));
        const nextAutomatedSkillDraftIds = draft.automatedSkillDraftIds.filter((item) =>
          allowedSkillIds.has(item),
        );
        if (
          nextAutomatedSkillDraftIds.length !== draft.automatedSkillDraftIds.length ||
          nextAutomatedSkillDraftIds.some(
            (item, index) => item !== draft.automatedSkillDraftIds[index],
          )
        ) {
          nextDraft = {
            ...nextDraft,
            automatedSkillDraftIds: nextAutomatedSkillDraftIds,
          };
          changed = true;
        }

        const allowedKnowledgeIds = new Set(availableKnowledgeOptions.map((item) => item.id));
        const fallbackKnowledgeId =
          requiredKnowledgeOptions[0]?.id ?? availableKnowledgeOptions[0]?.id ?? "";
        let nextMasterDomainObjects = nextDraft.masterDomainObjects
          .filter((item) => !item.knowledgeElementId || allowedKnowledgeIds.has(item.knowledgeElementId))
          .map((item) => ({
            ...item,
            knowledgeElementId: item.knowledgeElementId || fallbackKnowledgeId,
          }));

        const coveredKnowledgeIds = new Set(
          nextMasterDomainObjects.map((item) => item.knowledgeElementId).filter((item) => item),
        );

        for (const knowledgeOption of requiredKnowledgeOptions) {
          if (coveredKnowledgeIds.has(knowledgeOption.id)) {
            continue;
          }
          nextMasterDomainObjects = [
            ...nextMasterDomainObjects,
            createMasterDomainObjectDraft(knowledgeOption.id),
          ];
          coveredKnowledgeIds.add(knowledgeOption.id);
        }

        if (
          nextMasterDomainObjects.length !== nextDraft.masterDomainObjects.length ||
          nextMasterDomainObjects.some((item, index) => {
            const currentItem = nextDraft.masterDomainObjects[index];
            return (
              !currentItem ||
              currentItem.clientId !== item.clientId ||
              currentItem.knowledgeElementId !== item.knowledgeElementId ||
              currentItem.objectName !== item.objectName
            );
          })
        ) {
          nextDraft = {
            ...nextDraft,
            masterDomainObjects: nextMasterDomainObjects,
          };
          changed = true;
        }

        return nextDraft;
      });

      return changed ? next : current;
    });
  }, [
    topicDraftKnowledgeOptionsById,
    topicDraftRequiredKnowledgeById,
    topicDraftSkillOptionsById,
  ]);


  useEffect(() => {
    if (!relationElements.length) {
      setRelationSourceElementId("");
      setRelationTargetElementId("");
      setRelationTopicId("");
      setRelationDefinitionId("");
      return;
    }

    if (!relationElements.some((element) => element.id === relationSourceElementId)) {
      setRelationSourceElementId("");
    }

    if (!relationElements.some((element) => element.id === relationTargetElementId)) {
      setRelationTargetElementId("");
    }
  }, [relationElements, relationSourceElementId, relationTargetElementId]);


  useEffect(() => {
    if (!availableRelationTopics.length) {
      setRelationTopicId("");
      return;
    }

    if (!availableRelationTopics.some((topic) => topic.id === relationTopicId)) {
      setRelationTopicId(availableRelationTopics[0].id);
    }
  }, [availableRelationTopics, relationTopicId]);

  useEffect(() => {
    if (!relationOptions.length) {
      setRelationDefinitionId("");
      return;
    }

    if (!relationOptions.some((option) => option.value === relationDefinitionId)) {
      setRelationDefinitionId(relationOptions[0].value);
    }
  }, [relationDefinitionId, relationOptions]);

  useEffect(() => {
    if (!sortedElementRelations.length) {
      setEditRelationId("");
      setDeleteRelationId("");
      return;
    }

    if (!sortedElementRelations.some((relation) => relation.id === editRelationId)) {
      setEditRelationId(sortedElementRelations[0].id);
    }

    if (!sortedElementRelations.some((relation) => relation.id === deleteRelationId)) {
      setDeleteRelationId(sortedElementRelations[0].id);
    }
  }, [deleteRelationId, editRelationId, sortedElementRelations]);

  useEffect(() => {
    if (!filteredEditRelations.length) {
      setEditRelationId("");
      return;
    }
    if (!filteredEditRelations.some((relation) => relation.id === editRelationId)) {
      setEditRelationId(filteredEditRelations[0].id);
    }
  }, [editRelationId, filteredEditRelations]);

  useEffect(() => {
    if (!filteredDeleteRelations.length) {
      setDeleteRelationId("");
      return;
    }
    if (!filteredDeleteRelations.some((relation) => relation.id === deleteRelationId)) {
      setDeleteRelationId(filteredDeleteRelations[0].id);
    }
  }, [deleteRelationId, filteredDeleteRelations]);

  useEffect(() => {
    const selectedRelation = sortedElementRelations.find(
      (relation) => relation.id === editRelationId,
    );
    setEditRelationSourceElementId(selectedRelation?.source_element_id ?? "");
    setEditRelationTargetElementId(selectedRelation?.target_element_id ?? "");
    setEditRelationTopicId(selectedRelation?.topic_id ?? "");
    setEditRelationDirection("element1_to_element2");
    setEditRelationDefinitionId(selectedRelation?.relation_id ?? "");
    setEditRelationDescription(selectedRelation?.description ?? "");
  }, [editRelationId, sortedElementRelations]);


  useEffect(() => {
    if (!editRelationOptions.length) {
      setEditRelationDefinitionId("");
      return;
    }

    if (!editRelationOptions.some((option) => option.value === editRelationDefinitionId)) {
      setEditRelationDefinitionId(editRelationOptions[0].value);
    }
  }, [editRelationDefinitionId, editRelationOptions]);

  useEffect(() => {
    if (!availableEditRelationTopics.length) {
      setEditRelationTopicId("");
      return;
    }

    if (!availableEditRelationTopics.some((topic) => topic.id === editRelationTopicId)) {
      setEditRelationTopicId(availableEditRelationTopics[0].id);
    }
  }, [availableEditRelationTopics, editRelationTopicId]);

  async function reloadElements() {
    const items = await fetchKnowledgeElements(undefined, disciplineId);
    setAllElements(items);
  }

  async function syncAfterChange(reloadElementList = false) {
    if (reloadElementList) {
      await reloadElements();
    }
    await onDataChanged();
  }

  function getElementRelationName(relation: KnowledgeElementRelation) {
    const sourceName = elementById.get(relation.source_element_id)?.name ?? "Элемент 1";
    const targetName = elementById.get(relation.target_element_id)?.name ?? "Элемент 2";
    return `${sourceName} -> ${targetName} (${relationTypeLabel(relation.relation.relation_type)})`;
  }

  function openDeleteConfirmation(
    entityType: "topic" | "topic-with-elements" | "element" | "element-relation",
    entityId: string,
  ) {
    if (entityType === "topic" || entityType === "topic-with-elements") {
      const selectedTopic = sortedTopics.find((topic) => topic.id === entityId);
      if (!selectedTopic) {
        return;
      }

      const blockingDependencies = topicDependencies.filter(
        (dependency) =>
          dependency.prerequisite_topic_id === entityId && dependency.relation_type === "requires",
      );
      if (blockingDependencies.length) {
        const dependentTopicNames = blockingDependencies
          .map((dependency) => topicById.get(dependency.dependent_topic_id)?.name ?? "Тема")
          .sort((left, right) => left.localeCompare(right, "ru"))
          .join(", ");
        setFeedback({
          kind: "error",
          text:
            `Тему "${selectedTopic.name}" нельзя удалить, потому что она требуется другим темам: ` +
            dependentTopicNames,
        });
        return;
      }

      const topicLinks = topicKnowledgeElementsByTopicId.get(entityId) ?? [];
      const linkedElements = topicLinks
        .map((link) => {
          const element = elementById.get(link.element_id);
          if (!element) {
            return null;
          }
          const roleLabel =
            TOPIC_LINK_ROLE_OPTIONS.find((option) => option.value === link.role)?.label ??
            link.role;
          return {
            label: `${element.name} (${competenceLabel(element.competence_type)}, ${roleLabel})`,
            role: link.role,
          };
        })
        .filter(
          (item): item is { label: string; role: TopicKnowledgeElementRole } => !!item,
        );

      const formedElements = linkedElements
        .filter((item) => item.role === "formed")
        .map((item) => item.label);
      const remainingLinkedElements = linkedElements
        .filter((item) => item.role !== "formed")
        .map((item) => item.label);

      const linkedDependencies = topicDependencies
        .filter(
          (dependency) =>
            dependency.prerequisite_topic_id === entityId ||
            dependency.dependent_topic_id === entityId,
        )
        .map((dependency) => {
          const prerequisiteName =
            topicById.get(dependency.prerequisite_topic_id)?.name ?? "Тема";
          const dependentName = topicById.get(dependency.dependent_topic_id)?.name ?? "Тема";
          return `${prerequisiteName} -> ${dependentName} (${topicDependencyRelationLabel(
            dependency.relation_type,
          )})`;
        });

      const details =
        entityType === "topic-with-elements"
          ? [
              ...formedElements.map((name) => `Будет удален формируемый элемент: ${name}`),
              ...remainingLinkedElements.map((name) => `Будет снята привязка элемента: ${name}`),
              ...linkedDependencies.map((name) => `Зависимость темы: ${name}`),
            ]
          : [
              ...linkedElements.map((item) => `Привязка элемента: ${item.label}`),
              ...linkedDependencies.map((name) => `Зависимость темы: ${name}`),
            ];

      const deleteTopicText = details.length
        ? `Тема "${selectedTopic.name}" будет удалена вместе с ${linkedElements.length} привязками элементов и ${linkedDependencies.length} зависимостями темы.`
        : `Тема "${selectedTopic.name}" будет удалена.`;
      const deleteTopicWithElementsText = formedElements.length
        ? `Тема "${selectedTopic.name}" будет удалена вместе с ${formedElements.length} формируемыми элементами и всеми их связями. Дополнительно будут сняты ${remainingLinkedElements.length} других привязок элементов и ${linkedDependencies.length} зависимостей темы.`
        : `У темы "${selectedTopic.name}" нет формируемых элементов. Будет удалена только тема.`;

      setConfirmDelete({
        entityId,
        entityName: selectedTopic.name,
        entityType,
        relationNames: details,
        text:
          entityType === "topic-with-elements"
            ? deleteTopicWithElementsText
            : deleteTopicText,
      });
      return;
    }

    if (entityType === "element-relation") {
      const selectedRelation = sortedElementRelations.find((relation) => relation.id === entityId);
      if (!selectedRelation) {
        return;
      }

      setConfirmDelete({
        entityId,
        entityName: getElementRelationName(selectedRelation),
        entityType,
      });
      return;
    }

    const selectedElement = sortedAllElements.find((element) => element.id === entityId);
    if (!selectedElement) {
      return;
    }

    const relatedRelations = knowledgeElementRelations.filter(
      (relation) =>
        relation.source_element_id === entityId || relation.target_element_id === entityId,
    );
    const blockingRelations = relatedRelations.filter((relation) =>
      isDeletionBlockedByRelation(selectedElement, relation, elementById),
    );
    if (blockingRelations.length) {
      const blockingRelationNames = blockingRelations.map(getElementRelationName);
      setFeedback({
        kind: "error",
        text:
          `Элемент "${selectedElement.name}" нельзя удалить, потому что на него опираются элементы более высокого уровня: ` +
          blockingRelationNames.join(", "),
      });
      return;
    }

    const sameLevelRelations = relatedRelations.filter((relation) => {
      const sourceElement = elementById.get(relation.source_element_id);
      const targetElement = elementById.get(relation.target_element_id);
      return (
        sourceElement?.competence_type === targetElement?.competence_type &&
        (relation.source_element_id === entityId || relation.target_element_id === entityId)
      );
    });
    const crossLevelRelations = relatedRelations.filter((relation) => {
      const sourceElement = elementById.get(relation.source_element_id);
      const targetElement = elementById.get(relation.target_element_id);
      return (
        sourceElement?.competence_type !== targetElement?.competence_type &&
        (relation.source_element_id === entityId || relation.target_element_id === entityId)
      );
    });

    setConfirmDelete({
      entityId,
      entityName: selectedElement.name,
      entityType,
      relationNames: relatedRelations.map(getElementRelationName),
      text: relatedRelations.length
        ? crossLevelRelations.length
          ? `Элемент "${selectedElement.name}" будет удален вместе со связями с другими элементами. Будут удалены ${crossLevelRelations.length} межуровневых и ${sameLevelRelations.length} связей в рамках одного уровня компетенции.`
          : `Элемент "${selectedElement.name}" будет удален вместе с ${sameLevelRelations.length} связями в рамках одного уровня компетенции.`
        : `Элемент "${selectedElement.name}" будет удален.`,
    });
  }

  function closeDeleteConfirmation() {
    if (
      busyAction === "topic-delete" ||
      busyAction === "element-delete" ||
      busyAction === "element-relation-delete"
    ) {
      return;
    }

    setConfirmDelete(null);
  }

  function closeCompetenceChangeConfirmation() {
    if (busyAction === "element-update") {
      return;
    }
    setConfirmCompetenceChange(null);
  }

  async function handleConfirmDelete() {
    if (!confirmDelete) {
      return;
    }

    try {
      setBusyAction(
        confirmDelete.entityType === "topic" || confirmDelete.entityType === "topic-with-elements"
          ? "topic-delete"
          : confirmDelete.entityType === "element-relation"
            ? "element-relation-delete"
            : "element-delete",
      );
      setFeedback(null);

      if (confirmDelete.entityType === "topic") {
        await deleteTopic(confirmDelete.entityId);
        await syncAfterChange();
        setFeedback({ kind: "success", text: "Тема удалена." });
      } else if (confirmDelete.entityType === "topic-with-elements") {
        await deleteTopicWithFormedElements(confirmDelete.entityId);
        await syncAfterChange(true);
        setFeedback({ kind: "success", text: "Тема и формируемые ею элементы удалены." });
      } else if (confirmDelete.entityType === "element-relation") {
        await deleteKnowledgeElementRelation(confirmDelete.entityId);
        await syncAfterChange();
        setFeedback({ kind: "success", text: "Связь между элементами удалена." });
      } else {
        await deleteKnowledgeElement(confirmDelete.entityId);
        await syncAfterChange(true);
        setFeedback({ kind: "success", text: "Элемент удален." });
      }

      setConfirmDelete(null);
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleConfirmCompetenceChange() {
    if (!confirmCompetenceChange) {
      return;
    }
    try {
      await submitUpdateElement(true);
      setConfirmCompetenceChange(null);
    } catch {
      // submitUpdateElement already reports errors through feedback
    }
  }

  function toggleRequiredElement(elementId: string) {
    setSelectedRequiredElementIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
  }

  function toggleElementRealizedKnowledge(elementId: string) {
    setElementRealizedKnowledgeIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
  }

  function toggleElementAutomatedSkill(elementId: string) {
    setElementAutomatedSkillIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
  }

  function toggleEditElementRealizedKnowledge(elementId: string) {
    setEditElementRealizedKnowledgeIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
  }

  function toggleEditElementAutomatedSkill(elementId: string) {
    setEditElementAutomatedSkillIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
    );
  }

  function addMasterDomainObjectDraft() {
    const fallbackKnowledgeId =
      requiredKnowledgeForMaster[0]?.id ?? availableKnowledgeForMaster[0]?.id ?? "";
    setElementMasterDomainObjects((current) => [
      ...current,
      createMasterDomainObjectDraft(fallbackKnowledgeId),
    ]);
  }

  function removeMasterDomainObjectDraft(clientId: string) {
    setElementMasterDomainObjects((current) =>
      current.filter((item) => item.clientId !== clientId),
    );
  }

  function updateMasterDomainObjectDraft(
    clientId: string,
    patch: Partial<Omit<MasterDomainObjectDraft, "clientId">>,
  ) {
    setElementMasterDomainObjects((current) =>
      current.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item)),
    );
  }

  function addEditMasterDomainObjectDraft() {
    const fallbackKnowledgeId =
      editRequiredKnowledgeForMaster[0]?.id ?? editAvailableKnowledgeForMaster[0]?.id ?? "";
    setEditElementMasterDomainObjects((current) => [
      ...current,
      createMasterDomainObjectDraft(fallbackKnowledgeId),
    ]);
  }

  function removeEditMasterDomainObjectDraft(clientId: string) {
    setEditElementMasterDomainObjects((current) =>
      current.filter((item) => item.clientId !== clientId),
    );
  }

  function updateEditMasterDomainObjectDraft(
    clientId: string,
    patch: Partial<Omit<MasterDomainObjectDraft, "clientId">>,
  ) {
    setEditElementMasterDomainObjects((current) =>
      current.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item)),
    );
  }

  function addTopicNewElementDraft() {
    setTopicNewElements((current) => [...current, createDraft()]);
  }

  function removeTopicNewElementDraft(clientId: string) {
    setTopicNewElements((current) => current.filter((item) => item.clientId !== clientId));
  }

  function updateTopicNewElementDraft(
    clientId: string,
    patch: Partial<Omit<TopicNewElementDraft, "clientId">>,
  ) {
    setTopicNewElements((current) =>
      current.map((item) => (item.clientId === clientId ? { ...item, ...patch } : item)),
    );
  }

  function toggleTopicDraftRealizedKnowledge(
    draftClientId: string,
    knowledgeDraftClientId: string,
  ) {
    setTopicNewElements((current) =>
      current.map((item) =>
        item.clientId !== draftClientId
          ? item
          : {
              ...item,
              realizedKnowledgeDraftIds: item.realizedKnowledgeDraftIds.includes(knowledgeDraftClientId)
                ? item.realizedKnowledgeDraftIds.filter((id) => id !== knowledgeDraftClientId)
                : [...item.realizedKnowledgeDraftIds, knowledgeDraftClientId],
            },
      ),
    );
  }

  function toggleTopicDraftAutomatedSkill(
    draftClientId: string,
    skillDraftClientId: string,
  ) {
    setTopicNewElements((current) =>
      current.map((item) =>
        item.clientId !== draftClientId
          ? item
          : {
              ...item,
              automatedSkillDraftIds: item.automatedSkillDraftIds.includes(skillDraftClientId)
                ? item.automatedSkillDraftIds.filter((id) => id !== skillDraftClientId)
                : [...item.automatedSkillDraftIds, skillDraftClientId],
            },
      ),
    );
  }

  function addTopicDraftMasterDomainObject(draftClientId: string) {
    setTopicNewElements((current) =>
      current.map((item) => {
        if (item.clientId !== draftClientId) {
          return item;
        }
        const requiredKnowledgeDrafts = topicDraftRequiredKnowledgeById.get(draftClientId) ?? [];
        const availableKnowledgeDrafts = topicDraftKnowledgeOptionsById.get(draftClientId) ?? [];
        const fallbackKnowledgeId =
          requiredKnowledgeDrafts[0]?.id ?? availableKnowledgeDrafts[0]?.id ?? "";
        return {
          ...item,
          masterDomainObjects: [
            ...item.masterDomainObjects,
            createMasterDomainObjectDraft(fallbackKnowledgeId),
          ],
        };
      }),
    );
  }

  function removeTopicDraftMasterDomainObject(draftClientId: string, objectClientId: string) {
    setTopicNewElements((current) =>
      current.map((item) =>
        item.clientId !== draftClientId
          ? item
          : {
              ...item,
              masterDomainObjects: item.masterDomainObjects.filter(
                (objectDraft) => objectDraft.clientId !== objectClientId,
              ),
            },
      ),
    );
  }

  function updateTopicDraftMasterDomainObject(
    draftClientId: string,
    objectClientId: string,
    patch: Partial<Omit<MasterDomainObjectDraft, "clientId">>,
  ) {
    setTopicNewElements((current) =>
      current.map((item) =>
        item.clientId !== draftClientId
          ? item
          : {
              ...item,
              masterDomainObjects: item.masterDomainObjects.map((objectDraft) =>
                objectDraft.clientId === objectClientId
                  ? { ...objectDraft, ...patch }
                  : objectDraft,
              ),
            },
      ),
    );
  }

  async function legacyHandleCreateTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disciplineId) {
      return;
    }

    const hasStructuredDraft = topicNewElements.some(
      (draft) =>
        (draft.competenceType === "can" || draft.competenceType === "master") &&
        draft.name.trim(),
    );
    if (hasStructuredDraft) {
      setFeedback({
        kind: "error",
        text: "Элементы уровня «Уметь» создавай после создания темы во вкладке «Элементы», чтобы сразу привязать их к знаниям темы.",
      });
      return;
    }
    const invalidRequiredElement = selectedRequiredElementIds.find(
      (elementId) =>
        !canAttachElementAsRequired(formedTopicIdsByElementId, {
          elementId,
        }),
    );
    if (invalidRequiredElement) {
      const invalidElementName = elementById.get(invalidRequiredElement)?.name ?? "Выбранный элемент";
      setFeedback({
        kind: "error",
        text: (
          `${invalidElementName} нельзя добавить как требуемый: ` +
          "он ещё не является формируемым ни в одной другой теме этой дисциплины."
        ),
      });
      return;
    }

    try {
      setBusyAction("topic-create");
      setFeedback(null);

      const createdTopic = await createTopic({
        name: topicName.trim(),
        description: topicDescription.trim(),
        discipline_id: disciplineId,
      });

      for (const elementId of selectedRequiredElementIds) {
        await createTopicKnowledgeElement({
          topic_id: createdTopic.id,
          element_id: elementId,
          role: "required",
          note: "",
        });
      }

      for (const draft of topicNewElements) {
        if (!draft.name.trim()) {
          continue;
        }

        const createdElement = await createKnowledgeElement({
          name: draft.name.trim(),
          description: draft.description.trim(),
          competence_type: draft.competenceType,
          discipline_id: disciplineId,
          subject_area_description: null,
          operation_ref: draft.competenceType === "can" ? draft.operationRef || null : null,
        });

        await createTopicKnowledgeElement({
          topic_id: createdTopic.id,
          element_id: createdElement.id,
          role: "formed",
          note: "",
        });
      }

      setTopicName("");
      setTopicDescription("");
      setSelectedRequiredElementIds([]);
      setTopicNewElements([]);
      await syncAfterChange(true);
      setTopicElementTopicId(createdTopic.id);
      setEditTopicId(createdTopic.id);
      setDeleteTopicId(createdTopic.id);
      setFeedback({ kind: "success", text: "Тема создана." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disciplineId) {
      return;
    }

    const invalidRequiredElement = selectedRequiredElementIds.find(
      (elementId) =>
        !canAttachElementAsRequired(formedTopicIdsByElementId, {
          elementId,
        }),
    );
    if (invalidRequiredElement) {
      const invalidElementName =
        elementById.get(invalidRequiredElement)?.name ?? "Выбранный элемент";
      setFeedback({
        kind: "error",
        text:
          `${invalidElementName} нельзя добавить как требуемый: ` +
          "он еще не является формируемым ни в одной другой теме этой дисциплины.",
      });
      return;
    }

    const activeDrafts = topicNewElements.filter((draft) => draft.name.trim());
    const knowledgeDrafts = activeDrafts.filter((draft) => draft.competenceType === "know");
    const skillDrafts = activeDrafts.filter((draft) => draft.competenceType === "can");
    const masterDrafts = activeDrafts.filter((draft) => draft.competenceType === "master");

    if (skillDrafts.length && !implementsRelation) {
      setFeedback({
        kind: "error",
        text: "Не найдена связь «Реализует» для элементов уровня «Уметь».",
      });
      return;
    }

    for (const draft of skillDrafts) {
      if (!draft.operationRef) {
        setFeedback({
          kind: "error",
          text: `Для элемента «${topicDraftOptionLabel(draft)}» выбери операцию алгоритмической библиотеки.`,
        });
        return;
      }
      if (!draft.realizedKnowledgeDraftIds.length) {
        setFeedback({
          kind: "error",
          text: `Для элемента «${topicDraftOptionLabel(draft)}» выбери хотя бы одно знание, которое он реализует.`,
        });
        return;
      }
    }

    for (const draft of masterDrafts) {
      const requiredKnowledgeDrafts = topicDraftRequiredKnowledgeById.get(draft.clientId) ?? [];
      const uncoveredKnowledgeDrafts = topicDraftUncoveredKnowledgeById.get(draft.clientId) ?? [];
      const duplicateDomainMappings =
        topicDraftDuplicateMasterDomainMappingsById.get(draft.clientId) ?? [];

      if (!draft.subjectAreaDescription.trim()) {
        setFeedback({
          kind: "error",
          text: `Для элемента «${topicDraftOptionLabel(draft)}» заполни описание предметной области.`,
        });
        return;
      }
      if (!draft.automatedSkillDraftIds.length) {
        setFeedback({
          kind: "error",
          text: `Для элемента «${topicDraftOptionLabel(draft)}» выбери хотя бы один элемент уровня «Уметь».`,
        });
        return;
      }
      if (!requiredKnowledgeDrafts.length) {
        setFeedback({
          kind: "error",
          text:
            `У выбранных навыков для элемента «${topicDraftOptionLabel(draft)}» ` +
            "нет связанных знаний уровня «Знать».",
        });
        return;
      }
      if (!draft.masterDomainObjects.length) {
        setFeedback({
          kind: "error",
          text: `Для элемента «${topicDraftOptionLabel(draft)}» добавь хотя бы один объект предметной области.`,
        });
        return;
      }
      if (
        draft.masterDomainObjects.some(
          (item) => !item.objectName.trim() || !item.knowledgeElementId,
        )
      ) {
        setFeedback({
          kind: "error",
          text:
            `Для элемента «${topicDraftOptionLabel(draft)}» заполни все объекты предметной области ` +
            "и выбери знание для каждого объекта.",
        });
        return;
      }
      if (uncoveredKnowledgeDrafts.length) {
        setFeedback({
          kind: "error",
          text:
            `Для элемента «${topicDraftOptionLabel(draft)}» нужно покрыть все связанные знания: ` +
            uncoveredKnowledgeDrafts.map((item) => item.label).join(", ") +
            ".",
        });
        return;
      }
      if (duplicateDomainMappings.length) {
        setFeedback({
          kind: "error",
          text:
            `Для элемента «${topicDraftOptionLabel(draft)}» убери дублирующиеся сопоставления ` +
            "объекта предметной области с одним и тем же знанием.",
        });
        return;
      }
    }

    try {
      setBusyAction("topic-create");
      setFeedback(null);

      const createdTopic = await createTopic({
        name: topicName.trim(),
        description: topicDescription.trim(),
        discipline_id: disciplineId,
      });

      for (const elementId of selectedRequiredElementIds) {
        await createTopicKnowledgeElement({
          topic_id: createdTopic.id,
          element_id: elementId,
          role: "required",
          note: "",
        });
      }

      const createdDraftElementIds = new Map<string, string>();

      for (const draft of knowledgeDrafts) {
        const createdElement = await createKnowledgeElement({
          name: draft.name.trim(),
          description: draft.description.trim(),
          competence_type: "know",
          discipline_id: disciplineId,
          subject_area_description: null,
          operation_ref: null,
        });

        createdDraftElementIds.set(draft.clientId, createdElement.id);

        await createTopicKnowledgeElement({
          topic_id: createdTopic.id,
          element_id: createdElement.id,
          role: "formed",
          note: "",
        });
      }

      for (const draft of skillDrafts) {
        const createdElement = await createKnowledgeElement({
          name: draft.name.trim(),
          description: draft.description.trim(),
          competence_type: "can",
          discipline_id: disciplineId,
          subject_area_description: null,
          operation_ref: draft.operationRef || null,
        });

        createdDraftElementIds.set(draft.clientId, createdElement.id);

        await createTopicKnowledgeElement({
          topic_id: createdTopic.id,
          element_id: createdElement.id,
          role: "formed",
          note: "",
        });

        for (const knowledgeDraftId of draft.realizedKnowledgeDraftIds) {
          const knowledgeElementId = resolveTopicDraftKnowledgeElementId(
            knowledgeDraftId,
            createdDraftElementIds,
          );
          if (!knowledgeElementId || !implementsRelation) {
            throw new Error(
              `Не удалось связать элемент «${topicDraftOptionLabel(draft)}» с выбранными знаниями.`,
            );
          }

          await createKnowledgeElementRelation({
            topic_id: createdTopic.id,
            source_element_id: createdElement.id,
            target_element_id: knowledgeElementId,
            relation_id: implementsRelation.id,
            description: "",
          });
        }
      }

      for (const draft of masterDrafts) {
        const automatedSkillElementIds = draft.automatedSkillDraftIds.map((skillDraftId) => {
          const skillElementId = createdDraftElementIds.get(skillDraftId);
          if (!skillElementId) {
            throw new Error(
              `Не удалось найти созданный навык для элемента «${topicDraftOptionLabel(draft)}».`,
            );
          }
          return skillElementId;
        });

        const domainObjects = draft.masterDomainObjects.map((item) => {
          const knowledgeElementId = resolveTopicDraftKnowledgeElementId(
            item.knowledgeElementId,
            createdDraftElementIds,
          );
          if (!knowledgeElementId) {
            throw new Error(
              `Не удалось найти выбранное знание для элемента «${topicDraftOptionLabel(draft)}».`,
            );
          }
          return {
            object_name: item.objectName.trim(),
            knowledge_element_id: knowledgeElementId,
          };
        });

        const createdElement = await createStructuredMasterKnowledgeElement({
          name: draft.name.trim(),
          description: draft.description.trim(),
          discipline_id: disciplineId,
          topic_id: createdTopic.id,
          subject_area_description: draft.subjectAreaDescription.trim(),
          automated_skill_element_ids: automatedSkillElementIds,
          domain_objects: domainObjects,
        });

        createdDraftElementIds.set(draft.clientId, createdElement.id);
      }

      setTopicName("");
      setTopicDescription("");
      setSelectedRequiredElementIds([]);
      setTopicNewElements([]);
      await syncAfterChange(true);
      setTopicElementTopicId(createdTopic.id);
      setEditTopicId(createdTopic.id);
      setDeleteTopicId(createdTopic.id);
      setFeedback({
        kind: "success",
        text: activeDrafts.length ? "Тема и связанные элементы созданы." : "Тема создана.",
      });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleUpdateTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editTopicId) {
      return;
    }

    try {
      setBusyAction("topic-update");
      setFeedback(null);
      await updateTopic(editTopicId, {
        name: editTopicName.trim(),
        description: editTopicDescription.trim(),
      });
      await syncAfterChange();
      setFeedback({ kind: "success", text: "Тема обновлена." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteTopicId) {
      return;
    }

    openDeleteConfirmation("topic", deleteTopicId);
  }

  function handleDeleteTopicWithElements() {
    if (!deleteTopicId) {
      return;
    }

    openDeleteConfirmation("topic-with-elements", deleteTopicId);
  }

  async function handleCreateElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    let createdElementId = "";

    if (elementCompetence === "master") {
      if (!elementCreateTopicId) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Владеть» сначала выбери тему.",
        });
        return;
      }
      if (!elementSubjectAreaDescription.trim()) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Владеть» заполни описание предметной области.",
        });
        return;
      }
      if (!elementAutomatedSkillIds.length) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Владеть» выбери хотя бы один связанный элемент уровня «Уметь».",
        });
        return;
      }
      if (!requiredKnowledgeForMaster.length) {
        setFeedback({
          kind: "error",
          text: "У выбранных элементов уровня «Уметь» в этой теме нет связанных элементов уровня «Знать» по связи «реализует».",
        });
        return;
      }
      if (
        elementMasterDomainObjects.some(
          (item) => !item.objectName.trim() || !item.knowledgeElementId,
        )
      ) {
        setFeedback({
          kind: "error",
          text: "Заполни все объекты предметной области и укажи для каждого элемент уровня «Знать».",
        });
        return;
      }
      if (uncoveredKnowledgeForMaster.length) {
        setFeedback({
          kind: "error",
          text: `Нужно покрыть все связанные элементы уровня «Знать»: ${uncoveredKnowledgeForMaster
            .map((item) => item.name)
            .join(", ")}.`,
        });
        return;
      }
      if (duplicateMasterDomainObjectMappings.length) {
        setFeedback({
          kind: "error",
          text: "Убери дублирующиеся сопоставления объекта предметной области с одним и тем же элементом «Знать».",
        });
        return;
      }

      try {
        setBusyAction("element-create");
        setFeedback(null);

        const createdElement = await createStructuredMasterKnowledgeElement({
          name: elementName.trim(),
          description: elementDescription.trim(),
          discipline_id: disciplineId,
          topic_id: elementCreateTopicId,
          subject_area_description: elementSubjectAreaDescription.trim(),
          automated_skill_element_ids: elementAutomatedSkillIds,
          domain_objects: elementMasterDomainObjects.map((item) => ({
            object_name: item.objectName.trim(),
            knowledge_element_id: item.knowledgeElementId,
          })),
        });

        setElementName("");
        setElementDescription("");
        setElementCompetence("know");
        setElementSubjectAreaDescription("");
        setElementAutomatedSkillIds([]);
        setElementMasterDomainObjects([]);
        await syncAfterChange(true);
        setTopicElementElementId(createdElement.id);
        setEditElementId(createdElement.id);
        setDeleteElementIds([createdElement.id]);
        setRelationSourceElementId(createdElement.id);
        setFeedback({
          kind: "success",
          text: "Элемент «Владеть» создан, привязан к теме и связан с выбранными элементами «Уметь».",
        });
      } catch (error) {
        setFeedback({ kind: "error", text: extractErrorMessage(error) });
      } finally {
        setBusyAction("");
      }

      return;
    }

    if (elementCompetence === "can") {
      if (!elementCreateTopicId) {
        setFeedback({ kind: "error", text: "Для элемента уровня «Уметь» сначала выбери тему." });
        return;
      }
      if (!elementOperationRef) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Уметь» выбери операцию алгоритмической библиотеки.",
        });
        return;
      }
      if (!elementRealizedKnowledgeIds.length) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Уметь» выбери знания этой темы, которые он реализует.",
        });
        return;
      }
      if (!implementsRelation) {
        setFeedback({
          kind: "error",
          text: "В системе не найдена связь «Реализует» для элементов уровня «Уметь».",
        });
        return;
      }
    }

    try {
      setBusyAction("element-create");
      setFeedback(null);

      const createdElement = await createKnowledgeElement({
        name: elementName.trim(),
        description: elementDescription.trim(),
        competence_type: elementCompetence,
        discipline_id: disciplineId,
        subject_area_description: null,
        operation_ref: elementCompetence === "can" ? elementOperationRef || null : null,
      });
      createdElementId = createdElement.id;

      if (elementCreateTopicId) {
        await createTopicKnowledgeElement({
          topic_id: elementCreateTopicId,
          element_id: createdElement.id,
          role: "formed",
          note: "",
        });
      }

      if (elementCompetence === "can" && elementCreateTopicId && implementsRelation) {
        for (const knowledgeElementId of elementRealizedKnowledgeIds) {
          await createKnowledgeElementRelation({
            topic_id: elementCreateTopicId,
            source_element_id: createdElement.id,
            target_element_id: knowledgeElementId,
            relation_id: implementsRelation.id,
            description: "",
          });
        }
      }

      setElementName("");
      setElementDescription("");
      setElementCompetence("know");
      setElementOperationRef("");
      setElementRealizedKnowledgeIds([]);
      setElementSubjectAreaDescription("");
      setElementAutomatedSkillIds([]);
      setElementMasterDomainObjects([]);
      await syncAfterChange(true);
      setTopicElementElementId(createdElement.id);
      setEditElementId(createdElement.id);
      setDeleteElementIds([createdElement.id]);
      setRelationSourceElementId(createdElement.id);
      setFeedback({
        kind: "success",
        text:
          elementCompetence === "can" && elementCreateTopicId
            ? "Элемент «Уметь» создан, привязан к теме и связан с выбранными знаниями."
            : elementCreateTopicId
              ? "Элемент создан и привязан к теме."
              : "Элемент создан.",
      });
    } catch (error) {
      if (createdElementId) {
        try {
          await deleteKnowledgeElement(createdElementId);
        } catch {
          setFeedback({
            kind: "error",
            text:
              `${extractErrorMessage(error)} ` +
              "Элемент был создан частично. Удали его вручную и повтори попытку.",
          });
          return;
        }
      }

      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleAttachElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!topicElementTopicId || !topicElementElementId) {
      setFeedback({ kind: "error", text: "Сначала выбери тему и элемент." });
      return;
    }

    const alreadyLinked = topicKnowledgeElements.some(
      (link) =>
        link.topic_id === topicElementTopicId &&
        link.element_id === topicElementElementId,
    );
    if (alreadyLinked) {
      setFeedback({
        kind: "error",
        text: "Этот элемент уже прикреплён к выбранной теме.",
      });
      return;
    }

    if (
      topicElementRole === "formed" &&
      !canAttachElementAsFormed(formedTopicIdsByElementId, {
        elementId: topicElementElementId,
        topicId: topicElementTopicId,
      })
    ) {
      const elementName = elementById.get(topicElementElementId)?.name ?? "Выбранный элемент";
      setFeedback({
        kind: "error",
        text: (
          `${elementName} нельзя прикрепить как формируемый: ` +
          "он уже является формируемым в другой теме этой дисциплины."
        ),
      });
      return;
    }

    if (
      topicElementRole === "required" &&
      !canAttachElementAsRequired(formedTopicIdsByElementId, {
        elementId: topicElementElementId,
        topicId: topicElementTopicId,
      })
    ) {
      const elementName = elementById.get(topicElementElementId)?.name ?? "Выбранный элемент";
      setFeedback({
        kind: "error",
        text: (
          `${elementName} нельзя прикрепить как требуемый: ` +
          "он ещё не является формируемым ни в одной другой теме этой дисциплины."
        ),
      });
      return;
    }

    try {
      setBusyAction("topic-element");
      setFeedback(null);
      await createTopicKnowledgeElement({
        topic_id: topicElementTopicId,
        element_id: topicElementElementId,
        role: topicElementRole,
        note: topicElementNote.trim(),
      });
      setTopicElementNote("");
      await syncAfterChange();
      setFeedback({ kind: "success", text: "Элемент привязан к теме." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function submitUpdateElement(forceCompetenceChange = false) {
    if (!editElementId) {
      return;
    }

    if (editElementCompetence === "master") {
      if (!editElementTopicId) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Владеть» сначала выбери тему.",
        });
        return;
      }
      if (!editElementSubjectAreaDescription.trim()) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Владеть» заполни описание предметной области.",
        });
        return;
      }
      if (!editElementAutomatedSkillIds.length) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Владеть» выбери хотя бы один связанный элемент уровня «Уметь».",
        });
        return;
      }
      if (!editRequiredKnowledgeForMaster.length) {
        setFeedback({
          kind: "error",
          text: "У выбранных элементов уровня «Уметь» в этой теме нет связанных элементов уровня «Знать» по связи «реализует».",
        });
        return;
      }
      if (
        editElementMasterDomainObjects.some(
          (item) => !item.objectName.trim() || !item.knowledgeElementId,
        )
      ) {
        setFeedback({
          kind: "error",
          text: "Заполни все объекты предметной области и укажи для каждого элемент уровня «Знать».",
        });
        return;
      }
      if (editUncoveredKnowledgeForMaster.length) {
        setFeedback({
          kind: "error",
          text: `Нужно покрыть все связанные элементы уровня «Знать»: ${editUncoveredKnowledgeForMaster
            .map((item) => item.name)
            .join(", ")}.`,
        });
        return;
      }
      if (editDuplicateMasterDomainObjectMappings.length) {
        setFeedback({
          kind: "error",
          text: "Убери дублирующиеся сопоставления объекта предметной области с одним и тем же элементом «Знать».",
        });
        return;
      }
    }

    if (editElementCompetence === "can") {
      if (!editElementTopicId) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Уметь» сначала выбери тему.",
        });
        return;
      }
      if (!editElementOperationRef) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Уметь» выбери операцию алгоритмической библиотеки.",
        });
        return;
      }
      if (!editElementRealizedKnowledgeIds.length) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Уметь» выбери хотя бы один связанный элемент уровня «Знать».",
        });
        return;
      }
    }

    if (
      !forceCompetenceChange &&
      affectedRelationsOnCompetenceChange.length &&
      editingElement &&
      editingElement.competence_type !== editElementCompetence
    ) {
      setConfirmCompetenceChange({
        nextCompetence: editElementCompetence,
        relationNames: affectedRelationsOnCompetenceChange.map(getElementRelationName),
      });
      return;
    }

    try {
      setBusyAction("element-update");
      setFeedback(null);

      if (editElementCompetence === "master") {
        await updateStructuredMasterKnowledgeElement(editElementId, {
          name: editElementName.trim(),
          description: editElementDescription.trim(),
          topic_id: editElementTopicId,
          subject_area_description: editElementSubjectAreaDescription.trim(),
          automated_skill_element_ids: editElementAutomatedSkillIds,
          domain_objects: editElementMasterDomainObjects.map((item) => ({
            object_name: item.objectName.trim(),
            knowledge_element_id: item.knowledgeElementId,
          })),
        });
      } else if (editElementCompetence === "can") {
        await updateStructuredSkillKnowledgeElement(editElementId, {
          name: editElementName.trim(),
          description: editElementDescription.trim(),
          topic_id: editElementTopicId,
          operation_ref: editElementOperationRef,
          realized_knowledge_element_ids: editElementRealizedKnowledgeIds,
        });
      } else {
        await updateKnowledgeElement(editElementId, {
          name: editElementName.trim(),
          description: editElementDescription.trim(),
          competence_type: editElementCompetence,
          subject_area_description: null,
          operation_ref: null,
        });
      }
      await syncAfterChange(true);
      setFeedback({ kind: "success", text: "Элемент обновлен." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleUpdateElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await submitUpdateElement();
  }

  function toggleDeleteElementSelection(elementId: string) {
    setDeleteElementIds((current) =>
      current.includes(elementId)
        ? current.filter((id) => id !== elementId)
        : [...current, elementId],
    );
  }

  function selectAllDeleteElements() {
    setDeleteElementIds(sortedAllElements.map((element) => element.id));
  }

  function clearDeleteElementSelection() {
    setDeleteElementIds([]);
  }

  async function handleDeleteElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const selectedIds = deleteElementIds.filter((elementId) =>
      sortedAllElements.some((element) => element.id === elementId),
    );

    if (!selectedIds.length) {
      setFeedback({
        kind: "error",
        text: "Выбери хотя бы один элемент для удаления.",
      });
      return;
    }

    const selectedElements = selectedIds
      .map((elementId) => elementById.get(elementId))
      .filter((element): element is KnowledgeElement => !!element);
    const selectedNames = selectedElements.map((element) => element.name);
    const confirmText = selectedElements.length === 1
      ? `Удалить элемент "${selectedNames[0]}"?`
      : `Удалить выбранные элементы (${selectedElements.length})?

${selectedNames.join("\n")}`;

    if (!window.confirm(confirmText)) {
      return;
    }

    try {
      setBusyAction("element-delete");
      setFeedback(null);

      const remainingIds = [...selectedIds];
      const failureById = new Map<string, string>();
      const deletedIds: string[] = [];

      while (remainingIds.length) {
        let deletedThisPass = 0;
        const passIds = remainingIds
          .slice()
          .sort((leftId, rightId) => {
            const leftCompetence = elementById.get(leftId)?.competence_type;
            const rightCompetence = elementById.get(rightId)?.competence_type;
            const priority = (competence?: CompetenceType) => {
              if (competence === "master") {
                return 0;
              }
              if (competence === "can") {
                return 1;
              }
              return 2;
            };
            return priority(leftCompetence) - priority(rightCompetence);
          });

        for (const elementId of passIds) {
          try {
            await deleteKnowledgeElement(elementId);
            deletedIds.push(elementId);
            failureById.delete(elementId);
            const removeIndex = remainingIds.indexOf(elementId);
            if (removeIndex >= 0) {
              remainingIds.splice(removeIndex, 1);
            }
            deletedThisPass += 1;
          } catch (error) {
            failureById.set(elementId, extractErrorMessage(error));
          }
        }

        if (!deletedThisPass) {
          break;
        }
      }

      if (deletedIds.length) {
        await syncAfterChange(true);
      }

      setDeleteElementIds(remainingIds);

      if (!remainingIds.length) {
        setFeedback({
          kind: "success",
          text:
            deletedIds.length === 1
              ? "Элемент удален."
              : `Удалено элементов: ${deletedIds.length}.`,
        });
        return;
      }

      const failureSummary = remainingIds
        .map((elementId) => {
          const elementName = elementById.get(elementId)?.name ?? "Элемент";
          return `${elementName}: ${failureById.get(elementId) ?? "не удалось удалить"}`;
        })
        .join(" ");

      setFeedback({
        kind: "error",
        text: deletedIds.length
          ? `Удалено ${deletedIds.length} из ${selectedIds.length}. Не удалось удалить: ${failureSummary}`
          : `Не удалось удалить выбранные элементы. ${failureSummary}`,
      });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateElementRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!relationSourceElementId || !relationTargetElementId) {
      setFeedback({ kind: "error", text: "Выбери оба элемента из списка." });
      return;
    }

    if (relationSourceElementId === relationTargetElementId) {
      setFeedback({ kind: "error", text: "Выбери два разных элемента." });
      return;
    }

    if (!relationTopicId) {
      setFeedback({
        kind: "error",
        text: "Для выбранной пары сейчас нет общей темы, в которой можно создать связь.",
      });
      return;
    }

    if (!relationDefinitionId) {
      setFeedback({
        kind: "error",
        text: "Для выбранной пары элементов сейчас нет допустимых типов связи.",
      });
      return;
    }

    try {
      setBusyAction("element-relation");
      setFeedback(null);
      const resolvedEndpoints = resolveRelationEndpoints(
        relationSourceElementId,
        relationTargetElementId,
        relationDirection,
      );
      if (
        isDuplicateRelationDefinition(knowledgeElementRelations, {
          topicId: relationTopicId,
          sourceElementId: resolvedEndpoints.sourceElementId,
          targetElementId: resolvedEndpoints.targetElementId,
          relationId: relationDefinitionId,
        })
      ) {
        setFeedback({
          kind: "error",
          text: "Такая связь в выбранной теме уже существует.",
        });
        return;
      }
      const createdRelation = await createKnowledgeElementRelation({
        topic_id: relationTopicId,
        source_element_id: resolvedEndpoints.sourceElementId,
        target_element_id: resolvedEndpoints.targetElementId,
        relation_id: relationDefinitionId,
        description: relationDescription.trim(),
      });
      setRelationDescription("");
      setEditRelationId(createdRelation.id);
      setDeleteRelationId(createdRelation.id);
      await syncAfterChange();
      setFeedback({ kind: "success", text: "Связь между элементами создана." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleUpdateElementRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (editRelationSourceElementId === editRelationTargetElementId) {
      setFeedback({ kind: "error", text: "Выбери два разных элемента." });
      return;
    }

    if (!editRelationId || !editRelationDefinitionId) {
      setFeedback({
        kind: "error",
        text: "Выбери связь и допустимый тип связи для выбранной пары элементов.",
      });
      return;
    }
    if (!editRelationTopicId) {
      setFeedback({
        kind: "error",
        text: "Для выбранной пары сейчас нет общей темы, в которой можно сохранить связь.",
      });
      return;
    }

    try {
      setBusyAction("element-relation-update");
      setFeedback(null);
      const resolvedEndpoints = resolveRelationEndpoints(
        editRelationSourceElementId,
        editRelationTargetElementId,
        editRelationDirection,
      );
      if (
        isDuplicateRelationDefinition(knowledgeElementRelations, {
          topicId: editRelationTopicId,
          sourceElementId: resolvedEndpoints.sourceElementId,
          targetElementId: resolvedEndpoints.targetElementId,
          relationId: editRelationDefinitionId,
          excludeRelationId: editRelationId,
        })
      ) {
        setFeedback({
          kind: "error",
          text: "Такая связь в выбранной теме уже существует.",
        });
        return;
      }
      await updateKnowledgeElementRelation(editRelationId, {
        topic_id: editRelationTopicId,
        source_element_id: resolvedEndpoints.sourceElementId,
        target_element_id: resolvedEndpoints.targetElementId,
        relation_id: editRelationDefinitionId,
        description: editRelationDescription.trim(),
      });
      await syncAfterChange();
      setFeedback({ kind: "success", text: "Связь между элементами обновлена." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  function handleDeleteElementRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (!deleteRelationId) {
      return;
    }

    openDeleteConfirmation("element-relation", deleteRelationId);
  }

  function legacyRenderTopicTabBeforeElements() {
    return (
      <div className="editor-accordion">
        <details className="editor-block" open>
          <summary>Создать тему</summary>
          <form className="editor-form" onSubmit={handleCreateTopic}>
            <label className="field">
              <span>Название</span>
              <input
                value={topicName}
                onChange={(event) => setTopicName(event.target.value)}
                placeholder="Название темы"
                required
              />
            </label>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={topicDescription}
                onChange={(event) => setTopicDescription(event.target.value)}
                placeholder="Краткое описание темы"
              />
            </label>

            <div className="editor-subsection">
              <div className="editor-subsection__header">
                <div>
                  <strong>Требуемые элементы</strong>
                  <p>Выбери существующие элементы, которые нужны до начала темы.</p>
                </div>
              </div>

              {availableRequiredElementsForTopicCreation.length ? (
                <div className="editor-checklist">
                  {availableRequiredElementsForTopicCreation.map((element) => (
                    <label className="editor-checklist__item" key={element.id}>
                      <input
                        type="checkbox"
                        checked={selectedRequiredElementIds.includes(element.id)}
                        onChange={() => toggleRequiredElement(element.id)}
                      />
                      <span>
                        <strong>{element.name}</strong>
                        <small>{competenceLabel(element.competence_type)}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="editor-empty">Пока нет элементов для выбора.</p>
              )}
            </div>

            <div className="editor-subsection">
              <div className="editor-subsection__header">
                <div>
                  <strong>Новые элементы</strong>
                  <p>Добавь элементы, которые будут сформированы в результате изучения темы.</p>
                </div>

                <button
                  className="secondary-button"
                  onClick={addTopicNewElementDraft}
                  type="button"
                >
                  + Добавить элемент
                </button>
              </div>

              {topicNewElements.length ? (
                <div className="editor-drafts">
                  {topicNewElements.map((draft, index) => (
                    <div className="editor-draft-card" key={draft.clientId}>
                      <div className="editor-draft-card__header">
                        <strong>Новый элемент {index + 1}</strong>
                        <button
                          className="secondary-button secondary-button--danger"
                          onClick={() => removeTopicNewElementDraft(draft.clientId)}
                          type="button"
                        >
                          Удалить
                        </button>
                      </div>

                      <div className="editor-form__grid">
                        <label className="field">
                          <span>Название</span>
                          <input
                            value={draft.name}
                            onChange={(event) =>
                              updateTopicNewElementDraft(draft.clientId, {
                                name: event.target.value,
                              })
                            }
                            placeholder="Название нового элемента"
                          />
                        </label>

                        <label className="field">
                          <span>Компетенция</span>
                          <select
                            value={draft.competenceType}
                            onChange={(event) =>
                              updateTopicNewElementDraft(draft.clientId, {
                                competenceType: event.target.value as CompetenceType,
                              })
                            }
                          >
                            {COMPETENCE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label className="field">
                        <span>Описание</span>
                        <textarea
                          rows={2}
                          value={draft.description}
                          onChange={(event) =>
                            updateTopicNewElementDraft(draft.clientId, {
                              description: event.target.value,
                            })
                          }
                          placeholder="Краткое описание нового элемента"
                        />
                      </label>

                      {draft.competenceType === "can" ? (
                        <label className="field">
                          <span>Операция алгоритмической библиотеки</span>
                          <select
                            value={draft.operationRef}
                            onChange={(event) =>
                              updateTopicNewElementDraft(draft.clientId, {
                                operationRef: event.target.value,
                              })
                            }
                          >
                            <option value="">Выбери операцию</option>
                            {operationContracts.map((contract) => (
                              <option key={contract.id} value={contract.id}>
                                {contract.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="editor-empty">Пока не добавлено ни одного нового элемента.</p>
              )}
            </div>

            <button className="primary-button" disabled={!topicName.trim() || !!busyAction}>
              {busyAction === "topic-create" ? "Сохраняю..." : "Создать тему"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Редактировать тему</summary>
          <form className="editor-form" onSubmit={handleUpdateTopic}>
            <label className="field">
              <span>Тема</span>
              <select
                value={editTopicId}
                onChange={(event) => setEditTopicId(event.target.value)}
                disabled={!sortedTopics.length}
              >
                {sortedTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>

            {!sortedTopics.length ? (
              <p className="editor-empty">Сначала создай хотя бы одну тему.</p>
            ) : null}

            <label className="field">
              <span>Название</span>
              <input
                value={editTopicName}
                onChange={(event) => setEditTopicName(event.target.value)}
                placeholder="Название темы"
                disabled={!sortedTopics.length}
                required
              />
            </label>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={editTopicDescription}
                onChange={(event) => setEditTopicDescription(event.target.value)}
                placeholder="Описание темы"
                disabled={!sortedTopics.length}
              />
            </label>

            <button
              className="primary-button"
              disabled={!editTopicId || !editTopicName.trim() || !!busyAction}
            >
              {busyAction === "topic-update" ? "Сохраняю..." : "Сохранить тему"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Удалить тему</summary>
          <form className="editor-form" onSubmit={handleDeleteTopic}>
            <label className="field">
              <span>Тема</span>
              <select
                value={deleteTopicId}
                onChange={(event) => setDeleteTopicId(event.target.value)}
                disabled={!sortedTopics.length}
              >
                {sortedTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>

            {!sortedTopics.length ? (
              <p className="editor-empty">Сейчас нет тем для удаления.</p>
            ) : null}

            <div className="editor-form__grid">
              <button
                className="secondary-button secondary-button--danger"
                disabled={!deleteTopicId || !!busyAction}
              >
                {busyAction === "topic-delete" ? "Удаляю..." : "Удалить тему"}
              </button>
              <button
                className="secondary-button secondary-button--danger"
                disabled={!deleteTopicId || !!busyAction}
                onClick={handleDeleteTopicWithElements}
                type="button"
              >
                {busyAction === "topic-delete"
                  ? "Удаляю..."
                  : "Удалить тему и формируемые элементы"}
              </button>
            </div>
          </form>
        </details>

      </div>
    );
  }
  function legacyRenderElementsTab() {
    return (
      <div className="editor-accordion">
        <details className="editor-block" open>
          <summary>Создать элемент</summary>
          <form className="editor-form" onSubmit={handleCreateElement}>
            <label className="field">
              <span>Название</span>
              <input
                value={elementName}
                onChange={(event) => setElementName(event.target.value)}
                placeholder="Название элемента"
                required
              />
            </label>

            <div className="editor-form__grid">
              <label className="field">
                <span>Компетенция</span>
                <select
                  value={elementCompetence}
                  onChange={(event) => setElementCompetence(event.target.value as CompetenceType)}
                >
                  {COMPETENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={elementDescription}
                onChange={(event) => setElementDescription(event.target.value)}
                placeholder="Краткое описание элемента"
              />
            </label>

            {!sortedTopics.length ? (
              <p className="editor-empty">
                Пока нет тем. Элемент будет создан без привязки и появится в списке непривязанных.
              </p>
            ) : (
              <label className="field">
                <span>Сразу привязать к теме</span>
                <select
                  value={elementCreateTopicId}
                  onChange={(event) => setElementCreateTopicId(event.target.value)}
                >
                  <option value="">Не привязывать</option>
                  {sortedTopics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            <button className="primary-button" disabled={!elementName.trim() || !!busyAction}>
              {busyAction === "element-create" ? "Сохраняю..." : "Создать элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Привязать элемент к теме</summary>
          <form className="editor-form" onSubmit={handleAttachElement}>
            {!sortedTopics.length ? (
              <p className="editor-empty">Сначала создай тему.</p>
            ) : null}
            {!sortedAllElements.length ? (
              <p className="editor-empty">Сначала создай элемент.</p>
            ) : null}

            <div className="editor-form__grid">
              <label className="field">
                <span>Тема</span>
                <select
                  value={topicElementTopicId}
                  onChange={(event) => setTopicElementTopicId(event.target.value)}
                  disabled={!sortedTopics.length}
                >
                  {sortedTopics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Элемент</span>
                <select
                  value={topicElementElementId}
                  onChange={(event) => setTopicElementElementId(event.target.value)}
                  disabled={!attachableElementsForTopic.length}
                >
                  {attachableElementsForTopic.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.name} ({competenceLabel(element.competence_type)})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {sortedAllElements.length && !attachableElementsForTopic.length ? (
              <p className="editor-empty">
                Для этой темы сейчас нет элементов, которые можно прикрепить.
              </p>
            ) : null}

            <label className="field">
              <span>Роль</span>
              <select
                value={topicElementRole}
                onChange={(event) =>
                  setTopicElementRole(event.target.value as TopicKnowledgeElementRole)
                }
                disabled={!attachableRolesForTopicElement.length}
              >
                {attachableRolesForTopicElement.map((role) => {
                  const option = TOPIC_LINK_ROLE_OPTIONS.find((item) => item.value === role);
                  return (
                    <option key={role} value={role}>
                      {option?.label ?? role}
                    </option>
                  );
                })}
              </select>
            </label>

            {topicElementElementId && !attachableRolesForTopicElement.length ? (
              <p className="editor-empty">
                Для выбранного элемента в этой теме нет допустимых ролей.
              </p>
            ) : null}

            <label className="field">
              <span>Комментарий</span>
              <textarea
                rows={2}
                value={topicElementNote}
                onChange={(event) => setTopicElementNote(event.target.value)}
                placeholder="Необязательный комментарий к привязке"
              />
            </label>

            <button
              className="primary-button"
              disabled={
                !topicElementTopicId ||
                !topicElementElementId ||
                !attachableRolesForTopicElement.length ||
                !!busyAction
              }
            >
              {busyAction === "topic-element" ? "Сохраняю..." : "Привязать элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Редактировать элемент</summary>
          <form className="editor-form" onSubmit={handleUpdateElement}>
            <label className="field">
              <span>Элемент</span>
              <select
                value={editElementId}
                onChange={(event) => setEditElementId(event.target.value)}
                disabled={!sortedAllElements.length}
              >
                {sortedAllElements.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.name} ({competenceLabel(element.competence_type)})
                  </option>
                ))}
              </select>
            </label>

            {!sortedAllElements.length ? (
              <p className="editor-empty">Сейчас нет элементов для редактирования.</p>
            ) : null}

            <label className="field">
              <span>Название</span>
              <input
                value={editElementName}
                onChange={(event) => setEditElementName(event.target.value)}
                placeholder="Название элемента"
                disabled={!sortedAllElements.length}
                required
              />
            </label>

            <div className="editor-form__grid">
              <label className="field">
                <span>Компетенция</span>
                <select
                  value={editElementCompetence}
                  onChange={(event) =>
                    setEditElementCompetence(event.target.value as CompetenceType)
                  }
                  disabled={!sortedAllElements.length}
                >
                  {COMPETENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={editElementDescription}
                onChange={(event) => setEditElementDescription(event.target.value)}
                placeholder="Описание элемента"
                disabled={!sortedAllElements.length}
              />
            </label>

            <button
              className="primary-button"
              disabled={!editElementId || !editElementName.trim() || !!busyAction}
            >
              {busyAction === "element-update" ? "Сохраняю..." : "Сохранить элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>{"Удалить элементы"}</summary>
          <form className="editor-form" onSubmit={handleDeleteElement}>
            {!sortedAllElements.length ? (
              <p className="editor-empty">{"Сейчас нет элементов для удаления."}</p>
            ) : (
              <div className="editor-subsection">
                <div className="editor-subsection__header">
                  <div>
                    <strong>{"Выбери элементы для удаления"}</strong>
                    <p>{"Отмеченные элементы будут удалены вместе со связями и привязками к темам."}</p>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="secondary-button"
                      onClick={selectAllDeleteElements}
                      type="button"
                      disabled={!sortedAllElements.length || !!busyAction}
                    >
                      {"Выбрать все"}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={clearDeleteElementSelection}
                      type="button"
                      disabled={!deleteElementIds.length || !!busyAction}
                    >
                      {"Снять выбор"}
                    </button>
                  </div>
                </div>

                <div className="editor-checklist">
                  {sortedAllElements.map((element) => (
                    <label className="editor-checklist__item" key={element.id}>
                      <input
                        type="checkbox"
                        checked={deleteElementIds.includes(element.id)}
                        onChange={() => toggleDeleteElementSelection(element.id)}
                        disabled={!!busyAction}
                      />
                      <span>
                        <strong>{element.name}</strong>
                        <small>
                          {competenceLabel(element.competence_type)}
                          {element.description?.trim() ? ` - ${element.description}` : ""}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {sortedAllElements.length ? (
              <p className="editor-helper">
                {`Выбрано элементов: ${deleteElementIds.length}`}
              </p>
            ) : null}

            <button
              className="secondary-button secondary-button--danger"
              disabled={!deleteElementIds.length || !!busyAction}
            >
              {busyAction === "element-delete"
                ? "Удаляю..."
                : deleteElementIds.length > 1
                  ? `Удалить выбранные (${deleteElementIds.length})`
                  : "Удалить выбранный элемент"}
            </button>
          </form>
        </details>

      </div>
    );
  }

  function renderTopicTab() {
    return (
      <div className="editor-accordion">
        <details className="editor-block" open>
          <summary>Создать тему</summary>
          <form className="editor-form" onSubmit={handleCreateTopic}>
            <label className="field">
              <span>Название</span>
              <input
                value={topicName}
                onChange={(event) => setTopicName(event.target.value)}
                placeholder="Название темы"
                required
              />
            </label>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={topicDescription}
                onChange={(event) => setTopicDescription(event.target.value)}
                placeholder="Краткое описание темы"
              />
            </label>

            <div className="editor-subsection">
              <div className="editor-subsection__header">
                <div>
                  <strong>Требуемые элементы</strong>
                  <p>Выбери существующие элементы, которые нужны до начала темы.</p>
                </div>
              </div>

              {availableRequiredElementsForTopicCreation.length ? (
                <div className="editor-checklist">
                  {availableRequiredElementsForTopicCreation.map((element) => (
                    <label className="editor-checklist__item" key={element.id}>
                      <input
                        type="checkbox"
                        checked={selectedRequiredElementIds.includes(element.id)}
                        onChange={() => toggleRequiredElement(element.id)}
                      />
                      <span>
                        <strong>{element.name}</strong>
                        <small>{competenceLabel(element.competence_type)}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="editor-empty">Пока нет элементов для выбора.</p>
              )}
            </div>

            <div className="editor-subsection">
              <div className="editor-subsection__header">
                <div>
                  <strong>Новые элементы</strong>
                  <p>Добавь элементы, которые будут сформированы в результате изучения темы.</p>
                </div>

                <button
                  className="secondary-button"
                  onClick={addTopicNewElementDraft}
                  type="button"
                >
                  + Добавить элемент
                </button>
              </div>

              {topicNewElements.length ? (
                <div className="editor-drafts">
                  {topicNewElements.map((draft, index) => {
                    const knowledgeDraftOptions =
                      topicDraftKnowledgeOptionsById.get(draft.clientId) ?? [];
                    const skillDraftOptions = topicDraftSkillOptionsById.get(draft.clientId) ?? [];
                    const requiredKnowledgeDrafts =
                      topicDraftRequiredKnowledgeById.get(draft.clientId) ?? [];
                    const uncoveredKnowledgeDrafts =
                      topicDraftUncoveredKnowledgeById.get(draft.clientId) ?? [];
                    const duplicateDomainMappings =
                      topicDraftDuplicateMasterDomainMappingsById.get(draft.clientId) ?? [];

                    return (
                      <div className="editor-draft-card" key={draft.clientId}>
                        <div className="editor-draft-card__header">
                          <strong>Новый элемент {index + 1}</strong>
                          <button
                            className="secondary-button secondary-button--danger"
                            onClick={() => removeTopicNewElementDraft(draft.clientId)}
                            type="button"
                          >
                            Удалить
                          </button>
                        </div>

                        <div className="editor-form__grid">
                          <label className="field">
                            <span>Название</span>
                            <input
                              value={draft.name}
                              onChange={(event) =>
                                updateTopicNewElementDraft(draft.clientId, {
                                  name: event.target.value,
                                })
                              }
                              placeholder="Название нового элемента"
                            />
                          </label>

                          <label className="field">
                            <span>Компетенция</span>
                            <select
                              value={draft.competenceType}
                              onChange={(event) =>
                                updateTopicNewElementDraft(draft.clientId, {
                                  competenceType: event.target.value as CompetenceType,
                                })
                              }
                            >
                              {COMPETENCE_OPTIONS.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                        </div>

                        <label className="field">
                          <span>Описание</span>
                          <textarea
                            rows={2}
                            value={draft.description}
                            onChange={(event) =>
                              updateTopicNewElementDraft(draft.clientId, {
                                description: event.target.value,
                              })
                            }
                            placeholder="Краткое описание нового элемента"
                          />
                        </label>

                        {draft.competenceType === "can" ? (
                          <>
                            <label className="field">
                              <span>Операция алгоритмической библиотеки</span>
                              <select
                                value={draft.operationRef}
                                onChange={(event) =>
                                  updateTopicNewElementDraft(draft.clientId, {
                                    operationRef: event.target.value,
                                  })
                                }
                              >
                                <option value="">Выбери операцию</option>
                                {operationContracts.map((contract) => (
                                  <option key={contract.id} value={contract.id}>
                                    {contract.title}
                                  </option>
                                ))}
                              </select>
                            </label>

                            {knowledgeDraftOptions.length ? (
                              <div className="editor-subsection">
                                <div className="editor-subsection__header">
                                  <div>
                                    <strong>Знания для связи «Реализует»</strong>
                                  </div>
                                </div>

                                <div className="editor-checklist">
                                  {knowledgeDraftOptions.map((knowledgeDraft) => (
                                    <label
                                      className="editor-checklist__item"
                                      key={knowledgeDraft.id}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={draft.realizedKnowledgeDraftIds.includes(
                                          knowledgeDraft.id,
                                        )}
                                        onChange={() =>
                                          toggleTopicDraftRealizedKnowledge(
                                            draft.clientId,
                                            knowledgeDraft.id,
                                          )
                                        }
                                      />
                                      <span>
                                        <strong>{knowledgeDraft.label}</strong>
                                        <small>
                                          {knowledgeDraft.description ||
                                            "Описание пока не заполнено"}
                                        </small>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="editor-empty">
                                Сначала добавь хотя бы один элемент уровня «Знать», чтобы связать
                                его с этим навыком.
                              </p>
                            )}
                          </>
                        ) : null}

                        {draft.competenceType === "master" ? (
                          <>
                            <label className="field">
                              <span>Описание предметной области</span>
                              <textarea
                                rows={3}
                                value={draft.subjectAreaDescription}
                                onChange={(event) =>
                                  updateTopicNewElementDraft(draft.clientId, {
                                    subjectAreaDescription: event.target.value,
                                  })
                                }
                                placeholder="Опиши предметную область и контекст применения элемента"
                              />
                            </label>

                            {skillDraftOptions.length ? (
                              <div className="editor-subsection">
                                <div className="editor-subsection__header">
                                  <div>
                                    <strong>
                                      Элементы уровня «Уметь» для связи «Автоматизирует»
                                    </strong>
                                  </div>
                                </div>

                                <div className="editor-checklist">
                                  {skillDraftOptions.map((skillDraft) => (
                                    <label
                                      className="editor-checklist__item"
                                      key={skillDraft.clientId}
                                    >
                                      <input
                                        type="checkbox"
                                        checked={draft.automatedSkillDraftIds.includes(
                                          skillDraft.clientId,
                                        )}
                                        onChange={() =>
                                          toggleTopicDraftAutomatedSkill(
                                            draft.clientId,
                                            skillDraft.clientId,
                                          )
                                        }
                                      />
                                      <span>
                                        <strong>{topicDraftOptionLabel(skillDraft)}</strong>
                                        <small>
                                          {skillDraft.description || "Описание пока не заполнено"}
                                        </small>
                                      </span>
                                    </label>
                                  ))}
                                </div>
                              </div>
                            ) : (
                              <p className="editor-empty">
                                Сначала добавь хотя бы один корректно заполненный элемент уровня
                                «Уметь».
                              </p>
                            )}

                            {draft.automatedSkillDraftIds.length ? (
                              requiredKnowledgeDrafts.length ? (
                                <div className="editor-subsection">
                                  <div className="editor-subsection__header">
                                    <div>
                                      <strong>
                                        Объекты предметной области и связи «Опирается на»
                                      </strong>
                                    </div>

                                    <button
                                      className="secondary-button"
                                      onClick={() =>
                                        addTopicDraftMasterDomainObject(draft.clientId)
                                      }
                                      type="button"
                                    >
                                      + Добавить объект
                                    </button>
                                  </div>

                                  <div className="editor-chips">
                                    {requiredKnowledgeDrafts.map((knowledgeDraft) => (
                                      <span className="tag tag--muted" key={knowledgeDraft.id}>
                                        {uncoveredKnowledgeDrafts.some(
                                          (item) => item.id === knowledgeDraft.id,
                                        )
                                          ? `Нужно покрыть: ${knowledgeDraft.label}`
                                          : `Покрыто: ${knowledgeDraft.label}`}
                                      </span>
                                    ))}
                                  </div>

                                  {duplicateDomainMappings.length ? (
                                    <p className="editor-empty">
                                      Найдены дублирующиеся сопоставления объекта предметной области
                                      с одним и тем же знанием.
                                    </p>
                                  ) : null}

                                  {draft.masterDomainObjects.length ? (
                                    <div className="editor-domain-objects">
                                      {draft.masterDomainObjects.map((item, objectIndex) => (
                                        <div className="editor-domain-object" key={item.clientId}>
                                          <div className="editor-subsection__header">
                                            <strong>Объект {objectIndex + 1}</strong>
                                            <button
                                              className="secondary-button secondary-button--danger"
                                              onClick={() =>
                                                removeTopicDraftMasterDomainObject(
                                                  draft.clientId,
                                                  item.clientId,
                                                )
                                              }
                                              type="button"
                                            >
                                              Удалить
                                            </button>
                                          </div>

                                          <div className="editor-form__grid">
                                            <label className="field">
                                              <span>Наименование объекта</span>
                                              <input
                                                value={item.objectName}
                                                onChange={(event) =>
                                                  updateTopicDraftMasterDomainObject(
                                                    draft.clientId,
                                                    item.clientId,
                                                    {
                                                      objectName: event.target.value,
                                                    },
                                                  )
                                                }
                                                placeholder="Например: матрица смежности"
                                              />
                                            </label>

                                            <label className="field">
                                              <span>Элемент уровня «Знать»</span>
                                              <select
                                                value={item.knowledgeElementId}
                                                onChange={(event) =>
                                                  updateTopicDraftMasterDomainObject(
                                                    draft.clientId,
                                                    item.clientId,
                                                    {
                                                      knowledgeElementId: event.target.value,
                                                    },
                                                  )
                                                }
                                              >
                                                <option value="">Выбери элемент «Знать»</option>
                                                {knowledgeDraftOptions.map((knowledgeDraft) => (
                                                  <option
                                                    key={knowledgeDraft.id}
                                                    value={knowledgeDraft.id}
                                                  >
                                                    {knowledgeDraft.label}
                                                  </option>
                                                ))}
                                              </select>
                                            </label>
                                          </div>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <p className="editor-empty">
                                      Добавь хотя бы один объект предметной области.
                                    </p>
                                  )}
                                </div>
                              ) : (
                                <p className="editor-empty">
                                  У выбранных элементов «Уметь» пока нет связанных знаний уровня
                                  «Знать».
                                </p>
                              )
                            ) : null}
                          </>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="editor-empty">Пока не добавлено ни одного нового элемента.</p>
              )}
            </div>

            <button className="primary-button" disabled={!topicName.trim() || !!busyAction}>
              {busyAction === "topic-create" ? "Сохраняю..." : "Создать тему"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Редактировать тему</summary>
          <form className="editor-form" onSubmit={handleUpdateTopic}>
            <label className="field">
              <span>Тема</span>
              <select
                value={editTopicId}
                onChange={(event) => setEditTopicId(event.target.value)}
                disabled={!sortedTopics.length}
              >
                {sortedTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>

            {!sortedTopics.length ? (
              <p className="editor-empty">Сначала создай хотя бы одну тему.</p>
            ) : null}

            <label className="field">
              <span>Название</span>
              <input
                value={editTopicName}
                onChange={(event) => setEditTopicName(event.target.value)}
                placeholder="Название темы"
                disabled={!sortedTopics.length}
                required
              />
            </label>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={editTopicDescription}
                onChange={(event) => setEditTopicDescription(event.target.value)}
                placeholder="Описание темы"
                disabled={!sortedTopics.length}
              />
            </label>

            <button
              className="primary-button"
              disabled={!editTopicId || !editTopicName.trim() || !!busyAction}
            >
              {busyAction === "topic-update" ? "Сохраняю..." : "Сохранить тему"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Удалить тему</summary>
          <form className="editor-form" onSubmit={handleDeleteTopic}>
            <label className="field">
              <span>Тема</span>
              <select
                value={deleteTopicId}
                onChange={(event) => setDeleteTopicId(event.target.value)}
                disabled={!sortedTopics.length}
              >
                {sortedTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>

            {!sortedTopics.length ? (
              <p className="editor-empty">Сейчас нет тем для удаления.</p>
            ) : null}

            <div className="editor-form__grid">
              <button
                className="secondary-button secondary-button--danger"
                disabled={!deleteTopicId || !!busyAction}
              >
                {busyAction === "topic-delete" ? "Удаляю..." : "Удалить тему"}
              </button>
              <button
                className="secondary-button secondary-button--danger"
                disabled={!deleteTopicId || !!busyAction}
                onClick={handleDeleteTopicWithElements}
                type="button"
              >
                {busyAction === "topic-delete"
                  ? "Удаляю..."
                  : "Удалить тему и формируемые элементы"}
              </button>
            </div>
          </form>
        </details>
      </div>
    );
  }

  function legacyRenderTopicTabAfterElements() {
    return (
      <div className="editor-accordion">
        <details className="editor-block" open>
          <summary>Создать тему</summary>
          <form className="editor-form" onSubmit={handleCreateTopic}>
            <label className="field">
              <span>Название</span>
              <input
                value={topicName}
                onChange={(event) => setTopicName(event.target.value)}
                placeholder="Название темы"
                required
              />
            </label>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={topicDescription}
                onChange={(event) => setTopicDescription(event.target.value)}
                placeholder="Краткое описание темы"
              />
            </label>

            <div className="editor-subsection">
              <div className="editor-subsection__header">
                <div>
                  <strong>Требуемые элементы</strong>
                  <p>Выбери существующие элементы, которые нужны до начала темы.</p>
                </div>
              </div>

              {availableRequiredElementsForTopicCreation.length ? (
                <div className="editor-checklist">
                  {availableRequiredElementsForTopicCreation.map((element) => (
                    <label className="editor-checklist__item" key={element.id}>
                      <input
                        type="checkbox"
                        checked={selectedRequiredElementIds.includes(element.id)}
                        onChange={() => toggleRequiredElement(element.id)}
                      />
                      <span>
                        <strong>{element.name}</strong>
                        <small>{competenceLabel(element.competence_type)}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                <p className="editor-empty">Пока нет элементов для выбора.</p>
              )}
            </div>

            <div className="editor-subsection">
              <div className="editor-subsection__header">
                <div>
                  <strong>Новые элементы</strong>
                  <p>Добавь элементы, которые будут сформированы в результате изучения темы.</p>
                </div>

                <button
                  className="secondary-button"
                  onClick={addTopicNewElementDraft}
                  type="button"
                >
                  + Добавить элемент
                </button>
              </div>

              {topicNewElements.length ? (
                <div className="editor-drafts">
                  {topicNewElements.map((draft, index) => (
                    <div className="editor-draft-card" key={draft.clientId}>
                      <div className="editor-draft-card__header">
                        <strong>Новый элемент {index + 1}</strong>
                        <button
                          className="secondary-button secondary-button--danger"
                          onClick={() => removeTopicNewElementDraft(draft.clientId)}
                          type="button"
                        >
                          Удалить
                        </button>
                      </div>

                      <div className="editor-form__grid">
                        <label className="field">
                          <span>Название</span>
                          <input
                            value={draft.name}
                            onChange={(event) =>
                              updateTopicNewElementDraft(draft.clientId, {
                                name: event.target.value,
                              })
                            }
                            placeholder="Название нового элемента"
                          />
                        </label>

                        <label className="field">
                          <span>Компетенция</span>
                          <select
                            value={draft.competenceType}
                            onChange={(event) =>
                              updateTopicNewElementDraft(draft.clientId, {
                                competenceType: event.target.value as CompetenceType,
                              })
                            }
                          >
                            {COMPETENCE_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>

                      <label className="field">
                        <span>Описание</span>
                        <textarea
                          rows={2}
                          value={draft.description}
                          onChange={(event) =>
                            updateTopicNewElementDraft(draft.clientId, {
                              description: event.target.value,
                            })
                          }
                          placeholder="Краткое описание нового элемента"
                        />
                      </label>

                      {draft.competenceType === "can" ? (
                        <label className="field">
                          <span>Операция алгоритмической библиотеки</span>
                          <select
                            value={draft.operationRef}
                            onChange={(event) =>
                              updateTopicNewElementDraft(draft.clientId, {
                                operationRef: event.target.value,
                              })
                            }
                          >
                            <option value="">Выбери операцию</option>
                            {operationContracts.map((contract) => (
                              <option key={contract.id} value={contract.id}>
                                {contract.title}
                              </option>
                            ))}
                          </select>
                        </label>
                      ) : null}
                    </div>
                  ))}
                </div>
              ) : (
                <p className="editor-empty">Пока не добавлено ни одного нового элемента.</p>
              )}
            </div>

            <button className="primary-button" disabled={!topicName.trim() || !!busyAction}>
              {busyAction === "topic-create" ? "Сохраняю..." : "Создать тему"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Редактировать тему</summary>
          <form className="editor-form" onSubmit={handleUpdateTopic}>
            <label className="field">
              <span>Тема</span>
              <select
                value={editTopicId}
                onChange={(event) => setEditTopicId(event.target.value)}
                disabled={!sortedTopics.length}
              >
                {sortedTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>

            {!sortedTopics.length ? (
              <p className="editor-empty">Сначала создай хотя бы одну тему.</p>
            ) : null}

            <label className="field">
              <span>Название</span>
              <input
                value={editTopicName}
                onChange={(event) => setEditTopicName(event.target.value)}
                placeholder="Название темы"
                disabled={!sortedTopics.length}
                required
              />
            </label>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={editTopicDescription}
                onChange={(event) => setEditTopicDescription(event.target.value)}
                placeholder="Описание темы"
                disabled={!sortedTopics.length}
              />
            </label>

            <button
              className="primary-button"
              disabled={!editTopicId || !editTopicName.trim() || !!busyAction}
            >
              {busyAction === "topic-update" ? "Сохраняю..." : "Сохранить тему"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Удалить тему</summary>
          <form className="editor-form" onSubmit={handleDeleteTopic}>
            <label className="field">
              <span>Тема</span>
              <select
                value={deleteTopicId}
                onChange={(event) => setDeleteTopicId(event.target.value)}
                disabled={!sortedTopics.length}
              >
                {sortedTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.name}
                  </option>
                ))}
              </select>
            </label>

            {!sortedTopics.length ? (
              <p className="editor-empty">Сейчас нет тем для удаления.</p>
            ) : null}

            <div className="editor-form__grid">
              <button
                className="secondary-button secondary-button--danger"
                disabled={!deleteTopicId || !!busyAction}
              >
                {busyAction === "topic-delete" ? "Удаляю..." : "Удалить тему"}
              </button>
              <button
                className="secondary-button secondary-button--danger"
                disabled={!deleteTopicId || !!busyAction}
                onClick={handleDeleteTopicWithElements}
                type="button"
              >
                {busyAction === "topic-delete"
                  ? "Удаляю..."
                  : "Удалить тему и формируемые элементы"}
              </button>
            </div>
          </form>
        </details>
      </div>
    );
  }

  function renderElementsTab() {
    return (
      <div className="editor-accordion">
        <details className="editor-block" open>
          <summary>Создать элемент</summary>
          <form className="editor-form" onSubmit={handleCreateElement}>
            <label className="field">
              <span>Название</span>
              <input
                value={elementName}
                onChange={(event) => setElementName(event.target.value)}
                placeholder="Название элемента"
                required
              />
            </label>

            <div className="editor-form__grid">
              <label className="field">
                <span>Компетенция</span>
                <select
                  value={elementCompetence}
                  onChange={(event) => setElementCompetence(event.target.value as CompetenceType)}
                >
                  {COMPETENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {elementCompetence === "can" ? (
                <label className="field" style={{ display: "none" }}>
                  <span>Операция алгоритмической библиотеки</span>
                  <select
                    value={elementOperationRef}
                    onChange={(event) => setElementOperationRef(event.target.value)}
                  >
                    <option value="">Выбери операцию</option>
                    {operationContracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={elementDescription}
                onChange={(event) => setElementDescription(event.target.value)}
                placeholder="Краткое описание элемента"
              />
            </label>

            {!sortedTopics.length ? null : (
              <label className="field">
                <span>Тема элемента</span>
                <select
                  value={elementCreateTopicId}
                  onChange={(event) => setElementCreateTopicId(event.target.value)}
                >
                  {elementCompetence === "can" ? null : <option value="">Не привязывать</option>}
                  {sortedTopics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </label>
            )}

            {elementCompetence === "can" ? (
              !elementCreateTopicId ? (
                null
              ) : availableKnowledgeForNewSkillElement.length ? (
                <div className="editor-subsection">
                  <div className="editor-subsection__header">
                    <div>
                      <strong>Связанные элементы темы</strong>
                    </div>
                  </div>

                  <div className="editor-checklist">
                    {availableKnowledgeForNewSkillElement.map((element) => (
                      <label className="editor-checklist__item" key={element.id}>
                        <input
                          type="checkbox"
                          checked={elementRealizedKnowledgeIds.includes(element.id)}
                          onChange={() => toggleElementRealizedKnowledge(element.id)}
                        />
                        <span>
                          <strong>{element.name}</strong>
                          <small>{element.description || "Описание пока не заполнено"}</small>
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="editor-empty">В выбранной теме пока нет элементов уровней Знать или Уметь.</p>
              )
            ) : sortedTopics.length > 0 && !elementCreateTopicId ? (
              null
            ) : null}

            {elementCompetence === "can" ? (
              <label className="field">
                <span>Операция алгоритмической библиотеки</span>
                <select
                  value={elementOperationRef}
                  onChange={(event) => setElementOperationRef(event.target.value)}
                >
                  <option value="">Выбери операцию</option>
                  {operationContracts.map((contract) => (
                    <option key={contract.id} value={contract.id}>
                      {contract.title}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {elementCompetence === "master" ? (
              !elementCreateTopicId ? (
                null
              ) : (
                <>
                  <label className="field">
                    <span>Описание предметной области</span>
                    <textarea
                      rows={3}
                      value={elementSubjectAreaDescription}
                      onChange={(event) =>
                        setElementSubjectAreaDescription(event.target.value)
                      }
                      placeholder="Опиши предметную область и контекст применения этого элемента"
                    />
                  </label>

                  <div className="editor-subsection">
                    <div className="editor-subsection__header">
                      <div>
                        <strong>Элементы уровня «Уметь» для связи «Автоматизирует»</strong>
                      </div>
                    </div>

                    <div className="editor-checklist">
                      {availableSkillElementsForMaster.map((element) => (
                        <label className="editor-checklist__item" key={element.id}>
                          <input
                            type="checkbox"
                            checked={elementAutomatedSkillIds.includes(element.id)}
                            onChange={() => toggleElementAutomatedSkill(element.id)}
                          />
                          <span>
                            <strong>{element.name}</strong>
                            <small>{element.description || "Описание пока не заполнено"}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  </div>

                  {!availableSkillElementsForMaster.length ? (
                    <p className="editor-empty">
                      В выбранной теме пока нет элементов уровня «Уметь», связанных с
                      алгоритмом.
                    </p>
                  ) : null}

                  {elementAutomatedSkillIds.length ? (
                    requiredKnowledgeForMaster.length ? (
                      <div className="editor-subsection">
                        <div className="editor-subsection__header">
                          <div>
                            <strong>Объекты предметной области и связи «Опирается на»</strong>
                          </div>

                          <button
                            className="secondary-button"
                            onClick={addMasterDomainObjectDraft}
                            type="button"
                          >
                            + Добавить объект
                          </button>
                        </div>

                        <div className="editor-chips">
                          {requiredKnowledgeForMaster.map((element) => (
                            <span className="tag tag--muted" key={element.id}>
                              {uncoveredKnowledgeForMaster.some(
                                (item) => item.id === element.id,
                              )
                                ? `Нужно покрыть: ${element.name}`
                                : `Покрыто: ${element.name}`}
                            </span>
                          ))}
                        </div>

                        {duplicateMasterDomainObjectMappings.length ? (
                          <p className="editor-empty">
                            Найдены дублирующиеся сопоставления. Один и тот же объект нельзя
                            дважды связать с одним и тем же элементом «Знать».
                          </p>
                        ) : null}

                        {elementMasterDomainObjects.length ? (
                          <div className="editor-domain-objects">
                            {elementMasterDomainObjects.map((item, index) => (
                              <div className="editor-domain-object" key={item.clientId}>
                                <div className="editor-subsection__header">
                                  <strong>Объект {index + 1}</strong>
                                  <button
                                    className="secondary-button secondary-button--danger"
                                    onClick={() =>
                                      removeMasterDomainObjectDraft(item.clientId)
                                    }
                                    type="button"
                                  >
                                    Удалить
                                  </button>
                                </div>

                                <div className="editor-form__grid">
                                  <label className="field">
                                    <span>Наименование объекта</span>
                                    <input
                                      value={item.objectName}
                                      onChange={(event) =>
                                        updateMasterDomainObjectDraft(item.clientId, {
                                          objectName: event.target.value,
                                        })
                                      }
                                      placeholder="Например: матрица смежности"
                                    />
                                  </label>

                                  <label className="field">
                                    <span>Элемент уровня «Знать»</span>
                                    <select
                                      value={item.knowledgeElementId}
                                      onChange={(event) =>
                                        updateMasterDomainObjectDraft(item.clientId, {
                                          knowledgeElementId: event.target.value,
                                        })
                                      }
                                    >
                                      <option value="">Выбери элемент «Знать»</option>
                                      {availableKnowledgeForMaster.map((element) => (
                                        <option key={element.id} value={element.id}>
                                          {element.name}
                                        </option>
                                      ))}
                                    </select>
                                  </label>
                                </div>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="editor-empty">
                            Добавь хотя бы один объект предметной области.
                          </p>
                        )}
                      </div>
                    ) : (
                      <p className="editor-empty">
                        У выбранных элементов «Уметь» нет связанных знаний уровня
                        «Знать» в этой теме.
                      </p>
                    )
                  ) : null}
                </>
              )
            ) : null}

            <button
              className="primary-button"
              disabled={
                !elementName.trim() ||
                (elementCompetence === "can" && (!elementOperationRef || !elementCreateTopicId || !elementRealizedKnowledgeIds.length)) ||
                (elementCompetence === "master" &&
                  (!elementCreateTopicId ||
                    !elementSubjectAreaDescription.trim() ||
                    !elementAutomatedSkillIds.length ||
                    !requiredKnowledgeForMaster.length ||
                    !elementMasterDomainObjects.length ||
                    elementMasterDomainObjects.some(
                      (item) => !item.objectName.trim() || !item.knowledgeElementId,
                    ) ||
                    !!duplicateMasterDomainObjectMappings.length ||
                    !!uncoveredKnowledgeForMaster.length)) ||
                !!busyAction
              }
            >
              {busyAction === "element-create" ? "Сохраняю..." : "Создать элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Привязать элемент к теме</summary>
          <form className="editor-form" onSubmit={handleAttachElement}>
            {!sortedTopics.length ? (
              <p className="editor-empty">Сначала создай тему.</p>
            ) : null}
            {!sortedAllElements.length ? (
              <p className="editor-empty">Сначала создай элемент.</p>
            ) : null}

            <div className="editor-form__grid">
              <label className="field">
                <span>Тема</span>
                <select
                  value={topicElementTopicId}
                  onChange={(event) => setTopicElementTopicId(event.target.value)}
                  disabled={!sortedTopics.length}
                >
                  {sortedTopics.map((topic) => (
                    <option key={topic.id} value={topic.id}>
                      {topic.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Элемент</span>
                <select
                  value={topicElementElementId}
                  onChange={(event) => setTopicElementElementId(event.target.value)}
                  disabled={!attachableElementsForTopic.length}
                >
                  {attachableElementsForTopic.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.name} ({competenceLabel(element.competence_type)})
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {sortedAllElements.length && !attachableElementsForTopic.length ? (
              <p className="editor-empty">
                Для этой темы сейчас нет элементов, которые можно прикрепить.
              </p>
            ) : null}

            <label className="field">
              <span>Связь</span>
              <select
                value={topicElementRole}
                onChange={(event) =>
                  setTopicElementRole(event.target.value as TopicKnowledgeElementRole)
                }
                disabled={!attachableRolesForTopicElement.length}
              >
                {attachableRolesForTopicElement.map((role) => {
                  const option = TOPIC_LINK_ROLE_OPTIONS.find((item) => item.value === role);
                  return (
                    <option key={role} value={role}>
                      {option?.label ?? role}
                    </option>
                  );
                })}
              </select>
            </label>

            {topicElementElementId && !attachableRolesForTopicElement.length ? (
              <p className="editor-empty">
                Для выбранного элемента в этой теме нет допустимых связей.
              </p>
            ) : null}

            <label className="field">
              <span>Комментарий</span>
              <textarea
                rows={2}
                value={topicElementNote}
                onChange={(event) => setTopicElementNote(event.target.value)}
                placeholder="Необязательный комментарий к привязке"
              />
            </label>

            <button
              className="primary-button"
              disabled={
                !topicElementTopicId ||
                !topicElementElementId ||
                !attachableRolesForTopicElement.length ||
                !!busyAction
              }
            >
              {busyAction === "topic-element" ? "Сохраняю..." : "Привязать элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Редактировать элемент</summary>
          <form className="editor-form" onSubmit={handleUpdateElement}>
            <label className="field">
              <span>Элемент</span>
              <select
                value={editElementId}
                onChange={(event) => setEditElementId(event.target.value)}
                disabled={!sortedAllElements.length}
              >
                {sortedAllElements.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.name} ({competenceLabel(element.competence_type)})
                  </option>
                ))}
              </select>
            </label>

            {!sortedAllElements.length ? (
              <p className="editor-empty">Сейчас нет элементов для редактирования.</p>
            ) : null}

            <label className="field">
              <span>Название</span>
              <input
                value={editElementName}
                onChange={(event) => setEditElementName(event.target.value)}
                placeholder="Название элемента"
                disabled={!sortedAllElements.length}
                required
              />
            </label>

            <div className="editor-form__grid">
              <label className="field">
                <span>Компетенция</span>
                <select
                  value={editElementCompetence}
                  onChange={(event) =>
                    setEditElementCompetence(event.target.value as CompetenceType)
                  }
                  disabled={!sortedAllElements.length}
                >
                  {COMPETENCE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              {editElementCompetence === "can" ? (
                <label className="field">
                  <span>Операция алгоритмической библиотеки</span>
                  <select
                    value={editElementOperationRef}
                    onChange={(event) => setEditElementOperationRef(event.target.value)}
                    disabled={!sortedAllElements.length}
                  >
                    <option value="">Выбери операцию</option>
                    {operationContracts.map((contract) => (
                      <option key={contract.id} value={contract.id}>
                        {contract.title}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
            </div>

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={3}
                value={editElementDescription}
                onChange={(event) => setEditElementDescription(event.target.value)}
                placeholder="Описание элемента"
                disabled={!sortedAllElements.length}
              />
            </label>

            {editElementCompetence === "can" ? (
              <>
                <label className="field">
                  <span>Тема элемента</span>
                  <select
                    value={editElementTopicId}
                    onChange={(event) => setEditElementTopicId(event.target.value)}
                    disabled={!sortedTopics.length}
                  >
                    <option value="">Выбери тему</option>
                    {sortedTopics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                </label>

                {editElementTopicId ? (
                  editAvailableKnowledgeForSkillElement.length ? (
                    <div className="editor-subsection">
                      <div className="editor-subsection__header">
                        <div>
                          <strong>Связанные элементы «Знать»</strong>
                        </div>
                      </div>

                      <div className="editor-checklist">
                        {editAvailableKnowledgeForSkillElement.map((element) => (
                          <label className="editor-checklist__item" key={element.id}>
                            <input
                              type="checkbox"
                              checked={editElementRealizedKnowledgeIds.includes(element.id)}
                              onChange={() => toggleEditElementRealizedKnowledge(element.id)}
                            />
                            <span>
                              <strong>{element.name}</strong>
                              <small>{element.description || "Описание пока не заполнено"}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="editor-empty">
                      В выбранной теме пока нет элементов уровня «Знать» для связи «Реализует».
                    </p>
                  )
                ) : null}
              </>
            ) : null}

            {editElementCompetence === "master" ? (
              <>
                <label className="field">
                  <span>Тема элемента</span>
                  <select
                    value={editElementTopicId}
                    onChange={(event) => setEditElementTopicId(event.target.value)}
                    disabled={!sortedTopics.length}
                  >
                    <option value="">Выбери тему</option>
                    {sortedTopics.map((topic) => (
                      <option key={topic.id} value={topic.id}>
                        {topic.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="field">
                  <span>Описание предметной области</span>
                  <textarea
                    rows={3}
                    value={editElementSubjectAreaDescription}
                    onChange={(event) =>
                      setEditElementSubjectAreaDescription(event.target.value)
                    }
                    placeholder="Опиши предметную область и контекст применения этого элемента"
                    disabled={!sortedTopics.length}
                  />
                </label>

                {editElementTopicId ? (
                  <>
                    <div className="editor-subsection">
                      <div className="editor-subsection__header">
                        <div>
                          <strong>Элементы уровня «Уметь» для связи «Автоматизирует»</strong>
                        </div>
                      </div>

                      <div className="editor-checklist">
                        {editAvailableSkillElementsForMaster.map((element) => (
                          <label className="editor-checklist__item" key={element.id}>
                            <input
                              type="checkbox"
                              checked={editElementAutomatedSkillIds.includes(element.id)}
                              onChange={() => toggleEditElementAutomatedSkill(element.id)}
                            />
                            <span>
                              <strong>{element.name}</strong>
                              <small>{element.description || "Описание пока не заполнено"}</small>
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>

                    {!editAvailableSkillElementsForMaster.length ? (
                      <p className="editor-empty">
                        В выбранной теме пока нет элементов уровня «Уметь», связанных с
                        алгоритмом.
                      </p>
                    ) : null}

                    {editElementAutomatedSkillIds.length ? (
                      editRequiredKnowledgeForMaster.length ? (
                        <div className="editor-subsection">
                          <div className="editor-subsection__header">
                            <div>
                              <strong>Объекты предметной области и связи «Опирается на»</strong>
                            </div>

                            <button
                              className="secondary-button"
                              onClick={addEditMasterDomainObjectDraft}
                              type="button"
                            >
                              + Добавить объект
                            </button>
                          </div>

                          <div className="editor-chips">
                            {editRequiredKnowledgeForMaster.map((element) => (
                              <span className="tag tag--muted" key={element.id}>
                                {editUncoveredKnowledgeForMaster.some(
                                  (item) => item.id === element.id,
                                )
                                  ? `Нужно покрыть: ${element.name}`
                                  : `Покрыто: ${element.name}`}
                              </span>
                            ))}
                          </div>

                          {editDuplicateMasterDomainObjectMappings.length ? (
                            <p className="editor-empty">
                              Найдены дублирующиеся сопоставления. Один и тот же объект нельзя
                              дважды связать с одним и тем же элементом «Знать».
                            </p>
                          ) : null}

                          {editElementMasterDomainObjects.length ? (
                            <div className="editor-domain-objects">
                              {editElementMasterDomainObjects.map((item, index) => (
                                <div className="editor-domain-object" key={item.clientId}>
                                  <div className="editor-subsection__header">
                                    <strong>Объект {index + 1}</strong>
                                    <button
                                      className="secondary-button secondary-button--danger"
                                      onClick={() =>
                                        removeEditMasterDomainObjectDraft(item.clientId)
                                      }
                                      type="button"
                                    >
                                      Удалить
                                    </button>
                                  </div>

                                  <div className="editor-form__grid">
                                    <label className="field">
                                      <span>Наименование объекта</span>
                                      <input
                                        value={item.objectName}
                                        onChange={(event) =>
                                          updateEditMasterDomainObjectDraft(item.clientId, {
                                            objectName: event.target.value,
                                          })
                                        }
                                        placeholder="Например: матрица смежности"
                                      />
                                    </label>

                                    <label className="field">
                                      <span>Элемент уровня «Знать»</span>
                                      <select
                                        value={item.knowledgeElementId}
                                        onChange={(event) =>
                                          updateEditMasterDomainObjectDraft(item.clientId, {
                                            knowledgeElementId: event.target.value,
                                          })
                                        }
                                      >
                                        <option value="">Выбери элемент «Знать»</option>
                                        {editAvailableKnowledgeForMaster.map((element) => (
                                          <option key={element.id} value={element.id}>
                                            {element.name}
                                          </option>
                                        ))}
                                      </select>
                                    </label>
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="editor-empty">
                              Добавь хотя бы один объект предметной области.
                            </p>
                          )}
                        </div>
                      ) : (
                        <p className="editor-empty">
                          У выбранных элементов «Уметь» нет связанных знаний уровня
                          «Знать» в этой теме.
                        </p>
                      )
                    ) : null}
                  </>
                ) : null}
              </>
            ) : null}

            <button
              className="primary-button"
              disabled={
                !editElementId ||
                !editElementName.trim() ||
                (editElementCompetence === "can" &&
                  (!editElementTopicId ||
                    !editElementOperationRef ||
                    !editElementRealizedKnowledgeIds.length)) ||
                (editElementCompetence === "master" &&
                  (!editElementTopicId ||
                    !editElementSubjectAreaDescription.trim() ||
                    !editElementAutomatedSkillIds.length ||
                    !editRequiredKnowledgeForMaster.length ||
                    !editElementMasterDomainObjects.length ||
                    editElementMasterDomainObjects.some(
                      (item) => !item.objectName.trim() || !item.knowledgeElementId,
                    ) ||
                    !!editDuplicateMasterDomainObjectMappings.length ||
                    !!editUncoveredKnowledgeForMaster.length)) ||
                !!busyAction
              }
            >
              {busyAction === "element-update" ? "Сохраняю..." : "Сохранить элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>{"Удалить элементы"}</summary>
          <form className="editor-form" onSubmit={handleDeleteElement}>
            {!sortedAllElements.length ? (
              <p className="editor-empty">{"Сейчас нет элементов для удаления."}</p>
            ) : (
              <div className="editor-subsection">
                <div className="editor-subsection__header">
                  <div>
                    <strong>{"Выбери элементы для удаления"}</strong>
                    <p>{"Отмеченные элементы будут удалены вместе со связями и привязками к темам."}</p>
                  </div>

                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button
                      className="secondary-button"
                      onClick={selectAllDeleteElements}
                      type="button"
                      disabled={!sortedAllElements.length || !!busyAction}
                    >
                      {"Выбрать все"}
                    </button>
                    <button
                      className="ghost-button"
                      onClick={clearDeleteElementSelection}
                      type="button"
                      disabled={!deleteElementIds.length || !!busyAction}
                    >
                      {"Снять выбор"}
                    </button>
                  </div>
                </div>

                <div className="editor-checklist">
                  {sortedAllElements.map((element) => (
                    <label className="editor-checklist__item" key={element.id}>
                      <input
                        type="checkbox"
                        checked={deleteElementIds.includes(element.id)}
                        onChange={() => toggleDeleteElementSelection(element.id)}
                        disabled={!!busyAction}
                      />
                      <span>
                        <strong>{element.name}</strong>
                        <small>
                          {competenceLabel(element.competence_type)}
                          {element.description?.trim() ? ` - ${element.description}` : ""}
                        </small>
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            {sortedAllElements.length ? (
              <p className="editor-helper">
                {`Выбрано элементов: ${deleteElementIds.length}`}
              </p>
            ) : null}

            <button
              className="secondary-button secondary-button--danger"
              disabled={!deleteElementIds.length || !!busyAction}
            >
              {busyAction === "element-delete"
                ? "Удаляю..."
                : deleteElementIds.length > 1
                  ? `Удалить выбранные (${deleteElementIds.length})`
                  : "Удалить выбранный элемент"}
            </button>
          </form>
        </details>
      </div>
    );
  }

  function renderRelationsTab() {
    return (
      <div className="editor-accordion">
        <details className="editor-block" open>
          <summary>Добавить связь между элементами</summary>
          <form className="editor-form" onSubmit={handleCreateElementRelation}>
            <div className="editor-form__grid editor-form__grid--searchable-pickers">
              <SearchableSelectField
                label="Элемент 1"
                value={relationSourceFilter}
                onValueChange={setRelationSourceFilter}
                onSelect={setRelationSourceElementId}
                options={relationElementOptions}
                placeholder="Начни вводить название элемента"
                emptyText="Совпадений не найдено"
                disabled={!relationElementOptions.length}
              />

              <SearchableSelectField
                label="Элемент 2"
                value={relationTargetFilter}
                onValueChange={setRelationTargetFilter}
                onSelect={setRelationTargetElementId}
                options={relationElementOptions}
                placeholder="Начни вводить название элемента"
                emptyText="Совпадений не найдено"
                disabled={!relationElementOptions.length}
              />
            </div>
            {!sortedAllElements.length ? (
              <p className="editor-empty">Сначала создай элементы.</p>
            ) : null}

            <div className="editor-form__grid">
              <label className="field">
                <span>Тип связи</span>
                <select
                  value={relationDefinitionId}
                  onChange={(event) => setRelationDefinitionId(event.target.value)}
                  disabled={!relationOptions.length}
                >
                  {relationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Направление</span>
                <select
                  value={relationDirection}
                  onChange={(event) =>
                    setRelationDirection(event.target.value as RelationDirection)
                  }
                  disabled={!relationElements.length}
                >
                  {RELATION_DIRECTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {!relationOptions.length ? (
              <p className="editor-empty">
                Для выбранной пары элементов связь сейчас не поддерживается.
              </p>
            ) : null}

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={2}
                value={relationDescription}
                onChange={(event) => setRelationDescription(event.target.value)}
                placeholder="Необязательное описание связи между элементами"
              />
            </label>

            <button
              className="primary-button"
              disabled={
                !relationSourceElementId ||
                !relationTargetElementId ||
                !relationTopicId ||
                !relationDefinitionId ||
                !!busyAction
              }
            >
              {busyAction === "element-relation" ? "Сохраняю..." : "Создать связь элементов"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Редактировать связь между элементами</summary>
          <form className="editor-form" onSubmit={handleUpdateElementRelation}>
            <label className="field field--compact">
              <span>Фильтр связи</span>
              <input
                value={editRelationFilter}
                onChange={(event) => setEditRelationFilter(event.target.value)}
                placeholder="Название элементов или тип связи"
              />
            </label>
            {!sortedElementRelations.length ? (
              <p className="editor-empty">Пока нет связей между элементами для редактирования.</p>
            ) : null}

            {resolvedCreateRelationElements.sourceElement && resolvedCreateRelationElements.targetElement ? (
              <p className="editor-helper">
                Фактическое направление: {resolvedCreateRelationElements.sourceElement.name} -&gt;{" "}
                {resolvedCreateRelationElements.targetElement.name}
              </p>
            ) : null}

            <label className="field">
              <span>Связь</span>
              <select
                value={editRelationId}
                onChange={(event) => setEditRelationId(event.target.value)}
                disabled={!filteredEditRelations.length}
              >
                {filteredEditRelations.map((relation) => (
                  <option key={relation.id} value={relation.id}>
                    {getElementRelationName(relation)}
                  </option>
                ))}
              </select>
            </label>

            <div className="editor-form__grid">
              <label className="field field--compact">
                <span>Фильтр элемента 1</span>
                <input
                  value={editRelationSourceFilter}
                  onChange={(event) => setEditRelationSourceFilter(event.target.value)}
                  placeholder="Название или компетенция"
                />
              </label>

              <label className="field field--compact">
                <span>Фильтр элемента 2</span>
                <input
                  value={editRelationTargetFilter}
                  onChange={(event) => setEditRelationTargetFilter(event.target.value)}
                  placeholder="Название или компетенция"
                />
              </label>
            </div>

            <div className="editor-form__grid">
              <label className="field">
                <span>Элемент 1</span>
                <select
                  value={editRelationSourceElementId}
                  onChange={(event) => setEditRelationSourceElementId(event.target.value)}
                  disabled={!filteredEditRelations.length || !filteredEditRelationSourceElements.length}
                >
                  {filteredEditRelationSourceElements.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.name} ({competenceLabel(element.competence_type)})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Элемент 2</span>
                <select
                  value={editRelationTargetElementId}
                  onChange={(event) => setEditRelationTargetElementId(event.target.value)}
                  disabled={!filteredEditRelations.length || !filteredEditRelationTargetElements.length}
                >
                  {filteredEditRelationTargetElements.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.name} ({competenceLabel(element.competence_type)})
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Направление</span>
                <select
                  value={editRelationDirection}
                  onChange={(event) =>
                    setEditRelationDirection(event.target.value as RelationDirection)
                  }
                  disabled={!sortedElementRelations.length || !relationElements.length}
                >
                  {RELATION_DIRECTION_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="editor-form__grid">
              <label className="field">
                <span>Тип связи</span>
                <select
                  value={editRelationDefinitionId}
                  onChange={(event) => setEditRelationDefinitionId(event.target.value)}
                  disabled={!sortedElementRelations.length || !editRelationOptions.length}
                >
                  {editRelationOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {sortedElementRelations.length && !editRelationOptions.length ? (
              <p className="editor-empty">
                Для выбранной пары элементов связь сейчас не поддерживается.
              </p>
            ) : null}

            <label className="field">
              <span>Описание</span>
              <textarea
                rows={2}
                value={editRelationDescription}
                onChange={(event) => setEditRelationDescription(event.target.value)}
                placeholder="Необязательное описание связи между элементами"
                disabled={!sortedElementRelations.length}
              />
            </label>

            <button
              className="primary-button"
              disabled={
                !editRelationId ||
                !editRelationSourceElementId ||
                !editRelationTargetElementId ||
                !editRelationTopicId ||
                !editRelationDefinitionId ||
                !!busyAction
              }
            >
              {busyAction === "element-relation-update" ? "Сохраняю..." : "Сохранить связь"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Удалить связь между элементами</summary>
          <form className="editor-form" onSubmit={handleDeleteElementRelation}>
            <label className="field field--compact">
              <span>Фильтр связи</span>
              <input
                value={deleteRelationFilter}
                onChange={(event) => setDeleteRelationFilter(event.target.value)}
                placeholder="Название элементов или тип связи"
              />
            </label>
            {!sortedElementRelations.length ? (
              <p className="editor-empty">Пока нет связей между элементами для удаления.</p>
            ) : null}

            <label className="field">
              <span>Связь</span>
              <select
                value={deleteRelationId}
                onChange={(event) => setDeleteRelationId(event.target.value)}
                disabled={!filteredDeleteRelations.length}
              >
                {filteredDeleteRelations.map((relation) => (
                  <option key={relation.id} value={relation.id}>
                    {getElementRelationName(relation)}
                  </option>
                ))}
              </select>
            </label>

            <button
              className="secondary-button secondary-button--danger"
              disabled={!deleteRelationId || !!busyAction}
            >
              Удалить связь
            </button>
          </form>
        </details>
      </div>
    );
  }

  return (
    <>
      <section className="card card--editor">
        <div className="card__header">
          <span className="card__eyebrow">Редактор</span>
        </div>
        <h3>Редактор графа</h3>

        <div className="editor-tabs">
          <button
            className={`editor-tab ${activeTab === "topics" ? "editor-tab--active" : ""}`}
            onClick={() => setActiveTab("topics")}
            type="button"
          >
            Темы
          </button>
          <button
            className={`editor-tab ${activeTab === "elements" ? "editor-tab--active" : ""}`}
            onClick={() => setActiveTab("elements")}
            type="button"
          >
            Элементы
          </button>
          <button
            className={`editor-tab ${activeTab === "relations" ? "editor-tab--active" : ""}`}
            onClick={() => setActiveTab("relations")}
            type="button"
          >
            Связи
          </button>
        </div>

        {activeTab === "topics" ? renderTopicTab() : null}
        {activeTab === "elements" ? renderElementsTab() : null}
        {activeTab === "relations" ? renderRelationsTab() : null}
      </section>

      {confirmDelete ? (
        <div className="editor-confirm-backdrop" onClick={closeDeleteConfirmation} role="presentation">
          <div
            className="editor-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение удаления"
          >
            <div className="editor-confirm-dialog__header">
              <p className="card__eyebrow">Подтверждение</p>
              <h4>
                {confirmDelete.entityType === "topic"
                  ? "Удалить тему?"
                  : confirmDelete.entityType === "topic-with-elements"
                    ? "Удалить тему и элементы?"
                    : confirmDelete.entityType === "element-relation"
                      ? "Удалить связь?"
                      : "Удалить элемент?"}
              </h4>
            </div>

            <p className="editor-confirm-dialog__text">
              {confirmDelete.entityType === "topic" ||
              confirmDelete.entityType === "topic-with-elements"
                ? (confirmDelete.text ??
                  `Тема "${confirmDelete.entityName}" будет удалена вместе со связанными зависимостями и привязками.`)
                : confirmDelete.entityType === "element-relation"
                  ? `Связь "${confirmDelete.entityName}" будет удалена из графа элементов.`
                  : (confirmDelete.text ??
                    `Элемент "${confirmDelete.entityName}" будет удален вместе со связями и привязками к темам.`)}
            </p>

            {(confirmDelete.entityType === "element" ||
              confirmDelete.entityType === "topic" ||
              confirmDelete.entityType === "topic-with-elements") &&
            confirmDelete.relationNames?.length ? (
              <div className="editor-subsection">
                <div className="editor-subsection__header">
                  <div>
                    <strong>
                      {confirmDelete.entityType === "topic"
                        ? "Будут удалены привязки и зависимости"
                        : confirmDelete.entityType === "topic-with-elements"
                          ? "Будут удалены элементы, привязки и зависимости"
                          : "Будут удалены связи"}
                    </strong>
                  </div>
                </div>

                <ul className="editor-list editor-confirm-dialog__list">
                  {confirmDelete.relationNames.map((relationName, index) => (
                    <li key={`${relationName}-${index}`}>{relationName}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            <div className="editor-confirm-dialog__actions">
              <button
                className="ghost-button"
                onClick={closeDeleteConfirmation}
                type="button"
                disabled={
                  busyAction === "topic-delete" ||
                  busyAction === "element-delete" ||
                  busyAction === "element-relation-delete"
                }
              >
                Отмена
              </button>
              <button
                className="secondary-button secondary-button--danger"
                onClick={() => void handleConfirmDelete()}
                type="button"
                disabled={
                  busyAction === "topic-delete" ||
                  busyAction === "element-delete" ||
                  busyAction === "element-relation-delete"
                }
              >
                {busyAction === "topic-delete" ||
                busyAction === "element-delete" ||
                busyAction === "element-relation-delete"
                  ? "Удаляю..."
                  : "Удалить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {confirmCompetenceChange ? (
        <div
          className="editor-confirm-backdrop"
          onClick={closeCompetenceChangeConfirmation}
          role="presentation"
        >
          <div
            className="editor-confirm-dialog"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Подтверждение смены компетенции"
          >
            <div className="editor-confirm-dialog__header">
              <p className="card__eyebrow">Подтверждение</p>
              <h4>Изменить компетенцию элемента?</h4>
            </div>

            <p className="editor-confirm-dialog__text">
              При смене компетенции на «{competenceLabel(confirmCompetenceChange.nextCompetence)}»
              будут удалены все текущие связи этого элемента. Проверь список ниже и подтверди изменение.
            </p>

            <div className="editor-subsection">
              <div className="editor-subsection__header">
                <div>
                  <strong>Будут удалены связи</strong>
                </div>
              </div>

              <ul className="editor-list editor-confirm-dialog__list">
                {confirmCompetenceChange.relationNames.map((relationName, index) => (
                  <li key={`${relationName}-${index}`}>{relationName}</li>
                ))}
              </ul>
            </div>

            <div className="editor-confirm-dialog__actions">
              <button
                className="ghost-button"
                onClick={closeCompetenceChangeConfirmation}
                type="button"
                disabled={busyAction === "element-update"}
              >
                Отмена
              </button>
              <button
                className="secondary-button secondary-button--danger"
                onClick={() => void handleConfirmCompetenceChange()}
                type="button"
                disabled={busyAction === "element-update"}
              >
                {busyAction === "element-update" ? "Сохраняю..." : "Подтвердить"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
