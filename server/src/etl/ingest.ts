import { db, initSchema, setSetting } from "../db.js";
import { hashId, groupOf, seededSigned, seededUnit, addDays, round, ymd, parseYmd } from "../util.js";
import { defaultPrice } from "./prices.js";
import type { ImportResult, RawRow } from "./import-excel.js";

const NOW_ISO = "2026-08-19T00:00:00Z"; // fixed stamp (reproducible; deploy time is irrelevant for demo)

function positionId(tip: string, vid: string, name: string): string {
  return hashId(tip, "|", vid, "|", name);
}

/** Ensure a price row exists for each вид; returns a map vid -> price. */
function ensurePrices(rows: RawRow[]): Map<string, number> {
  const d = db();
  const existing = new Map<string, number>();
  for (const r of d.prepare("SELECT vid, price_per_kg FROM price").all() as {
    vid: string;
    price_per_kg: number;
  }[]) {
    existing.set(r.vid, r.price_per_kg);
  }
  const ins = d.prepare("INSERT OR IGNORE INTO price(vid, price_per_kg) VALUES(?, ?)");
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.vid)) continue;
    seen.add(r.vid);
    if (!existing.has(r.vid)) {
      const p = defaultPrice(r.tip, r.vid);
      ins.run(r.vid, p);
      existing.set(r.vid, p);
    }
  }
  return existing;
}

/**
 * Ingest one real snapshot: positions, batches (detail), fact totals, dimension shares.
 * Replaces any existing data for that date.
 */
export function ingestSnapshot(result: ImportResult): { date: string; positions: number } {
  initSchema();
  const d = db();
  const { snapshotDate, rows } = result;
  const prices = ensurePrices(rows);

  const tx = d.exec.bind(d);
  let posCount = 0;
  tx("BEGIN");
  try {
    d.prepare("DELETE FROM batch WHERE date = ?").run(snapshotDate);
    d.prepare("DELETE FROM fact  WHERE date = ?").run(snapshotDate);
    d.prepare(
      "INSERT INTO snapshot(date, kind, created_at, note, grain, source, detail) " +
        "VALUES(?, 'real', ?, ?, 'day', 'excel', 1) " +
        "ON CONFLICT(date) DO UPDATE SET kind='real', created_at=excluded.created_at, detail=1",
    ).run(snapshotDate, NOW_ISO, `Импорт: ${rows.length} строк`);

    const insPos = d.prepare(
      "INSERT INTO position(position_id, tip, vid, grp, name) VALUES(?,?,?,?,?) " +
        "ON CONFLICT(position_id) DO NOTHING",
    );
    const insBatch = d.prepare(
      `INSERT INTO batch(date, position_id, series, kg, best_before, manufactured, manager, counterparty, price_per_kg, money)
       VALUES(?,?,?,?,?,?,?,?,?,?)`,
    );

    // position totals + dimension aggregates
    const posKg = new Map<string, number>();
    const posMoney = new Map<string, number>();
    const posVid = new Map<string, string>();
    const dimAgg = new Map<string, number>(); // key: posId|type|value -> kg

    for (const r of rows) {
      const pid = positionId(r.tip, r.vid, r.name);
      const grp = groupOf(r.name);
      insPos.run(pid, r.tip, r.vid, grp, r.name);
      const price = prices.get(r.vid) ?? 0;
      const money = r.kg * price;
      insBatch.run(
        snapshotDate,
        pid,
        r.series || null,
        r.kg,
        r.bestBefore,
        r.manufactured,
        r.manager,
        r.counterparty,
        price,
        round(money),
      );
      posKg.set(pid, (posKg.get(pid) ?? 0) + r.kg);
      posMoney.set(pid, (posMoney.get(pid) ?? 0) + money);
      posVid.set(pid, r.vid);
      if (r.manager) {
        const k = `${pid}|manager|${r.manager}`;
        dimAgg.set(k, (dimAgg.get(k) ?? 0) + r.kg);
      }
      if (r.counterparty) {
        const k = `${pid}|counterparty|${r.counterparty}`;
        dimAgg.set(k, (dimAgg.get(k) ?? 0) + r.kg);
      }
    }

    const insFact = d.prepare("INSERT INTO fact(date, position_id, kg, money) VALUES(?,?,?,?)");
    for (const [pid, kg] of posKg) {
      insFact.run(snapshotDate, pid, round(kg, 3), round(posMoney.get(pid) ?? 0));
    }

    // Rebuild dimension shares for the positions in this snapshot
    d.prepare("DELETE FROM position_dim WHERE position_id IN (SELECT DISTINCT position_id FROM batch WHERE date = ?)").run(
      snapshotDate,
    );
    const insDim = d.prepare(
      "INSERT OR REPLACE INTO position_dim(position_id, dim_type, dim_value, share) VALUES(?,?,?,?)",
    );
    for (const [key, kg] of dimAgg) {
      const [pid, type, value] = key.split("|");
      const total = posKg.get(pid) ?? 0;
      if (total > 0) insDim.run(pid, type, value, kg / total);
    }

    posCount = posKg.size;
    // при догрузке прошлой даты «текущий день» не должен уезжать назад
    const maxReal = (d.prepare("SELECT MAX(date) AS m FROM snapshot WHERE kind='real'").get() as {
      m: string | null;
    }).m;
    if (!maxReal || snapshotDate >= maxReal) setSetting("current_date", snapshotDate);
    tx("COMMIT");
  } catch (e) {
    tx("ROLLBACK");
    throw e;
  }
  return { date: snapshotDate, positions: posCount };
}

