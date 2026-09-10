/**
 * Ежедневная синхронизация с 1С.
 *
 * Раз в сутки (час задаётся в настройках) приложение запрашивает у HTTP-сервиса
 * 1С остатки на сегодня, сверяет их с базой и — в режиме `import` — записывает
 * снимок: новые позиции заводятся, по существующим фиксируется приход/списание.
 *
 * Каждое обращение попадает в таблицу `sync_log` и в stdout сервера, поэтому
 * «запросы раз в день» видны и в интерфейсе, и в `docker logs`.
 */
import { db, getSetting, setSetting, currentDate } from "./db.js";
import { hashId, round, addDays, ymd, parseYmd } from "./util.js";
import { defaultPrice } from "./etl/prices.js";
import { ingestSnapshot } from "./etl/ingest.js";
import { fetchSource, parseSource, sourceConfig, type SourceConfig, type ParsedSource } from "./source.js";
import { writeAggregate, writeAggregateFromRows, trimDetail, hasDetail } from "./history.js";
import type { RawRow } from "./etl/import-excel.js";

const D = () => db();

let log: (m: string) => void = (m) => console.log(m);
let running = false;

export type Trigger = "schedule" | "manual" | "backfill";
export type SyncStatus = "ok" | "diff" | "imported" | "error";

export interface SyncResult {
  id: number;
  status: SyncStatus;
  askDate: string;
  snapshotDate: string | null;
  url: string;
  httpStatus: number;
  durationMs: number;
  rows: number;
  positions: number;
  newPositions: string[];
  gonePositions: string[];
  changedPositions: number;
  src: { kg: number; money: number };
  dbBefore: { kg: number; money: number };
  message: string;
  sample: string;
  diag?: ParsedSource["diag"];
}

/** Локальная дата сервера в формате YYYY-MM-DD. */
export function today(): string {
  const n = new Date();
  return (
    n.getFullYear() +
    "-" +
    String(n.getMonth() + 1).padStart(2, "0") +
    "-" +
    String(n.getDate()).padStart(2, "0")
  );
}

function priceMap(): Map<string, number> {
  const m = new Map<string, number>();
  for (const r of D().prepare("SELECT vid, price_per_kg FROM price").all() as {
    vid: string;
    price_per_kg: number;
  }[]) {
    m.set(r.vid, r.price_per_kg);
  }
  return m;
}

function positionId(r: RawRow): string {
  return hashId(r.tip, "|", r.vid, "|", r.name);
}

/** Свернуть строки источника в остатки по позициям. */
function foldRows(rows: RawRow[]) {
  const prices = priceMap();
  const kg = new Map<string, number>();
  let money = 0;
  let totalKg = 0;
  for (const r of rows) {
    const pid = positionId(r);
    kg.set(pid, (kg.get(pid) ?? 0) + r.kg);
    const p = prices.get(r.vid) ?? defaultPrice(r.tip, r.vid);
    money += r.kg * p;
    totalKg += r.kg;
  }
  return { byPosition: kg, kg: totalKg, money };
}

/** Дата, с которой сравниваем: сам запрошенный день, иначе последний снимок. */
function baselineDate(askDate: string): string | null {
  const d = D();
  const exact = d.prepare("SELECT date FROM snapshot WHERE date = ?").get(askDate) as
    | { date: string }
    | undefined;
  if (exact) return exact.date;
  const prev = d
    .prepare("SELECT MAX(date) AS d FROM snapshot WHERE date < ? AND detail = 1")
    .get(askDate) as { d: string | null };
  return prev.d ?? currentDate() ?? null;
}

// ---------- журнал ----------

function insertLog(row: Record<string, any>): number {
  const cols = Object.keys(row);
  const st = D().prepare(
    "INSERT INTO sync_log(" +
      cols.join(", ") +
      ") VALUES(" +
      cols.map(() => "?").join(", ") +
      ")",
  );
  const r = st.run(...cols.map((c) => row[c]));
  return Number(r.lastInsertRowid ?? 0);
}

