import {
  createContext,
  type PropsWithChildren,
  useContext,
  useMemo,
  useState,
} from "react";

export type AppNotificationKind = "error" | "success";

export type AppNotification = {
  id: string;
  kind: AppNotificationKind;
  text: string;
  createdAt: number;
  read: boolean;
};

type NotificationsContextValue = {
  dismissNotification: (id: string) => void;
  markAllAsRead: () => void;
  notifications: AppNotification[];
  pushNotification: (kind: AppNotificationKind, text: string) => void;
  unreadCount: number;
};

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

export function NotificationsProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<AppNotification[]>([]);

  const value = useMemo<NotificationsContextValue>(() => {
    function pushNotification(kind: AppNotificationKind, text: string) {
      const normalizedText = text.trim();
      if (!normalizedText) {
        return;
      }

      setNotifications((current) => {
        const duplicate = current.find(
          (notification) => notification.kind === kind && notification.text === normalizedText,
        );
        if (duplicate) {
          return current.map((notification) =>
            notification.id === duplicate.id ? { ...notification, read: false } : notification,
          );
        }

        const next: AppNotification[] = [
          {
            id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
            kind,
            text: normalizedText,
            createdAt: Date.now(),
            read: false,
          },
          ...current,
        ];

        return next.slice(0, 20);
      });
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
      markAllAsRead,
      notifications,
      pushNotification,
      unreadCount: notifications.reduce(
        (count, notification) => count + (notification.read ? 0 : 1),
        0,
      ),
    };
  }, [notifications]);

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
