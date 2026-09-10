/**
 * Источник данных 1С — HTTP-сервис вида
 *   http://192.168.0.49/erp-work/hs/1c_II?date=01.09.2026
 *
 * Формат ответа заранее неизвестен, поэтому парсер терпимый: понимает JSON
 * (массив объектов или {data:[...]}), xlsx-вложение и CSV/TSV. Колонки
 * сопоставляются по нормализованным именам, а не по порядку.
 *
 * Любой ответ, который не удалось разобрать, попадает в журнал вместе с
 * началом сырого тела (`sample`) — по нему настраивается сопоставление.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getSetting, setSetting } from "./db.js";
import {
  importExcel,
  dateCell,
  num,
  text,
  type RawRow,
  type ImportResult,
} from "./etl/import-excel.js";

export interface SourceConfig {
  url: string;
  login: string;
  password: string;
  enabled: boolean;
  mode: "compare" | "import";
  hour: number; // час суток (0..23) ежедневного запроса, локальное время сервера
  timeoutSec: number;
  retentionDays: number; // сколько дней держать детальный fact локально
}

export const SOURCE_DEFAULT_URL = "http://192.168.0.49/erp-work/hs/1c_II?date={date}";

export function sourceConfig(): SourceConfig {
  return {
    url: getSetting("source_url", process.env.SOURCE_URL || SOURCE_DEFAULT_URL),
    login: getSetting("source_login", process.env.SOURCE_LOGIN || ""),
    password: getSetting("source_password", process.env.SOURCE_PASSWORD || ""),
    enabled: getSetting("source_enabled", "1") !== "0",
    mode: getSetting("source_mode", "import") === "compare" ? "compare" : "import",
    hour: clampInt(getSetting("source_hour", "6"), 0, 23, 6),
    timeoutSec: clampInt(getSetting("source_timeout_sec", "120"), 5, 900, 120),
    retentionDays: clampInt(getSetting("source_retention_days", "120"), 7, 3650, 120),
  };
}

export function saveSourceConfig(p: Partial<SourceConfig>): void {
  if (p.url != null) setSetting("source_url", String(p.url).trim());
  if (p.login != null) setSetting("source_login", String(p.login));
  if (p.password != null) setSetting("source_password", String(p.password));
  if (p.enabled != null) setSetting("source_enabled", p.enabled ? "1" : "0");
  if (p.mode != null) setSetting("source_mode", p.mode === "compare" ? "compare" : "import");
  if (p.hour != null) setSetting("source_hour", String(clampInt(p.hour, 0, 23, 6)));
  if (p.timeoutSec != null)
    setSetting("source_timeout_sec", String(clampInt(p.timeoutSec, 5, 900, 120)));
  if (p.retentionDays != null)
    setSetting("source_retention_days", String(clampInt(p.retentionDays, 7, 3650, 120)));
}

function clampInt(v: unknown, min: number, max: number, dflt: number): number {
  const n = parseInt(String(v), 10);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(max, Math.max(min, n));
}

/** YYYY-MM-DD -> DD.MM.YYYY (формат, который ждёт HTTP-сервис 1С). */
export function ruDate(ymdStr: string): string {
  const [y, m, d] = ymdStr.split("-");
  return d + "." + m + "." + y;
}

/**
 * Подставить дату в шаблон URL. Поддерживаются:
 *   ...?date={date}      — плейсхолдер (рекомендуется)
 *   ...?date=01.09.2026  — существующее значение заменяется
 *   ...\/1c_II           — параметр date добавляется
 */
export function buildUrl(template: string, ymdStr: string): string {
  const ru = ruDate(ymdStr);
  const t = template.trim();
  if (t.includes("{date}")) return t.replace(/\{date\}/g, ru);
  if (/[?&]date=/.test(t)) return t.replace(/([?&]date=)[^&]*/, "$1" + ru);
  return t + (t.includes("?") ? "&" : "?") + "date=" + ru;
}

export interface FetchResult {
  url: string;
  ok: boolean;
  httpStatus: number;
  contentType: string;
  durationMs: number;
  bytes: number;
  body: Buffer;
  sample: string; // первые ~2 КБ в читаемом виде
  error?: string;
}

/** Декодировать тело: UTF-8, при явной кракозябре — windows-1251. */
export function decodeBody(buf: Buffer, contentType: string): string {
  const declared = /charset=([\w-]+)/i.exec(contentType)?.[1]?.toLowerCase();
  const tryDecode = (enc: string) => {
    try {
      return new TextDecoder(enc as any).decode(buf);
    } catch {
      return null;
    }
  };
  if (declared && declared !== "utf-8" && declared !== "utf8") {
    const s = tryDecode(declared);
    if (s) return s;
  }
  const utf = buf.toString("utf8");
  const bad = (utf.match(/�/g) ?? []).length;
  if (bad > 3) {
    const s = tryDecode("windows-1251");
    if (s) return s;
  }
  return utf;
}

