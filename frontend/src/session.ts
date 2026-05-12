export type SessionRole = "admin" | "expert" | "teacher" | "student";

export type ActiveSession = {
  role: SessionRole;
  userId: string;
  displayName: string;
  login: string;
  sessionId: string;
};

type SessionStorageKind = "local" | "session";

const SESSION_STORAGE_KEY = "competence-hub-session";
const SESSION_CHANGED_EVENT = "competence-hub-session-changed";

function isSessionRole(value: unknown): value is SessionRole {
  return value === "admin" || value === "expert" || value === "teacher" || value === "student";
}

function parseSession(rawSession: string | null): ActiveSession | null {
  if (!rawSession) {
    return null;
  }

  try {
    const parsedSession = JSON.parse(rawSession) as Partial<ActiveSession>;
    if (
      !isSessionRole(parsedSession.role) ||
      !parsedSession.userId ||
      !parsedSession.sessionId
    ) {
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
    return null;
  }
}

function storageByKind(kind: SessionStorageKind) {
  return kind === "local" ? window.localStorage : window.sessionStorage;
}

function readSessionWithSource(): { session: ActiveSession; source: SessionStorageKind } | null {
  const sessionStorageSession = parseSession(
    window.sessionStorage.getItem(SESSION_STORAGE_KEY),
  );
  if (sessionStorageSession) {
    return { session: sessionStorageSession, source: "session" };
  }

  const localStorageSession = parseSession(window.localStorage.getItem(SESSION_STORAGE_KEY));
  if (localStorageSession) {
    return { session: localStorageSession, source: "local" };
  }

  return null;
}

export function saveSession(
  session: ActiveSession,
  options?: {
    remember?: boolean;
  },
) {
  const source: SessionStorageKind =
    options?.remember === undefined
      ? readSessionWithSource()?.source ?? "local"
      : options.remember
        ? "local"
        : "session";

  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  storageByKind(source).setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  window.dispatchEvent(new Event(SESSION_CHANGED_EVENT));
}

export function readSession(): ActiveSession | null {
  const stored = readSessionWithSource();
  if (stored) {
    return stored.session;
  }

  clearSession();
  return null;
}

export function clearSession() {
  window.localStorage.removeItem(SESSION_STORAGE_KEY);
  window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
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
