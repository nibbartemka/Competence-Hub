import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  createAdmin,
  createDiscipline,
  createExpert,
  createGroup,
  createStudent,
  createSubgroup,
  createTeacher,
  deleteAdmin,
  deleteExpert,
  deleteStudent,
  deleteTeacher,
  fetchAdmins,
  fetchDisciplineKnowledgeGraph,
  fetchDisciplines,
  fetchExperts,
  fetchGroups,
  fetchStudents,
  fetchSubgroups,
  fetchTeachers,
  isAbortError,
  updateAdmin,
  updateDisciplineAssignments,
  updateExpert,
  updateStudent,
  updateTeacher,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import { getSessionHomePath, readSession, sessionMatches } from "./session";
import type {
  Admin,
  CompetenceType,
  Discipline,
  DisciplineKnowledgeGraph,
  Expert,
  Group,
  KnowledgeElement,
  KnowledgeElementRelation,
  Student,
  Subgroup,
  Teacher,
  Topic,
  TopicDependency,
  TopicKnowledgeElement,
} from "./types";

type DashboardData = {
  admins: Admin[];
  disciplines: Discipline[];
  experts: Expert[];
  groups: Group[];
  students: Student[];
  subgroups: Subgroup[];
  teachers: Teacher[];
};

type AdminUserRoleFilter = "all" | "student" | "teacher" | "expert" | "admin";
type AdminUserStatusFilter = "all" | "active" | "inactive";
type AdminModalTab = "group" | "subgroup" | "teacher" | "student" | "expert" | "admin";
type AdminCreateUserTab = "student" | "teacher" | "expert" | "admin";
type AdminGroupTab = "group" | "subgroup";

type AdminDirectoryUser = {
  id: string;
  name: string;
  login: string;
  role: Exclude<AdminUserRoleFilter, "all">;
  roleLabel: string;
  groupIds: string[];
  subgroupId?: string | null;
  disciplineIds: string[];
  status: AdminUserStatusFilter;
};

type Feedback = {
  kind: "error" | "success";
  text: string;
};

type ToastMessage = Feedback & {
  id: string;
};

type ExpertElementTypeFilter = "all" | CompetenceType;

type ExpertGraphDiagnostics = {
  cyclicDependencies: string[][];
  isolatedElements: KnowledgeElement[];
  isolatedTopics: Topic[];
  requiredNotFormed: KnowledgeElement[];
  topicsWithoutFormedElements: Topic[];
  totalIssues: number;
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
    initial: { opacity: 0, y: 20 },
    whileInView: { opacity: 1, y: 0 },
    viewport: { once: true, amount: 0.18 },
    transition: {
      duration: 0.55,
      delay,
      ease: REVEAL_EASE,
    },
  };
}

function competenceLabel(value: CompetenceType) {
  switch (value) {
    case "know":
      return "Знать";
    case "can":
      return "Уметь";
    case "master":
      return "Владеть";
    default:
      return value;
  }
}

function relationLabel(value: string) {
  const labels: Record<string, string> = {
    automates: "Переходит во владение",
    builds_on: "Строится на",
    contrasts_with: "Противопоставляется",
    contains: "Содержит",
    generalizes: "Обобщает",
    implements: "Реализует",
    part_of: "Является частью",
    property_of: "Свойство объекта",
    refines: "Уточняет",
    requires: "Требует",
    similar: "Родственно",
    used_with: "Используется вместе",
  };
  return labels[value] ?? value;
}

