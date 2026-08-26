import ExcelJS from "exceljs";
import { ymd } from "../util.js";

export interface RawRow {
  tip: string;
  vid: string;
  name: string;
  series: string;
  kg: number;
  bestBefore: string | null;
  manufactured: string | null;
  manager: string | null;
  counterparty: string | null;
}

export interface ImportResult {
  snapshotDate: string; // YYYY-MM-DD (from the Дата column)
  rows: RawRow[];
}

function text(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number") return String(v);
  if (v instanceof Date) return ymd(v);
  // exceljs rich text / hyperlink / formula objects
  const o = v as any;
  if (typeof o === "object") {
    if (typeof o.text === "string") return o.text.trim();
    if (typeof o.result !== "undefined") return text(o.result);
    if (Array.isArray(o.richText)) return o.richText.map((r: any) => r.text).join("").trim();
  }
  return String(v).trim();
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  const s = text(v).replace(/\s/g, "").replace(",", ".");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}

/** Parse a date cell → YYYY-MM-DD or null. Accepts Date, "dd.mm.yyyy[ hh:mm:ss]", "dd.mm.yy". */
const EXCEL_EPOCH = Date.UTC(1899, 11, 30);
function dateCell(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date) return ymd(v);
  if (typeof v === "number" && v > 20000 && v < 80000) {
    // Excel serial date (days since 1899-12-30)
    return ymd(new Date(EXCEL_EPOCH + Math.round(v) * 86400000));
  }
  const s = text(v);
  if (!s) return null;
  const m = s.match(/^(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
  if (m) {
    let [, dd, mm, yy] = m;
    let year = parseInt(yy, 10);
    if (year < 100) year += 2000;
    const mo = String(parseInt(mm, 10)).padStart(2, "0");
    const da = String(parseInt(dd, 10)).padStart(2, "0");
    return `${year}-${mo}-${da}`;
  }
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/**
 * Read a 1C stock export (.xlsx). Column order (1-indexed):
 * A Дата | B Номенклатура | C ВидНоменклатуры | D ВидНоменклатурыПолный |
 * E ТипНоменклатуры | F Серия | G ОстатокКГ | H СерияГоденДо |
 * I СерияДатаИзготовления | J …Менеджер | K …Заказчик
 */
export async function importExcel(filePath: string): Promise<ImportResult> {
  const wb = new ExcelJS.stream.xlsx.WorkbookReader(filePath, {
    entries: "emit",
    sharedStrings: "cache",
    worksheets: "emit",
  });

  const rows: RawRow[] = [];
  let snapshotDate = "";
  let isHeader = true;

  for await (const worksheet of wb as any) {
    for await (const row of worksheet) {
      const v = row.values as unknown[]; // 1-indexed
      if (isHeader) {
        isHeader = false;
        continue; // skip header row
      }
      const name = text(v[2]);
      const tip = text(v[5]);
      const vid = text(v[3]);
      if (!name && !tip && !vid) continue;

      const d = dateCell(v[1]);
      if (d && !snapshotDate) snapshotDate = d;

      rows.push({
        tip: tip || "Прочее",
        vid: vid || "Прочее",
        name: name || "(без названия)",
        series: text(v[6]),
        kg: num(v[7]),
        bestBefore: dateCell(v[8]),
        manufactured: dateCell(v[9]),
        manager: text(v[10]) || null,
        counterparty: text(v[11]) || null,
      });
    }
    break; // only the first worksheet
  }

  if (!snapshotDate) {
    throw new Error("Не удалось определить дату снимка (колонка «Дата» пуста).");
  }
  return { snapshotDate, rows };
}
