import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  fetchStudentTopicControl,
  fetchStudentTopicControlByPosition,
  isAbortError,
  submitStudentTaskScore,
} from "./api";
import type { StudentAssignedTask, StudentTopicControl } from "./types";

const LAST_STUDENT_STORAGE_KEY = "competence-hub:last-student-id";

const TASK_TYPE_LABELS: Record<StudentAssignedTask["task_type"], string> = {
  single_choice: "Один выбор",
  multiple_choice: "Несколько вариантов",
  matching: "Установление соответствия",
  ordering: "Правильная последовательность",
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось выполнить действие.";
}

function getStoredStudentId() {
  try {
    return localStorage.getItem(LAST_STUDENT_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

function rememberStudentId(studentId: string) {
  try {
    localStorage.setItem(LAST_STUDENT_STORAGE_KEY, studentId);
  } catch {
    // localStorage может быть недоступен в приватном режиме, это не должно ломать контроль.
  }
}

function emptyAnswer(task: StudentAssignedTask) {
  if (task.task_type === "single_choice" || task.task_type === "multiple_choice") {
    return { selected_option_ids: [] as string[] };
  }
  if (task.task_type === "matching") {
    return { pairings: [] as Array<{ left_id: string; right_id: string }> };
  }
  return { ordered_item_ids: [] as string[] };
}

export default function StudentTopicControlPage() {
  const navigate = useNavigate();
  const {
    studentId: studentIdFromPath = "",
    trajectoryId = "",
    topicId = "",
    topicPosition = "",
  } = useParams<{
    studentId?: string;
    trajectoryId?: string;
    topicId?: string;
    topicPosition?: string;
  }>();
  const [searchParams] = useSearchParams();
  const studentId = studentIdFromPath || searchParams.get("student") || getStoredStudentId();

  const [control, setControl] = useState<StudentTopicControl | null>(null);
  const [answer, setAnswer] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function loadControl(signal?: AbortSignal) {
    if (!studentId || !trajectoryId) {
      throw new Error("Не удалось определить студента или траекторию.");
    }

    rememberStudentId(studentId);

    let nextControl: StudentTopicControl;
    if (topicId) {
      nextControl = await fetchStudentTopicControl(studentId, trajectoryId, topicId, signal);
    } else {
      const position = Number(topicPosition);
      if (!Number.isInteger(position) || position < 1) {
        throw new Error("Не удалось определить номер темы в траектории.");
      }
      nextControl = await fetchStudentTopicControlByPosition(
        studentId,
        trajectoryId,
        position,
        signal,
      );
    }

    setControl(nextControl);
    setAnswer(nextControl.current_task ? emptyAnswer(nextControl.current_task) : {});
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        await loadControl(controller.signal);
      } catch (loadError) {
        if (!isAbortError(loadError)) {
          setError(extractErrorMessage(loadError));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [studentId, trajectoryId, topicId, topicPosition]);

  function toggleChoice(task: StudentAssignedTask, optionId: string, checked: boolean) {
    const currentIds = Array.isArray(answer.selected_option_ids)
      ? (answer.selected_option_ids as string[])
      : [];

    if (task.task_type === "single_choice") {
      setAnswer({ selected_option_ids: checked ? [optionId] : [] });
      return;
    }

    setAnswer({
      selected_option_ids: checked
        ? [...new Set([...currentIds, optionId])]
        : currentIds.filter((item) => item !== optionId),
    });
  }

  function updateMatching(leftId: string, rightId: string) {
    const currentPairings = Array.isArray(answer.pairings)
      ? (answer.pairings as Array<{ left_id: string; right_id: string }>)
      : [];
    setAnswer({
      pairings: [
        ...currentPairings.filter((pairing) => pairing.left_id !== leftId),
        { left_id: leftId, right_id: rightId },
      ],
    });
  }

  function updateOrdering(index: number, itemId: string) {
    const currentOrder = Array.isArray(answer.ordered_item_ids)
      ? [...(answer.ordered_item_ids as string[])]
      : [];
    currentOrder[index] = itemId;
    setAnswer({ ordered_item_ids: currentOrder });
  }

  async function submitAnswer(task: StudentAssignedTask) {
    if (!studentId) {
      setError("Не удалось определить студента.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      const updatedTask = await submitStudentTaskScore(
        task.id,
        studentId,
        answer,
        task.task_instance_id,
      );

      setControl((current) =>
        current
          ? {
              ...current,
              current_task: updatedTask,
              elements: current.elements.map((element) =>
                element.element_id === updatedTask.primary_element.element_id
                  ? { ...element, mastery_value: updatedTask.primary_element.mastery_value }
                  : element,
              ),
            }
          : current,
      );

      setAnswer(emptyAnswer(updatedTask));
      await loadControl();
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  function renderAnswer(task: StudentAssignedTask) {
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
                onChange={(event) => toggleChoice(task, option.id, event.target.checked)}
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
                onChange={(event) => updateMatching(item.id, event.target.value)}
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
        {(task.content.items ?? []).map((_, index) => (
          <label className="field" key={index}>
            <span>Позиция {index + 1}</span>
            <select
              value={
                Array.isArray(answer.ordered_item_ids)
                  ? String((answer.ordered_item_ids as string[])[index] ?? "")
                  : ""
              }
              onChange={(event) => updateOrdering(index, event.target.value)}
            >
              <option value="">Выбери элемент</option>
              {(task.content.items ?? []).map((item) => (
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

  const currentTask = control?.current_task ?? null;

  return (
    <div className="immersive-page">
      <header className="student-control-header">
        <div>
          <p className="hero__eyebrow">Контроль знаний</p>
          <h1>{loading && !control ? "Загрузка темы" : control?.topic_name ?? "Тема"}</h1>
          <p className="hero__subtitle">
            Порог темы: {control?.topic_threshold ?? 0}. Текущий балл темы:{" "}
            {control?.topic_mastery ?? 0}.
          </p>
        </div>
        <button className="ghost-button" type="button" onClick={() => navigate(-1)}>
          Назад
        </button>
      </header>

      <main className="student-control-layout">
        <section className="card card--soft student-control-task">
          {loading && !control ? (
            <div className="status-view immersive-page__status student-control-task__status">
              <div className="status-view__pulse" />
              <h3>Подбираю задание</h3>
              <p>Загружаю состояние темы, доступность шага и текущее задание для студента.</p>
            </div>
          ) : error ? (
            <p className="form-error">{error}</p>
          ) : !control?.is_unlocked ? (
            <p className="form-error">
              Тема пока закрыта: сначала нужно набрать порог по предыдущим темам.
            </p>
          ) : currentTask ? (
            <>
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Текущее задание</p>
                  <h2>{currentTask.title || currentTask.topic_name}</h2>
                </div>
                <span className="hero__chip">{TASK_TYPE_LABELS[currentTask.task_type]}</span>
              </div>
              <p className="card__lead">{currentTask.prompt}</p>
              <div className="student-task-card__progress">
                <span>Проверяем: {currentTask.primary_element.name}</span>
                <span>Освоение: {currentTask.primary_element.mastery_value}</span>
                <span>Сложность: {currentTask.difficulty}</span>
              </div>
              {currentTask.progress.last_feedback ? (
                <div className="student-task-card__feedback">
                  {String(currentTask.progress.last_feedback.message ?? "")}
                </div>
              ) : null}
              {renderAnswer(currentTask)}
              <div className="student-task-card__actions">
                <button
                  className="primary-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void submitAnswer(currentTask)}
                >
                  {saving ? "Проверяю..." : "Отправить ответ"}
                </button>
                <button
                  className="ghost-button"
                  type="button"
                  disabled={saving}
                  onClick={() => void loadControl()}
                >
                  Обновить тему
                </button>
              </div>
            </>
          ) : (
            <div className="status-view immersive-page__status student-control-task__status">
              <div className="status-view__pulse" />
              <h3>Нет доступного задания</h3>
              <p>Для этой темы пока нет задания, которое подходит текущему состоянию студента.</p>
            </div>
          )}
        </section>

        <aside className="card card--soft student-control-panel">
          <p className="card__eyebrow">Освоение элементов</p>
          {loading && !control ? (
            <p className="card__text">Загружаю элементы темы...</p>
          ) : (
            (control?.elements ?? []).map((element) => (
              <div className="mastery-row" key={element.element_id}>
                <div>
                  <strong>{element.name}</strong>
                  <span>Порог {element.threshold}</span>
                </div>
                <span>{element.mastery_value}</span>
              </div>
            ))
          )}
        </aside>
      </main>
    </div>
  );
}