export async function fetchSource(ymdStr: string, cfg = sourceConfig()): Promise<FetchResult> {
  const url = buildUrl(cfg.url, ymdStr);
  const started = Date.now();
  const headers: Record<string, string> = { Accept: "application/json, text/csv, */*" };
  if (cfg.login) {
    headers.Authorization =
      "Basic " + Buffer.from(cfg.login + ":" + cfg.password, "utf8").toString("base64");
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutSec * 1000);
  try {
    const res = await fetch(url, { headers, signal: ac.signal, redirect: "follow" });
    const body = Buffer.from(await res.arrayBuffer());
    const contentType = res.headers.get("content-type") ?? "";
    return {
      url,
      ok: res.ok,
      httpStatus: res.status,
      contentType,
      durationMs: Date.now() - started,
      bytes: body.length,
      body,
      sample: sampleOf(body, contentType),
      error: res.ok ? undefined : "HTTP " + res.status + " " + res.statusText,
    };
  } catch (e: any) {
    const msg =
      e?.name === "AbortError" ? "таймаут " + cfg.timeoutSec + " с" : e?.message ?? String(e);
    return {
      url,
      ok: false,
      httpStatus: 0,
      contentType: "",
      durationMs: Date.now() - started,
      bytes: 0,
      body: Buffer.alloc(0),
      sample: "",
      error: msg,
    };
  } finally {
    clearTimeout(timer);
  }
}

function sampleOf(buf: Buffer, contentType: string, limit = 2048): string {
  if (buf.length === 0) return "";
  if (buf[0] === 0x50 && buf[1] === 0x4b) return "<binary xlsx/zip, " + buf.length + " байт>";
  return decodeBody(buf.subarray(0, limit), contentType);
}

// ---------- сопоставление колонок ----------

/** Нормализация имени колонки: только буквы и цифры, нижний регистр. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-zа-яё0-9]/gi, "");
}

type Field =
  | "date"
  | "tip"
  | "vid"
  | "name"
  | "series"
  | "kg"
  | "bestBefore"
  | "manufactured"
  | "manager"
  | "counterparty";

/** Алиасы проверяются по точному совпадению нормализованного имени, сверху вниз. */
const ALIASES: Record<Field, string[]> = {
  date: ["дата", "date", "датаостатка", "периоддата", "надату"],
  name: ["номенклатура", "name", "наименование", "позиция", "nomenclature"],
  vid: ["видноменклатуры", "вид", "vid", "видномен"],
  tip: ["типноменклатуры", "тип", "tip", "типномен"],
  series: ["серия", "series", "партия"],
  kg: ["остатоккг", "остаток", "кг", "количество", "колво", "kg", "qty", "quantity", "ostatok"],
  bestBefore: ["сериягоденддо", "сериягодендо", "годендо", "срокгодности", "bestbefore", "godendo"],
  manufactured: [
    "сериядатаизготовления",
    "датаизготовления",
    "изготовлено",
    "manufactured",
    "dateofmanufacture",
  ],
  manager: ["менеджер", "manager", "серияменеджер", "ответственный"],
  counterparty: ["заказчик", "контрагент", "counterparty", "сериязаказчик", "client"],
};

/** Найти исходный ключ, соответствующий полю: точное совпадение, затем префикс. */
function pick(keys: Map<string, string>, field: Field): string | undefined {
  for (const alias of ALIASES[field]) {
    const hit = keys.get(alias);
    if (hit) return hit;
  }
  for (const alias of ALIASES[field]) {
    for (const [n, orig] of keys) if (n.startsWith(alias)) return orig;
  }
  return undefined;
}

export interface ParseDiag {
  format: "json" | "csv" | "xlsx" | "unknown";
  mappedColumns: Partial<Record<Field, string>>;
  unmapped: string[];
  skipped: number;
}

export interface ParsedSource extends ImportResult {
  diag: ParseDiag;
}

/** Разобрать ответ источника в набор строк того же вида, что даёт Excel-импорт. */
export async function parseSource(
  body: Buffer,
  contentType: string,
  askDate: string,
): Promise<ParsedSource> {
  if (body.length === 0) throw new Error("Пустой ответ источника");

  if (body[0] === 0x50 && body[1] === 0x4b) {
    const tmp = path.join(os.tmpdir(), "1c-" + Date.now() + ".xlsx");
    fs.writeFileSync(tmp, body);
    try {
      const res = await importExcel(tmp);
      return { ...res, diag: { format: "xlsx", mappedColumns: {}, unmapped: [], skipped: 0 } };
    } finally {
      try {
        fs.unlinkSync(tmp);
      } catch {}
    }
  }

  const raw = decodeBody(body, contentType).replace(/^﻿/, "").trim();
  if (!raw) throw new Error("Пустой ответ источника");

  if (raw.startsWith("[") || raw.startsWith("{")) return parseJson(raw, askDate);
  return parseDelimited(raw, askDate);
}

