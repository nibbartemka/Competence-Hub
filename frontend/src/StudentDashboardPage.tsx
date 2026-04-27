import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplines,
  fetchGroups,
  fetchRecommendedStudentTask,
  fetchStudentLearningTrajectories,
  fetchStudentTasks,
  fetchStudents,
  fetchSubgroups,
  isAbortError,
  submitStudentTaskScore,
} from "./api";
import { revealMotion } from "./motionPresets";
import type {
  Discipline,
  Group,
  LearningTrajectory,
  Student,
  StudentAssignedTask,
  Subgroup,
} from "./types";

const MotionLink = motion(Link);

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось загрузить страницу студента.";
}

function buildTaskAnswerDraft(task: StudentAssignedTask) {
  if (task.progress.last_answer_payload) {
    return task.progress.last_answer_payload;
  }

  if (task.task_type === "single_choice" || task.task_type === "multiple_choice") {
    return { selected_option_ids: [] as string[] };
  }
  if (task.task_type === "matching") {
    return { pairings: [] as Array<{ left_id: string; right_id: string }> };
  }
  return { text: "" };
}

function trajectoryProgress(trajectory: LearningTrajectory, tasks: StudentAssignedTask[]) {
  const trajectoryTasks = tasks.filter((task) => task.trajectory_id === trajectory.id);
  const totalTaskCount = trajectoryTasks.length;
  const completedTaskCount = trajectoryTasks.filter(
    (task) => task.progress.status === "completed",
  ).length;
  const percent = totalTaskCount ? Math.round((completedTaskCount / totalTaskCount) * 100) : 0;
  const currentTask = trajectoryTasks.find((task) => task.progress.status !== "completed") ?? null;

  return {
    totalTaskCount,
    completedTaskCount,
    percent,
    currentTask,
  };
}

function statusLabel(status: StudentAssignedTask["progress"]["status"]) {
  if (status === "completed") return "выполнено";
  if (status === "in_progress") return "в процессе";
  return "не начато";
}

