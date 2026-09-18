import { db, currentDate } from "./db.js";
import { round, monthKey } from "./util.js";
import { prevDate, priorDates, expiryBuckets } from "./analytics.js";
import {
  aggAt,
  totalAt as aggTotalAt,
  scopeTotalAt,
  childBreakdownAt,
  hasDetail,
  seriesFor,
  type KM,
} from "./history.js";

const D = () => db();

const ZERO: KM = { kg: 0, money: 0 };

function delta(cur: number, base: number) {
  return { abs: round(cur - base), pct: base ? round(((cur - base) / base) * 100, 1) : 0 };
}

type Level = "tip" | "vid";

function avgMaps(dates: string[], col: Level): Map<string, KM> {
  const acc = new Map<string, KM>();
  for (const dt of dates) {
    for (const [k, v] of aggAt(dt, col)) {
      const cur = acc.get(k) ?? { kg: 0, money: 0 };
      acc.set(k, { kg: cur.kg + v.kg, money: cur.money + v.money });
    }
  }
  const n = Math.max(dates.length, 1);
  for (const [k, v] of acc) acc.set(k, { kg: v.kg / n, money: v.money / n });
  return acc;
}

function node(key: string, label: string, cur: KM, prev: KM, avg: KM) {
  return {
    key,
    label,
    kg: round(cur.kg, 1),
    money: round(cur.money),
    prevKg: round(prev.kg, 1),
    prevMoney: round(prev.money),
    avgMoney: round(avg.money),
    vsPrev: { kg: delta(cur.kg, prev.kg), money: delta(cur.money, prev.money) },
    vsAvg: { kg: delta(cur.kg, avg.kg), money: delta(cur.money, avg.money) },
  };
}

/** Shared comparison builder: totals + tip→vid breakdown + top movers. */
function buildComparison(targetDate: string, prevD: string | null, avgDates: string[]) {
  // totals (агрегат: работает и за даты, у которых деталь уже сжата)
  const totAt = (dt: string) => aggTotalAt(dt);
  const cur = totAt(targetDate);
  const prev = prevD ? totAt(prevD) : ZERO;
  const avg =
    avgDates.length > 0
      ? avgDates.reduce((a, dt) => {
          const t = totAt(dt);
          return { kg: a.kg + t.kg, money: a.money + t.money };
        }, ZERO)
      : cur;
  const avgT: KM = { kg: avg.kg / Math.max(avgDates.length, 1), money: avg.money / Math.max(avgDates.length, 1) };

  const tipCur = aggAt(targetDate, "tip");
  const tipPrev = prevD ? aggAt(prevD, "tip") : new Map<string, KM>();
  const tipAvg = avgMaps(avgDates.length ? avgDates : [targetDate], "tip");

  const vidCur = aggAt(targetDate, "vid");
  const vidPrev = prevD ? aggAt(prevD, "vid") : new Map<string, KM>();
  const vidAvg = avgMaps(avgDates.length ? avgDates : [targetDate], "vid");

  const tips = [...tipCur.entries()]
    .sort((a, b) => b[1].money - a[1].money)
    .map(([tip, c]) => {
      const vids = [...vidCur.entries()]
        .filter(([k]) => k.startsWith(tip + "¦"))
        .sort((a, b) => b[1].money - a[1].money)
        .map(([k, vc]) =>
          node(
            k.split("¦")[1],
            k.split("¦")[1],
            vc,
            vidPrev.get(k) ?? ZERO,
            vidAvg.get(k) ?? ZERO,
          ),
        );
      return { ...node(tip, tip, c, tipPrev.get(tip) ?? ZERO, tipAvg.get(tip) ?? ZERO), vids };
    });

  // top movers by money vs prev
  let movers: any[] = [];
  if (prevD && hasDetail(targetDate) && hasDetail(prevD)) {
    movers = D()
      .prepare(
        `SELECT p.name, p.tip, p.vid,
                c.kg curKg, c.money curMoney,
                COALESCE(pr.kg,0) prevKg, COALESCE(pr.money,0) prevMoney,
                (c.money - COALESCE(pr.money,0)) diff
         FROM fact c
         JOIN position p ON p.position_id=c.position_id
         LEFT JOIN fact pr ON pr.position_id=c.position_id AND pr.date=@prev
         WHERE c.date=@cur
         ORDER BY ABS(c.money - COALESCE(pr.money,0)) DESC LIMIT 12`,
      )
      .all({ cur: targetDate, prev: prevD }) as any[];
  }
  const shape = (m: any) => ({
    name: m.name,
    tip: m.tip,
    vid: m.vid,
    curMoney: round(m.curMoney),
    prevMoney: round(m.prevMoney),
    curKg: round(m.curKg, 1),
    prevKg: round(m.prevKg, 1),
    diff: round(m.diff),
    diffPct: m.prevMoney ? round((m.diff / m.prevMoney) * 100, 1) : 100,
  });
  const grew = movers.filter((m) => m.diff > 0).slice(0, 6).map(shape);
  const fell = movers
    .filter((m) => m.diff < 0)
    .sort((a, b) => a.diff - b.diff)
    .slice(0, 6)
    .map(shape);

  return {
    totals: {
      kg: round(cur.kg, 1),
      money: round(cur.money),
      prevKg: round(prev.kg, 1),
      prevMoney: round(prev.money),
      avgKg: round(avgT.kg, 1),
      avgMoney: round(avgT.money),
      vsPrev: { kg: delta(cur.kg, prev.kg), money: delta(cur.money, prev.money) },
      vsAvg: { kg: delta(cur.kg, avgT.kg), money: delta(cur.money, avgT.money) },
    },
    tips,
    movers: { grew, fell },
  };
}

