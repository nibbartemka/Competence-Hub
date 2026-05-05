import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchGroups,
  fetchStudent,
  fetchStudentLearningTrajectories,
  fetchSubgroups,
  isAbortError,
} from "./api";
import { actionHoverMotion, cardHoverMotion, revealMotion } from "./motionPresets";
import type { Group, Student, StudentLearningTrajectorySummary, Subgroup } from "./types";

const MotionLink = motion(Link);

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось загрузить страницу студента.";
}

export default function StudentHomePage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [student, setStudent] = useState<Student | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [trajectories, setTrajectories] = useState<StudentLearningTrajectorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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

        const [nextStudent, nextGroups, nextTrajectories] = await Promise.all([
          fetchStudent(currentStudentId, controller.signal),
          fetchGroups(controller.signal),
          fetchStudentLearningTrajectories(currentStudentId, controller.signal),
        ]);

        if (controller.signal.aborted) {
          return;
        }

        const nextSubgroups = nextStudent?.group_id
          ? await fetchSubgroups(nextStudent.group_id, controller.signal)
          : [];

        if (controller.signal.aborted) {
          return;
        }

        setStudent(nextStudent);
        setGroups(nextGroups);
        setSubgroups(nextSubgroups);
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

  const groupById = useMemo(
    () => new Map(groups.map((group) => [group.id, group.name])),
    [groups],
  );
  const subgroupById = useMemo(
    () => new Map(subgroups.map((subgroup) => [subgroup.id, subgroup.subgroup_num])),
    [subgroups],
  );

  if (!studentId) {
    return null;
  }

  return (
    <div className="student-home-page immersive-page immersive-page--student">
      <header className="landing-header">
        <div className="landing-header__brand">
          <span className="hero__eyebrow">COMPETENCE HUB</span>
          <strong>Главная страница студента</strong>
        </div>
        <nav className="landing-header__actions">
          <MotionLink className="ghost-button" to="/" {...actionHoverMotion}>
            На главную
          </MotionLink>
        </nav>
      </header>

      <main className="landing-main">
        <motion.section className="home-card student-home-hero" {...revealMotion(0.04)} {...cardHoverMotion}>
          <div>
            <p className="card__eyebrow">Профиль</p>
            <h1>{student?.name ?? "Студент"}</h1>
            <p className="hero__subtitle">
              Отсюда можно перейти в личный кабинет, где находятся профиль и назначенные
              траектории контроля.
            </p>
          </div>
          <div className="student-home-hero__actions">
            <MotionLink
              className="primary-button"
              to={`/students/${studentId}`}
              {...actionHoverMotion}
            >
              Открыть личный кабинет
            </MotionLink>
            <button
              className="secondary-button"
              onClick={() => navigate("/")}
              type="button"
            >
              Сменить студента
            </button>
          </div>
        </motion.section>

        {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

        {loading ? (
          <section className="status-view">
            <div className="status-view__pulse" />
            <h3>Загружаю данные студента</h3>
          </section>
        ) : (
          <section className="landing-role-grid">
            <motion.article className="home-card" {...revealMotion(0.08)} {...cardHoverMotion}>
              <p className="card__eyebrow">Текущий профиль</p>
              <h2>Данные студента</h2>
              <div className="student-home-profile">
                <div>
                  <span>Группа</span>
                  <strong>
                    {student?.group_id
                      ? groupById.get(student.group_id) ?? "Группа не найдена"
                      : "Не назначена"}
                  </strong>
                </div>
                <div>
                  <span>Подгруппа</span>
                  <strong>
                    {student?.subgroup_id
                      ? `№ ${subgroupById.get(student.subgroup_id) ?? "не найдена"}`
                      : "Не назначена"}
                  </strong>
                </div>
              </div>
            </motion.article>

            <motion.article className="home-card" {...revealMotion(0.12)} {...cardHoverMotion}>
              <p className="card__eyebrow">Траектории контроля</p>
              <h2>Назначено</h2>
              <div className="student-home-trajectories">
                <strong>{trajectories.length}</strong>
                <p className="card__text">
                  {trajectories.length
                    ? "Все траектории доступны из личного кабинета."
                    : "Пока нет назначенных траекторий."}
                </p>
                <MotionLink
                  className="secondary-button"
                  to={`/students/${studentId}`}
                  {...actionHoverMotion}
                >
                  Перейти к траекториям
                </MotionLink>
              </div>
            </motion.article>
          </section>
        )}
      </main>
    </div>
  );
}
