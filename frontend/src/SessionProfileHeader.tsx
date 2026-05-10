import { useEffect, useMemo, useRef, useState } from "react";
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
  const profilePanelRef = useRef<HTMLElement | null>(null);

  const isAuthPage =
    location.pathname === "/" ||
    location.pathname === "/login" ||
    location.pathname.startsWith("/login/");

  useEffect(() => subscribeToSessionChanges(() => setSession(readSession())), []);

  useEffect(() => {
    if (!profileOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!profilePanelRef.current?.contains(event.target as Node)) {
        setProfileOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setProfileOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [profileOpen]);

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

  useEffect(() => {
    setProfileOpen(false);
  }, [location.pathname]);

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
    <aside
      aria-label="Текущий профиль"
      className="session-profile-header"
      ref={profilePanelRef}
    >
      <div className="session-profile-header__bar">
        <button
          className="session-profile-header__summary"
          onClick={() => {
            setProfileOpen(false);
            navigate(getSessionHomePath(session));
          }}
          type="button"
        >
          <span className="session-profile-header__avatar">{profileInitials}</span>
          <span className="session-profile-header__identity">
            <strong>{profileName}</strong>
            <small>{ROLE_LABELS[session.role]}</small>
          </span>
        </button>
        <div className="session-profile-header__actions">
          <button
            aria-controls="session-profile-sheet"
            aria-expanded={profileOpen}
            className="secondary-button"
            onClick={() => setProfileOpen((open) => !open)}
            type="button"
          >
            Профиль
          </button>
          <button className="ghost-button" onClick={handleLogout} type="button">
            Выйти
          </button>
        </div>
      </div>

      {profileOpen ? (
        <section
          aria-label="Панель профиля"
          aria-modal="false"
          className="session-profile-sheet"
          id="session-profile-sheet"
          role="dialog"
        >
          <header className="session-profile-sheet__header">
            <div className="session-profile-sheet__intro">
              <span className="session-profile-header__avatar session-profile-header__avatar--large">
                {profileInitials}
              </span>
              <div className="session-profile-sheet__copy">
                <p className="card__eyebrow">Текущий профиль</p>
                <h2>{profileName}</h2>
                <p className="card__text">
                  Вы сейчас работаете в системе с этой ролью.
                </p>
              </div>
            </div>
            <button className="ghost-button" onClick={() => setProfileOpen(false)} type="button">
              Назад
            </button>
          </header>

          <div className="session-profile-sheet__body">
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
        </section>
      ) : null}
    </aside>
  );
}
