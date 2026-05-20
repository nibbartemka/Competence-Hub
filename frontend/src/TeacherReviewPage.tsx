import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import {
  downloadStudentTaskSubmissionFile,
  fetchDisciplines,
  fetchGroups,
  fetchLearningTrajectories,
  fetchStudentsByGroup,
  fetchSubgroups,
  fetchTeacher,
  isAbortError,
  reviewStudentTaskSubmission,
  fetchStudentTasks,
} from "./api";
import { disciplinePathValue } from "./disciplineRouting";
import { actionHoverMotion, revealMotion } from "./motionPresets";
import { useNotifications } from "./notifications";
import { getSessionHomePath, readSession, sessionMatches } from "./session";
import type {
  Discipline,
  Group,
  LearningTrajectorySummary,
  Student,
  StudentAssignedTask,
  Subgroup,
  Teacher,
} from "./types";

const MotionLink = motion(Link);

type ReviewViewMode = "topic-students" | "student-topics";
type ReviewStatusFilter = "pending_review" | "submitted" | "completed" | "all";
type ReviewDraft = {
  score: number;
  reviewComment: string;
};

type ReviewRecord = {
  key: string;
  student: Student;
  trajectory: LearningTrajectorySummary;
  discipline: Discipline | null;
  group: Group | null;
  subgroup: Subgroup | null;
  task: StudentAssignedTask;
};

type TopicGroup = {
  topicId: string;
  topicName: string;
  entries: ReviewRecord[];
  studentGroups: Array<{
    studentId: string;
    studentName: string;
    studentLogin: string;
    entries: ReviewRecord[];
  }>;
};

type StudentGroup = {
  studentId: string;
  studentName: string;
  studentLogin: string;
  entries: ReviewRecord[];
  topicGroups: Array<{
    topicId: string;
    topicName: string;
    entries: ReviewRecord[];
  }>;
};

type ReviewQueueItem = {
  key: string;
  title: string;
  subtitle: string;
  meta: string;
  records: ReviewRecord[];
};

type ReviewQueueSection = {
  key: string;
  title: string;
  eyebrow: string;
  stats: string;
  items: ReviewQueueItem[];
};

const TASK_TYPE_LABELS: Record<StudentAssignedTask["task_type"], string> = {
  single_choice: "Один выбор",
  multiple_choice: "Несколько выборов",
  matching: "Сопоставление",
  ordering: "Порядок",
  text: "Текст / файл",
};

const VIEW_MODE_LABELS: Record<ReviewViewMode, string> = {
  "topic-students": "Тема -> студенты",
  "student-topics": "Студенты -> темы",
};

const STATUS_FILTER_LABELS: Record<ReviewStatusFilter, string> = {
  pending_review: "Ждут проверки",
  submitted: "Есть отправка",
  completed: "Проверено",
  all: "Все",
};

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }
  return "Не удалось загрузить экран проверки.";
}

function isManualMasterTask(task: StudentAssignedTask) {
  return (
    task.task_type === "text" &&
    task.content.manual_review === true &&
    task.content.submission_kind === "file"
  );
}

function extractSubmittedFileMeta(task: StudentAssignedTask) {
  const payload = task.progress.last_answer_payload;
  if (!payload || payload.submission_kind !== "file") {
    return null;
  }
  return {
    originalName: String(payload.original_name ?? ""),
    uploadedAt: String(payload.uploaded_at ?? ""),
    sizeBytes: Number(payload.size_bytes ?? 0),
  };
}

function studentTaskProgressLabel(status: StudentAssignedTask["progress"]["status"]) {
  if (status === "not_started") return "Не начато";
  if (status === "in_progress") return "В работе";
  if (status === "pending_review") return "Ждет проверки";
  return "Проверено";
}

function matchesTrajectoryStudent(trajectory: LearningTrajectorySummary, student: Student) {
  if (trajectory.group_id && trajectory.group_id !== student.group_id) {
    return false;
  }
  if (trajectory.subgroup_id && trajectory.subgroup_id !== student.subgroup_id) {
    return false;
  }
  return true;
}

function formatDateTime(value: string) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return new Intl.DateTimeFormat("ru-RU", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function formatBytes(bytes: number) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} Б`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} КБ`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function countPending(entries: ReviewRecord[]) {
  return entries.filter((entry) => entry.task.progress.status === "pending_review").length;
}

function countSubmitted(entries: ReviewRecord[]) {
  return entries.filter((entry) => Boolean(extractSubmittedFileMeta(entry.task))).length;
}

function sortReviewRecords(entries: ReviewRecord[]) {
  return [...entries].sort((left, right) => {
    const pendingDelta =
      Number(right.task.progress.status === "pending_review") -
      Number(left.task.progress.status === "pending_review");
    if (pendingDelta !== 0) {
      return pendingDelta;
    }

    const trajectoryDelta = left.trajectory.name.localeCompare(right.trajectory.name, "ru");
    if (trajectoryDelta !== 0) {
      return trajectoryDelta;
    }

    return left.task.title.localeCompare(right.task.title, "ru");
  });
}

