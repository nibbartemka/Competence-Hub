export type SessionRole = "admin" | "expert" | "teacher" | "student";

export type ActiveSession = {
  role: SessionRole;
  userId: string;
  displayName: string;
  login: string;
  sessionId: string;
};

const SESSION_STORAGE_KEY = "competence-hub-session";
const SESSION_CHANGED_EVENT = "competence-hub-session-changed";

function isSessionRole(value: unknown): value is SessionRole {
  return value === "admin" || value === "expert" || value === "teacher" || value === "student";
}

export function saveSession(session: ActiveSession) {
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function readSession(): ActiveSession | null {
  try {
    const rawSession = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!rawSession) return null;

    const parsedSession = JSON.parse(rawSession) as Partial<ActiveSession>;
    if (
      !isSessionRole(parsedSession.role) ||
      !parsedSession.userId ||
      !parsedSession.sessionId
    ) {
      clearSession();
      return null;
    }

    return {
      role: parsedSession.role,
      userId: parsedSession.userId,
      displayName: parsedSession.displayName ?? "",
      login: parsedSession.login ?? "",
      sessionId: parsedSession.sessionId,
    };
  } catch {
    clearSession();
    return null;
  }
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function getSessionHomePath(session = readSession()) {
  if (!session) return "/";

  if (session.role === "admin") return `/admins/${session.userId}/home`;
  if (session.role === "expert") return `/experts/${session.userId}/home`;
  if (session.role === "teacher") return `/teachers/${session.userId}/home`;
  return `/students/${session.userId}`;
}

export function sessionMatches(session: ActiveSession | null, role: SessionRole, userId?: string) {
  return Boolean(session && userId && session.role === role && session.userId === userId);
}

export function subscribeToSessionChanges(listener: () => void) {
  window.addEventListener(SESSION_CHANGED_EVENT, listener);
  window.addEventListener("storage", listener);
  return () => {
    window.removeEventListener(SESSION_CHANGED_EVENT, listener);
    window.removeEventListener("storage", listener);
  };
}
