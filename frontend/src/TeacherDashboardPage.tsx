import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  deleteTeacher,
  fetchDisciplines,
  fetchGroups,
  fetchLearningTrajectories,
  fetchStudentTasks,
  fetchStudentsByGroup,
  fetchSubgroups,
  fetchTeacher,
  fetchTeachers,
  isAbortError,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import { actionHoverMotion, revealMotion } from "./motionPresets";
import { getSessionHomePath, readSession, sessionMatches } from "./session";
import type {
  Discipline,
  Group,
  LearningTrajectorySummary,
  Student,
  StudentAssignedTask,
  Subgroup,
  Teacher,
} from "./types";

const MotionLink = motion(Link);

const trajectoryStatusLabel: Record<LearningTrajectorySummary["status"], string> = {
  draft: "Черновик",
  active: "Активна",
  archived: "Архив",
};

const PANEL_ORDER = [
  "disciplines",
  "groups",
  "summary",
  "trajectories",
] as const;

type TeacherPanelKey = (typeof PANEL_ORDER)[number];

type StudentTaskSnapshot = {
  student: Student;
  trajectory: LearningTrajectorySummary;
  tasks: StudentAssignedTask[];
};

type StudentSummaryRow = {
  student: Student;
  totalTasks: number;
  startedTasks: number;
  completedTasks: number;
  pendingReviewTasks: number;
  averageScore: number | null;
  progressPercent: number;
  attentionScore: number;
};

type TaskDifficultyRow = {
  id: string;
  title: string;
  topicName: string;
  trajectoryName: string;
  assignedCount: number;
  startedCount: number;
  pendingReviewCount: number;
  completionPercent: number;
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Не удалось загрузить кабинет преподавателя.";
}

function getDisciplinePath(discipline: Discipline | undefined, fallbackId: string) {
  return disciplinePathValue(discipline, discipline?.id ?? fallbackId);
}

function matchesTrajectoryStudent(trajectory: LearningTrajectorySummary, student: Student) {
  if (trajectory.group_id && trajectory.group_id !== student.group_id) {
    return false;
  }
  if (trajectory.subgroup_id && trajectory.subgroup_id !== student.subgroup_id) {
    return false;
  }
  return true;
}

function studentHasStartedTask(task: StudentAssignedTask) {
  return (
    task.progress.status !== "not_started" ||
    task.progress.attempts_count > 0 ||
    Boolean(task.progress.last_answer_payload)
  );
}

function toPercent(value: number, total: number) {
  if (!total) {
    return 0;
  }
  return Math.round((value / total) * 100);
}

