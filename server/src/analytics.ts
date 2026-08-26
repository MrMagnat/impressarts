import { db, currentDate, getSetting } from "./db.js";
import { round, monthKey } from "./util.js";

const D = () => db();

export function snapshotDates(): string[] {
  return (D().prepare("SELECT date FROM snapshot ORDER BY date").all() as { date: string }[]).map(
    (r) => r.date,
  );
}

export function prevDate(date: string): string | null {
  const r = D().prepare("SELECT MAX(date) AS d FROM snapshot WHERE date < ?").get(date) as {
    d: string | null;
  };
  return r.d;
}

/** Average of the N snapshots strictly before `date`. */
export function priorDates(date: string, n: number): string[] {
  return (
    D()
      .prepare("SELECT date FROM snapshot WHERE date < ? ORDER BY date DESC LIMIT ?")
      .all(date, n) as { date: string }[]
  ).map((r) => r.date);
}

export function meta() {
  const cur = currentDate();
  const dates = snapshotDates();
  return {
    currentDate: cur,
    currency: getSetting("currency", "₽"),
    expiryWarnDays: parseInt(getSetting("expiry_warn_days", "60"), 10),
    snapshots: dates.length,
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    realDates: (
      D().prepare("SELECT date FROM snapshot WHERE kind='real' ORDER BY date").all() as {
        date: string;
      }[]
    ).map((r) => r.date),
  };
}

// ---------- CATALOG TREE ----------

export interface TreeNode {
  level: "tip" | "vid" | "grp" | "position";
  key: string; // value at this level (or position_id for positions)
  label: string;
  tip: string;
  vid?: string;
  grp?: string;
  kg: number;
  money: number;
  positions: number;
  batches?: number;
  sharePct: number; // share of money within parent
  hasChildren: boolean;
}

export function treeChildren(params: { tip?: string; vid?: string; grp?: string }): {
  parent: { level: string; label: string; kg: number; money: number };
  children: TreeNode[];
} {
  const cur = currentDate();
  const { tip, vid, grp } = params;

  let level: TreeNode["level"];
  let groupCol: string;
  const where: string[] = ["f.date = @cur"];
  const bind: Record<string, any> = { cur };

  if (!tip) {
    level = "tip";
    groupCol = "p.tip";
  } else if (!vid) {
    level = "vid";
    groupCol = "p.vid";
    where.push("p.tip = @tip");
    bind.tip = tip;
  } else if (grp === undefined) {
    level = "grp";
    groupCol = "p.grp";
    where.push("p.tip = @tip AND p.vid = @vid");
    bind.tip = tip;
    bind.vid = vid;
  } else {
    level = "position";
    groupCol = "p.position_id";
    where.push("p.tip = @tip AND p.vid = @vid AND p.grp = @grp");
    bind.tip = tip;
    bind.vid = vid;
    bind.grp = grp;
  }

  const rows = D()
    .prepare(
      `SELECT ${groupCol} AS key,
              ${level === "position" ? "p.name" : groupCol} AS label,
              p.tip AS tip, ${level === "tip" ? "NULL" : "p.vid"} AS vid,
              SUM(f.kg) AS kg, SUM(f.money) AS money,
              COUNT(DISTINCT p.position_id) AS positions
       FROM fact f JOIN position p ON p.position_id = f.position_id
       WHERE ${where.join(" AND ")}
       GROUP BY ${groupCol}
       ORDER BY money DESC`,
    )
    .all(bind) as any[];

  const totalMoney = rows.reduce((s, r) => s + r.money, 0) || 1;

  // batch counts for positions
  let batchCounts = new Map<string, number>();
  if (level === "position") {
    for (const r of D()
      .prepare(
        `SELECT position_id AS id, COUNT(*) AS c FROM batch WHERE date=@cur AND position_id IN
         (SELECT position_id FROM position WHERE tip=@tip AND vid=@vid AND grp=@grp) GROUP BY position_id`,
      )
      .all({ cur, tip, vid, grp } as any) as { id: string; c: number }[]) {
      batchCounts.set(r.id, r.c);
    }
  }

  const children: TreeNode[] = rows.map((r) => ({
    level,
    key: String(r.key),
    label: String(r.label),
    tip: r.tip,
    vid: level === "tip" ? undefined : r.vid ?? vid,
    grp: level === "position" ? grp : level === "grp" ? String(r.key) : grp,
    kg: round(r.kg, 1),
    money: round(r.money),
    positions: r.positions,
    batches: level === "position" ? batchCounts.get(String(r.key)) ?? 0 : undefined,
    sharePct: round((r.money / totalMoney) * 100, 1),
    hasChildren: level !== "position",
  }));

  const pTotal = children.reduce(
    (a, c) => ({ kg: a.kg + c.kg, money: a.money + c.money }),
    { kg: 0, money: 0 },
  );
  const label = grp ?? vid ?? tip ?? "Все запасы";
  return {
    parent: { level, label, kg: round(pTotal.kg, 1), money: round(pTotal.money) },
    children,
  };
}

