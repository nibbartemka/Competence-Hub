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
  fetchKnowledgeElements,
  fetchOperationContracts,
  fetchRelations,
  isAbortError,
  updateKnowledgeElement,
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
  TopicKnowledgeElement,
  TopicKnowledgeElementRole,
} from "../types";

type GraphEditorProps = {
  disciplineId: string;
  disciplineElements: KnowledgeElement[];
  initialTab?: EditorTab;
  knowledgeElementRelations: KnowledgeElementRelation[];
  onDataChanged: () => Promise<void>;
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
      entityType: "topic" | "element" | "element-relation";
    }
  | null;

type TopicNewElementDraft = {
  clientId: string;
  competenceType: CompetenceType;
  description: string;
  name: string;
  operationRef: string;
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
  { label: "РўСЂРµР±СѓРµС‚", value: "requires" },
  { label: "РЎС‚СЂРѕРёС‚СЃСЏ РЅР°", value: "builds_on" },
  { label: "РЎРѕРґРµСЂР¶РёС‚", value: "contains" },
  { label: "РЇРІР»СЏРµС‚СЃСЏ С‡Р°СЃС‚СЊСЋ", value: "part_of" },
  { label: "РЈС‚РѕС‡РЅСЏРµС‚", value: "refines" },
  { label: "РћР±РѕР±С‰Р°РµС‚", value: "generalizes" },
  { label: "Р РѕРґСЃС‚РІРµРЅРЅРѕ", value: "similar" },
  { label: "РџСЂРѕС‚РёРІРѕРїРѕСЃС‚Р°РІР»СЏРµС‚СЃСЏ", value: "contrasts_with" },
  { label: "РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІРјРµСЃС‚Рµ", value: "used_with" },
];