function average(values: number[]) {
  if (!values.length) {
    return null;
  }
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

export default function TeacherDashboardPage() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const isAdminViewer = searchParams.get("viewer") === "admin" && readSession()?.role === "admin";

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [trajectories, setTrajectories] = useState<LearningTrajectorySummary[]>([]);
  const [taskSnapshots, setTaskSnapshots] = useState<StudentTaskSnapshot[]>([]);
  const [selectedDisciplineId, setSelectedDisciplineId] = useState("");
  const [activePanel, setActivePanel] = useState<TeacherPanelKey>("disciplines");
  const [loading, setLoading] = useState(true);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState("");
  const [summaryError, setSummaryError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const activeSession = readSession();
    if (!isAdminViewer && !sessionMatches(activeSession, "teacher", teacherId)) {
      navigate(getSessionHomePath(activeSession), { replace: true });
    }
  }, [isAdminViewer, navigate, teacherId]);

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [nextTeacher, nextDisciplines, nextGroups] = await Promise.all([
          teacherId
            ? fetchTeacher(teacherId, controller.signal)
            : fetchTeachers(controller.signal).then((items) => items[0] ?? null),
          fetchDisciplines(controller.signal),
          fetchGroups(controller.signal),
        ]);

        const nextTeacherId = nextTeacher?.id ?? teacherId ?? "";
        const [nextStudents, nextSubgroups, nextTrajectories] = nextTeacher
          ? await Promise.all([
              Promise.all(
                nextTeacher.group_ids.map((groupId) =>
                  fetchStudentsByGroup(groupId, controller.signal),
                ),
              ).then((items) => items.flat()),
              Promise.all(
                nextTeacher.group_ids.map((groupId) => fetchSubgroups(groupId, controller.signal)),
              ).then((items) => items.flat()),
              fetchLearningTrajectories({ teacher_id: nextTeacherId }, controller.signal),
            ])
          : [[], [], [] as LearningTrajectorySummary[]];

        if (controller.signal.aborted) {
          return;
        }

        const teacherDisciplineIds = new Set(nextTeacher?.discipline_ids ?? []);
        const firstDiscipline = nextDisciplines.find(
          (discipline) =>
            teacherDisciplineIds.has(discipline.id) ||
            discipline.teacher_ids.includes(nextTeacherId),
        );

        setTeacher(nextTeacher);
        setDisciplines(nextDisciplines);
        setGroups(nextGroups);
        setStudents(nextStudents);
        setSubgroups(nextSubgroups);
        setTrajectories(nextTrajectories);
        setSelectedDisciplineId((current) => current || firstDiscipline?.id || "");
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
  }, [teacherId]);

  const teacherDisciplines = useMemo(() => {
    const currentTeacherId = teacher?.id ?? teacherId ?? "";
    const teacherDisciplineIds = new Set(teacher?.discipline_ids ?? []);
    return disciplines.filter(
      (discipline) =>
        teacherDisciplineIds.has(discipline.id) ||
        discipline.teacher_ids.includes(currentTeacherId),
    );
  }, [disciplines, teacher, teacherId]);

  const teacherGroups = useMemo(
    () => groups.filter((group) => teacher?.group_ids.includes(group.id)),
    [groups, teacher],
  );

  const selectedDiscipline =
    teacherDisciplines.find((discipline) => discipline.id === selectedDisciplineId) ??
    teacherDisciplines[0] ??
    null;

  const selectedGroups = useMemo(() => {
    if (!selectedDiscipline) {
      return teacherGroups;
    }
    const disciplineGroupIds = new Set(selectedDiscipline.group_ids);
    return teacherGroups.filter((group) => disciplineGroupIds.has(group.id));
  }, [selectedDiscipline, teacherGroups]);

  const selectedStudents = useMemo(() => {
    const selectedGroupIds = new Set(selectedGroups.map((group) => group.id));
    return students.filter((student) => selectedGroupIds.has(student.group_id));
  }, [selectedGroups, students]);

  const subgroupsByGroupId = useMemo(() => {
    const result = new Map<string, Subgroup[]>();
    for (const subgroup of subgroups) {
      result.set(subgroup.group_id, [...(result.get(subgroup.group_id) ?? []), subgroup]);
    }
    return result;
  }, [subgroups]);

  const subgroupById = useMemo(
    () => new Map(subgroups.map((subgroup) => [subgroup.id, subgroup])),
    [subgroups],
  );

  const trajectoriesByStatus = useMemo(() => {
    return trajectories.reduce(
      (acc, trajectory) => {
        acc[trajectory.status] += 1;
        return acc;
      },
      { draft: 0, active: 0, archived: 0 } as Record<LearningTrajectorySummary["status"], number>,
    );
  }, [trajectories]);

  const selectedTrajectories = useMemo(() => {
    if (!selectedDiscipline) {
      return trajectories;
    }
    return trajectories.filter((trajectory) => trajectory.discipline_id === selectedDiscipline.id);
  }, [selectedDiscipline, trajectories]);

  const activeSelectedTrajectories = useMemo(
    () => selectedTrajectories.filter((trajectory) => trajectory.status === "active"),
    [selectedTrajectories],
  );

  useEffect(() => {
    if (!teacher || !students.length || !trajectories.length) {
      setTaskSnapshots([]);
      setSummaryError("");
      return;
    }

    const activeTrajectories = trajectories.filter((trajectory) => trajectory.status === "active");
    if (!activeTrajectories.length) {
      setTaskSnapshots([]);
      setSummaryError("");
      return;
    }

    const controller = new AbortController();
    const eligiblePairs = activeTrajectories.flatMap((trajectory) =>
      students
        .filter((student) => matchesTrajectoryStudent(trajectory, student))
        .map((student) => ({ student, trajectory })),
    );

    async function loadSummaryData() {
      try {
        setSummaryLoading(true);
        setSummaryError("");

        const settled = await Promise.allSettled(
          eligiblePairs.map(async ({ student, trajectory }) => ({
            student,
            trajectory,
            tasks: await fetchStudentTasks(student.id, controller.signal, undefined, trajectory.id),
          })),
        );

        if (controller.signal.aborted) {
          return;
        }

        const nextSnapshots: StudentTaskSnapshot[] = [];
        let failedRequests = 0;

        for (const result of settled) {
          if (result.status === "fulfilled") {
            nextSnapshots.push(result.value);
          } else if (!isAbortError(result.reason)) {
            failedRequests += 1;
          }
        }

        setTaskSnapshots(nextSnapshots);
        setSummaryError(
          failedRequests
            ? `Не удалось загрузить часть статистики: ${failedRequests} запросов завершились ошибкой.`
            : "",
        );
      } catch (summaryLoadError) {
        if (!isAbortError(summaryLoadError)) {
          setSummaryError(extractErrorMessage(summaryLoadError));
        }
      } finally {
        if (!controller.signal.aborted) {
          setSummaryLoading(false);
        }
      }
    }

    void loadSummaryData();
    return () => controller.abort();
  }, [students, teacher, trajectories]);

  const monitoredStudents = useMemo(() => {
    const eligibleStudents = selectedStudents.filter((student) =>
      activeSelectedTrajectories.some((trajectory) => matchesTrajectoryStudent(trajectory, student)),
    );
    return eligibleStudents.sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [activeSelectedTrajectories, selectedStudents]);

  const selectedSnapshots = useMemo(
    () =>
      taskSnapshots.filter((snapshot) =>
        selectedDiscipline ? snapshot.trajectory.discipline_id === selectedDiscipline.id : true,
      ),
    [selectedDiscipline, taskSnapshots],
  );

  const studentSummaryRows = useMemo<StudentSummaryRow[]>(() => {
    const scoreBuckets = new Map<string, number[]>();
    const rows = new Map<string, StudentSummaryRow>();

    for (const student of monitoredStudents) {
      rows.set(student.id, {
        student,
        totalTasks: 0,
        startedTasks: 0,
        completedTasks: 0,
        pendingReviewTasks: 0,
        averageScore: null,
        progressPercent: 0,
        attentionScore: 0,
      });
      scoreBuckets.set(student.id, []);
    }

    for (const snapshot of selectedSnapshots) {
      const row = rows.get(snapshot.student.id);
      if (!row) {
        continue;
      }
      row.totalTasks += snapshot.tasks.length;

      for (const task of snapshot.tasks) {
        if (studentHasStartedTask(task)) {
          row.startedTasks += 1;
        }
        if (task.progress.status === "completed") {
          row.completedTasks += 1;
        }
        if (task.progress.status === "pending_review") {
          row.pendingReviewTasks += 1;
        }
        if (typeof task.progress.last_score === "number") {
          scoreBuckets.get(snapshot.student.id)?.push(task.progress.last_score);
        }
      }
    }

    return Array.from(rows.values())
      .map((row) => {
        row.averageScore = average(scoreBuckets.get(row.student.id) ?? []);
        row.progressPercent = toPercent(row.completedTasks, row.totalTasks);
        row.attentionScore = row.pendingReviewTasks * 4 + Math.max(row.totalTasks - row.completedTasks, 0);
        return row;
      })
      .sort((left, right) => {
        if (right.attentionScore !== left.attentionScore) {
          return right.attentionScore - left.attentionScore;
        }
        return left.student.name.localeCompare(right.student.name, "ru");
      });
  }, [monitoredStudents, selectedSnapshots]);

  const difficultTasks = useMemo<TaskDifficultyRow[]>(() => {
    const taskScores = new Map<
      string,
      {
        id: string;
        title: string;
        topicName: string;
        trajectoryName: string;
        assignedCount: number;
        startedCount: number;
        completedCount: number;
        pendingReviewCount: number;
      }
    >();

    for (const snapshot of selectedSnapshots) {
      for (const task of snapshot.tasks) {
        const current = taskScores.get(task.id) ?? {
          id: task.id,
          title: task.title || task.topic_name,
          topicName: task.topic_name,
          trajectoryName: snapshot.trajectory.name,
          assignedCount: 0,
          startedCount: 0,
          completedCount: 0,
          pendingReviewCount: 0,
        };
        current.assignedCount += 1;
        if (studentHasStartedTask(task)) {
          current.startedCount += 1;
        }
        if (task.progress.status === "completed") {
          current.completedCount += 1;
        }
        if (task.progress.status === "pending_review") {
          current.pendingReviewCount += 1;
        }
        taskScores.set(task.id, current);
      }
    }

    return Array.from(taskScores.values())
      .map((item) => ({
        id: item.id,
        title: item.title,
        topicName: item.topicName,
        trajectoryName: item.trajectoryName,
        assignedCount: item.assignedCount,
        startedCount: item.startedCount,
        pendingReviewCount: item.pendingReviewCount,
        completionPercent: toPercent(item.completedCount, item.assignedCount),
      }))
      .sort((left, right) => left.completionPercent - right.completionPercent)
      .slice(0, 3);
  }, [selectedSnapshots]);

  const totalMonitoredStudents = monitoredStudents.length;
  const startedStudentsCount = studentSummaryRows.filter((row) => row.startedTasks > 0).length;
  const completedStudentsCount = studentSummaryRows.filter(
    (row) => row.totalTasks > 0 && row.completedTasks === row.totalTasks,
  ).length;
  const pendingReviewStudentsCount = studentSummaryRows.filter(
    (row) => row.pendingReviewTasks > 0,
  ).length;

  const taskStatusChart = useMemo(() => {
    const distribution = {
      not_started: 0,
      in_progress: 0,
      pending_review: 0,
      completed: 0,
    };

    for (const snapshot of selectedSnapshots) {
      for (const task of snapshot.tasks) {
        distribution[task.progress.status] += 1;
      }
    }

    const total =
      distribution.not_started +
      distribution.in_progress +
      distribution.pending_review +
      distribution.completed;

    return [
      {
        key: "completed",
        label: "Проверено",
        count: distribution.completed,
        percent: toPercent(distribution.completed, total),
        tone: "success",
      },
      {
        key: "pending_review",
        label: "Ждет проверки",
        count: distribution.pending_review,
        percent: toPercent(distribution.pending_review, total),
        tone: "warning",
      },
      {
        key: "in_progress",
        label: "В работе",
        count: distribution.in_progress,
        percent: toPercent(distribution.in_progress, total),
        tone: "info",
      },
      {
        key: "not_started",
        label: "Не начато",
        count: distribution.not_started,
        percent: toPercent(distribution.not_started, total),
        tone: "muted",
      },
    ] as Array<{
      key: string;
      label: string;
      count: number;
      percent: number;
      tone: "success" | "warning" | "info" | "muted";
    }>;
  }, [selectedSnapshots]);

  const averageStudentProgress = useMemo(
    () =>
      studentSummaryRows.length
        ? Math.round(
            studentSummaryRows.reduce((sum, row) => sum + row.progressPercent, 0) /
              studentSummaryRows.length,
          )
        : 0,
    [studentSummaryRows],
  );

  function renderDisciplinesPanel() {
    return (
      <>
        <div className="card__header">
          <div>
            <p className="card__eyebrow">Мои дисциплины</p>
            <h2>Дисциплины преподавателя</h2>
          </div>
        </div>
        <div className="role-card-grid">
          {teacherDisciplines.length ? (
            teacherDisciplines.map((discipline) => {
              const disciplineTrajectories = trajectories.filter(
                (trajectory) => trajectory.discipline_id === discipline.id,
              );
              const disciplineGroups = groups.filter((group) => discipline.group_ids.includes(group.id));
              return (
                <article className="role-feature-card" key={discipline.id}>
                  <div>
                    <strong>{discipline.name}</strong>
                    <span>Групп: {disciplineGroups.length}</span>
                    <span>
                      Траекторий: {disciplineTrajectories.length} · активных:{" "}
                      {disciplineTrajectories.filter((item) => item.status === "active").length}
                    </span>
                  </div>
                  <div className="role-action-row">
                    <button
                      className="ghost-button"
                      onClick={() => {
                        setSelectedDisciplineId(discipline.id);
                        setActivePanel("trajectories");
                      }}
                      type="button"
                    >
                      Траектории
                    </button>
                    {!isAdminViewer ? (
                      <MotionLink
                        className="primary-button"
                        to={`/disciplines/${getDisciplinePath(discipline, discipline.id)}/trajectory`}
                        {...actionHoverMotion}
                      >
                        Создать траекторию
                      </MotionLink>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="card__text">Дисциплины пока не назначены.</p>
          )}
        </div>
      </>
    );
  }

  function renderGroupsPanel() {
    return (
      <>
        <div className="card__header">
          <div>
            <p className="card__eyebrow">Группы</p>
            <h2>Группы по выбранной дисциплине</h2>
          </div>
          <label className="field role-dashboard-select">
            <span>Дисциплина</span>
            <select
              value={selectedDiscipline?.id ?? ""}
              onChange={(event) => setSelectedDisciplineId(event.target.value)}
            >
              {teacherDisciplines.map((discipline) => (
                <option key={discipline.id} value={discipline.id}>
                  {discipline.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="role-card-grid role-card-grid--groups">
          {selectedGroups.length ? (
            selectedGroups.map((group) => {
              const groupStudents = selectedStudents.filter((student) => student.group_id === group.id);
              const groupSubgroups = subgroupsByGroupId.get(group.id) ?? [];
              return (
                <article className="role-feature-card" key={group.id}>
                  <div>
                    <strong>{group.name}</strong>
                    <span>Студентов: {groupStudents.length}</span>
                    <span>
                      Подгруппы:{" "}
                      {groupSubgroups.length
                        ? groupSubgroups.map((subgroup) => `№ ${subgroup.subgroup_num}`).join(", ")
                        : "не созданы"}
                    </span>
                  </div>
                  <div className="role-inline-list">
                    {groupStudents.slice(0, 6).map((student) => (
                      <span key={student.id}>{student.name}</span>
                    ))}
                    {groupStudents.length > 6 ? <span>Еще {groupStudents.length - 6}</span> : null}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="card__text">Для выбранной дисциплины группы не назначены.</p>
          )}
        </div>
      </>
    );
  }

  function renderSummaryPanel() {
    return (
      <>
        <div className="card__header">
          <div>
            <p className="card__eyebrow">Сводка</p>
            <h2>Статистика по контролю студентов</h2>
          </div>
        </div>

        {summaryError ? (
          <div className="home-feedback home-feedback--error">{summaryError}</div>
        ) : summaryLoading ? (
          <div className="teacher-summary-loading">
            <div className="status-view__pulse" />
            <span>Собираю статистику...</span>
          </div>
        ) : !activeSelectedTrajectories.length ? (
          <p className="role-muted-note">Для сводки нужна активная траектория.</p>
        ) : (
          <>
            <div className="teacher-summary-metrics">
              <article className="teacher-summary-metric teacher-summary-metric--accent">
                <span>Начали</span>
                <strong>{startedStudentsCount}</strong>
                <small>из {totalMonitoredStudents}</small>
              </article>
              <article className="teacher-summary-metric">
                <span>Не начали</span>
                <strong>{Math.max(totalMonitoredStudents - startedStudentsCount, 0)}</strong>
                <small>требуют внимания</small>
              </article>
              <article className="teacher-summary-metric">
                <span>Завершили</span>
                <strong>{completedStudentsCount}</strong>
                <small>все задания</small>
              </article>
              <article className="teacher-summary-metric">
                <span>Средний прогресс</span>
                <strong>{averageStudentProgress}%</strong>
                <small>по дисциплине</small>
              </article>
            </div>

            <div className="teacher-summary-grid">
              <section className="teacher-summary-card">
                <div className="teacher-summary-card__header">
                  <div>
                    <p className="card__eyebrow">Статусы</p>
                    <h3>Распределение заданий</h3>
                  </div>
                  <span className="teacher-summary-card__badge">На проверке: {pendingReviewStudentsCount}</span>
                </div>
                <div className="teacher-status-chart">
                  {taskStatusChart.map((item) => (
                    <div className="teacher-status-chart__row" key={item.key}>
                      <div className="teacher-status-chart__meta">
                        <span>{item.label}</span>
                        <strong>{item.count}</strong>
                      </div>
                      <div className="teacher-status-chart__track">
                        <i
                          className={`teacher-status-chart__fill teacher-status-chart__fill--${item.tone}`}
                          style={{ width: `${item.percent}%` }}
                        />
                      </div>
                      <small>{item.percent}%</small>
                    </div>
                  ))}
                </div>
              </section>

              <section className="teacher-summary-card">
                <div className="teacher-summary-card__header">
                  <div>
                    <p className="card__eyebrow">Сложные задания</p>
                    <h3>Топ проблемных</h3>
                  </div>
                </div>
                <div className="teacher-difficulty-list">
                  {difficultTasks.length ? (
                    difficultTasks.map((task) => (
                      <article className="teacher-difficulty-item" key={task.id}>
                        <div className="teacher-difficulty-item__head">
                          <strong>{task.title}</strong>
                          <span>{task.completionPercent}%</span>
                        </div>
                        <span>
                          {task.topicName} · {task.trajectoryName}
                        </span>
                        <div className="teacher-progress-bar">
                          <i style={{ width: `${task.completionPercent}%` }} />
                        </div>
                        <small>
                          Назначено: {task.assignedCount} · начали: {task.startedCount} · ждут проверки:{" "}
                          {task.pendingReviewCount}
                        </small>
                      </article>
                    ))
                  ) : (
                    <p className="role-muted-note">Недостаточно данных.</p>
                  )}
                </div>
              </section>
            </div>

            <section className="teacher-summary-card teacher-summary-card--wide">
              <div className="teacher-summary-card__header">
                <div>
                  <p className="card__eyebrow">Студенты</p>
                  <h3>Кому нужно внимание</h3>
                </div>
                {!isAdminViewer && selectedDiscipline ? (
                  <MotionLink
                    className="primary-button"
                    to={`/teachers/${teacherId}/reviews?discipline=${selectedDiscipline.id}`}
                    {...actionHoverMotion}
                  >
                    Проверка работ
                  </MotionLink>
                ) : null}
              </div>
              <div className="teacher-progress-list teacher-progress-list--compact">
                {studentSummaryRows.length ? (
                  studentSummaryRows.slice(0, 5).map((row) => (
                    <article className="role-progress-row teacher-progress-row" key={row.student.id}>
                      <div className="role-progress-row__head">
                        <div>
                          <strong>{row.student.name}</strong>
                          <small>
                            {row.student.login}
                            {row.student.subgroup_id
                              ? ` · подгруппа ${subgroupById.get(row.student.subgroup_id)?.subgroup_num ?? "?"}`
                              : ""}
                          </small>
                        </div>
                        <span>{row.progressPercent}%</span>
                      </div>
                      <div className="role-progress-bar">
                        <i style={{ width: `${row.progressPercent}%` }} />
                      </div>
                      <small>
                        Выполнено: {row.completedTasks}/{row.totalTasks} · начали: {row.startedTasks} · ждут проверки:{" "}
                        {row.pendingReviewTasks}
                      </small>
                    </article>
                  ))
                ) : (
                  <p className="role-muted-note">Пока нет данных по студентам.</p>
                )}
              </div>
            </section>
          </>
        )}
      </>
    );
  }

  function renderTrajectoriesPanel() {
    return (
      <>
        <div className="card__header">
          <div>
            <p className="card__eyebrow">Траектории</p>
            <h2>Создание и управление</h2>
          </div>
          {selectedDiscipline && !isAdminViewer ? (
            <MotionLink
              className="primary-button"
              to={`/disciplines/${getDisciplinePath(selectedDiscipline, selectedDiscipline.id)}/trajectory`}
              {...actionHoverMotion}
            >
              Создать траекторию
            </MotionLink>
          ) : null}
        </div>
        <div className="role-card-grid">
          {selectedTrajectories.length ? (
            selectedTrajectories.map((trajectory) => {
              const discipline = disciplines.find((item) => item.id === trajectory.discipline_id);
              return (
                <article className="role-feature-card" key={trajectory.id}>
                  <div>
                    <strong>{trajectory.name}</strong>
                    <span>{trajectoryStatusLabel[trajectory.status]}</span>
                    <span>{trajectory.topic_count} тем</span>
                  </div>
                  <div className="role-action-row">
                    {isAdminViewer ? (
                      <span className="role-muted-note">Доступно только чтение.</span>
                    ) : (
                      <>
                        <MotionLink
                          className="secondary-button"
                          to={`/disciplines/${getDisciplinePath(discipline, trajectory.discipline_id)}/trajectories/${trajectory.id}`}
                          {...actionHoverMotion}
                        >
                          Открыть
                        </MotionLink>
                        <button className="ghost-button" onClick={() => setActivePanel("summary")} type="button">
                          Сводка
                        </button>
                      </>
                    )}
                  </div>
                </article>
              );
            })
          ) : (
            <p className="card__text">По выбранной дисциплине траекторий пока нет.</p>
          )}
        </div>
      </>
    );
  }

  function renderReviewPanel() {
    return (
      <div className="teacher-dashboard-review-panel">
        {!isAdminViewer && selectedDiscipline ? (
          <MotionLink
            className="primary-button"
            to={`/teachers/${teacherId}/reviews?discipline=${selectedDiscipline.id}`}
            {...actionHoverMotion}
          >
            Открыть экран проверки
          </MotionLink>
        ) : (
          <p className="role-muted-note">Проверка доступна только из профиля преподавателя.</p>
        )}
      </div>
    );
  }

  function renderActivePanel() {
    if (activePanel === "disciplines") {
      return renderDisciplinesPanel();
    }
    if (activePanel === "groups") {
      return renderGroupsPanel();
    }
    if (activePanel === "summary") {
      return renderSummaryPanel();
    }
    return renderTrajectoriesPanel();
  }

  if (!teacherId) {
    return null;
  }

  async function handleDelete() {
    if (!isAdminViewer || !teacher) {
      return;
    }

    const confirmed = window.confirm(`Удалить преподавателя "${teacher.name}"?`);
    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      await deleteTeacher(teacher.id);
      navigate(getSessionHomePath(readSession()), { replace: true });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Не удалось удалить преподавателя.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page-shell role-page immersive-page immersive-page--teacher">
      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view immersive-page__status">
          <div className="status-view__pulse" />
          <h3>Загружаю кабинет преподавателя</h3>
        </section>
      ) : (
        <main className="teacher-dashboard-shell">
          <aside className="card card--soft teacher-dashboard-sidebar">
            <div className="teacher-dashboard-sidebar__head">
              <p className="card__eyebrow">Навигация</p>
              <h2>Личный кабинет</h2>
            </div>

            <label className="field">
              <span>Текущая дисциплина</span>
              <select
                onChange={(event) => setSelectedDisciplineId(event.target.value)}
                value={selectedDiscipline?.id ?? ""}
              >
                {teacherDisciplines.map((discipline) => (
                  <option key={discipline.id} value={discipline.id}>
                    {discipline.name}
                  </option>
                ))}
              </select>
            </label>

            <nav className="teacher-dashboard-sidebar__nav">
              {PANEL_ORDER.map((panel) => (
                <button
                  className={activePanel === panel ? "is-active" : ""}
                  key={panel}
                  onClick={() => setActivePanel(panel)}
                  type="button"
                >
                  {panel === "disciplines" && "Дисциплины"}
                  {panel === "groups" && "Группы"}
                  {panel === "summary" && "Сводка"}
                  {panel === "trajectories" && "Траектории"}
                </button>
              ))}
            </nav>

            {!isAdminViewer && selectedDiscipline ? (
              <div className="teacher-dashboard-sidebar__actions">
                <button className="ghost-button" onClick={() => navigate(-1)} type="button">
                  Назад
                </button>
                <MotionLink
                  className="primary-button"
                  to={`/disciplines/${getDisciplinePath(selectedDiscipline, selectedDiscipline.id)}/trajectory`}
                  {...actionHoverMotion}
                >
                  Создать траекторию
                </MotionLink>
              </div>
            ) : isAdminViewer ? (
              <div className="teacher-dashboard-sidebar__actions">
                <button className="ghost-button" onClick={() => navigate(-1)} type="button">
                  Назад
                </button>
                <button
                  className="secondary-button secondary-button--danger"
                  disabled={!teacher || deleting}
                  onClick={() => void handleDelete()}
                  type="button"
                >
                  Удалить преподавателя
                </button>
              </div>
            ) : null}
          </aside>

          <div className="role-dashboard teacher-dashboard-content">
            <section className="role-dashboard-metrics">
              <article className="student-metric-card">
                <span>Мои дисциплины</span>
                <strong>{teacherDisciplines.length}</strong>
              </article>
              <article className="student-metric-card">
                <span>Группы</span>
                <strong>{teacherGroups.length}</strong>
              </article>
              <article className="student-metric-card">
                <span>Активные траектории</span>
                <strong>{trajectoriesByStatus.active}</strong>
              </article>
              <article className="student-metric-card">
                <span>Черновики</span>
                <strong>{trajectoriesByStatus.draft}</strong>
              </article>
            </section>

            <motion.section
              className="card card--soft role-dashboard-section teacher-dashboard-panel"
              key={activePanel}
              {...revealMotion(0.05)}
            >
              {renderActivePanel()}
            </motion.section>
          </div>
        </main>
      )}
    </div>
  );
}
