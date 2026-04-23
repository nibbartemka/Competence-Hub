import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import {
  fetchDisciplineKnowledgeGraph,
  fetchGroups,
  fetchLearningTrajectories,
  fetchSubgroups,
  fetchTeachers,
  isAbortError,
} from "./api";
import type {
  DisciplineKnowledgeGraph,
  Group,
  LearningTrajectory,
  Subgroup,
  Teacher,
} from "./types";

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось загрузить страницу дисциплины.";
}

function trajectoryStatusLabel(status: LearningTrajectory["status"]) {
  if (status === "active") return "Активна";
  if (status === "archived") return "Архив";
  return "Черновик";
}

export default function DisciplineOverviewPage() {
  const { disciplineId } = useParams<{ disciplineId: string }>();
  const navigate = useNavigate();

  const [graph, setGraph] = useState<DisciplineKnowledgeGraph | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [subgroups, setSubgroups] = useState<Subgroup[]>([]);
  const [teachers, setTeachers] = useState<Teacher[]>([]);
  const [trajectories, setTrajectories] = useState<LearningTrajectory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!disciplineId) return;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const [nextGraph, nextGroups, nextTeachers, nextTrajectories] = await Promise.all([
          fetchDisciplineKnowledgeGraph(disciplineId!, controller.signal),
          fetchGroups(controller.signal),
          fetchTeachers(controller.signal),
          fetchLearningTrajectories({ discipline_id: disciplineId! }, controller.signal),
        ]);
        const nextSubgroups = (
          await Promise.all(
            nextGroups.map((group) => fetchSubgroups(group.id, controller.signal)),
          )
        ).flat();

        setGraph(nextGraph);
        setGroups(nextGroups);
        setSubgroups(nextSubgroups);
        setTeachers(nextTeachers);
        setTrajectories(nextTrajectories);
      } catch (loadError) {
        if (!isAbortError(loadError)) setError(extractErrorMessage(loadError));
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [disciplineId]);

  const groupById = useMemo(() => new Map(groups.map((group) => [group.id, group])), [groups]);
  const subgroupById = useMemo(
    () => new Map(subgroups.map((subgroup) => [subgroup.id, subgroup])),
    [subgroups],
  );
  const teacherById = useMemo(
    () => new Map(teachers.map((teacher) => [teacher.id, teacher])),
    [teachers],
  );
  const disciplineTeachers = graph
    ? graph.discipline.teacher_ids.map((teacherId) => teacherById.get(teacherId)).filter(Boolean)
    : [];
  const disciplineGroups = graph
    ? graph.discipline.group_ids.map((groupId) => groupById.get(groupId)).filter(Boolean)
    : [];

  if (!disciplineId) return null;

  return (
    <div className="page-shell discipline-overview-page">
      <header className="hero">
        <div>
          <p className="hero__eyebrow">Паспорт дисциплины</p>
          <h1>{graph?.discipline.name ?? "Дисциплина"}</h1>
          <p className="hero__subtitle">
            Преподаватели, группы, траектории и краткая статистика графа знаний.
          </p>
        </div>
        <div className="hero__controls">
          <button className="ghost-button" onClick={() => navigate("/")} type="button">
            На главную
          </button>
          <Link className="primary-button" to={`/disciplines/${disciplineId}/knowledge`}>
            Граф знаний
          </Link>
          <Link className="secondary-button" to={`/disciplines/${disciplineId}/trajectory`}>
            Траектории
          </Link>
        </div>
      </header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view">
          <div className="status-view__pulse" />
          <h3>Загружаю дисциплину</h3>
        </section>
      ) : graph ? (
        <main className="overview-grid">
          <section className="card card--soft overview-card overview-card--wide">
            <p className="card__eyebrow">Статистика графа</p>
            <div className="overview-stats">
              <span>{graph.topics.length} тем</span>
              <span>{graph.knowledge_elements.length} элементов</span>
              <span>{graph.topic_dependencies.length} связей тем</span>
              <span>{graph.knowledge_element_relations.length} связей элементов</span>
              <span>Версия {graph.discipline.knowledge_graph_version}</span>
            </div>
          </section>

          <section className="card card--soft overview-card">
            <p className="card__eyebrow">Преподаватели</p>
            {disciplineTeachers.length ? (
              disciplineTeachers.map((teacher) =>
                teacher ? (
                  <Link className="overview-row" key={teacher.id} to={`/teachers/${teacher.id}`}>
                    <strong>{teacher.name}</strong>
                    <span>{teacher.group_ids.length} групп</span>
                  </Link>
                ) : null,
              )
            ) : (
              <p className="card__text">Преподаватель пока не назначен.</p>
            )}
          </section>

          <section className="card card--soft overview-card">
            <p className="card__eyebrow">Группы</p>
            {disciplineGroups.length ? (
              disciplineGroups.map((group) =>
                group ? (
                  <article className="overview-row" key={group.id}>
                    <strong>{group.name}</strong>
                    <span>
                      Подгруппы:{" "}
                      {subgroups.filter((subgroup) => subgroup.group_id === group.id).length || "нет"}
                    </span>
                  </article>
                ) : null,
              )
            ) : (
              <p className="card__text">Группы пока не назначены.</p>
            )}
          </section>

          <section className="card card--soft overview-card overview-card--wide">
            <p className="card__eyebrow">Траектории</p>
            <div className="trajectory-saved-list">
              {trajectories.length ? (
                trajectories.map((trajectory) => {
                  const subgroup = trajectory.subgroup_id
                    ? subgroupById.get(trajectory.subgroup_id)
                    : null;
                  const group = trajectory.group_id ? groupById.get(trajectory.group_id) : null;

                  return (
                    <Link
                      className="trajectory-saved-card"
                      key={trajectory.id}
                      to={`/disciplines/${disciplineId}/trajectories/${trajectory.id}`}
                    >
                      <strong>{trajectory.name}</strong>
                      <span>
                        {trajectoryStatusLabel(trajectory.status)} ·{" "}
                        {trajectory.is_actual ? "актуальна" : "устарела"} ·{" "}
                        {group?.name ?? "без группы"}
                        {subgroup ? ` / подгруппа ${subgroup.subgroup_num}` : ""}
                      </span>
                    </Link>
                  );
                })
              ) : (
                <p className="card__text">Траекторий пока нет.</p>
              )}
            </div>
          </section>
        </main>
      ) : null}
    </div>
  );
}