export function recentLog(limit = 50) {
  return D()
    .prepare("SELECT * FROM sync_log ORDER BY id DESC LIMIT ?")
    .all(Math.min(Math.max(limit, 1), 500));
}

export function logEntry(id: number) {
  return D().prepare("SELECT * FROM sync_log WHERE id = ?").get(id) ?? null;
}

// ---------- основной прогон ----------

export interface RunOptions {
  date?: string;
  mode?: "compare" | "import";
  trigger?: Trigger;
  /** Не писать детальный снимок, только агрегат (догрузка старой истории). */
  aggregateOnly?: boolean;
}

export async function runSync(opts: RunOptions = {}): Promise<SyncResult> {
  const cfg = sourceConfig();
  const askDate = opts.date ?? today();
  const mode = opts.mode ?? cfg.mode;
  const trigger = opts.trigger ?? "manual";
  const startedAt = new Date().toISOString();

  log(`[sync] запрос к 1С за ${askDate} (режим ${mode}, повод ${trigger})`);

  const fetched = await fetchSource(askDate, cfg);
  const base: Record<string, any> = {
    started_at: startedAt,
    finished_at: new Date().toISOString(),
    trigger,
    mode,
    ask_date: askDate,
    url: fetched.url,
    http_status: fetched.httpStatus,
    duration_ms: fetched.durationMs,
    sample: fetched.sample.slice(0, 4000),
  };

  const fail = (message: string): SyncResult => {
    const id = insertLog({ ...base, status: "error", message });
    log(`[sync] ОШИБКА за ${askDate}: ${message}`);
    return {
      id,
      status: "error",
      askDate,
      snapshotDate: null,
      url: fetched.url,
      httpStatus: fetched.httpStatus,
      durationMs: fetched.durationMs,
      rows: 0,
      positions: 0,
      newPositions: [],
      gonePositions: [],
      changedPositions: 0,
      src: { kg: 0, money: 0 },
      dbBefore: { kg: 0, money: 0 },
      message,
      sample: fetched.sample,
    };
  };

  if (!fetched.ok) return fail(fetched.error ?? "запрос не удался");

  let parsed: ParsedSource;
  try {
    parsed = await parseSource(fetched.body, fetched.contentType, askDate);
  } catch (e: any) {
    return fail("разбор ответа: " + (e?.message ?? String(e)));
  }
  if (parsed.rows.length === 0) return fail("источник вернул 0 строк");

  const snapshotDate = parsed.snapshotDate || askDate;
  const src = foldRows(parsed.rows);

  // --- сверка с базой ---
  const baseDate = baselineDate(snapshotDate);
  const known = new Set(
    (D().prepare("SELECT position_id FROM position").all() as { position_id: string }[]).map(
      (r) => r.position_id,
    ),
  );
  const prevKg = new Map<string, number>();
  let dbKg = 0;
  let dbMoney = 0;
  if (baseDate && hasDetail(baseDate)) {
    for (const r of D()
      .prepare("SELECT position_id, kg, money FROM fact WHERE date = ?")
      .all(baseDate) as { position_id: string; kg: number; money: number }[]) {
      prevKg.set(r.position_id, r.kg);
      dbKg += r.kg;
      dbMoney += r.money;
    }
  }

  const newPositions = [...src.byPosition.keys()].filter((p) => !known.has(p));
  const gonePositions = [...prevKg.keys()].filter((p) => !src.byPosition.has(p));
  let changed = 0;
  for (const [pid, kg] of src.byPosition) {
    const before = prevKg.get(pid);
    if (before == null || Math.abs(before - kg) > 0.001) changed++;
  }

  const summary =
    `строк ${parsed.rows.length}, позиций ${src.byPosition.size}, ` +
    `новых ${newPositions.length}, исчезло ${gonePositions.length}, изменилось ${changed}, ` +
    `${round(src.kg, 1)} кг / ${round(src.money)} ₽` +
    (baseDate ? ` (база на ${baseDate}: ${round(dbKg, 1)} кг)` : " (сравнивать не с чем)");

  // --- запись ---
  let status: SyncStatus;
  let message: string;
  if (mode === "import") {
    try {
      if (opts.aggregateOnly) {
        writeAggregateFromRows(snapshotDate, parsed.rows);
        markSnapshot(snapshotDate, "day", "1c", 0);
      } else {
        ingestSnapshot({ snapshotDate, rows: parsed.rows });
        writeAggregate(snapshotDate);
        markSnapshot(snapshotDate, "day", "1c", 1);
        const t = trimDetail(cfg.retentionDays);
        if (t.aggregated.length) {
          log(
            `[sync] сжато в агрегат ${t.aggregated.length} дат старше ${t.cutoff}: ` +
              `-${t.factRowsDeleted} строк fact, -${t.batchRowsDeleted} партий`,
          );
        }
      }
      status = "imported";
      message = "Загружено: " + summary;
    } catch (e: any) {
      return fail("запись снимка: " + (e?.message ?? String(e)));
    }
  } else {
    const identical =
      newPositions.length === 0 && gonePositions.length === 0 && changed === 0 && !!baseDate;
    status = identical ? "ok" : "diff";
    message = (identical ? "Совпадает с базой: " : "Расхождения: ") + summary;
  }

  const id = insertLog({
    ...base,
    finished_at: new Date().toISOString(),
    status,
    rows: parsed.rows.length,
    positions: src.byPosition.size,
    new_positions: newPositions.length,
    gone_positions: gonePositions.length,
    changed_positions: changed,
    src_kg: round(src.kg, 1),
    src_money: round(src.money),
    db_kg: round(dbKg, 1),
    db_money: round(dbMoney),
    message,
  });

  log(`[sync] ${askDate}: ${status} — ${message} (${fetched.durationMs} мс)`);
  if (parsed.diag.unmapped.length) {
    log(`[sync] неиспользованные поля ответа: ${parsed.diag.unmapped.slice(0, 15).join(", ")}`);
  }

  return {
    id,
    status,
    askDate,
    snapshotDate,
    url: fetched.url,
    httpStatus: fetched.httpStatus,
    durationMs: fetched.durationMs,
    rows: parsed.rows.length,
    positions: src.byPosition.size,
    newPositions: newPositions.slice(0, 50),
    gonePositions: gonePositions.slice(0, 50),
    changedPositions: changed,
    src: { kg: round(src.kg, 1), money: round(src.money) },
    dbBefore: { kg: round(dbKg, 1), money: round(dbMoney) },
    message,
    sample: fetched.sample,
    diag: parsed.diag,
  };
}

