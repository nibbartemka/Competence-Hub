import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { fetchActiveSession, isAbortError, logout } from "./api";
import { useNotifications } from "./notifications";
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

const BRAND_LOGO_SRC = "/assets/branding/LOGO.png";

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
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const profilePanelRef = useRef<HTMLElement | null>(null);
  const {
    dismissNotification,
    dismissToast,
    markAllAsRead,
    notifications,
    unreadCount,
    visibleToasts,
  } = useNotifications();

  const isAuthPage =
    location.pathname === "/" ||
    location.pathname === "/login" ||
    location.pathname.startsWith("/login/");

  useEffect(() => subscribeToSessionChanges(() => setSession(readSession())), []);

  useEffect(() => {
    if (!notificationsOpen && !profileOpen) {
      return;
    }

    function handlePointerDown(event: PointerEvent) {
      if (!profilePanelRef.current?.contains(event.target as Node)) {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setNotificationsOpen(false);
        setProfileOpen(false);
      }
    }

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [notificationsOpen, profileOpen]);

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
    setNotificationsOpen(false);
    setProfileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!notificationsOpen) {
      return;
    }
    markAllAsRead();
  }, [markAllAsRead, notificationsOpen]);

  const profileName = session?.displayName || session?.login || "Пользователь";
  const profileInitials = useMemo(() => initialsOf(profileName) || "CH", [profileName]);

  if (!session || isAuthPage) {
    return null;
  }

  async function handleLogout() {
    try {
      await logout();
    } catch {
      // Локальная очистка все равно управляет видимой сессией.
    } finally {
      clearSession();
      setNotificationsOpen(false);
      setProfileOpen(false);
      navigate("/", { replace: true });
    }
  }

  return (
    <aside
      aria-label="Верхняя панель профиля"
      className="session-profile-header"
      ref={profilePanelRef}
    >
      <div className="session-profile-header__shell">
        <div className="session-profile-header__bar">
          <button
            className="session-profile-header__brand"
            onClick={() => {
              setProfileOpen(false);
              navigate(getSessionHomePath(session));
            }}
            type="button"
          >
            <span aria-hidden="true" className="session-profile-header__logo-slot">
              <img
                alt=""
                className="session-profile-header__logo-image"
                loading="eager"
                src={BRAND_LOGO_SRC}
              />
            </span>
            <span className="session-profile-header__brand-copy">
              <strong>Competence Hub</strong>
              <small>Адаптивный контроль знаний и умений</small>
            </span>
          </button>

          <div className="session-profile-header__actions">
            <button
              aria-controls="session-notification-sheet"
              aria-expanded={notificationsOpen}
              aria-label="Уведомления"
              className="session-profile-header__icon-button"
              onClick={() => {
                setProfileOpen(false);
                setNotificationsOpen((open) => !open);
              }}
              type="button"
            >
              <svg
                aria-hidden="true"
                fill="none"
                height="24"
                viewBox="0 0 24 24"
                width="24"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12 5.25a4.5 4.5 0 0 0-4.5 4.5v2.12c0 .9-.27 1.79-.78 2.54l-1.1 1.64a1.5 1.5 0 0 0 1.25 2.33h10.26a1.5 1.5 0 0 0 1.25-2.33l-1.1-1.64a4.5 4.5 0 0 1-.78-2.54V9.75a4.5 4.5 0 0 0-4.5-4.5Z"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
                <path
                  d="M9.75 19.5a2.25 2.25 0 0 0 4.5 0"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth="1.8"
                />
              </svg>
              {unreadCount ? (
                <span className="session-profile-header__icon-badge">
                  {unreadCount > 9 ? "9+" : unreadCount}
                </span>
              ) : null}
            </button>

            <button
              aria-controls="session-profile-sheet"
              aria-expanded={profileOpen}
              className="session-profile-header__summary"
              onClick={() => {
                setNotificationsOpen(false);
                setProfileOpen((open) => !open);
              }}
              type="button"
            >
              <span className="session-profile-header__avatar">{profileInitials}</span>
              <span className="session-profile-header__identity">
                <strong>{profileName}</strong>
                <small>{ROLE_LABELS[session.role]}</small>
              </span>
              <span
                aria-hidden="true"
                className={`session-profile-header__chevron ${
                  profileOpen ? "session-profile-header__chevron--open" : ""
                }`}
              />
            </button>
          </div>
        </div>

        {visibleToasts.length ? (
          <section aria-label="Всплывающие уведомления" className="session-toast-stack">
            {visibleToasts.map((toast) => (
              <article className={`toast-message toast-message--${toast.kind}`} key={toast.id}>
                <p>{toast.text}</p>
                <button
                  aria-label="Скрыть уведомление"
                  className="toast-message__close"
                  onClick={() => dismissToast(toast.id)}
                  type="button"
                />
              </article>
            ))}
          </section>
        ) : null}

        {notificationsOpen ? (
          <section
            aria-label="Уведомления"
            aria-modal="false"
            className="session-notification-sheet"
            id="session-notification-sheet"
            role="dialog"
          >
            <header className="session-notification-sheet__header">
              <div>
                <p className="card__eyebrow">Уведомления</p>
                <h2>Последние события</h2>
              </div>
            </header>

            <div className="session-notification-sheet__body">
              {notifications.length ? (
                notifications.map((notification) => (
                  <article
                    className={`session-notification-card session-notification-card--${notification.kind}`}
                    key={notification.id}
                  >
                    <div className="session-notification-card__copy">
                      <p>{notification.text}</p>
                    </div>
                    <button
                      aria-label="Убрать уведомление"
                      className="session-notification-card__close"
                      onClick={() => dismissNotification(notification.id)}
                      type="button"
                    />
                  </article>
                ))
              ) : (
                <div className="session-notification-sheet__empty">
                  Новых уведомлений пока нет.
                </div>
              )}
            </div>
          </section>
        ) : null}

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
                </div>
              </div>
              <div className="session-profile-sheet__actions">
                <button className="ghost-button" onClick={handleLogout} type="button">
                  Выйти
                </button>
              </div>
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
              </div>
            </div>
          </section>
        ) : null}
      </div>
    </aside>
  );
}
