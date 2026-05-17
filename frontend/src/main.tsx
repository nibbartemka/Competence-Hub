import React from "react";
import ReactDOM from "react-dom/client";
import {
  Navigate,
  Outlet,
  RouterProvider,
  createBrowserRouter,
  useParams,
} from "react-router-dom";

import AdminUserProfilePage from "./AdminUserProfilePage";
import DisciplineOverviewPage from "./DisciplineOverviewPage";
import { LandingPage } from "./LandingPage";
import { HomePage } from "./HomePage";
import KnowledgeGraph from "./KnowledgeGraph";
import { NotificationsProvider } from "./notifications";
import { SessionProfileHeader } from "./SessionProfileHeader";
import StudentDashboardPage from "./StudentDashboardPage";
import StudentTopicControlPage from "./StudentTopicControlPage";
import TeacherDashboardPage from "./TeacherDashboardPage";
import TrajectoryGraphBuilder from "./TrajectoryGraphBuilder";
import TrajectoryDetailPage from "./TrajectoryDetailPage";
import "./styles.css";

function AppShell() {
  return (
    <>
      <SessionProfileHeader />
      <Outlet />
    </>
  );
}

function LegacyTeacherHomeRedirect() {
  const { teacherId } = useParams<{ teacherId: string }>();

  if (!teacherId) {
    return <Navigate replace to="/" />;
  }

  return <Navigate replace to={`/teachers/${teacherId}`} />;
}

const router = createBrowserRouter([
  {
    element: <AppShell />,
    children: [
      { path: "/", element: <LandingPage /> },
      { path: "/login", element: <LandingPage /> },
      { path: "/login/:role", element: <LandingPage /> },
      { path: "/admins/:adminId/home", element: <HomePage /> },
      { path: "/experts/:expertId/home", element: <HomePage /> },
      { path: "/teachers/:teacherId/home", element: <LegacyTeacherHomeRedirect /> },
      { path: "/students/:studentId/home", element: <StudentDashboardPage /> },
      { path: "/disciplines/:disciplineId", element: <DisciplineOverviewPage /> },
      { path: "/disciplines/:disciplineId/knowledge", element: <KnowledgeGraph /> },
      { path: "/disciplines/:disciplineId/trajectory", element: <TrajectoryGraphBuilder /> },
      {
        path: "/disciplines/:disciplineId/trajectories/:trajectoryId",
        element: <TrajectoryDetailPage />,
      },
      { path: "/teachers/:teacherId", element: <TeacherDashboardPage /> },
      { path: "/students/:studentId", element: <StudentDashboardPage /> },
      { path: "/admin/users/:role/:userId", element: <AdminUserProfilePage /> },
      {
        path: "/students/:studentId/trajectories/:trajectoryId/control/:topicId",
        element: <StudentTopicControlPage />,
      },
      {
        path: "/learn/:trajectoryId/step/:topicPosition",
        element: <StudentTopicControlPage />,
      },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <NotificationsProvider>
      <RouterProvider router={router} />
    </NotificationsProvider>
  </React.StrictMode>,
);
