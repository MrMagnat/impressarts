import React from "react";
import ReactDOM from "react-dom/client";
import { createBrowserRouter, Navigate, RouterProvider } from "react-router-dom";
import "./index.css";
import { AuthProvider, useAuth } from "./auth";
import App from "./App";
import Login from "./pages/Login";
import Dashboard from "./pages/Dashboard";
import Catalog from "./pages/Catalog";
import Reports from "./pages/Reports";
import Expiry from "./pages/Expiry";
import Settings from "./pages/Settings";
import { Loading } from "./ui";
import LicenseGate from "./components/LicenseGate";

function Guard({ children }: { children: React.ReactNode }) {
  const { authed } = useAuth();
  if (authed === null) return <div className="min-h-full grid place-items-center"><Loading /></div>;
  if (!authed) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

const router = createBrowserRouter([
  { path: "/login", element: <Login /> },
  {
    path: "/",
    element: (
      <Guard>
        <App />
      </Guard>
    ),
    children: [
      { index: true, element: <Dashboard /> },
      { path: "catalog", element: <Catalog /> },
      { path: "reports", element: <Reports /> },
      { path: "expiry", element: <Expiry /> },
      { path: "settings", element: <Settings /> },
    ],
  },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LicenseGate>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </LicenseGate>
  </React.StrictMode>,
);
