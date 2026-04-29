import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  LayoutGroup,
  motion,
  useInView,
  useScroll,
  useSpring,
  useTransform,
} from "motion/react";
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
import { disciplinePathValue } from "./disciplineRouting";
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

type AmbientSpot = {
  color: string;
  duration: number;
  id: string;
  size: number;
  x: number;
  y: number;
};

const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;
const MotionLink = motion(Link);
const AMBIENT_COLORS = [
  "radial-gradient(circle, rgba(104, 160, 255, 0.34), rgba(104, 160, 255, 0))",
  "radial-gradient(circle, rgba(104, 214, 173, 0.3), rgba(104, 214, 173, 0))",
  "radial-gradient(circle, rgba(247, 196, 124, 0.28), rgba(247, 196, 124, 0))",
  "radial-gradient(circle, rgba(233, 170, 219, 0.24), rgba(233, 170, 219, 0))",
] as const;

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

function buildReveal(delay = 0) {
  return {
    initial: { opacity: 0, y: 26, filter: "blur(10px)" },
    whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
    viewport: { once: true, amount: 0.18 },
    transition: {
      duration: 0.68,
      delay,
      ease: REVEAL_EASE,
    },
  };
}

function buildAmbientSpot(): AmbientSpot {
  const color = AMBIENT_COLORS[Math.floor(Math.random() * AMBIENT_COLORS.length)];

  return {
    color,
    duration: 7.5 + Math.random() * 4.5,
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    size: 150 + Math.round(Math.random() * 170),
    x: 6 + Math.random() * 84,
    y: 6 + Math.random() * 82,
  };
}

const INTERACTIVE_CARD_MOTION = {} as const;

