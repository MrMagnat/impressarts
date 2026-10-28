import React, { useState } from "react";
import { AppLogRow, api } from "../api";
import { Card, ErrorBox, Loading, Spinner, useAsync } from "../ui";

/** Локальное время записи: в базе лежит ISO в UTC. */
function at(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("ru-RU");
}

const LEVEL_STYLE: Record<string, string> = {
  error: "bg-red-50 text-down",
  warn: "bg-amber-50 text-amber-800",
  info: "bg-bg text-ink-mut",
};

/**
 * Журнал ошибок приложения.
 *
 * Раньше сорвавшийся отчёт или экспорт было видно только через
 * `docker compose logs` на сервере — из интерфейса причина не читалась.
 * Обращения к 1С остались на своей вкладке «Источник 1С».
 */
export default function LogsTab() {
  const { data, loading, error, reload } = useAsync(() => api.appLog(200), []);
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;

  const rows: AppLogRow[] = data ?? [];

  const clear = async () => {
    setBusy(true);
    try {
      await api.appLogClear();
      reload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <p className="text-sm text-ink-mut max-w-2xl">
          Ошибки отчётов, экспорта в PDF и импорта файлов. Хранятся последние 500 записей. Те же
          события попадают в логи сервера: <code className="text-xs">docker compose logs -f</code>.
          Обращения к 1С — на вкладке «Источник 1С».
        </p>
        <div className="flex items-center gap-2">
          <button className="btn-line" onClick={reload}>
            Обновить
          </button>
          <button className="btn-line" disabled={busy || rows.length === 0} onClick={clear}>
            {busy ? <Spinner /> : "Очистить"}
          </button>
        </div>
      </div>

      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-mut text-xs bg-bg/60">
              <th className="px-4 py-2.5 font-semibold w-44">Когда</th>
              <th className="px-4 py-2.5 font-semibold w-20">Уровень</th>
              <th className="px-4 py-2.5 font-semibold w-64">Где</th>
              <th className="px-4 py-2.5 font-semibold">Сообщение</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-10 text-center text-ink-faint">
                  Записей нет — ошибок с момента запуска не было
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <React.Fragment key={r.id}>
                <tr
                  onClick={() => setOpen(open === r.id ? null : r.id)}
                  className="border-t border-line/70 hover:bg-bg/50 cursor-pointer align-top"
                >
                  <td className="px-4 py-2 num text-ink-mut whitespace-nowrap">{at(r.at)}</td>
                  <td className="px-4 py-2">
                    <span className={"tag " + (LEVEL_STYLE[r.level] ?? LEVEL_STYLE.info)}>
                      {r.level}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-ink-soft break-words">{r.source}</td>
                  <td className="px-4 py-2 break-words">
                    {r.detail && <span className="text-ink-faint mr-1.5">{open === r.id ? "▾" : "▸"}</span>}
                    {r.message}
                  </td>
                </tr>
                {open === r.id && r.detail && (
                  <tr className="bg-bg/60">
                    <td colSpan={4} className="px-4 py-3">
                      <pre className="text-[11px] leading-relaxed whitespace-pre-wrap text-ink-soft">
                        {r.detail}
                      </pre>
                    </td>
                  </tr>
                )}
              </React.Fragment>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