function rowsFromJson(parsed: any): any[] {
  if (Array.isArray(parsed)) return parsed;
  for (const key of ["data", "rows", "items", "Остатки", "Данные", "result", "Result"]) {
    if (Array.isArray(parsed?.[key])) return parsed[key];
  }
  const arrays = Object.values(parsed ?? {}).filter(Array.isArray) as any[][];
  if (arrays.length === 1) return arrays[0];
  throw new Error(
    "JSON без массива строк. Верхний уровень: " +
      Object.keys(parsed ?? {}).slice(0, 12).join(", "),
  );
}

function parseJson(raw: string, askDate: string): ParsedSource {
  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch (e: any) {
    throw new Error("Некорректный JSON: " + e.message);
  }
  const arr = rowsFromJson(parsed);
  if (arr.length === 0) {
    return {
      snapshotDate: askDate,
      rows: [],
      diag: { format: "json", mappedColumns: {}, unmapped: [], skipped: 0 },
    };
  }
  const keys = new Map<string, string>();
  for (const k of Object.keys(arr[0])) keys.set(norm(k), k);
  const col = {} as Record<Field, string | undefined>;
  for (const f of Object.keys(ALIASES) as Field[]) col[f] = pick(keys, f);

  if (!col.name) {
    throw new Error(
      "Не найдена колонка номенклатуры. Поля ответа: " +
        [...keys.values()].slice(0, 20).join(", "),
    );
  }

  const rows: RawRow[] = [];
  let snapshotDate = "";
  let skipped = 0;
  for (const o of arr) {
    const name = text(col.name ? o[col.name] : "");
    const tip = text(col.tip ? o[col.tip] : "");
    const vid = text(col.vid ? o[col.vid] : "");
    if (!name && !tip && !vid) {
      skipped++;
      continue;
    }
    const d = col.date ? dateCell(o[col.date]) : null;
    if (d && !snapshotDate) snapshotDate = d;
    rows.push({
      tip: tip || "Прочее",
      vid: vid || "Прочее",
      name: name || "(без названия)",
      series: col.series ? text(o[col.series]) : "",
      kg: col.kg ? num(o[col.kg]) : 0,
      bestBefore: col.bestBefore ? dateCell(o[col.bestBefore]) : null,
      manufactured: col.manufactured ? dateCell(o[col.manufactured]) : null,
      manager: (col.manager ? text(o[col.manager]) : "") || null,
      counterparty: (col.counterparty ? text(o[col.counterparty]) : "") || null,
    });
  }
  const mapped = Object.values(col).filter(Boolean) as string[];
  return {
    snapshotDate: snapshotDate || askDate,
    rows,
    diag: {
      format: "json",
      mappedColumns: col as Partial<Record<Field, string>>,
      unmapped: [...keys.values()].filter((k) => !mapped.includes(k)),
      skipped,
    },
  };
}

function parseDelimited(raw: string, askDate: string): ParsedSource {
  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== "");
  if (lines.length < 2)
    throw new Error("Ответ не похож ни на JSON, ни на таблицу: " + raw.slice(0, 200));
  const delim = [";", "\t", ","].sort(
    (a, b) => lines[0].split(b).length - lines[0].split(a).length,
  )[0];
  const split = (l: string) => l.split(delim).map((c) => c.trim().replace(/^"|"$/g, ""));

  const header = split(lines[0]);
  const keys = new Map<string, string>();
  header.forEach((h) => keys.set(norm(h), h));
  const col = {} as Record<Field, string | undefined>;
  for (const f of Object.keys(ALIASES) as Field[]) col[f] = pick(keys, f);
  if (!col.name)
    throw new Error("Не найдена колонка номенклатуры. Заголовок: " + header.join(" | "));
  const at = (cells: string[], f: Field) => {
    const i = col[f] ? header.indexOf(col[f]!) : -1;
    return i >= 0 ? cells[i] ?? "" : "";
  };

  const rows: RawRow[] = [];
  let snapshotDate = "";
  let skipped = 0;
  for (const line of lines.slice(1)) {
    const cells = split(line);
    const name = at(cells, "name");
    const tip = at(cells, "tip");
    const vid = at(cells, "vid");
    if (!name && !tip && !vid) {
      skipped++;
      continue;
    }
    const d = dateCell(at(cells, "date"));
    if (d && !snapshotDate) snapshotDate = d;
    rows.push({
      tip: tip || "Прочее",
      vid: vid || "Прочее",
      name: name || "(без названия)",
      series: at(cells, "series"),
      kg: num(at(cells, "kg")),
      bestBefore: dateCell(at(cells, "bestBefore")),
      manufactured: dateCell(at(cells, "manufactured")),
      manager: at(cells, "manager") || null,
      counterparty: at(cells, "counterparty") || null,
    });
  }
  const mapped = Object.values(col).filter(Boolean) as string[];
  return {
    snapshotDate: snapshotDate || askDate,
    rows,
    diag: {
      format: "csv",
      mappedColumns: col as Partial<Record<Field, string>>,
      unmapped: header.filter((h) => !mapped.includes(h)),
      skipped,
    },
  };
}
