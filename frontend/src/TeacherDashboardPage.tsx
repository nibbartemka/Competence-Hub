import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplines,
  fetchGroups,
  fetchLearningTrajectories,
  fetchStudentsByGroup,
  fetchSubgroups,
  fetchTeacher,
  fetchTeachers,
  isAbortError,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import { ExitConfirmDialog } from "./ExitConfirmDialog";
import { actionHoverMotion, revealMotion } from "./motionPresets";
import type {
  Discipline,
  Group,
  LearningTrajectorySummary,
  Student,
  Subgroup,
  Teacher,
} from "./types";

const MotionLink = motion(Link);

const trajectoryStatusLabel: Record<LearningTrajectorySummary["status"], string> = {
  draft: "Черновик",
  active: "Активна",
  archived: "Архив",
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

export default function TeacherDashboardPage() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const navigate = useNavigate();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [trajectories, setTrajectories] = useState<LearningTrajectorySummary[]>([]);
  const [selectedDisciplineId, setSelectedDisciplineId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [exitConfirmOpen, setExitConfirmOpen] = useState(false);

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
                nextTeacher.group_ids.map((groupId) =>
                  fetchSubgroups(groupId, controller.signal),
                ),
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
    teacherDisciplines[0];

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

  if (!teacherId) {
    return null;
  }

  return (
    <div className="page-shell role-page immersive-page immersive-page--teacher">
      <motion.header className="hero immersive-page__hero role-dashboard-hero" {...revealMotion(0.02)}>
        <div>
          <p className="hero__eyebrow">Кабинет преподавателя</p>
          <h1>{teacher?.name ?? "Преподаватель"}</h1>
          <p className="hero__subtitle">
            Дисциплины, группы, траектории, задания, покрытие элементов и результаты студентов.
          </p>
        </div>
        <div className="hero__controls">
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
        </div>
      </motion.header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view immersive-page__status">
          <div className="status-view__pulse" />
          <h3>Загружаю кабинет преподавателя</h3>
        </section>
      ) : (
        <main className="role-dashboard">
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

          <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.05)}>
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Мои дисциплины</p>
                <h2>Дисциплины преподавателя</h2>
              </div>
            </div>
            <div className="role-card-grid">
              {teacherDisciplines.length ? (
                teacherDisciplines.map((discipline) => (
                  <article className="role-feature-card" key={discipline.id}>
                    <div>
                      <strong>{discipline.name}</strong>
                      <span>Версия графа: {discipline.knowledge_graph_version}</span>
                      <span>
                        Группы:{" "}
                        {discipline.group_ids.length
                          ? discipline.group_ids
                              .map((groupId) => groups.find((group) => group.id === groupId)?.name)
                              .filter(Boolean)
                              .join(", ")
                          : "не назначены"}
                      </span>
                    </div>
                    <div className="role-action-row">
                      <MotionLink
                        className="secondary-button"
                        to={`/disciplines/${getDisciplinePath(discipline, discipline.id)}`}
                        {...actionHoverMotion}
                      >
                        Паспорт
                      </MotionLink>
                      <MotionLink
                        className="primary-button"
                        to={`/disciplines/${getDisciplinePath(discipline, discipline.id)}/trajectory`}
                        {...actionHoverMotion}
                      >
                        Создать траекторию
                      </MotionLink>
                    </div>
                  </article>
                ))
              ) : (
                <p className="card__text">Дисциплины пока не назначены.</p>
              )}
            </div>
          </motion.section>

          <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.07)}>
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
                          <MotionLink key={student.id} to={`/students/${student.id}`} {...actionHoverMotion}>
                            {student.name}
                          </MotionLink>
                        ))}
                        {groupStudents.length > 6 ? <span>Еще {groupStudents.length - 6}</span> : null}
                      </div>
                      <span className="role-muted-note">Результаты группы будут показываться по траекториям.</span>
                    </article>
                  );
                })
              ) : (
                <p className="card__text">Для выбранной дисциплины группы не назначены.</p>
              )}
            </div>
          </motion.section>

          <div className="role-dashboard-two-column">
            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.09)}>
              <p className="card__eyebrow">Граф знаний</p>
              <h2>Просмотр графа дисциплины</h2>
              <p className="card__text">
                Преподаватель просматривает темы и элементы без редактирования базового графа.
              </p>
              {selectedDiscipline ? (
                <div className="role-action-row">
                  <MotionLink
                    className="primary-button"
                    to={`/disciplines/${getDisciplinePath(selectedDiscipline, selectedDiscipline.id)}/knowledge`}
                    {...actionHoverMotion}
                  >
                    Открыть граф знаний
                  </MotionLink>
                  <MotionLink
                    className="secondary-button"
                    to={`/disciplines/${getDisciplinePath(selectedDiscipline, selectedDiscipline.id)}`}
                    {...actionHoverMotion}
                  >
                    Темы и элементы
                  </MotionLink>
                </div>
              ) : (
                <p className="home-hint">Сначала администратор должен назначить дисциплину.</p>
              )}
            </motion.section>

            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.11)}>
              <p className="card__eyebrow">Покрытие</p>
              <h2>Покрытие элементов заданиями</h2>
              <div className="overview-stats">
                <span>Траекторий: {selectedTrajectories.length}</span>
                <span>Черновиков: {selectedTrajectories.filter((item) => item.status === "draft").length}</span>
                <span>Активных: {selectedTrajectories.filter((item) => item.status === "active").length}</span>
              </div>
              <p className="card__text">
                Детальная проверка покрытых и непокрытых элементов находится внутри страницы траектории.
              </p>
            </motion.section>
          </div>

          <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.13)}>
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Траектории</p>
                <h2>Создание, черновики, активация и архив</h2>
              </div>
              {selectedDiscipline ? (
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
                        <MotionLink
                          className="secondary-button"
                          to={`/disciplines/${getDisciplinePath(discipline, trajectory.discipline_id)}/trajectories/${trajectory.id}`}
                          {...actionHoverMotion}
                        >
                          Открыть
                        </MotionLink>
                        <MotionLink
                          className="secondary-button"
                          to={`/disciplines/${getDisciplinePath(discipline, trajectory.discipline_id)}/trajectories/${trajectory.id}`}
                          {...actionHoverMotion}
                        >
                          Порядок тем
                        </MotionLink>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="card__text">По выбранной дисциплине траекторий пока нет.</p>
              )}
            </div>
          </motion.section>

          <div className="role-dashboard-two-column">
            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.15)}>
              <p className="card__eyebrow">Задания</p>
              <h2>Банк заданий траекторий</h2>
              <p className="card__text">
                Создание задания, шаблон, тема, элемент, сложность, предпросмотр и фильтры находятся на странице выбранной траектории.
              </p>
              <div className="role-action-row">
                {selectedTrajectories[0] ? (
                  <MotionLink
                    className="primary-button"
                    to={`/disciplines/${getDisciplinePath(selectedDiscipline, selectedTrajectories[0].discipline_id)}/trajectories/${selectedTrajectories[0].id}`}
                    {...actionHoverMotion}
                  >
                    Перейти к заданиям
                  </MotionLink>
                ) : (
                  <span className="role-muted-note">Сначала создайте траекторию.</span>
                )}
              </div>
            </motion.section>

            <motion.section className="card card--soft role-dashboard-section" {...revealMotion(0.17)}>
              <p className="card__eyebrow">Результаты</p>
              <h2>Прогресс группы и студентов</h2>
              <div className="overview-stats">
                <span>Студентов: {selectedStudents.length}</span>
                <span>Групп: {selectedGroups.length}</span>
                <span>Активных траекторий: {trajectoriesByStatus.active}</span>
              </div>
              <p className="card__text">
                История попыток и проблемные элементы будут агрегироваться по траекториям и студентам.
              </p>
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