// ---------- POSITION CARD ----------

export function positionCard(id: string) {
  const cur = currentDate();
  const pos = D()
    .prepare("SELECT position_id, tip, vid, grp, name FROM position WHERE position_id = ?")
    .get(id) as any;
  if (!pos) return null;

  const price = (
    D().prepare("SELECT price_per_kg FROM price WHERE vid = ?").get(pos.vid) as
      | { price_per_kg: number }
      | undefined
  )?.price_per_kg ?? 0;

  const totals = D()
    .prepare("SELECT kg, money FROM fact WHERE date=? AND position_id=?")
    .get(cur, id) as { kg: number; money: number } | undefined;

  const batches = D()
    .prepare(
      `SELECT series, kg, best_before, manufactured, manager, counterparty, money,
              CAST(julianday(best_before) - julianday(@cur) AS INTEGER) AS days_left
       FROM batch WHERE date=@cur AND position_id=@id
       ORDER BY (best_before IS NULL), best_before ASC`,
    )
    .all({ cur, id }) as any[];

  const byDim = (dim: "manager" | "counterparty") =>
    D()
      .prepare(
        `SELECT ${dim} AS value, SUM(kg) kg, SUM(money) money, COUNT(*) batches
         FROM batch WHERE date=@cur AND position_id=@id AND ${dim} IS NOT NULL
         GROUP BY ${dim} ORDER BY money DESC`,
      )
      .all({ cur, id }) as any[];

  const history = D()
    .prepare("SELECT date, kg, money FROM fact WHERE position_id=? ORDER BY date")
    .all(id) as any[];

  // expiry buckets
  const buckets = expiryBuckets({ position_id: id });

  return {
    id,
    ...pos,
    price,
    kg: round(totals?.kg ?? 0, 1),
    money: round(totals?.money ?? 0),
    batchCount: batches.length,
    batches: batches.map((b) => ({
      ...b,
      kg: round(b.kg, 3),
      money: round(b.money),
    })),
    managers: byDim("manager").map((r) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) })),
    counterparties: byDim("counterparty").map((r) => ({
      ...r,
      kg: round(r.kg, 1),
      money: round(r.money),
    })),
    history: history.map((h) => ({ date: h.date, kg: round(h.kg, 1), money: round(h.money) })),
    expiry: buckets,
  };
}

export function searchPositions(q: string, limit = 25) {
  const cur = currentDate();
  const like = `%${q.trim()}%`;
  return D()
    .prepare(
      `SELECT p.position_id AS id, p.name, p.tip, p.vid, p.grp,
              f.kg, f.money
       FROM position p JOIN fact f ON f.position_id=p.position_id AND f.date=@cur
       WHERE p.name LIKE @like
       ORDER BY f.money DESC LIMIT @limit`,
    )
    .all({ cur, like, limit })
    .map((r: any) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) }));
}

// ---------- EXPIRY ----------

export function expiryBuckets(filter: { tip?: string; vid?: string; position_id?: string } = {}) {
  const cur = currentDate();
  const where: string[] = ["b.date = @cur"];
  const bind: Record<string, any> = { cur };
  if (filter.position_id) {
    where.push("b.position_id = @pid");
    bind.pid = filter.position_id;
  }
  if (filter.tip || filter.vid) {
    where.push(
      "b.position_id IN (SELECT position_id FROM position WHERE 1=1" +
        (filter.tip ? " AND tip=@tip" : "") +
        (filter.vid ? " AND vid=@vid" : "") +
        ")",
    );
    if (filter.tip) bind.tip = filter.tip;
    if (filter.vid) bind.vid = filter.vid;
  }
  const rows = D()
    .prepare(
      `SELECT
        CASE
          WHEN best_before IS NULL THEN 'no_date'
          WHEN best_before < @cur THEN 'overdue'
          WHEN julianday(best_before)-julianday(@cur) <= 30 THEN 'd30'
          WHEN julianday(best_before)-julianday(@cur) <= 60 THEN 'd60'
          WHEN julianday(best_before)-julianday(@cur) <= 90 THEN 'd90'
          ELSE 'ok'
        END AS bucket,
        SUM(kg) kg, SUM(money) money, COUNT(*) batches
       FROM batch b WHERE ${where.join(" AND ")} GROUP BY bucket`,
    )
    .all(bind) as any[];
  const order = ["overdue", "d30", "d60", "d90", "ok", "no_date"];
  const labels: Record<string, string> = {
    overdue: "Просрочено",
    d30: "≤ 30 дней",
    d60: "31–60 дней",
    d90: "61–90 дней",
    ok: "> 90 дней",
    no_date: "Без срока",
  };
  const map = new Map(rows.map((r) => [r.bucket, r]));
  return order.map((b) => {
    const r = map.get(b);
    return {
      bucket: b,
      label: labels[b],
      kg: round(r?.kg ?? 0, 1),
      money: round(r?.money ?? 0),
      batches: r?.batches ?? 0,
    };
  });
}

