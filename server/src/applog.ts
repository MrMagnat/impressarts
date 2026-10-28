/**
 * Журнал ошибок приложения.
 *
 * Журнал обращений к 1С (`sync_log`) покрывает только синхронизацию. Всё
 * остальное — сорвавшийся отчёт, упавший экспорт в PDF, ошибка импорта —
 * уходило в stdout контейнера, и посмотреть это можно было лишь через
 * `docker compose logs`. Сюда пишутся те же события, но в базу, чтобы их
 * было видно в интерфейсе: Настройки → Журнал ошибок.
 *
 * Журнал кольцевой: хранится последние MAX_ROWS записей.
 */
import { db } from "./db.js";

const MAX_ROWS = 500;

export type LogLevel = "error" | "warn" | "info";

export interface AppLogRow {
  id: number;
  at: string;
  level: LogLevel;
  source: string;
  message: string;
  detail: string | null;
}

/** Текст ошибки без стектрейса — он уходит в `detail`. */
function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message || e.name;
  if (typeof e === "string") return e;
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}

function detailOf(e: unknown, extra?: string): string | null {
  const parts: string[] = [];
  if (extra) parts.push(extra);
  if (e instanceof Error && e.stack) parts.push(e.stack);
  const s = parts.join("\n\n").trim();
  return s ? s.slice(0, 8000) : null;
}

/**
 * Записать событие. Сам журнал никогда не должен ронять обработчик запроса,
 * поэтому любые ошибки записи глотаются.
 */
export function appLog(level: LogLevel, source: string, e: unknown, extra?: string): void {
  try {
    const d = db();
    d.prepare("INSERT INTO app_log(at, level, source, message, detail) VALUES(?,?,?,?,?)").run(
      new Date().toISOString(),
      level,
      source.slice(0, 120),
      messageOf(e).slice(0, 1000),
      detailOf(e, extra),
    );
    d.prepare(
      "DELETE FROM app_log WHERE id <= (SELECT MAX(id) FROM app_log) - ?",
    ).run(MAX_ROWS);
  } catch {
    /* журнал не должен мешать работе */
  }
}

export const logError = (source: string, e: unknown, extra?: string) =>
  appLog("error", source, e, extra);

export function recentAppLog(limit = 100): AppLogRow[] {
  return db()
    .prepare("SELECT id, at, level, source, message, detail FROM app_log ORDER BY id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 500)) as unknown as AppLogRow[];
}

export function clearAppLog(): number {
  const n = Number(db().prepare("DELETE FROM app_log").run().changes ?? 0);
  return n;
}
