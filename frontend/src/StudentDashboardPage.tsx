import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplines,
  fetchGroups,
  fetchStudent,
  fetchStudentLearningTrajectories,
  fetchSubgroups,
  isAbortError,
} from "./api";
import { revealMotion } from "./motionPresets";
import type {
  Discipline,
  Group,
  Student,
  StudentLearningTrajectorySummary,
  Subgroup,
} from "./types";

const MotionLink = motion(Link);

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось загрузить страницу студента.";
}

export default function StudentDashboardPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [trajectories, setTrajectories] = useState<StudentLearningTrajectorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!studentId) return;
    const currentStudentId = studentId;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [nextStudent, nextGroups, nextDisciplines] = await Promise.all([
          fetchStudent(currentStudentId, controller.signal),
          fetchGroups(controller.signal),
          fetchDisciplines(controller.signal),
        ]);

        if (controller.signal.aborted) return;

        const [nextSubgroups, nextTrajectories] = nextStudent
          ? await Promise.all([
              nextStudent.group_id
                ? fetchSubgroups(nextStudent.group_id, controller.signal)
                : Promise.resolve([] as Subgroup[]),
              fetchStudentLearningTrajectories(currentStudentId, controller.signal),
            ])
          : [[], [] as StudentLearningTrajectorySummary[]];

        if (controller.signal.aborted) return;

        setStudent(nextStudent);
        setGroups(nextGroups);
        setDisciplines(nextDisciplines);
        setSubgroups(nextSubgroups);
        setTrajectories(nextTrajectories);

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

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const subgroupById = useMemo(
    () => new Map(subgroups.map((subgroup) => [subgroup.id, subgroup])),
    [subgroups],
  );
  const disciplineById = useMemo(
    () => new Map(disciplines.map((discipline) => [discipline.id, discipline])),
    [disciplines],
  );

  const totalTasksCount = trajectories.reduce(
    (sum, trajectory) => sum + trajectory.total_task_count,
    0,
  );
  const completedTasksCount = trajectories.reduce(
    (sum, trajectory) => sum + trajectory.completed_task_count,
    0,
  );

  if (!studentId) return null;

  return (
    <div className="page-shell student-dashboard-page immersive-page immersive-page--student">
      <div className="page-shell__inner">
        <motion.header className="hero immersive-page__hero" {...revealMotion(0.02)}>
          <div>
            <p className="hero__eyebrow">COMPETENCE HUB</p>
            <h1>Кабинет студента</h1>
            <p className="hero__subtitle">
              Назначенные траектории, текущий этап и доступ к прохождению через граф темы.
            </p>
          </div>
          <div className="hero__controls hero__controls--stack">
            <button className="ghost-button" onClick={() => navigate("/")} type="button">
              На главную
            </button>
            <div className="student-profile-compact student-profile-card">
              <span className="student-profile-compact__label">Профиль студента</span>
              <strong className="student-profile-card__name">{student?.name ?? "Студент"}</strong>
              <div className="student-profile-card__meta">
                <div className="student-profile-card__row">
                  <small>Группа</small>
                  <span>
                    {student?.group_id
                      ? groupById.get(student.group_id)?.name ?? "Группа не найдена"
                      : "Не назначена"}
                  </span>
                </div>
                <div className="student-profile-card__row">
                  <small>Подгруппа</small>
                  <span>
                    {student?.subgroup_id
                      ? `№ ${subgroupById.get(student.subgroup_id)?.subgroup_num ?? "не найдена"}`
                      : "Не назначена"}
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
            <h3>Загружаю страницу студента</h3>
          </section>
        ) : (
          <main className="student-dashboard-main">
            <motion.section
              className="card card--soft student-dashboard-summary"
              {...revealMotion(0.05)}
            >
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
                Выбери траекторию ниже. Задания открываются уже внутри графа выбранной
                траектории после клика по теме.
              </p>
            </motion.section>

            <motion.section
              className="card card--soft student-dashboard-trajectories"
              {...revealMotion(0.08)}
            >
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Траектории</p>
                  <h2>Доступные траектории обучения</h2>
                </div>
              </div>

              <div className="student-trajectory-grid">
                {trajectories.length ? (
                  trajectories.map((trajectory) => {
                    const discipline = disciplineById.get(trajectory.discipline_id);
                    const remainingTasks = Math.max(
                      trajectory.total_task_count - trajectory.completed_task_count,
                      0,
                    );

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
                          <span className="hero__chip">{trajectory.topic_count} тем</span>
                        </div>

                        <p className="card__text">
                          {trajectory.total_task_count
                            ? remainingTasks
                              ? `Осталось пройти ${remainingTasks} заданий в этой траектории.`
                              : "Все текущие задания по этой траектории выполнены."
                            : "Траектория назначена, но задания пока не добавлены."}
                        </p>

                        <div className="student-progress" aria-label="Прогресс прохождения">
                          <div className="student-progress__bar">
                            <i style={{ width: `${trajectory.progress_percent}%` }} />
                          </div>
                          <span>Прогресс: {trajectory.progress_percent}%</span>
                          <span>
                            Выполнено {trajectory.completed_task_count} из{" "}
                            {trajectory.total_task_count} заданий
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
