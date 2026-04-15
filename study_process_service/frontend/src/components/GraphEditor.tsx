import { type FormEvent, useEffect, useMemo, useState } from "react";

import {
  createKnowledgeElement,
  createKnowledgeElementRelation,
  createTopic,
  createTopicDependency,
  createTopicKnowledgeElement,
  fetchKnowledgeElements,
  isAbortError,
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
  { label: "Требует", value: "requires" },
  { label: "Возможный переход", value: "possible_flow" },
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

const KNOW_TO_CAN_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [{ label: "Реализует", value: "implements" }];

const CAN_TO_MASTER_RELATION_OPTIONS: Array<{
  label: string;
  value: KnowledgeElementRelationType;
}> = [{ label: "Переходит во владение", value: "automates" }];

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
  const [allElements, setAllElements] = useState<KnowledgeElement[]>([]);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const [topicName, setTopicName] = useState("");
  const [topicDescription, setTopicDescription] = useState("");
  const [selectedRequiredElementIds, setSelectedRequiredElementIds] = useState<string[]>([]);
  const [topicNewElements, setTopicNewElements] = useState<TopicNewElementDraft[]>([]);

  const [elementName, setElementName] = useState("");
  const [elementDescription, setElementDescription] = useState("");
  const [elementCompetence, setElementCompetence] = useState<CompetenceType>("know");

  const [topicElementTopicId, setTopicElementTopicId] = useState("");
  const [topicElementElementId, setTopicElementElementId] = useState("");
  const [topicElementRole, setTopicElementRole] =
    useState<TopicKnowledgeElementRole>("required");
  const [topicElementNote, setTopicElementNote] = useState("");

  const [dependencySourceTopicId, setDependencySourceTopicId] = useState("");
  const [dependencyTargetTopicId, setDependencyTargetTopicId] = useState("");
  const [dependencyType, setDependencyType] =
    useState<TopicDependencyRelationType>("requires");
  const [dependencyDescription, setDependencyDescription] = useState("");

  const [relationSourceElementId, setRelationSourceElementId] = useState("");
  const [relationTargetElementId, setRelationTargetElementId] = useState("");
  const [relationType, setRelationType] = useState<KnowledgeElementRelationType | "">("");
  const [relationDescription, setRelationDescription] = useState("");

  // ✅ FIX #1: Мемоизируем сортированные массивы, чтобы они не меняли reference на каждом рендере
  const sortedTopics = useMemo(() => 
    topics.slice().sort((left, right) => left.name.localeCompare(right.name, "ru")), 
    [topics]
  );

  const sortedAllElements = useMemo(() => 
    allElements.slice().sort((left, right) => left.name.localeCompare(right.name, "ru")), 
    [allElements]
  );

  const relationElements = useMemo(() => {
    const elements = allElements.length ? allElements : disciplineElements;
    return elements.slice().sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [allElements, disciplineElements]);

  const relationSourceElement = useMemo(
    () => relationElements.find((element) => element.id === relationSourceElementId),
    [relationElements, relationSourceElementId],
  );
  const relationTargetElement = useMemo(
    () => relationElements.find((element) => element.id === relationTargetElementId),
    [relationElements, relationTargetElementId],
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
        if (controller.signal.aborted) {
          return;
        }
        setAllElements(items);
      } catch (error) {
        if (isAbortError(error)) {
          return;
        }
        setFeedback({
          kind: "error",
          text: extractErrorMessage(error),
        });
      }
    }

    void loadAllElements();

    return () => controller.abort();
  }, []);

  // ✅ FIX #2: Добавляем проверки, чтобы не вызывать setState с тем же значением
  useEffect(() => {
    if (!sortedTopics.length) {
      if (topicElementTopicId) setTopicElementTopicId("");
      if (dependencySourceTopicId) setDependencySourceTopicId("");
      if (dependencyTargetTopicId) setDependencyTargetTopicId("");
      return;
    }

    if (topicElementTopicId && !sortedTopics.some((topic) => topic.id === topicElementTopicId)) {
      setTopicElementTopicId(sortedTopics[0].id);
    } else if (!topicElementTopicId && sortedTopics[0]) {
      setTopicElementTopicId(sortedTopics[0].id);
    }

    if (dependencySourceTopicId && !sortedTopics.some((topic) => topic.id === dependencySourceTopicId)) {
      setDependencySourceTopicId(sortedTopics[0].id);
    } else if (!dependencySourceTopicId && sortedTopics[0]) {
      setDependencySourceTopicId(sortedTopics[0].id);
    }

    if (dependencyTargetTopicId && !sortedTopics.some((topic) => topic.id === dependencyTargetTopicId)) {
      setDependencyTargetTopicId(sortedTopics[0].id);
    } else if (!dependencyTargetTopicId && sortedTopics[0]) {
      setDependencyTargetTopicId(sortedTopics[0].id);
    }
  }, [
    dependencySourceTopicId,
    dependencyTargetTopicId,
    sortedTopics,
    topicElementTopicId,
  ]);

  useEffect(() => {
    if (!sortedAllElements.length) {
      if (topicElementElementId) setTopicElementElementId("");
      if (selectedRequiredElementIds.length) setSelectedRequiredElementIds([]);
      return;
    }

    if (topicElementElementId && !sortedAllElements.some((element) => element.id === topicElementElementId)) {
      setTopicElementElementId(sortedAllElements[0].id);
    } else if (!topicElementElementId && sortedAllElements[0]) {
      setTopicElementElementId(sortedAllElements[0].id);
    }

    setSelectedRequiredElementIds((current) => {
      const filtered = current.filter((elementId) =>
        sortedAllElements.some((element) => element.id === elementId),
      );
      // Обновляем только если массив изменился
      return filtered.length !== current.length ? filtered : current;
    });
  }, [sortedAllElements, topicElementElementId]);

  useEffect(() => {
    if (!relationElements.length) {
      if (relationSourceElementId) setRelationSourceElementId("");
      if (relationTargetElementId) setRelationTargetElementId("");
      if (relationType) setRelationType("");
      return;
    }

    if (relationSourceElementId && !relationElements.some((element) => element.id === relationSourceElementId)) {
      setRelationSourceElementId(relationElements[0].id);
    } else if (!relationSourceElementId && relationElements[0]) {
      setRelationSourceElementId(relationElements[0].id);
    }

    if (relationTargetElementId && !relationElements.some((element) => element.id === relationTargetElementId)) {
      setRelationTargetElementId(
        nextDifferentValue(relationSourceElementId, relationElements),
      );
    } else if (!relationTargetElementId && relationElements.length > 1) {
      setRelationTargetElementId(
        nextDifferentValue(relationSourceElementId, relationElements),
      );
    }
  }, [relationElements, relationSourceElementId, relationTargetElementId]);

  useEffect(() => {
    if (!relationOptions.length) {
      if (relationType) setRelationType("");
      return;
    }

    if (relationType && !relationOptions.some((option) => option.value === relationType)) {
      setRelationType(relationOptions[0].value);
    } else if (!relationType && relationOptions[0]) {
      setRelationType(relationOptions[0].value);
    }
  }, [relationOptions, relationType]);

  async function reloadElements() {
    const items = await fetchKnowledgeElements();
    setAllElements(items);
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
    if (!disciplineId) {
      return;
    }

    try {
      setBusyAction("topic");
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
      await reloadElements();
      await onDataChanged();
      setFeedback({ kind: "success", text: "Тема создана." });
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateElement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      setBusyAction("element");
      setFeedback(null);
      const createdElement = await createKnowledgeElement({
        name: elementName.trim(),
        description: elementDescription.trim(),
        competence_type: elementCompetence,
      });
      setElementName("");
      setElementDescription("");
      setElementCompetence("know");
      await reloadElements();
      setTopicElementElementId(createdElement.id);
      await onDataChanged();
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
      setBusyAction("topic-element");
      setFeedback(null);
      await createTopicKnowledgeElement({
        topic_id: topicElementTopicId,
        element_id: topicElementElementId,
        role: topicElementRole,
        note: topicElementNote.trim(),
      });
      setTopicElementNote("");
      await onDataChanged();
      setFeedback({ kind: "success", text: "Элемент привязан к теме." });
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
      await onDataChanged();
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
      await onDataChanged();
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
      <h3>Редактирование графа</h3>
      <p className="card__text">
        Здесь можно добавлять темы, элементы и связи прямо из интерфейса.
        Доступные типы связей между элементами зависят от выбранной пары компетенций.
      </p>

      {feedback ? (
        <div className={`editor-status editor-status--${feedback.kind}`}>{feedback.text}</div>
      ) : null}

      <div className="editor-accordion">
        <details className="editor-block" open>
          <summary>Добавить тему</summary>
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
                  <p>
                    Выбери уже существующие элементы, которые нужны до начала
                    изучения этой темы.
                  </p>
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
                  <p>
                    Добавь элементы, которые будут сформированы в результате
                    изучения темы.
                  </p>
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

            <button className="primary-button" disabled={!topicName.trim() || !!busyAction}>
              {busyAction === "topic" ? "Сохраняю..." : "Создать тему"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Добавить элемент</summary>
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

            <button className="primary-button" disabled={!elementName.trim() || !!busyAction}>
              {busyAction === "element" ? "Сохраняю..." : "Создать элемент"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Привязать элемент к теме</summary>
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
                placeholder="Необязательный комментарий к связи темы и элемента"
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
          <summary>Добавить связь между темами</summary>
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
            >
              {busyAction === "topic-dependency" ? "Сохраняю..." : "Создать связь тем"}
            </button>
          </form>
        </details>

        <details className="editor-block">
          <summary>Добавить связь между элементами</summary>
          <form className="editor-form" onSubmit={handleCreateElementRelation}>
            <div className="editor-form__grid">
              <label className="field">
                <span>Элемент 1</span>
                <select
                  value={relationSourceElementId}
                  onChange={(event) => setRelationSourceElementId(event.target.value)}
                  disabled={!relationElements.length}
                >
                  {relationElements.map((element) => (
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
                  disabled={!relationElements.length}
                >
                  {relationElements.map((element) => (
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
            >
              {busyAction === "element-relation" ? "Сохраняю..." : "Создать связь элементов"}
            </button>
          </form>
        </details>
      </div>
    </section>
  );
}