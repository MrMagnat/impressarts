import React from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "./auth";
import { useAsync } from "./ui";
import { api } from "./api";
import { fmtDate } from "./format";

const NAV = [
  { to: "/", label: "Дашборд", icon: "▦", end: true },
  { to: "/catalog", label: "Каталог", icon: "▤" },
  { to: "/reports", label: "Отчёты", icon: "▧" },
  { to: "/expiry", label: "Сроки годности", icon: "⏱" },
  { to: "/settings", label: "Настройки", icon: "⚙" },
];

export default function App() {
  const { logout } = useAuth();
  const nav = useNavigate();
  const { data: meta } = useAsync(() => api.meta(), []);

  return (
    <div className="min-h-full flex">
      {/* sidebar */}
      <aside className="w-60 shrink-0 bg-panel text-white flex flex-col">
        <div className="px-5 py-4 border-b border-white/10">
          <img src="/impress-logo-white.svg" alt="ИМПРЕСС АРТ" className="h-9 w-auto" />
          <div className="text-white/45 text-xs mt-2 tracking-wide uppercase">Складской дашборд</div>
        </div>
        <nav className="flex-1 p-3 space-y-1">
          {NAV.map((n) => (
            <NavLink
              key={n.to}
              to={n.to}
              end={n.end}
              className={({ isActive }) =>
                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition " +
                (isActive ? "bg-brand-500 text-white" : "text-white/65 hover:bg-white/10 hover:text-white")
              }
            >
              <span className="text-base w-5 text-center opacity-90">{n.icon}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-white/10 text-xs text-white/45">
          <div>Актуально на</div>
          <div className="text-white/80 font-medium">{fmtDate(meta?.currentDate)}</div>
          <div className="mt-1">{meta?.snapshots ?? "…"} снимков истории</div>
        </div>
      </aside>

      {/* main */}
      <div className="flex-1 min-w-0 flex flex-col">
        <header className="h-16 shrink-0 bg-white border-b border-line flex items-center justify-between px-6">
          <div className="text-sm text-ink-mut">
            Данные из 1С · последняя загрузка <b className="text-ink">{fmtDate(meta?.currentDate)}</b>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-sm text-ink-mut hidden sm:block">{}</span>
            <button
              className="btn-line"
              onClick={async () => {
                await logout();
                nav("/login");
              }}
            >
              Выйти
            </button>
          </div>
        </header>
        <main className="flex-1 min-h-0 overflow-auto p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