export function weeklyReport(date?: string) {
  const target = date ?? currentDate();
  const prev = prevDate(target);
  const avgDates = priorDates(target, 8);
  return {
    kind: "weekly" as const,
    date: target,
    prevDate: prev,
    avgWeeks: avgDates.length,
    ...buildComparison(target, prev, avgDates),
  };
}

/** Map YYYY-MM -> last snapshot date within that month. */
export function monthEnds(): { month: string; date: string }[] {
  const rows = D()
    .prepare("SELECT substr(date,1,7) m, MAX(date) d FROM fact_agg GROUP BY m ORDER BY m")
    .all() as { m: string; d: string }[];
  return rows.map((r) => ({ month: r.m, date: r.d }));
}

export function monthlyReport(month?: string) {
  const ends = monthEnds();
  const idx = month ? ends.findIndex((e) => e.month === month) : ends.length - 1;
  const cur = ends[idx];
  if (!cur) throw new Error("Нет данных за месяц");
  const prev = ends[idx - 1] ?? null;
  const avgDates = ends.slice(Math.max(0, idx - 3), idx).map((e) => e.date);
  return {
    kind: "monthly" as const,
    month: cur.month,
    date: cur.date,
    prevMonth: prev?.month ?? null,
    prevDate: prev?.date ?? null,
    avgMonths: avgDates.length,
    ...buildComparison(cur.date, prev?.date ?? null, avgDates),
  };
}

// ---------- SCOPE (drill-down) REPORT ----------

export interface ScopeSel {
  tip?: string;
  vid?: string;
  grp?: string;
}

/** Child grouping column + level for a scope in the tree Тип→Группа→Позиция. */
function reportChild(s: ScopeSel): { col: string; level: string; label: string } | null {
  if (!s.tip) return { col: "p.tip", level: "tip", label: "Тип номенклатуры" };
  if (!s.grp) return { col: "p.grp", level: "grp", label: "Группа" };
  return { col: "p.name", level: "position", label: "Позиция" };
}

function scopeWhere(s: ScopeSel): { clause: string; bind: Record<string, any> } {
  const parts: string[] = [];
  const bind: Record<string, any> = {};
  if (s.tip) { parts.push("p.tip=@tip"); bind.tip = s.tip; }
  if (s.vid) { parts.push("p.vid=@vid"); bind.vid = s.vid; }
  if (s.grp) { parts.push("p.grp=@grp"); bind.grp = s.grp; }
  return { clause: parts.length ? parts.join(" AND ") : "1=1", bind };
}

