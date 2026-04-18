// import ReactDOM from "react-dom/client";

// import App from "./App";
// import "./styles.css";

// ReactDOM.createRoot(document.getElementById("root")!).render(<App />);

import React from 'react';
import ReactDOM from 'react-dom/client';
import './styles.css';
import { createBrowserRouter, RouterProvider } from "react-router-dom";
import KnowledgeGraph from './KnowledgeGraph'; // новый компонент

const router = createBrowserRouter([
    { path: "/disciplines/:disciplineId/knowledge", element: <KnowledgeGraph /> }, // новый маршрут
]);

const root = ReactDOM.createRoot(
    document.getElementById('root') as HTMLElement
);

root.render(
    <React.StrictMode>
        <RouterProvider router={router} />
    </React.StrictMode>
);