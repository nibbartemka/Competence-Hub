import { motion } from "motion/react";
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
import { disciplinePathValue } from "./disciplineRouting";
import { actionHoverMotion, cardHoverMotion, revealMotion } from "./motionPresets";
import type {
  DisciplineKnowledgeGraph,
  Group,
  LearningTrajectorySummary,
  Subgroup,
  Teacher,
} from "./types";

const MotionLink = motion(Link);

function extractErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  return "Не удалось загрузить страницу дисциплины.";
}

function trajectoryStatusLabel(status: LearningTrajectorySummary["status"]) {
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
  const [trajectories, setTrajectories] = useState<LearningTrajectorySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!disciplineId) return;
    const currentDisciplineId = disciplineId;
    const controller = new AbortController();

    async function load() {
      try {
        setLoading(true);
        setError("");
        const [nextGraph, nextGroups, nextTeachers] = await Promise.all([
          fetchDisciplineKnowledgeGraph(currentDisciplineId, controller.signal),
          fetchGroups(controller.signal),
          fetchTeachers(controller.signal),
        ]);
        const nextTrajectories = await fetchLearningTrajectories(
          { discipline_id: nextGraph.discipline.id },
          controller.signal,
        );
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
    <div className="page-shell discipline-overview-page immersive-page immersive-page--discipline">
      <motion.header className="hero immersive-page__hero" {...revealMotion(0.02)}>
        <div>
          <p className="hero__eyebrow">Паспорт дисциплины</p>
          <h1>{graph?.discipline.name ?? "Дисциплина"}</h1>
          <p className="hero__subtitle">
            Преподаватели, группы, траектории и краткая статистика графа знаний в одном
            рабочем экране.
          </p>
        </div>
        <div className="hero__controls">
          <button className="ghost-button" onClick={() => navigate("/")} type="button">
            На главную
          </button>
          <MotionLink
            className="primary-button"
            to={`/disciplines/${disciplinePathValue(graph?.discipline, disciplineId)}/knowledge`}
            {...actionHoverMotion}
          >
            Граф знаний
          </MotionLink>
          <MotionLink
            className="secondary-button"
            to={`/disciplines/${disciplinePathValue(graph?.discipline, disciplineId)}/trajectory`}
            {...actionHoverMotion}
          >
            Траектории
          </MotionLink>
        </div>
      </motion.header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}

      {loading ? (
        <section className="status-view immersive-page__status">
          <div className="status-view__pulse" />
          <h3>Загружаю дисциплину</h3>
        </section>
      ) : graph ? (
        <main className="overview-grid immersive-page__grid">
          <motion.section
            className="card card--soft overview-card overview-card--wide"
            {...revealMotion(0.05)}
            {...cardHoverMotion}
          >
            <p className="card__eyebrow">Статистика графа</p>
            <div className="overview-stats">
              <span>{graph.topics.length} тем</span>
              <span>{graph.knowledge_elements.length} элементов</span>
              <span>{graph.topic_dependencies.length} связей тем</span>
              <span>{graph.knowledge_element_relations.length} связей элементов</span>
              <span>Версия {graph.discipline.knowledge_graph_version}</span>
            </div>
          </motion.section>

          <motion.section className="card card--soft overview-card" {...revealMotion(0.08)} {...cardHoverMotion}>
            <p className="card__eyebrow">Преподаватели</p>
            {disciplineTeachers.length ? (
              disciplineTeachers.map((teacher) =>
                teacher ? (
                  <MotionLink
                    className="overview-row"
                    key={teacher.id}
                    to={`/teachers/${teacher.id}`}
                    {...actionHoverMotion}
                  >
                    <strong>{teacher.name}</strong>
                    <span>{teacher.group_ids.length} групп</span>
                  </MotionLink>
                ) : null,
              )
            ) : (
              <p className="card__text">Преподаватель пока не назначен.</p>
            )}
          </motion.section>

          <motion.section className="card card--soft overview-card" {...revealMotion(0.11)} {...cardHoverMotion}>
            <p className="card__eyebrow">Группы</p>
            {disciplineGroups.length ? (
              disciplineGroups.map((group) =>
                group ? (
                  <motion.article className="overview-row" key={group.id} {...actionHoverMotion}>
                    <strong>{group.name}</strong>
                    <span>
                      Подгруппы:{" "}
                      {subgroups.filter((subgroup) => subgroup.group_id === group.id).length || "нет"}
                    </span>
                  </motion.article>
                ) : null,
              )
            ) : (
              <p className="card__text">Группы пока не назначены.</p>
            )}
          </motion.section>

          <motion.section
            className="card card--soft overview-card overview-card--wide"
            {...revealMotion(0.14)}
            {...cardHoverMotion}
          >
            <p className="card__eyebrow">Траектории</p>
            <div className="trajectory-saved-list">
              {trajectories.length ? (
                trajectories.map((trajectory) => {
                  const subgroup = trajectory.subgroup_id
                    ? subgroupById.get(trajectory.subgroup_id)
                    : null;
                  const group = trajectory.group_id ? groupById.get(trajectory.group_id) : null;

                  return (
                    <MotionLink
                      className="trajectory-saved-card"
                      key={trajectory.id}
                      to={`/disciplines/${disciplinePathValue(graph?.discipline, disciplineId)}/trajectories/${trajectory.id}`}
                      {...actionHoverMotion}
                    >
                      <strong>{trajectory.name}</strong>
                      <span>
                        {trajectoryStatusLabel(trajectory.status)} ·{" "}
                        {trajectory.is_actual ? "актуальна" : "устарела"} ·{" "}
                        {group?.name ?? "без группы"}
                        {subgroup ? ` / подгруппа ${subgroup.subgroup_num}` : ""}
                      </span>
                    </MotionLink>
                  );
                })
              ) : (
                <p className="card__text">Траекторий пока нет.</p>
              )}
            </div>
          </motion.section>
        </main>
      ) : null}
    </div>
  );
}