/**
 * Universal report for any node of the tree (root = whole warehouse):
 * totals vs prev & avg period, breakdown by immediate children, full-history
 * trend (all snapshots for the chosen granularity), and top movers within scope.
 */
export function scopeReport(scope: ScopeSel, kind: "weekly" | "monthly", period?: string) {
  const { clause, bind } = scopeWhere(scope);

  // period axis
  const weekly = kind === "weekly";
  const dateList = weekly
    ? (D().prepare("SELECT DISTINCT date FROM fact_agg ORDER BY date").all() as { date: string }[]).map(
        (r) => r.date,
      )
    : monthEnds().map((e) => e.date);
  const months = weekly ? [] : monthEnds();

  let idx = period
    ? weekly
      ? dateList.indexOf(period)
      : months.findIndex((m) => m.month === period)
    : dateList.length - 1;
  if (idx < 0) idx = dateList.length - 1;
  const target = dateList[idx];
  const prev = idx > 0 ? dateList[idx - 1] : null;
  const nAvg = weekly ? 8 : 3;
  const avgDates = dateList.slice(Math.max(0, idx - nAvg), idx);

  const totalAt = (date: string): KM => scopeTotalAt(date, scope);

  const cur = totalAt(target);
  const prevT = prev ? totalAt(prev) : ZERO;
  const avgT: KM = avgDates.length
    ? (() => {
        const s = avgDates.reduce((a, dt) => { const t = totalAt(dt); return { money: a.money + t.money, kg: a.kg + t.kg }; }, ZERO);
        return { money: s.money / avgDates.length, kg: s.kg / avgDates.length };
      })()
    : cur;

  // children breakdown (агрегат; уровень позиций доступен только в горячем окне)
  const child = reportChild(scope);
  const groupedAt = (date: string) => childBreakdownAt(date, scope);
  const cCur = groupedAt(target);
  const cPrev = prev ? groupedAt(prev) : new Map<string, KM>();
  const cAvgAcc = new Map<string, KM>();
  for (const dt of avgDates) for (const [k, v] of groupedAt(dt)) {
    const a = cAvgAcc.get(k) ?? { money: 0, kg: 0 };
    cAvgAcc.set(k, { money: a.money + v.money, kg: a.kg + v.kg });
  }
  const children = [...cCur.entries()]
    .sort((a, b) => b[1].money - a[1].money)
    .map(([key, c]) => {
      const p = cPrev.get(key) ?? ZERO;
      const av = cAvgAcc.get(key);
      const avg: KM = av ? { money: av.money / Math.max(avgDates.length, 1), kg: av.kg / Math.max(avgDates.length, 1) } : ZERO;
      return {
        key,
        label: key,
        level: child!.level,
        money: round(c.money),
        kg: round(c.kg, 1),
        prevMoney: round(p.money),
        avgMoney: round(avg.money),
        vsPrev: { money: delta(c.money, p.money), kg: delta(c.kg, p.kg) },
        vsAvg: { money: delta(c.money, avg.money), kg: delta(c.kg, avg.kg) },
        sharePct: round((c.money / (cur.money || 1)) * 100, 1),
        hasChildren: child!.level !== "position",
      };
    });

  // full history for this scope (all points of the chosen granularity)
  const hist = new Map(seriesFor(scope).map((r) => [r.date, r]));
  const history = dateList.map((date) => {
    const t = hist.get(date) ?? { money: 0, kg: 0 };
    return {
      date,
      month: weekly ? undefined : months.find((m) => m.date === date)?.month,
      money: round(t.money),
      kg: round(t.kg, 1),
    };
  });

  // movers within scope (positions), target vs prev
  let movers: any = { grew: [], fell: [] };
  if (prev && hasDetail(target) && hasDetail(prev)) {
    const rows = D().prepare(
      `SELECT p.name, p.tip, p.vid,
              c.money curMoney, c.kg curKg, COALESCE(pr.money,0) prevMoney, COALESCE(pr.kg,0) prevKg,
              (c.money - COALESCE(pr.money,0)) diff
       FROM fact c JOIN position p ON p.position_id=c.position_id
       LEFT JOIN fact pr ON pr.position_id=c.position_id AND pr.date=@prev
       WHERE c.date=@cur AND ${clause}
       ORDER BY ABS(c.money - COALESCE(pr.money,0)) DESC LIMIT 12`,
    ).all({ cur: target, prev, ...bind }) as any[];
    const shape = (m: any) => ({
      name: m.name, tip: m.tip, vid: m.vid,
      curMoney: round(m.curMoney), prevMoney: round(m.prevMoney),
      curKg: round(m.curKg, 1), diff: round(m.diff),
      diffPct: m.prevMoney ? round((m.diff / m.prevMoney) * 100, 1) : 100,
    });
    movers.grew = rows.filter((m) => m.diff > 0).slice(0, 6).map(shape);
    movers.fell = rows.filter((m) => m.diff < 0).sort((a, b) => a.diff - b.diff).slice(0, 6).map(shape);
  }

  const label = scope.grp ?? scope.vid ?? scope.tip ?? "Все запасы";
  return {
    kind,
    scope,
    label,
    childLabel: child?.label ?? null,
    target,
    targetMonth: weekly ? undefined : months[idx]?.month,
    prevDate: prev,
    avgCount: avgDates.length,
    totals: {
      money: round(cur.money), kg: round(cur.kg, 1),
      prevMoney: round(prevT.money), avgMoney: round(avgT.money),
      vsPrev: { money: delta(cur.money, prevT.money), kg: delta(cur.kg, prevT.kg) },
      vsAvg: { money: delta(cur.money, avgT.money), kg: delta(cur.kg, avgT.kg) },
    },
    children,
    history,
    movers,
  };
}

