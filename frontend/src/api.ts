import type {
  CompetenceType,
  Discipline,
  DisciplineKnowledgeGraph,
  Group,
  KnowledgeElement,
  KnowledgeElementRelation,
  KnowledgeElementRelationType,
  Student,
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
  const response = await fetch(`${API_BASE}${path}`, {
    method,
    cache: "no-store",
    headers: {
      Accept: "application/json",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });

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

export function fetchStudents(signal?: AbortSignal) {
  return request<Student[]>("/students/", { signal });
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
