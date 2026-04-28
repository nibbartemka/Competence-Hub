import type {
  CompetenceType,
  Discipline,
  DisciplineKnowledgeGraph,
  Group,
  KnowledgeElement,
  KnowledgeElementRelation,
  KnowledgeElementRelationType,
  LearningTrajectory,
  LearningTrajectorySummary,
  LearningTrajectoryTaskContent,
  LearningTrajectoryTaskTemplateKind,
  LearningTrajectoryTaskType,
  LearningTrajectoryTask,
  Student,
  StudentAssignedTask,
  StudentLearningTrajectorySummary,
  StudentTrajectoryMastery,
  StudentTopicControl,
  Subgroup,
  Teacher,
  Topic,
  TopicDependency,
  TopicDependencyRelationType,
  TopicKnowledgeElement,
  TopicKnowledgeElementRole,
} from "./types";

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "http://127.0.0.1:8000/api";

type RequestOptions = {
  body?: unknown;
  method?: string;
  signal?: AbortSignal;
};

export function isAbortError(error: unknown) {
  if (error instanceof DOMException) {
    return error.name === "AbortError";
  }

  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.message === "signal is aborted without reason" ||
      error.message === "The operation was aborted."
    );
  }

  return false;
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { body, method = "GET", signal } = options;
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw error;
    }
    throw new Error("Не удалось связаться с сервером API. Проверь, что backend запущен.");
  }

  if (!response.ok) {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const payload = (await response.json()) as { detail?: string };
      throw new Error(payload.detail || `HTTP ${response.status}`);
    }
    const message = await response.text();
    throw new Error(message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const rawText = await response.text();
  if (!rawText.trim()) {
    return undefined as T;
  }

  return JSON.parse(rawText) as T;
}

export function fetchDisciplines(signal?: AbortSignal) {
  return request<Discipline[]>("/disciplines/", { signal });
}

export function createDiscipline(payload: {
  name: string;
  teacher_id?: string | null;
  group_ids?: string[];
}) {
  return request<Discipline>("/disciplines/", {
    method: "POST",
    body: payload,
  });
}

export function fetchGroups(signal?: AbortSignal) {
  return request<Group[]>("/groups/", { signal });
}

export function createGroup(payload: { name: string }) {
  return request<Group>("/groups/", {
    method: "POST",
    body: payload,
  });
}

export function fetchSubgroups(groupId: string, signal?: AbortSignal) {
  return request<Subgroup[]>(`/groups/${groupId}/subgroups`, { signal });
}

export function createSubgroup(payload: { group_id: string; subgroup_num: number }) {
  return request<Subgroup>(`/groups/${payload.group_id}/subgroups`, {
    method: "POST",
    body: payload,
  });
}

export function fetchStudents(signal?: AbortSignal) {
  return request<Student[]>("/students/", { signal });
}

export function fetchStudentsByGroup(groupId: string, signal?: AbortSignal) {
  return request<Student[]>(
    `/students/?group_id=${encodeURIComponent(groupId)}`,
    { signal },
  );
}

export function fetchStudent(studentId: string, signal?: AbortSignal) {
  return request<Student>(`/students/${studentId}`, { signal });
}

export function createStudent(payload: {
  name: string;
  group_id: string;
  subgroup_id?: string | null;
}) {
  return request<Student>("/students/", {
    method: "POST",
    body: payload,
  });
}

export function fetchTeachers(signal?: AbortSignal) {
  return request<Teacher[]>("/teachers/", { signal });
}

export function fetchTeacher(teacherId: string, signal?: AbortSignal) {
  return request<Teacher>(`/teachers/${teacherId}`, { signal });
}

export function createTeacher(payload: { name: string; group_ids?: string[] }) {
  return request<Teacher>("/teachers/", {
    method: "POST",
    body: payload,
  });
}

export function fetchDisciplineKnowledgeGraph(
  disciplineId: string,
  signal?: AbortSignal,
) {
  return request<DisciplineKnowledgeGraph>(
    `/disciplines/${disciplineId}/knowledge-graph`,
    { signal },
  );
}

export function fetchKnowledgeElements(
  signal?: AbortSignal,
  disciplineId?: string,
) {
  const query = disciplineId ? `?discipline_id=${encodeURIComponent(disciplineId)}` : "";
  return request<KnowledgeElement[]>(`/knowledge-elements/${query}`, { signal });
}

export function fetchTopicKnowledgeElements(signal?: AbortSignal) {
  return request<TopicKnowledgeElement[]>("/topic-knowledge-elements/", { signal });
}