// ---------- ОТЧЁТ ПО СРОКАМ ГОДНОСТИ ----------

export type ExpiryBucketKey = "overdue" | "d30" | "d60" | "d90" | "ok" | "no_date";

export interface ExpiryParams {
  tip?: string;
  bucket?: ExpiryBucketKey;
  /** Показывать только партии, у которых срок истекает не позже чем через N дней. */
  withinDays?: number;
  limit?: number;
}

/**
 * Детализация сроков годности по номенклатуре: партии текущего снимка,
 * сгруппированные в позиции, отсортированные по сроку «кто горит первым».
 *
 * Считается по таблице партий — она хранится только за текущий снимок,
 * поэтому отчёт всегда про «сейчас на складе».
 */
export function expiryReport(p: ExpiryParams = {}) {
  const cur = currentDate();
  const limit = Math.min(Math.max(p.limit ?? 300, 1), 2000);

  const where: string[] = ["b.date = @cur"];
  const bind: Record<string, any> = { cur, limit };
  if (p.tip) {
    where.push("pos.tip = @tip");
    bind.tip = p.tip;
  }
  if (p.bucket) {
    where.push(BUCKET_SQL[p.bucket]);
  }
  if (p.withinDays != null && Number.isFinite(p.withinDays)) {
    where.push(
      "b.best_before IS NOT NULL AND julianday(b.best_before) - julianday(@cur) <= @within",
    );
    bind.within = p.withinDays;
  }
  const clause = where.join(" AND ");

  const positions = D()
    .prepare(
      `SELECT pos.position_id AS id, pos.name, pos.tip, pos.vid, pos.grp,
              SUM(b.kg) kg, SUM(b.money) money, COUNT(*) batches,
              MIN(b.best_before) AS nearest,
              CAST(MIN(julianday(b.best_before)) - julianday(@cur) AS INTEGER) AS daysLeft,
              SUM(CASE WHEN b.best_before IS NOT NULL AND b.best_before < @cur THEN b.kg ELSE 0 END) overdueKg,
              SUM(CASE WHEN b.best_before IS NULL THEN b.kg ELSE 0 END) noDateKg
       FROM batch b JOIN position pos ON pos.position_id = b.position_id
       WHERE ${clause}
       GROUP BY pos.position_id
       ORDER BY (MIN(b.best_before) IS NULL), MIN(b.best_before) ASC, money DESC
       LIMIT @limit`,
    )
    .all(bind) as any[];

  const ids = positions.map((r) => r.id);
  const byPosition = new Map<string, any[]>();
  if (ids.length) {
    const ph = ids.map(() => "?").join(",");
    for (const b of D()
      .prepare(
        `SELECT position_id, series, kg, money, best_before, manufactured, manager, counterparty,
                CAST(julianday(best_before) - julianday(?) AS INTEGER) AS daysLeft
         FROM batch WHERE date = ? AND position_id IN (${ph})
         ORDER BY (best_before IS NULL), best_before ASC`,
      )
      .all(cur, cur, ...ids) as any[]) {
      const arr = byPosition.get(b.position_id) ?? [];
      arr.push({
        series: b.series,
        kg: round(b.kg, 3),
        money: round(b.money),
        bestBefore: b.best_before,
        manufactured: b.manufactured,
        manager: b.manager,
        counterparty: b.counterparty,
        daysLeft: b.best_before ? b.daysLeft : null,
        bucket: bucketOf(b.best_before, b.daysLeft),
      });
      byPosition.set(b.position_id, arr);
    }
  }

  const totals = positions.reduce(
    (a, r) => ({
      kg: a.kg + r.kg,
      money: a.money + r.money,
      batches: a.batches + r.batches,
      overdueKg: a.overdueKg + r.overdueKg,
    }),
    { kg: 0, money: 0, batches: 0, overdueKg: 0 },
  );

  return {
    date: cur,
    filter: { tip: p.tip ?? null, bucket: p.bucket ?? null, withinDays: p.withinDays ?? null },
    buckets: expiryBuckets(p.tip ? { tip: p.tip } : {}),
    tips: (
      D().prepare("SELECT DISTINCT tip FROM position ORDER BY tip").all() as { tip: string }[]
    ).map((r) => r.tip),
    totals: {
      positions: positions.length,
      kg: round(totals.kg, 1),
      money: round(totals.money),
      batches: totals.batches,
      overdueKg: round(totals.overdueKg, 1),
    },
    truncated: positions.length >= limit,
    rows: positions.map((r) => ({
      id: r.id,
      name: r.name,
      tip: r.tip,
      vid: r.vid,
      grp: r.grp,
      kg: round(r.kg, 1),
      money: round(r.money),
      batches: r.batches,
      nearest: r.nearest,
      daysLeft: r.nearest ? r.daysLeft : null,
      bucket: bucketOf(r.nearest, r.daysLeft),
      overdueKg: round(r.overdueKg, 1),
      noDateKg: round(r.noDateKg, 1),
      items: byPosition.get(r.id) ?? [],
    })),
  };
}