function buildTopicCycles(topics: Topic[], dependencies: TopicDependency[]) {
  const adjacency = new Map<string, string[]>();
  const topicById = new Map(topics.map((topic) => [topic.id, topic]));
  for (const topic of topics) {
    adjacency.set(topic.id, []);
  }
  for (const dependency of dependencies) {
    adjacency.get(dependency.prerequisite_topic_id)?.push(dependency.dependent_topic_id);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const stack: string[] = [];
  const cycles = new Set<string>();

  function dfs(topicId: string) {
    visiting.add(topicId);
    stack.push(topicId);

    for (const nextTopicId of adjacency.get(topicId) ?? []) {
      if (visiting.has(nextTopicId)) {
        const startIndex = stack.indexOf(nextTopicId);
        const cycleIds = stack.slice(startIndex).concat(nextTopicId);
        const cycleNames = cycleIds.map(
          (cycleTopicId) => topicById.get(cycleTopicId)?.name ?? cycleTopicId,
        );
        cycles.add(cycleNames.join(" -> "));
        continue;
      }

      if (!visited.has(nextTopicId)) {
        dfs(nextTopicId);
      }
    }

    stack.pop();
    visiting.delete(topicId);
    visited.add(topicId);
  }

  for (const topic of topics) {
    if (!visited.has(topic.id)) {
      dfs(topic.id);
    }
  }

  return [...cycles].map((cycle) => cycle.split(" -> "));
}

function buildExpertGraphDiagnostics(graph: DisciplineKnowledgeGraph): ExpertGraphDiagnostics {
  const topicLinksByTopicId = new Map<string, TopicKnowledgeElement[]>();
  const topicDependencyCounts = new Map<string, number>();
  const elementConnectionCounts = new Map<string, number>();
  const elementById = new Map(graph.knowledge_elements.map((element) => [element.id, element]));

  for (const topic of graph.topics) {
    topicLinksByTopicId.set(topic.id, []);
    topicDependencyCounts.set(topic.id, 0);
  }

  for (const element of graph.knowledge_elements) {
    elementConnectionCounts.set(element.id, 0);
  }

  for (const link of graph.topic_knowledge_elements) {
    topicLinksByTopicId.set(link.topic_id, [...(topicLinksByTopicId.get(link.topic_id) ?? []), link]);
    elementConnectionCounts.set(
      link.element_id,
      (elementConnectionCounts.get(link.element_id) ?? 0) + 1,
    );
  }

  for (const dependency of graph.topic_dependencies) {
    topicDependencyCounts.set(
      dependency.prerequisite_topic_id,
      (topicDependencyCounts.get(dependency.prerequisite_topic_id) ?? 0) + 1,
    );
    topicDependencyCounts.set(
      dependency.dependent_topic_id,
      (topicDependencyCounts.get(dependency.dependent_topic_id) ?? 0) + 1,
    );
  }

  for (const relation of graph.knowledge_element_relations) {
    elementConnectionCounts.set(
      relation.source_element_id,
      (elementConnectionCounts.get(relation.source_element_id) ?? 0) + 1,
    );
    elementConnectionCounts.set(
      relation.target_element_id,
      (elementConnectionCounts.get(relation.target_element_id) ?? 0) + 1,
    );
  }

  const isolatedTopics = graph.topics.filter(
    (topic) => (topicDependencyCounts.get(topic.id) ?? 0) === 0,
  );
  const isolatedElements = graph.knowledge_elements.filter(
    (element) => (elementConnectionCounts.get(element.id) ?? 0) === 0,
  );
  const topicsWithoutFormedElements = graph.topics.filter((topic) =>
    !(topicLinksByTopicId.get(topic.id) ?? []).some((link) => link.role === "formed"),
  );

  const formedElementIds = new Set(
    graph.topic_knowledge_elements
      .filter((link) => link.role === "formed")
      .map((link) => link.element_id),
  );
  const requiredElementIds = new Set(
    graph.topic_knowledge_elements
      .filter((link) => link.role === "required")
      .map((link) => link.element_id),
  );
  const requiredNotFormed = [...requiredElementIds]
    .filter((elementId) => !formedElementIds.has(elementId))
    .map((elementId) => elementById.get(elementId))
    .filter(Boolean) as KnowledgeElement[];

  const cyclicDependencies = buildTopicCycles(graph.topics, graph.topic_dependencies);
  const totalIssues =
    isolatedTopics.length +
    isolatedElements.length +
    topicsWithoutFormedElements.length +
    requiredNotFormed.length +
    cyclicDependencies.length;

  return {
    cyclicDependencies,
    isolatedElements,
    isolatedTopics,
    requiredNotFormed,
    topicsWithoutFormedElements,
    totalIssues,
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
    subgroups: [],
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
  const [studentSubgroupId, setStudentSubgroupId] = useState("");
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
  const [expertDisciplineSearch, setExpertDisciplineSearch] = useState("");
  const [expertElementSearch, setExpertElementSearch] = useState("");
  const [expertElementTypeFilter, setExpertElementTypeFilter] =
    useState<ExpertElementTypeFilter>("all");
  const [expertSelectedDisciplineId, setExpertSelectedDisciplineId] = useState("");
  const [expertGraphs, setExpertGraphs] = useState<Record<string, DisciplineKnowledgeGraph>>({});
  const [expertGraphsLoading, setExpertGraphsLoading] = useState(false);
  const [expertGraphsError, setExpertGraphsError] = useState("");
  const [subgroupGroupId, setSubgroupGroupId] = useState("");
  const [subgroupNum, setSubgroupNum] = useState("");
  const [adminUserSearch, setAdminUserSearch] = useState("");
  const [adminUserRoleFilter, setAdminUserRoleFilter] =
    useState<AdminUserRoleFilter>("all");
  const [adminUserGroupFilter, setAdminUserGroupFilter] = useState("");
  const [adminUserSubgroupFilter, setAdminUserSubgroupFilter] = useState("");
  const [adminUserDisciplineFilter, setAdminUserDisciplineFilter] = useState("");
  const [selectedAdminUser, setSelectedAdminUser] = useState<AdminDirectoryUser | null>(
    null,
  );
  const [adminDisciplineSearch, setAdminDisciplineSearch] = useState("");
  const [adminTeacherFilterId, setAdminTeacherFilterId] = useState("");
  const [assignmentTeacherSearch, setAssignmentTeacherSearch] = useState("");
  const [assignmentDisciplineId, setAssignmentDisciplineId] = useState("");
  const [assignmentTeacherIds, setAssignmentTeacherIds] = useState<string[]>([]);
  const [assignmentExpertIds, setAssignmentExpertIds] = useState<string[]>([]);
  const [assignmentGroupIds, setAssignmentGroupIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyAction, setBusyAction] = useState("");
  const [notifications, setNotifications] = useState<ToastMessage[]>([]);
  const [adminUsersExpanded, setAdminUsersExpanded] = useState(true);
  const [adminCreateUsersExpanded, setAdminCreateUsersExpanded] = useState(true);
  const [adminDisciplineListExpanded, setAdminDisciplineListExpanded] = useState(true);
  const [adminCreateUserTab, setAdminCreateUserTab] =
    useState<AdminCreateUserTab>("student");
  const [adminGroupTab, setAdminGroupTab] = useState<AdminGroupTab>("group");
  const [adminModalOpen, setAdminModalOpen] = useState(false);
  const [adminModalTab, setAdminModalTab] = useState<AdminModalTab>("student");
  const notificationTimersRef = useRef(new Map<string, number>());
  const sessionRole = isAdminMode ? "admin" : isExpertMode ? "expert" : "teacher";
  const sessionUserId = isAdminMode ? adminId : isExpertMode ? expertId : teacherId;
  const currentSession = readSession();

  const groupById = useMemo(
    () => new Map(data.groups.map((group) => [group.id, group])),
    [data.groups],
  );
  const subgroupById = useMemo(
    () => new Map(data.subgroups.map((subgroup) => [subgroup.id, subgroup])),
    [data.subgroups],
  );
  const subgroupsByGroupId = useMemo(() => {
    const result = new Map<string, Subgroup[]>();
    for (const subgroup of data.subgroups) {
      result.set(subgroup.group_id, [...(result.get(subgroup.group_id) ?? []), subgroup]);
    }
    return result;
  }, [data.subgroups]);
  const teacherById = useMemo(
    () => new Map(data.teachers.map((teacher) => [teacher.id, teacher])),
    [data.teachers],
  );
  const expertById = useMemo(
    () => new Map(data.experts.map((expert) => [expert.id, expert])),
    [data.experts],
  );
  const disciplineById = useMemo(
    () => new Map(data.disciplines.map((discipline) => [discipline.id, discipline])),
    [data.disciplines],
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
  const canCreateDiscipline =
    !busyAction &&
    disciplineName.trim() &&
    (isTeacherMode ? Boolean(disciplineTeacherId) : true);
  const adminVisibleDisciplines = useMemo(() => {
    if (!isAdminMode) {
      return visibleDisciplines;
    }
    return visibleDisciplines.filter((discipline) => {
      const linkedTeacherNames = discipline.teacher_ids
        .map((linkedTeacherId) => teacherById.get(linkedTeacherId)?.name ?? "")
        .join(" ");
      const searchableText =
        `${discipline.name} ${linkedTeacherNames}`.toLowerCase();
      return !adminDisciplineSearch.trim()
        ? true
        : searchableText.includes(adminDisciplineSearch.trim().toLowerCase());
    });
  }, [adminDisciplineSearch, isAdminMode, teacherById, visibleDisciplines]);
  const selectedAssignmentDiscipline = useMemo(
    () =>
      visibleDisciplines.find((discipline) => discipline.id === assignmentDisciplineId) ??
      null,
    [assignmentDisciplineId, visibleDisciplines],
  );
  const assignmentTeacherOptions = useMemo(() => {
    const query = assignmentTeacherSearch.trim().toLowerCase();
    if (!query) {
      return [];
    }
    const selectedTeacherIds = new Set(assignmentTeacherIds);
    return availableTeacherOptions
      .filter(
        (teacher) =>
          !selectedTeacherIds.has(teacher.id) && teacher.name.toLowerCase().includes(query),
      )
      .slice(0, 8);
  }, [assignmentTeacherIds, assignmentTeacherSearch, availableTeacherOptions]);
  const expertDisciplineGraphs = useMemo(
    () =>
      visibleDisciplines
        .map((discipline) => expertGraphs[discipline.id])
        .filter(Boolean) as DisciplineKnowledgeGraph[],
    [expertGraphs, visibleDisciplines],
  );
  const filteredExpertDisciplineGraphs = useMemo(() => {
    const query = expertDisciplineSearch.trim().toLowerCase();
    if (!query) {
      return expertDisciplineGraphs;
    }
    return expertDisciplineGraphs.filter((graph) => {
      const teacherNames = graph.discipline.teacher_ids
        .map((linkedTeacherId) => teacherById.get(linkedTeacherId)?.name ?? "")
        .join(" ");
      return `${graph.discipline.name} ${teacherNames}`.toLowerCase().includes(query);
    });
  }, [expertDisciplineGraphs, expertDisciplineSearch, teacherById]);
  const selectedExpertGraph = useMemo(() => {
    if (!expertDisciplineGraphs.length) {
      return null;
    }
    return (
      expertDisciplineGraphs.find((graph) => graph.discipline.id === expertSelectedDisciplineId) ??
      filteredExpertDisciplineGraphs[0] ??
      expertDisciplineGraphs[0]
    );
  }, [expertDisciplineGraphs, expertSelectedDisciplineId, filteredExpertDisciplineGraphs]);
  const selectedExpertGraphDiagnostics = useMemo(
    () => (selectedExpertGraph ? buildExpertGraphDiagnostics(selectedExpertGraph) : null),
    [selectedExpertGraph],
  );
  const selectedExpertTopics = useMemo(
    () =>
      selectedExpertGraph
        ? selectedExpertGraph.topics
            .slice()
            .sort((left, right) => left.name.localeCompare(right.name, "ru"))
        : [],
    [selectedExpertGraph],
  );
  const selectedExpertElements = useMemo(() => {
    if (!selectedExpertGraph) {
      return [];
    }
    const query = expertElementSearch.trim().toLowerCase();
    return selectedExpertGraph.knowledge_elements
      .filter((element) =>
        expertElementTypeFilter === "all"
          ? true
          : element.competence_type === expertElementTypeFilter,
      )
      .filter((element) =>
        query ? `${element.name} ${element.description ?? ""}`.toLowerCase().includes(query) : true,
      )
      .slice()
      .sort((left, right) => left.name.localeCompare(right.name, "ru"));
  }, [expertElementSearch, expertElementTypeFilter, selectedExpertGraph]);
  const selectedExpertRelations = useMemo(
    () => selectedExpertGraph?.knowledge_element_relations ?? [],
    [selectedExpertGraph],
  );
  const adminDirectoryUsers = useMemo<AdminDirectoryUser[]>(() => {
    const studentUsers = data.students.map((student) => {
      const disciplineIds = data.disciplines
        .filter((discipline) => discipline.group_ids.includes(student.group_id))
        .map((discipline) => discipline.id);
      return {
        id: student.id,
        name: student.name,
        login: student.login,
        role: "student" as const,
        roleLabel: "Студент",
        groupIds: [student.group_id],
        subgroupId: student.subgroup_id,
        disciplineIds,
        status: student.is_active ? "active" as const : "inactive" as const,
      };
    });
    const teacherUsers = data.teachers.map((teacher) => ({
      id: teacher.id,
      name: teacher.name,
      login: teacher.login,
      role: "teacher" as const,
      roleLabel: "Преподаватель",
      groupIds: teacher.group_ids,
      disciplineIds: teacher.discipline_ids,
      status: teacher.is_active ? "active" as const : "inactive" as const,
    }));
    const expertUsers = data.experts.map((expert) => ({
      id: expert.id,
      name: expert.name,
      login: expert.login,
      role: "expert" as const,
      roleLabel: "Эксперт",
      groupIds: [],
      disciplineIds: expert.discipline_ids,
      status: expert.is_active ? "active" as const : "inactive" as const,
    }));
    const adminUsers = data.admins.map((admin) => ({
      id: admin.id,
      name: admin.name,
      login: admin.login,
      role: "admin" as const,
      roleLabel: "Администратор",
      groupIds: [],
      disciplineIds: [],
      status: admin.is_active ? "active" as const : "inactive" as const,
    }));
    return [...studentUsers, ...teacherUsers, ...expertUsers, ...adminUsers];
  }, [data.admins, data.disciplines, data.experts, data.students, data.teachers]);
  const filteredAdminDirectoryUsers = useMemo(() => {
    const search = adminUserSearch.trim().toLowerCase();
    return adminDirectoryUsers.filter((user) => {
      const groupNames = user.groupIds.map((groupId) => groupById.get(groupId)?.name ?? "");
      const subgroupName = user.subgroupId
        ? `Подгруппа ${subgroupById.get(user.subgroupId)?.subgroup_num ?? ""}`
        : "";
      const disciplineNames = user.disciplineIds.map(
        (disciplineId) => disciplineById.get(disciplineId)?.name ?? "",
      );
      const searchable = [
        user.name,
        user.login,
        user.roleLabel,
        ...groupNames,
        subgroupName,
        ...disciplineNames,
      ]
        .join(" ")
        .toLowerCase();
      const matchesSearch = !search || searchable.includes(search);
      const matchesRole = adminUserRoleFilter === "all" || user.role === adminUserRoleFilter;
      const matchesGroup =
        !adminUserGroupFilter || user.groupIds.includes(adminUserGroupFilter);
      const matchesSubgroup =
        !adminUserSubgroupFilter || user.subgroupId === adminUserSubgroupFilter;
      const matchesDiscipline =
        !adminUserDisciplineFilter || user.disciplineIds.includes(adminUserDisciplineFilter);
      return (
        matchesSearch &&
        matchesRole &&
        matchesGroup &&
        matchesSubgroup &&
        matchesDiscipline
      );
    });
  }, [
    adminDirectoryUsers,
    adminUserDisciplineFilter,
    adminUserGroupFilter,
    adminUserRoleFilter,
    adminUserSearch,
    adminUserSubgroupFilter,
    disciplineById,
    groupById,
    subgroupById,
  ]);
  const topNavButtons = [
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
  function openAdminModalTab(tab: AdminModalTab) {
    setAdminModalTab(tab);
    setAdminModalOpen(true);
  }

  function getAdminUserViewPath(user: AdminDirectoryUser) {
    if (user.role === "student") {
      return `/students/${user.id}?viewer=admin`;
    }
    if (user.role === "teacher") {
      return `/teachers/${user.id}?viewer=admin`;
    }
    return `/admin/users/${user.role}/${user.id}`;
  }

  function isCurrentAdminDirectoryUser(user: AdminDirectoryUser) {
    return (
      user.role === "admin" &&
      currentSession?.role === "admin" &&
      currentSession.userId === user.id
    );
  }

  function handleAddAssignmentTeacher(teacherId: string) {
    setAssignmentTeacherIds((current) =>
      current.includes(teacherId) ? current : [...current, teacherId],
    );
    setAssignmentTeacherSearch("");
  }

  function handleRemoveAssignmentTeacher(teacherId: string) {
    setAssignmentTeacherIds((current) =>
      current.filter((currentTeacherId) => currentTeacherId !== teacherId),
    );
  }

  async function handleDeleteAdminUser(user: AdminDirectoryUser) {
    if (isCurrentAdminDirectoryUser(user)) {
      return;
    }

    const confirmed = window.confirm(
      `Удалить пользователя "${user.name}" (${user.roleLabel})? Это действие нельзя отменить.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setBusyAction(`delete-${user.role}-${user.id}`);
      if (user.role === "student") {
        await deleteStudent(user.id);
      } else if (user.role === "teacher") {
        await deleteTeacher(user.id);
      } else if (user.role === "expert") {
        await deleteExpert(user.id);
      } else {
        await deleteAdmin(user.id);
      }
      if (selectedAdminUser?.id === user.id && selectedAdminUser.role === user.role) {
        setSelectedAdminUser(null);
      }
      await refreshAfterChange("Пользователь удален.");
    } catch (error) {
      pushNotification("error", extractErrorMessage(error));
    } finally {
      setBusyAction("");
    }
  }

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
    const subgroups = groups.length
      ? (await Promise.all(groups.map((group) => fetchSubgroups(group.id, signal)))).flat()
      : [];

    setData({ admins, disciplines, experts, groups, students, subgroups, teachers });
  }

  useEffect(() => {
    const activeSession = readSession();
    if (!sessionMatches(activeSession, sessionRole, sessionUserId)) {
      navigate(getSessionHomePath(activeSession), { replace: true });
    }
  }, [navigate, sessionRole, sessionUserId]);

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

  useEffect(() => {
    if (!isAdminMode) {
      return;
    }

    if (
      assignmentDisciplineId &&
      visibleDisciplines.some((discipline) => discipline.id === assignmentDisciplineId)
    ) {
      return;
    }

    setAssignmentDisciplineId(visibleDisciplines[0]?.id ?? "");
  }, [assignmentDisciplineId, isAdminMode, visibleDisciplines]);

  useEffect(() => {
    if (!isExpertMode) {
      setExpertGraphs({});
      setExpertGraphsError("");
      setExpertGraphsLoading(false);
      return;
    }

    if (!visibleDisciplines.length) {
      setExpertGraphs({});
      setExpertGraphsError("");
      setExpertGraphsLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadExpertGraphs() {
      try {
        setExpertGraphsLoading(true);
        setExpertGraphsError("");
        const graphs = await Promise.all(
          visibleDisciplines.map((discipline) =>
            fetchDisciplineKnowledgeGraph(discipline.id, controller.signal),
          ),
        );
        if (controller.signal.aborted) {
          return;
        }
        setExpertGraphs(
          Object.fromEntries(graphs.map((graph) => [graph.discipline.id, graph])),
        );
      } catch (error) {
        if (!isAbortError(error) && !controller.signal.aborted) {
          setExpertGraphsError(extractErrorMessage(error));
        }
      } finally {
        if (!controller.signal.aborted) {
          setExpertGraphsLoading(false);
        }
      }
    }

    void loadExpertGraphs();
    return () => controller.abort();
  }, [isExpertMode, visibleDisciplines]);

  useEffect(() => {
    if (!isExpertMode) {
      return;
    }

    if (
      expertSelectedDisciplineId &&
      expertDisciplineGraphs.some(
        (graph) => graph.discipline.id === expertSelectedDisciplineId,
      )
    ) {
      return;
    }

    setExpertSelectedDisciplineId(expertDisciplineGraphs[0]?.discipline.id ?? "");
  }, [expertDisciplineGraphs, expertSelectedDisciplineId, isExpertMode]);

  useEffect(() => {
    if (!selectedAssignmentDiscipline) {
      setAssignmentTeacherSearch("");
      setAssignmentTeacherIds([]);
      setAssignmentExpertIds([]);
      setAssignmentGroupIds([]);
      return;
    }

    setAssignmentTeacherSearch("");
    setAssignmentTeacherIds(selectedAssignmentDiscipline.teacher_ids ?? []);
    setAssignmentExpertIds(selectedAssignmentDiscipline.expert_ids ?? []);
    setAssignmentGroupIds(selectedAssignmentDiscipline.group_ids ?? []);
  }, [selectedAssignmentDiscipline]);

  useEffect(() => {
    if (!subgroupGroupId || !data.groups.some((group) => group.id === subgroupGroupId)) {
      setSubgroupGroupId(data.groups[0]?.id ?? "");
    }
  }, [data.groups, subgroupGroupId]);

  useEffect(() => {
    if (!studentGroupId) {
      setStudentSubgroupId("");
      return;
    }

    const availableSubgroupsForStudent = subgroupsByGroupId.get(studentGroupId) ?? [];
    if (
      studentSubgroupId &&
      availableSubgroupsForStudent.some((subgroup) => subgroup.id === studentSubgroupId)
    ) {
      return;
    }

    setStudentSubgroupId("");
  }, [studentGroupId, studentSubgroupId, subgroupsByGroupId]);

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
    if (!name || (isTeacherMode && !teacherForDiscipline)) {
      return;
    }

    try {
      setBusyAction("discipline");
      await createDiscipline({
        name,
        teacher_id: teacherForDiscipline || null,
        group_ids: isExpertMode || isAdminMode ? [] : disciplineGroupIds,
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

  async function handleUpdateDisciplineAssignments(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!assignmentDisciplineId) {
      return;
    }

    try {
      setBusyAction("discipline-assignments");
      await updateDisciplineAssignments(assignmentDisciplineId, {
        teacher_ids: assignmentTeacherIds,
        expert_ids: selectedAssignmentDiscipline?.expert_ids ?? assignmentExpertIds,
        group_ids: selectedAssignmentDiscipline?.group_ids ?? assignmentGroupIds,
      });
      await refreshAfterChange("Назначения дисциплины сохранены.");
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

  async function handleCreateSubgroup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const subgroupNumber = Number(subgroupNum);
    if (!subgroupGroupId || !Number.isInteger(subgroupNumber) || subgroupNumber <= 0) {
      return;
    }

    try {
      setBusyAction("subgroup");
      await createSubgroup({
        group_id: subgroupGroupId,
        subgroup_num: subgroupNumber,
      });
      setSubgroupNum("");
      await refreshAfterChange("Подгруппа создана.");
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
      setAdminModalOpen(false);
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
        subgroup_id: studentSubgroupId || null,
      });
      setStudentName("");
      setStudentLogin("");
      setStudentPassword("");
      await refreshAfterChange("Учетная запись студента создана.");
      setAdminModalOpen(false);
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
      setAdminModalOpen(false);
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
      setAdminModalOpen(false);
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
              <h2>
                {adminModalTab === "group" || adminModalTab === "subgroup"
                  ? "Группы и подгруппы"
                  : "Добавить пользователя"}
              </h2>
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
            <div className="admin-modal-grid">
              {adminModalTab === "group" || adminModalTab === "subgroup" ? (
                <motion.section className="home-card admin-group-modal-card" {...CARD_MOTION}>
                  <p className="card__eyebrow">Группы</p>
                  <h2>Группы и подгруппы</h2>
                  <div className="admin-modal-tabs" role="tablist" aria-label="Создание групп">
                    <button
                      className={adminModalTab === "group" ? "primary-button" : "secondary-button"}
                      onClick={() => setAdminModalTab("group")}
                      type="button"
                    >
                      Создание группы
                    </button>
                    <button
                      className={adminModalTab === "subgroup" ? "primary-button" : "secondary-button"}
                      onClick={() => setAdminModalTab("subgroup")}
                      type="button"
                    >
                      Создание подгруппы
                    </button>
                  </div>

                  {adminModalTab === "group" ? (
                    <form className="home-form" onSubmit={handleCreateGroup}>
                      <label className="field">
                        <span>Название группы</span>
                        <input
                          value={groupName}
                          onChange={(event) => setGroupName(event.target.value)}
                          placeholder="Например: Б9124-09.03.04"
                          required
                        />
                      </label>
                      <motion.button
                        className="primary-button"
                        disabled={busyAction === "group"}
                        {...ACTION_MOTION}
                      >
                        {busyAction === "group" ? "Создаю..." : "Создать группу"}
                      </motion.button>
                    </form>
                  ) : (
                    <form className="home-form" onSubmit={handleCreateSubgroup}>
                      <label className="field">
                        <span>Группа</span>
                        <select
                          value={subgroupGroupId}
                          onChange={(event) => setSubgroupGroupId(event.target.value)}
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
                      <label className="field">
                        <span>Номер подгруппы</span>
                        <input
                          min={1}
                          type="number"
                          value={subgroupNum}
                          onChange={(event) => setSubgroupNum(event.target.value)}
                          placeholder="1"
                          required
                        />
                      </label>
                      {!data.groups.length ? (
                        <p className="home-hint">Сначала создайте хотя бы одну группу.</p>
                      ) : null}
                      <motion.button
                        className="primary-button"
                        disabled={busyAction === "subgroup" || !subgroupGroupId}
                        {...ACTION_MOTION}
                      >
                        {busyAction === "subgroup" ? "Создаю..." : "Создать подгруппу"}
                      </motion.button>
                    </form>
                  )}
                </motion.section>
              ) : null}

              {adminModalTab === "teacher" ? (
                <motion.section className="home-card" {...CARD_MOTION}>
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
                      {...ACTION_MOTION}
                    >
                      {busyAction === "teacher" ? "Создаю..." : "Создать преподавателя"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}

              {adminModalTab === "student" ? (
                <motion.section className="home-card" {...CARD_MOTION}>
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
                    <label className="field">
                      <span>Подгруппа</span>
                      <select
                        value={studentSubgroupId}
                        onChange={(event) => setStudentSubgroupId(event.target.value)}
                        disabled={!studentGroupId}
                      >
                        <option value="">Без подгруппы</option>
                        {(subgroupsByGroupId.get(studentGroupId) ?? []).map((subgroup) => (
                          <option key={subgroup.id} value={subgroup.id}>
                            Подгруппа {subgroup.subgroup_num}
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
                      {...ACTION_MOTION}
                    >
                      {busyAction === "student" ? "Создаю..." : "Создать студента"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}

              {adminModalTab === "expert" ? (
                <motion.section className="home-card" {...CARD_MOTION}>
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
                      {...ACTION_MOTION}
                    >
                      {busyAction === "expert" ? "Создаю..." : "Создать эксперта"}
                    </motion.button>
                  </form>
                </motion.section>
              ) : null}

              {adminModalTab === "admin" ? (
                <motion.section className="home-card" {...CARD_MOTION}>
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

  function renderAdminUserDetailsModal() {
    if (!isAdminMode || !selectedAdminUser) {
      return null;
    }

    const userGroups = selectedAdminUser.groupIds
      .map((groupId) => groupById.get(groupId)?.name)
      .filter(Boolean);
    const userSubgroup = selectedAdminUser.subgroupId
      ? subgroupById.get(selectedAdminUser.subgroupId)
      : null;
    const userDisciplines = selectedAdminUser.disciplineIds
      .map((disciplineId) => disciplineById.get(disciplineId)?.name)
      .filter(Boolean);
    const studentTeachers =
      selectedAdminUser.role === "student"
        ? Array.from(
            new Set(
              selectedAdminUser.disciplineIds.flatMap((disciplineId) => {
                const discipline = disciplineById.get(disciplineId);
                return (discipline?.teacher_ids ?? [])
                  .map((teacherId) => teacherById.get(teacherId)?.name)
                  .filter(Boolean) as string[];
              }),
            ),
          )
        : [];
    const teacherStudents =
      selectedAdminUser.role === "teacher"
        ? data.students.filter((student) => selectedAdminUser.groupIds.includes(student.group_id))
        : [];

    return (
      <div className="modal-backdrop" onClick={() => setSelectedAdminUser(null)}>
        <div
          className="modal-panel admin-modal-panel admin-detail-modal"
          onClick={(event) => event.stopPropagation()}
        >
          <header className="modal-panel__header">
            <div>
              <p className="card__eyebrow">{selectedAdminUser.roleLabel}</p>
              <h2>{selectedAdminUser.name}</h2>
            </div>
            <button
              className="ghost-button"
              onClick={() => setSelectedAdminUser(null)}
              type="button"
            >
              Закрыть
            </button>
          </header>
          <div className="modal-panel__body">
            <div className="admin-detail-grid">
              <div className="admin-detail-card">
                <span>Логин</span>
                <strong>{selectedAdminUser.login}</strong>
              </div>
              <div className="admin-detail-card">
                <span>Статус</span>
                <strong>Активен</strong>
              </div>
              <div className="admin-detail-card">
                <span>Группы</span>
                <strong>{userGroups.length ? userGroups.join(", ") : "Не назначены"}</strong>
              </div>
              <div className="admin-detail-card">
                <span>Подгруппа</span>
                <strong>
                  {userSubgroup ? `Подгруппа ${userSubgroup.subgroup_num}` : "Не назначена"}
                </strong>
              </div>
            </div>

            <section className="admin-detail-section">
              <h3>Дисциплины</h3>
              {userDisciplines.length ? (
                <div className="admin-chip-list">
                  {userDisciplines.map((disciplineName) => (
                    <span className="admin-chip" key={disciplineName}>
                      {disciplineName}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="home-hint">Дисциплины не назначены.</p>
              )}
            </section>

            {selectedAdminUser.role === "student" ? (
              <section className="admin-detail-section">
                <h3>Преподаватели по доступным дисциплинам</h3>
                {studentTeachers.length ? (
                  <div className="admin-chip-list">
                    {studentTeachers.map((teacherName) => (
                      <span className="admin-chip" key={teacherName}>
                        {teacherName}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="home-hint">Преподаватели не назначены.</p>
                )}
              </section>
            ) : null}

            {selectedAdminUser.role === "teacher" ? (
              <section className="admin-detail-section">
                <h3>Студенты закрепленных групп</h3>
                {teacherStudents.length ? (
                  <div className="admin-detail-list">
                    {teacherStudents.map((student) => (
                      <span key={student.id}>
                        {student.name} · {groupById.get(student.group_id)?.name ?? "Группа не найдена"}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p className="home-hint">Студенты не найдены.</p>
                )}
              </section>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  function renderAdminDashboardSection() {
    const renderListValue = (items: string[], empty = "Не назначено") =>
      items.length ? items.join(", ") : empty;

    const renderDisciplineRows = () => (
      <div className="admin-discipline-table admin-discipline-table--org">
        <div className="admin-discipline-table__head">
          <span>Дисциплина</span>
          <span>Преподаватели</span>
          <span>Действия</span>
        </div>
        <div className="admin-discipline-table__body">
          {adminVisibleDisciplines.length ? (
            adminVisibleDisciplines.map((discipline) => {
              const teachers = discipline.teacher_ids
                .map((linkedTeacherId) => teacherById.get(linkedTeacherId)?.name)
                .filter(Boolean) as string[];
              return (
                <article className="admin-discipline-row admin-discipline-row--org" key={discipline.id}>
                  <div className="admin-discipline-row__identity">
                    <strong>{discipline.name}</strong>
                    <small>ID: {shortId(discipline.id)}</small>
                  </div>
                  <div>{renderListValue(teachers)}</div>
                  <div className="discipline-row__actions">
                    <MotionLink
                      className="secondary-button discipline-row__action"
                      to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`}
                    >
                      Паспорт
                    </MotionLink>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="home-hint">Дисциплины не найдены.</p>
          )}
        </div>
      </div>
    );

    return (
      <motion.section className="home-section admin-admin-stack" {...buildReveal(0.06)}>
        <motion.section className="home-card home-card--wide admin-system-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Пользователи</p>
            <h2>Пользователи системы</h2>
          </div>

          <div className="admin-user-type-grid">
            {[
              ["student", "Создать студента"],
              ["teacher", "Создать преподавателя"],
              ["expert", "Создать эксперта"],
              ["admin", "Создать администратора"],
            ].map(([key, label]) => (
              <button
                className="secondary-button admin-user-type-button"
                key={key}
                onClick={() =>
                  openAdminModalTab(key as "student" | "teacher" | "expert" | "admin")
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="admin-filter-grid">
            <label className="field">
              <span>Поиск</span>
              <input
                value={adminUserSearch}
                onChange={(event) => setAdminUserSearch(event.target.value)}
                placeholder="ФИО, логин, группа, дисциплина"
              />
            </label>
            <label className="field">
              <span>Роль</span>
              <select
                value={adminUserRoleFilter}
                onChange={(event) =>
                  setAdminUserRoleFilter(event.target.value as AdminUserRoleFilter)
                }
              >
                <option value="all">Все роли</option>
                <option value="student">Студенты</option>
                <option value="teacher">Преподаватели</option>
                <option value="expert">Эксперты</option>
                <option value="admin">Администраторы</option>
              </select>
            </label>
            <label className="field">
              <span>Группа</span>
              <select
                value={adminUserGroupFilter}
                onChange={(event) => setAdminUserGroupFilter(event.target.value)}
              >
                <option value="">Все группы</option>
                {data.groups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Подгруппа</span>
              <select
                value={adminUserSubgroupFilter}
                onChange={(event) => setAdminUserSubgroupFilter(event.target.value)}
              >
                <option value="">Все подгруппы</option>
                {data.subgroups.map((subgroup) => (
                  <option key={subgroup.id} value={subgroup.id}>
                    {groupById.get(subgroup.group_id)?.name ?? "Группа"} · {subgroup.subgroup_num}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Дисциплина</span>
              <select
                value={adminUserDisciplineFilter}
                onChange={(event) => setAdminUserDisciplineFilter(event.target.value)}
              >
                <option value="">Все дисциплины</option>
                {data.disciplines.map((discipline) => (
                  <option key={discipline.id} value={discipline.id}>
                    {discipline.name}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="admin-directory-table">
            <div className="admin-directory-table__head">
              <span>Пользователь</span>
              <span>Роль</span>
              <span>Группа</span>
              <span>Дисциплины</span>
              <span>Действия</span>
            </div>
            <div className="admin-directory-table__body">
              {filteredAdminDirectoryUsers.length ? (
                filteredAdminDirectoryUsers.map((user) => {
                  const groups = user.groupIds
                    .map((groupId) => groupById.get(groupId)?.name)
                    .filter(Boolean) as string[];
                  const disciplines = user.disciplineIds
                    .map((disciplineId) => disciplineById.get(disciplineId)?.name)
                    .filter(Boolean) as string[];
                  const subgroup = user.subgroupId ? subgroupById.get(user.subgroupId) : null;
                  const isDeleting = busyAction === `delete-${user.role}-${user.id}`;
                  const isCurrentAdminProfile = isCurrentAdminDirectoryUser(user);

                  return (
                    <article className="admin-directory-row" key={`${user.role}-${user.id}`}>
                      <div>
                        <strong>{user.name}</strong>
                        <small>{user.login}</small>
                      </div>
                      <span>{user.roleLabel}</span>
                      <span>
                        {groups.length ? groups.join(", ") : "Не назначена"}
                        {subgroup ? ` · подгруппа ${subgroup.subgroup_num}` : ""}
                      </span>
                      <span>{disciplines.length ? disciplines.join(", ") : "Не назначены"}</span>
                      <div className="admin-directory-row__actions">
                        <button
                          className="secondary-button"
                          disabled={isDeleting}
                          onClick={() => navigate(getAdminUserViewPath(user))}
                          type="button"
                        >
                          Подробнее
                        </button>
                        <button
                          className="secondary-button secondary-button--danger"
                          disabled={isDeleting || isCurrentAdminProfile}
                          onClick={() => void handleDeleteAdminUser(user)}
                          type="button"
                        >
                          {isCurrentAdminProfile ? "Текущий админ" : "Удалить"}
                        </button>
                      </div>
                    </article>
                  );
                })
              ) : (
                <p className="home-hint">Пользователи не найдены.</p>
              )}
            </div>
          </div>
        </motion.section>

        <motion.section
          className="home-card home-card--wide admin-system-card admin-groups-compact-card"
          {...CARD_MOTION}
        >
          <div className="admin-section-heading admin-section-heading--with-action">
            <div>
              <p className="card__eyebrow">Группы</p>
              <h2>Группы и подгруппы</h2>
              <p className="card__text">
                {data.groups.length} групп, {data.subgroups.length} подгрупп.
              </p>
            </div>
            <button
              className="primary-button admin-groups-compact-card__button"
              onClick={() => openAdminModalTab("group")}
              type="button"
            >
              Управлять группами
            </button>
          </div>
        </motion.section>

        <motion.section className="home-card home-card--wide admin-discipline-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Дисциплины</p>
            <h2>Дисциплины</h2>
          </div>

          <form className="home-form admin-discipline-create admin-create-discipline-form" onSubmit={handleCreateDiscipline}>
            <label className="field">
              <span>Название дисциплины</span>
              <input
                value={disciplineName}
                onChange={(event) => setDisciplineName(event.target.value)}
                placeholder="Например: Теория графов"
                required
              />
            </label>
            <button
              className="primary-button"
              disabled={busyAction === "discipline" || !canCreateDiscipline}
            >
              {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
            </button>
          </form>

          <div className="admin-discipline-toolbar admin-discipline-toolbar--list">
            <label className="field">
              <span>Поиск</span>
              <input
                value={adminDisciplineSearch}
                onChange={(event) => setAdminDisciplineSearch(event.target.value)}
                placeholder="Дисциплина, преподаватель, эксперт, группа"
              />
            </label>
            <label className="field">
              <span>Преподаватель</span>
              <select
                value={adminTeacherFilterId}
                onChange={(event) => setAdminTeacherFilterId(event.target.value)}
              >
                <option value="">Все преподаватели</option>
                {data.teachers.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button admin-discipline-filters__reset"
              onClick={() => {
                setAdminDisciplineSearch("");
                setAdminTeacherFilterId("");
              }}
              type="button"
            >
              Сбросить
            </button>
          </div>

          {renderDisciplineRows()}
        </motion.section>

        <motion.section className="home-card home-card--wide admin-discipline-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Назначения</p>
            <h2>Закрепление за дисциплиной</h2>
          </div>
          <form className="home-form" onSubmit={handleUpdateDisciplineAssignments}>
            <div className="admin-assignment-grid">
              <label className="field">
                <span>Дисциплина</span>
                <select
                  value={assignmentDisciplineId}
                  onChange={(event) => setAssignmentDisciplineId(event.target.value)}
                  disabled={!visibleDisciplines.length}
                >
                  {visibleDisciplines.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                disabled={!assignmentDisciplineId || busyAction === "discipline-assignments"}
              >
                {busyAction === "discipline-assignments" ? "Сохраняю..." : "Сохранить"}
              </button>
            </div>

            <div className="admin-assignment-checks admin-assignment-checks--three">
              <div className="home-checklist admin-assignment-checklist">
                <span>Преподаватели</span>
                {data.teachers.length ? (
                  data.teachers.map((teacher) => (
                    <label className="home-check" key={teacher.id}>
                      <input
                        checked={assignmentTeacherIds.includes(teacher.id)}
                        onChange={() =>
                          setAssignmentTeacherIds((current) => toggleId(current, teacher.id))
                        }
                        type="checkbox"
                      />
                      {teacher.name}
                    </label>
                  ))
                ) : (
                  <p className="home-hint">Преподаватели пока не созданы.</p>
                )}
              </div>

              <div className="home-checklist admin-assignment-checklist">
                <span>Эксперты</span>
                {data.experts.length ? (
                  data.experts.map((expert) => (
                    <label className="home-check" key={expert.id}>
                      <input
                        checked={assignmentExpertIds.includes(expert.id)}
                        onChange={() =>
                          setAssignmentExpertIds((current) => toggleId(current, expert.id))
                        }
                        type="checkbox"
                      />
                      {expert.name}
                    </label>
                  ))
                ) : (
                  <p className="home-hint">Эксперты пока не созданы.</p>
                )}
              </div>

              <div className="home-checklist admin-assignment-checklist">
                <span>Группы</span>
                {data.groups.length ? (
                  data.groups.map((group) => (
                    <label className="home-check" key={group.id}>
                      <input
                        checked={assignmentGroupIds.includes(group.id)}
                        onChange={() =>
                          setAssignmentGroupIds((current) => toggleId(current, group.id))
                        }
                        type="checkbox"
                      />
                      {group.name}
                    </label>
                  ))
                ) : (
                  <p className="home-hint">Группы пока не созданы.</p>
                )}
              </div>
            </div>
          </form>
        </motion.section>
      </motion.section>
    );
  }

  function renderExpertDashboardLayout() {
    return (
      <motion.section className="home-section" {...buildReveal(0.06)}>
        <motion.section className="home-card home-card--wide expert-dashboard-card" {...CARD_MOTION}>
          <div className="home-card__header">
            <div>
              <p className="card__eyebrow">Мои дисциплины</p>
              <h2>Список дисциплин эксперта</h2>
              <p className="card__text">
                Эксперт работает только с графом знаний. Траектории здесь недоступны, это зона преподавателя.
              </p>
            </div>
          </div>

          <div className="expert-toolbar">
            <label className="field">
              <span>Поиск дисциплины или преподавателя</span>
              <input
                value={expertDisciplineSearch}
                onChange={(event) => setExpertDisciplineSearch(event.target.value)}
                placeholder="Например: Теория графов или Петров"
              />
            </label>
            <div className="expert-toolbar__summary">
              <strong>{filteredExpertDisciplineGraphs.length}</strong>
              <span>дисциплин в текущем списке</span>
            </div>
          </div>

          {expertGraphsLoading ? (
            <p className="card__text">Собираю данные по дисциплинам...</p>
          ) : expertGraphsError ? (
            <p className="card__text">{expertGraphsError}</p>
          ) : filteredExpertDisciplineGraphs.length ? (
            <div className="expert-discipline-grid">
              {filteredExpertDisciplineGraphs.map((graph) => {
                const graphTeachers = graph.discipline.teacher_ids
                  .map((teacherId) => teacherById.get(teacherId)?.name)
                  .filter(Boolean);
                const graphPath = disciplinePathValue(graph.discipline, graph.discipline.id);

                return (
                  <article className="expert-discipline-card" key={graph.discipline.id}>
                    <div className="expert-discipline-card__select">
                      <span className="card__eyebrow">Дисциплина</span>
                      <strong>{graph.discipline.name}</strong>
                      <small>
                        Преподаватели:{" "}
                        {graphTeachers.length ? graphTeachers.join(", ") : "не назначены"}
                      </small>
                    </div>

                    <div className="expert-discipline-card__actions">
                      <MotionLink
                        className="primary-button"
                        to={`/disciplines/${graphPath}/knowledge`}
                        {...ACTION_MOTION}
                      >
                        Открыть граф
                      </MotionLink>
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="card__text">По текущему поиску дисциплины не найдены.</p>
          )}
        </motion.section>
      </motion.section>
    );
  }

  function renderAdminDashboardLayout() {
    const renderListValue = (items: string[], empty = "Не назначено") =>
      items.length ? items.join(", ") : empty;

    const renderDisciplineRows = () => (
      <div className="admin-discipline-table admin-discipline-table--org">
        <div className="admin-discipline-table__head">
          <span>Дисциплина</span>
          <span>Преподаватели</span>
          <span>Эксперты</span>
          <span>Группы</span>
          <span>Действия</span>
        </div>
        <div className="admin-discipline-table__body">
          {adminVisibleDisciplines.length ? (
            adminVisibleDisciplines.map((discipline) => {
              const teachers = discipline.teacher_ids
                .map((linkedTeacherId) => teacherById.get(linkedTeacherId)?.name)
                .filter(Boolean) as string[];
              const experts = discipline.expert_ids
                .map((linkedExpertId) => expertById.get(linkedExpertId)?.name)
                .filter(Boolean) as string[];
              const groups = discipline.group_ids
                .map((groupId) => groupById.get(groupId)?.name)
                .filter(Boolean) as string[];

              return (
                <article className="admin-discipline-row admin-discipline-row--org" key={discipline.id}>
                  <div className="admin-discipline-row__identity">
                    <strong>{discipline.name}</strong>
                    <small>ID: {shortId(discipline.id)}</small>
                  </div>
                  <div>{renderListValue(teachers)}</div>
                  <div>{renderListValue(experts)}</div>
                  <div className="admin-discipline-row__groups">
                    {groups.length ? (
                      groups.map((group) => (
                        <span className="admin-chip" key={group}>
                          {group}
                        </span>
                      ))
                    ) : (
                      <span className="home-hint">Не назначены</span>
                    )}
                  </div>
                  <div className="discipline-row__actions">
                    <MotionLink
                      className="secondary-button discipline-row__action"
                      to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`}
                    >
                      Паспорт
                    </MotionLink>
                  </div>
                </article>
              );
            })
          ) : (
            <p className="home-hint">Дисциплины не найдены.</p>
          )}
        </div>
      </div>
    );

    const renderAdminCreateUserForm = () => {
      if (adminCreateUserTab === "teacher") {
        return (
          <form className="home-form" onSubmit={handleCreateTeacher}>
            <div className="admin-panel-block__heading">
              <p className="card__eyebrow">Преподаватели</p>
              <h3>Создать преподавателя</h3>
            </div>
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
                onChange={(event) => setTeacherPassword(event.target.value)}
                placeholder="Введите пароль"
                required
                type="password"
                value={teacherPassword}
              />
            </label>
            <div className="home-checklist">
              <span>Учебные группы преподавателя</span>
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
            <button className="primary-button" disabled={busyAction === "teacher"} type="submit">
              {busyAction === "teacher" ? "Создаю..." : "Создать преподавателя"}
            </button>
          </form>
        );
      }

      if (adminCreateUserTab === "expert") {
        return (
          <form className="home-form" onSubmit={handleCreateExpert}>
            <div className="admin-panel-block__heading">
              <p className="card__eyebrow">Эксперты</p>
              <h3>Создать эксперта</h3>
            </div>
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
                onChange={(event) => setExpertPassword(event.target.value)}
                placeholder="Введите пароль"
                required
                type="password"
                value={expertPassword}
              />
            </label>
            <button className="primary-button" disabled={busyAction === "expert"} type="submit">
              {busyAction === "expert" ? "Создаю..." : "Создать эксперта"}
            </button>
          </form>
        );
      }

      if (adminCreateUserTab === "admin") {
        return (
          <form className="home-form" onSubmit={handleCreateAdmin}>
            <div className="admin-panel-block__heading">
              <p className="card__eyebrow">Администраторы</p>
              <h3>Создать администратора</h3>
            </div>
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
                onChange={(event) => setAdminPassword(event.target.value)}
                placeholder="Введите пароль"
                required
                type="password"
                value={adminPassword}
              />
            </label>
            <button className="primary-button" disabled={busyAction === "admin"} type="submit">
              {busyAction === "admin" ? "Создаю..." : "Создать администратора"}
            </button>
          </form>
        );
      }

      return (
        <form className="home-form" onSubmit={handleCreateStudent}>
          <div className="admin-panel-block__heading">
            <p className="card__eyebrow">Студенты</p>
            <h3>Создать студента</h3>
          </div>
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
              onChange={(event) => setStudentPassword(event.target.value)}
              placeholder="Введите пароль"
              required
              type="password"
              value={studentPassword}
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
          <label className="field">
            <span>Подгруппа</span>
            <select
              value={studentSubgroupId}
              onChange={(event) => setStudentSubgroupId(event.target.value)}
              disabled={!studentGroupId}
            >
              <option value="">Без подгруппы</option>
              {(subgroupsByGroupId.get(studentGroupId) ?? []).map((subgroup) => (
                <option key={subgroup.id} value={subgroup.id}>
                  Подгруппа {subgroup.subgroup_num}
                </option>
              ))}
            </select>
          </label>
          {!data.groups.length ? (
            <p className="home-hint">Сначала создайте группу, затем можно добавить студента.</p>
          ) : null}
          <button
            className="primary-button"
            disabled={busyAction === "student" || !studentGroupId}
            type="submit"
          >
            {busyAction === "student" ? "Создаю..." : "Создать студента"}
          </button>
        </form>
      );
    };

    return (
      <motion.section className="home-section admin-admin-stack" {...buildReveal(0.06)}>
        <motion.section className="home-card home-card--wide admin-system-card" {...CARD_MOTION}>
          <div className="admin-section-heading admin-section-heading--with-action">
            <div>
              <p className="card__eyebrow">Пользователи</p>
              <h2>Все пользователи системы</h2>
              <p className="card__text">
                {filteredAdminDirectoryUsers.length} из {adminDirectoryUsers.length} записей по текущему фильтру.
              </p>
            </div>
            <button
              className="secondary-button admin-section-toggle"
              onClick={() => setAdminUsersExpanded((expanded) => !expanded)}
              type="button"
            >
              {adminUsersExpanded ? "Свернуть список" : "Развернуть список"}
            </button>
          </div>

          {adminUsersExpanded ? (
            <>
              <div className="admin-filter-grid">
                <label className="field">
                  <span>Поиск</span>
                  <input
                    value={adminUserSearch}
                    onChange={(event) => setAdminUserSearch(event.target.value)}
                    placeholder="ФИО, логин, группа, дисциплины"
                  />
                </label>
                <label className="field">
                  <span>Роль</span>
                  <select
                    value={adminUserRoleFilter}
                    onChange={(event) =>
                      setAdminUserRoleFilter(event.target.value as AdminUserRoleFilter)
                    }
                  >
                    <option value="all">Все роли</option>
                    <option value="student">Студенты</option>
                    <option value="teacher">Преподаватели</option>
                    <option value="expert">Эксперты</option>
                    <option value="admin">Администраторы</option>
                  </select>
                </label>
                <label className="field">
                  <span>Группа</span>
                  <select
                    value={adminUserGroupFilter}
                    onChange={(event) => setAdminUserGroupFilter(event.target.value)}
                  >
                    <option value="">Все группы</option>
                    {data.groups.map((group) => (
                      <option key={group.id} value={group.id}>
                        {group.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Подгруппа</span>
                  <select
                    value={adminUserSubgroupFilter}
                    onChange={(event) => setAdminUserSubgroupFilter(event.target.value)}
                  >
                    <option value="">Все подгруппы</option>
                    {data.subgroups.map((subgroup) => (
                      <option key={subgroup.id} value={subgroup.id}>
                        {groupById.get(subgroup.group_id)?.name ?? "Группа"} · {subgroup.subgroup_num}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field">
                  <span>Дисциплина</span>
                  <select
                    value={adminUserDisciplineFilter}
                    onChange={(event) => setAdminUserDisciplineFilter(event.target.value)}
                  >
                    <option value="">Все дисциплины</option>
                    {data.disciplines.map((discipline) => (
                      <option key={discipline.id} value={discipline.id}>
                        {discipline.name}
                      </option>
                    ))}
                  </select>
                </label>
              </div>

              <div className="admin-directory-table">
                <div className="admin-directory-table__head">
                  <span>Пользователь</span>
                  <span>Роль</span>
                  <span>Группа</span>
                  <span>Дисциплины</span>
                  <span>Действия</span>
                </div>
                <div className="admin-directory-table__body">
                  {filteredAdminDirectoryUsers.length ? (
                    filteredAdminDirectoryUsers.map((user) => {
                      const groups = user.groupIds
                        .map((groupId) => groupById.get(groupId)?.name)
                        .filter(Boolean) as string[];
                      const disciplines = user.disciplineIds
                        .map((disciplineId) => disciplineById.get(disciplineId)?.name)
                        .filter(Boolean) as string[];
                      const subgroup = user.subgroupId ? subgroupById.get(user.subgroupId) : null;
                      const isDeleting = busyAction === `delete-${user.role}-${user.id}`;
                      const isCurrentAdminProfile = isCurrentAdminDirectoryUser(user);

                      return (
                        <article className="admin-directory-row" key={`${user.role}-${user.id}`}>
                          <div>
                            <strong>{user.name}</strong>
                            <small>{user.login}</small>
                          </div>
                          <span>{user.roleLabel}</span>
                          <span>
                            {groups.length ? groups.join(", ") : "Не назначена"}
                            {subgroup ? ` · подгруппа ${subgroup.subgroup_num}` : ""}
                          </span>
                          <span>{disciplines.length ? disciplines.join(", ") : "Не назначены"}</span>
                          <div className="admin-directory-row__actions">
                            <button
                              className="secondary-button"
                              disabled={isDeleting}
                              onClick={() => navigate(getAdminUserViewPath(user))}
                              type="button"
                            >
                              Подробнее
                            </button>
                            <button
                              className="secondary-button secondary-button--danger"
                              disabled={isDeleting || isCurrentAdminProfile}
                              onClick={() => void handleDeleteAdminUser(user)}
                              type="button"
                            >
                              {isCurrentAdminProfile ? "Текущий админ" : "Удалить"}
                            </button>
                          </div>
                        </article>
                      );
                    })
                  ) : (
                    <p className="home-hint">Пользователи не найдены.</p>
                  )}
                </div>
              </div>
            </>
          ) : (
            <p className="card__text">Список пользователей скрыт. Разверните блок, чтобы посмотреть записи и фильтры.</p>
          )}
        </motion.section>

        <motion.section className="home-card home-card--wide admin-system-card" {...CARD_MOTION}>
          <div className="admin-section-heading admin-section-heading--with-action">
            <div>
              <p className="card__eyebrow">Создание</p>
              <h2>Создание пользователей</h2>
              <p className="card__text">Выберите тип учетной записи и заполните форму ниже.</p>
            </div>
            <button
              className="secondary-button admin-section-toggle"
              onClick={() => setAdminCreateUsersExpanded((expanded) => !expanded)}
              type="button"
            >
              {adminCreateUsersExpanded ? "Свернуть блок" : "Развернуть блок"}
            </button>
          </div>

          {adminCreateUsersExpanded ? (
            <>
              <div className="admin-user-type-grid">
                {[
                  ["student", "Создать студента"],
                  ["teacher", "Создать преподавателя"],
                  ["expert", "Создать эксперта"],
                  ["admin", "Создать администратора"],
                ].map(([key, label]) => (
                  <button
                    className={
                      adminCreateUserTab === key
                        ? "primary-button admin-user-type-button"
                        : "secondary-button admin-user-type-button"
                    }
                    key={key}
                    onClick={() => setAdminCreateUserTab(key as AdminCreateUserTab)}
                    type="button"
                  >
                    {label}
                  </button>
                ))}
              </div>

              <section className="admin-panel-block">{renderAdminCreateUserForm()}</section>
            </>
          ) : (
            <p className="card__text">Блок создания пользователей свернут.</p>
          )}
        </motion.section>

        <motion.section className="home-card home-card--wide admin-system-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Группы</p>
            <h2>Создание групп и подгрупп</h2>
            <p className="card__text">
              {data.groups.length} групп, {data.subgroups.length} подгрупп.
            </p>
          </div>

          <div className="admin-organization-grid">
            <section className="admin-panel-block">
              <div className="admin-modal-tabs" role="tablist" aria-label="Создание групп">
                <button
                  className={adminGroupTab === "group" ? "primary-button" : "secondary-button"}
                  onClick={() => setAdminGroupTab("group")}
                  type="button"
                >
                  Новая группа
                </button>
                <button
                  className={adminGroupTab === "subgroup" ? "primary-button" : "secondary-button"}
                  onClick={() => setAdminGroupTab("subgroup")}
                  type="button"
                >
                  Новая подгруппа
                </button>
              </div>

              {adminGroupTab === "group" ? (
                <form className="home-form" onSubmit={handleCreateGroup}>
                  <div className="admin-panel-block__heading">
                    <p className="card__eyebrow">Группа</p>
                    <h3>Создать учебную группу</h3>
                  </div>
                  <label className="field">
                    <span>Название группы</span>
                    <input
                      value={groupName}
                      onChange={(event) => setGroupName(event.target.value)}
                      placeholder="Например: Б9124-09.03.04"
                      required
                    />
                  </label>
                  <button className="primary-button" disabled={busyAction === "group"} type="submit">
                    {busyAction === "group" ? "Создаю..." : "Создать группу"}
                  </button>
                </form>
              ) : (
                <form className="home-form" onSubmit={handleCreateSubgroup}>
                  <div className="admin-panel-block__heading">
                    <p className="card__eyebrow">Подгруппа</p>
                    <h3>Создать подгруппу</h3>
                  </div>
                  <label className="field">
                    <span>Группа</span>
                    <select
                      value={subgroupGroupId}
                      onChange={(event) => setSubgroupGroupId(event.target.value)}
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
                  <label className="field">
                    <span>Номер подгруппы</span>
                    <input
                      min={1}
                      onChange={(event) => setSubgroupNum(event.target.value)}
                      placeholder="1"
                      required
                      type="number"
                      value={subgroupNum}
                    />
                  </label>
                  {!data.groups.length ? (
                    <p className="home-hint">Сначала создайте хотя бы одну группу.</p>
                  ) : null}
                  <button
                    className="primary-button"
                    disabled={busyAction === "subgroup" || !subgroupGroupId}
                    type="submit"
                  >
                    {busyAction === "subgroup" ? "Создаю..." : "Создать подгруппу"}
                  </button>
                </form>
              )}
            </section>

            <section className="admin-panel-block">
              <div className="admin-panel-block__heading">
                <p className="card__eyebrow">Структура</p>
                <h3>Текущие группы</h3>
              </div>
              {data.groups.length ? (
                <div className="admin-group-list">
                  {data.groups.map((group) => {
                    const groupSubgroups = subgroupsByGroupId.get(group.id) ?? [];
                    return (
                      <article className="admin-group-card" key={group.id}>
                        <strong>{group.name}</strong>
                        <span>
                          {groupSubgroups.length
                            ? `Подгруппы: ${groupSubgroups.map((subgroup) => subgroup.subgroup_num).join(", ")}`
                            : "Подгрупп пока нет"}
                        </span>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <p className="home-hint">Группы пока не созданы.</p>
              )}
            </section>
          </div>
        </motion.section>

        <motion.section className="home-card home-card--wide admin-discipline-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Дисциплины</p>
            <h2>Дисциплины и закрепление дисциплин</h2>
            <p className="card__text">
              Администратор создает дисциплины и назначает преподавателей. Граф знаний ведет эксперт и этот блок здесь не редактируется.
            </p>
          </div>

          <div className="admin-discipline-split">
            <section className="admin-panel-block">
              <form className="home-form admin-create-discipline-form" onSubmit={handleCreateDiscipline}>
                <div className="admin-panel-block__heading">
                  <p className="card__eyebrow">Новая дисциплина</p>
                  <h3>Создать дисциплину</h3>
                </div>
                <div className="admin-discipline-create admin-discipline-create--admin">
                  <label className="field">
                    <span>Название новой дисциплины</span>
                    <input
                      value={disciplineName}
                      onChange={(event) => setDisciplineName(event.target.value)}
                      placeholder="Например: Теория графов"
                      required
                    />
                  </label>
                  <button
                    className="primary-button"
                    disabled={busyAction === "discipline" || !canCreateDiscipline}
                    type="submit"
                  >
                    {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
                  </button>
                </div>
                <p className="home-hint">
                  После создания дисциплины назначьте ей преподавателей в соседнем блоке.
                </p>
              </form>
            </section>

            <section className="admin-panel-block">
              <div className="admin-panel-block__heading">
                <p className="card__eyebrow">Назначения</p>
                <h3>Закрепить дисциплину</h3>
              </div>
              <form className="home-form" onSubmit={handleUpdateDisciplineAssignments}>
                <div className="admin-assignment-grid">
                  <label className="field">
                    <span>Дисциплина</span>
                    <select
                      value={assignmentDisciplineId}
                      onChange={(event) => setAssignmentDisciplineId(event.target.value)}
                      disabled={!visibleDisciplines.length}
                    >
                      {visibleDisciplines.map((discipline) => (
                        <option key={discipline.id} value={discipline.id}>
                          {discipline.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button admin-assignment-save-button"
                    disabled={!assignmentDisciplineId || busyAction === "discipline-assignments"}
                    type="submit"
                  >
                    {busyAction === "discipline-assignments" ? "Сохраняю..." : "Сохранить"}
                  </button>
                </div>

                <div className="admin-assignment-checks admin-assignment-checks--teachers admin-assignment-checks--teachers-upgraded">
                  <div className="admin-assignment-picker">
                    <label className="field">
                      <span>Поиск преподавателя</span>
                      <input
                        value={assignmentTeacherSearch}
                        onChange={(event) => setAssignmentTeacherSearch(event.target.value)}
                        placeholder="Введите имя преподавателя"
                      />
                    </label>

                    <div className="admin-assignment-picker__section">
                      <span className="admin-assignment-picker__label">Выбраны для привязки</span>
                      {assignmentTeacherIds.length ? (
                        <div className="admin-chip-list">
                          {assignmentTeacherIds.map((teacherId) => (
                            <button
                              className="admin-chip admin-chip--button"
                              key={teacherId}
                              onClick={() => handleRemoveAssignmentTeacher(teacherId)}
                              type="button"
                            >
                              {teacherById.get(teacherId)?.name ?? teacherId} ×
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="home-hint">Пока не выбран ни один преподаватель.</p>
                      )}
                    </div>

                    <div className="admin-assignment-picker__section">
                      <span className="admin-assignment-picker__label">Результаты поиска</span>
                      {!availableTeacherOptions.length ? (
                        <p className="home-hint">Преподаватели пока не созданы.</p>
                      ) : !assignmentTeacherSearch.trim() ? (
                        <p className="home-hint">Начните вводить имя преподавателя.</p>
                      ) : assignmentTeacherOptions.length ? (
                        <div className="admin-assignment-results">
                          {assignmentTeacherOptions.map((teacher) => (
                            <button
                              className="secondary-button admin-assignment-results__item"
                              key={teacher.id}
                              onClick={() => handleAddAssignmentTeacher(teacher.id)}
                              type="button"
                            >
                              {teacher.name}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <p className="home-hint">
                          По запросу никто не найден или все уже добавлены.
                        </p>
                      )}
                    </div>
                  </div>
                </div>

                <div className="admin-assignment-checks admin-assignment-checks--teachers">
                  <div className="home-checklist admin-assignment-checklist">
                    <span>Преподаватели</span>
                    {data.teachers.length ? (
                      data.teachers.map((teacher) => (
                        <label className="home-check" key={teacher.id}>
                          <input
                            checked={assignmentTeacherIds.includes(teacher.id)}
                            onChange={() =>
                              setAssignmentTeacherIds((current) => toggleId(current, teacher.id))
                            }
                            type="checkbox"
                          />
                          {teacher.name}
                        </label>
                      ))
                    ) : (
                      <p className="home-hint">Преподаватели пока не созданы.</p>
                    )}
                  </div>
                </div>
              </form>
            </section>
          </div>

          <section className="admin-panel-block">
            <div className="admin-section-heading admin-section-heading--with-action">
              <div>
                <p className="card__eyebrow">Список дисциплин</p>
                <h3>Все дисциплины и закрепления</h3>
              </div>
              <button
                className="secondary-button admin-section-toggle"
                onClick={() => setAdminDisciplineListExpanded((expanded) => !expanded)}
                type="button"
              >
                {adminDisciplineListExpanded ? "Свернуть список" : "Развернуть список"}
              </button>
            </div>
            {adminDisciplineListExpanded ? (
              <>
                <div className="admin-discipline-toolbar admin-discipline-toolbar--list admin-discipline-toolbar--list-upgraded">
                  <label className="field">
                    <span>Поиск</span>
                    <input
                      value={adminDisciplineSearch}
                      onChange={(event) => setAdminDisciplineSearch(event.target.value)}
                      placeholder="Дисциплина, преподаватель"
                    />
                  </label>
                  <button
                    className="secondary-button admin-discipline-filters__reset"
                    onClick={() => setAdminDisciplineSearch("")}
                    type="button"
                  >
                    Сбросить
                  </button>
                </div>

                <div className="admin-discipline-toolbar admin-discipline-toolbar--list">
                  <label className="field">
                    <span>Поиск</span>
                    <input
                      value={adminDisciplineSearch}
                      onChange={(event) => setAdminDisciplineSearch(event.target.value)}
                      placeholder="Дисциплина, преподаватель"
                    />
                  </label>
                  <label className="field">
                    <span>Преподаватель</span>
                    <select
                      value={adminTeacherFilterId}
                      onChange={(event) => setAdminTeacherFilterId(event.target.value)}
                    >
                      <option value="">Все преподаватели</option>
                      {data.teachers.map((teacher) => (
                        <option key={teacher.id} value={teacher.id}>
                          {teacher.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="secondary-button admin-discipline-filters__reset"
                    onClick={() => {
                      setAdminDisciplineSearch("");
                      setAdminTeacherFilterId("");
                    }}
                    type="button"
                  >
                    Сбросить
                  </button>
                </div>

                {renderDisciplineRows()}
              </>
            ) : (
              <p className="card__text">Список дисциплин свернут.</p>
            )}
          </section>
        </motion.section>
      </motion.section>
    );
  }

  function renderAdminDisciplineSection() {
    const renderDisciplineRows = () => (
      <div className="admin-discipline-table">
        <div className="admin-discipline-table__head">
          <span>Дисциплина</span>
          <span>Преподаватели</span>
          <span>Группы</span>
          <span>Действия</span>
        </div>

        <div className="admin-discipline-table__body">
          {adminVisibleDisciplines.length ? (
            adminVisibleDisciplines.map((discipline) => {
              const teachers = discipline.teacher_ids
                .map((linkedTeacherId) => teacherById.get(linkedTeacherId)?.name)
                .filter(Boolean);
              const groups = discipline.group_ids
                .map((groupId) => groupById.get(groupId)?.name)
                .filter(Boolean);

              return (
                <motion.article
                  className="admin-discipline-row"
                  key={discipline.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, ease: REVEAL_EASE }}
                >
                  <div className="admin-discipline-row__identity">
                    <div>
                      <strong>{discipline.name}</strong>
                      <small>ID: {shortId(discipline.id)}</small>
                      <small>Группы: {groups.length ? groups.join(", ") : "не назначены"}</small>
                    </div>
                  </div>
                  <div className="admin-discipline-row__teachers">
                    {teachers.length ? teachers.join(", ") : "не назначены"}
                  </div>
                  <div className="admin-discipline-row__groups">
                    {groups.length ? (
                      groups.map((group) => (
                        <span className="admin-chip" key={group}>
                          {group}
                        </span>
                      ))
                    ) : (
                      <span className="home-hint">Нет групп</span>
                    )}
                  </div>
                  <div className="discipline-row__actions">
                    <MotionLink
                      className="secondary-button discipline-row__action"
                      to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`}
                      {...ACTION_MOTION}
                    >
                      Паспорт
                    </MotionLink>
                    <MotionLink
                      className="primary-button discipline-row__action"
                      to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/knowledge`}
                      {...ACTION_MOTION}
                    >
                      Открыть
                    </MotionLink>
                  </div>
                </motion.article>
              );
            })
          ) : (
            <p className="home-hint">По текущему фильтру дисциплины не найдены.</p>
          )}
        </div>
      </div>
    );

    return (
      <motion.section className="home-section admin-admin-stack" {...buildReveal(0.06)}>
        <motion.section className="home-card home-card--wide admin-system-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Пользователи</p>
            <h2>Создание пользователя</h2>
          </div>
          <div className="admin-user-type-grid">
            {[
              ["student", "Студент"],
              ["teacher", "Преподаватель"],
              ["expert", "Эксперт"],
              ["admin", "Администратор"],
            ].map(([key, label]) => (
              <button
                className="secondary-button admin-user-type-button"
                key={key}
                onClick={() =>
                  openAdminModalTab(key as "student" | "teacher" | "expert" | "admin")
                }
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
        </motion.section>

        <motion.section className="home-card home-card--wide admin-discipline-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Назначение</p>
            <h2>Закрепление дисциплины за преподавателями</h2>
          </div>
          <form className="home-form" onSubmit={handleUpdateDisciplineAssignments}>
            <div className="admin-assignment-grid">
              <label className="field">
                <span>Дисциплина</span>
                <select
                  value={assignmentDisciplineId}
                  onChange={(event) => setAssignmentDisciplineId(event.target.value)}
                  disabled={!visibleDisciplines.length}
                >
                  {visibleDisciplines.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="primary-button"
                disabled={!assignmentDisciplineId || busyAction === "discipline-assignments"}
              >
                {busyAction === "discipline-assignments" ? "Сохраняю..." : "Сохранить"}
              </button>
            </div>

            <div className="home-checklist admin-assignment-checklist">
              <span>Преподаватели</span>
              {availableTeacherOptions.length ? (
                availableTeacherOptions.map((teacher) => (
                  <label className="home-check" key={teacher.id}>
                    <input
                      checked={assignmentTeacherIds.includes(teacher.id)}
                      onChange={() =>
                        setAssignmentTeacherIds((current) => toggleId(current, teacher.id))
                      }
                      type="checkbox"
                    />
                    {teacher.name}
                  </label>
                ))
              ) : (
                <p className="home-hint">Преподаватели пока не созданы.</p>
              )}
            </div>
          </form>
        </motion.section>

        <motion.section className="home-card home-card--wide admin-discipline-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <p className="card__eyebrow">Дисциплины</p>
            <h2>Список дисциплин</h2>
          </div>
          <div className="admin-discipline-toolbar admin-discipline-toolbar--list">
            <label className="field">
              <span>Поиск</span>
              <input
                value={adminDisciplineSearch}
                onChange={(event) => setAdminDisciplineSearch(event.target.value)}
                placeholder="Дисциплина или преподаватель"
              />
            </label>
            <label className="field">
              <span>Преподаватель</span>
              <select
                value={adminTeacherFilterId}
                onChange={(event) => setAdminTeacherFilterId(event.target.value)}
              >
                <option value="">Все преподаватели</option>
                {availableTeacherOptions.map((teacher) => (
                  <option key={teacher.id} value={teacher.id}>
                    {teacher.name}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary-button admin-discipline-filters__reset"
              onClick={() => {
                setAdminDisciplineSearch("");
                setAdminTeacherFilterId("");
              }}
              type="button"
            >
              Сбросить
            </button>
          </div>
          {renderDisciplineRows()}
        </motion.section>
      </motion.section>
    );

    return (
      <motion.section className="home-section" {...buildReveal(0.06)}>
        <motion.section
          className="home-card home-card--wide home-card--spotlight admin-discipline-card"
          {...CARD_MOTION}
        >
          <div className="admin-section-heading admin-section-heading--with-action">
            <div>
              <p className="card__eyebrow">Дисциплины</p>
              <h2>Дисциплины и преподаватели</h2>
              <p className="card__text">
                Ищите дисциплины, проверяйте закрепления и назначайте нескольких
                преподавателей на одну дисциплину.
              </p>
            </div>
            <button
              className="primary-button admin-add-user-button"
              onClick={() => openAdminModalTab("student")}
              type="button"
            >
              Добавить пользователя
            </button>
          </div>

          <div className="admin-discipline-split">
            <section className="admin-panel-block">
              <div className="admin-panel-block__heading">
                <p className="card__eyebrow">Поиск</p>
                <h3>Найти дисциплину или преподавателя</h3>
              </div>
              <div className="admin-discipline-toolbar">
                <label className="field">
                  <span>Поиск по дисциплине или преподавателю</span>
                  <input
                    value={adminDisciplineSearch}
                    onChange={(event) => setAdminDisciplineSearch(event.target.value)}
                    placeholder="Например: Теория графов или Петров"
                  />
                </label>
                <label className="field">
                  <span>Фильтр по преподавателю</span>
                  <select
                    value={adminTeacherFilterId}
                    onChange={(event) => setAdminTeacherFilterId(event.target.value)}
                  >
                    <option value="">Все преподаватели</option>
                    {availableTeacherOptions.map((teacher) => (
                      <option key={teacher.id} value={teacher.id}>
                        {teacher.name}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="secondary-button admin-discipline-filters__reset"
                  onClick={() => {
                    setAdminDisciplineSearch("");
                    setAdminTeacherFilterId("");
                  }}
                  type="button"
                >
                  Сбросить
                </button>
              </div>
            </section>

            <section className="admin-panel-block">
              <div className="admin-panel-block__heading">
                <p className="card__eyebrow">Назначение</p>
                <h3>Закрепить преподавателей за дисциплиной</h3>
              </div>
              <form className="home-form" onSubmit={handleUpdateDisciplineAssignments}>
                <div className="admin-assignment-grid">
                  <label className="field">
                    <span>Дисциплина</span>
                    <select
                      value={assignmentDisciplineId}
                      onChange={(event) => setAssignmentDisciplineId(event.target.value)}
                      disabled={!visibleDisciplines.length}
                    >
                      {visibleDisciplines.map((discipline) => (
                        <option key={discipline.id} value={discipline.id}>
                          {discipline.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    disabled={!assignmentDisciplineId || busyAction === "discipline-assignments"}
                  >
                    {busyAction === "discipline-assignments"
                      ? "Сохраняю..."
                      : "Сохранить назначение"}
                  </button>
                </div>

                <div className="admin-assignment-checks">
                  <div className="home-checklist admin-assignment-checklist">
                    <span>Преподаватели дисциплины</span>
                    {availableTeacherOptions.length ? (
                      availableTeacherOptions.map((teacher) => (
                        <label className="home-check" key={teacher.id}>
                          <input
                            checked={assignmentTeacherIds.includes(teacher.id)}
                            onChange={() =>
                              setAssignmentTeacherIds((current) => toggleId(current, teacher.id))
                            }
                            type="checkbox"
                          />
                          {teacher.name}
                        </label>
                      ))
                    ) : (
                      <p className="home-hint">Преподаватели пока не созданы.</p>
                    )}
                  </div>

                  <div className="home-checklist admin-assignment-checklist">
                    <span>Группы, которые изучают дисциплину</span>
                    {availableGroups.length ? (
                      availableGroups.map((group) => (
                        <label className="home-check" key={group.id}>
                          <input
                            checked={assignmentGroupIds.includes(group.id)}
                            onChange={() =>
                              setAssignmentGroupIds((current) => toggleId(current, group.id))
                            }
                            type="checkbox"
                          />
                          {group.name}
                        </label>
                      ))
                    ) : (
                      <p className="home-hint">Группы пока не созданы.</p>
                    )}
                  </div>
                </div>
              </form>
            </section>
          </div>

          <form className="home-form admin-create-discipline-form" onSubmit={handleCreateDiscipline}>
            <div className="admin-discipline-create">
              <label className="field">
                <span>Название новой дисциплины</span>
                <input
                  value={disciplineName}
                  onChange={(event) => setDisciplineName(event.target.value)}
                  placeholder="Например: Теория графов"
                  required
                />
              </label>
              <label className="field">
                <span>Первый преподаватель</span>
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
              <motion.button
                className="primary-button"
                disabled={busyAction === "discipline" || !canCreateDiscipline}
                {...ACTION_MOTION}
              >
                {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
              </motion.button>
            </div>

            <div className="home-checklist admin-discipline-groups">
              <span>Группы для новой дисциплины</span>
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
                  Сначала создайте группу, затем ее можно будет привязать к дисциплине.
                </p>
              )}
            </div>
          </form>

          {renderDisciplineRows()}
        </motion.section>
      </motion.section>
    );

    return (
      <motion.section className="home-section" {...buildReveal(0.06)}>
        <motion.section
          className="home-card home-card--wide home-card--spotlight admin-discipline-card"
          {...CARD_MOTION}
        >
          <div className="admin-section-heading">
            <div>
              <p className="card__eyebrow">Дисциплины</p>
              <h2>Дисциплины и преподаватели</h2>
              <p className="card__text">
                Закрепляйте дисциплины за преподавателями и группами.
              </p>
            </div>
          </div>

          <form className="home-form" onSubmit={handleCreateDiscipline}>
            <div className="admin-discipline-toolbar">
              <label className="field">
                <span>Поиск по названию дисциплины</span>
                <input
                  value={adminDisciplineSearch}
                  onChange={(event) => setAdminDisciplineSearch(event.target.value)}
                  placeholder="Поиск по названию дисциплины"
                />
              </label>
              <label className="field">
                <span>Преподаватель</span>
                <select
                  value={adminTeacherFilterId}
                  onChange={(event) => setAdminTeacherFilterId(event.target.value)}
                >
                  <option value="">Все преподаватели</option>
                  {availableTeacherOptions.map((teacher) => (
                    <option key={teacher.id} value={teacher.id}>
                      {teacher.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                className="secondary-button admin-discipline-filters__reset"
                onClick={() => {
                  setAdminDisciplineSearch("");
                  setAdminTeacherFilterId("");
                }}
                type="button"
              >
                Сбросить
              </button>
            </div>

            <div className="admin-discipline-create">
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
                <span>Преподаватель дисциплины</span>
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
              <motion.button
                className="primary-button"
                disabled={busyAction === "discipline" || !canCreateDiscipline}
                {...ACTION_MOTION}
              >
                {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
              </motion.button>
            </div>

            <div className="home-checklist admin-discipline-groups">
              <span>Группы, которые изучают дисциплину</span>
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
                  Сначала создайте группу, затем ее можно будет привязать к дисциплине.
                </p>
              )}
            </div>
          </form>

          <div className="admin-discipline-table">
            <div className="admin-discipline-table__head">
              <span>Дисциплина</span>
              <span>Преподаватель</span>
              <span>Группы</span>
              <span>Действия</span>
            </div>

            <div className="admin-discipline-table__body">
              {adminVisibleDisciplines.length ? (
                adminVisibleDisciplines.map((discipline) => {
                  const teachers = discipline.teacher_ids
                    .map((linkedTeacherId) => teacherById.get(linkedTeacherId)?.name)
                    .filter(Boolean);
                  const groups = discipline.group_ids
                    .map((groupId) => groupById.get(groupId)?.name)
                    .filter(Boolean);

                  return (
                    <motion.article
                      className="admin-discipline-row"
                      key={discipline.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.28, ease: REVEAL_EASE }}
                    >
                      <div className="admin-discipline-row__identity">
                        <div>
                          <strong>{discipline.name}</strong>
                          <small>ID: {shortId(discipline.id)}</small>
                          <small>
                            Группы: {groups.length ? groups.join(", ") : "не назначены"}
                          </small>
                        </div>
                      </div>
                      <div className="admin-discipline-row__teachers">
                        {teachers.length ? teachers.join(", ") : "не назначен"}
                      </div>
                      <div className="admin-discipline-row__groups">
                        {groups.length ? (
                          groups.map((group) => (
                            <span className="admin-chip" key={group}>
                              {group}
                            </span>
                          ))
                        ) : (
                          <span className="home-hint">Нет групп</span>
                        )}
                      </div>
                      <div className="discipline-row__actions">
                        <MotionLink
                          className="secondary-button discipline-row__action"
                          to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`}
                          {...ACTION_MOTION}
                        >
                          Паспорт
                        </MotionLink>
                        <MotionLink
                          className="primary-button discipline-row__action"
                          to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/knowledge`}
                          {...ACTION_MOTION}
                        >
                          Открыть
                        </MotionLink>
                      </div>
                    </motion.article>
                  );
                })
              ) : (
                <p className="home-hint">По текущему фильтру дисциплины не найдены.</p>
              )}
            </div>
          </div>
        </motion.section>
      </motion.section>
    );
  }

  function renderAdminUsersSection() {
    return (
      <motion.section className="home-section" {...buildReveal(0.1)}>
        <motion.section className="home-card home-card--wide admin-system-card" {...CARD_MOTION}>
          <div className="admin-section-heading">
            <div>
              <p className="card__eyebrow">Пользователи</p>
              <h2>Создание пользователей</h2>
              <p className="card__text">
                Создавайте учетные записи студентов, преподавателей, экспертов и администраторов.
              </p>
            </div>
          </div>

          <div className="admin-management-grid">
            {[
              {
                key: "student",
                title: "Студент",
                text: "Создать учетную запись студента и привязать ее к группе.",
              },
              {
                key: "teacher",
                title: "Преподаватель",
                text: "Создать преподавателя и указать его учебные группы.",
              },
              {
                key: "expert",
                title: "Эксперт",
                text: "Создать эксперта для работы с дисциплинами и графами знаний.",
              },
              {
                key: "admin",
                title: "Администратор",
                text: "Создать дополнительную административную учетную запись.",
              },
            ].map((card) => (
              <button
                className="admin-management-card"
                key={card.key}
                onClick={() =>
                  openAdminModalTab(
                    card.key as "group" | "teacher" | "student" | "expert" | "admin",
                  )
                }
                type="button"
              >
                <div className="admin-management-card__content">
                  <strong>{card.title}</strong>
                  <p>{card.text}</p>
                </div>
              </button>
            ))}
          </div>
        </motion.section>
      </motion.section>
    );
  }

  return (
    <div className={`home-page home-page--${mode} immersive-page immersive-page--teacher`}>
      <motion.header
        className={`home-hero ${isTeacherMode ? "teacher-home-hero" : ""} ${isAdminMode ? "home-hero--admin" : ""}`}
        {...buildReveal(0.02)}
      >
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
      <AnimatePresence>{renderAdminUserDetailsModal()}</AnimatePresence>

      <>
        <main className="home-sections">
          {loading ? (
            <section className="status-view">
              <div className="status-view__pulse" />
              <h3>Загружаю данные рабочего экрана</h3>
            </section>
          ) : (
            isAdminMode ? (
              <>
                {renderAdminDashboardLayout()}
              </>
            ) : isExpertMode ? (
              <>
                {renderExpertDashboardLayout()}
              </>
            ) : (
            <>
          <motion.section className="home-section" {...buildReveal(0.06)}>
            <motion.section
              className={`home-card home-card--wide home-card--spotlight ${isAdminMode ? "admin-discipline-card" : ""}`}
              {...CARD_MOTION}
            >
              <div className="home-card__header">
                <div>
                  <p className="card__eyebrow">Дисциплины</p>
                  <h2>Графы знаний</h2>
                  {isAdminMode ? (
                    <p className="card__text">
                      Создавайте и управляйте дисциплинами, назначайте преподавателей и учебные
                      группы.
                    </p>
                  ) : null}
                </div>
              </div>

              <form className="home-form" onSubmit={handleCreateDiscipline}>
                {isAdminMode ? (
                  <div className="admin-discipline-toolbar">
                    <label className="field">
                      <span>Все преподаватели</span>
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
                    <motion.button
                      className="primary-button"
                      disabled={busyAction === "discipline" || !canCreateDiscipline}
                      {...ACTION_MOTION}
                    >
                      {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
                    </motion.button>
                  </div>
                ) : null}

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

                  {!isAdminMode ? (
                    isTeacherMode ? (
                      <label className="field">
                        <span>Преподаватель</span>
                        <input value={currentTeacher?.name ?? ""} readOnly />
                      </label>
                    ) : (
                      <div className="home-hint">
                        Эксперт создает дисциплину без назначения преподавателя. Преподавателя позже
                        может указать администратор.
                      </div>
                    )
                  ) : null}

                  {!isAdminMode ? (
                    <motion.button
                      className="primary-button"
                      disabled={
                        busyAction === "discipline" || !canCreateDiscipline
                      }
                      {...ACTION_MOTION}
                    >
                      {busyAction === "discipline" ? "Создаю..." : "Создать дисциплину"}
                    </motion.button>
                  ) : null}
                </div>

                {isAdminMode ? (
                  <div className="admin-discipline-filters">
                    <label className="field">
                      <span>Поиск по названию дисциплины</span>
                      <input
                        value={adminDisciplineSearch}
                        onChange={(event) => setAdminDisciplineSearch(event.target.value)}
                        placeholder="Поиск по названию дисциплины"
                      />
                    </label>
                    <label className="field">
                      <span>Преподаватель</span>
                      <select
                        value={adminTeacherFilterId}
                        onChange={(event) => setAdminTeacherFilterId(event.target.value)}
                      >
                        <option value="">Все преподаватели</option>
                        {availableTeacherOptions.map((teacher) => (
                          <option key={teacher.id} value={teacher.id}>
                            {teacher.name}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      className="secondary-button admin-discipline-filters__reset"
                      onClick={() => {
                        setAdminDisciplineSearch("");
                        setAdminTeacherFilterId("");
                      }}
                      type="button"
                    >
                      Сбросить
                    </button>
                  </div>
                ) : null}

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

                {(isAdminMode ? adminVisibleDisciplines : visibleDisciplines).map((discipline) => {
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
                          to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}`}
                          {...ACTION_MOTION}
                        >
                          Паспорт
                        </MotionLink>
                        <MotionLink
                          className="primary-button discipline-row__action"
                          to={`/disciplines/${disciplinePathValue(discipline, discipline.id)}/knowledge`}
                          {...ACTION_MOTION}
                        >
                          Открыть редактор
                        </MotionLink>
                        {!isExpertMode ? (
                          <MotionLink
                            className="secondary-button discipline-row__action"
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

          {isTeacherMode ? (
            <motion.section className="home-section" {...buildReveal(0.08)}>
              <motion.section
                className="home-card home-card--wide teacher-search-card"
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
                      <motion.article
                        className="overview-row teacher-student-search__row"
                        key={student.id}
                        {...ACTION_MOTION}
                      >
                        <strong>{student.name}</strong>
                        <span>
                          {student.login} ·{" "}
                          {groupById.get(student.group_id)?.name ?? "Группа не найдена"}
                        </span>
                      </motion.article>
                    ))
                  ) : (
                    <p className="home-hint">Студенты по запросу не найдены.</p>
                  )}
                </div>
              </motion.section>
            </motion.section>
          ) : null}

            </>
            )
          )}
        </main>
      </>
    </div>
  );
}