// ---------- DASHBOARD ----------

export function dashboard() {
  const cur = currentDate();
  const prev = prevDate(cur);
  const priors = priorDates(cur, 4);

  const totalAt = (date: string) =>
    D().prepare("SELECT COALESCE(SUM(kg),0) kg, COALESCE(SUM(money),0) money, COUNT(*) positions FROM fact WHERE date=?").get(
      date,
    ) as { kg: number; money: number; positions: number };

  const now = totalAt(cur);
  const prevT = prev ? totalAt(prev) : { kg: 0, money: 0, positions: 0 };
  const avgMoney =
    priors.length > 0
      ? priors.reduce((s, dt) => s + totalAt(dt).money, 0) / priors.length
      : now.money;
  const avgKg =
    priors.length > 0 ? priors.reduce((s, dt) => s + totalAt(dt).kg, 0) / priors.length : now.kg;

  const batches = (
    D().prepare("SELECT COUNT(*) c FROM batch WHERE date=?").get(cur) as { c: number }
  ).c;

  const byTip = D()
    .prepare(
      `SELECT p.tip, SUM(f.kg) kg, SUM(f.money) money, COUNT(*) positions
       FROM fact f JOIN position p ON p.position_id=f.position_id WHERE f.date=?
       GROUP BY p.tip ORDER BY money DESC`,
    )
    .all(cur)
    .map((r: any) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) }));

  const topVids = D()
    .prepare(
      `SELECT p.tip, p.vid, SUM(f.kg) kg, SUM(f.money) money
       FROM fact f JOIN position p ON p.position_id=f.position_id WHERE f.date=?
       GROUP BY p.tip, p.vid ORDER BY money DESC LIMIT 10`,
    )
    .all(cur)
    .map((r: any) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) }));

  const trend = D()
    .prepare(
      `SELECT date, SUM(kg) kg, SUM(money) money FROM fact
       WHERE date >= ? GROUP BY date ORDER BY date`,
    )
    .all(priorDates(cur, 26).slice(-1)[0] ?? cur)
    .map((r: any) => ({ date: r.date, kg: round(r.kg, 1), money: round(r.money) }));

  const topDim = (dim: string) =>
    D()
      .prepare(
        `SELECT ${dim} AS value, SUM(kg) kg, SUM(money) money, COUNT(*) batches
         FROM batch WHERE date=@cur AND ${dim} IS NOT NULL
         GROUP BY ${dim} ORDER BY money DESC LIMIT 8`,
      )
      .all({ cur })
      .map((r: any) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) }));

  return {
    currentDate: cur,
    prevDate: prev,
    totals: {
      kg: round(now.kg, 1),
      money: round(now.money),
      positions: now.positions,
      batches,
    },
    wow: {
      kgPct: prevT.kg ? round(((now.kg - prevT.kg) / prevT.kg) * 100, 1) : 0,
      moneyPct: prevT.money ? round(((now.money - prevT.money) / prevT.money) * 100, 1) : 0,
      kgAbs: round(now.kg - prevT.kg, 1),
      moneyAbs: round(now.money - prevT.money),
    },
    vsAvg: {
      kgPct: avgKg ? round(((now.kg - avgKg) / avgKg) * 100, 1) : 0,
      moneyPct: avgMoney ? round(((now.money - avgMoney) / avgMoney) * 100, 1) : 0,
    },
    byTip,
    topVids,
    trend,
    expiry: expiryBuckets(),
    topManagers: topDim("manager"),
    topCounterparties: topDim("counterparty"),
  };
}
