import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplines,
  fetchGroups,
  fetchStudent,
  fetchStudentLearningTrajectories,
  fetchStudentsByGroup,
  fetchSubgroups,
  fetchTeachers,
  isAbortError,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import { ExitConfirmDialog } from "./ExitConfirmDialog";
import { revealMotion } from "./motionPresets";
import type {
  Discipline,
  Group,
  Student,
  StudentLearningTrajectorySummary,
  Subgroup,
  Teacher,
} from "./types";

const MotionLink = motion(Link);

const trajectoryStatusLabel: Record<StudentLearningTrajectorySummary["status"], string> = {
  draft: "Черновик",
  active: "Активна",
  archived: "Архив",
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Не удалось загрузить кабинет студента.";
}

function clampPercent(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function getTrajectoryPath(
  trajectory: StudentLearningTrajectorySummary,
  discipline: Discipline | undefined,
  studentId: string,
) {
  return `/disciplines/${disciplinePathValue(
    discipline,
    trajectory.discipline_id,
  )}/trajectories/${trajectory.id}?preview=student&student=${studentId}`;
}

export default function StudentDashboardPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [trajectories, setTrajectories] = useState<StudentLearningTrajectorySummary[]>([]);
  const [groupStudents, setGroupStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

  useEffect(() => {
    if (!studentId) {
      return;
    }

    const currentStudentId = studentId;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [nextStudent, nextGroups, nextDisciplines, nextTeachers] = await Promise.all([
          fetchStudent(currentStudentId, controller.signal),
          fetchGroups(controller.signal),
          fetchDisciplines(controller.signal),
          fetchTeachers(controller.signal),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        const [nextSubgroups, nextTrajectories, nextGroupStudents] = nextStudent
          ? await Promise.all([
              fetchSubgroups(nextStudent.group_id, controller.signal),
              fetchStudentLearningTrajectories(currentStudentId, controller.signal),
              fetchStudentsByGroup(nextStudent.group_id, controller.signal),
            ])
          : [[], [] as StudentLearningTrajectorySummary[], [] as Student[]];

        if (controller.signal.aborted) {
          return;
        }

        setStudent(nextStudent);
        setGroups(nextGroups);
        setDisciplines(nextDisciplines);
        setTeachers(nextTeachers);
        setSubgroups(nextSubgroups);
        setTrajectories(nextTrajectories);
        setGroupStudents(nextGroupStudents);
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
  }, [studentId]);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const subgroupById = useMemo(
    () => new Map(subgroups.map((subgroup) => [subgroup.id, subgroup])),
    [subgroups],
  );
  const disciplineById = useMemo(
    () => new Map(disciplines.map((discipline) => [discipline.id, discipline])),
    [disciplines],
  );
  const teacherById = useMemo(
    () => new Map(teachers.map((teacher) => [teacher.id, teacher])),
    [teachers],
  );

  const classmates = useMemo(
    () => groupStudents.filter((groupStudent) => groupStudent.id !== student?.id),
    [groupStudents, student?.id],
  );

  const totalTasksCount = trajectories.reduce(
    (sum, trajectory) => sum + trajectory.total_task_count,
    0,
  );
  const completedTasksCount = trajectories.reduce(
    (sum, trajectory) => sum + trajectory.completed_task_count,
    0,
  );
  const remainingTasksCount = Math.max(totalTasksCount - completedTasksCount, 0);
  const averageProgress = trajectories.length
    ? clampPercent(
        trajectories.reduce((sum, trajectory) => sum + trajectory.progress_percent, 0) /
          trajectories.length,
      )
    : 0;

  const currentTrajectory =
    trajectories.find(
      (trajectory) =>
        trajectory.status === "active" &&
        trajectory.total_task_count > trajectory.completed_task_count,
    ) ??
    trajectories.find((trajectory) => trajectory.status === "active") ??
    trajectories[0];

  const teachersByDiscipline = useMemo(() => {
    const disciplineIds = Array.from(
      new Set(trajectories.map((trajectory) => trajectory.discipline_id)),
    );

    return disciplineIds.map((disciplineId) => {
      const discipline = disciplineById.get(disciplineId);
      const disciplineTeachers =
        discipline?.teacher_ids
          .map((teacherId) => teacherById.get(teacherId))
          .filter((teacher): teacher is Teacher => Boolean(teacher)) ?? [];

      return {
        discipline,
        teachers: disciplineTeachers,
      };
    });
  }, [disciplineById, teacherById, trajectories]);

  if (!studentId) {
    return null;
  }

  const studentGroup = student ? groupById.get(student.group_id) : undefined;
  const studentSubgroup = student?.subgroup_id ? subgroupById.get(student.subgroup_id) : undefined;
  const currentDiscipline = currentTrajectory
    ? disciplineById.get(currentTrajectory.discipline_id)
    : undefined;

  return (
    <div className="page-shell role-page immersive-page immersive-page--student">
      <motion.header className="hero immersive-page__hero role-dashboard-hero" {...revealMotion(0.02)}>
        <div>
          <p className="hero__eyebrow">Кабинет студента</p>
          <h1>{student?.name ?? "Студент"}</h1>
          <p className="hero__subtitle">
            Назначенные траектории, текущий контроль, прогресс по темам и состав учебной группы.
          </p>
        </div>
        <div className="hero__controls hero__controls--stack">
          <button
            className="ghost-button"
            onClick={() => navigate(-1)}
            type="button"
          >
            Назад
          </button>
          <button
            className="ghost-button"
            onClick={() => setExitConfirmOpen(true)}
            type="button"
          >
            Выход
          </button>
          <div className="student-profile-compact student-profile-card">
            <span className="student-profile-compact__label">Профиль</span>
            <strong className="student-profile-card__name">{student?.login ?? "login"}</strong>
            <div className="student-profile-card__meta">
              <div className="student-profile-card__row">
                <small>Группа</small>
                <span>{studentGroup?.name ?? "не назначена"}</span>
              </div>
              <div className="student-profile-card__row">
                <small>Подгруппа</small>
                <span>
                  {studentSubgroup ? `подгруппа ${studentSubgroup.subgroup_num}` : "не назначена"}
                </span>
              </div>
            </div>
          </div>
        </div>
      </motion.header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view immersive-page__status">
          <div className="status-view__pulse" />
          <h3>Загружаю кабинет студента</h3>
        </section>
      ) : (
        <main className="role-dashboard">
          <section className="role-dashboard-metrics">
            <article className="student-metric-card">
              <span>Мои траектории</span>
              <strong>{trajectories.length}</strong>
            </article>
            <article className="student-metric-card">
              <span>Выполнено заданий</span>
              <strong>
                {completedTasksCount}/{totalTasksCount}
              </strong>
            </article>
            <article className="student-metric-card">
              <span>Средний прогресс</span>
              <strong>{averageProgress}%</strong>
            </article>
            <article className="student-metric-card">
              <span>Осталось заданий</span>
              <strong>{remainingTasksCount}</strong>
            </article>
          </section>

          <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.05)}>
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Мои траектории</p>
                <h2>Назначенные траектории обучения</h2>
              </div>
            </div>

            <div className="student-trajectory-grid">
              {trajectories.length ? (
                trajectories.map((trajectory) => {
                  const discipline = disciplineById.get(trajectory.discipline_id);
                  const progress = clampPercent(trajectory.progress_percent);

                  return (
                    <MotionLink
                      className="student-trajectory-card"
                      key={trajectory.id}
                      to={getTrajectoryPath(trajectory, discipline, studentId)}
                      {...revealMotion(0.02)}
                    >
                      <div className="student-trajectory-card__head">
                        <div>
                          <strong>{trajectory.name}</strong>
                          <span>{discipline?.name ?? "Дисциплина не найдена"}</span>
                        </div>
                        <span className="hero__chip">{trajectoryStatusLabel[trajectory.status]}</span>
                      </div>
                      <div className="student-progress" aria-label="Прогресс траектории">
                        <div className="student-progress__bar">
                          <i style={{ width: `${progress}%` }} />
                        </div>
                        <span>Прогресс: {progress}%</span>
                        <span>
                          Выполнено {trajectory.completed_task_count} из {trajectory.total_task_count} заданий
                        </span>
                      </div>
                      <div className="student-trajectory-card__footer">
                        <span>Продолжить</span>
                        <span>{trajectory.topic_count} тем</span>
                      </div>
                    </MotionLink>
                  );
                })
              ) : (
                <p className="card__text">Активных траекторий пока нет.</p>
              )}
            </div>
          </motion.section>

          <div className="role-dashboard-two-column">
            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.06)}>
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Текущая траектория</p>
                  <h2>{currentTrajectory?.name ?? "Траектория не выбрана"}</h2>
                </div>
              </div>
              {currentTrajectory ? (
                <div className="role-feature-card">
                  <strong>{currentDiscipline?.name ?? "Дисциплина не найдена"}</strong>
                  <span>
                    Граф показывает доступные и закрытые темы. Если тема закрыта, причина блокировки
                    отображается внутри карточки темы.
                  </span>
                  <div className="student-progress">
                    <div className="student-progress__bar">
                      <i style={{ width: `${clampPercent(currentTrajectory.progress_percent)}%` }} />
                    </div>
                    <span>Прогресс: {clampPercent(currentTrajectory.progress_percent)}%</span>
                  </div>
                  <div className="role-action-row">
                    <MotionLink
                      className="primary-button"
                      to={getTrajectoryPath(currentTrajectory, currentDiscipline, studentId)}
                    >
                      Открыть граф тем
                    </MotionLink>
                  </div>
                </div>
              ) : (
                <p className="card__text">Преподаватель еще не назначил траекторию.</p>
              )}
            </motion.section>

            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.07)}>
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Прохождение контроля</p>
                  <h2>Одно задание за раз</h2>
                </div>
              </div>
              <div className="role-feature-card">
                <strong>Контроль открывается из графа темы</strong>
                <span>
                  Студент выбирает доступную тему, получает текущее задание, отправляет ответ и
                  переходит к следующему заданию по результатам адаптивной выдачи.
                </span>
                {currentTrajectory ? (
                  <MotionLink
                    className="ghost-button"
                    to={getTrajectoryPath(currentTrajectory, currentDiscipline, studentId)}
                  >
                    Перейти к текущей траектории
                  </MotionLink>
                ) : null}
              </div>
            </motion.section>
          </div>

          <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.08)}>
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Мой прогресс</p>
                <h2>Прогресс по траекториям</h2>
              </div>
            </div>
            <div className="role-progress-list">
              {trajectories.length ? (
                trajectories.map((trajectory) => {
                  const discipline = disciplineById.get(trajectory.discipline_id);
                  const progress = clampPercent(trajectory.progress_percent);
                  return (
                    <article className="role-progress-row" key={trajectory.id}>
                      <div className="role-progress-row__head">
                        <strong>{trajectory.name}</strong>
                        <span>{progress}%</span>
                      </div>
                      <small>{discipline?.name ?? "Дисциплина не найдена"}</small>
                      <div className="role-progress-bar">
                        <i style={{ width: `${progress}%` }} />
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="card__text">Данные прогресса появятся после назначения траектории.</p>
              )}
            </div>
            <div className="role-muted-note">
              Элементы для повторения будут выводиться здесь после накопления истории попыток по
              заданиям.
            </div>
          </motion.section>

          <div className="role-dashboard-two-column">
            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.09)}>
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Моя группа</p>
                  <h2>{studentGroup?.name ?? "Группа не назначена"}</h2>
                </div>
              </div>
              <div className="role-feature-card">
                <strong>
                  {studentSubgroup ? `Подгруппа ${studentSubgroup.subgroup_num}` : "Подгруппа не назначена"}
                </strong>
                <span>Состав группы:</span>
                <div className="role-inline-list">
                  {classmates.length ? (
                    classmates.map((classmate) => <span key={classmate.id}>{classmate.name}</span>)
                  ) : (
                    <span>одногруппники не найдены</span>
                  )}
                </div>
              </div>
              <div className="role-card-grid">
                {teachersByDiscipline.length ? (
                  teachersByDiscipline.map(({ discipline, teachers: disciplineTeachers }) => (
                    <article className="role-feature-card" key={discipline?.id ?? "unknown"}>
                      <strong>{discipline?.name ?? "Дисциплина не найдена"}</strong>
                      <div className="role-inline-list">
                        {disciplineTeachers.length ? (
                          disciplineTeachers.map((teacher) => (
                            <MotionLink key={teacher.id} to={`/teachers/${teacher.id}`}>
                              {teacher.name}
                            </MotionLink>
                          ))
                        ) : (
                          <span>преподаватель не назначен</span>
                        )}
                      </div>
                    </article>
                  ))
                ) : (
                  <p className="card__text">Дисциплины пока не назначены.</p>
                )}
              </div>
            </motion.section>

            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.1)}>
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Статистика</p>
                  <h2>Сводка прохождения</h2>
                </div>
              </div>
              <div className="role-card-grid">
                <article className="student-metric-card">
                  <span>Выполнено заданий</span>
                  <strong>{completedTasksCount}</strong>
                </article>
                <article className="student-metric-card">
                  <span>Средний результат</span>
                  <strong>{averageProgress}%</strong>
                </article>
                <article className="student-metric-card">
                  <span>Завершенные темы</span>
                  <strong>Позже</strong>
                </article>
                <article className="student-metric-card">
                  <span>Динамика освоения</span>
                  <strong>Позже</strong>
                </article>
              </div>
            </motion.section>
          </div>
        </main>
      )}

      <ExitConfirmDialog
        open={exitConfirmOpen}
        onCancel={() => setExitConfirmOpen(false)}
        onConfirm={() => navigate("/")}
      />
    </div>
  );
}