const MASTER_TO_MASTER_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [
  { label: "РўСЂРµР±СѓРµС‚", value: "requires" },
  { label: "РЎРѕРґРµСЂР¶РёС‚", value: "contains" },
  { label: "РЇРІР»СЏРµС‚СЃСЏ С‡Р°СЃС‚СЊСЋ", value: "part_of" },
  { label: "РЈС‚РѕС‡РЅСЏРµС‚", value: "refines" },
  { label: "РћР±РѕР±С‰Р°РµС‚", value: "generalizes" },
  { label: "Р РѕРґСЃС‚РІРµРЅРЅРѕ", value: "similar" },
  { label: "РџСЂРѕС‚РёРІРѕРїРѕСЃС‚Р°РІР»СЏРµС‚СЃСЏ", value: "contrasts_with" },
  { label: "РСЃРїРѕР»СЊР·СѓРµС‚СЃСЏ РІРјРµСЃС‚Рµ", value: "used_with" },
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
    clientId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    competenceType: "know",
    description: "",
    name: "",
    operationRef: "",
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

export function GraphEditor({
  disciplineId,
  disciplineElements,
  initialTab = "topics",
  knowledgeElementRelations,
  onDataChanged,
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
  const [elementAutomatedSkillId, setElementAutomatedSkillId] = useState("");
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
  const [editElementSubjectAreaDescription, setEditElementSubjectAreaDescription] =
    useState("");
  const [editElementOperationRef, setEditElementOperationRef] = useState("");
  const [deleteElementId, setDeleteElementId] = useState("");

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
    const links = (topicKnowledgeElementsByTopicId.get(elementCreateTopicId) ?? []).filter(
      (link) => link.role === "formed",
    );
    return links
      .map((link) => elementById.get(link.element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element && (element.competence_type === "know" || element.competence_type === "can"),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [elementById, elementCreateTopicId, topicKnowledgeElementsByTopicId]);

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
    if (!elementCreateTopicId || !elementAutomatedSkillId || !implementsRelation) {
      return [];
    }

    const topicKnowledgeIds = new Set(
      (topicKnowledgeElementsByTopicId.get(elementCreateTopicId) ?? [])
        .map((link) => link.element_id),
    );

    return knowledgeElementRelations
      .filter(
        (relation) =>
          relation.topic_id === elementCreateTopicId &&
          relation.source_element_id === elementAutomatedSkillId &&
          relation.relation_id === implementsRelation.id,
      )
      .map((relation) => elementById.get(relation.target_element_id) ?? null)
      .filter(
        (element): element is KnowledgeElement =>
          !!element &&
          element.competence_type === "know" &&
          topicKnowledgeIds.has(element.id),
      )
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [
    elementAutomatedSkillId,
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
      setDeleteElementId("");
      return;
    }

    if (!sortedAllElements.some((element) => element.id === topicElementElementId)) {
      setTopicElementElementId(sortedAllElements[0].id);
    }

    setSelectedRequiredElementIds((current) =>
      current.filter((elementId) => sortedAllElements.some((element) => element.id === elementId)),
    );

    if (!sortedAllElements.some((element) => element.id === editElementId)) {
      setEditElementId(sortedAllElements[0].id);
    }

    if (!sortedAllElements.some((element) => element.id === deleteElementId)) {
      setDeleteElementId(sortedAllElements[0].id);
    }
  }, [deleteElementId, editElementId, sortedAllElements, topicElementElementId]);

  useEffect(() => {
    const selectedElement = sortedAllElements.find((element) => element.id === editElementId);
    setEditElementName(selectedElement?.name ?? "");
    setEditElementDescription(selectedElement?.description ?? "");
    setEditElementCompetence(selectedElement?.competence_type ?? "know");
    setEditElementSubjectAreaDescription(
      selectedElement?.subject_area_description ?? "",
    );
    setEditElementOperationRef(
      selectedElement?.competence_type === "can" ? selectedElement.operation_ref ?? "" : "",
    );
  }, [editElementId, sortedAllElements]);

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
      if (elementAutomatedSkillId) {
        setElementAutomatedSkillId("");
      }
      if (elementMasterDomainObjects.length) {
        setElementMasterDomainObjects([]);
      }
      return;
    }

    if (
      elementAutomatedSkillId &&
      !availableSkillElementsForMaster.some((element) => element.id === elementAutomatedSkillId)
    ) {
      setElementAutomatedSkillId("");
    }
  }, [
    availableSkillElementsForMaster,
    elementAutomatedSkillId,
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
      const next = current.map((item) => ({
        ...item,
        knowledgeElementId: allowedIds.has(item.knowledgeElementId)
          ? item.knowledgeElementId
          : (requiredKnowledgeForMaster[0]?.id ?? availableKnowledgeForMaster[0]?.id ?? ""),
      }));

      if (!next.length && requiredKnowledgeForMaster.length) {
        return [createMasterDomainObjectDraft(requiredKnowledgeForMaster[0].id)];
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
    entityType: "topic" | "element" | "element-relation",
    entityId: string,
  ) {
    if (entityType === "topic") {
      const selectedTopic = sortedTopics.find((topic) => topic.id === entityId);
      if (!selectedTopic) {
        return;
      }

      setConfirmDelete({
        entityId,
        entityName: selectedTopic.name,
        entityType,
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

    setConfirmDelete({
      entityId,
      entityName: selectedElement.name,
      entityType,
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

  async function handleConfirmDelete() {
    if (!confirmDelete) {
      return;
    }

    try {
      setBusyAction(
        confirmDelete.entityType === "topic"
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

  async function ensureMasterRelationsAfterCreate(
    masterElementId: string,
    topicId: string,
    skillElementId: string,
    knowledgeElementIds: string[],
  ) {
    const uniqueKnowledgeElementIds = [...new Set(knowledgeElementIds.filter(Boolean))];

    async function ensureRelation(
      relationId: string | null | undefined,
      targetElementId: string,
    ) {
      if (!relationId) {
        return;
      }

      try {
        await createKnowledgeElementRelation({
          topic_id: topicId,
          source_element_id: masterElementId,
          target_element_id: targetElementId,
          relation_id: relationId,
          description: "",
        });
      } catch (error) {
        const message = extractErrorMessage(error);
        if (message === "Operation violates database constraints.") {
          return;
        }
        throw error;
      }
    }

    await ensureRelation(automatesRelation?.id, skillElementId);
    for (const knowledgeElementId of uniqueKnowledgeElementIds) {
      await ensureRelation(reliesOnRelation?.id, knowledgeElementId);
    }
  }
  async function handleCreateTopic(event: FormEvent<HTMLFormElement>) {
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
      if (!elementAutomatedSkillId) {
        setFeedback({
          kind: "error",
          text: "Для элемента уровня «Владеть» выбери связанный элемент уровня «Уметь».",
        });
        return;
      }
      if (!requiredKnowledgeForMaster.length) {
        setFeedback({
          kind: "error",
          text: "У выбранного элемента уровня «Уметь» в этой теме нет связанных элементов уровня «Знать» по связи «реализует».",
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
          automated_skill_element_id: elementAutomatedSkillId,
          domain_objects: elementMasterDomainObjects.map((item) => ({
            object_name: item.objectName.trim(),
            knowledge_element_id: item.knowledgeElementId,
          })),
        });
        await ensureMasterRelationsAfterCreate(
          createdElement.id,
          elementCreateTopicId,
          elementAutomatedSkillId,
          elementMasterDomainObjects.map((item) => item.knowledgeElementId),
        );

        setElementName("");
        setElementDescription("");
        setElementCompetence("know");
        setElementSubjectAreaDescription("");
        setElementAutomatedSkillId("");
        setElementMasterDomainObjects([]);
        await syncAfterChange(true);
        setTopicElementElementId(createdElement.id);
        setEditElementId(createdElement.id);
        setDeleteElementId(createdElement.id);
        setRelationSourceElementId(createdElement.id);
        setFeedback({
          kind: "success",
          text: "Элемент «Владеть» создан, привязан к теме и связан с выбранным элементом «Уметь».",
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
      setElementAutomatedSkillId("");
      setElementMasterDomainObjects([]);
      await syncAfterChange(true);
      setTopicElementElementId(createdElement.id);
      setEditElementId(createdElement.id);
      setDeleteElementId(createdElement.id);
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

  async function handleUpdateElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editElementId) {
      return;
    }

    try {
      setBusyAction("element-update");
      setFeedback(null);
      await updateKnowledgeElement(editElementId, {
        name: editElementName.trim(),
        description: editElementDescription.trim(),
        competence_type: editElementCompetence,
        subject_area_description:
          editElementCompetence === "master"
            ? editElementSubjectAreaDescription.trim()
            : null,
        operation_ref: editElementCompetence === "can" ? editElementOperationRef || null : null,
      });
      await syncAfterChange(true);
      setFeedback({ kind: "success", text: "Элемент обновлен." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleDeleteElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!deleteElementId) {
      return;
    }

    openDeleteConfirmation("element", deleteElementId);
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

    try {
      setBusyAction("element-relation-update");
      setFeedback(null);
      const resolvedEndpoints = resolveRelationEndpoints(
        editRelationSourceElementId,
        editRelationTargetElementId,
        editRelationDirection,
      );
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

  function legacyRenderTopicTab() {
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

              {sortedAllElements.length ? (
                <div className="editor-checklist">
                  {sortedAllElements.map((element) => (
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

            <button
              className="secondary-button secondary-button--danger"
              disabled={!deleteTopicId || !!busyAction}
            >
              {busyAction === "topic-delete" ? "Удаляю..." : "Удалить тему"}
            </button>
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
                <small>Новый элемент будет добавлен в тему как формируемый.</small>
              </label>
            )}

            {sortedTopics.length > 0 && !elementCreateTopicId ? (
              <p className="editor-empty">
                Привязка к теме необязательна. Если тему не выбирать, элемент будет создан как непривязанный.
              </p>
            ) : null}

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
                <span>Роль</span>
                <select
                  value={topicElementRole}
                  onChange={(event) =>
                    setTopicElementRole(event.target.value as TopicKnowledgeElementRole)
                  }
                >
                  {TOPIC_LINK_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Элемент</span>
              <select
                value={topicElementElementId}
                onChange={(event) => setTopicElementElementId(event.target.value)}
                disabled={!sortedAllElements.length}
              >
                {sortedAllElements.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.name} ({competenceLabel(element.competence_type)})
                  </option>
                ))}
              </select>
            </label>

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
              disabled={!topicElementTopicId || !topicElementElementId || !!busyAction}
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
          <summary>Удалить элемент</summary>
          <form className="editor-form" onSubmit={handleDeleteElement}>
            <label className="field">
              <span>Элемент</span>
              <select
                value={deleteElementId}
                onChange={(event) => setDeleteElementId(event.target.value)}
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
              <p className="editor-empty">Сейчас нет элементов для удаления.</p>
            ) : null}

            <button
              className="secondary-button secondary-button--danger"
              disabled={!deleteElementId || !!busyAction}
            >
              {busyAction === "element-delete" ? "Удаляю..." : "Удалить элемент"}
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

              {sortedAllElements.length ? (
                <div className="editor-checklist">
                  {sortedAllElements.map((element) => (
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
                                operationRef:
                                  event.target.value === "can" ? draft.operationRef : "",
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

            <button
              className="secondary-button secondary-button--danger"
              disabled={!deleteTopicId || !!busyAction}
            >
              {busyAction === "topic-delete" ? "Удаляю..." : "Удалить тему"}
            </button>
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

            {!sortedTopics.length ? (
              <p className="editor-empty">
                Если тем еще нет, сначала создай тему во вкладке тем и возвращайся к элементам.
              </p>
            ) : (
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
                <small>
                  {elementCompetence === "can"
                    ? "Для элемента уровня Уметь тема обязательна: внутри темы нужно выбрать опорные знания."
                    : "Новый элемент будет добавлен в тему как формируемый."}
                </small>
              </label>
            )}

            {elementCompetence === "can" ? (
              !elementCreateTopicId ? (
                <p className="editor-empty">
                  Для элемента уровня Уметь сначала выбери тему.
                </p>
              ) : availableKnowledgeForNewSkillElement.length ? (
                <div className="editor-subsection">
                  <div className="editor-subsection__header">
                    <div>
                      <strong>Связанные элементы темы</strong>
                      <p>Отметь один или несколько элементов этой темы уровня Знать или Уметь, на которых основано новое умение.</p>
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
                <p className="editor-empty">
                  В выбранной теме пока нет элементов уровней Знать или Уметь, поэтому здесь не с чем связать новое умение.
                </p>
              )
            ) : sortedTopics.length > 0 && !elementCreateTopicId ? (
              <p className="editor-empty">
                Выбери тему по желанию. Если тему не указывать, элемент будет создан без привязки.
              </p>
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
                <p className="editor-empty">
                  Для элемента уровня «Владеть» сначала выбери тему.
                </p>
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

                  <label className="field">
                    <span>Элемент уровня «Уметь» для связи «Автоматизирует»</span>
                    <select
                      value={elementAutomatedSkillId}
                      onChange={(event) => setElementAutomatedSkillId(event.target.value)}
                      disabled={!availableSkillElementsForMaster.length}
                    >
                      <option value="">Выбери элемент «Уметь»</option>
                      {availableSkillElementsForMaster.map((element) => (
                        <option key={element.id} value={element.id}>
                          {element.name}
                        </option>
                      ))}
                    </select>
                    <small>
                      После создания элемента «Владеть» автоматически появится связь
                      «Автоматизирует» с выбранным элементом «Уметь». Выбрать можно только
                      элементы этой темы, которые уже связаны с алгоритмом.
                    </small>
                  </label>

                  {!availableSkillElementsForMaster.length ? (
                    <p className="editor-empty">
                      В выбранной теме пока нет элементов уровня «Уметь», связанных с
                      алгоритмом.
                    </p>
                  ) : null}

                  {elementAutomatedSkillId ? (
                    requiredKnowledgeForMaster.length ? (
                      <div className="editor-subsection">
                        <div className="editor-subsection__header">
                          <div>
                            <strong>Объекты предметной области и связи «Опирается на»</strong>
                            <p>
                              Стартовый набор знаний берется из связей выбранного элемента
                              «Уметь» с элементами «Знать», но дополнительно здесь можно
                              выбрать и любые другие элементы «Знать» этой же темы. Для
                              каждого сопоставления будет автоматически создана связь
                              «Опирается на». Обязательные знания нужно покрыть полностью.
                            </p>
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
                        У выбранного элемента «Уметь» нет связанных знаний уровня
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
                    !elementAutomatedSkillId ||
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
                <span>Роль</span>
                <select
                  value={topicElementRole}
                  onChange={(event) =>
                    setTopicElementRole(event.target.value as TopicKnowledgeElementRole)
                  }
                >
                  {TOPIC_LINK_ROLE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="field">
              <span>Элемент</span>
              <select
                value={topicElementElementId}
                onChange={(event) => setTopicElementElementId(event.target.value)}
                disabled={!sortedAllElements.length}
              >
                {sortedAllElements.map((element) => (
                  <option key={element.id} value={element.id}>
                    {element.name} ({competenceLabel(element.competence_type)})
                  </option>
                ))}
              </select>
            </label>

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
              disabled={!topicElementTopicId || !topicElementElementId || !!busyAction}
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

            <button
              className="primary-button"
              disabled={
                !editElementId ||
                !editElementName.trim() ||
                (editElementCompetence === "can" && !editElementOperationRef) ||
                !!busyAction
              }
            >
              {busyAction === "element-update" ? "Сохраняю..." : "Сохранить элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Удалить элемент</summary>
          <form className="editor-form" onSubmit={handleDeleteElement}>
            <label className="field">
              <span>Элемент</span>
              <select
                value={deleteElementId}
                onChange={(event) => setDeleteElementId(event.target.value)}
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
              <p className="editor-empty">Сейчас нет элементов для удаления.</p>
            ) : null}

            <button
              className="secondary-button secondary-button--danger"
              disabled={!deleteElementId || !!busyAction}
            >
              {busyAction === "element-delete" ? "Удаляю..." : "Удалить элемент"}
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
        <p className="card__text">
          Модальное окно разбито на разделы «Темы», «Элементы» и «Связи». Логика
          создания темы с требуемыми элементами и добавлением новых элементов сохранена.
        </p>

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
                  : confirmDelete.entityType === "element-relation"
                    ? "Удалить связь?"
                    : "Удалить элемент?"}
              </h4>
            </div>

            <p className="editor-confirm-dialog__text">
              {confirmDelete.entityType === "topic"
                ? `Тема "${confirmDelete.entityName}" будет удалена вместе со связанными зависимостями и привязками.`
                : confirmDelete.entityType === "element-relation"
                  ? `Связь "${confirmDelete.entityName}" будет удалена из графа элементов.`
                  : `Элемент "${confirmDelete.entityName}" будет удален вместе со связями и привязками к темам.`}
            </p>

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
    </>
  );
}