const BUCKET_SQL: Record<ExpiryBucketKey, string> = {
  overdue: "b.best_before IS NOT NULL AND b.best_before < @cur",
  d30: "b.best_before IS NOT NULL AND b.best_before >= @cur AND julianday(b.best_before)-julianday(@cur) <= 30",
  d60: "b.best_before IS NOT NULL AND julianday(b.best_before)-julianday(@cur) > 30 AND julianday(b.best_before)-julianday(@cur) <= 60",
  d90: "b.best_before IS NOT NULL AND julianday(b.best_before)-julianday(@cur) > 60 AND julianday(b.best_before)-julianday(@cur) <= 90",
  ok: "b.best_before IS NOT NULL AND julianday(b.best_before)-julianday(@cur) > 90",
  no_date: "b.best_before IS NULL",
};

export const EXPIRY_LABELS: Record<ExpiryBucketKey, string> = {
  overdue: "Просрочено",
  d30: "≤ 30 дней",
  d60: "31–60 дней",
  d90: "61–90 дней",
  ok: "> 90 дней",
  no_date: "Без срока",
};

function bucketOf(bestBefore: string | null, daysLeft: number | null): ExpiryBucketKey {
  if (!bestBefore) return "no_date";
  const d = daysLeft ?? 0;
  if (d < 0) return "overdue";
  if (d <= 30) return "d30";
  if (d <= 60) return "d60";
  if (d <= 90) return "d90";
  return "ok";
}

