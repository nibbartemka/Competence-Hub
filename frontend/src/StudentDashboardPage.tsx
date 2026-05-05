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

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Не удалось загрузить страницу студента.";
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
              nextStudent.group_id
                ? fetchSubgroups(nextStudent.group_id, controller.signal)
                : Promise.resolve([] as Subgroup[]),
              fetchStudentLearningTrajectories(currentStudentId, controller.signal),
              nextStudent.group_id
                ? fetchStudentsByGroup(nextStudent.group_id, controller.signal)
                : Promise.resolve([] as Student[]),
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

  if (!studentId) {
    return null;
  }

  return (
    <div className="page-shell student-dashboard-page immersive-page immersive-page--student">
      <div className="page-shell__inner">
        <motion.header className="hero immersive-page__hero" {...revealMotion(0.02)}>
          <div>
            <p className="hero__eyebrow">COMPETENCE HUB</p>
            <h1>Кабинет студента</h1>
            <p className="hero__subtitle">
              Здесь видны профиль студента, назначенные траектории и переход к прохождению
              контроля через граф темы.
            </p>
          </div>
          <div className="hero__controls hero__controls--stack">
            <button
              className="ghost-button"
              onClick={() => navigate(`/students/${studentId}/home`)}
              type="button"
            >
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
                Выбери траекторию ниже. Задания открываются уже внутри графа выбранной траектории
                после перехода в нужную тему.
              </p>
            </motion.section>

            <motion.section
              className="card card--soft overview-card overview-card--wide"
              {...revealMotion(0.07)}
            >
              <div className="card__header">
                <div>
                  <p className="card__eyebrow">Группа и преподаватели</p>
                  <h2>Учебное окружение</h2>
                </div>
              </div>

              <div className="home-lists">
                <div>
                  <h3>Моя группа</h3>
                  <span>
                    {student?.group_id
                      ? groupById.get(student.group_id)?.name ?? "Группа не найдена"
                      : "Не назначена"}
                  </span>
                  <span>
                    {student?.subgroup_id
                      ? `Подгруппа № ${subgroupById.get(student.subgroup_id) ?? "не найдена"}`
                      : "Подгруппа не назначена"}
                  </span>
                </div>
                <div>
                  <h3>Состав группы</h3>
                  {classmates.length ? (
                    classmates.map((classmate) => <span key={classmate.id}>{classmate.name}</span>)
                  ) : (
                    <p className="home-hint">Кроме текущего студента в группе пока никого нет.</p>
                  )}
                </div>
                <div>
                  <h3>Преподаватели дисциплин</h3>
                  {trajectories.length ? (
                    trajectories.map((trajectory) => {
                      const discipline = disciplineById.get(trajectory.discipline_id);
                      const teacher = discipline?.teacher_ids.length
                        ? teacherById.get(discipline.teacher_ids[0])
                        : null;
                      return teacher ? (
                        <MotionLink
                          className="overview-row"
                          key={`${trajectory.id}-${teacher.id}`}
                          to={`/teachers/${teacher.id}`}
                        >
                          <strong>{discipline?.name ?? "Дисциплина"}</strong>
                          <span>{teacher.name}</span>
                        </MotionLink>
                      ) : (
                        <span key={trajectory.id}>
                          {discipline?.name ?? "Дисциплина"} · преподаватель не назначен
                        </span>
                      );
                    })
                  ) : (
                    <p className="home-hint">Назначенных дисциплин пока нет.</p>
                  )}
                </div>
              </div>
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
                    const linkedTeacher = discipline?.teacher_ids.length
                      ? teacherById.get(discipline.teacher_ids[0])
                      : null;
                    const remainingTasks = Math.max(
                      trajectory.total_task_count - trajectory.completed_task_count,
                      0,
                    );

                    return (
                      <MotionLink
                        className="student-trajectory-card"
                        key={trajectory.id}
                        to={`/disciplines/${disciplinePathValue(discipline, trajectory.discipline_id)}/trajectories/${trajectory.id}?preview=student&student=${studentId}`}
                        {...revealMotion(0.02)}
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
                              ? `Осталось пройти ${remainingTasks} заданий по этой траектории.`
                              : "Все текущие задания по этой траектории выполнены."
                            : "Траектория назначена, но задания пока не добавлены."}
                        </p>

                        <div className="student-progress" aria-label="Прогресс прохождения">
                          <div className="student-progress__bar">
                            <i style={{ width: `${trajectory.progress_percent}%` }} />
                          </div>
                          <span>Прогресс: {trajectory.progress_percent}%</span>
                          <span>
                            Выполнено {trajectory.completed_task_count} из {trajectory.total_task_count}{" "}
                            заданий
                          </span>
                        </div>

                        <div className="student-trajectory-card__footer">
                          <span>Открыть граф траектории</span>
                          {linkedTeacher ? <span>{linkedTeacher.name}</span> : null}
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