function markSnapshot(date: string, grain: string, source: string, detail: number): void {
  D()
    .prepare(
      "INSERT INTO snapshot(date, kind, created_at, note, grain, source, detail) " +
        "VALUES(?, 'real', ?, ?, ?, ?, ?) " +
        "ON CONFLICT(date) DO UPDATE SET kind='real', grain=excluded.grain, " +
        "source=excluded.source, detail=excluded.detail, created_at=excluded.created_at",
    )
    .run(date, new Date().toISOString(), "Загрузка из 1С", grain, source, detail);
}

// ---------- догрузка истории по требованию ----------

export interface BackfillResult {
  requested: string[];
  loaded: string[];
  failed: { date: string; error: string }[];
  skipped: string[];
}

/** Список дат в диапазоне с шагом day/week/month (для месяца — последнее число). */
export function datesInRange(from: string, to: string, step: "day" | "week" | "month"): string[] {
  const out: string[] = [];
  if (step === "month") {
    let d = parseYmd(from);
    while (ymd(d) <= to) {
      const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0));
      const s = ymd(last);
      if (s >= from && s <= to) out.push(s);
      d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
    }
    return out;
  }
  const inc = step === "week" ? 7 : 1;
  let cur = from;
  while (cur <= to) {
    out.push(cur);
    cur = addDays(cur, inc);
  }
  return out;
}

