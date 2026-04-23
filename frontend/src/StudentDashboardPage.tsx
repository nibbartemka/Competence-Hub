import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplines,
  fetchGroups,
  fetchStudentLearningTrajectories,
  fetchStudents,
  fetchSubgroups,
  isAbortError,
} from "./api";
import type { Discipline, Group, LearningTrajectory, Student, Subgroup } from "./types";

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось загрузить страницу студента.";
}

function trajectoryProgress(trajectory: LearningTrajectory) {
  const topicCount = trajectory.topics.length;
  const elementCount = trajectory.topics.reduce((sum, topic) => sum + topic.elements.length, 0);
  return {
    elementCount,
    elementProgressText: `0 / ${elementCount}`,
    percent: 0,
    topicCount,
    topicProgressText: `0 / ${topicCount}`,
    text: topicCount ? "Назначена, прохождение ещё не начато" : "Пустая траектория",
  };
}

export default function StudentDashboardPage() {
  const { studentId } = useParams<{ studentId: string }>();
  const navigate = useNavigate();

  const [students, setStudents] = useState<Student[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [trajectories, setTrajectories] = useState<LearningTrajectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!studentId) return;
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
        const nextStudent = nextStudents.find((item) => item.id === studentId);
        let nextTrajectories: LearningTrajectory[] = [];
        if (nextStudent) {
          try {
            nextTrajectories = await fetchStudentLearningTrajectories(
              studentId!,
              controller.signal,
            );
          } catch (trajectoryError) {
            if (!isAbortError(trajectoryError)) {
              setError("Профиль загружен, но назначенные траектории пока не удалось получить.");
            }
          }
        }
        const nextSubgroups = (
          await Promise.all(
            nextGroups.map((group) => fetchSubgroups(group.id, controller.signal)),
          )
        ).flat();

        setStudents(nextStudents);
        setGroups(nextGroups);
        setDisciplines(nextDisciplines);
        setTrajectories(nextTrajectories);
        setSubgroups(nextSubgroups);
        if (!nextStudent) {
          setError("Студент не найден. Возможно, запись была удалена или открыта старая ссылка.");
        }
      } catch (loadError) {
        if (!isAbortError(loadError)) setError(extractErrorMessage(loadError));
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

  if (!studentId) return null;

  return (
    <div className="page-shell role-page">
      <header className="hero">
        <div>
          <p className="hero__eyebrow">Роль: студент</p>
          <h1>{student?.name ?? "Студент"}</h1>
          <p className="hero__subtitle">
            Назначенные активные траектории, текущий статус и прогресс прохождения.
          </p>
        </div>
        <div className="hero__controls">
          <button className="ghost-button" onClick={() => navigate("/")} type="button">
            На главную
          </button>
        </div>
      </header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view">
          <div className="status-view__pulse" />
          <h3>Загружаю страницу студента</h3>
        </section>
      ) : (
        <main className="overview-grid">
          <section className="card card--soft overview-card">
            <p className="card__eyebrow">Профиль</p>
            <h2>{student?.name}</h2>
            <p className="card__text">
              Группа: {student ? groupById.get(student.group_id)?.name ?? "не найдена" : "не найдена"}
            </p>
            <p className="card__text">
              Подгруппа:{" "}
              {student?.subgroup_id
                ? `подгруппа ${subgroupById.get(student.subgroup_id)?.subgroup_num ?? "?"}`
                : "не назначена"}
            </p>
          </section>

          <section className="card card--soft overview-card overview-card--wide">
            <p className="card__eyebrow">Назначенные траектории</p>
            <div className="trajectory-saved-list">
              {trajectories.length ? (
                trajectories.map((trajectory) => {
                  const progress = trajectoryProgress(trajectory);
                  const discipline = disciplineById.get(trajectory.discipline_id);

                  return (
                    <Link
                      className="trajectory-saved-card"
                      key={trajectory.id}
                      to={`/disciplines/${trajectory.discipline_id}/trajectories/${trajectory.id}?preview=student&student=${studentId}`}
                    >
                      <strong>{trajectory.name}</strong>
                      <span>{discipline?.name ?? "Дисциплина не найдена"}</span>
                      <span>
                        {progress.text} · {progress.topicCount} тем · {progress.elementCount} элементов
                      </span>
                      <div className="student-progress" aria-label="Прогресс прохождения">
                        <div className="student-progress__bar">
                          <i style={{ width: `${progress.percent}%` }} />
                        </div>
                        <span>Прогресс: {progress.percent}%</span>
                        <span>Темы: {progress.topicProgressText}</span>
                        <span>Элементы: {progress.elementProgressText}</span>
                      </div>
                    </Link>
                  );
                })
              ) : (
                <p className="card__text">
                  Для студента пока нет активных траекторий. Черновики преподавателя здесь не показываются.
                </p>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
