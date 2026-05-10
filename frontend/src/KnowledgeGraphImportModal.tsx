import { type ChangeEvent, type FormEvent, useCallback, useEffect, useMemo, useState } from "react";

import { importKnowledgeGraph, isAbortError, previewKnowledgeGraphImport } from "./api";
import type {
  CompetenceType,
  Discipline,
  KnowledgeElement,
  KnowledgeElementRelation,
  KnowledgeElementRelationType,
  KnowledgeGraphExportFile,
  KnowledgeGraphImportPreviewResponse,
  Topic,
  TopicDependency,
  TopicDependencyRelationType,
  TopicKnowledgeElement,
  TopicKnowledgeElementRole,
} from "./types";

const KNOWLEDGE_RELATION_LABEL_RU: Record<KnowledgeElementRelationType, string> = {
  requires: "Требует",
  builds_on: "Опирается на",
  contains: "Содержит",
  part_of: "Является частью",
  property_of: "Свойство",
  refines: "Уточняет",
  generalizes: "Обобщает",
  similar: "Подобен",
  contrasts_with: "Контрастирует с",
  used_with: "Используется с",
  implements: "Реализует",
  automates: "Автоматизирует",
};

const TOPIC_DEPENDENCY_RELATION_LABEL_RU: Record<TopicDependencyRelationType, string> = {
  requires: "Требуется",
  possible_flow: "Возможный переход",
};

const TOPIC_ELEMENT_ROLE_LABEL_RU: Record<TopicKnowledgeElementRole, string> = {
  required: "требуется для темы",
  formed: "формируется в теме",
};

const COMPETENCE_LABEL_RU: Record<CompetenceType, string> = {
  know: "знать",
  can: "уметь",
  master: "владеть",
};

function formatKnowledgeRelationType(type: KnowledgeElementRelationType) {
  return KNOWLEDGE_RELATION_LABEL_RU[type] ?? type;
}

function formatTopicDependencyRelationType(type: TopicDependencyRelationType) {
  return TOPIC_DEPENDENCY_RELATION_LABEL_RU[type] ?? type;
}

function formatTopicElementRole(role: TopicKnowledgeElementRole) {
  return TOPIC_ELEMENT_ROLE_LABEL_RU[role] ?? role;
}

function formatCompetenceType(type: CompetenceType) {
  return COMPETENCE_LABEL_RU[type] ?? type;
}

type Props = {
  disciplineId: string;
  open: boolean;
  onClose: () => void;
  onImported: () => void;
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Не удалось выполнить операцию.";
}

function normalizeExportPayload(raw: unknown): KnowledgeGraphExportFile {
  if (!raw || typeof raw !== "object") {
    throw new Error("Файл не похож на JSON-объект.");
  }
  const o = raw as Record<string, unknown>;

  if (!Array.isArray(o.topics)) {
    throw new Error("В файле должен быть массив topics.");
  }

  const topics = o.topics as Topic[];
  const topic_dependencies = (Array.isArray(o.topic_dependencies) ? o.topic_dependencies : []) as TopicDependency[];
  const knowledge_elements = (Array.isArray(o.knowledge_elements) ? o.knowledge_elements : []) as KnowledgeElement[];
  const topic_knowledge_elements = (
    Array.isArray(o.topic_knowledge_elements) ? o.topic_knowledge_elements : []
  ) as TopicKnowledgeElement[];
  const knowledge_element_relations = (
    Array.isArray(o.knowledge_element_relations) ? o.knowledge_element_relations : []
  ) as KnowledgeElementRelation[];

  const source =
    (o.source_discipline as Discipline | undefined) ??
    (o.discipline as Discipline | undefined) ??
    null;

  const format_version = typeof o.format_version === "number" ? o.format_version : 1;
  const exported_at =
    typeof o.exported_at === "string" ? o.exported_at : new Date().toISOString();

  return {
    format_version,
    exported_at,
    source_discipline: source,
    topics,
    topic_dependencies,
    knowledge_elements,
    topic_knowledge_elements,
    knowledge_element_relations,
  };
}

