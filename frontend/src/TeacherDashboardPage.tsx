import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplines,
  fetchGroups,
  fetchStudentsByGroup,
  fetchTeacher,
  fetchTeachers,
  isAbortError,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import { actionHoverMotion, cardHoverMotion, revealMotion } from "./motionPresets";
import type { Discipline, Group, Student, Teacher } from "./types";

const MotionLink = motion(Link);

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось загрузить кабинет преподавателя.";
}

export default function TeacherDashboardPage() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
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
        setError("");
        const [nextTeacher, nextDisciplines, nextGroups] = await Promise.all([
          teacherId ? fetchTeacher(teacherId, controller.signal) : fetchTeachers(controller.signal).then((items) => items[0]),
          fetchDisciplines(controller.signal),
          fetchGroups(controller.signal),
        ]);

        const nextStudents = (
          await Promise.all(
            (nextTeacher?.group_ids ?? []).map((groupId) =>
              fetchStudentsByGroup(groupId, controller.signal),
            ),
          )
        ).flat();

        setTeacher(nextTeacher ?? null);
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
  }, [teacherId]);

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
    <div className="page-shell role-page immersive-page immersive-page--teacher">
      <motion.header className="hero immersive-page__hero" {...revealMotion(0.02)}>
        <div>
          <p className="hero__eyebrow">Роль: преподаватель</p>
          <h1>{teacher?.name ?? "Преподаватель"}</h1>
          <p className="hero__subtitle">
            Дисциплины, группы и доступ к студентам через закреплённые учебные группы.
          </p>
        </div>
        <div className="hero__controls">
          <button className="ghost-button" onClick={() => navigate("/")} type="button">
            На главную
          </button>
        </div>
      </motion.header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view immersive-page__status">
          <div className="status-view__pulse" />
          <h3>Загружаю кабинет</h3>
        </section>
      ) : (
        <main className="overview-grid immersive-page__grid">
          <motion.section
            className="card card--soft overview-card overview-card--wide"
            {...revealMotion(0.05)}
            {...cardHoverMotion}
          >
            <p className="card__eyebrow">Дисциплины преподавателя</p>
            <div className="discipline-list">
              {teacherDisciplines.length ? (
                teacherDisciplines.map((discipline) => (
                  <motion.article className="discipline-row" key={discipline.id} layout {...actionHoverMotion}>
                    <div>
                      <strong>{discipline.name}</strong>
                      <span>Версия графа {discipline.knowledge_graph_version}</span>
                    </div>
                    <div className="discipline-row__actions">
                      <MotionLink className="primary-button" to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`} {...actionHoverMotion}>
                        Паспорт
                      </MotionLink>
                      <MotionLink
                        className="secondary-button"
                        to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/knowledge`}
                        {...actionHoverMotion}
                      >
                        Граф
                      </MotionLink>
                    </div>
                  </motion.article>
                ))
              ) : (
                <p className="card__text">Дисциплины пока не назначены.</p>
              )}
            </div>
          </motion.section>

          <motion.section
            className="card card--soft overview-card overview-card--wide"
            {...revealMotion(0.09)}
            {...cardHoverMotion}
          >
            <p className="card__eyebrow">Группы и студенты</p>
            <div className="home-lists">
              {teacherGroups.length ? (
                teacherGroups.map((group) => {
                  const groupStudents = students.filter((student) => student.group_id === group.id);

                  return (
                    <motion.div className="immersive-list-panel" key={group.id} layout {...actionHoverMotion}>
                      <h3>{group.name}</h3>
                      {groupStudents.length ? (
                        groupStudents.map((student) => (
                          <MotionLink
                            className="overview-row"
                            key={student.id}
                            to={`/students/${student.id}`}
                            {...actionHoverMotion}
                          >
                            <strong>{student.name}</strong>
                            <span>Открыть страницу студента</span>
                          </MotionLink>
                        ))
                      ) : (
                        <p className="home-hint">Студентов пока нет.</p>
                      )}
                    </motion.div>
                  );
                })
              ) : (
                <p className="card__text">Группы пока не назначены.</p>
              )}
            </div>
          </motion.section>
        </main>
      )}
    </div>
  );
}
