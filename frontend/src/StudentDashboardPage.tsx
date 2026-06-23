import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  deleteStudent,
  fetchDisciplines,
  fetchStudent,
  fetchStudentLearningTrajectories,
  isAbortError,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import { revealMotion } from "./motionPresets";
import { getSessionHomePath, readSession, sessionMatches } from "./session";
import type { Discipline, Student, StudentLearningTrajectorySummary } from "./types";

const MotionLink = motion(Link);

const trajectoryStatusLabel: Record<StudentLearningTrajectorySummary["status"], string> = {
  draft: "Черновик",
  active: "Активна",
  archived: "Архив",
};

const trajectoryStatusOrder: Record<StudentLearningTrajectorySummary["status"], number> = {
  active: 0,
  draft: 1,
  archived: 2,
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
  const [searchParams] = useSearchParams();
  const isAdminViewer = searchParams.get("viewer") === "admin" && readSession()?.role === "admin";

  const [student, setStudent] = useState<Student | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [trajectories, setTrajectories] = useState<StudentLearningTrajectorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const activeSession = readSession();
    if (!isAdminViewer && !sessionMatches(activeSession, "student", studentId)) {
      navigate(getSessionHomePath(activeSession), { replace: true });
    }
  }, [isAdminViewer, navigate, studentId]);

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

        const [nextStudent, nextDisciplines] = await Promise.all([
          fetchStudent(currentStudentId, controller.signal),
          fetchDisciplines(controller.signal),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        const nextTrajectories = nextStudent
          ? await fetchStudentLearningTrajectories(currentStudentId, controller.signal)
          : [];

        if (controller.signal.aborted) {
          return;
        }

        setStudent(nextStudent);
        setDisciplines(nextDisciplines);
        setTrajectories(nextTrajectories);
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

  const disciplineById = useMemo(
    () => new Map(disciplines.map((discipline) => [discipline.id, discipline])),
    [disciplines],
  );

  const sortedTrajectories = useMemo(
    () =>
      [...trajectories].sort((left, right) => {
        const statusDiff =
          trajectoryStatusOrder[left.status] - trajectoryStatusOrder[right.status];
        if (statusDiff !== 0) {
          return statusDiff;
        }
        return left.name.localeCompare(right.name, "ru");
      }),
    [trajectories],
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

  if (!studentId) {
    return null;
  }

  async function handleDelete() {
    if (!isAdminViewer || !student) {
      return;
    }

    const confirmed = window.confirm(
      `Удалить студента "${student.name}"? Это действие нельзя отменить.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      await deleteStudent(student.id);
      navigate(getSessionHomePath(readSession()), { replace: true });
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : "Не удалось удалить студента.",
      );
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page-shell role-page immersive-page immersive-page--student">
      <motion.header
        className="hero immersive-page__hero role-dashboard-hero"
        {...revealMotion(0.02)}
      >
        <div>
          <p className="hero__eyebrow">
            {isAdminViewer ? "Просмотр студента" : "Кабинет студента"}
          </p>
          <h1>{student?.name ?? "Студент"}</h1>
        </div>
        {isAdminViewer ? (
          <div className="hero__controls">
            <button
              className="secondary-button secondary-button--danger"
              disabled={!student || deleting}
              onClick={() => void handleDelete()}
              type="button"
            >
              Удалить студента
            </button>
          </div>
        ) : null}
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
                <h2>Все назначенные траектории</h2>
              </div>
            </div>

            <div className="student-trajectory-grid student-trajectory-grid--compact">
              {sortedTrajectories.length ? (
                sortedTrajectories.map((trajectory) => {
                  const discipline = disciplineById.get(trajectory.discipline_id);
                  const progress = clampPercent(trajectory.progress_percent);

                  const cardContent = (
                    <>
                      <div className="student-trajectory-card__head">
                        <div>
                          <strong>{trajectory.name}</strong>
                          <span>{discipline?.name ?? "Дисциплина не найдена"}</span>
                        </div>
                        <span className="hero__chip">{trajectoryStatusLabel[trajectory.status]}</span>
                      </div>
                      <div className="student-trajectory-card__meta">
                        <span>{trajectory.topic_count} тем</span>
                        <span>
                          {trajectory.completed_task_count}/{trajectory.total_task_count} заданий
                        </span>
                      </div>
                      <div className="student-progress" aria-label="Прогресс траектории">
                        <div className="student-progress__bar">
                          <i style={{ width: `${progress}%` }} />
                        </div>
                        <span>Прогресс: {progress}%</span>
                      </div>
                      <div className="student-trajectory-card__footer">
                        <span>{isAdminViewer ? "Только просмотр" : "Открыть траекторию"}</span>
                      </div>
                    </>
                  );

                  return isAdminViewer ? (
                    <article
                      className="student-trajectory-card student-trajectory-card--readonly"
                      key={trajectory.id}
                    >
                      {cardContent}
                    </article>
                  ) : (
                    <MotionLink
                      className="student-trajectory-card"
                      key={trajectory.id}
                      to={getTrajectoryPath(trajectory, discipline, studentId)}
                      {...revealMotion(0.02)}
                    >
                      {cardContent}
                    </MotionLink>
                  );
                })
              ) : (
                <p className="card__text">Активных траекторий пока нет.</p>
              )}
            </div>
          </motion.section>
        </main>
      )}
    </div>
  );
}
