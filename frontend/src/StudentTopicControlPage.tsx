import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  fetchStudentTopicControl,
  fetchStudentTopicControlByPosition,
  isAbortError,
  submitStudentTaskScore,
} from "./api";
import { getSessionHomePath, readSession, sessionMatches } from "./session";
import type { StudentAssignedTask, StudentTopicControl } from "./types";

const LAST_STUDENT_STORAGE_KEY = "competence-hub:last-student-id";

const TASK_TYPE_LABELS: Record<StudentAssignedTask["task_type"], string> = {
  single_choice: "Один выбор",
  multiple_choice: "Несколько вариантов",
  matching: "Сопоставление",
  ordering: "Порядок",
  text: "Текстовый ответ",
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
    // localStorage может быть недоступен, это не должно ломать экран.
  }
}

function emptyAnswer(task: StudentAssignedTask) {
  if (task.task_type === "single_choice" || task.task_type === "multiple_choice") {
    return { selected_option_ids: [] as string[] };
  }
  if (task.task_type === "matching") {
    return { pairings: [] as Array<{ left_id: string; right_id: string }> };
  }
  if (task.task_type === "ordering") {
    return { ordered_item_ids: [] as string[] };
  }
  return { text: "" };
}

function buildTopicControlPath(studentId: string, trajectoryId: string, topicId: string) {
  return `/students/${studentId}/trajectories/${trajectoryId}/control/${topicId}`;
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
  const [continuePractice, setContinuePractice] = useState(false);
  const [skillPractice, setSkillPractice] = useState(false);

  useEffect(() => {
    const activeSession = readSession();
    if (!sessionMatches(activeSession, "student", studentId)) {
      navigate(getSessionHomePath(activeSession), { replace: true });
    }
  }, [navigate, studentId]);

  async function loadControl(
    signal?: AbortSignal,
    nextContinuePractice = continuePractice,
    nextSkillPractice = skillPractice,
  ) {
    if (!studentId || !trajectoryId) {
      throw new Error("Не удалось определить студента или траекторию.");
    }
    if (!sessionMatches(readSession(), "student", studentId)) {
      throw new Error("Прохождение контроля доступно только владельцу профиля студента.");
    }

    rememberStudentId(studentId);

    let nextControl: StudentTopicControl;
    if (topicId) {
      nextControl = await fetchStudentTopicControl(
        studentId,
        trajectoryId,
        topicId,
        nextContinuePractice,
        nextSkillPractice,
        signal,
      );
    } else {
      const position = Number(topicPosition);
      if (!Number.isInteger(position) || position < 1) {
        throw new Error("Не удалось определить номер темы в траектории.");
      }
      nextControl = await fetchStudentTopicControlByPosition(
        studentId,
        trajectoryId,
        position,
        nextContinuePractice,
        nextSkillPractice,
        signal,
      );
    }

    setControl(nextControl);
    setContinuePractice(nextControl.is_extra_practice);
    setSkillPractice(nextControl.practice_stage === "can");
    setAnswer(nextControl.current_task ? emptyAnswer(nextControl.current_task) : {});
  }

  useEffect(() => {
    setContinuePractice(false);
    setSkillPractice(false);
  }, [studentId, trajectoryId, topicId, topicPosition]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        setControl(null);
        await loadControl(controller.signal, false, false);
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

  function updateTextAnswer(value: string) {
    setAnswer({ text: value });
  }

  async function submitAnswer(task: StudentAssignedTask) {
    if (!studentId) {
      setError("Не удалось определить студента.");
      return;
    }

    try {
      setSaving(true);
      setError("");
      await submitStudentTaskScore(task.id, studentId, answer, task.task_instance_id);
      await loadControl(undefined, continuePractice, skillPractice);
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function reloadCurrentState(
    nextContinuePractice = continuePractice,
    nextSkillPractice = skillPractice,
  ) {
    try {
      setLoading(true);
      setError("");
      await loadControl(undefined, nextContinuePractice, nextSkillPractice);
    } catch (refreshError) {
      setError(extractErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }

  function renderAnswer(task: StudentAssignedTask) {
    if (task.task_type === "text") {
      return (
        <div className="student-task-answer">
          {task.content.contract_title ? (
            <p className="card__text">Операция: {task.content.contract_title}</p>
          ) : null}
          {task.content.input_payload ? (
            <label className="field">
              <span>Входные данные</span>
              <textarea rows={8} value={JSON.stringify(task.content.input_payload, null, 2)} readOnly />
            </label>
          ) : null}
          <label className="field">
            <span>Ответ студента</span>
            <textarea
              rows={6}
              value={String(answer.text ?? "")}
              onChange={(event) => updateTextAnswer(event.target.value)}
              placeholder={task.content.placeholder ?? "Введите ответ"}
            />
          </label>
        </div>
      );
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

  function renderProgressNotice() {
    if (!control || !control.is_unlocked) return null;

    const canStartSkills = control.practice_stage === "know" && control.skill_practice_available;
    const nextTopicUnlocked = Boolean(control.next_topic?.is_unlocked);
    if (!canStartSkills && !control.show_next_topic_prompt && control.practice_stage !== "can") {
      return null;
    }

    const title =
      control.practice_stage === "can"
        ? "Открыт этап Уметь"
        : control.show_next_topic_prompt
          ? "Следующая тема уже открыта"
          : "Порог по Знать пройден";

    const message =
      control.practice_stage === "can"
        ? "Ты остался в текущей теме и сейчас получаешь задания уровня Уметь. Ошибка в таком задании может снизить освоение связанных элементов Знать."
        : nextTopicUnlocked && control.next_topic
          ? `По формируемым элементам Знать порог пройден. Тема «${control.next_topic.topic_name}» уже доступна, но можно остаться здесь и перейти к заданиям уровня Уметь.`
          : "По элементам Знать порог уже пройден. Можно остаться в текущей теме и перейти к заданиям уровня Уметь.";

    return (
      <div className="student-control-notice">
        <div>
          <p className="card__eyebrow">Переход между уровнями</p>
          <h3>{title}</h3>
          <p className="card__text">{message}</p>
        </div>
        <div className="student-control-notice__actions">
          {control.practice_stage === "know" && control.skill_practice_available ? (
            <button
              className="primary-button"
              type="button"
              disabled={loading || saving}
              onClick={() => void reloadCurrentState(false, true)}
            >
              Остаться и перейти к Уметь
            </button>
          ) : null}
          {control.next_topic?.is_unlocked ? (
            <button
              className="ghost-button"
              type="button"
              disabled={loading || saving}
              onClick={() =>
                navigate(buildTopicControlPath(studentId, trajectoryId, control.next_topic!.topic_id))
              }
            >
              Перейти к теме {control.next_topic.position}
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  const currentTask = control?.current_task ?? null;
  const stageLabel = control?.practice_stage === "can" ? "Уметь" : "Знать";

  return (
    <div className="immersive-page">
      <header className="student-control-header">
        <div>
          <p className="hero__eyebrow">Контроль знаний</p>
          <h1>{loading && !control ? "Загрузка темы" : control?.topic_name ?? "Тема"}</h1>
          <p className="hero__subtitle">
            Порог темы: {control?.topic_threshold ?? 0}. Текущий балл темы: {control?.topic_mastery ?? 0}.
          </p>
        </div>
        <div className="student-control-header__meta">
          <span className="hero__chip">Этап: {stageLabel}</span>
          <button className="ghost-button" type="button" onClick={() => navigate(-1)}>
            Назад
          </button>
        </div>
      </header>

      <main className="student-control-layout">
        <section className="card card--soft student-control-task">
          {renderProgressNotice()}

          {loading && !control ? (
            <div className="status-view status-view--embedded student-control-task__status">
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
              {control.is_extra_practice ? (
                <p className="card__text">
                  Включен режим дополнительной практики. Здесь можно улучшать результат выше минимального порога темы.
                </p>
              ) : null}
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
                  onClick={() => void reloadCurrentState()}
                >
                  Обновить тему
                </button>
              </div>
            </>
          ) : (
            <div className="status-view status-view--embedded status-view--empty student-control-task__status">
              <h3>Нет доступного задания</h3>
              <p>
                {control?.practice_stage === "can"
                  ? "Для текущего уровня Уметь в этой теме сейчас нет доступных заданий."
                  : control?.is_extra_practice
                    ? "Для этой темы больше не осталось подходящих заданий даже в режиме дополнительной практики."
                    : control?.has_tasks
                      ? "В обычном режиме минимальный порог уже достигнут. Можно перейти к следующей теме или остаться для дополнительной практики."
                      : "Для этой темы пока нет заданий."}
              </p>
              <div className="student-task-card__actions">
                {control?.continue_practice_available ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={loading}
                    onClick={() => void reloadCurrentState(true, skillPractice)}
                  >
                    Продолжить практику
                  </button>
                ) : null}
                {control?.practice_stage === "know" && control?.skill_practice_available ? (
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={loading}
                    onClick={() => void reloadCurrentState(false, true)}
                  >
                    Перейти к Уметь
                  </button>
                ) : null}
              </div>
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
