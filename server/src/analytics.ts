import { db, currentDate, getSetting } from "./db.js";
import { round, monthKey, addDays } from "./util.js";
import { seriesFor, seriesByTip } from "./history.js";
import { cached } from "./cache.js";

const D = () => db();

export function snapshotDates(): string[] {
  return (
    D().prepare("SELECT DISTINCT date FROM fact_agg ORDER BY date").all() as { date: string }[]
  ).map((r) => r.date);
}

/**
 * Шаг сравнения в днях. Снимки из 1С приходят ежедневно, а за сутки остатки
 * почти не меняются — «прошлый период» по умолчанию отстоит на 4 недели.
 * Меняется в Настройках → Общие.
 */
export function compareOffsetDays(): number {
  const n = parseInt(getSetting("compare_offset_days", "28"), 10);
  return Number.isFinite(n) && n > 0 ? n : 28;
}

/** Снимок, ближайший к `date` минус шаг сравнения (не позже него). */
function snapshotAtOrBefore(date: string): string | null {
  const r = D().prepare("SELECT MAX(date) AS d FROM fact_agg WHERE date <= ?").get(date) as {
    d: string | null;
  };
  return r.d;
}

export function prevDate(date: string): string | null {
  const back = snapshotAtOrBefore(addDays(date, -compareOffsetDays()));
  if (back && back < date) return back;
  // истории на полный шаг назад ещё нет — берём ближайший предыдущий снимок
  const r = D().prepare("SELECT MAX(date) AS d FROM fact_agg WHERE date < ?").get(date) as {
    d: string | null;
  };
  return r.d;
}

/**
 * Опорные точки для среднего: N снимков, отстоящих от `date` на 1..N шагов
 * сравнения. Раньше здесь брались N подряд идущих дат — на ежедневных данных
 * это давало «среднее за прошлую неделю», а не за сопоставимые периоды.
 */
export function priorDates(date: string, n: number): string[] {
  const step = compareOffsetDays();
  const out: string[] = [];
  const seen = new Set<string>();
  for (let i = 1; i <= n; i++) {
    const d = snapshotAtOrBefore(addDays(date, -step * i));
    if (!d || d >= date || seen.has(d)) continue;
    seen.add(d);
    out.push(d);
  }
  if (out.length) return out;
  // короткая история: откатываемся к подряд идущим снимкам
  return recentDates(date, n);
}

/** N подряд идущих снимков до `date` — окно для графиков, а не для сравнения. */
export function recentDates(date: string, n: number): string[] {
  return (
    D()
      .prepare("SELECT DISTINCT date FROM fact_agg WHERE date < ? ORDER BY date DESC LIMIT ?")
      .all(date, n) as { date: string }[]
  ).map((r) => r.date);
}

export function meta() {
  return cached("meta", buildMeta);
}

function buildMeta() {
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
    // откуда пришёл текущий снимок: '1c' | 'excel' | 'model'
    currentSource:
      (
        D().prepare("SELECT source FROM snapshot WHERE date = ?").get(cur) as
          | { source: string | null }
          | undefined
      )?.source ?? null,
    // даты с полной детализацией (партии, менеджеры, топ-движения)
    detailFrom:
      (
        D().prepare("SELECT MIN(date) AS d FROM fact").get() as { d: string | null }
      ).d ?? null,
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
  return cached(
    "tree:" + [params.tip, params.vid, params.grp].join(""),
    () => buildTree(params),
  );
}