export function createTopic(payload: {
  name: string;
  description: string;
  discipline_id: string;
}) {
  return request<Topic>("/topics/", {
    method: "POST",
    body: payload,
  });
}

export function updateTopic(
  topicId: string,
  payload: {
    name: string;
    description: string;
  },
) {
  return request<Topic>(`/topics/${topicId}`, {
    method: "PUT",
    body: payload,
  });
}

export function deleteTopic(topicId: string) {
  return request<void>(`/topics/${topicId}`, {
    method: "DELETE",
  });
}

export function createKnowledgeElement(payload: {
  name: string;
  description: string;
  competence_type: CompetenceType;
  discipline_id: string;
}) {
  return request<KnowledgeElement>("/knowledge-elements/", {
    method: "POST",
    body: payload,
  });
}

export function updateKnowledgeElement(
  elementId: string,
  payload: {
    name: string;
    description: string;
    competence_type: CompetenceType;
  },
) {
  return request<KnowledgeElement>(`/knowledge-elements/${elementId}`, {
    method: "PUT",
    body: payload,
  });
}

export function deleteKnowledgeElement(elementId: string) {
  return request<void>(`/knowledge-elements/${elementId}`, {
    method: "DELETE",
  });
}

export function createTopicKnowledgeElement(payload: {
  topic_id: string;
  element_id: string;
  role: TopicKnowledgeElementRole;
  note: string;
}) {
  return request<TopicKnowledgeElement>("/topic-knowledge-elements/", {
    method: "POST",
    body: payload,
  });
}

export function createTopicDependency(payload: {
  prerequisite_topic_id: string;
  dependent_topic_id: string;
  relation_type: TopicDependencyRelationType;
  description: string;
}) {
  return request<TopicDependency>("/topic-dependencies/", {
    method: "POST",
    body: payload,
  });
}

export function createKnowledgeElementRelation(payload: {
  source_element_id: string;
  target_element_id: string;
  relation_type: KnowledgeElementRelationType;
  description: string;
}) {
  return request<KnowledgeElementRelation>("/knowledge-element-relations/", {
    method: "POST",
    body: payload,
  });
}

export function updateKnowledgeElementRelation(
  relationId: string,
  payload: {
    source_element_id: string;
    target_element_id: string;
    relation_type: KnowledgeElementRelationType;
    description: string;
  },
) {
  return request<KnowledgeElementRelation>(`/knowledge-element-relations/${relationId}`, {
    method: "PUT",
    body: payload,
  });
}

export function deleteKnowledgeElementRelation(relationId: string) {
  return request<void>(`/knowledge-element-relations/${relationId}`, {
    method: "DELETE",
  });
}

export function fetchLearningTrajectories(
  params: {
    discipline_id?: string;
    teacher_id?: string;
    group_id?: string;
    subgroup_id?: string;
    status_filter?: LearningTrajectory["status"];
  } = {},
  signal?: AbortSignal,
) {
  const query = new URLSearchParams();
  if (params.discipline_id) query.set("discipline_id", params.discipline_id);
  if (params.teacher_id) query.set("teacher_id", params.teacher_id);
  if (params.group_id) query.set("group_id", params.group_id);
  if (params.subgroup_id) query.set("subgroup_id", params.subgroup_id);
  if (params.status_filter) query.set("status_filter", params.status_filter);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<LearningTrajectorySummary[]>(`/learning-trajectories/${suffix}`, { signal });
}

export function fetchStudentLearningTrajectories(studentId: string, signal?: AbortSignal) {
  return request<StudentLearningTrajectorySummary[]>(
    `/learning-trajectories/students/${studentId}`,
    { signal },
  );
}

export function fetchLearningTrajectory(trajectoryId: string, signal?: AbortSignal) {
  return request<LearningTrajectory>(`/learning-trajectories/${trajectoryId}`, { signal });
}

export function createLearningTrajectory(payload: {
  name: string;
  discipline_id: string;
  teacher_id: string;
  group_id?: string | null;
  subgroup_id?: string | null;
  topics: Array<{
    topic_id: string;
    position: number;
    threshold: number;
    elements: Array<{
      element_id: string;
      threshold: number;
    }>;
  }>;
}) {
  return request<LearningTrajectory>("/learning-trajectories/", {
    method: "POST",
    body: payload,
  });
}

export function updateLearningTrajectoryTopicOrder(
  trajectoryId: string,
  topicIds: string[],
) {
  return request<LearningTrajectory>(`/learning-trajectories/${trajectoryId}/topics/order`, {
    method: "PUT",
    body: { topic_ids: topicIds },
  });
}

