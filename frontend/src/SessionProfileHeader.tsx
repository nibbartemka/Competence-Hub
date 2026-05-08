import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchActiveSession, isAbortError, logout } from "./api";
import {
  clearSession,
  getSessionHomePath,
  readSession,
  saveSession,
  subscribeToSessionChanges,
  type ActiveSession,
} from "./session";
import type { AuthRole } from "./types";

const ROLE_LABELS: Record<AuthRole, string> = {
  admin: "Администратор",
  expert: "Эксперт",
  teacher: "Преподаватель",
  student: "Студент",
};

function initialsOf(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}

export function SessionProfileHeader() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState<ActiveSession | null>(() => readSession());
  const [profileOpen, setProfileOpen] = useState(false);

  const isAuthPage =
    location.pathname === "/" ||
    location.pathname === "/login" ||
    location.pathname.startsWith("/login/");

  useEffect(() => subscribeToSessionChanges(() => setSession(readSession())), []);

  useEffect(() => {
    const cachedSession = readSession();
    setSession(cachedSession);
    if (!cachedSession) {
      if (!isAuthPage) {
        navigate("/", { replace: true });
      }
      return;
    }

    const controller = new AbortController();
    const sessionId = cachedSession.sessionId;
    async function syncServerSession() {
      try {
        const serverSession = await fetchActiveSession(controller.signal);
        saveSession({
          role: serverSession.role,
          userId: serverSession.user_id,
          displayName: serverSession.display_name,
          login: serverSession.login,
          sessionId,
        });
      } catch (error) {
        if (!isAbortError(error)) {
          clearSession();
          if (!isAuthPage) {
            navigate("/", { replace: true });
          }
        }
      }
    }

    void syncServerSession();
    return () => controller.abort();
  }, [isAuthPage, location.pathname, navigate]);

  const profileName = session?.displayName || session?.login || "Пользователь";
  const profileInitials = useMemo(() => initialsOf(profileName) || "CH", [profileName]);

  if (!session || isAuthPage) {
    return null;
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Local cleanup is still the source of truth for the visible UI.
    } finally {
      clearSession();
      setProfileOpen(false);
      navigate("/", { replace: true });
    }
  }

  return (
    <aside className="session-profile-header" aria-label="Текущий профиль">
      <button
        className="session-profile-header__summary"
        onClick={() => navigate(getSessionHomePath(session))}
        type="button"
      >
        <span className="session-profile-header__avatar">{profileInitials}</span>
        <span className="session-profile-header__identity">
          <strong>{profileName}</strong>
          <small>{ROLE_LABELS[session.role]}</small>
        </span>
      </button>
      <div className="session-profile-header__actions">
        <button className="secondary-button" onClick={() => setProfileOpen(true)} type="button">
          Профиль
        </button>
        <button className="ghost-button" onClick={handleLogout} type="button">
          Выйти
        </button>
      </div>

      {profileOpen ? (
        <div className="modal-backdrop" onClick={() => setProfileOpen(false)}>
          <div className="modal-panel session-profile-modal" onClick={(event) => event.stopPropagation()}>
            <header className="modal-panel__header">
              <div>
                <p className="card__eyebrow">Текущий профиль</p>
                <h2>{profileName}</h2>
                <p className="card__text">Вы сейчас работаете в системе с этой ролью.</p>
              </div>
              <button className="ghost-button" onClick={() => setProfileOpen(false)} type="button">
                Назад
              </button>
            </header>
            <div className="modal-panel__body">
              <div className="admin-detail-grid">
                <div className="admin-detail-card">
                  <span>Роль</span>
                  <strong>{ROLE_LABELS[session.role]}</strong>
                </div>
                <div className="admin-detail-card">
                  <span>Логин</span>
                  <strong>{session.login || "не указан"}</strong>
                </div>
                <div className="admin-detail-card">
                  <span>Сессия</span>
                  <strong>Активна</strong>
                </div>
                <div className="admin-detail-card">
                  <span>Доступ</span>
                  <strong>Личный кабинет</strong>
                </div>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
