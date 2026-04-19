import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import {
  createDiscipline,
  createGroup,
  createStudent,
  createTeacher,
  fetchDisciplines,
  fetchGroups,
  fetchStudents,
  fetchTeachers,
  isAbortError,
} from "./api";
import type { Discipline, Group, Student, Teacher } from "./types";

type DashboardData = {
  disciplines: Discipline[];
  groups: Group[];
  students: Student[];
  teachers: Teacher[];
};

type Feedback = {
  kind: "error" | "success";
  text: string;
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return "Не удалось выполнить запрос.";
}

function toggleId(items: string[], id: string) {
  return items.includes(id) ? items.filter((item) => item !== id) : [...items, id];
}

function shortId(id: string) {
  return id.slice(0, 8);
}

export function HomePage() {
  const [data, setData] = useState<DashboardData>({
    disciplines: [],
    groups: [],
    students: [],
    teachers: [],
  });

  const [disciplineName, setDisciplineName] = useState("");
  const [disciplineTeacherId, setDisciplineTeacherId] = useState("");
  const [disciplineGroupIds, setDisciplineGroupIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentGroupId, setStudentGroupId] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherGroupIds, setTeacherGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const groupById = useMemo(
    () => new Map(data.groups.map((group) => [group.id, group])),
    [data.groups],
  );

  const teacherById = useMemo(
    () => new Map(data.teachers.map((teacher) => [teacher.id, teacher])),
    [data.teachers],
  );

  const studentsByGroupId = useMemo(() => {
    const result = new Map<string, Student[]>();
    for (const student of data.students) {
      result.set(student.group_id, [...(result.get(student.group_id) ?? []), student]);
    }
    return result;
  }, [data.students]);

  async function loadDashboard(signal?: AbortSignal) {
    const [disciplines, groups, students, teachers] = await Promise.all([
      fetchDisciplines(signal),
      fetchGroups(signal),
      fetchStudents(signal),
      fetchTeachers(signal),
    ]);

    setData({ disciplines, groups, students, teachers });
    setStudentGroupId((current) => current || groups[0]?.id || "");
    setDisciplineTeacherId((current) => current || teachers[0]?.id || "");
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setFeedback(null);
        await loadDashboard(controller.signal);
      } catch (error) {
        if (!isAbortError(error)) {
          setFeedback({ kind: "error", text: extractErrorMessage(error) });
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();

    return () => controller.abort();
  }, []);

  useEffect(() => {
    setDisciplineGroupIds((current) =>
      current.filter((groupId) => data.groups.some((group) => group.id === groupId)),
    );
    setTeacherGroupIds((current) =>
      current.filter((groupId) => data.groups.some((group) => group.id === groupId)),
    );
  }, [data.groups]);

  useEffect(() => {
    if (disciplineTeacherId && data.teachers.some((teacher) => teacher.id === disciplineTeacherId)) {
      return;
    }

    setDisciplineTeacherId(data.teachers[0]?.id || "");
  }, [data.teachers, disciplineTeacherId]);

  async function refreshAfterChange(message: string) {
    await loadDashboard();
    setFeedback({ kind: "success", text: message });
  }

  async function handleCreateDiscipline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = disciplineName.trim();
    if (!name || !disciplineTeacherId) return;

    try {
      setBusyAction("discipline");
      setFeedback(null);
      await createDiscipline({
        name,
        teacher_id: disciplineTeacherId,
        group_ids: disciplineGroupIds,
      });
      setDisciplineName("");
      setDisciplineGroupIds([]);
      await refreshAfterChange("Дисциплина создана и привязана к преподавателю.");
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) return;

    try {
      setBusyAction("group");
      setFeedback(null);
      const group = await createGroup({ name });
      setGroupName("");
      setStudentGroupId(group.id);
      await refreshAfterChange("Группа создана.");
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = studentName.trim();
    if (!name || !studentGroupId) return;

    try {
      setBusyAction("student");
      setFeedback(null);
      await createStudent({
        name,
        group_id: studentGroupId,
        subgroup_id: null,
      });
      setStudentName("");
      await refreshAfterChange("Студент создан и привязан к группе.");
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teacherName.trim();
    if (!name) return;

    try {
      setBusyAction("teacher");
      setFeedback(null);
      const teacher = await createTeacher({ name, group_ids: teacherGroupIds });
      setTeacherName("");
      setTeacherGroupIds([]);
      setDisciplineTeacherId(teacher.id);
      await refreshAfterChange("Преподаватель создан.");
    } catch (error) {
      setFeedback({ kind: "error", text: extractErrorMessage(error) });
    } finally {
      setBusyAction("");
    }
  }

  return (
    <div className="home-shell">
      <header className="home-hero">
        <div>
          <p className="hero__eyebrow">Competence Hub</p>
          <h1>Главная панель</h1>
          <p className="home-hero__text">
            Создай преподавателей, группы, студентов и дисциплины. После выбора
            дисциплины можно перейти в уже готовый редактор графа знаний.
          </p>
        </div>

        <div className="home-stats">
          <span>{data.disciplines.length} дисциплин</span>
          <span>{data.groups.length} групп</span>
          <span>{data.students.length} студентов</span>
          <span>{data.teachers.length} преподавателей</span>
        </div>
      </header>

      {feedback ? (
        <div className={`home-feedback home-feedback--${feedback.kind}`}>{feedback.text}</div>
      ) : null}

      <main className="home-grid">
        <section className="home-card home-card--wide">
          <div className="home-card__header">
            <div>
              <p className="card__eyebrow">Дисциплины</p>
              <h2>Графы знаний</h2>
            </div>
          </div>

          <form className="home-form" onSubmit={handleCreateDiscipline}>
            <div className="home-form--inline">
              <label className="field">
                <span>Название дисциплины</span>
                <input
                  value={disciplineName}
                  onChange={(event) => setDisciplineName(event.target.value)}
                  placeholder="Например: Теория графов"
                  required
                />
              </label>

              <label className="field">
                <span>Преподаватель</span>
                <select
                  value={disciplineTeacherId}
                  onChange={(event) => setDisciplineTeacherId(event.target.value)}
                  disabled={!data.teachers.length}
                  required
                >
                  {data.teachers.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              </label>

              <button
                className="primary-button"
                disabled={busyAction === "discipline" || !disciplineTeacherId}
              >
                {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
              </button>
            </div>

            {!data.teachers.length ? (
              <p className="home-hint">
                Сначала создай преподавателя, затем он сможет создать дисциплину.
              </p>
            ) : null}

            <div className="home-checklist">
              <span>Группы, у которых преподаватель ведет эту дисциплину</span>
              {data.groups.length ? (
                data.groups.map((group) => (
                  <label className="home-check" key={group.id}>
                    <input
                      checked={disciplineGroupIds.includes(group.id)}
                      onChange={() =>
                        setDisciplineGroupIds((current) => toggleId(current, group.id))
                      }
                      type="checkbox"
                    />
                    {group.name}
                  </label>
                ))
              ) : (
                <p className="home-hint">Групп пока нет. Дисциплину можно создать без групп.</p>
              )}
            </div>
          </form>

          <div className="discipline-list">
            {loading ? <p className="card__text">Загружаю дисциплины...</p> : null}
            {!loading && !data.disciplines.length ? (
              <p className="card__text">Пока нет дисциплин. Создай первую выше.</p>
            ) : null}
            {data.disciplines.map((discipline) => {
              const teachers = discipline.teacher_ids
                .map((teacherId) => teacherById.get(teacherId)?.name)
                .filter(Boolean);
              const groups = discipline.group_ids
                .map((groupId) => groupById.get(groupId)?.name)
                .filter(Boolean);

              return (
                <article className="discipline-row" key={discipline.id}>
                  <div>
                    <strong>{discipline.name}</strong>
                    <span>ID: {shortId(discipline.id)}</span>
                    <small>
                      Преподаватель: {teachers.length ? teachers.join(", ") : "не выбран"}
                    </small>
                    <small>Группы: {groups.length ? groups.join(", ") : "не назначены"}</small>
                  </div>
                  <div className="discipline-row__actions">
                    <Link
                      className="primary-button discipline-row__action"
                      to={`/disciplines/${discipline.id}/knowledge`}
                    >
                      Открыть редактор
                    </Link>
                    <Link
                      className="secondary-button discipline-row__action"
                      to={`/disciplines/${discipline.id}/trajectory`}
                    >
                      Собрать траекторию
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="home-card">
          <p className="card__eyebrow">Группы</p>
          <h2>Создать группу</h2>
          <form className="home-form" onSubmit={handleCreateGroup}>
            <label className="field">
              <span>Название группы</span>
              <input
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                placeholder="Например: ИВТ-21"
                required
              />
            </label>
            <button className="primary-button" disabled={busyAction === "group"}>
              {busyAction === "group" ? "Создаю..." : "Создать группу"}
            </button>
          </form>
        </section>

        <section className="home-card">
          <p className="card__eyebrow">Студенты</p>
          <h2>Создать студента</h2>
          <form className="home-form" onSubmit={handleCreateStudent}>
            <label className="field">
              <span>ФИО студента</span>
              <input
                value={studentName}
                onChange={(event) => setStudentName(event.target.value)}
                placeholder="Иванов Иван"
                required
              />
            </label>
            <label className="field">
              <span>Группа</span>
              <select
                value={studentGroupId}
                onChange={(event) => setStudentGroupId(event.target.value)}
                disabled={!data.groups.length}
                required
              >
                {data.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            {!data.groups.length ? (
              <p className="home-hint">Сначала создай группу, затем можно добавить студента.</p>
            ) : null}
            <button
              className="primary-button"
              disabled={busyAction === "student" || !studentGroupId}
            >
              {busyAction === "student" ? "Создаю..." : "Создать студента"}
            </button>
          </form>
        </section>

        <section className="home-card">
          <p className="card__eyebrow">Преподаватели</p>
          <h2>Создать преподавателя</h2>
          <form className="home-form" onSubmit={handleCreateTeacher}>
            <label className="field">
              <span>ФИО преподавателя</span>
              <input
                value={teacherName}
                onChange={(event) => setTeacherName(event.target.value)}
                placeholder="Петров Петр"
                required
              />
            </label>

            <div className="home-checklist">
              <span>Группы преподавателя</span>
              {data.groups.length ? (
                data.groups.map((group) => (
                  <label className="home-check" key={group.id}>
                    <input
                      checked={teacherGroupIds.includes(group.id)}
                      onChange={() =>
                        setTeacherGroupIds((current) => toggleId(current, group.id))
                      }
                      type="checkbox"
                    />
                    {group.name}
                  </label>
                ))
              ) : (
                <p className="home-hint">
                  Группы можно добавить позже через создание дисциплины.
                </p>
              )}
            </div>

            <button className="primary-button" disabled={busyAction === "teacher"}>
              {busyAction === "teacher" ? "Создаю..." : "Создать преподавателя"}
            </button>
          </form>
        </section>

        <section className="home-card home-card--wide">
          <p className="card__eyebrow">Текущий состав</p>
          <div className="home-lists">
            <div>
              <h3>Группы</h3>
              {data.groups.length ? (
                data.groups.map((group) => <span key={group.id}>{group.name}</span>)
              ) : (
                <p className="home-hint">Нет групп.</p>
              )}
            </div>
            <div>
              <h3>Студенты</h3>
              {data.students.length ? (
                data.students.map((student) => (
                  <span key={student.id}>
                    {student.name} · {groupById.get(student.group_id)?.name ?? "без группы"}
                  </span>
                ))
              ) : (
                <p className="home-hint">Нет студентов.</p>
              )}
            </div>
            <div>
              <h3>Преподаватели и доступ к студентам</h3>
              {data.teachers.length ? (
                data.teachers.map((teacher) => {
                  const groups = teacher.group_ids
                    .map((groupId) => groupById.get(groupId))
                    .filter((group): group is Group => Boolean(group));

                  return (
                    <article className="teacher-card" key={teacher.id}>
                      <strong>{teacher.name}</strong>
                      {groups.length ? (
                        groups.map((group) => {
                          const students = studentsByGroupId.get(group.id) ?? [];

                          return (
                            <p key={group.id}>
                              {group.name}:{" "}
                              {students.length
                                ? students.map((student) => student.name).join(", ")
                                : "студентов пока нет"}
                            </p>
                          );
                        })
                      ) : (
                        <p>Группы пока не назначены.</p>
                      )}
                    </article>
                  );
                })
              ) : (
                <p className="home-hint">Нет преподавателей.</p>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
