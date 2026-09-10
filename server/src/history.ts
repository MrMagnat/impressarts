/**
 * Слой хранения истории.
 *
 * Инвариант: за КАЖДУЮ дату, о которой известно приложению, есть строки в
 * `fact_agg` — компактный агрегат по уровням дерева (итого / тип / вид /
 * группа), ~500 строк на дату. Все графики, тренды и отчёты по категориям
 * читают только его.
 *
 * Детальные таблицы (`fact` по позициям, `batch` по партиям) живут лишь в
 * «горячем окне» последних N дней и нужны там, где без позиции не обойтись:
 * карточка, поиск, дерево до позиции, топ-движения, разрез по менеджерам.
 * Всё, что старше окна, сжимается в агрегат; сама глубина остаётся в 1С и
 * подтягивается по требованию (sync.backfillRange), минуя `fact` вовсе.
 */
import { db, currentDate } from "./db.js";
import { round, addDays, monthKey, groupOf, hashId } from "./util.js";
import { defaultPrice } from "./etl/prices.js";
import type { RawRow } from "./etl/import-excel.js";

const D = () => db();
const SEP = "¦";

export type AggLevel = "total" | "tip" | "vid" | "grp";

export interface KM {
  kg: number;
  money: number;
}
const ZERO: KM = { kg: 0, money: 0 };

/** Есть ли за дату детальные строки по позициям. */
export function hasDetail(date: string): boolean {
  return !!(D().prepare("SELECT 1 AS x FROM fact WHERE date = ? LIMIT 1").get(date) as any);
}

/** Даты, за которые в горячем окне сохранена детализация. */
export function detailDates(): Set<string> {
  return new Set(
    (D().prepare("SELECT DISTINCT date FROM fact").all() as { date: string }[]).map((r) => r.date),
  );
}

// ---------- запись агрегата ----------

/** Пересобрать `fact_agg` за дату из детального `fact`. Вызывать после каждого импорта. */
export function writeAggregate(date: string): number {
  const d = D();
  const levels: { level: AggLevel; cols: string[] }[] = [
    { level: "total", cols: [] },
    { level: "tip", cols: ["p.tip"] },
    { level: "vid", cols: ["p.tip", "p.vid"] },
    { level: "grp", cols: ["p.tip", "p.vid", "p.grp"] },
  ];
  const ins = d.prepare(
    "INSERT OR REPLACE INTO fact_agg(date, level, k1, k2, k3, kg, money, positions) VALUES(?,?,?,?,?,?,?,?)",
  );
  d.prepare("DELETE FROM fact_agg WHERE date = ?").run(date);
  let n = 0;
  for (const { level, cols } of levels) {
    const select = cols.length ? cols.map((c, i) => c + " AS k" + (i + 1)).join(", ") + ", " : "";
    const group = cols.length ? " GROUP BY " + cols.join(", ") : "";
    for (const r of d
      .prepare(
        "SELECT " +
          select +
          "SUM(f.kg) kg, SUM(f.money) money, COUNT(DISTINCT p.position_id) positions " +
          "FROM fact f JOIN position p ON p.position_id = f.position_id " +
          "WHERE f.date = ?" +
          group,
      )
      .all(date) as any[]) {
      ins.run(
        date,
        level,
        r.k1 ?? "",
        r.k2 ?? "",
        r.k3 ?? "",
        round(r.kg ?? 0, 3),
        round(r.money ?? 0),
        r.positions ?? 0,
      );
      n++;
    }
  }
  return n;
}

/** Пересобрать агрегат за все даты, где есть деталь (после массовых изменений). */
export function writeAggregateAll(): number {
  let n = 0;
  for (const date of detailDates()) n += writeAggregate(date);
  return n;
}

/**
 * Записать агрегат за дату прямо из строк источника, не трогая `fact`.
 * Так сохраняются догруженные из 1С старые даты: детализация за них не нужна.
 */
