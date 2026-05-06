import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import DisciplineOverviewPage from "./DisciplineOverviewPage";
import { LandingPage } from "./LandingPage";
import { HomePage } from "./HomePage";
import KnowledgeGraph from "./KnowledgeGraph";
import StudentDashboardPage from "./StudentDashboardPage";
import StudentTopicControlPage from "./StudentTopicControlPage";
import TeacherDashboardPage from "./TeacherDashboardPage";
import TrajectoryGraphBuilder from "./TrajectoryGraphBuilder";
import TrajectoryDetailPage from "./TrajectoryDetailPage";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/", element: <LandingPage /> },
  { path: "/login", element: <LandingPage /> },
  { path: "/login/:role", element: <LandingPage /> },
  { path: "/admins/:adminId/home", element: <HomePage /> },
  { path: "/experts/:expertId/home", element: <HomePage /> },
  { path: "/teachers/:teacherId/home", element: <HomePage /> },
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
  {
    path: "/students/:studentId/trajectories/:trajectoryId/control/:topicId",
    element: <StudentTopicControlPage />,
  },
  {
    path: "/learn/:trajectoryId/step/:topicPosition",
    element: <StudentTopicControlPage />,
  },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
