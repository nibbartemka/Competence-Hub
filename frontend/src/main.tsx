import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router-dom";

import { HomePage } from "./HomePage";
import KnowledgeGraph from "./KnowledgeGraph";
import TrajectoryGraphBuilder from "./TrajectoryGraphBuilder";
import "./styles.css";

const router = createBrowserRouter([
  { path: "/", element: <HomePage /> },
  { path: "/disciplines/:disciplineId/knowledge", element: <KnowledgeGraph /> },
  { path: "/disciplines/:disciplineId/trajectory", element: <TrajectoryGraphBuilder /> },
]);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
