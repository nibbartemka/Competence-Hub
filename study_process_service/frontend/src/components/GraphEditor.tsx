import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createKnowledgeElement,
  createKnowledgeElementRelation,
  createTopic,
  createTopicDependency,
  createTopicKnowledgeElement,
  deleteKnowledgeElement,
  deleteTopic,
  fetchKnowledgeElements,
  isAbortError,
  updateKnowledgeElement,
  updateTopic,
} from "../api";
import type {
  CompetenceType,
  KnowledgeElement,
  KnowledgeElementRelationType,
  Topic,
  TopicDependencyRelationType,
  TopicKnowledgeElementRole,
} from "../types";

type GraphEditorProps = {
  disciplineId: string;
  disciplineElements: KnowledgeElement[];
  onDataChanged: () => Promise<void>;
  topics: Topic[];
};

type EditorTab = "topics" | "elements" | "relations";

type Feedback = {
  kind: "error" | "success";
  text: string;
};

type TopicNewElementDraft = {
  clientId: string;
  competenceType: CompetenceType;
  description: string;
  name: string;
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

const TOPIC_DEPENDENCY_OPTIONS: Array<{ label: string; value: TopicDependencyRelationType }> = [
  { label: "Требуется", value: "requires" },
  { label: "Возможен путь", value: "possible_flow" },
];

const KNOW_TO_KNOW_RELATION_OPTIONS: Array<{ label: string; value: KnowledgeElementRelationType }> = [
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

const KNOW_TO_CAN_RELATION_OPTIONS: Array<{ label: string; value: KnowledgeElementRelationType }> = [
  { label: "Реализует", value: "implements" },
];

const CAN_TO_MASTER_RELATION_OPTIONS: Array<{ label: string; value: KnowledgeElementRelationType }> = [
  { label: "Переходит во владение", value: "automates" },
];

function competenceLabel(value: CompetenceType) {
  return COMPETENCE_OPTIONS.find((option) => option.value === value)?.label ?? value;
}

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Не удалось выполнить запрос.";
}

function nextDifferentValue(currentValue: string, items: Array<{ id: string }>) {
  return items.find((item) => item.id !== currentValue)?.id ?? currentValue;
}

function createDraft(): TopicNewElementDraft {
  return {
    clientId: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
    competenceType: "know",
    description: "",
    name: "",
  };
}

function getRelationOptions(
  sourceType?: CompetenceType,
  targetType?: CompetenceType,
): Array<{ label: string; value: KnowledgeElementRelationType }> {
  if (sourceType === "know" && targetType === "know") {
    return KNOW_TO_KNOW_RELATION_OPTIONS;
  }

  if (sourceType === "know" && targetType === "can") {
    return KNOW_TO_CAN_RELATION_OPTIONS;
  }

  if (sourceType === "can" && targetType === "master") {
    return CAN_TO_MASTER_RELATION_OPTIONS;
  }

  return [];
}

export function GraphEditor({
  disciplineId,
  disciplineElements,
  onDataChanged,
  topics,
}: GraphEditorProps) {
  const [activeTab, setActiveTab] = useState<EditorTab>("topics");
  const [allElements, setAllElements] = useState<KnowledgeElement[]>([]);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

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

  const [topicElementTopicId, setTopicElementTopicId] = useState("");
  const [topicElementElementId, setTopicElementElementId] = useState("");
  const [topicElementRole, setTopicElementRole] = useState<TopicKnowledgeElementRole>("required");
  const [topicElementNote, setTopicElementNote] = useState("");

  const [editElementId, setEditElementId] = useState("");
  const [editElementName, setEditElementName] = useState("");
  const [editElementDescription, setEditElementDescription] = useState("");
  const [editElementCompetence, setEditElementCompetence] = useState<CompetenceType>("know");
  const [deleteElementId, setDeleteElementId] = useState("");

  const [dependencySourceTopicId, setDependencySourceTopicId] = useState("");
  const [dependencyTargetTopicId, setDependencyTargetTopicId] = useState("");
  const [dependencyType, setDependencyType] = useState<TopicDependencyRelationType>("requires");
  const [dependencyDescription, setDependencyDescription] = useState("");

  const [relationSourceElementId, setRelationSourceElementId] = useState("");
  const [relationTargetElementId, setRelationTargetElementId] = useState("");
  const [relationType, setRelationType] = useState<KnowledgeElementRelationType | "">("");
  const [relationDescription, setRelationDescription] = useState("");

  const sortedTopics = useMemo(
    () => topics.slice().sort((left, right) => left.name.localeCompare(right.name, "ru")),
    [topics],
  );

  const sortedAllElements = useMemo(() => {
    const uniqueElements = new Map<string, KnowledgeElement>();
    for (const element of disciplineElements) uniqueElements.set(element.id, element);
    for (const element of allElements) uniqueElements.set(element.id, element);
    return [...uniqueElements.values()].sort((left, right) =>
      left.name.localeCompare(right.name, "ru"),
    );
  }, [allElements, disciplineElements]);

  const relationSourceElement = useMemo(
    () => sortedAllElements.find((element) => element.id === relationSourceElementId),
    [relationSourceElementId, sortedAllElements],
  );
  const relationTargetElement = useMemo(
    () => sortedAllElements.find((element) => element.id === relationTargetElementId),
    [relationTargetElementId, sortedAllElements],
  );
  const relationOptions = useMemo(
    () =>
      getRelationOptions(
        relationSourceElement?.competence_type,
        relationTargetElement?.competence_type,
      ),
    [relationSourceElement?.competence_type, relationTargetElement?.competence_type],
  );

  useEffect(() => {
    const controller = new AbortController();

    async function loadAllElements() {
      try {
        const items = await fetchKnowledgeElements(controller.signal);
        if (!controller.signal.aborted) {
          setAllElements(items);
        }
      } catch (error) {
        if (!isAbortError(error)) {
          setFeedback({ kind: "error", text: extractErrorMessage(error) });
        }
      }
    }

    void loadAllElements();
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!sortedTopics.length) {
      setEditTopicId("");
      setDeleteTopicId("");
      setTopicElementTopicId("");
      setDependencySourceTopicId("");
      setDependencyTargetTopicId("");
      return;
    }

    if (!sortedTopics.some((topic) => topic.id === editTopicId)) {
      setEditTopicId(sortedTopics[0].id);
    }
    if (!sortedTopics.some((topic) => topic.id === deleteTopicId)) {
      setDeleteTopicId(sortedTopics[0].id);
    }
    if (!sortedTopics.some((topic) => topic.id === topicElementTopicId)) {
      setTopicElementTopicId(sortedTopics[0].id);
    }
    if (!sortedTopics.some((topic) => topic.id === dependencySourceTopicId)) {
      setDependencySourceTopicId(sortedTopics[0].id);
    }
    if (!sortedTopics.some((topic) => topic.id === dependencyTargetTopicId)) {
      setDependencyTargetTopicId(sortedTopics[0].id);
    }
  }, [
    deleteTopicId,
    dependencySourceTopicId,
    dependencyTargetTopicId,
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
      setSelectedRequiredElementIds([]);
      setTopicElementElementId("");
      setEditElementId("");
      setDeleteElementId("");
      setRelationSourceElementId("");
      setRelationTargetElementId("");
      setRelationType("");
      return;
    }

    setSelectedRequiredElementIds((current) =>
      current.filter((elementId) =>
        sortedAllElements.some((element) => element.id === elementId),
      ),
    );

    if (!sortedAllElements.some((element) => element.id === topicElementElementId)) {
      setTopicElementElementId(sortedAllElements[0].id);
    }
    if (!sortedAllElements.some((element) => element.id === editElementId)) {
      setEditElementId(sortedAllElements[0].id);
    }
    if (!sortedAllElements.some((element) => element.id === deleteElementId)) {
      setDeleteElementId(sortedAllElements[0].id);
    }
    if (!sortedAllElements.some((element) => element.id === relationSourceElementId)) {
      setRelationSourceElementId(sortedAllElements[0].id);
    }
    if (!sortedAllElements.some((element) => element.id === relationTargetElementId)) {
      setRelationTargetElementId(
        nextDifferentValue(relationSourceElementId, sortedAllElements),
      );
    }
  }, [
    deleteElementId,
    editElementId,
    relationSourceElementId,
    relationTargetElementId,
    sortedAllElements,
    topicElementElementId,
  ]);

  useEffect(() => {
    const selectedElement = sortedAllElements.find((element) => element.id === editElementId);
    setEditElementName(selectedElement?.name ?? "");
    setEditElementDescription(selectedElement?.description ?? "");
    setEditElementCompetence(selectedElement?.competence_type ?? "know");
  }, [editElementId, sortedAllElements]);

  useEffect(() => {
    if (!relationOptions.length) {
      setRelationType("");
      return;
    }
    if (!relationOptions.some((option) => option.value === relationType)) {
      setRelationType(relationOptions[0].value);
    }
  }, [relationOptions, relationType]);

  async function reloadElements() {
    const items = await fetchKnowledgeElements();
    setAllElements(items);
  }

  async function syncAfterChange(reloadElementList = false) {
    if (reloadElementList) {
      await reloadElements();
    }
    await onDataChanged();
  }

  function toggleRequiredElement(elementId: string) {
    setSelectedRequiredElementIds((current) =>
      current.includes(elementId)
        ? current.filter((item) => item !== elementId)
        : [...current, elementId],
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

  async function handleCreateTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disciplineId) return;

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
        if (!draft.name.trim()) continue;
        const createdElement = await createKnowledgeElement({
          name: draft.name.trim(),
          description: draft.description.trim(),
          competence_type: draft.competenceType,
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
    if (!editTopicId) return;

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
    if (!deleteTopicId) return;

    const selectedTopic = sortedTopics.find((topic) => topic.id === deleteTopicId);
    if (!selectedTopic || !window.confirm(`Удалить тему "${selectedTopic.name}"?`)) return;

    try {
      setBusyAction("topic-delete");
      setFeedback(null);
      await deleteTopic(deleteTopicId);
      await syncAfterChange();
      setFeedback({ kind: "success", text: "Тема удалена." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setBusyAction("element-create");
      setFeedback(null);
      const createdElement = await createKnowledgeElement({
        name: elementName.trim(),
        description: elementDescription.trim(),
        competence_type: elementCompetence,
      });
      setElementName("");
      setElementDescription("");
      setElementCompetence("know");
      await syncAfterChange(true);
      setTopicElementElementId(createdElement.id);
      setEditElementId(createdElement.id);
      setDeleteElementId(createdElement.id);
      setRelationSourceElementId(createdElement.id);
      setFeedback({ kind: "success", text: "Элемент создан." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleAttachElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setBusyAction("element-attach");
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
    if (!editElementId) return;

    try {
      setBusyAction("element-update");
      setFeedback(null);
      await updateKnowledgeElement(editElementId, {
        name: editElementName.trim(),
        description: editElementDescription.trim(),
        competence_type: editElementCompetence,
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
    if (!deleteElementId) return;

    const selectedElement = sortedAllElements.find((element) => element.id === deleteElementId);
    if (!selectedElement || !window.confirm(`Удалить элемент "${selectedElement.name}"?`)) {
      return;
    }

    try {
      setBusyAction("element-delete");
      setFeedback(null);
      await deleteKnowledgeElement(deleteElementId);
      await syncAfterChange(true);
      setFeedback({ kind: "success", text: "Элемент удален." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateDependency(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (dependencySourceTopicId === dependencyTargetTopicId) {
      setFeedback({ kind: "error", text: "Выбери две разные темы." });
      return;
    }

    try {
      setBusyAction("topic-dependency");
      setFeedback(null);
      await createTopicDependency({
        prerequisite_topic_id: dependencySourceTopicId,
        dependent_topic_id: dependencyTargetTopicId,
        relation_type: dependencyType,
        description: dependencyDescription.trim(),
      });
      setDependencyDescription("");
      await syncAfterChange();
      setFeedback({ kind: "success", text: "Связь между темами создана." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateElementRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (relationSourceElementId === relationTargetElementId) {
      setFeedback({ kind: "error", text: "Выбери два разных элемента." });
      return;
    }

    if (!relationType) {
      setFeedback({
        kind: "error",
        text: "Для выбранной пары элементов сейчас нет допустимых типов связи.",
      });
      return;
    }

    try {
      setBusyAction("element-relation");
      setFeedback(null);
      await createKnowledgeElementRelation({
        source_element_id: relationSourceElementId,
        target_element_id: relationTargetElementId,
        relation_type: relationType,
        description: relationDescription.trim(),
      });
      setRelationDescription("");
      await syncAfterChange();
      setFeedback({ kind: "success", text: "Связь между элементами создана." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  return (
    <section className="card card--editor">
      <div className="card__header">
        <span className="card__eyebrow">Редактор</span>
      </div>
      <h3>Редактирование графа знаний</h3>
      <p className="card__text">
        Внутри редактора действия разбиты по сущностям: темы, элементы и связи.
      </p>

      <div className="editor-tabs" role="tablist" aria-label="Разделы редактора">
        <button
          className={`editor-tab ${activeTab === "topics" ? "editor-tab--active" : ""}`}
          onClick={() => setActiveTab("topics")}
          role="tab"
          type="button"
        >
          Темы
        </button>
        <button
          className={`editor-tab ${activeTab === "elements" ? "editor-tab--active" : ""}`}
          onClick={() => setActiveTab("elements")}
          role="tab"
          type="button"
        >
          Элементы
        </button>
        <button
          className={`editor-tab ${activeTab === "relations" ? "editor-tab--active" : ""}`}
          onClick={() => setActiveTab("relations")}
          role="tab"
          type="button"
        >
          Связи
        </button>
      </div>

      {feedback ? (
        <div className={`editor-status editor-status--${feedback.kind}`}>{feedback.text}</div>
      ) : null}

      <div className="editor-panels">
        {activeTab === "topics" ? (
          <div className="editor-panels__topics">
            <section className="editor-panel">
              <div className="editor-panel__header">
                <div>
                  <h4>Создание темы</h4>
                  <p>
                    Сохраняет текущую логику: можно создать тему, выбрать требуемые
                    элементы и сразу добавить новые элементы, которые будут
                    формироваться в этой теме.
                  </p>
                </div>
              </div>

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
                    placeholder="Короткое описание темы"
                  />
                </label>

                <div className="editor-subsection">
                  <div className="editor-subsection__header">
                    <div>
                      <strong>Требуемые элементы</strong>
                      <p>Выбери уже существующие элементы, нужные до начала темы.</p>
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
                    <p className="editor-empty">
                      Пока нет элементов, которые можно выбрать как требуемые.
                    </p>
                  )}
                </div>

                <div className="editor-subsection">
                  <div className="editor-subsection__header">
                    <div>
                      <strong>Новые элементы</strong>
                      <p>Добавь элементы, которые будут формироваться в теме.</p>
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
                              placeholder="Короткое описание нового элемента"
                            />
                          </label>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="editor-empty">
                      Пока не добавлено ни одного нового элемента для этой темы.
                    </p>
                  )}
                </div>

                <button
                  className="primary-button"
                  disabled={!topicName.trim() || !!busyAction}
                  type="submit"
                >
                  {busyAction === "topic-create" ? "Сохраняю..." : "Создать тему"}
                </button>
              </form>
            </section>

            <section className="editor-panel">
              <div className="editor-panel__header">
                <div>
                  <h4>Редактирование темы</h4>
                  <p>Позволяет изменить название и описание уже существующей темы.</p>
                </div>
              </div>

              {sortedTopics.length ? (
                <form className="editor-form" onSubmit={handleUpdateTopic}>
                  <label className="field">
                    <span>Тема</span>
                    <select
                      value={editTopicId}
                      onChange={(event) => setEditTopicId(event.target.value)}
                    >
                      {sortedTopics.map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {topic.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Название</span>
                    <input
                      value={editTopicName}
                      onChange={(event) => setEditTopicName(event.target.value)}
                      placeholder="Название темы"
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
                    />
                  </label>

                  <button
                    className="primary-button"
                    disabled={!editTopicId || !editTopicName.trim() || !!busyAction}
                    type="submit"
                  >
                    {busyAction === "topic-update" ? "Сохраняю..." : "Сохранить тему"}
                  </button>
                </form>
              ) : (
                <p className="editor-empty">Пока нет тем для редактирования.</p>
              )}
            </section>

            <section className="editor-panel editor-panel--danger">
              <div className="editor-panel__header">
                <div>
                  <h4>Удаление темы</h4>
                  <p>
                    Удаление темы уберет и связанные с ней зависимости и привязки
                    элементов.
                  </p>
                </div>
              </div>

              {sortedTopics.length ? (
                <form className="editor-form" onSubmit={handleDeleteTopic}>
                  <label className="field">
                    <span>Тема</span>
                    <select
                      value={deleteTopicId}
                      onChange={(event) => setDeleteTopicId(event.target.value)}
                    >
                      {sortedTopics.map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {topic.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="secondary-button secondary-button--danger"
                    disabled={!deleteTopicId || !!busyAction}
                    type="submit"
                  >
                    {busyAction === "topic-delete" ? "Удаляю..." : "Удалить тему"}
                  </button>
                </form>
              ) : (
                <p className="editor-empty">Пока нет тем для удаления.</p>
              )}
            </section>
          </div>
        ) : null}
        {activeTab === "elements" ? (
          <div className="editor-panels__elements">
            <section className="editor-panel">
              <div className="editor-panel__header">
                <div>
                  <h4>Создание элемента</h4>
                  <p>Создает самостоятельный элемент знаний, умений или владений.</p>
                </div>
              </div>

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
                      onChange={(event) =>
                        setElementCompetence(event.target.value as CompetenceType)
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
                    rows={3}
                    value={elementDescription}
                    onChange={(event) => setElementDescription(event.target.value)}
                    placeholder="Короткое описание элемента"
                  />
                </label>

                <button
                  className="primary-button"
                  disabled={!elementName.trim() || !!busyAction}
                  type="submit"
                >
                  {busyAction === "element-create" ? "Сохраняю..." : "Создать элемент"}
                </button>
              </form>
            </section>

            <section className="editor-panel">
              <div className="editor-panel__header">
                <div>
                  <h4>Привязка элемента</h4>
                  <p>Привязывает уже существующий элемент к выбранной теме.</p>
                </div>
              </div>

              <form className="editor-form" onSubmit={handleAttachElement}>
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
                  type="submit"
                >
                  {busyAction === "element-attach" ? "Сохраняю..." : "Привязать элемент"}
                </button>
              </form>
            </section>

            <section className="editor-panel">
              <div className="editor-panel__header">
                <div>
                  <h4>Редактирование элемента</h4>
                  <p>Позволяет изменить название, компетенцию и описание элемента.</p>
                </div>
              </div>

              {sortedAllElements.length ? (
                <form className="editor-form" onSubmit={handleUpdateElement}>
                  <label className="field">
                    <span>Элемент</span>
                    <select
                      value={editElementId}
                      onChange={(event) => setEditElementId(event.target.value)}
                    >
                      {sortedAllElements.map((element) => (
                        <option key={element.id} value={element.id}>
                          {element.name} ({competenceLabel(element.competence_type)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="field">
                    <span>Название</span>
                    <input
                      value={editElementName}
                      onChange={(event) => setEditElementName(event.target.value)}
                      placeholder="Название элемента"
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
                    />
                  </label>

                  <button
                    className="primary-button"
                    disabled={!editElementId || !editElementName.trim() || !!busyAction}
                    type="submit"
                  >
                    {busyAction === "element-update" ? "Сохраняю..." : "Сохранить элемент"}
                  </button>
                </form>
              ) : (
                <p className="editor-empty">Пока нет элементов для редактирования.</p>
              )}
            </section>

            <section className="editor-panel editor-panel--danger">
              <div className="editor-panel__header">
                <div>
                  <h4>Удаление элемента</h4>
                  <p>
                    Удаление элемента уберет его из тем и удалит связанные отношения с
                    другими элементами.
                  </p>
                </div>
              </div>

              {sortedAllElements.length ? (
                <form className="editor-form" onSubmit={handleDeleteElement}>
                  <label className="field">
                    <span>Элемент</span>
                    <select
                      value={deleteElementId}
                      onChange={(event) => setDeleteElementId(event.target.value)}
                    >
                      {sortedAllElements.map((element) => (
                        <option key={element.id} value={element.id}>
                          {element.name} ({competenceLabel(element.competence_type)})
                        </option>
                      ))}
                    </select>
                  </label>

                  <button
                    className="secondary-button secondary-button--danger"
                    disabled={!deleteElementId || !!busyAction}
                    type="submit"
                  >
                    {busyAction === "element-delete" ? "Удаляю..." : "Удалить элемент"}
                  </button>
                </form>
              ) : (
                <p className="editor-empty">Пока нет элементов для удаления.</p>
              )}
            </section>
          </div>
        ) : null}
        {activeTab === "relations" ? (
          <div className="editor-panels__relations">
            <section className="editor-panel">
              <div className="editor-panel__header">
                <div>
                  <h4>Добавить связь между темами</h4>
                  <p>Сохраняет существующую механику связи между темами дисциплины.</p>
                </div>
              </div>

              <form className="editor-form" onSubmit={handleCreateDependency}>
                <div className="editor-form__grid">
                  <label className="field">
                    <span>Тема-источник</span>
                    <select
                      value={dependencySourceTopicId}
                      onChange={(event) => setDependencySourceTopicId(event.target.value)}
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
                    <span>Зависимая тема</span>
                    <select
                      value={dependencyTargetTopicId}
                      onChange={(event) => setDependencyTargetTopicId(event.target.value)}
                      disabled={!sortedTopics.length}
                    >
                      {sortedTopics.map((topic) => (
                        <option key={topic.id} value={topic.id}>
                          {topic.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="editor-form__grid">
                  <label className="field">
                    <span>Тип связи</span>
                    <select
                      value={dependencyType}
                      onChange={(event) =>
                        setDependencyType(event.target.value as TopicDependencyRelationType)
                      }
                    >
                      {TOPIC_DEPENDENCY_OPTIONS.map((option) => (
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
                    value={dependencyDescription}
                    onChange={(event) => setDependencyDescription(event.target.value)}
                    placeholder="Необязательное описание связи между темами"
                  />
                </label>

                <button
                  className="primary-button"
                  disabled={!dependencySourceTopicId || !dependencyTargetTopicId || !!busyAction}
                  type="submit"
                >
                  {busyAction === "topic-dependency"
                    ? "Сохраняю..."
                    : "Создать связь тем"}
                </button>
              </form>
            </section>

            <section className="editor-panel">
              <div className="editor-panel__header">
                <div>
                  <h4>Добавить связь между элементами</h4>
                  <p>
                    Динамический список типов связи зависит от выбранной пары
                    элементов.
                  </p>
                </div>
              </div>

              <form className="editor-form" onSubmit={handleCreateElementRelation}>
                <div className="editor-form__grid">
                  <label className="field">
                    <span>Элемент 1</span>
                    <select
                      value={relationSourceElementId}
                      onChange={(event) => setRelationSourceElementId(event.target.value)}
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
                    <span>Элемент 2</span>
                    <select
                      value={relationTargetElementId}
                      onChange={(event) => setRelationTargetElementId(event.target.value)}
                      disabled={!sortedAllElements.length}
                    >
                      {sortedAllElements.map((element) => (
                        <option key={element.id} value={element.id}>
                          {element.name} ({competenceLabel(element.competence_type)})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div className="editor-form__grid">
                  <label className="field">
                    <span>Тип связи</span>
                    <select
                      value={relationType}
                      onChange={(event) =>
                        setRelationType(event.target.value as KnowledgeElementRelationType)
                      }
                      disabled={!relationOptions.length}
                    >
                      {relationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                {!relationOptions.length ? (
                  <p className="editor-empty">
                    Для такой пары элементов связь сейчас не поддерживается.
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
                    !relationType ||
                    !!busyAction
                  }
                  type="submit"
                >
                  {busyAction === "element-relation"
                    ? "Сохраняю..."
                    : "Создать связь элементов"}
                </button>
              </form>
            </section>
          </div>
        ) : null}
      </div>
    </section>
  );
}