export default function StudentDashboardPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [trajectories, setTrajectories] = useState<LearningTrajectory[]>([]);
  const [tasks, setTasks] = useState<StudentAssignedTask[]>([]);
  const [recommendedTask, setRecommendedTask] = useState<StudentAssignedTask | null>(null);
  const [taskAnswers, setTaskAnswers] = useState<Record<string, Record<string, unknown>>>({});
  const [loading, setLoading] = useState(true);
  const [savingTaskId, setSavingTaskId] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!studentId) return;
    const currentStudentId = studentId;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [nextStudents, nextGroups, nextDisciplines] = await Promise.all([
          fetchStudents(controller.signal),
          fetchGroups(controller.signal),
          fetchDisciplines(controller.signal),
        ]);

        const nextStudent = nextStudents.find((item) => item.id === currentStudentId);
        let nextTrajectories: LearningTrajectory[] = [];
        let nextTasks: StudentAssignedTask[] = [];
        let nextRecommendedTask: StudentAssignedTask | null = null;

        if (nextStudent) {
          try {
            const [loadedTrajectories, loadedTasks, loadedRecommendedTask] = await Promise.all([
              fetchStudentLearningTrajectories(currentStudentId, controller.signal),
              fetchStudentTasks(currentStudentId, controller.signal),
              fetchRecommendedStudentTask(currentStudentId, controller.signal),
            ]);
            nextTrajectories = loadedTrajectories;
            nextTasks = loadedTasks;
            nextRecommendedTask = loadedRecommendedTask;
          } catch (trajectoryError) {
            if (!isAbortError(trajectoryError)) {
              setError("Профиль загружен, но траектории и задания получить не удалось.");
            }
          }
        }

        const nextSubgroups = (
          await Promise.all(nextGroups.map((group) => fetchSubgroups(group.id, controller.signal)))
        ).flat();

        setStudents(nextStudents);
        setGroups(nextGroups);
        setDisciplines(nextDisciplines);
        setTrajectories(nextTrajectories);
        setTasks(nextTasks);
        setRecommendedTask(nextRecommendedTask);
        setSubgroups(nextSubgroups);
        setTaskAnswers(
          Object.fromEntries(nextTasks.map((task) => [task.id, buildTaskAnswerDraft(task)])),
        );

        if (!nextStudent) {
          setError("Студент не найден.");
        }
      } catch (loadError) {
        if (!isAbortError(loadError)) {
          setError(extractErrorMessage(loadError));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [studentId]);

  const student = students.find((item) => item.id === studentId);
  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const subgroupById = useMemo(
    () => new Map(subgroups.map((subgroup) => [subgroup.id, subgroup])),
    [subgroups],
  );
  const disciplineById = useMemo(
    () => new Map(disciplines.map((discipline) => [discipline.id, discipline])),
    [disciplines],
  );

  const totalTasksCount = tasks.length;
  const completedTasksCount = tasks.filter((task) => task.progress.status === "completed").length;

  function updateTaskAnswer(taskId: string, nextValue: Record<string, unknown>) {
    setTaskAnswers((current) => ({ ...current, [taskId]: nextValue }));
  }

  function toggleChoiceOption(task: StudentAssignedTask, optionId: string, checked: boolean) {
    const currentAnswer = taskAnswers[task.id] ?? buildTaskAnswerDraft(task);
    const currentIds = Array.isArray(currentAnswer.selected_option_ids)
      ? (currentAnswer.selected_option_ids as string[])
      : [];

    if (task.task_type === "single_choice") {
      updateTaskAnswer(task.id, { selected_option_ids: checked ? [optionId] : [] });
      return;
    }

    const nextIds = checked
      ? [...new Set([...currentIds, optionId])]
      : currentIds.filter((item) => item !== optionId);
    updateTaskAnswer(task.id, { selected_option_ids: nextIds });
  }

  function updateMatchingAnswer(taskId: string, leftId: string, rightId: string) {
    const currentAnswer = taskAnswers[taskId] ?? { pairings: [] };
    const currentPairings = Array.isArray(currentAnswer.pairings)
      ? (currentAnswer.pairings as Array<{ left_id: string; right_id: string }>)
      : [];
    const nextPairings = [
      ...currentPairings.filter((pairing) => pairing.left_id !== leftId),
      { left_id: leftId, right_id: rightId },
    ];
    updateTaskAnswer(taskId, { pairings: nextPairings });
  }

  async function handleSubmitTaskAnswer(task: StudentAssignedTask) {
    if (!studentId) return;

    try {
      setSavingTaskId(task.id);
      setError("");
      const updatedTask = await submitStudentTaskScore(
        task.id,
        studentId,
        taskAnswers[task.id] ?? buildTaskAnswerDraft(task),
      );

      setTasks((current) =>
        current.map((currentTask) => (currentTask.id === updatedTask.id ? updatedTask : currentTask)),
      );
      setTaskAnswers((current) => ({
        ...current,
        [task.id]: buildTaskAnswerDraft(updatedTask),
      }));
      setRecommendedTask(await fetchRecommendedStudentTask(studentId));
    } catch (submitError) {
      setError(extractErrorMessage(submitError));
    } finally {
      setSavingTaskId("");
    }
  }

  function renderTaskAnswerEditor(task: StudentAssignedTask) {
    const answer = taskAnswers[task.id] ?? buildTaskAnswerDraft(task);

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
                onChange={(event) => toggleChoiceOption(task, option.id, event.target.checked)}
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
                onChange={(event) => updateMatchingAnswer(task.id, item.id, event.target.value)}
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
        <label className="field">
          <span>Ответ</span>
          <textarea
            rows={4}
            value={String(answer.text ?? "")}
            onChange={(event) => updateTaskAnswer(task.id, { text: event.target.value })}
            placeholder={task.content.placeholder || "Напиши ответ"}
          />
        </label>
      </div>
    );
  }

  if (!studentId) return null;

  return (
    <div className="page-shell immersive-page immersive-page--student">
      <div className="student-dashboard-shell">
        <motion.header className="student-dashboard-header" {...revealMotion(0.02)}>
          <div className="student-dashboard-header__brand">
            <p className="hero__eyebrow">Competence Hub</p>
            <h1>Кабинет студента</h1>
            <p className="hero__subtitle">
              Назначенные траектории, текущий этап и доступ к прохождению через граф темы.
            </p>
          </div>

          <div className="student-dashboard-header__profile">
            <button className="ghost-button" onClick={() => navigate("/")} type="button">
              На главную
            </button>
            <div className="student-profile-compact">
              <span className="student-profile-compact__label">Профиль</span>
              <strong>{student?.name ?? "Студент"}</strong>
              <small>
                {student ? groupById.get(student.group_id)?.name ?? "Группа не найдена" : "Группа не найдена"}
              </small>
              <small>
                {student?.subgroup_id
                  ? `Подгруппа ${subgroupById.get(student.subgroup_id)?.subgroup_num ?? "?"}`
                  : "Подгруппа не назначена"}
              </small>
            </div>
          </div>
        </motion.header>

        {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

        {loading ? (
          <section className="status-view immersive-page__status">
            <div className="status-view__pulse" />
            <h3>Загружаю страницу студента</h3>
          </section>
        ) : (
          <main className="student-dashboard-main">
            <motion.section className="card card--soft student-dashboard-summary" {...revealMotion(0.05)}>
              <div className="student-dashboard-summary__stats">
                <article className="student-metric-card">
                  <span>Траектории</span>
                  <strong>{trajectories.length}</strong>
                </article>
                <article className="student-metric-card">
                  <span>Задания</span>
                  <strong>{totalTasksCount}</strong>
                </article>
                <article className="student-metric-card">
                  <span>Выполнено</span>
                  <strong>{completedTasksCount}</strong>
                </article>
              </div>
              <p className="card__text">
                Выбери траекторию ниже. Задания открываются уже внутри графа выбранной траектории
                после клика по теме.
              </p>
            </motion.section>

            <motion.section className="card card--soft student-dashboard-trajectories" {...revealMotion(0.08)}>
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Траектории</p>
                  <h2>Доступные траектории обучения</h2>
                </div>
              </div>

              <div className="student-trajectory-grid">
                {trajectories.length ? (
                  trajectories.map((trajectory) => {
                    const progress = trajectoryProgress(trajectory, tasks);
                    const discipline = disciplineById.get(trajectory.discipline_id);

                    return (
                      <MotionLink
                        className="student-trajectory-card"
                        key={trajectory.id}
                        to={`/disciplines/${trajectory.discipline_id}/trajectories/${trajectory.id}?preview=student&student=${studentId}`}
                        {...revealMotion(0.02, 12)}
                      >
                        <div className="student-trajectory-card__head">
                          <div>
                            <strong>{trajectory.name}</strong>
                            <span>{discipline?.name ?? "Дисциплина не найдена"}</span>
                          </div>
                          <span className="hero__chip">{trajectory.topics.length} тем</span>
                        </div>

                        <p className="card__text">
                          {progress.currentTask
                            ? `Сейчас доступна тема: ${progress.currentTask.topic_name}.`
                            : progress.totalTaskCount
                              ? "Все текущие задания по этой траектории выполнены."
                              : "Траектория назначена, но задания пока не добавлены."}
                        </p>

                        <div className="student-progress" aria-label="Прогресс прохождения">
                          <div className="student-progress__bar">
                            <i style={{ width: `${progress.percent}%` }} />
                          </div>
                          <span>Прогресс: {progress.percent}%</span>
                          <span>
                            Выполнено {progress.completedTaskCount} из {Math.max(progress.totalTaskCount, 0)} заданий
                          </span>
                        </div>

                        <div className="student-trajectory-card__footer">
                          <span>Открыть граф траектории</span>
                        </div>
                      </MotionLink>
                    );
                  })
                ) : (
                  <p className="card__text">Для студента пока нет активных траекторий.</p>
                )}
              </div>
            </motion.section>
          </main>
        )}
      </div>
    </div>
  );
}