export function updateLearningTrajectoryStatus(
  trajectoryId: string,
  status: LearningTrajectory["status"],
) {
  return request<LearningTrajectory>(`/learning-trajectories/${trajectoryId}/status`, {
    method: "PUT",
    body: { status },
  });
}

export function fetchLearningTrajectoryTasks(
  trajectoryId: string,
  signal?: AbortSignal,
) {
  return request<LearningTrajectoryTask[]>(`/learning-trajectory-tasks/trajectories/${trajectoryId}`, {
    signal,
  });
}

export function createLearningTrajectoryTask(
  trajectoryId: string,
  payload: {
    topic_id: string;
    primary_element_id: string;
    related_element_ids: string[];
    checked_relation_ids: string[];
    title: string;
    prompt: string;
    difficulty: number;
    task_type: LearningTrajectoryTaskType;
    template_kind: LearningTrajectoryTaskTemplateKind;
    content: LearningTrajectoryTaskContent;
  },
) {
  return request<LearningTrajectoryTask>(`/learning-trajectory-tasks/trajectories/${trajectoryId}`, {
    method: "POST",
    body: payload,
  });
}

export function updateLearningTrajectoryTask(
  taskId: string,
  payload: {
    topic_id: string;
    primary_element_id: string;
    related_element_ids: string[];
    checked_relation_ids: string[];
    title: string;
    prompt: string;
    difficulty: number;
    task_type: LearningTrajectoryTaskType;
    template_kind: LearningTrajectoryTaskTemplateKind;
    content: LearningTrajectoryTaskContent;
  },
) {
  return request<LearningTrajectoryTask>(`/learning-trajectory-tasks/${taskId}`, {
    method: "PUT",
    body: payload,
  });
}

export function deleteLearningTrajectoryTask(taskId: string) {
  return request<void>(`/learning-trajectory-tasks/${taskId}`, {
    method: "DELETE",
  });
}

export function fetchStudentTasks(
  studentId: string,
  signal?: AbortSignal,
  disciplineId?: string,
  trajectoryId?: string,
  topicId?: string,
) {
  const query = new URLSearchParams();
  if (disciplineId) query.set("discipline_id", disciplineId);
  if (trajectoryId) query.set("trajectory_id", trajectoryId);
  if (topicId) query.set("topic_id", topicId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<StudentAssignedTask[]>(`/learning-trajectory-tasks/students/${studentId}${suffix}`, {
    signal,
  });
}

export function fetchRecommendedStudentTask(
  studentId: string,
  signal?: AbortSignal,
  disciplineId?: string,
  trajectoryId?: string,
  topicId?: string,
) {
  const query = new URLSearchParams();
  if (disciplineId) query.set("discipline_id", disciplineId);
  if (trajectoryId) query.set("trajectory_id", trajectoryId);
  if (topicId) query.set("topic_id", topicId);
  const suffix = query.toString() ? `?${query.toString()}` : "";
  return request<StudentAssignedTask | null>(
    `/learning-trajectory-tasks/students/${studentId}/next${suffix}`,
    { signal },
  );
}

export function fetchStudentTopicControl(
  studentId: string,
  trajectoryId: string,
  topicId: string,
  signal?: AbortSignal,
) {
  return request<StudentTopicControl>(
    `/students/${studentId}/trajectories/${trajectoryId}/control/${topicId}`,
    { signal },
  );
}

export function fetchStudentTopicControlByPosition(
  studentId: string,
  trajectoryId: string,
  topicPosition: number,
  signal?: AbortSignal,
) {
  return request<StudentTopicControl>(
    `/students/${studentId}/trajectories/${trajectoryId}/control/steps/${topicPosition}`,
    { signal },
  );
}

export function fetchStudentTrajectoryMastery(
  studentId: string,
  trajectoryId: string,
  signal?: AbortSignal,
) {
  return request<StudentTrajectoryMastery>(
    `/students/${studentId}/trajectories/${trajectoryId}/mastery`,
    { signal },
  );
}

export function submitStudentTaskScore(
  taskId: string,
  studentId: string,
  answerPayload: Record<string, unknown>,
  taskInstanceId?: string | null,
  durationSeconds?: number | null,
) {
  return request<StudentAssignedTask>(`/learning-trajectory-tasks/${taskId}/students/${studentId}/progress`, {
    method: "PUT",
    body: {
      answer_payload: answerPayload,
      task_instance_id: taskInstanceId ?? null,
      duration_seconds: durationSeconds ?? null,
    },
  });
}