// ---------- COMPETITIVE ----------

export type CompetitiveDim = "manager" | "counterparty" | "subcategory";
export interface CompetitiveParams {
  type: "position" | "category";
  id?: string;
  tip?: string;
  vid?: string;
  grp?: string;
  dim: CompetitiveDim;
}

/** WHERE clause on the `position p` table for the given scope, with bind params. */
function scopeOnP(p: CompetitiveParams): { clause: string; bind: Record<string, any> } {
  const bind: Record<string, any> = {};
  if (p.type === "position") {
    bind.id = p.id;
    return { clause: "p.position_id = @id", bind };
  }
  const parts: string[] = [];
  if (p.tip) {
    parts.push("p.tip = @tip");
    bind.tip = p.tip;
  }
  if (p.vid) {
    parts.push("p.vid = @vid");
    bind.vid = p.vid;
  }
  if (p.grp) {
    parts.push("p.grp = @grp");
    bind.grp = p.grp;
  }
  return { clause: parts.length ? parts.join(" AND ") : "1=1", bind };
}

/**
 * For subcategory dim: pick the shallowest child level that is actually split
 * (more than one value carrying ≥2% share) — skips degenerate levels where a
 * single child holds ~100% (e.g. "Готовая продукция" → one vid).
 */
function resolveChild(p: CompetitiveParams): { col: string; label: string } | null {
  if (p.type === "position") return null;
  const cur = currentDate();
  const { clause, bind } = scopeOnP(p);
  const candidates: { col: string; label: string }[] = [];
  if (!p.vid) candidates.push({ col: "p.vid", label: "Вид" });
  if (!p.grp) candidates.push({ col: "p.grp", label: "Группа" });
  candidates.push({ col: "p.name", label: "Позиция" });

  for (const c of candidates) {
    const rows = D()
      .prepare(
        `SELECT ${c.col} AS v, SUM(f.money) m FROM fact f JOIN position p ON p.position_id=f.position_id
         WHERE f.date=@cur AND ${clause} GROUP BY v`,
      )
      .all({ cur, ...bind }) as { v: string; m: number }[];
    const total = rows.reduce((s, r) => s + r.m, 0) || 1;
    const meaningful = rows.filter((r) => r.m / total >= 0.02).length;
    if (meaningful >= 2 || c.col === "p.name") return c;
  }
  return candidates[candidates.length - 1];
}

interface BreakItem {
  value: string;
  money: number;
  kg: number;
}

/** Breakdown of the scope by dimension at a single date. */
function breakdownAt(date: string, p: CompetitiveParams, cc: { col: string } | null): BreakItem[] {
  const { clause, bind } = scopeOnP(p);
  if (p.dim === "subcategory") {
    if (!cc) return [];
    return D()
      .prepare(
        `SELECT ${cc.col} AS value, SUM(f.money) money, SUM(f.kg) kg
         FROM fact f JOIN position p ON p.position_id = f.position_id
         WHERE f.date = @date AND ${clause}
         GROUP BY value ORDER BY money DESC`,
      )
      .all({ date, ...bind }) as any[];
  }
  return D()
    .prepare(
      `SELECT pd.dim_value AS value, SUM(f.money*pd.share) money, SUM(f.kg*pd.share) kg
       FROM position_dim pd
       JOIN fact f ON f.position_id = pd.position_id AND f.date = @date
       JOIN position p ON p.position_id = pd.position_id
       WHERE pd.dim_type = @dim AND ${clause}
       GROUP BY pd.dim_value ORDER BY money DESC`,
    )
    .all({ date, dim: p.dim, ...bind }) as any[];
}

