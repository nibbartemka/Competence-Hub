import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  fetchStudentTopicControl,
  fetchStudentTopicControlByPosition,
  isAbortError,
  submitStudentTaskFileSubmission,
  submitStudentTaskScore,
} from "./api";
import {
  buildStructuredOperationAnswerText,
  hasStructuredOperationContent,
  OperationAnswerEditor,
  OperationInputPreview,
  OperationOutputPreview,
} from "./components/OperationTaskSchemaViews";
import StudentTaskDebugAnswerModal from "./components/StudentTaskDebugAnswerModal";
import { getSessionHomePath, readSession, sessionMatches } from "./session";
import type { StudentAssignedTask, StudentTopicControl } from "./types";

const LAST_STUDENT_STORAGE_KEY = "competence-hub:last-student-id";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function formatDuration(totalSeconds: number) {
  const safeSeconds = Math.max(0, totalSeconds);
  const minutes = Math.floor(safeSeconds / 60);
  const seconds = safeSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function estimateExpectedDurationSeconds(
  task: StudentAssignedTask,
  practiceStage: "know" | "can" | "master",
) {
  if (practiceStage === "master") {
    return null;
  }
  const baseByType =
    practiceStage === "can"
      ? {
          single_choice: 45,
          multiple_choice: 70,
          matching: 95,
          ordering: 120,
          text: 180,
        }
      : {
          single_choice: 20,
          multiple_choice: 35,
          matching: 50,
          ordering: 65,
          text: 120,
        };
  const difficultyFactor = practiceStage === "can" ? 1.2 : 0.8;
  return Math.max(15, Math.ceil((baseByType[task.task_type] ?? 30) + task.difficulty * difficultyFactor));
}

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

function isManualMasterTask(task: StudentAssignedTask) {
  return (
    task.task_type === "text" &&
    task.content.manual_review === true &&
    task.content.submission_kind === "file"
  );
}

function extractSubmittedFileMeta(task: StudentAssignedTask) {
  const payload = task.progress.last_answer_payload;
  if (!payload || payload.submission_kind !== "file") {
    return null;
  }
  return {
    originalName: String(payload.original_name ?? ""),
    uploadedAt: String(payload.uploaded_at ?? ""),
  };
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
  const [notice, setNotice] = useState("");
  const [continuePractice, setContinuePractice] = useState(false);
  const [practiceStage, setPracticeStage] = useState<"know" | "can" | "master">("know");
  const [debugTask, setDebugTask] = useState<StudentAssignedTask | null>(null);
  const [submissionFile, setSubmissionFile] = useState<File | null>(null);
  const [elementsExpanded, setElementsExpanded] = useState(false);
  const [taskStartedAt, setTaskStartedAt] = useState<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const currentTask = control?.current_task ?? null;

  useEffect(() => {
    const activeSession = readSession();
    if (!sessionMatches(activeSession, "student", studentId)) {
      navigate(getSessionHomePath(activeSession), { replace: true });
    }
  }, [navigate, studentId]);

  async function loadControl(
    signal?: AbortSignal,
    nextContinuePractice = continuePractice,
    nextPracticeStage = practiceStage,
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
        nextPracticeStage,
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
        nextPracticeStage,
        signal,
      );
    }

    setControl(nextControl);
    setContinuePractice(nextControl.is_extra_practice);
    setPracticeStage(nextControl.practice_stage);
    setAnswer(nextControl.current_task ? emptyAnswer(nextControl.current_task) : {});
    setSubmissionFile(null);
  }

  useEffect(() => {
    setContinuePractice(false);
    setPracticeStage("know");
  }, [studentId, trajectoryId, topicId, topicPosition]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        setNotice("");
        setControl(null);
        await loadControl(controller.signal, false, "know");
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

  useEffect(() => {
    setElementsExpanded(false);
  }, [control?.topic_id]);

  useEffect(() => {
    if (!currentTask?.task_instance_id) {
      setTaskStartedAt(null);
      setElapsedSeconds(0);
      return;
    }
    const startedAt = Date.now();
    setTaskStartedAt(startedAt);
    setElapsedSeconds(0);
  }, [currentTask?.task_instance_id]);

  useEffect(() => {
    if (!taskStartedAt || !currentTask) {
      return;
    }
    const intervalId = window.setInterval(() => {
      setElapsedSeconds(Math.max(0, Math.round((Date.now() - taskStartedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(intervalId);
  }, [taskStartedAt, currentTask]);

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

    const durationSeconds =
      practiceStage !== "master" && taskStartedAt !== null
        ? Math.max(1, Math.round((Date.now() - taskStartedAt) / 1000))
        : null;
    try {
      setSaving(true);
      setError("");
      setNotice("");
      if (isManualMasterTask(task)) {
        if (!submissionFile) {
          throw new Error("Сначала прикрепи файл с решением.");
        }
        await submitStudentTaskFileSubmission(
          task.id,
          studentId,
          submissionFile,
          task.task_instance_id,
          durationSeconds,
        );
        await loadControl(undefined, continuePractice, practiceStage);
        const teacherName = task.teacher_name?.trim();
        setNotice(
          teacherName
            ? `Работа отправлена на проверку преподавателю: ${teacherName}.`
            : "Работа отправлена на проверку вашему преподавателю.",
        );
        return;
      }
      const nextAnswer =
        task.task_type === "text" && hasStructuredOperationContent(task.content)
          ? {
              text: buildStructuredOperationAnswerText(answer, task.content),
            }
          : answer;
      await submitStudentTaskScore(
        task.id,
        studentId,
        nextAnswer,
        task.task_instance_id,
        durationSeconds,
      );
      await loadControl(undefined, continuePractice, practiceStage);
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function reloadCurrentState(
    nextContinuePractice = continuePractice,
    nextPracticeStage = practiceStage,
  ) {
    try {
      setLoading(true);
      setError("");
      setNotice("");
      await loadControl(undefined, nextContinuePractice, nextPracticeStage);
    } catch (refreshError) {
      setError(extractErrorMessage(refreshError));
    } finally {
      setLoading(false);
    }
  }

  function renderAnswer(task: StudentAssignedTask) {
    if (task.task_type === "text") {
      if (isManualMasterTask(task)) {
        const submittedFile = extractSubmittedFileMeta(task);
        return (
          <div className="student-task-answer">
            <div className="teacher-review-checklist">
              <div className="teacher-review-checklist__section">
                <span className="card__eyebrow">Предметная область</span>
                <p>{task.content.manual_review_context?.subject_area_description || "Не заполнена."}</p>
              </div>
            </div>
            <label className="field">
              <span>Файл решения</span>
              <input
                type="file"
                disabled={saving || task.progress.status === "pending_review"}
                onChange={(event) => setSubmissionFile(event.target.files?.[0] ?? null)}
              />
            </label>
            {submissionFile ? (
              <p className="card__text">Выбран файл: {submissionFile.name}</p>
            ) : null}
            {submittedFile?.originalName ? (
              <p className="card__text">
                Последняя отправка: {submittedFile.originalName}
                {task.progress.status === "pending_review" ? " · ждёт проверки преподавателем" : ""}
              </p>
            ) : null}
          </div>
        );
      }
      const hasStructuredContent = hasStructuredOperationContent(task.content);
      const answerText = buildStructuredOperationAnswerText(answer, task.content);
      return (
        <div className="student-task-answer">
          {task.content.contract_title ? (
            <p className="card__text">Операция: {task.content.contract_title}</p>
          ) : null}
          <OperationInputPreview payload={task.content.input_payload} schema={task.content.input_schema} />
          {hasStructuredContent ? <OperationOutputPreview content={task.content} /> : null}
          {hasStructuredContent ? (
            <OperationAnswerEditor
              inputPayload={task.content.input_payload}
              onChangeText={updateTextAnswer}
              schema={task.content.output_schema}
              valueText={answerText}
            />
          ) : null}
          {hasStructuredContent ? (
            <textarea
              className="visually-hidden"
              aria-hidden="true"
              disabled
              rows={6}
              value={answerText}
              onChange={() => undefined}
              placeholder={task.content.placeholder ?? "Введите ответ"}
            />
          ) : (
            <label className="field">
              <span>Ответ студента</span>
              <textarea
                rows={6}
                value={String(answer.text ?? "")}
                onChange={(event) => updateTextAnswer(event.target.value)}
                placeholder={task.content.placeholder ?? "Введите ответ"}
              />
            </label>
          )}
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
    const canStartMaster = control.practice_stage === "can" && control.master_practice_available;
    const nextTopicUnlocked = Boolean(control.next_topic?.is_unlocked);
    if (
      !canStartSkills &&
      !canStartMaster &&
      !control.show_next_topic_prompt &&
      control.practice_stage === "know"
    ) {
      return null;
    }

    const title =
      control.practice_stage === "master"
        ? "Открыт этап Владеть"
        : control.practice_stage === "can" && canStartMaster
          ? "Порог по Уметь пройден"
          : control.practice_stage === "can"
            ? "Открыт этап Уметь"
        : control.show_next_topic_prompt
          ? "Следующая тема уже открыта"
          : "Порог по Знать пройден";

    const message =
      control.practice_stage === "master"
        ? "Ты остался в текущей теме и сейчас получаешь задания уровня Владеть. Решение отправляется файлом и проверяется преподавателем вручную."
        : control.practice_stage === "can" && canStartMaster
          ? "По элементам Уметь порог уже пройден. Можно остаться в текущей теме и перейти к заданиям уровня Владеть."
        : control.practice_stage === "can"
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
              onClick={() => void reloadCurrentState(false, "can")}
            >
              Остаться и перейти к Уметь
            </button>
          ) : null}
          {control.practice_stage === "can" && control.master_practice_available ? (
            <button
              className="primary-button"
              type="button"
              disabled={loading || saving}
              onClick={() => void reloadCurrentState(false, "master")}
            >
              Остаться и перейти к Владеть
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

  const topicElements = control?.elements ?? [];
  const canToggleElements = topicElements.length > 6;
  const visibleElements = elementsExpanded ? topicElements : topicElements.slice(0, 6);
  const adaptiveStatus = control?.adaptive_status ?? null;
  const expectedDurationSeconds =
    adaptiveStatus?.expected_duration_seconds ??
    (currentTask ? estimateExpectedDurationSeconds(currentTask, control?.practice_stage ?? "know") : null);
  const durationSignalsEnabled = (control?.practice_stage ?? "know") !== "master";
  const currentDurationLimitSeconds =
    durationSignalsEnabled && expectedDurationSeconds !== null
      ? Math.max(expectedDurationSeconds, Math.round(expectedDurationSeconds * 1.6))
      : null;
  const durationProgressPercent =
    currentDurationLimitSeconds && currentDurationLimitSeconds > 0
      ? Math.min(100, Math.round((elapsedSeconds / currentDurationLimitSeconds) * 100))
      : 0;
  const durationTone =
    expectedDurationSeconds === null
      ? "steady"
      : elapsedSeconds <= expectedDurationSeconds
        ? "steady"
        : elapsedSeconds <= Math.round(expectedDurationSeconds * 1.6)
          ? "warning"
          : "critical";
  const feedbackRecord = isRecord(currentTask?.progress.last_feedback)
    ? currentTask.progress.last_feedback
    : null;
  const feedbackMessage = feedbackRecord
    ? String(feedbackRecord.message ?? feedbackRecord.summary ?? "")
    : "";
  const feedbackAdaptiveSignal = feedbackRecord && isRecord(feedbackRecord.adaptive_signal)
    ? feedbackRecord.adaptive_signal
    : null;
  const signalKind =
    typeof adaptiveStatus?.signal_kind === "string"
      ? adaptiveStatus.signal_kind
      : typeof feedbackAdaptiveSignal?.kind === "string"
        ? feedbackAdaptiveSignal.kind
        : null;
  const routeSignalLabel =
    signalKind === "error"
      ? "После ошибки"
      : signalKind === "fragile_success"
        ? "Медленный верный ответ"
        : control?.is_extra_practice
          ? "Доп. практика"
          : "Стандартный отбор";
  const adaptiveTitleText =
    signalKind === "error"
      ? "Маршрут изменен после ошибки"
      : signalKind === "fragile_success"
        ? "Маршрут изменен после медленного ответа"
        : adaptiveStatus?.title ?? "Маршрут контроля формируется";
  const adaptiveSummaryText =
    signalKind === "error"
      ? "После неверного ответа система изменила маршрут и дала следующий шаг глубже по этой же зоне, чтобы понять, была ли ошибка случайной или это реальный пробел в знании."
      : signalKind === "fragile_success"
        ? "Прошлый ответ был верным, но слишком медленным, поэтому система добавила подтверждающий шаг, чтобы проверить устойчивость знания."
        : adaptiveStatus?.summary ??
          "Система анализирует текущий прогресс, историю ответов и выбирает следующий шаг контроля.";
  const stageLabel =
    control?.practice_stage === "master"
      ? "Владеть"
      : control?.practice_stage === "can"
        ? "Уметь"
        : "Знать";

  return (
    <div className="immersive-page">
      <header className="student-control-header">
        <div>
          <p className="hero__eyebrow">Контроль знаний</p>
          <h1>{loading && !control ? "Загрузка темы" : control?.topic_name ?? "Тема"}</h1>
          <p className="hero__subtitle">
            Текущий балл темы: {control?.topic_mastery ?? 0}.
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
              {notice ? <div className="student-task-card__feedback">{notice}</div> : null}
              <div className="student-control-task__task-topline">
                <span className="hero__chip">{TASK_TYPE_LABELS[currentTask.task_type]}</span>
              </div>
              <p className="student-control-task__prompt">{currentTask.prompt}</p>
              {feedbackMessage ? <div className="student-task-card__feedback">{feedbackMessage}</div> : null}
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
                  onClick={() => setDebugTask(currentTask)}
                >
                  Показать эталон
                </button>
              </div>
            </>
          ) : (
            <div className="status-view status-view--embedded status-view--empty student-control-task__status">
              <h3>Нет доступного задания</h3>
              <p>
                {control?.practice_stage === "can"
                  ? "Для текущего уровня Уметь в этой теме сейчас нет доступных заданий."
                  : control?.practice_stage === "master"
                    ? "Для текущего уровня Владеть в этой теме сейчас нет доступных заданий."
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
                    onClick={() => void reloadCurrentState(true, practiceStage)}
                  >
                    Продолжить практику
                  </button>
                ) : null}
                {control?.practice_stage === "know" && control?.skill_practice_available ? (
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={loading}
                    onClick={() => void reloadCurrentState(false, "can")}
                  >
                    Перейти к Уметь
                  </button>
                ) : null}
                {control?.practice_stage === "can" && control?.master_practice_available ? (
                  <button
                    className="ghost-button"
                    type="button"
                    disabled={loading}
                    onClick={() => void reloadCurrentState(false, "master")}
                  >
                    Перейти к Владеть
                  </button>
                ) : null}
              </div>
            </div>
          )}
          <div className="student-control-adaptive-panel student-control-adaptive-panel--horizontal">
            <div className="student-control-adaptive-panel__header">
              <div>
                <p className="card__eyebrow">Статус адаптации</p>
                <h3>{adaptiveStatus?.title ?? "Маршрут контроля формируется"}</h3>
              </div>
              <span className={`student-control-adaptive-panel__chip student-control-adaptive-panel__chip--${durationTone}`}>
                {control?.is_extra_practice ? "Доп. практика" : `Этап: ${stageLabel}`}
              </span>
            </div>
            <p className="student-control-adaptive-panel__summary">
              {adaptiveStatus?.summary ??
                "Система анализирует текущий прогресс, историю ответов и выбирает следующий шаг контроля."}
            </p>
            {signalKind ? (
              <div className={`student-control-adaptive-panel__route student-control-adaptive-panel__route--${signalKind}`}>
                <strong>{adaptiveTitleText}</strong>
                <span>{adaptiveSummaryText}</span>
              </div>
            ) : null}
            {durationSignalsEnabled ? (
              <>
                <div className="student-control-adaptive-panel__metrics">
                  <div className="student-control-adaptive-panel__metric">
                    <span>Таймер текущего ответа</span>
                    <strong>{formatDuration(elapsedSeconds)}</strong>
                  </div>
                  <div className="student-control-adaptive-panel__metric">
                    <span>Ожидаемое время</span>
                    <strong>{expectedDurationSeconds !== null ? formatDuration(expectedDurationSeconds) : "-"}</strong>
                  </div>
                </div>
                <div className="student-control-adaptive-panel__timeline">
                  <div className="student-control-adaptive-panel__timeline-bar">
                    <i
                      className={`student-control-adaptive-panel__timeline-fill student-control-adaptive-panel__timeline-fill--${durationTone}`}
                      style={{ width: `${durationProgressPercent}%` }}
                    />
                  </div>
                  <div className="student-control-adaptive-panel__timeline-labels">
                    <span>Старт</span>
                    <span>
                      {currentDurationLimitSeconds !== null ? formatDuration(currentDurationLimitSeconds) : "Без лимита"}
                    </span>
                  </div>
                </div>
              </>
            ) : null}
            <div className="student-control-adaptive-panel__notes">
              <div className={`student-control-adaptive-panel__note student-control-adaptive-panel__note--${durationTone}`}>
                {durationSignalsEnabled
                  ? durationTone === "steady"
                    ? "Ответ идет в ожидаемом темпе."
                    : durationTone === "warning"
                      ? "Ответ уже дольше ожидаемого, но пока в допустимой зоне."
                      : "Ответ заметно дольше нормы. Если он будет верным, система может выдать дополнительную проверку."
                  : "На этапе «Владеть» время ответа не влияет на адаптацию и не меняет маршрут контроля."}
              </div>
              {durationSignalsEnabled &&
              adaptiveStatus?.last_duration_seconds !== null &&
              adaptiveStatus?.last_duration_seconds !== undefined ? (
                <div className="student-control-adaptive-panel__note">
                  Прошлая зафиксированная попытка заняла {formatDuration(adaptiveStatus.last_duration_seconds)}
                  {adaptiveStatus.expected_duration_seconds
                    ? ` при ориентире ${formatDuration(adaptiveStatus.expected_duration_seconds)}.`
                    : "."}
                </div>
              ) : null}
            </div>
          </div>
        </section>

        <aside className="card card--soft student-control-panel">
          <div className="student-control-adaptive-panel">
            <div className="student-control-adaptive-panel__header">
              <div>
                <p className="card__eyebrow">Статус адаптации</p>
                <h3>{adaptiveStatus?.title ?? "Маршрут контроля формируется"}</h3>
              </div>
              <span className={`student-control-adaptive-panel__chip student-control-adaptive-panel__chip--${durationTone}`}>
                {control?.is_extra_practice ? "Доп. практика" : `Этап: ${stageLabel}`}
              </span>
            </div>
            <p className="student-control-adaptive-panel__summary">
              {adaptiveStatus?.summary ??
                "Система анализирует текущий прогресс, историю ответов и выбирает следующий шаг контроля."}
            </p>
            {signalKind ? (
              <div className={`student-control-adaptive-panel__route student-control-adaptive-panel__route--${signalKind}`}>
                <strong>{adaptiveTitleText}</strong>
                <span>{adaptiveSummaryText}</span>
              </div>
            ) : null}
            <div className="student-control-adaptive-panel__metrics">
              <div className="student-control-adaptive-panel__metric">
                <span>Таймер текущего ответа</span>
                <strong>{formatDuration(elapsedSeconds)}</strong>
              </div>
              <div className="student-control-adaptive-panel__metric">
                <span>Ожидаемое время</span>
                <strong>{expectedDurationSeconds !== null ? formatDuration(expectedDurationSeconds) : "-"}</strong>
              </div>
              <div className="student-control-adaptive-panel__metric">
                <span>Приоритет выбора</span>
                <strong>
                  {adaptiveStatus?.recommendation_score !== null && adaptiveStatus?.recommendation_score !== undefined
                    ? `${Math.round(adaptiveStatus.recommendation_score * 100)}%`
                    : "-"}
                </strong>
              </div>
            </div>
            <div className="student-control-adaptive-panel__timeline">
              <div className="student-control-adaptive-panel__timeline-bar">
                <i
                  className={`student-control-adaptive-panel__timeline-fill student-control-adaptive-panel__timeline-fill--${durationTone}`}
                  style={{ width: `${durationProgressPercent}%` }}
                />
              </div>
              <div className="student-control-adaptive-panel__timeline-labels">
                <span>Старт</span>
                <span>
                  {currentDurationLimitSeconds !== null ? formatDuration(currentDurationLimitSeconds) : "Без лимита"}
                </span>
              </div>
            </div>
            <div className="student-control-adaptive-panel__notes">
              <div className={`student-control-adaptive-panel__note student-control-adaptive-panel__note--${durationTone}`}>
                {durationTone === "steady"
                  ? "Ответ идет в ожидаемом темпе."
                  : durationTone === "warning"
                    ? "Ответ уже дольше ожидаемого, но пока в допустимой зоне."
                    : "Ответ заметно дольше нормы. Если он будет верным, система может выдать дополнительную проверку."}
              </div>
              {adaptiveStatus?.last_duration_seconds !== null && adaptiveStatus?.last_duration_seconds !== undefined ? (
                <div className="student-control-adaptive-panel__note">
                  Прошлая зафиксированная попытка заняла {formatDuration(adaptiveStatus.last_duration_seconds)}
                  {adaptiveStatus.expected_duration_seconds
                    ? ` при ориентире ${formatDuration(adaptiveStatus.expected_duration_seconds)}.`
                    : "."}
                </div>
              ) : null}
            </div>
          </div>
          <div className="student-control-panel__header">
            <h3>Элементы темы</h3>
            {canToggleElements ? (
              <button
                className="ghost-button student-control-panel__toggle"
                type="button"
                onClick={() => setElementsExpanded((current) => !current)}
              >
                {elementsExpanded ? "Свернуть" : "Развернуть"}
              </button>
            ) : null}
          </div>
          <p className="student-control-panel__summary">Всего элементов: {topicElements.length}</p>
          {loading && !control ? (
            <p className="card__text">Загружаю элементы темы...</p>
          ) : (
            visibleElements.map((element) => (
              <div className="mastery-row" key={element.element_id}>
                <div>
                  <strong>{element.name}</strong>
                  <span>Порог {element.threshold}</span>
                </div>
                <span>{element.mastery_value}</span>
              </div>
            ))
          )}
          {canToggleElements ? (
            <p className="student-control-panel__summary student-control-panel__summary--muted">
              {elementsExpanded
                ? "Список открыт полностью."
                : `Показаны первые ${visibleElements.length} из ${topicElements.length}.`}
            </p>
          ) : null}
        </aside>
      </main>

      <StudentTaskDebugAnswerModal onClose={() => setDebugTask(null)} task={debugTask} />
    </div>
  );
}
