import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import DisciplineOverviewPage from "./DisciplineOverviewPage";
import { HomePage } from "./HomePage";
import KnowledgeGraph from "./KnowledgeGraph";
import StudentDashboardPage from "./StudentDashboardPage";
import StudentTopicControlPage from "./StudentTopicControlPage";
import TeacherDashboardPage from "./TeacherDashboardPage";
import TrajectoryGraphBuilder from "./TrajectoryGraphBuilder";
import TrajectoryDetailPage from "./TrajectoryDetailPage";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
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