/** Collapse to top-N by money + aggregate the rest into "Прочее"; return with shares. */
function withShares(items: BreakItem[], topN = 10) {
  const total = items.reduce((s, r) => s + r.money, 0) || 1;
  const top = items.slice(0, topN);
  const rest = items.slice(topN);
  const out = top.map((r) => ({
    value: r.value,
    money: round(r.money),
    kg: round(r.kg, 1),
    sharePct: round((r.money / total) * 100, 1),
  }));
  if (rest.length) {
    const m = rest.reduce((s, r) => s + r.money, 0);
    const k = rest.reduce((s, r) => s + r.kg, 0);
    out.push({ value: "Прочее", money: round(m), kg: round(k, 1), sharePct: round((m / total) * 100, 1) });
  }
  return out;
}

export function competitive(p: CompetitiveParams) {
  const cur = currentDate();
  const prev = prevDate(cur);
  const avgDates = priorDates(cur, 8);
  const cc = p.dim === "subcategory" ? resolveChild(p) : null;

  const now = breakdownAt(cur, p, cc);
  const prevB = prev ? breakdownAt(prev, p, cc) : [];

  // average breakdown over prior weeks
  const avgAcc = new Map<string, { money: number; kg: number }>();
  for (const dt of avgDates) {
    for (const r of breakdownAt(dt, p, cc)) {
      const a = avgAcc.get(r.value) ?? { money: 0, kg: 0 };
      avgAcc.set(r.value, { money: a.money + r.money, kg: a.kg + r.kg });
    }
  }
  const nAvg = Math.max(avgDates.length, 1);
  const avgB: BreakItem[] = [...avgAcc.entries()]
    .map(([value, v]) => ({ value, money: v.money / nAvg, kg: v.kg / nAvg }))
    .sort((a, b) => b.money - a.money);

  // time series for the top values (by current money)
  const { clause, bind } = scopeOnP(p);
  const topValues = now.slice(0, 8).map((r) => r.value);
  const series: Record<string, { date: string; money: number; kg: number }[]> = {};

  const stmt =
    p.dim === "subcategory" && cc
      ? D().prepare(
          `SELECT f.date, SUM(f.money) money, SUM(f.kg) kg
           FROM fact f JOIN position p ON p.position_id = f.position_id
           WHERE ${clause} AND ${cc.col} = @val GROUP BY f.date ORDER BY f.date`,
        )
      : D().prepare(
          `SELECT f.date, SUM(f.money*pd.share) money, SUM(f.kg*pd.share) kg
           FROM position_dim pd
           JOIN fact f ON f.position_id = pd.position_id
           JOIN position p ON p.position_id = pd.position_id
           WHERE pd.dim_type = @dim AND pd.dim_value = @val AND ${clause}
           GROUP BY f.date ORDER BY f.date`,
        );

  for (const val of topValues) {
    const rows = stmt.all(
      p.dim === "subcategory" ? { val, ...bind } : { val, dim: p.dim, ...bind },
    ) as any[];
    series[val] = rows.map((r) => ({ date: r.date, money: round(r.money), kg: round(r.kg, 1) }));
  }

  // Линия самого среза берётся из агрегата — она есть на всю глубину истории.
  // Разложение по менеджерам/заказчикам (series выше) требует детали и потому
  // ограничено горячим окном.
  const scopeHist =
    p.type === "position"
      ? (D()
          .prepare(
            `SELECT f.date, SUM(f.money) money, SUM(f.kg) kg
             FROM fact f JOIN position p ON p.position_id = f.position_id
             WHERE ${clause} GROUP BY f.date ORDER BY f.date`,
          )
          .all(bind) as any[])
      : seriesFor({ tip: p.tip, vid: p.vid, grp: p.grp });

  return {
    dim: p.dim,
    scope: p,
    childLabel: cc?.label ?? null,
    cur,
    prevDate: prev,
    avgCount: avgDates.length,
    now: withShares(now),
    prev: withShares(prevB),
    avg: withShares(avgB),
    seriesValues: topValues,
    series,
    scopeHistory: scopeHist.map((r) => ({ date: r.date, money: round(r.money), kg: round(r.kg, 1) })),
  };
}
