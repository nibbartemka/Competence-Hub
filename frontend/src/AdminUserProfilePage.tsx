import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import {
  deleteAdmin,
  deleteExpert,
  fetchAdmins,
  fetchDisciplines,
  fetchExperts,
  isAbortError,
} from "./api";
import { getSessionHomePath, readSession } from "./session";
import type { Admin, AuthRole, Discipline, Expert } from "./types";

type UserRole = Exclude<AuthRole, "student" | "teacher">;

const ROLE_LABELS: Record<UserRole, string> = {
  admin: "Администратор",
  expert: "Эксперт",
};

function statusLabel(isActive: boolean) {
  return isActive ? "Активен" : "Неактивен";
}

export default function AdminUserProfilePage() {
  const { role, userId } = useParams<{ role: UserRole; userId: string }>();
  const navigate = useNavigate();

  const [admins, setAdmins] = useState<Admin[]>([]);
  const [experts, setExperts] = useState<Expert[]>([]);
  const [disciplines, setDisciplines] = useState<Discipline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const currentSession = readSession();

  useEffect(() => {
    const session = readSession();
    if (session?.role !== "admin") {
      navigate(getSessionHomePath(session), { replace: true });
      return;
    }

    const controller = new AbortController();
    async function load() {
      try {
        setLoading(true);
        setError("");
        const [nextAdmins, nextExperts, nextDisciplines] = await Promise.all([
          fetchAdmins(controller.signal),
          fetchExperts(controller.signal),
          fetchDisciplines(controller.signal),
        ]);
        setAdmins(nextAdmins);
        setExperts(nextExperts);
        setDisciplines(nextDisciplines);
      } catch (loadError) {
        if (!isAbortError(loadError)) {
          setError(loadError instanceof Error ? loadError.message : "Не удалось загрузить профиль.");
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => controller.abort();
  }, [navigate]);

  const user = useMemo(() => {
    if (role === "admin") return admins.find((admin) => admin.id === userId) ?? null;
    if (role === "expert") return experts.find((expert) => expert.id === userId) ?? null;
    return null;
  }, [admins, experts, role, userId]);

  const userDisciplines =
    role === "expert" && user
      ? disciplines.filter((discipline) => (user as Expert).discipline_ids.includes(discipline.id))
      : [];

  if (role !== "admin" && role !== "expert") {
    return null;
  }

  const isCurrentAdminProfile =
    role === "admin" && currentSession?.role === "admin" && currentSession.userId === userId;
  const userRoleLabel = role && role in ROLE_LABELS ? ROLE_LABELS[role] : "Пользователь";

  async function handleDelete() {
    if (!user || isCurrentAdminProfile) {
      return;
    }

    const confirmed = window.confirm(
      `Удалить пользователя "${user.name}" (${userRoleLabel})? Это действие нельзя отменить.`,
    );
    if (!confirmed) {
      return;
    }

    try {
      setDeleting(true);
      if (role === "admin") {
        await deleteAdmin(user.id);
      } else {
        await deleteExpert(user.id);
      }
      navigate(getSessionHomePath(currentSession), { replace: true });
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Не удалось удалить профиль.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="page-shell role-page immersive-page immersive-page--teacher">
      <header className="hero immersive-page__hero role-dashboard-hero">
        <div>
          <p className="hero__eyebrow">Просмотр профиля</p>
          <h1>{user?.name ?? ROLE_LABELS[role]}</h1>
          <p className="hero__subtitle">
            Администратор просматривает профиль пользователя без входа в его учетную запись.
          </p>
        </div>
        <div className="hero__controls">
          <button className="ghost-button" onClick={() => navigate(getSessionHomePath())} type="button">
            К кабинету администратора
          </button>
          <button
            className="secondary-button secondary-button--danger"
            disabled={!user || deleting || isCurrentAdminProfile}
            onClick={() => void handleDelete()}
            type="button"
          >
            {isCurrentAdminProfile ? "Текущий админ" : "Удалить пользователя"}
          </button>
        </div>
      </header>

      {error ? <div className="home-feedback home-feedback--error">{error}</div> : null}
      {loading ? (
        <section className="status-view">
          <div className="status-view__pulse" />
          <h3>Загружаю профиль</h3>
        </section>
      ) : user ? (
        <main className="role-dashboard-grid">
          <section className="card card--soft role-dashboard-section">
            <p className="card__eyebrow">Данные профиля</p>
            <div className="admin-detail-grid">
              <div className="admin-detail-card">
                <span>Роль</span>
                <strong>{ROLE_LABELS[role]}</strong>
              </div>
              <div className="admin-detail-card">
                <span>Логин</span>
                <strong>{user.login}</strong>
              </div>
              <div className="admin-detail-card">
                <span>Статус</span>
                <strong>{statusLabel(user.is_active)}</strong>
              </div>
              <div className="admin-detail-card">
                <span>Доступ</span>
                <strong>{user.is_active ? "Вход разрешен" : "Вход закрыт"}</strong>
              </div>
            </div>
          </section>

          {role === "expert" ? (
            <section className="card card--soft role-dashboard-section">
              <p className="card__eyebrow">Дисциплины</p>
              <div className="role-card-grid">
                {userDisciplines.length ? (
                  userDisciplines.map((discipline) => (
                    <article className="role-feature-card" key={discipline.id}>
                      <strong>{discipline.name}</strong>
                      <span>Версия графа: {discipline.knowledge_graph_version}</span>
                    </article>
                  ))
                ) : (
                  <p className="card__text">Дисциплины не назначены.</p>
                )}
              </div>
            </section>
          ) : null}
        </main>
      ) : (
        <section className="status-view status-view--error">
          <h3>Профиль не найден</h3>
        </section>
      )}
    </div>
  );
}