const ACTION_MOTION = {} as const;

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
  const [ambientSpots, setAmbientSpots] = useState<AmbientSpot[]>(() =>
    Array.from({ length: 4 }, () => buildAmbientSpot()),
  );
  const heroRef = useRef<HTMLElement | null>(null);
  const summaryRef = useRef<HTMLElement | null>(null);

  const heroInView = useInView(heroRef, { amount: 0.45 });
  const summaryInView = useInView(summaryRef, { amount: 0.2, once: true });
  const { scrollYProgress } = useScroll();
  const heroParallax = useSpring(useTransform(scrollYProgress, [0, 0.35], [0, -42]), {
    stiffness: 110,
    damping: 24,
    mass: 0.35,
  });
  const ambientRotate = useSpring(useTransform(scrollYProgress, [0, 1], [0, 7]), {
    stiffness: 80,
    damping: 24,
    mass: 0.55,
  });
  const asideLift = useSpring(useTransform(scrollYProgress, [0, 0.3], [0, -18]), {
    stiffness: 120,
    damping: 24,
    mass: 0.3,
  });

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

  useEffect(() => {
    const intervalId = window.setInterval(() => {
      const nextSpot = buildAmbientSpot();
      setAmbientSpots((current) => [...current, nextSpot]);
      window.setTimeout(() => {
        setAmbientSpots((current) => current.filter((spot) => spot.id !== nextSpot.id));
      }, nextSpot.duration * 1000);
    }, 1700);

    return () => window.clearInterval(intervalId);
  }, []);

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
      <motion.div className="home-shell__ambient" aria-hidden="true" style={{ rotate: ambientRotate }}>
        <motion.div
          animate={{ x: [0, 18, -12, 0], y: [0, -20, 14, 0], scale: [1, 1.06, 0.96, 1] }}
          className="home-shell__orb home-shell__orb--blue"
          transition={{ duration: 18, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          animate={{ x: [0, -16, 12, 0], y: [0, 22, -10, 0], scale: [1, 0.95, 1.08, 1] }}
          className="home-shell__orb home-shell__orb--mint"
          transition={{ duration: 22, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          animate={{ x: [0, 12, -8, 0], y: [0, 14, -18, 0], scale: [1, 1.04, 0.98, 1] }}
          className="home-shell__orb home-shell__orb--gold"
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <AnimatePresence>
          {ambientSpots.map((spot) => (
            <motion.div
              animate={{
                filter: ["blur(2px)", "blur(14px)", "blur(18px)"],
                opacity: [0, 0.65, 0.32, 0],
                scale: [0.72, 1, 1.18, 1.28],
                x: [0, 10, -8, 0],
                y: [0, -12, 8, -4],
              }}
              className="home-shell__spot"
              exit={{ opacity: 0, scale: 0.86 }}
              initial={{ opacity: 0, scale: 0.62, filter: "blur(2px)" }}
              key={spot.id}
              style={{
                background: spot.color,
                height: spot.size,
                left: `${spot.x}%`,
                top: `${spot.y}%`,
                width: spot.size,
              }}
              transition={{ duration: spot.duration, ease: "easeInOut" }}
            />
          ))}
        </AnimatePresence>
      </motion.div>

      <motion.header
        animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
        className="home-hero"
        initial={{ opacity: 0, y: 30, filter: "blur(16px)" }}
        ref={heroRef}
        style={{ y: heroParallax }}
        transition={{ duration: 0.9, ease: REVEAL_EASE }}
      >
        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="home-hero__copy"
          initial={{ opacity: 0, x: -18 }}
          transition={{ duration: 0.72, delay: 0.08, ease: REVEAL_EASE }}
        >
          <p className="hero__eyebrow">Competence Hub</p>
          <h1>Competence Hub</h1>
          <p className="home-hero__text">
            Создай преподавателей, группы, студентов и дисциплины. После выбора дисциплины можно
            перейти в уже готовый редактор графа знаний или в конструктор траектории.
          </p>
        </motion.div>

        <motion.div
          animate={{ opacity: 1, x: 0 }}
          className="home-hero__aside"
          drag
          dragConstraints={{ bottom: 12, left: -18, right: 18, top: -12 }}
          dragElastic={0.18}
          initial={{ opacity: 0, x: 18 }}
          style={{ y: asideLift }}
          transition={{ duration: 0.72, delay: 0.14, ease: REVEAL_EASE }}
          whileDrag={{ cursor: "grabbing", scale: 1.01 }}
        >
          <div className="home-stats">
            <motion.span
              animate={heroInView ? { opacity: 1, y: 0 } : { opacity: 0.7, y: 6 }}
              {...ACTION_MOTION}
              initial={{ opacity: 0, y: 12 }}
              transition={{ delay: 0.18, duration: 0.4 }}
            >
              {data.disciplines.length} дисциплин
            </motion.span>
            <motion.span
              animate={heroInView ? { opacity: 1, y: 0 } : { opacity: 0.7, y: 6 }}
              {...ACTION_MOTION}
              initial={{ opacity: 0, y: 12 }}
              transition={{ delay: 0.24, duration: 0.4 }}
            >
              {data.groups.length} групп
            </motion.span>
            <motion.span
              animate={heroInView ? { opacity: 1, y: 0 } : { opacity: 0.7, y: 6 }}
              {...ACTION_MOTION}
              initial={{ opacity: 0, y: 12 }}
              transition={{ delay: 0.3, duration: 0.4 }}
            >
              {data.students.length} студентов
            </motion.span>
            <motion.span
              animate={heroInView ? { opacity: 1, y: 0 } : { opacity: 0.7, y: 6 }}
              {...ACTION_MOTION}
              initial={{ opacity: 0, y: 12 }}
              transition={{ delay: 0.36, duration: 0.4 }}
            >
              {data.teachers.length} преподавателей
            </motion.span>
          </div>
        </motion.div>
      </motion.header>

      <AnimatePresence mode="wait">
        {feedback ? (
          <motion.div
            animate={{ opacity: 1, y: 0 }}
            className={`home-feedback home-feedback--${feedback.kind}`}
            exit={{ opacity: 0, y: -10 }}
            initial={{ opacity: 0, y: -12 }}
            key={`${feedback.kind}:${feedback.text}`}
            transition={{ duration: 0.32, ease: REVEAL_EASE }}
          >
            {feedback.text}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <LayoutGroup>
        <main className="home-sections">
        <motion.section className="home-section" {...buildReveal(0.04)}>
          <motion.section
            className="home-card home-card--wide home-card--spotlight"
            layout
            {...INTERACTIVE_CARD_MOTION}
          >
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

                <motion.button
                  {...ACTION_MOTION}
                  className="primary-button"
                  disabled={busyAction === "discipline" || !disciplineTeacherId}
                  layout
                >
                  {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
                </motion.button>
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
                  <p className="home-hint">
                    Групп пока нет. Дисциплину можно создать и без группы.
                  </p>
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
                  <motion.article
                    animate={{ opacity: 1, y: 0 }}
                    className="discipline-row"
                    initial={{ opacity: 0, y: 16 }}
                    key={discipline.id}
                    layout
                    transition={{ duration: 0.32, ease: REVEAL_EASE }}
                  >
                    <div>
                      <strong>{discipline.name}</strong>
                      <span>ID: {shortId(discipline.id)}</span>
                      <small>
                        Преподаватель: {teachers.length ? teachers.join(", ") : "не выбран"}
                      </small>
                      <small>Группы: {groups.length ? groups.join(", ") : "не назначены"}</small>
                    </div>
                    <div className="discipline-row__actions">
                      <MotionLink
                        {...ACTION_MOTION}
                        className="secondary-button discipline-row__action"
                        layout
                        to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`}
                      >
                        Паспорт
                      </MotionLink>
                      <MotionLink
                        {...ACTION_MOTION}
                        className="primary-button discipline-row__action"
                        layout
                        to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/knowledge`}
                      >
                        Открыть редактор
                      </MotionLink>
                      <MotionLink
                        {...ACTION_MOTION}
                        className="secondary-button discipline-row__action"
                        layout
                        to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/trajectory`}
                      >
                        Собрать траекторию
                      </MotionLink>
                    </div>
                  </motion.article>
                );
              })}
            </div>
          </motion.section>
        </motion.section>

        <motion.section className="home-section" {...buildReveal(0.08)}>
          <div className="home-grid home-grid--triad">
            <motion.section
              className="home-card"
              layout
              {...buildReveal(0.1)}
              {...INTERACTIVE_CARD_MOTION}
            >
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
                <motion.button
                  {...ACTION_MOTION}
                  className="primary-button"
                  disabled={busyAction === "group"}
                  layout
                >
                  {busyAction === "group" ? "Создаю..." : "Создать группу"}
                </motion.button>
              </form>
            </motion.section>

            <motion.section
              className="home-card"
              layout
              {...buildReveal(0.14)}
              {...INTERACTIVE_CARD_MOTION}
            >
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

                <motion.button
                  {...ACTION_MOTION}
                  className="primary-button"
                  disabled={busyAction === "teacher"}
                  layout
                >
                  {busyAction === "teacher" ? "Создаю..." : "Создать преподавателя"}
                </motion.button>
              </form>
            </motion.section>

            <motion.section
              className="home-card"
              layout
              {...buildReveal(0.18)}
              {...INTERACTIVE_CARD_MOTION}
            >
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
                  <p className="home-hint">
                    Сначала создай группу, затем можно добавить студента.
                  </p>
                ) : null}
                <motion.button
                  {...ACTION_MOTION}
                  className="primary-button"
                  disabled={busyAction === "student" || !studentGroupId}
                  layout
                >
                  {busyAction === "student" ? "Создаю..." : "Создать студента"}
                </motion.button>
              </form>
            </motion.section>
          </div>
        </motion.section>

        <motion.section className="home-section" ref={summaryRef} {...buildReveal(0.12)}>
          <motion.section
            className="home-card home-card--wide"
            animate={summaryInView ? { opacity: 1, y: 0 } : { opacity: 0.96, y: 14 }}
            layout
            transition={{ duration: 0.5, ease: REVEAL_EASE }}
            {...INTERACTIVE_CARD_MOTION}
          >
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
                    <MotionLink
                      {...ACTION_MOTION}
                      className="overview-row"
                      key={student.id}
                      layout
                      to={`/students/${student.id}`}
                    >
                      {student.name} · {groupById.get(student.group_id)?.name ?? "без группы"}
                    </MotionLink>
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
                      <motion.article className="teacher-card" key={teacher.id} layout>
                        <MotionLink
                          {...ACTION_MOTION}
                          className="overview-row"
                          layout
                          to={`/teachers/${teacher.id}`}
                        >
                          <strong>{teacher.name}</strong>
                          <span>Открыть кабинет преподавателя</span>
                        </MotionLink>
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
                      </motion.article>
                    );
                  })
                ) : (
                  <p className="home-hint">Нет преподавателей.</p>
                )}
              </div>
            </div>
          </motion.section>
        </motion.section>
        </main>
      </LayoutGroup>
    </div>
  );
}
