import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, LayoutGroup, motion } from "motion/react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  createAdmin,
  createDiscipline,
  createExpert,
  createGroup,
  createStudent,
  createTeacher,
  fetchAdmins,
  fetchDisciplines,
  fetchExperts,
  fetchGroups,
  fetchStudents,
  fetchTeachers,
  isAbortError,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import type { Admin, Discipline, Expert, Group, Student, Teacher } from "./types";

type DashboardData = {
  admins: Admin[];
  disciplines: Discipline[];
  experts: Expert[];
  groups: Group[];
  students: Student[];
  teachers: Teacher[];
};

type Feedback = {
  kind: "error" | "success";
  text: string;
};

type ToastMessage = Feedback & {
  id: string;
};

const MotionLink = motion(Link);
const REVEAL_EASE = [0.22, 1, 0.36, 1] as const;
const CARD_MOTION = {} as const;
const ACTION_MOTION = {} as const;

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
    initial: { opacity: 0, y: 20, filter: "blur(8px)" },
    whileInView: { opacity: 1, y: 0, filter: "blur(0px)" },
    viewport: { once: true, amount: 0.18 },
    transition: {
      duration: 0.55,
      delay,
      ease: REVEAL_EASE,
    },
  };
}

export function HomePage() {
  const { teacherId, adminId, expertId } = useParams<{
    teacherId?: string;
    adminId?: string;
    expertId?: string;
  }>();
  const navigate = useNavigate();
  const mode = adminId ? "admin" : expertId ? "expert" : "teacher";
  const isAdminMode = mode === "admin";
  const isExpertMode = mode === "expert";
  const isTeacherMode = mode === "teacher";

  const [data, setData] = useState<DashboardData>({
    admins: [],
    disciplines: [],
    experts: [],
    groups: [],
    students: [],
    teachers: [],
  });

  const [disciplineName, setDisciplineName] = useState("");
  const [disciplineTeacherId, setDisciplineTeacherId] = useState("");
  const [disciplineGroupIds, setDisciplineGroupIds] = useState<string[]>([]);
  const [groupName, setGroupName] = useState("");
  const [studentName, setStudentName] = useState("");
  const [studentLogin, setStudentLogin] = useState("");
  const [studentPassword, setStudentPassword] = useState("");
  const [studentGroupId, setStudentGroupId] = useState("");
  const [teacherName, setTeacherName] = useState("");
  const [teacherLogin, setTeacherLogin] = useState("");
  const [teacherPassword, setTeacherPassword] = useState("");
  const [teacherGroupIds, setTeacherGroupIds] = useState<string[]>([]);
  const [expertName, setExpertName] = useState("");
  const [expertLogin, setExpertLogin] = useState("");
  const [expertPassword, setExpertPassword] = useState("");
  const [adminName, setAdminName] = useState("");
  const [adminLogin, setAdminLogin] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [studentSearch, setStudentSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [notifications, setNotifications] = useState<ToastMessage[]>([]);
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState<
    "group" | "teacher" | "student" | "expert" | "admin"
  >("student");
  const notificationTimersRef = useRef(new Map<string, number>());

  const groupById = useMemo(
    () => new Map(data.groups.map((group) => [group.id, group])),
    [data.groups],
  );
  const teacherById = useMemo(
    () => new Map(data.teachers.map((teacher) => [teacher.id, teacher])),
    [data.teachers],
  );
  const currentAdmin = useMemo(
    () => data.admins.find((admin) => admin.id === adminId) ?? null,
    [adminId, data.admins],
  );
  const currentExpert = useMemo(
    () => data.experts.find((expert) => expert.id === expertId) ?? null,
    [data.experts, expertId],
  );
  const currentTeacher = useMemo(
    () => data.teachers.find((teacher) => teacher.id === teacherId) ?? null,
    [data.teachers, teacherId],
  );
  const availableGroups = useMemo(() => {
    if (isAdminMode || !currentTeacher) {
      return data.groups;
    }
    const allowed = new Set(currentTeacher.group_ids);
    return data.groups.filter((group) => allowed.has(group.id));
  }, [currentTeacher, data.groups, isAdminMode]);
  const visibleStudents = useMemo(() => {
    if (isAdminMode || !currentTeacher) {
      return data.students;
    }
    const allowed = new Set(currentTeacher.group_ids);
    return data.students.filter((student) => allowed.has(student.group_id));
  }, [currentTeacher, data.students, isAdminMode]);
  const visibleDisciplines = useMemo(() => {
    if (isAdminMode || isExpertMode || !currentTeacher) {
      return data.disciplines;
    }
    return data.disciplines.filter((discipline) =>
      discipline.teacher_ids.includes(currentTeacher.id),
    );
  }, [currentTeacher, data.disciplines, isAdminMode, isExpertMode]);
  const searchableStudents = useMemo(() => {
    const query = studentSearch.trim().toLowerCase();
    if (!query) {
      return visibleStudents;
    }
    return visibleStudents.filter((student) => {
      const groupName = groupById.get(student.group_id)?.name ?? "";
      return `${student.name} ${student.login} ${groupName}`.toLowerCase().includes(query);
    });
  }, [groupById, studentSearch, visibleStudents]);
  const availableTeacherOptions = useMemo(() => {
    if (isAdminMode) {
      return data.teachers;
    }
    return currentTeacher ? [currentTeacher] : [];
  }, [currentTeacher, data.teachers, isAdminMode]);
  const studentsByGroupId = useMemo(() => {
    const result = new Map<string, Student[]>();
    for (const student of visibleStudents) {
      result.set(student.group_id, [...(result.get(student.group_id) ?? []), student]);
      }
    return result;
  }, [visibleStudents]);
  const pageTitle = isAdminMode
    ? "Кабинет администратора"
    : isExpertMode
      ? "Кабинет эксперта"
      : "Кабинет преподавателя";
  const pageDescription = isAdminMode
    ? "Администратор управляет учетными записями, группами, дисциплинами и имеет доступ ко всей системе."
    : isExpertMode
      ? "Эксперт работает с дисциплинами и графами знаний, не управляя студенческими и преподавательскими учетными записями."
      : "Преподаватель работает со своими дисциплинами, траекториями и студентами закрепленных групп.";
  const activePersonName = isAdminMode
    ? currentAdmin?.name
    : isExpertMode
      ? currentExpert?.name
      : currentTeacher?.name;
  const activePersonLogin = isAdminMode
    ? currentAdmin?.login
    : isExpertMode
      ? currentExpert?.login
      : currentTeacher?.login;
  const canCreateDiscipline =
    !busyAction &&
    disciplineName.trim() &&
    (isExpertMode || isTeacherMode ? true : Boolean(disciplineTeacherId));
  const topNavButtons = [
    ...(isAdminMode
      ? [
          {
            key: "add-user",
            label: "Добавить пользователя",
            onClick: () => setAdminModalOpen(true),
          },
        ]
      : []),
    {
      key: "switch-role",
      label: "Сменить роль",
      onClick: () => navigate("/"),
    },
    ...(isTeacherMode && teacherId
      ? [
          {
            key: "teacher-profile",
            label: "Личный кабинет",
            onClick: () => navigate(`/teachers/${teacherId}`),
          },
        ]
      : []),
  ];

  function dismissNotification(id: string) {
    const timer = notificationTimersRef.current.get(id);
    if (timer) {
      window.clearTimeout(timer);
      notificationTimersRef.current.delete(id);
    }
    setNotifications((current) => current.filter((notification) => notification.id !== id));
  }

  function pushNotification(kind: Feedback["kind"], text: string) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

    setNotifications((current) => {
      const alreadyShown = current.some(
        (notification) => notification.kind === kind && notification.text === text,
      );
      if (alreadyShown) {
        return current;
      }

      const next = [...current, { id, kind, text }];
      if (next.length > 3) {
        const removed = next.shift();
        if (removed) {
          const timer = notificationTimersRef.current.get(removed.id);
          if (timer) {
            window.clearTimeout(timer);
            notificationTimersRef.current.delete(removed.id);
          }
        }
      }
      return next;
    });

    const timer = window.setTimeout(() => {
      dismissNotification(id);
    }, 4500);
    notificationTimersRef.current.set(id, timer);
  }

  async function loadDashboard(signal?: AbortSignal) {
    const [admins, disciplines, experts, groups, students, teachers] = await Promise.all([
      fetchAdmins(signal),
      fetchDisciplines(signal),
      fetchExperts(signal),
      fetchGroups(signal),
      fetchStudents(signal),
      fetchTeachers(signal),
    ]);

    setData({ admins, disciplines, experts, groups, students, teachers });
  }

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        await loadDashboard(controller.signal);
      } catch (error) {
        if (!isAbortError(error)) {
          pushNotification("error", extractErrorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      controller.abort();
      notificationTimersRef.current.forEach((timer) => window.clearTimeout(timer));
      notificationTimersRef.current.clear();
    };
  }, []);

  useEffect(() => {
    if (isTeacherMode && currentTeacher) {
      setDisciplineTeacherId(currentTeacher.id);
      return;
    }

    if (
      disciplineTeacherId &&
      data.teachers.some((teacher) => teacher.id === disciplineTeacherId)
    ) {
      return;
    }

    setDisciplineTeacherId(data.teachers[0]?.id ?? "");
  }, [currentTeacher, data.teachers, disciplineTeacherId, isTeacherMode]);

  useEffect(() => {
    const allowed = new Set(availableGroups.map((group) => group.id));
    setDisciplineGroupIds((current) => current.filter((groupId) => allowed.has(groupId)));
    if (!isAdminMode) {
      setTeacherGroupIds([]);
    } else {
      setTeacherGroupIds((current) =>
        current.filter((groupId) => data.groups.some((group) => group.id === groupId)),
      );
    }
    setStudentGroupId((current) => {
      if (current && allowed.has(current)) {
        return current;
      }
      return availableGroups[0]?.id ?? "";
    });
  }, [availableGroups, data.groups, isAdminMode]);

  async function refreshAfterChange(message: string) {
    await loadDashboard();
    pushNotification("success", message);
  }

  async function handleCreateDiscipline(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = disciplineName.trim();
    const teacherForDiscipline = isTeacherMode
      ? currentTeacher?.id ?? ""
      : isAdminMode
        ? disciplineTeacherId
        : "";
    if (!name || (isTeacherMode && !teacherForDiscipline) || (isAdminMode && !teacherForDiscipline)) {
      return;
    }

    try {
      setBusyAction("discipline");
      await createDiscipline({
        name,
        teacher_id: teacherForDiscipline || null,
        group_ids: isExpertMode ? [] : disciplineGroupIds,
      });
      setDisciplineName("");
      setDisciplineGroupIds([]);
      await refreshAfterChange("Дисциплина создана.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateGroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = groupName.trim();
    if (!name) {
      return;
    }

    try {
      setBusyAction("group");
      const group = await createGroup({ name });
      setGroupName("");
      setStudentGroupId(group.id);
      await refreshAfterChange("Группа создана.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateTeacher(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = teacherName.trim();
    const login = teacherLogin.trim();
    const password = teacherPassword.trim();
    if (!name || !login || !password) {
      return;
    }

    try {
      setBusyAction("teacher");
      const teacher = await createTeacher({
        name,
        login,
        password,
        group_ids: teacherGroupIds,
      });
      setTeacherName("");
      setTeacherLogin("");
      setTeacherPassword("");
      setTeacherGroupIds([]);
      setDisciplineTeacherId(teacher.id);
      await refreshAfterChange("Учетная запись преподавателя создана.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = studentName.trim();
    const login = studentLogin.trim();
    const password = studentPassword.trim();
    if (!name || !login || !password || !studentGroupId) {
      return;
    }

    try {
      setBusyAction("student");
      await createStudent({
        name,
        login,
        password,
        group_id: studentGroupId,
        subgroup_id: null,
      });
      setStudentName("");
      setStudentLogin("");
      setStudentPassword("");
      await refreshAfterChange("Учетная запись студента создана.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateExpert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = expertName.trim();
    const login = expertLogin.trim();
    const password = expertPassword.trim();
    if (!name || !login || !password) {
      return;
    }

    try {
      setBusyAction("expert");
      await createExpert({ name, login, password });
      setExpertName("");
      setExpertLogin("");
      setExpertPassword("");
      await refreshAfterChange("Учетная запись эксперта создана.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  async function handleCreateAdmin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = adminName.trim();
    const login = adminLogin.trim();
    const password = adminPassword.trim();
    if (!name || !login || !password) {
      return;
    }

    try {
      setBusyAction("admin");
      await createAdmin({ name, login, password });
      setAdminName("");
      setAdminLogin("");
      setAdminPassword("");
      await refreshAfterChange("Учетная запись администратора создана.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

  function renderAdminManagementModal() {
    if (!isAdminMode || !adminModalOpen) {
      return null;
    }

    return (
      <div className="modal-backdrop" onClick={() => setAdminModalOpen(false)}>
        <div
          className="modal-panel admin-modal-panel"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-panel__header">
            <div>
              <p className="card__eyebrow">Управление системой</p>
              <h2>Добавить пользователя</h2>
            </div>
            <button
              className="ghost-button"
              onClick={() => setAdminModalOpen(false)}
              type="button"
            >
              Закрыть
            </button>
          </header>

          <div className="modal-panel__body">
            <div className="admin-modal-tabs">
              {[
                ["student", "Студент"],
                ["teacher", "Преподаватель"],
                ["expert", "Эксперт"],
                ["admin", "Администратор"],
                ["group", "Группа"],
              ].map(([key, label]) => (
                <button
                  className={adminModalTab === key ? "primary-button" : "secondary-button"}
                  key={key}
                  onClick={() =>
                    setAdminModalTab(
                      key as "group" | "teacher" | "student" | "expert" | "admin",
                    )
                  }
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="admin-modal-grid">
              {adminModalTab === "group" ? (
                <motion.section className="home-card" layout {...CARD_MOTION}>
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
                      className="primary-button"
                      disabled={busyAction === "group"}
                      layout
                      {...ACTION_MOTION}
                    >
                      {busyAction === "group" ? "Создаю..." : "Создать группу"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}

              {adminModalTab === "teacher" ? (
                <motion.section className="home-card" layout {...CARD_MOTION}>
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
                    <label className="field">
                      <span>Логин</span>
                      <input
                        value={teacherLogin}
                        onChange={(event) => setTeacherLogin(event.target.value)}
                        placeholder="petrov"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Пароль</span>
                      <input
                        type="password"
                        value={teacherPassword}
                        onChange={(event) => setTeacherPassword(event.target.value)}
                        placeholder="Введите пароль"
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
                        <p className="home-hint">Сначала создайте хотя бы одну группу.</p>
                      )}
                    </div>
                    <motion.button
                      className="primary-button"
                      disabled={busyAction === "teacher"}
                      layout
                      {...ACTION_MOTION}
                    >
                      {busyAction === "teacher" ? "Создаю..." : "Создать преподавателя"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}

              {adminModalTab === "student" ? (
                <motion.section className="home-card" layout {...CARD_MOTION}>
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
                      <span>Логин</span>
                      <input
                        value={studentLogin}
                        onChange={(event) => setStudentLogin(event.target.value)}
                        placeholder="ivanov"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Пароль</span>
                      <input
                        type="password"
                        value={studentPassword}
                        onChange={(event) => setStudentPassword(event.target.value)}
                        placeholder="Введите пароль"
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
                        Сначала создайте группу, затем можно добавить студента.
                      </p>
                    ) : null}
                    <motion.button
                      className="primary-button"
                      disabled={busyAction === "student" || !studentGroupId}
                      layout
                      {...ACTION_MOTION}
                    >
                      {busyAction === "student" ? "Создаю..." : "Создать студента"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}

              {adminModalTab === "expert" ? (
                <motion.section className="home-card" layout {...CARD_MOTION}>
                  <p className="card__eyebrow">Эксперты</p>
                  <h2>Создать эксперта</h2>
                  <form className="home-form" onSubmit={handleCreateExpert}>
                    <label className="field">
                      <span>ФИО эксперта</span>
                      <input
                        value={expertName}
                        onChange={(event) => setExpertName(event.target.value)}
                        placeholder="Смирнова Анна"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Логин</span>
                      <input
                        value={expertLogin}
                        onChange={(event) => setExpertLogin(event.target.value)}
                        placeholder="asmirnova"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Пароль</span>
                      <input
                        type="password"
                        value={expertPassword}
                        onChange={(event) => setExpertPassword(event.target.value)}
                        placeholder="Введите пароль"
                        required
                      />
                    </label>
                    <motion.button
                      className="primary-button"
                      disabled={busyAction === "expert"}
                      layout
                      {...ACTION_MOTION}
                    >
                      {busyAction === "expert" ? "Создаю..." : "Создать эксперта"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}

              {adminModalTab === "admin" ? (
                <motion.section className="home-card" layout {...CARD_MOTION}>
                  <p className="card__eyebrow">Администраторы</p>
                  <h2>Создать администратора</h2>
                  <form className="home-form" onSubmit={handleCreateAdmin}>
                    <label className="field">
                      <span>Имя администратора</span>
                      <input
                        value={adminName}
                        onChange={(event) => setAdminName(event.target.value)}
                        placeholder="Новый администратор"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Логин</span>
                      <input
                        value={adminLogin}
                        onChange={(event) => setAdminLogin(event.target.value)}
                        placeholder="newadmin"
                        required
                      />
                    </label>
                    <label className="field">
                      <span>Пароль</span>
                      <input
                        type="password"
                        value={adminPassword}
                        onChange={(event) => setAdminPassword(event.target.value)}
                        placeholder="Введите пароль"
                        required
                      />
                    </label>
                    <motion.button
                      className="primary-button"
                      disabled={busyAction === "admin"}
                      layout
                      {...ACTION_MOTION}
                    >
                      {busyAction === "admin" ? "Создаю..." : "Создать администратора"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="home-page immersive-page immersive-page--teacher">
      <motion.header className="home-hero teacher-home-hero" {...buildReveal(0.02)}>
        <div className="home-hero__topline">
          <div className="home-hero__brand">
            <span className="home-hero__logo" aria-hidden="true" />
            <p className="hero__eyebrow">COMPETENCE HUB</p>
          </div>
          <nav className="home-hero__nav" aria-label="Навигация кабинета">
            {topNavButtons.map((button) => (
              <button
                className="secondary-button"
                key={button.key}
                onClick={button.onClick}
                type="button"
              >
                {button.label}
              </button>
            ))}
          </nav>
          <button className="ghost-button home-hero__logout" onClick={() => navigate("/")} type="button">
            Выйти
          </button>
        </div>

        <div className="home-hero__body">
          <div className="home-hero__copy">
            <h1>{pageTitle}</h1>
            <p className="home-hero__text">{pageDescription}</p>
          </div>

          {isTeacherMode ? (
            <aside className="home-hero__aside teacher-home-hero__aside">
              <div className="home-stats">
                <span>Ваши дисциплины: {visibleDisciplines.length}</span>
                <span>Ваши студенты: {visibleStudents.length}</span>
                <span>Ваши группы: {availableGroups.length}</span>
                <span>{`Вход: ${currentTeacher?.name ?? "Преподаватель не найден"}`}</span>
              </div>
            </aside>
          ) : null}
        </div>
      </motion.header>

      <AnimatePresence>
        {notifications.length ? (
          <div className="toast-stack" aria-live="polite" aria-label="Уведомления">
            {notifications.map((notification) => (
              <motion.article
                className={`toast-message toast-message--${notification.kind}`}
                key={notification.id}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
              >
                <p>{notification.text}</p>
                <button
                  className="toast-message__close"
                  aria-label="Закрыть уведомление"
                  onClick={() => dismissNotification(notification.id)}
                  type="button"
                />
              </motion.article>
            ))}
          </div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>{renderAdminManagementModal()}</AnimatePresence>

      {isTeacherMode ? (
        <motion.section className="home-session-bar" {...buildReveal(0.04)}>
          <div className="home-session-bar__identity">
            <span className="card__eyebrow">Текущий вход</span>
            <strong>{activePersonName ?? "Пользователь не найден"}</strong>
            <small>
              {activePersonLogin
                ? `Логин: ${activePersonLogin}`
                : "Проверьте корректность ссылки или повторите вход."}
            </small>
          </div>
          <div className="home-session-bar__actions">
            <button
              className="ghost-button"
              onClick={() => navigate("/")}
              type="button"
            >
              Сменить преподавателя
            </button>
          </div>
        </motion.section>
      ) : null}

      <LayoutGroup>
        <main className="home-sections">
          {loading ? (
            <section className="status-view">
              <div className="status-view__pulse" />
              <h3>Загружаю данные рабочего экрана</h3>
            </section>
          ) : (
            <>
          <motion.section className="home-section" {...buildReveal(0.06)}>
            <motion.section
              className="home-card home-card--wide home-card--spotlight"
              layout
              {...CARD_MOTION}
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

                  {isAdminMode ? (
                    <label className="field">
                      <span>Преподаватель</span>
                      <select
                        value={disciplineTeacherId}
                        onChange={(event) => setDisciplineTeacherId(event.target.value)}
                        disabled={!availableTeacherOptions.length}
                        required
                      >
                        {availableTeacherOptions.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </option>
                        ))}
                      </select>
                    </label>
                  ) : isTeacherMode ? (
                    <label className="field">
                      <span>Преподаватель</span>
                      <input value={currentTeacher?.name ?? ""} readOnly />
                    </label>
                  ) : (
                    <div className="home-hint">
                      Эксперт создает дисциплину без назначения преподавателя. Преподавателя позже
                      может указать администратор.
                    </div>
                  )}

                  <motion.button
                    className="primary-button"
                    disabled={
                      busyAction === "discipline" || !canCreateDiscipline
                    }
                    layout
                    {...ACTION_MOTION}
                  >
                    {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
                  </motion.button>
                </div>

                {!isExpertMode ? (
                  <div className="home-checklist">
                    <span>Группы, которым назначается дисциплина</span>
                    {availableGroups.length ? (
                      availableGroups.map((group) => (
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
                        {isAdminMode
                          ? "Сначала создайте группу, затем ее можно будет привязать к дисциплине."
                          : "У преподавателя пока нет назначенных групп."}
                      </p>
                    )}
                  </div>
                ) : null}
              </form>

              <div className="discipline-list">
                {!loading && !visibleDisciplines.length ? (
                  <p className="card__text">
                    {isAdminMode
                      ? "Пока нет дисциплин. Создайте первую выше."
                      : isExpertMode
                        ? "Пока нет дисциплин. Создайте первую выше и переходите к графу знаний."
                        : "У этого преподавателя пока нет дисциплин."}
                  </p>
                ) : null}

                {visibleDisciplines.map((discipline) => {
                  const teachers = discipline.teacher_ids
                    .map((linkedTeacherId) => teacherById.get(linkedTeacherId)?.name)
                    .filter(Boolean);
                  const groups = discipline.group_ids
                    .map((groupId) => groupById.get(groupId)?.name)
                    .filter(Boolean);

                  return (
                    <motion.article
                      className="discipline-row"
                      key={discipline.id}
                      layout
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, ease: REVEAL_EASE }}
                    >
                      <div>
                        <strong>{discipline.name}</strong>
                        <span>ID: {shortId(discipline.id)}</span>
                        <small>
                          Преподаватель: {teachers.length ? teachers.join(", ") : "не назначен"}
                        </small>
                        <small>Группы: {groups.length ? groups.join(", ") : "не назначены"}</small>
                      </div>
                      <div className="discipline-row__actions">
                        <MotionLink
                          className="secondary-button discipline-row__action"
                          layout
                          to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`}
                          {...ACTION_MOTION}
                        >
                          Паспорт
                        </MotionLink>
                        <MotionLink
                          className="primary-button discipline-row__action"
                          layout
                          to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/knowledge`}
                          {...ACTION_MOTION}
                        >
                          Открыть редактор
                        </MotionLink>
                        {!isExpertMode ? (
                          <MotionLink
                            className="secondary-button discipline-row__action"
                            layout
                            to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/trajectory`}
                            {...ACTION_MOTION}
                          >
                            Собрать траекторию
                          </MotionLink>
                        ) : null}
                      </div>
                    </motion.article>
                  );
                })}
              </div>
            </motion.section>
          </motion.section>

          {!isExpertMode ? (
            <motion.section className="home-section" {...buildReveal(0.08)}>
              <motion.section
                className="home-card home-card--wide teacher-search-card"
                layout
                {...CARD_MOTION}
              >
                <div className="home-card__header">
                  <div>
                    <p className="card__eyebrow">Поиск студентов</p>
                    <h2>Быстрый переход к студенту</h2>
                  </div>
                </div>

                <label className="field">
                  <span>Поиск по ФИО, логину или группе</span>
                  <input
                    value={studentSearch}
                    onChange={(event) => setStudentSearch(event.target.value)}
                    placeholder="Например: Иванов, ivanov или Б9124-09.03.04"
                  />
                </label>

                <div className="teacher-student-search__results">
                  {searchableStudents.length ? (
                    searchableStudents.slice(0, 12).map((student) => (
                      <MotionLink
                        className="overview-row teacher-student-search__row"
                        key={student.id}
                        layout
                        to={`/students/${student.id}`}
                        {...ACTION_MOTION}
                      >
                        <strong>{student.name}</strong>
                        <span>
                          {student.login} ·{" "}
                          {groupById.get(student.group_id)?.name ?? "Группа не найдена"}
                        </span>
                      </MotionLink>
                    ))
                  ) : (
                    <p className="home-hint">Студенты по запросу не найдены.</p>
                  )}
                </div>
              </motion.section>
            </motion.section>
          ) : null}

          <motion.section className="home-section" {...buildReveal(0.12)}>
            <motion.section className="home-card home-card--wide" layout {...CARD_MOTION}>
              <p className="card__eyebrow">
                {isAdminMode ? "Текущий состав системы" : "Текущая рабочая область"}
              </p>
              <div className="home-lists">
                {isAdminMode ? (
                  <>
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
                            className="overview-row"
                            key={student.id}
                            layout
                            to={`/students/${student.id}`}
                            {...ACTION_MOTION}
                          >
                            {student.name} · {student.login}
                          </MotionLink>
                        ))
                      ) : (
                        <p className="home-hint">Нет студентов.</p>
                      )}
                    </div>
                    <div>
                      <h3>Преподаватели</h3>
                      {data.teachers.length ? (
                        data.teachers.map((teacher) => (
                          <motion.article className="teacher-card" key={teacher.id} layout>
                            <MotionLink
                              className="overview-row"
                              layout
                              to={`/teachers/${teacher.id}`}
                              {...ACTION_MOTION}
                            >
                              <strong>{teacher.name}</strong>
                              <span>{teacher.login}</span>
                            </MotionLink>
                            <p>
                              Групп в доступе: {teacher.group_ids.length}. Дисциплин:{" "}
                              {teacher.discipline_ids.length}.
                            </p>
                          </motion.article>
                        ))
                      ) : (
                        <p className="home-hint">Нет преподавателей.</p>
                      )}
                    </div>
                    <div>
                      <h3>Эксперты и администраторы</h3>
                      {data.experts.length || data.admins.length ? (
                        <>
                          {data.experts.map((expert) => (
                            <span key={expert.id}>{`Эксперт: ${expert.name} · ${expert.login}`}</span>
                          ))}
                          {data.admins.map((admin) => (
                            <span key={admin.id}>{`Администратор: ${admin.name} · ${admin.login}`}</span>
                          ))}
                        </>
                      ) : (
                        <p className="home-hint">Нет дополнительных учетных записей.</p>
                      )}
                    </div>
                  </>
                ) : isExpertMode ? (
                  <>
                    <div>
                      <h3>Дисциплины эксперта</h3>
                      {visibleDisciplines.length ? (
                        visibleDisciplines.map((discipline) => (
                          <span key={discipline.id}>{discipline.name}</span>
                        ))
                      ) : (
                        <p className="home-hint">Дисциплины пока не созданы.</p>
                      )}
                    </div>
                    <div>
                      <h3>Последние преподаватели</h3>
                      {data.teachers.length ? (
                        data.teachers.slice(0, 8).map((teacher) => (
                          <span key={teacher.id}>{teacher.name}</span>
                        ))
                      ) : (
                        <p className="home-hint">Преподаватели пока не созданы.</p>
                      )}
                    </div>
                    <div>
                      <h3>Экспертный контур</h3>
                      <p className="home-hint">
                        Открывайте дисциплины выше и переходите в граф знаний. Работа с
                        траекториями и учебными группами остается в зоне преподавателя и
                        администратора.
                      </p>
                    </div>
                  </>
                ) : (
                  <>
                    <div>
                      <h3>Мои дисциплины</h3>
                      {visibleDisciplines.length ? (
                        visibleDisciplines.map((discipline) => (
                          <span key={discipline.id}>{discipline.name}</span>
                        ))
                      ) : (
                        <p className="home-hint">Дисциплины пока не назначены.</p>
                      )}
                    </div>
                    <div>
                      <h3>Мои группы</h3>
                      {availableGroups.length ? (
                        availableGroups.map((group) => <span key={group.id}>{group.name}</span>)
                      ) : (
                        <p className="home-hint">Группы пока не назначены.</p>
                      )}
                    </div>
                    <div>
                      <h3>Мои студенты</h3>
                      {visibleStudents.length ? (
                        Array.from(studentsByGroupId.entries()).map(([groupId, students]) => (
                          <motion.article className="teacher-card" key={groupId} layout>
                            <strong>{groupById.get(groupId)?.name ?? "Группа"}</strong>
                            <p>
                              {students.length
                                ? students.map((student) => student.name).join(", ")
                                : "Студенты пока не назначены."}
                            </p>
                          </motion.article>
                        ))
                      ) : (
                        <p className="home-hint">Студенты пока не назначены.</p>
                      )}
                    </div>
                  </>
                )}
              </div>
            </motion.section>
          </motion.section>
            </>
          )}
        </main>
      </LayoutGroup>
    </div>
  );
}
