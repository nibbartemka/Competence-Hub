import {
  createContext,
  type PropsWithChildren,
  useEffect,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";

export type AppNotificationKind = "error" | "success";
const TOAST_DURATION_MS = 5000;

export type AppNotification = {
  id: string;
  kind: AppNotificationKind;
  text: string;
  createdAt: number;
  read: boolean;
};

export type AppToast = {
  id: string;
  kind: AppNotificationKind;
  notificationId: string;
  text: string;
  createdAt: number;
};

type NotificationsContextValue = {
  dismissNotification: (id: string) => void;
  dismissToast: (id: string) => void;
  markAllAsRead: () => void;
  notifications: AppNotification[];
  pushNotification: (kind: AppNotificationKind, text: string) => void;
  unreadCount: number;
  visibleToasts: AppToast[];
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [visibleToasts, setVisibleToasts] = useState<AppToast[]>([]);
  const toastTimeoutsRef = useRef(new Map<string, number>());

  function clearToastTimeout(toastId: string) {
    const timeoutId = toastTimeoutsRef.current.get(toastId);
    if (timeoutId === undefined) {
      return;
    }

    window.clearTimeout(timeoutId);
    toastTimeoutsRef.current.delete(toastId);
  }

  function dismissToast(id: string) {
    clearToastTimeout(id);
    setVisibleToasts((current) => current.filter((toast) => toast.id !== id));
  }

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current.clear();
    };
  }, []);

  const value = useMemo<NotificationsContextValue>(() => {
    function pushNotification(kind: AppNotificationKind, text: string) {
      const normalizedText = text.trim();
      if (!normalizedText) {
        return;
      }

      const createdAt = Date.now();
      const duplicate = notifications.find(
        (notification) => notification.kind === kind && notification.text === normalizedText,
      );
      const notificationId =
        duplicate?.id ?? `${createdAt}-${Math.random().toString(36).slice(2)}`;
      const toastId = `${createdAt}-${Math.random().toString(36).slice(2)}`;

      setNotifications((current) => {
        if (duplicate) {
          const refreshedNotification: AppNotification = {
            ...duplicate,
            createdAt,
            read: false,
          };
          return [
            refreshedNotification,
            ...current.filter((notification) => notification.id !== duplicate.id),
          ];
        }

        const nextNotification: AppNotification = {
          id: notificationId,
          kind,
          text: normalizedText,
          createdAt,
          read: false,
        };

        const next: AppNotification[] = [nextNotification, ...current];

        return next.slice(0, 20);
      });

      setVisibleToasts((current) => {
        const nextToast: AppToast = {
          id: toastId,
          kind,
          notificationId,
          text: normalizedText,
          createdAt,
        };
        const next = [nextToast, ...current];
        const removed = next.slice(3);
        for (const toast of removed) {
          clearToastTimeout(toast.id);
        }
        return next.slice(0, 3);
      });

      clearToastTimeout(toastId);
      toastTimeoutsRef.current.set(
        toastId,
        window.setTimeout(() => {
          dismissToast(toastId);
        }, TOAST_DURATION_MS),
      );
    }

    function dismissNotification(id: string) {
      setNotifications((current) =>
        current.filter((notification) => notification.id !== id),
      );
    }

    function markAllAsRead() {
      setNotifications((current) =>
        current.map((notification) =>
          notification.read ? notification : { ...notification, read: true },
        ),
      );
    }

    return {
      dismissNotification,
      dismissToast,
      markAllAsRead,
      notifications,
      pushNotification,
      unreadCount: notifications.reduce(
        (count, notification) => count + (notification.read ? 0 : 1),
        0,
      ),
      visibleToasts,
    };
  }, [notifications, visibleToasts]);

  return (
    <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>
  );
}

export function useNotifications() {
  const context = useContext(NotificationsContext);
  if (!context) {
    throw new Error("useNotifications must be used within NotificationsProvider");
  }
  return context;
}