/**
 * Догрузить недостающие точки истории из 1С и сохранить их агрегатом.
 * Детализация по партиям за старые даты не хранится — только суммы по дереву.
 */
export async function backfillRange(
  from: string,
  to: string,
  step: "day" | "week" | "month" = "month",
  maxPoints = 60,
): Promise<BackfillResult> {
  const all = datesInRange(from, to, step);
  const have = new Set(
    (
      D()
        .prepare("SELECT DISTINCT date FROM fact_agg WHERE date BETWEEN ? AND ?")
        .all(from, to) as { date: string }[]
    ).map((r) => r.date),
  );
  for (const r of D()
    .prepare("SELECT DISTINCT date FROM fact WHERE date BETWEEN ? AND ?")
    .all(from, to) as { date: string }[]) {
    have.add(r.date);
  }
  const todo = all.filter((d) => !have.has(d)).slice(0, maxPoints);
  const skipped = all.filter((d) => have.has(d));

  log(`[sync] догрузка истории ${from}…${to} шаг ${step}: ${todo.length} точек к загрузке, ${skipped.length} уже есть`);

  const loaded: string[] = [];
  const failed: { date: string; error: string }[] = [];
  for (const date of todo) {
    const r = await runSync({ date, mode: "import", trigger: "backfill", aggregateOnly: true });
    if (r.status === "error") failed.push({ date, error: r.message });
    else loaded.push(date);
    await new Promise((res) => setTimeout(res, 300)); // не бомбить 1С
  }
  return { requested: todo, loaded, failed, skipped };
}

// ---------- расписание ----------

export interface ScheduleState {
  enabled: boolean;
  hour: number;
  mode: "compare" | "import";
  lastRunDate: string | null;
  lastRunAt: string | null;
  lastStatus: string | null;
  nextRunAt: string | null;
  running: boolean;
}

export function scheduleState(): ScheduleState {
  const cfg = sourceConfig();
  const last = D()
    .prepare(
      "SELECT started_at, status, ask_date FROM sync_log WHERE trigger = 'schedule' ORDER BY id DESC LIMIT 1",
    )
    .get() as { started_at: string; status: string; ask_date: string } | undefined;

  const now = new Date();
  const next = new Date(now);
  next.setHours(cfg.hour, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);

  return {
    enabled: cfg.enabled,
    hour: cfg.hour,
    mode: cfg.mode,
    lastRunDate: getSetting("sync_last_date", "") || null,
    lastRunAt: last?.started_at ?? null,
    lastStatus: last?.status ?? null,
    nextRunAt: cfg.enabled ? next.toISOString() : null,
    running,
  };
}

async function tick(): Promise<void> {
  const cfg = sourceConfig();
  if (!cfg.enabled || running) return;
  const t = today();
  if (getSetting("sync_last_date", "") === t) return;
  if (new Date().getHours() < cfg.hour) return;

  running = true;
  try {
    const r = await runSync({ date: t, trigger: "schedule" });
    if (r.status !== "error") setSetting("sync_last_date", t);
  } catch (e: any) {
    log("[sync] непойманная ошибка расписания: " + (e?.message ?? String(e)));
  } finally {
    running = false;
  }
}

/** Запустить ежедневное расписание. Проверка каждые 5 минут, запуск — раз в сутки. */
export function startSync(logger: (m: string) => void): void {
  log = logger;
  const cfg = sourceConfig();
  if (!cfg.enabled) {
    log("[sync] источник 1С выключен в настройках");
    return;
  }
  log(
    `[sync] расписание: 1 раз в сутки после ${String(cfg.hour).padStart(2, "0")}:00, ` +
      `режим ${cfg.mode === "import" ? "загрузка" : "сверка"}, URL ${cfg.url}`,
  );
  setInterval(() => void tick(), 5 * 60_000).unref();
  setTimeout(() => void tick(), 30_000).unref(); // догнать пропущенный запуск после рестарта
}