export function writeAggregateFromRows(date: string, rows: RawRow[]): number {
  const d = D();
  const prices = new Map<string, number>();
  for (const r of d.prepare("SELECT vid, price_per_kg FROM price").all() as {
    vid: string;
    price_per_kg: number;
  }[]) {
    prices.set(r.vid, r.price_per_kg);
  }
  const priceOf = (tip: string, vid: string) => {
    let p = prices.get(vid);
    if (p == null) {
      p = defaultPrice(tip, vid);
      prices.set(vid, p);
    }
    return p;
  };

  interface Acc {
    kg: number;
    money: number;
    pos: Set<string>;
  }
  const buckets = new Map<string, Acc>();
  const bump = (key: string, kg: number, money: number, pid: string) => {
    let a = buckets.get(key);
    if (!a) {
      a = { kg: 0, money: 0, pos: new Set() };
      buckets.set(key, a);
    }
    a.kg += kg;
    a.money += money;
    a.pos.add(pid);
  };

  for (const r of rows) {
    const pid = hashId(r.tip, "|", r.vid, "|", r.name);
    const grp = groupOf(r.name);
    const money = r.kg * priceOf(r.tip, r.vid);
    bump(["total", "", "", ""].join(SEP), r.kg, money, pid);
    bump(["tip", r.tip, "", ""].join(SEP), r.kg, money, pid);
    bump(["vid", r.tip, r.vid, ""].join(SEP), r.kg, money, pid);
    bump(["grp", r.tip, r.vid, grp].join(SEP), r.kg, money, pid);
  }

  const ins = d.prepare(
    "INSERT OR REPLACE INTO fact_agg(date, level, k1, k2, k3, kg, money, positions) VALUES(?,?,?,?,?,?,?,?)",
  );
  d.exec("BEGIN");
  try {
    d.prepare("DELETE FROM fact_agg WHERE date = ?").run(date);
    for (const [key, a] of buckets) {
      const [level, k1, k2, k3] = key.split(SEP);
      ins.run(date, level, k1, k2, k3, round(a.kg, 3), round(a.money), a.pos.size);
    }
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return buckets.size;
}

/**
 * Пересчитать деньги в агрегате после смены цены ₽/кг у вида.
 * Уровни 'vid' и 'grp' знают свой вид, а 'tip' и 'total' пересобираются из них.
 */
export function repriceAggregate(vid: string, price: number): void {
  const d = D();
  d.prepare("UPDATE fact_agg SET money = ROUND(kg * ?) WHERE level IN ('vid','grp') AND k2 = ?").run(
    price,
    vid,
  );
  d.exec(
    "UPDATE fact_agg AS a SET money = (" +
      "  SELECT COALESCE(SUM(v.money),0) FROM fact_agg v" +
      "  WHERE v.date = a.date AND v.level = 'vid' AND v.k1 = a.k1" +
      ") WHERE a.level = 'tip'",
  );
  d.exec(
    "UPDATE fact_agg AS a SET money = (" +
      "  SELECT COALESCE(SUM(t.money),0) FROM fact_agg t" +
      "  WHERE t.date = a.date AND t.level = 'tip'" +
      ") WHERE a.level = 'total'",
  );
}

// ---------- чтение агрегата ----------

/**
 * Срез за дату по уровню. Ключи те же, что раньше давал прямой SQL по `fact`:
 * 'tip' -> "тип", 'vid' -> "тип¦вид", 'grp' -> "тип¦вид¦группа".
 */
export function aggAt(date: string, level: AggLevel): Map<string, KM> {
  const rows = D()
    .prepare("SELECT k1, k2, k3, kg, money FROM fact_agg WHERE date = ? AND level = ?")
    .all(date, level) as any[];
  return new Map(
    rows.map((r) => {
      const key =
        level === "total"
          ? ""
          : level === "tip"
            ? r.k1
            : level === "vid"
              ? r.k1 + SEP + r.k2
              : r.k1 + SEP + r.k2 + SEP + r.k3;
      return [String(key), { kg: r.kg, money: r.money } as KM];
    }),
  );
}

export function totalAt(date: string): KM {
  const r = D()
    .prepare("SELECT kg, money FROM fact_agg WHERE date = ? AND level = 'total'")
    .get(date) as KM | undefined;
  return r ?? ZERO;
}

export interface Scope {
  tip?: string;
  vid?: string;
  grp?: string;
}

export function scopeTotalAt(date: string, scope: Scope): KM {
  if (!scope.tip) return totalAt(date);
  const level: AggLevel = scope.grp ? "grp" : scope.vid ? "vid" : "tip";
  // именованные параметры биндятся только те, что реально есть в SQL:
  // node:sqlite отвергает лишние ключи
  const bind: Record<string, any> = { date, level, tip: scope.tip };
  let sql =
    "SELECT COALESCE(SUM(kg),0) kg, COALESCE(SUM(money),0) money FROM fact_agg " +
    "WHERE date = @date AND level = @level AND k1 = @tip";
  if (scope.vid) {
    sql += " AND k2 = @vid";
    bind.vid = scope.vid;
  }
  if (scope.grp) {
    sql += " AND k3 = @grp";
    bind.grp = scope.grp;
  }
  const r = D().prepare(sql).get(bind) as KM | undefined;
  return r ?? ZERO;
}

/** Уровень потомков для среза дерева. */
export function childLevelOf(scope: Scope): AggLevel | "position" {
  if (!scope.tip) return "tip";
  if (!scope.vid) return "vid";
  if (!scope.grp) return "grp";
  return "position";
}

/**
 * Разбивка среза по непосредственным потомкам за дату. Ключ — «короткое» имя
 * потомка (вид без типа, группа без вида). Уровень позиций доступен только в
 * горячем окне: за сжатые даты возвращается пустая карта.
 */
export function childBreakdownAt(date: string, scope: Scope): Map<string, KM> {
  const level = childLevelOf(scope);
  if (level === "position") {
    if (!hasDetail(date)) return new Map();
    const rows = D()
      .prepare(
        "SELECT p.name AS k, SUM(f.kg) kg, SUM(f.money) money " +
          "FROM fact f JOIN position p ON p.position_id = f.position_id " +
          "WHERE f.date = @date AND p.tip = @tip AND p.vid = @vid AND p.grp = @grp GROUP BY k",
      )
      .all({ date, tip: scope.tip, vid: scope.vid, grp: scope.grp } as any) as any[];
    return new Map(rows.map((r) => [String(r.k), { kg: r.kg, money: r.money } as KM]));
  }
  const keyCol = level === "tip" ? "k1" : level === "vid" ? "k2" : "k3";
  const where: string[] = ["date = @date", "level = @level"];
  const bind: Record<string, any> = { date, level };
  if (scope.tip) {
    where.push("k1 = @tip");
    bind.tip = scope.tip;
  }
  if (scope.vid) {
    where.push("k2 = @vid");
    bind.vid = scope.vid;
  }
  const rows = D()
    .prepare(
      "SELECT " + keyCol + " AS k, SUM(kg) kg, SUM(money) money FROM fact_agg WHERE " +
        where.join(" AND ") +
        " GROUP BY k",
    )
    .all(bind) as any[];
  return new Map(rows.map((r) => [String(r.k), { kg: r.kg, money: r.money } as KM]));
}

/** Все даты, за которые есть агрегат. */
export function knownDates(): string[] {
  return (
    D().prepare("SELECT DISTINCT date FROM fact_agg ORDER BY date").all() as { date: string }[]
  ).map((r) => r.date);
}

/** Ряд итогов по срезу за все известные даты (для графиков любой глубины). */
export function seriesFor(scope: Scope, from?: string, to?: string) {
  const where: string[] = [];
  const bind: Record<string, any> = {};
  const level: AggLevel = scope.grp ? "grp" : scope.vid ? "vid" : scope.tip ? "tip" : "total";
  where.push("level = @level");
  bind.level = level;
  if (scope.tip) {
    where.push("k1 = @tip");
    bind.tip = scope.tip;
  }
  if (scope.vid) {
    where.push("k2 = @vid");
    bind.vid = scope.vid;
  }
  if (scope.grp) {
    where.push("k3 = @grp");
    bind.grp = scope.grp;
  }
  if (from) {
    where.push("date >= @from");
    bind.from = from;
  }
  if (to) {
    where.push("date <= @to");
    bind.to = to;
  }
  return (
    D()
      .prepare(
        "SELECT date, SUM(kg) kg, SUM(money) money FROM fact_agg WHERE " +
          where.join(" AND ") +
          " GROUP BY date ORDER BY date",
      )
      .all(bind) as any[]
  ).map((r) => ({ date: r.date, kg: round(r.kg, 1), money: round(r.money) }));
}

// ---------- сжатие горячего окна ----------

export interface TrimResult {
  cutoff: string;
  aggregated: string[];
  factRowsDeleted: number;
  batchRowsDeleted: number;
}

/**
 * Сжать всё, что старше `retentionDays` от последнего снимка: сохранить агрегат,
 * удалить детальные `fact` и `batch`, пометить снимок detail=0.
 * Партии оставляем только за текущий снимок — исторические никем не читаются.
 */
export function trimDetail(retentionDays: number): TrimResult {
  const d = D();
  const cur = currentDate();
  if (!cur) return { cutoff: "", aggregated: [], factRowsDeleted: 0, batchRowsDeleted: 0 };
  const cutoff = addDays(cur, -Math.abs(retentionDays));

  const stale = (
    d
      .prepare("SELECT DISTINCT date FROM fact WHERE date < ? AND date <> ? ORDER BY date")
      .all(cutoff, cur) as { date: string }[]
  ).map((r) => r.date);

  let factDeleted = 0;
  let batchDeleted = 0;
  d.exec("BEGIN");
  try {
    for (const date of stale) {
      writeAggregate(date); // на случай, если агрегат отстал
      factDeleted += Number(d.prepare("DELETE FROM fact WHERE date = ?").run(date).changes ?? 0);
      batchDeleted += Number(d.prepare("DELETE FROM batch WHERE date = ?").run(date).changes ?? 0);
      d.prepare("UPDATE snapshot SET detail = 0 WHERE date = ?").run(date);
    }
    batchDeleted += Number(d.prepare("DELETE FROM batch WHERE date <> ?").run(cur).changes ?? 0);
    d.exec("COMMIT");
  } catch (e) {
    d.exec("ROLLBACK");
    throw e;
  }
  return { cutoff, aggregated: stale, factRowsDeleted: factDeleted, batchRowsDeleted: batchDeleted };
}

export function storageStats() {
  const d = D();
  const s = d
    .prepare(
      "SELECT (SELECT COUNT(*) FROM fact) factRows," +
        " (SELECT COUNT(*) FROM fact_agg) aggRows," +
        " (SELECT COUNT(*) FROM batch) batchRows," +
        " (SELECT COUNT(*) FROM position) positions," +
        " (SELECT COUNT(DISTINCT date) FROM fact) detailDates," +
        " (SELECT COUNT(DISTINCT date) FROM fact_agg) aggDates",
    )
    .get() as any;
  const pages = d
    .prepare("SELECT page_count * page_size AS bytes FROM pragma_page_count(), pragma_page_size()")
    .get() as any;
  const dates = knownDates();
  return {
    ...s,
    currentDate: currentDate(),
    firstDate: dates[0] ?? null,
    lastDate: dates[dates.length - 1] ?? null,
    months: [...new Set(dates.map(monthKey))].length,
    dbBytes: pages?.bytes ?? 0,
  };
}