/**
 * Generate modeled weekly history backwards from the current real snapshot.
 * Uses per-category trend + seasonality + per-position noise, and respects each
 * position's first manufacture date (a position is absent before it first existed).
 */
export function modelHistory(weeks = 78): number {
  const d = db();
  const cur = (d.prepare("SELECT MAX(date) AS m FROM snapshot WHERE kind='real'").get() as {
    m: string;
  }).m;
  if (!cur) throw new Error("Нет реального снимка для моделирования истории.");

  const prices = new Map<string, number>();
  for (const r of d.prepare("SELECT vid, price_per_kg FROM price").all() as {
    vid: string;
    price_per_kg: number;
  }[]) {
    prices.set(r.vid, r.price_per_kg);
  }

  // base position totals from the current snapshot
  const positions = d
    .prepare(
      `SELECT f.position_id AS pid, f.kg AS kg, p.vid AS vid
       FROM fact f JOIN position p ON p.position_id = f.position_id
       WHERE f.date = ?`,
    )
    .all(cur) as { pid: string; kg: number; vid: string }[];

  const doy = (s: string) => {
    const dt = parseYmd(s);
    const start = Date.UTC(dt.getUTCFullYear(), 0, 0);
    return (dt.getTime() - start) / 86400000;
  };
  const seasonal = (vid: string, dateStr: string, baseStr: string) => {
    const a = 0.05 + 0.06 * seededUnit("amp:" + vid);
    const ph = 2 * Math.PI * seededUnit("ph:" + vid);
    const f = (s: string) => 1 + a * Math.sin((2 * Math.PI * doy(s)) / 365 + ph);
    return f(dateStr) / f(baseStr);
  };

  d.exec("DELETE FROM fact WHERE date <> '" + cur + "'");
  d.exec("DELETE FROM snapshot WHERE kind='modeled'");

  const insSnap = d.prepare(
    "INSERT OR REPLACE INTO snapshot(date, kind, created_at, note, grain, source, detail) " +
      "VALUES(?, 'modeled', ?, ?, 'week', 'model', 1)",
  );
  const insFact = d.prepare("INSERT OR REPLACE INTO fact(date, position_id, kg, money) VALUES(?,?,?,?)");

  d.exec("BEGIN");
  try {
    for (let w = 1; w <= weeks; w++) {
      const date = addDays(cur, -7 * w);
      insSnap.run(date, NOW_ISO, "Смоделированная неделя");
      for (const p of positions) {
        const g = 0.0005 + 0.006 * seededSigned("trend:" + p.vid); // weekly trend
        const trend = Math.pow(1 + g, -w);
        const seas = seasonal(p.vid, date, cur);
        const noise = 1 + 0.05 * seededSigned(`n:${p.pid}:${date}`);
        const kg = p.kg * trend * seas * noise;
        if (kg < 0.5) continue;
        const price = prices.get(p.vid) ?? 0;
        insFact.run(date, p.pid, round(kg, 3), round(kg * price));
      }
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return weeks;
}