function summarizeNames(values: string[], limit = 2) {
  const uniqueValues = Array.from(new Set(values.filter(Boolean)));
  if (!uniqueValues.length) {
    return "";
  }
  if (uniqueValues.length <= limit) {
    return uniqueValues.join(", ");
  }
  return `${uniqueValues.slice(0, limit).join(", ")} +${uniqueValues.length - limit}`;
}

function buildRecordSearchText(record: ReviewRecord) {
  return [
    record.student.name,
    record.student.login,
    record.task.title,
    record.task.prompt,
    record.task.topic_name,
    record.trajectory.name,
    record.group?.name ?? "",
    record.discipline?.name ?? "",
  ]
    .join(" ")
    .toLocaleLowerCase("ru");
}

function subgroupLabel(subgroup: Subgroup | null) {
  return subgroup ? `Подгруппа ${subgroup.subgroup_num}` : "Без подгруппы";
}

export default function TeacherReviewPage() {
  const { teacherId } = useParams<{ teacherId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { pushNotification } = useNotifications();

  const [teacher, setTeacher] = useState<Teacher | null>(null);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [activeTrajectories, setActiveTrajectories] = useState<LearningTrajectorySummary[]>([]);
  const [reviewRecords, setReviewRecords] = useState<ReviewRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [viewMode, setViewMode] = useState<ReviewViewMode>(
    searchParams.get("view") === "student-topics" ? "student-topics" : "topic-students",
  );
  const [selectedDisciplineId, setSelectedDisciplineId] = useState(
    searchParams.get("discipline") ?? "",
  );
  const [selectedTrajectoryId, setSelectedTrajectoryId] = useState(
    searchParams.get("trajectory") ?? "all",
  );
  const [statusFilter, setStatusFilter] = useState<ReviewStatusFilter>(
    searchParams.get("status") === "submitted" ||
      searchParams.get("status") === "completed" ||
      searchParams.get("status") === "all"
      ? (searchParams.get("status") as ReviewStatusFilter)
      : "pending_review",
  );
  const [searchValue, setSearchValue] = useState(searchParams.get("q") ?? "");
  const [reviewDrafts, setReviewDrafts] = useState<Record<string, ReviewDraft>>({});
  const [savingRecordKey, setSavingRecordKey] = useState("");

  useEffect(() => {
    const activeSession = readSession();
    if (!sessionMatches(activeSession, "teacher", teacherId)) {
      navigate(getSessionHomePath(activeSession), { replace: true });
    }
  }, [navigate, teacherId]);

  useEffect(() => {
    if (!teacherId) {
      return;
    }

    const currentTeacherId = teacherId;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");

        const [nextTeacher, nextDisciplines, nextGroups] = await Promise.all([
          fetchTeacher(currentTeacherId, controller.signal),
          fetchDisciplines(controller.signal),
          fetchGroups(controller.signal),
        ]);

        const [nextStudents, nextSubgroups, nextTrajectories] = await Promise.all([
          Promise.all(
            nextTeacher.group_ids.map((groupId) =>
              fetchStudentsByGroup(groupId, controller.signal),
            ),
          ).then((items) => items.flat()),
          Promise.all(
            nextTeacher.group_ids.map((groupId) => fetchSubgroups(groupId, controller.signal)),
          ).then((items) => items.flat()),
          fetchLearningTrajectories(
            { teacher_id: nextTeacher.id, status_filter: "active" },
            controller.signal,
          ),
        ]);

        const reviewPairs = nextTrajectories.flatMap((trajectory) =>
          nextStudents
            .filter((student) => matchesTrajectoryStudent(trajectory, student))
            .map((student) => ({ student, trajectory })),
        );

        const settled = await Promise.allSettled(
          reviewPairs.map(async ({ student, trajectory }) => {
            const tasks = await fetchStudentTasks(
              student.id,
              controller.signal,
              undefined,
              trajectory.id,
            );
            return { student, trajectory, tasks };
          }),
        );

        if (controller.signal.aborted) {
          return;
        }

        const groupById = new Map(nextGroups.map((group) => [group.id, group]));
        const subgroupById = new Map(nextSubgroups.map((subgroup) => [subgroup.id, subgroup]));
        const disciplineById = new Map(nextDisciplines.map((discipline) => [discipline.id, discipline]));

        const nextReviewRecords: ReviewRecord[] = [];
        let failedRequests = 0;

        for (const result of settled) {
          if (result.status !== "fulfilled") {
            if (!isAbortError(result.reason)) {
              failedRequests += 1;
            }
            continue;
          }

          const { student, trajectory, tasks } = result.value;
          for (const task of tasks) {
            if (!isManualMasterTask(task)) {
              continue;
            }
            nextReviewRecords.push({
              key: `${student.id}:${task.id}`,
              student,
              trajectory,
              discipline: disciplineById.get(trajectory.discipline_id) ?? null,
              group: groupById.get(student.group_id) ?? null,
              subgroup: student.subgroup_id ? subgroupById.get(student.subgroup_id) ?? null : null,
              task,
            });
          }
        }

        setTeacher(nextTeacher);
        setDisciplines(nextDisciplines);
        setGroups(nextGroups);
        setSubgroups(nextSubgroups);
        setActiveTrajectories(nextTrajectories);
        setReviewRecords(nextReviewRecords);
        setSelectedDisciplineId((current) => {
          if (current && nextTrajectories.some((trajectory) => trajectory.discipline_id === current)) {
            return current;
          }
          return searchParams.get("discipline") ?? nextTrajectories[0]?.discipline_id ?? "";
        });
        setSelectedTrajectoryId((current) => {
          if (current === "all") {
            return "all";
          }
          if (current && nextTrajectories.some((trajectory) => trajectory.id === current)) {
            return current;
          }
          return searchParams.get("trajectory") ?? "all";
        });

        if (failedRequests) {
          pushNotification(
            "error",
            `Не все карточки проверки загрузились: ${failedRequests} запросов завершились ошибкой.`,
          );
        }
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
  }, [pushNotification, searchParams, teacherId]);

  const availableDisciplines = useMemo(() => {
    const usedDisciplineIds = new Set(activeTrajectories.map((trajectory) => trajectory.discipline_id));
    return disciplines.filter((discipline) => usedDisciplineIds.has(discipline.id));
  }, [activeTrajectories, disciplines]);

  const availableTrajectories = useMemo(() => {
    if (!selectedDisciplineId) {
      return activeTrajectories;
    }
    return activeTrajectories.filter(
      (trajectory) => trajectory.discipline_id === selectedDisciplineId,
    );
  }, [activeTrajectories, selectedDisciplineId]);

  useEffect(() => {
    if (
      selectedTrajectoryId !== "all" &&
      !availableTrajectories.some((trajectory) => trajectory.id === selectedTrajectoryId)
    ) {
      setSelectedTrajectoryId("all");
    }
  }, [availableTrajectories, selectedTrajectoryId]);

  const filteredRecords = useMemo(() => {
    const normalizedSearch = searchValue.trim().toLocaleLowerCase("ru");

    return reviewRecords
      .filter((record) => {
        if (selectedDisciplineId && record.trajectory.discipline_id !== selectedDisciplineId) {
          return false;
        }
        if (selectedTrajectoryId !== "all" && record.trajectory.id !== selectedTrajectoryId) {
          return false;
        }

        const hasSubmission = Boolean(extractSubmittedFileMeta(record.task));
        if (statusFilter === "pending_review" && record.task.progress.status !== "pending_review") {
          return false;
        }
        if (statusFilter === "submitted" && !hasSubmission) {
          return false;
        }
        if (statusFilter === "completed" && record.task.progress.status !== "completed") {
          return false;
        }

        if (!normalizedSearch) {
          return true;
        }

        return buildRecordSearchText(record).includes(normalizedSearch);
      })
      .sort((left, right) => {
        const pendingDelta =
          Number(right.task.progress.status === "pending_review") -
          Number(left.task.progress.status === "pending_review");
        if (pendingDelta !== 0) {
          return pendingDelta;
        }

        const topicDelta = left.task.topic_name.localeCompare(right.task.topic_name, "ru");
        if (topicDelta !== 0) {
          return topicDelta;
        }

        return left.student.name.localeCompare(right.student.name, "ru");
      });
  }, [reviewRecords, searchValue, selectedDisciplineId, selectedTrajectoryId, statusFilter]);

  const totalPendingCount = useMemo(
    () => reviewRecords.filter((record) => record.task.progress.status === "pending_review").length,
    [reviewRecords],
  );

  const totalSubmittedCount = useMemo(
    () => reviewRecords.filter((record) => Boolean(extractSubmittedFileMeta(record.task))).length,
    [reviewRecords],
  );

  const totalCompletedCount = useMemo(
    () => reviewRecords.filter((record) => record.task.progress.status === "completed").length,
    [reviewRecords],
  );

  const activeStudentsCount = useMemo(
    () => new Set(reviewRecords.map((record) => record.student.id)).size,
    [reviewRecords],
  );

  const topicGroups = useMemo<TopicGroup[]>(() => {
    const byTopic = new Map<string, ReviewRecord[]>();

    for (const record of filteredRecords) {
      const key = record.task.topic_id;
      byTopic.set(key, [...(byTopic.get(key) ?? []), record]);
    }

    return Array.from(byTopic.entries())
      .map(([topicId, entries]) => {
        const byStudent = new Map<string, ReviewRecord[]>();
        for (const entry of entries) {
          byStudent.set(entry.student.id, [...(byStudent.get(entry.student.id) ?? []), entry]);
        }

        const studentGroups = Array.from(byStudent.entries())
          .map(([studentId, studentEntries]) => ({
            studentId,
            studentName: studentEntries[0]?.student.name ?? "Студент",
            studentLogin: studentEntries[0]?.student.login ?? "",
            entries: sortReviewRecords(studentEntries),
          }))
          .sort((left, right) => {
            const pendingDelta = countPending(right.entries) - countPending(left.entries);
            if (pendingDelta !== 0) {
              return pendingDelta;
            }
            return left.studentName.localeCompare(right.studentName, "ru");
          });

        return {
          topicId,
          topicName: entries[0]?.task.topic_name ?? "Тема",
          entries,
          studentGroups,
        };
      })
      .sort((left, right) => {
        const pendingDelta = countPending(right.entries) - countPending(left.entries);
        if (pendingDelta !== 0) {
          return pendingDelta;
        }
        return left.topicName.localeCompare(right.topicName, "ru");
      });
  }, [filteredRecords]);

  const studentGroups = useMemo<StudentGroup[]>(() => {
    const byStudent = new Map<string, ReviewRecord[]>();

    for (const record of filteredRecords) {
      byStudent.set(record.student.id, [...(byStudent.get(record.student.id) ?? []), record]);
    }

    return Array.from(byStudent.entries())
      .map(([studentId, entries]) => {
        const byTopic = new Map<string, ReviewRecord[]>();
        for (const entry of entries) {
          byTopic.set(entry.task.topic_id, [...(byTopic.get(entry.task.topic_id) ?? []), entry]);
        }

        const nextTopicGroups = Array.from(byTopic.entries())
          .map(([topicId, topicEntries]) => ({
            topicId,
            topicName: topicEntries[0]?.task.topic_name ?? "Тема",
            entries: sortReviewRecords(topicEntries),
          }))
          .sort((left, right) => {
            const pendingDelta = countPending(right.entries) - countPending(left.entries);
            if (pendingDelta !== 0) {
              return pendingDelta;
            }
            return left.topicName.localeCompare(right.topicName, "ru");
          });

        return {
          studentId,
          studentName: entries[0]?.student.name ?? "Студент",
          studentLogin: entries[0]?.student.login ?? "",
          entries,
          topicGroups: nextTopicGroups,
        };
      })
      .sort((left, right) => {
        const pendingDelta = countPending(right.entries) - countPending(left.entries);
        if (pendingDelta !== 0) {
          return pendingDelta;
        }
        return left.studentName.localeCompare(right.studentName, "ru");
      });
  }, [filteredRecords]);

  const reviewSections = useMemo<ReviewQueueSection[]>(() => {
    if (viewMode === "topic-students") {
      return topicGroups.map((group) => ({
        key: `topic:${group.topicId}`,
        title: group.topicName,
        eyebrow: "Тема",
        stats: `Студентов: ${group.studentGroups.length} · Ждут проверки: ${countPending(group.entries)}`,
        items: group.studentGroups.map((studentGroup) => ({
          key: `${group.topicId}:${studentGroup.studentId}`,
          title: studentGroup.studentName,
          subtitle: studentGroup.studentLogin,
          meta: `Заданий: ${studentGroup.entries.length} · Ждут проверки: ${countPending(studentGroup.entries)}`,
          records: studentGroup.entries,
        })),
      }));
    }

    return studentGroups.map((group) => ({
      key: `student:${group.studentId}`,
      title: group.studentName,
      eyebrow: "Студент",
      stats: `Тем: ${group.topicGroups.length} · Ждут проверки: ${countPending(group.entries)}`,
      items: group.topicGroups.map((topicGroup) => ({
        key: `${group.studentId}:${topicGroup.topicId}`,
        title: topicGroup.topicName,
        subtitle: summarizeNames(topicGroup.entries.map((entry) => entry.trajectory.name)),
        meta: `Заданий: ${topicGroup.entries.length} · Ждут проверки: ${countPending(topicGroup.entries)}`,
        records: topicGroup.entries,
      })),
    }));
  }, [studentGroups, topicGroups, viewMode]);

  const queueItems = useMemo(
    () => reviewSections.flatMap((section) => section.items),
    [reviewSections],
  );

  const [selectedQueueKey, setSelectedQueueKey] = useState("");
  const [selectedRecordIndex, setSelectedRecordIndex] = useState(0);

  useEffect(() => {
    if (!queueItems.length) {
      if (selectedQueueKey) {
        setSelectedQueueKey("");
      }
      if (selectedRecordIndex !== 0) {
        setSelectedRecordIndex(0);
      }
      return;
    }

    if (!queueItems.some((item) => item.key === selectedQueueKey)) {
      setSelectedQueueKey(queueItems[0].key);
      setSelectedRecordIndex(0);
    }
  }, [queueItems, selectedQueueKey, selectedRecordIndex]);

  const selectedQueueIndex = queueItems.findIndex((item) => item.key === selectedQueueKey);
  const selectedQueueItem =
    selectedQueueIndex >= 0 ? queueItems[selectedQueueIndex] : queueItems[0] ?? null;
  const selectedRecord = selectedQueueItem?.records[selectedRecordIndex] ?? null;

  useEffect(() => {
    if (!selectedQueueItem) {
      return;
    }

    if (selectedRecordIndex > selectedQueueItem.records.length - 1) {
      setSelectedRecordIndex(0);
    }
  }, [selectedQueueItem, selectedRecordIndex]);

  function updateReviewDraft(recordKey: string, task: StudentAssignedTask, patch: Partial<ReviewDraft>) {
    setReviewDrafts((current) => ({
      ...current,
      [recordKey]: {
        score: typeof current[recordKey]?.score === "number"
          ? current[recordKey].score
          : task.progress.last_score ?? 60,
        reviewComment:
          typeof current[recordKey]?.reviewComment === "string"
            ? current[recordKey].reviewComment
            : String(task.progress.last_feedback?.review_comment ?? ""),
        ...patch,
      },
    }));
  }

  async function handleDownload(record: ReviewRecord) {
    try {
      const { blob, fileName } = await downloadStudentTaskSubmissionFile(
        record.task.id,
        record.student.id,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = fileName;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      pushNotification("error", extractErrorMessage(downloadError));
    }
  }

  async function handleSaveReview(record: ReviewRecord) {
    const draft = reviewDrafts[record.key] ?? {
      score: record.task.progress.last_score ?? 60,
      reviewComment: String(record.task.progress.last_feedback?.review_comment ?? ""),
    };

    try {
      setSavingRecordKey(record.key);
      const updatedTask = await reviewStudentTaskSubmission(record.task.id, record.student.id, {
        score: draft.score,
        review_comment: draft.reviewComment,
      });
      setReviewRecords((current) =>
        current.map((item) =>
          item.key === record.key
            ? {
                ...item,
                task: updatedTask,
              }
            : item,
        ),
      );
      pushNotification("success", "Оценка сохранена.");
    } catch (saveError) {
      pushNotification("error", extractErrorMessage(saveError));
    } finally {
      setSavingRecordKey("");
    }
  }

  function renderReviewChecklist(task: StudentAssignedTask) {
    const reviewContext = task.content.manual_review_context;
    if (!reviewContext) {
      return null;
    }

    return (
      <div className="teacher-review-checklist">
        <div className="teacher-review-checklist__section">
          <span className="card__eyebrow">Предметная область</span>
          <p>{reviewContext.subject_area_description || "Не заполнена."}</p>
        </div>
        <div className="teacher-review-checklist__section">
          <span className="card__eyebrow">Элементы «Уметь»</span>
          {(reviewContext.skill_elements ?? []).length ? (
            (reviewContext.skill_elements ?? []).map((item) => (
              <div className="teacher-review-checklist__item" key={item.element_id}>
                <strong>{item.name}</strong>
                <span>{item.description || "Описание не добавлено."}</span>
              </div>
            ))
          ) : (
            <p>Не найдены.</p>
          )}
        </div>
        <div className="teacher-review-checklist__section">
          <span className="card__eyebrow">Связанные элементы «Знать»</span>
          {(reviewContext.knowledge_elements ?? []).length ? (
            (reviewContext.knowledge_elements ?? []).map((item) => (
              <div className="teacher-review-checklist__item" key={item.element_id}>
                <strong>{item.name}</strong>
                <span>{item.description || "Описание не добавлено."}</span>
              </div>
            ))
          ) : (
            <p>Не найдены.</p>
          )}
        </div>
        <div className="teacher-review-checklist__section">
          <span className="card__eyebrow">Сопоставления объект -&gt; «Знать»</span>
          {(reviewContext.domain_object_mappings ?? []).length ? (
            (reviewContext.domain_object_mappings ?? []).map((item, index) => (
              <div className="teacher-review-checklist__item" key={`${item.object_name}-${index}`}>
                <strong>{item.object_name}</strong>
                <span>
                  {item.knowledge_element_name}
                  {item.knowledge_element_description
                    ? ` — ${item.knowledge_element_description}`
                    : ""}
                </span>
              </div>
            ))
          ) : (
            <p>Не найдены.</p>
          )}
        </div>
      </div>
    );
  }

  function renderTaskCard(record: ReviewRecord) {
    const submittedFile = extractSubmittedFileMeta(record.task);
    const draft = reviewDrafts[record.key] ?? {
      score: record.task.progress.last_score ?? 60,
      reviewComment: String(record.task.progress.last_feedback?.review_comment ?? ""),
    };
    const disciplinePath = disciplinePathValue(record.discipline, record.trajectory.discipline_id);

    return (
      <article className="student-task-card teacher-review-task-card" key={record.key}>
        <div className="student-task-card__header">
          <div>
            <strong>{record.task.title || record.task.topic_name}</strong>
            <span>
              {record.trajectory.name} · {TASK_TYPE_LABELS[record.task.task_type]}
            </span>
          </div>
          <span className="hero__chip">{studentTaskProgressLabel(record.task.progress.status)}</span>
        </div>

        <p>{record.task.prompt}</p>

        <div className="student-task-card__progress">
          <span>Студент: {record.student.name}</span>
          <span>Логин: {record.student.login}</span>
          <span>Группа: {record.group?.name ?? "Не указана"}</span>
          <span>{subgroupLabel(record.subgroup)}</span>
          <span>Тема: {record.task.topic_name}</span>
          <span>Попыток: {record.task.progress.attempts_count}</span>
          <span>Последний балл: {record.task.progress.last_score ?? "еще нет"}</span>
        </div>

        <div className="teacher-review-card">
          <div className="teacher-review-card__header">
            <strong>Ручная проверка преподавателем</strong>
            {submittedFile ? (
              <span className="hero__chip">
                {formatDateTime(submittedFile.uploadedAt) || "Файл загружен"}
              </span>
            ) : null}
          </div>

          {submittedFile?.originalName ? (
            <div className="teacher-review-card__actions">
              <button
                className="secondary-button"
                onClick={() => void handleDownload(record)}
                type="button"
              >
                Скачать файл
              </button>
              <span className="card__text">
                {submittedFile.originalName}
                {submittedFile.sizeBytes ? ` · ${formatBytes(submittedFile.sizeBytes)}` : ""}
              </span>
            </div>
          ) : (
            <p className="card__text">Студент еще не загрузил файл по этому заданию.</p>
          )}

          {renderReviewChecklist(record.task)}

          <div className="teacher-review-form">
            <label className="field">
              <span>Оценка</span>
              <input
                max={100}
                min={0}
                onChange={(event) =>
                  updateReviewDraft(record.key, record.task, {
                    score: Math.max(0, Math.min(100, Number(event.target.value) || 0)),
                  })
                }
                type="number"
                value={draft.score}
              />
            </label>
            <label className="field">
              <span>Комментарий преподавателя</span>
              <textarea
                onChange={(event) =>
                  updateReviewDraft(record.key, record.task, {
                    reviewComment: event.target.value,
                  })
                }
                placeholder="Кратко зафиксируйте сильные стороны, ошибки и что нужно доработать."
                rows={4}
                value={draft.reviewComment}
              />
            </label>
          </div>

          {record.task.progress.last_feedback?.review_comment ? (
            <div className="student-task-card__feedback">
              {String(record.task.progress.last_feedback.review_comment)}
            </div>
          ) : null}

          <div className="teacher-review-card__actions">
            <MotionLink
              className="ghost-button"
              to={`/disciplines/${disciplinePath}/trajectories/${record.trajectory.id}?student=${record.student.id}&review=master`}
              {...actionHoverMotion}
            >
              Открыть траекторию
            </MotionLink>
            <button
              className="primary-button"
              disabled={!submittedFile || savingRecordKey === record.key}
              onClick={() => void handleSaveReview(record)}
              type="button"
            >
              {savingRecordKey === record.key ? "Сохраняю..." : "Сохранить оценку"}
            </button>
          </div>
        </div>
      </article>
    );
  }

  function selectQueueItem(itemKey: string) {
    setSelectedQueueKey(itemKey);
    setSelectedRecordIndex(0);
  }

  function showAdjacentQueueItem(direction: -1 | 1) {
    if (!queueItems.length) {
      return;
    }

    const currentIndex = selectedQueueIndex >= 0 ? selectedQueueIndex : 0;
    const nextIndex = currentIndex + direction;
    if (nextIndex < 0 || nextIndex >= queueItems.length) {
      return;
    }

    setSelectedQueueKey(queueItems[nextIndex].key);
    setSelectedRecordIndex(0);
  }

  function showAdjacentRecord(direction: -1 | 1) {
    if (!selectedQueueItem) {
      return;
    }

    const nextIndex = selectedRecordIndex + direction;
    if (nextIndex < 0 || nextIndex >= selectedQueueItem.records.length) {
      return;
    }

    setSelectedRecordIndex(nextIndex);
  }

  function renderTaskDetail(record: ReviewRecord) {
    return renderTaskCard(record);
  }

  function renderQueueSection(section: ReviewQueueSection) {
    return (
      <section className="teacher-review-queue-section" key={section.key}>
        <div className="teacher-review-queue-section__header">
          <div>
            <span className="card__eyebrow">{section.eyebrow}</span>
            <strong>{section.title}</strong>
          </div>
          <span>{section.stats}</span>
        </div>

        <div className="teacher-review-queue-list">
          {section.items.map((item) => {
            const isActive = item.key === selectedQueueItem?.key;
            return (
              <button
                className={isActive ? "teacher-review-queue-item teacher-review-queue-item--active" : "teacher-review-queue-item"}
                key={item.key}
                onClick={() => selectQueueItem(item.key)}
                type="button"
              >
                <div className="teacher-review-queue-item__copy">
                  <strong>{item.title}</strong>
                  <span>{item.subtitle}</span>
                </div>
                <div className="teacher-review-queue-item__meta">
                  <span>{item.meta}</span>
                  <span className="teacher-review-queue-item__action">Проверить</span>
                </div>
              </button>
            );
          })}
        </div>
      </section>
    );
  }

  if (!teacherId) {
    return null;
  }

  return (
    <div className="page-shell role-page immersive-page immersive-page--teacher">
      <motion.header className="hero immersive-page__hero role-dashboard-hero" {...revealMotion(0.02)}>
        <div>
          <p className="hero__eyebrow">Проверка работ</p>
          <h1>{teacher?.name ?? "Преподаватель"}</h1>
          <p className="hero__subtitle">
            Отдельный экран ручной проверки заданий уровня «Владеть» с двумя режимами
            просмотра: по темам и по студентам.
          </p>
        </div>
        <div className="hero__controls">
          <button className="ghost-button" onClick={() => navigate(`/teachers/${teacherId}`)} type="button">
            В кабинет
          </button>
        </div>
      </motion.header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view immersive-page__status">
          <div className="status-view__pulse" />
          <h3>Загружаю работы на проверку</h3>
        </section>
      ) : (
        <main className="role-dashboard teacher-review-page">
          <section className="role-dashboard-metrics">
            <article className="student-metric-card">
              <span>Ручных заданий</span>
              <strong>{reviewRecords.length}</strong>
            </article>
            <article className="student-metric-card">
              <span>Ждут проверки</span>
              <strong>{totalPendingCount}</strong>
            </article>
            <article className="student-metric-card">
              <span>С отправкой</span>
              <strong>{totalSubmittedCount}</strong>
            </article>
            <article className="student-metric-card">
              <span>Студентов</span>
              <strong>{activeStudentsCount}</strong>
            </article>
          </section>

          <motion.section className="card card--soft role-dashboard-section teacher-review-toolbar" {...revealMotion(0.05)}>
            <div className="card__header">
              <div>
                <p className="card__eyebrow">Фильтры</p>
                <h2>Режим просмотра и срез данных</h2>
              </div>
              <div className="teacher-review-toggle">
                {(Object.keys(VIEW_MODE_LABELS) as ReviewViewMode[]).map((mode) => (
                  <button
                    className={mode === viewMode ? "primary-button" : "ghost-button"}
                    key={mode}
                    onClick={() => setViewMode(mode)}
                    type="button"
                  >
                    {VIEW_MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            <div className="teacher-review-filters">
              <label className="field">
                <span>Дисциплина</span>
                <select
                  onChange={(event) => setSelectedDisciplineId(event.target.value)}
                  value={selectedDisciplineId}
                >
                  <option value="">Все дисциплины</option>
                  {availableDisciplines.map((discipline) => (
                    <option key={discipline.id} value={discipline.id}>
                      {discipline.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Траектория</span>
                <select
                  onChange={(event) => setSelectedTrajectoryId(event.target.value)}
                  value={selectedTrajectoryId}
                >
                  <option value="all">Все активные</option>
                  {availableTrajectories.map((trajectory) => (
                    <option key={trajectory.id} value={trajectory.id}>
                      {trajectory.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Статус</span>
                <select
                  onChange={(event) => setStatusFilter(event.target.value as ReviewStatusFilter)}
                  value={statusFilter}
                >
                  {(Object.keys(STATUS_FILTER_LABELS) as ReviewStatusFilter[]).map((status) => (
                    <option key={status} value={status}>
                      {STATUS_FILTER_LABELS[status]}
                    </option>
                  ))}
                </select>
              </label>
              <label className="field">
                <span>Поиск</span>
                <input
                  onChange={(event) => setSearchValue(event.target.value)}
                  placeholder="Студент, тема, траектория, задание"
                  type="search"
                  value={searchValue}
                />
              </label>
            </div>

            <div className="overview-stats">
              <span>В выборке: {filteredRecords.length}</span>
              <span>Ждут проверки: {countPending(filteredRecords)}</span>
              <span>С отправкой: {countSubmitted(filteredRecords)}</span>
              <span>Проверено всего: {totalCompletedCount}</span>
            </div>
          </motion.section>

          {true ? (
            <section className="teacher-review-workspace">
              <aside className="card card--soft teacher-review-queue" aria-label="Очередь проверки">
                <div className="teacher-review-queue__header">
                  <div>
                    <p className="card__eyebrow">Очередь</p>
                    <h2>{viewMode === "topic-students" ? "Темы и студенты" : "Студенты и темы"}</h2>
                  </div>
                  <span className="hero__chip">{queueItems.length}</span>
                </div>
                <div className="teacher-review-queue__body">
                  {reviewSections.map((section) => renderQueueSection(section))}
                </div>
              </aside>

              <section className="card card--soft teacher-review-detail">
                {selectedQueueItem && selectedRecord ? (
                  <>
                    <div className="teacher-review-detail__header">
                      <div>
                        <p className="card__eyebrow">Выбрано</p>
                        <h2>{selectedQueueItem.title}</h2>
                        <p className="card__text">{selectedQueueItem.subtitle}</p>
                      </div>
                      <div className="teacher-review-detail__nav">
                        <button
                          className="ghost-button"
                          disabled={selectedQueueIndex <= 0}
                          onClick={() => showAdjacentQueueItem(-1)}
                          type="button"
                        >
                          Предыдущий
                        </button>
                        <button
                          className="ghost-button"
                          disabled={selectedQueueIndex < 0 || selectedQueueIndex >= queueItems.length - 1}
                          onClick={() => showAdjacentQueueItem(1)}
                          type="button"
                        >
                          Следующий
                        </button>
                      </div>
                    </div>

                    <div className="overview-stats teacher-review-detail__stats">
                      <span>{selectedQueueItem.meta}</span>
                      <span>Блок {selectedQueueIndex + 1} из {queueItems.length}</span>
                      <span>Задание {selectedRecordIndex + 1} из {selectedQueueItem.records.length}</span>
                    </div>

                    {selectedQueueItem.records.length > 1 ? (
                      <div className="teacher-review-task-switcher">
                        <button
                          className="secondary-button"
                          disabled={selectedRecordIndex === 0}
                          onClick={() => showAdjacentRecord(-1)}
                          type="button"
                        >
                          Предыдущее задание
                        </button>
                        <div className="teacher-review-task-switcher__tabs">
                          {selectedQueueItem.records.map((record, index) => (
                            <button
                              className={index === selectedRecordIndex ? "editor-tab editor-tab--active" : "editor-tab"}
                              key={record.key}
                              onClick={() => setSelectedRecordIndex(index)}
                              type="button"
                            >
                              {index + 1}
                            </button>
                          ))}
                        </div>
                        <button
                          className="secondary-button"
                          disabled={selectedRecordIndex >= selectedQueueItem.records.length - 1}
                          onClick={() => showAdjacentRecord(1)}
                          type="button"
                        >
                          Следующее задание
                        </button>
                      </div>
                    ) : null}

                    {renderTaskDetail(selectedRecord)}
                  </>
                ) : (
                  <div className="teacher-review-empty">
                    <h2>Работы не найдены</h2>
                    <p className="card__text">Измените фильтры или дождитесь новых отправок.</p>
                  </div>
                )}
              </section>
            </section>
          ) : false ? (
            <section className="teacher-review-groups">
              {topicGroups.length ? (
                topicGroups.map((group, index) => (
                  <motion.article
                    className="card card--soft teacher-review-group"
                    key={group.topicId}
                    {...revealMotion(0.06 + index * 0.02)}
                  >
                    <div className="teacher-review-group__header">
                      <div>
                        <p className="card__eyebrow">Тема</p>
                        <h2>{group.topicName}</h2>
                      </div>
                      <div className="overview-stats">
                        <span>Заданий: {group.entries.length}</span>
                        <span>Ждут проверки: {countPending(group.entries)}</span>
                        <span>Студентов: {group.studentGroups.length}</span>
                      </div>
                    </div>

                    <div className="teacher-review-subgroups">
                      {group.studentGroups.map((studentGroup) => (
                        <section className="teacher-review-subgroup" key={`${group.topicId}:${studentGroup.studentId}`}>
                          <div className="teacher-review-subgroup__header">
                            <div>
                              <strong>{studentGroup.studentName}</strong>
                              <span>{studentGroup.studentLogin}</span>
                            </div>
                            <div className="overview-stats">
                              <span>Заданий: {studentGroup.entries.length}</span>
                              <span>Ждут проверки: {countPending(studentGroup.entries)}</span>
                            </div>
                          </div>
                          <div className="student-task-list">
                            {studentGroup.entries.map((record) => renderTaskCard(record))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </motion.article>
                ))
              ) : (
                <section className="card card--soft role-dashboard-section">
                  <h2>Подходящих работ не найдено</h2>
                  <p className="card__text">
                    Измените фильтры или дождитесь отправок студентов по заданиям с ручной
                    проверкой.
                  </p>
                </section>
              )}
            </section>
          ) : (
            <section className="teacher-review-groups">
              {studentGroups.length ? (
                studentGroups.map((group, index) => (
                  <motion.article
                    className="card card--soft teacher-review-group"
                    key={group.studentId}
                    {...revealMotion(0.06 + index * 0.02)}
                  >
                    <div className="teacher-review-group__header">
                      <div>
                        <p className="card__eyebrow">Студент</p>
                        <h2>{group.studentName}</h2>
                        <span className="role-muted-note">{group.studentLogin}</span>
                      </div>
                      <div className="overview-stats">
                        <span>Заданий: {group.entries.length}</span>
                        <span>Ждут проверки: {countPending(group.entries)}</span>
                        <span>Тем: {group.topicGroups.length}</span>
                      </div>
                    </div>

                    <div className="teacher-review-subgroups">
                      {group.topicGroups.map((topicGroup) => (
                        <section className="teacher-review-subgroup" key={`${group.studentId}:${topicGroup.topicId}`}>
                          <div className="teacher-review-subgroup__header">
                            <div>
                              <strong>{topicGroup.topicName}</strong>
                              <span>{topicGroup.entries[0]?.trajectory.name ?? ""}</span>
                            </div>
                            <div className="overview-stats">
                              <span>Заданий: {topicGroup.entries.length}</span>
                              <span>Ждут проверки: {countPending(topicGroup.entries)}</span>
                            </div>
                          </div>
                          <div className="student-task-list">
                            {topicGroup.entries.map((record) => renderTaskCard(record))}
                          </div>
                        </section>
                      ))}
                    </div>
                  </motion.article>
                ))
              ) : (
                <section className="card card--soft role-dashboard-section">
                  <h2>Подходящих работ не найдено</h2>
                  <p className="card__text">
                    По текущему фильтру нет заданий для отображения. Проверьте выбранную
                    дисциплину, траекторию или статус.
                  </p>
                </section>
              )}
            </section>
          )}
        </main>
      )}
    </div>
  );
}
