import { type FormEvent, useEffect, useState } from "react";

import {
  createKnowledgeElement,
  createKnowledgeElementRelation,
  createTopic,
  createTopicDependency,
  createTopicKnowledgeElement,
  fetchKnowledgeElements,
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

const KNOW_RELATION_OPTIONS: Array<{ label: string; value: KnowledgeElementRelationType }> = [
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
  const [relationType, setRelationType] =
    useState<KnowledgeElementRelationType>("requires");
  const [relationDescription, setRelationDescription] = useState("");

  const sortedTopics = topics.slice().sort((left, right) => left.name.localeCompare(right.name));
  const sortedAllElements = allElements
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const disciplineKnowElements = disciplineElements
    .filter((element) => element.competence_type === "know")
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));

  useEffect(() => {
    const controller = new AbortController();

    async function loadAllElements() {
      try {
        const items = await fetchKnowledgeElements(controller.signal);
        setAllElements(items);
      } catch (error) {
        setFeedback({
          kind: "error",
          text: extractErrorMessage(error),
        });
      }
    }

    void loadAllElements();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!sortedTopics.length) {
      setTopicElementTopicId("");
      setDependencySourceTopicId("");
      setDependencyTargetTopicId("");
      return;
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
    dependencySourceTopicId,
    dependencyTargetTopicId,
    sortedTopics,
    topicElementTopicId,
  ]);

  useEffect(() => {
    if (!sortedAllElements.length) {
      setTopicElementElementId("");
      return;
    }

    if (!sortedAllElements.some((element) => element.id === topicElementElementId)) {
      setTopicElementElementId(sortedAllElements[0].id);
    }
  }, [sortedAllElements, topicElementElementId]);

  useEffect(() => {
    if (!disciplineKnowElements.length) {
      setRelationSourceElementId("");
      setRelationTargetElementId("");
      return;
    }

    if (!disciplineKnowElements.some((element) => element.id === relationSourceElementId)) {
      setRelationSourceElementId(disciplineKnowElements[0].id);
    }

    if (!disciplineKnowElements.some((element) => element.id === relationTargetElementId)) {
      setRelationTargetElementId(
        nextDifferentValue(relationSourceElementId, disciplineKnowElements),
      );
    }
  }, [disciplineKnowElements, relationSourceElementId, relationTargetElementId]);

  async function reloadElements() {
    const items = await fetchKnowledgeElements();
    setAllElements(items);
  }

  async function handleCreateTopic(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!disciplineId) {
      return;
    }

    try {
      setBusyAction("topic");
      setFeedback(null);
      await createTopic({
        name: topicName.trim(),
        description: topicDescription.trim(),
        discipline_id: disciplineId,
      });
      setTopicName("");
      setTopicDescription("");
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
        Здесь можно добавлять темы, элементы и связи прямо из интерфейса. Связи
        между элементами сейчас доступны только для элементов типа "Знать".
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
          <summary>Добавить связь между элементами Знать</summary>
          <form className="editor-form" onSubmit={handleCreateElementRelation}>
            <div className="editor-form__grid">
              <label className="field">
                <span>Исходный элемент</span>
                <select
                  value={relationSourceElementId}
                  onChange={(event) => setRelationSourceElementId(event.target.value)}
                  disabled={!disciplineKnowElements.length}
                >
                  {disciplineKnowElements.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.name}
                    </option>
                  ))}
                </select>
              </label>

              <label className="field">
                <span>Целевой элемент</span>
                <select
                  value={relationTargetElementId}
                  onChange={(event) => setRelationTargetElementId(event.target.value)}
                  disabled={!disciplineKnowElements.length}
                >
                  {disciplineKnowElements.map((element) => (
                    <option key={element.id} value={element.id}>
                      {element.name}
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
                >
                  {KNOW_RELATION_OPTIONS.map((option) => (
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
                value={relationDescription}
                onChange={(event) => setRelationDescription(event.target.value)}
                placeholder="Необязательное описание связи между элементами"
              />
            </label>

            <button
              className="primary-button"
              disabled={
                !relationSourceElementId || !relationTargetElementId || !!busyAction
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
