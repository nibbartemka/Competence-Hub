import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplines,
  fetchGroups,
  fetchStudents,
  fetchTeachers,
  isAbortError,
} from "./api";
import type { Discipline, Group, Student, Teacher } from "./types";

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось загрузить кабинет преподавателя.";
}

export default function TeacherDashboardPage() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const navigate = useNavigate();

  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        const [nextTeachers, nextDisciplines, nextGroups, nextStudents] = await Promise.all([
          fetchTeachers(controller.signal),
          fetchDisciplines(controller.signal),
          fetchGroups(controller.signal),
          fetchStudents(controller.signal),
        ]);
        setTeachers(nextTeachers);
        setDisciplines(nextDisciplines);
        setGroups(nextGroups);
        setStudents(nextStudents);
      } catch (loadError) {
        if (!isAbortError(loadError)) setError(extractErrorMessage(loadError));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, []);

  const teacher = teachers.find((item) => item.id === teacherId);
  const teacherGroups = useMemo(
    () => groups.filter((group) => teacher?.group_ids.includes(group.id)),
    [groups, teacher],
  );
  const teacherDisciplines = useMemo(
    () => disciplines.filter((discipline) => discipline.teacher_ids.includes(teacherId ?? "")),
    [disciplines, teacherId],
  );

  if (!teacherId) return null;

  return (
    <div className="page-shell role-page">
      <header className="hero">
        <div>
          <p className="hero__eyebrow">Роль: преподаватель</p>
          <h1>{teacher?.name ?? "Преподаватель"}</h1>
          <p className="hero__subtitle">
            Дисциплины, группы и доступ к студентам через назначенные группы.
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
          <h3>Загружаю кабинет</h3>
        </section>
      ) : (
        <main className="overview-grid">
          <section className="card card--soft overview-card overview-card--wide">
            <p className="card__eyebrow">Дисциплины преподавателя</p>
            <div className="discipline-list">
              {teacherDisciplines.length ? (
                teacherDisciplines.map((discipline) => (
                  <article className="discipline-row" key={discipline.id}>
                    <div>
                      <strong>{discipline.name}</strong>
                      <span>Версия графа {discipline.knowledge_graph_version}</span>
                    </div>
                    <div className="discipline-row__actions">
                      <Link className="primary-button" to={`/disciplines/${discipline.id}`}>
                        Паспорт
                      </Link>
                      <Link
                        className="secondary-button"
                        to={`/disciplines/${discipline.id}/knowledge`}
                      >
                        Граф
                      </Link>
                    </div>
                  </article>
                ))
              ) : (
                <p className="card__text">Дисциплины пока не назначены.</p>
              )}
            </div>
          </section>

          <section className="card card--soft overview-card overview-card--wide">
            <p className="card__eyebrow">Группы и студенты</p>
            <div className="home-lists">
              {teacherGroups.length ? (
                teacherGroups.map((group) => {
                  const groupStudents = students.filter((student) => student.group_id === group.id);

                  return (
                    <div key={group.id}>
                      <h3>{group.name}</h3>
                      {groupStudents.length ? (
                        groupStudents.map((student) => (
                          <Link className="overview-row" key={student.id} to={`/students/${student.id}`}>
                            <strong>{student.name}</strong>
                            <span>Открыть страницу студента</span>
                          </Link>
                        ))
                      ) : (
                        <p className="home-hint">Студентов пока нет.</p>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="card__text">Группы пока не назначены.</p>
              )}
            </div>
          </section>
        </main>
      )}
    </div>
  );
}