function buildTree(params: { tip?: string; vid?: string; grp?: string }): {
  parent: { level: string; label: string; kg: number; money: number };
  children: TreeNode[];
} {
  const cur = currentDate();
  const { tip, vid, grp } = params;

  let level: TreeNode["level"];
  let groupCol: string;
  const where: string[] = ["f.date = @cur"];
  const bind: Record<string, any> = { cur };

  // Иерархия: Тип (TypeN_Name) -> Вид (Parents) -> Позиция -> Партии.
  // «Группа» (префикс имени до двоеточия) из навигации убрана: у реальной
  // выгрузки двоеточия нет у большинства позиций, и уровень вырождался в
  // одну «Без группы». Поле grp остаётся в модели для старых отчётов.
  if (!tip) {
    level = "tip";
    groupCol = "p.tip";
  } else if (!vid) {
    level = "vid";
    groupCol = "p.vid";
    where.push("p.tip = @tip");
    bind.tip = tip;
  } else {
    level = "position";
    groupCol = "p.position_id";
    where.push("p.tip = @tip AND p.vid = @vid");
    bind.tip = tip;
    bind.vid = vid;
  }
  if (grp) {
    where.push("p.grp = @grp");
    bind.grp = grp;
  }

  // Уровни «тип» и «группа» целиком покрываются агрегатом — джойн детальных
  // таблиц на десятки тысяч строк там не нужен. Детализация читается только
  // на уровне позиций.
  let rows: any[];
  if (level === "tip") {
    rows = D()
      .prepare(
        `SELECT k1 AS key, k1 AS label, k1 AS tip, NULL AS vid,
                kg, money, positions
         FROM fact_agg WHERE date = @cur AND level = 'tip' ORDER BY money DESC`,
      )
      .all({ cur }) as any[];
  } else if (level === "vid") {
    rows = D()
      .prepare(
        `SELECT k2 AS key, k2 AS label, k1 AS tip, k2 AS vid,
                kg, money, positions
         FROM fact_agg WHERE date = @cur AND level = 'vid' AND k1 = @tip
         ORDER BY money DESC`,
      )
      .all({ cur, tip } as any) as any[];
  } else {
    rows = D()
      .prepare(
        `SELECT ${groupCol} AS key, p.name AS label, p.tip AS tip, p.vid AS vid,
                SUM(f.kg) AS kg, SUM(f.money) AS money,
                COUNT(DISTINCT p.position_id) AS positions
         FROM fact f JOIN position p ON p.position_id = f.position_id
         WHERE ${where.join(" AND ")}
         GROUP BY ${groupCol}
         ORDER BY money DESC`,
      )
      .all(bind) as any[];
  }

  const totalMoney = rows.reduce((s, r) => s + r.money, 0) || 1;

  // batch counts for positions
  let batchCounts = new Map<string, number>();
  if (level === "position") {
    for (const r of D()
      .prepare(
        `SELECT position_id AS id, COUNT(*) AS c FROM batch WHERE date=@cur AND position_id IN
         (SELECT position_id FROM position WHERE tip=@tip AND vid=@vid) GROUP BY position_id`,
      )
      .all({ cur, tip, vid } as any) as { id: string; c: number }[]) {
      batchCounts.set(r.id, r.c);
    }
  }

  const children: TreeNode[] = rows.map((r) => ({
    level,
    key: String(r.key),
    label: String(r.label),
    tip: r.tip,
    vid: level === "tip" ? undefined : level === "vid" ? String(r.key) : r.vid ?? vid,
    grp,
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
  const label = vid ?? grp ?? tip ?? "Все запасы";
  return {
    parent: { level, label, kg: round(pTotal.kg, 1), money: round(pTotal.money) },
    children,
  };
}

// ---------- POSITION CARD ----------

export function positionCard(id: string) {
  return cached("pos:" + id, () => buildPositionCard(id));
}

function buildPositionCard(id: string) {
  const cur = currentDate();
  const pos = D()
    .prepare("SELECT position_id, tip, vid, grp, name FROM position WHERE position_id = ?")
    .get(id) as any;
  if (!pos) return null;

  const listPrice = (
    D().prepare("SELECT price_per_kg FROM price WHERE vid = ?").get(pos.vid) as
      | { price_per_kg: number }
      | undefined
  )?.price_per_kg ?? 0;

  const totals = D()
    .prepare("SELECT kg, money FROM fact WHERE date=? AND position_id=?")
    .get(cur, id) as { kg: number; money: number } | undefined;

  // Цена в карточке — обратный счёт по факту: заморожено / остаток. Модельная
  // цена ₽/кг из таблицы price остаётся запасной для позиций без остатка.
  const price =
    totals && totals.kg > 0 ? round(totals.money / totals.kg, 2) : listPrice;

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
    listPrice,
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

// ---------- РАЗРЕЗЫ ПО ИЗМЕРЕНИЯМ ----------

/**
 * Топ значений измерения (менеджер / заказчик) по партиям текущего снимка.
 * Необязательный фильтр по типу номенклатуры.
 *
 * Считается по таблице партий, а она хранится только за текущий снимок, —
 * поэтому разрез доступен для «сейчас на складе», но не задним числом.
 */
export function topDim(dim: "manager" | "counterparty", tip?: string, limit = 8) {
  const cur = currentDate();
  const col = dim === "manager" ? "manager" : "counterparty";
  const where = [`b.date = @cur`, `b.${col} IS NOT NULL`];
  const bind: Record<string, any> = { cur, limit };
  if (tip) {
    where.push("b.position_id IN (SELECT position_id FROM position WHERE tip = @tip)");
    bind.tip = tip;
  }
  return D()
    .prepare(
      `SELECT b.${col} AS value, SUM(b.kg) kg, SUM(b.money) money, COUNT(*) batches
       FROM batch b WHERE ${where.join(" AND ")}
       GROUP BY b.${col} ORDER BY money DESC LIMIT @limit`,
    )
    .all(bind)
    .map((r: any) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) }));
}

/** Три «текущих» блока дашборда одним запросом, с фильтром по типу. */
export function breakdown(tip?: string) {
  return cached("breakdown:" + (tip ?? ""), () => ({
    tip: tip ?? null,
    expiry: expiryBuckets(tip ? { tip } : {}),
    topManagers: topDim("manager", tip),
    topCounterparties: topDim("counterparty", tip),
  }));
}

// ---------- DASHBOARD ----------

export function dashboard() {
  return cached("dashboard", buildDashboard);
}

function buildDashboard() {
  const cur = currentDate();
  const prev = prevDate(cur);
  const priors = priorDates(cur, 4);

  const totalAt = (date: string) =>
    (D()
      .prepare(
        "SELECT COALESCE(kg,0) kg, COALESCE(money,0) money, COALESCE(positions,0) positions " +
          "FROM fact_agg WHERE date=? AND level='total'",
      )
      .get(date) as { kg: number; money: number; positions: number } | undefined) ?? {
      kg: 0,
      money: 0,
      positions: 0,
    };

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
      `SELECT k1 AS tip, kg, money, positions FROM fact_agg
       WHERE date=? AND level='tip' ORDER BY money DESC`,
    )
    .all(cur)
    .map((r: any) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) }));

  const topVids = D()
    .prepare(
      `SELECT k1 AS tip, k2 AS vid, kg, money FROM fact_agg
       WHERE date=? AND level='vid' ORDER BY money DESC LIMIT 20`,
    )
    .all(cur)
    .map((r: any) => ({ ...r, kg: round(r.kg, 1), money: round(r.money) }));

  // тренд за 26 точек назад — из агрегата, поэтому не зависит от глубины детали
  const trend = seriesFor({}, recentDates(cur, 26).slice(-1)[0] ?? cur);


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
    // разложение тренда по типам — для графика с накоплением
    trendByTip: seriesByTip(recentDates(cur, 26).slice(-1)[0] ?? cur),
    tips: byTip.map((t: any) => t.tip),
  };
}