function toggleInSet(set: Set<string>, id: string) {
  const next = new Set(set);
  if (next.has(id)) {
    next.delete(id);
  } else {
    next.add(id);
  }
  return next;
}

export function KnowledgeGraphImportModal({ disciplineId, open, onClose, onImported }: Props) {
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState("");
  const [exportPayload, setExportPayload] = useState<KnowledgeGraphExportFile | null>(null);
  const [preview, setPreview] = useState<KnowledgeGraphImportPreviewResponse | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [busy, setBusy] = useState(false);
  const [resultText, setResultText] = useState("");
  const [submitError, setSubmitError] = useState("");

  const [selectedTopics, setSelectedTopics] = useState<Set<string>>(() => new Set());
  const [selectedElements, setSelectedElements] = useState<Set<string>>(() => new Set());
  const [selectedDeps, setSelectedDeps] = useState<Set<string>>(() => new Set());
  const [selectedTke, setSelectedTke] = useState<Set<string>>(() => new Set());
  const [selectedKer, setSelectedKer] = useState<Set<string>>(() => new Set());

  const resetState = useCallback(() => {
    setFileName("");
    setParseError("");
    setExportPayload(null);
    setPreview(null);
    setPreviewError("");
    setResultText("");
    setSubmitError("");
    setSelectedTopics(new Set());
    setSelectedElements(new Set());
    setSelectedDeps(new Set());
    setSelectedTke(new Set());
    setSelectedKer(new Set());
  }, []);

  useEffect(() => {
    if (!open) {
      resetState();
    }
  }, [open, resetState]);

  const topicResolves = useCallback(
    (exportId: string) => {
      if (!preview) return false;
      const row = preview.topics.find((t) => t.export_id === exportId);
      if (!row) return false;
      if (row.is_duplicate) return true;
      return selectedTopics.has(exportId);
    },
    [preview, selectedTopics],
  );

  const elementResolves = useCallback(
    (exportId: string) => {
      if (!preview) return false;
      const row = preview.knowledge_elements.find((e) => e.export_id === exportId);
      if (!row) return false;
      if (row.is_duplicate) return true;
      return selectedElements.has(exportId);
    },
    [preview, selectedElements],
  );

  useEffect(() => {
    if (!preview) return;
    const tRes = (exportId: string) => {
      const row = preview.topics.find((t) => t.export_id === exportId);
      if (!row) return false;
      if (row.is_duplicate) return true;
      return selectedTopics.has(exportId);
    };
    const eRes = (exportId: string) => {
      const row = preview.knowledge_elements.find((e) => e.export_id === exportId);
      if (!row) return false;
      if (row.is_duplicate) return true;
      return selectedElements.has(exportId);
    };

    setSelectedDeps((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        const d = preview.topic_dependencies.find((x) => x.export_id === id);
        if (
          d &&
          !d.is_duplicate &&
          tRes(d.prerequisite_topic_export_id) &&
          tRes(d.dependent_topic_export_id)
        ) {
          next.add(id);
        }
      }
      return next;
    });

    setSelectedTke((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        const row = preview.topic_knowledge_elements.find((x) => x.export_id === id);
        if (row && !row.is_duplicate && tRes(row.topic_export_id) && eRes(row.element_export_id)) {
          next.add(id);
        }
      }
      return next;
    });

    setSelectedKer((prev) => {
      const next = new Set<string>();
      for (const id of prev) {
        const row = preview.knowledge_element_relations.find((x) => x.export_id === id);
        if (
          row &&
          !row.is_duplicate &&
          eRes(row.source_element_export_id) &&
          eRes(row.target_element_export_id)
        ) {
          next.add(id);
        }
      }
      return next;
    });
  }, [preview, selectedTopics, selectedElements]);

  const applyDefaultSelections = useCallback(
    (p: KnowledgeGraphImportPreviewResponse) => {
      const topics = new Set(p.topics.filter((t) => !t.is_duplicate).map((t) => t.export_id));
      const elements = new Set(
        p.knowledge_elements.filter((e) => !e.is_duplicate).map((e) => e.export_id),
      );

      const topicOk = (id: string) => {
        const row = p.topics.find((t) => t.export_id === id);
        if (!row) return false;
        if (row.is_duplicate) return true;
        return topics.has(id);
      };
      const elOk = (id: string) => {
        const row = p.knowledge_elements.find((e) => e.export_id === id);
        if (!row) return false;
        if (row.is_duplicate) return true;
        return elements.has(id);
      };

      const deps = new Set(
        p.topic_dependencies
          .filter(
            (d) =>
              !d.is_duplicate &&
              topicOk(d.prerequisite_topic_export_id) &&
              topicOk(d.dependent_topic_export_id),
          )
          .map((d) => d.export_id),
      );
      const tke = new Set(
        p.topic_knowledge_elements
          .filter(
            (x) => !x.is_duplicate && topicOk(x.topic_export_id) && elOk(x.element_export_id),
          )
          .map((x) => x.export_id),
      );
      const ker = new Set(
        p.knowledge_element_relations
          .filter(
            (x) =>
              !x.is_duplicate &&
              elOk(x.source_element_export_id) &&
              elOk(x.target_element_export_id),
          )
          .map((x) => x.export_id),
      );

      setSelectedTopics(topics);
      setSelectedElements(elements);
      setSelectedDeps(deps);
      setSelectedTke(tke);
      setSelectedKer(ker);
    },
    [],
  );

  const topicNameByExportId = useMemo(() => {
    if (!exportPayload) return new Map<string, string>();
    return new Map(exportPayload.topics.map((t) => [t.id, t.name]));
  }, [exportPayload]);

  const elementLabelByExportId = useMemo(() => {
    if (!exportPayload) return new Map<string, string>();
    return new Map(
      exportPayload.knowledge_elements.map((e) => [
        e.id,
        `${e.name} (${formatCompetenceType(e.competence_type)})`,
      ]),
    );
  }, [exportPayload]);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setParseError("");
    setPreviewError("");
    setPreview(null);
    setResultText("");
    setSubmitError("");
    setFileName(file.name);

    try {
      const text = await file.text();
      const parsed = JSON.parse(text) as unknown;
      const normalized = normalizeExportPayload(parsed);
      setExportPayload(normalized);
      setPreviewLoading(true);
      try {
        const prev = await previewKnowledgeGraphImport(disciplineId, normalized);
        setPreview(prev);
        applyDefaultSelections(prev);
      } catch (err) {
        if (!isAbortError(err)) {
          setPreviewError(extractErrorMessage(err));
        }
      } finally {
        setPreviewLoading(false);
      }
    } catch (err) {
      setExportPayload(null);
      setParseError(extractErrorMessage(err));
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!exportPayload || !preview) return;

    setBusy(true);
    setResultText("");
    setSubmitError("");
    try {
      const res = await importKnowledgeGraph(disciplineId, {
        export: exportPayload,
        selected_topic_export_ids: [...selectedTopics],
        selected_element_export_ids: [...selectedElements],
        selected_topic_dependency_export_ids: [...selectedDeps],
        selected_topic_knowledge_element_export_ids: [...selectedTke],
        selected_knowledge_element_relation_export_ids: [...selectedKer],
      });
      setResultText(
        `Импорт завершён: тем +${res.created_topics}, элементов +${res.created_knowledge_elements}, ` +
          `зависимостей тем +${res.created_topic_dependencies}, привязок +${res.created_topic_knowledge_elements}, ` +
          `связей элементов +${res.created_knowledge_element_relations}.`,
      );
      onImported();
    } catch (err) {
      setSubmitError(extractErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const importableTopicRows = useMemo(
    () => preview?.topics.filter((t) => !t.is_duplicate) ?? [],
    [preview],
  );
  const importableElementRows = useMemo(
    () => preview?.knowledge_elements.filter((e) => !e.is_duplicate) ?? [],
    [preview],
  );

  const depRows = useMemo(() => {
    if (!preview) return [];
    return preview.topic_dependencies.map((d) => {
      const ok =
        !d.is_duplicate &&
        topicResolves(d.prerequisite_topic_export_id) &&
        topicResolves(d.dependent_topic_export_id);
      return { d, ok };
    });
  }, [preview, topicResolves]);

  const tkeRows = useMemo(() => {
    if (!preview) return [];
    return preview.topic_knowledge_elements.map((x) => {
      const ok =
        !x.is_duplicate && topicResolves(x.topic_export_id) && elementResolves(x.element_export_id);
      return { x, ok };
    });
  }, [preview, topicResolves, elementResolves]);

  const kerRows = useMemo(() => {
    if (!preview) return [];
    return preview.knowledge_element_relations.map((x) => {
      const ok =
        !x.is_duplicate &&
        elementResolves(x.source_element_export_id) &&
        elementResolves(x.target_element_export_id);
      return { x, ok };
    });
  }, [preview, elementResolves]);

  if (!open) {
    return null;
  }

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal-panel knowledge-graph-import-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-labelledby="kg-import-title"
      >
        <div className="modal-panel__header">
          <div>
            <p className="card__eyebrow">Импорт</p>
            <h2 id="kg-import-title">Импорт графа знаний из JSON</h2>
            <p className="card__text">
              Дубликаты по имени темы и по паре (имя элемента, тип компетенции) в этой дисциплине не
              создаются. Отметьте, что именно перенести из оставшегося.
            </p>
          </div>
          <button className="ghost-button" onClick={onClose} type="button">
            Закрыть
          </button>
        </div>

        <form className="modal-panel__body knowledge-graph-import-modal__body" onSubmit={handleSubmit}>
          <label className="knowledge-graph-import-modal__file">
            <span className="card__eyebrow">Файл</span>
            <input accept="application/json,.json" onChange={(e) => void handleFileChange(e)} type="file" />
            {fileName ? <small>{fileName}</small> : null}
          </label>

          {parseError ? <p className="card__text knowledge-graph-import-modal__error">{parseError}</p> : null}
          {previewLoading ? <p className="card__text">Проверяю файл на сервере…</p> : null}
          {previewError ? <p className="card__text knowledge-graph-import-modal__error">{previewError}</p> : null}

          {preview ? (
            <>
              <section className="knowledge-graph-import-modal__section">
                <h3>Темы ({importableTopicRows.length} новых)</h3>
                <ul className="knowledge-graph-import-modal__list">
                  {preview.topics.map((t) => (
                    <li key={t.export_id}>
                      {t.is_duplicate ? (
                        <span className="knowledge-graph-import-modal__dup">
                          Уже есть: <strong>{t.name}</strong>
                        </span>
                      ) : (
                        <label className="knowledge-graph-import-modal__check">
                          <input
                            checked={selectedTopics.has(t.export_id)}
                            onChange={() => setSelectedTopics((s) => toggleInSet(s, t.export_id))}
                            type="checkbox"
                          />
                          <span>{t.name}</span>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="knowledge-graph-import-modal__section">
                <h3>Элементы знаний ({importableElementRows.length} новых)</h3>
                <ul className="knowledge-graph-import-modal__list">
                  {preview.knowledge_elements.map((e) => (
                    <li key={e.export_id}>
                      {e.is_duplicate ? (
                        <span className="knowledge-graph-import-modal__dup">
                          Уже есть: <strong>{e.name}</strong> (
                          {formatCompetenceType(e.competence_type)})
                        </span>
                      ) : (
                        <label className="knowledge-graph-import-modal__check">
                          <input
                            checked={selectedElements.has(e.export_id)}
                            onChange={() => setSelectedElements((s) => toggleInSet(s, e.export_id))}
                            type="checkbox"
                          />
                          <span>
                            {e.name}{" "}
                            <small>({formatCompetenceType(e.competence_type)})</small>
                          </span>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="knowledge-graph-import-modal__section">
                <h3>Зависимости тем</h3>
                <ul className="knowledge-graph-import-modal__list">
                  {depRows.map(({ d, ok }) => (
                    <li key={d.export_id}>
                      {d.is_duplicate ? (
                        <span className="knowledge-graph-import-modal__dup">Уже есть в дисциплине</span>
                      ) : !ok ? (
                        <span className="knowledge-graph-import-modal__muted">
                          Сначала отметьте обе темы (или они уже в дисциплине)
                        </span>
                      ) : (
                        <label className="knowledge-graph-import-modal__check">
                          <input
                            checked={selectedDeps.has(d.export_id)}
                            onChange={() => setSelectedDeps((s) => toggleInSet(s, d.export_id))}
                            type="checkbox"
                          />
                          <span>
                            {formatTopicDependencyRelationType(d.relation_type)}:{" "}
                            {topicNameByExportId.get(d.prerequisite_topic_export_id) ?? "тема"} →{" "}
                            {topicNameByExportId.get(d.dependent_topic_export_id) ?? "тема"}
                          </span>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="knowledge-graph-import-modal__section">
                <h3>Привязки тема — элемент</h3>
                <ul className="knowledge-graph-import-modal__list">
                  {tkeRows.map(({ x, ok }) => (
                    <li key={x.export_id}>
                      {x.is_duplicate ? (
                        <span className="knowledge-graph-import-modal__dup">Уже есть</span>
                      ) : !ok ? (
                        <span className="knowledge-graph-import-modal__muted">
                          Нужны тема и элемент в целевой дисциплине
                        </span>
                      ) : (
                        <label className="knowledge-graph-import-modal__check">
                          <input
                            checked={selectedTke.has(x.export_id)}
                            onChange={() => setSelectedTke((s) => toggleInSet(s, x.export_id))}
                            type="checkbox"
                          />
                          <span>
                            {topicNameByExportId.get(x.topic_export_id) ?? "тема"} ↔{" "}
                            {elementLabelByExportId.get(x.element_export_id) ?? "элемент"} (
                            {formatTopicElementRole(x.role)})
                          </span>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </section>

              <section className="knowledge-graph-import-modal__section">
                <h3>Связи между элементами</h3>
                <ul className="knowledge-graph-import-modal__list">
                  {kerRows.map(({ x, ok }) => (
                    <li key={x.export_id}>
                      {x.is_duplicate ? (
                        <span className="knowledge-graph-import-modal__dup">Уже есть</span>
                      ) : !ok ? (
                        <span className="knowledge-graph-import-modal__muted">
                          Нужны оба элемента в целевой дисциплине
                        </span>
                      ) : (
                        <label className="knowledge-graph-import-modal__check">
                          <input
                            checked={selectedKer.has(x.export_id)}
                            onChange={() => setSelectedKer((s) => toggleInSet(s, x.export_id))}
                            type="checkbox"
                          />
                          <span>
                            {formatKnowledgeRelationType(x.relation_type)}:{" "}
                            {elementLabelByExportId.get(x.source_element_export_id) ?? "?"} →{" "}
                            {elementLabelByExportId.get(x.target_element_export_id) ?? "?"}
                          </span>
                        </label>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            </>
          ) : null}

          {submitError ? (
            <p className="card__text knowledge-graph-import-modal__error">{submitError}</p>
          ) : null}
          {resultText ? <p className="card__text knowledge-graph-import-modal__result">{resultText}</p> : null}

          <div className="knowledge-graph-import-modal__actions">
            <button className="secondary-button" disabled={busy} onClick={onClose} type="button">
              Отмена
            </button>
            <button
              className="primary-button"
              disabled={!exportPayload || !preview || busy || !!previewLoading}
              type="submit"
            >
              {busy ? "Импорт…" : "Импортировать"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
