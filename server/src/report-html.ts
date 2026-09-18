import {
  weeklyReport,
  monthlyReport,
  competitive,
  expiryReport,
  EXPIRY_LABELS,
  type CompetitiveParams,
  type ExpiryParams,
} from "./reports.js";
import { positionCard } from "./analytics.js";
import { getSetting } from "./db.js";

const cur = () => getSetting("currency", "₽");

function fmtMoney(n: number): string {
  const abs = Math.abs(n);
  let v: string;
  if (abs >= 1e9) v = (n / 1e9).toFixed(2) + " млрд";
  else if (abs >= 1e6) v = (n / 1e6).toFixed(1) + " млн";
  else if (abs >= 1e3) v = (n / 1e3).toFixed(0) + " тыс";
  else v = n.toFixed(0);
  return v + " " + cur();
}
function fmtKg(n: number): string {
  if (Math.abs(n) >= 1000) return (n / 1000).toFixed(1) + " т";
  return n.toFixed(0) + " кг";
}
function pct(n: number): string {
  return (n > 0 ? "+" : "") + n.toFixed(1) + "%";
}
function cls(n: number): string {
  return n > 0.05 ? "up" : n < -0.05 ? "down" : "flat";
}
function esc(s: string): string {
  return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
}

function bars(items: { label: string; value: number }[]): string {
  const max = Math.max(...items.map((i) => i.value), 1);
  return items
    .map(
      (i) =>
        `<div class="bar"><span class="bl">${esc(i.label)}</span>
         <span class="bt"><span class="bf" style="width:${(i.value / max) * 100}%"></span></span>
         <span class="bv">${fmtMoney(i.value)}</span></div>`,
    )
    .join("");
}

function moversTable(title: string, rows: any[], dir: "up" | "down"): string {
  if (!rows.length) return "";
  return `<h3>${title}</h3><table class="mv"><thead><tr><th>Позиция</th><th>Категория</th><th>Было</th><th>Стало</th><th>Δ</th></tr></thead><tbody>${rows
    .map(
      (m) =>
        `<tr><td>${esc(m.name)}</td><td class="mut">${esc(m.tip)} · ${esc(m.vid)}</td>
         <td>${fmtMoney(m.prevMoney)}</td><td>${fmtMoney(m.curMoney)}</td>
         <td class="${dir}">${pct(m.diffPct)}</td></tr>`,
    )
    .join("")}</tbody></table>`;
}

function breakdownRows(tips: any[]): string {
  let html = "";
  for (const t of tips) {
    html += `<tr class="lvl-tip"><td>${esc(t.label)}</td><td>${fmtKg(t.kg)}</td><td>${fmtMoney(
      t.money,
    )}</td><td class="${cls(t.vsPrev.money.pct)}">${pct(t.vsPrev.money.pct)}</td><td class="${cls(
      t.vsAvg.money.pct,
    )}">${pct(t.vsAvg.money.pct)}</td></tr>`;
    for (const v of t.vids.slice(0, 8)) {
      html += `<tr class="lvl-vid"><td>&nbsp;&nbsp;${esc(v.label)}</td><td>${fmtKg(
        v.kg,
      )}</td><td>${fmtMoney(v.money)}</td><td class="${cls(v.vsPrev.money.pct)}">${pct(
        v.vsPrev.money.pct,
      )}</td><td class="${cls(v.vsAvg.money.pct)}">${pct(v.vsAvg.money.pct)}</td></tr>`;
    }
  }
  return html;
}

const CSS = `
*{box-sizing:border-box} body{font-family:'Segoe UI',Roboto,Arial,sans-serif;color:#1a2233;margin:0;padding:32px;font-size:12px}
h1{font-size:22px;margin:0 0 2px} h2{font-size:15px;margin:22px 0 8px;border-bottom:2px solid #e6eaf2;padding-bottom:4px}
h3{font-size:13px;margin:16px 0 6px;color:#334}
.sub{color:#69748a;margin:0 0 18px}
.kpis{display:flex;gap:12px;margin:14px 0}
.kpi{flex:1;border:1px solid #e6eaf2;border-radius:10px;padding:12px 14px;background:#fafbfe}
.kpi .l{color:#69748a;font-size:11px} .kpi .v{font-size:20px;font-weight:700;margin-top:3px}
.kpi .d{font-size:11px;margin-top:4px}
table{width:100%;border-collapse:collapse;margin:6px 0}
th,td{text-align:left;padding:5px 8px;border-bottom:1px solid #eef1f6} th{color:#69748a;font-weight:600;font-size:10.5px;text-transform:uppercase;letter-spacing:.03em}
td:nth-child(n+2),th:nth-child(n+2){text-align:right}
.lvl-tip td{font-weight:700;background:#f4f7fc} .lvl-vid td{color:#3a4356}
.up{color:#0a8f5b} .down{color:#d63b3b} .flat{color:#8a94a6} .mut{color:#8a94a6;text-align:left!important}
.mv td:first-child{max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bar{display:flex;align-items:center;gap:8px;margin:3px 0}
.bl{width:150px;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.bt{flex:1;height:14px;background:#eef1f6;border-radius:7px;overflow:hidden}
.bf{display:block;height:100%;background:linear-gradient(90deg,#3b6ef5,#6b9bff)}
.bv{width:110px;text-align:right;font-size:11px;font-weight:600}
.foot{margin-top:26px;color:#9aa4b6;font-size:10px;border-top:1px solid #eef1f6;padding-top:8px}
@page{size:A4;margin:14mm}
`;

export function reportHtml(kind: "weekly" | "monthly", key?: string): string {
  const r: any = kind === "weekly" ? weeklyReport(key) : monthlyReport(key);
  const title = kind === "weekly" ? "Недельный отчёт по складским запасам" : "Месячный отчёт по складским запасам";
  const period =
    kind === "weekly"
      ? `Неделя от ${r.date}` + (r.prevDate ? ` · сравнение с ${r.prevDate}` : "")
      : `Месяц ${r.month}` + (r.prevMonth ? ` · сравнение с ${r.prevMonth}` : "");
  const t = r.totals;
  const tipBars = bars(r.tips.map((x: any) => ({ label: x.label, value: x.money })));

  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <h1>${title}</h1>
  <p class="sub">${period} · сформировано автоматически на реальных данных</p>

  <div class="kpis">
    <div class="kpi"><div class="l">Заморожено в деньгах</div><div class="v">${fmtMoney(t.money)}</div>
      <div class="d ${cls(t.vsPrev.money.pct)}">${pct(t.vsPrev.money.pct)} к пред. · <span class="${cls(
        t.vsAvg.money.pct,
      )}">${pct(t.vsAvg.money.pct)}</span> к среднему</div></div>
    <div class="kpi"><div class="l">Тоннаж на складе</div><div class="v">${fmtKg(t.kg)}</div>
      <div class="d ${cls(t.vsPrev.kg.pct)}">${pct(t.vsPrev.kg.pct)} к пред.</div></div>
    <div class="kpi"><div class="l">${kind === "weekly" ? "Средняя неделя" : "Средний месяц"}</div>
      <div class="v">${fmtMoney(t.avgMoney)}</div><div class="d mut">база сравнения</div></div>
  </div>

  <h2>Структура по категориям (деньги)</h2>
  ${tipBars}

  <h2>Разбивка: тип → вид</h2>
  <table><thead><tr><th>Категория</th><th>Тоннаж</th><th>Деньги</th><th>Δ к пред.</th><th>Δ к сред.</th></tr></thead>
  <tbody>${breakdownRows(r.tips)}</tbody></table>

  <h2>Ключевые движения за период</h2>
  ${moversTable("Рост запаса", r.movers.grew, "up")}
  ${moversTable("Снижение запаса", r.movers.fell, "down")}

  <div class="foot">Складской дашборд · данные из 1С · отчёт носит справочный характер, цены модельные (до подключения прайса из 1С).</div>
  </body></html>`;
}

function pageWrap(title: string, sub: string, body: string): string {
  return `<!doctype html><html lang="ru"><head><meta charset="utf-8"><style>${CSS}</style></head><body>
  <h1>${esc(title)}</h1><p class="sub">${esc(sub)}</p>${body}
  <div class="foot">Складской дашборд · данные из 1С · справочный отчёт, цены модельные (до подключения прайса из 1С).</div>
  </body></html>`;
}

/** Merge now/prev/avg share breakdowns into rows keyed by value. */
function shareRows(comp: any): string {
  const map = new Map<string, { now: number; prev: number; avg: number; money: number }>();
  const put = (arr: any[], k: "now" | "prev" | "avg") => {
    for (const r of arr) {
      const e = map.get(r.value) ?? { now: 0, prev: 0, avg: 0, money: 0 };
      (e as any)[k] = r.sharePct;
      if (k === "now") e.money = r.money;
      map.set(r.value, e);
    }
  };
  put(comp.now, "now");
  put(comp.prev, "prev");
  put(comp.avg, "avg");
  return [...map.entries()]
    .sort((a, b) => b[1].now - a[1].now)
    .map(
      ([value, e]) =>
        `<tr><td>${esc(value)}</td><td>${fmtMoney(e.money)}</td><td>${e.now.toFixed(1)}%</td>
         <td>${e.prev.toFixed(1)}%</td><td>${e.avg.toFixed(1)}%</td>
         <td class="${cls(e.now - e.avg)}">${pct(e.now - e.avg)}</td></tr>`,
    )
    .join("");
}

function dimNow(comp: any, title: string): string {
  return `<h3>${title}</h3><table><thead><tr><th>Значение</th><th>Деньги</th><th>Доля</th></tr></thead><tbody>${comp.now
    .map((r: any) => `<tr><td>${esc(r.value)}</td><td>${fmtMoney(r.money)}</td><td>${r.sharePct.toFixed(1)}%</td></tr>`)
    .join("")}</tbody></table>`;
}

export function scopeReportHtml(scope: Omit<CompetitiveParams, "dim" | "type">): string {
  const base: CompetitiveParams = { type: "category", ...scope, dim: "subcategory" };
  const sub = competitive(base);
  const cp = competitive({ ...base, dim: "counterparty" });
  const mg = competitive({ ...base, dim: "manager" });

  const label = scope.grp ?? scope.vid ?? scope.tip ?? "Все запасы";
  const hist = sub.scopeHistory;
  const last = hist[hist.length - 1] ?? { money: 0, kg: 0 };
  const prev = hist[hist.length - 2] ?? last;
  const tail = hist.slice(Math.max(0, hist.length - 9), hist.length - 1);
  const avgMoney = tail.length ? tail.reduce((s, r) => s + r.money, 0) / tail.length : last.money;
  const dPrev = prev.money ? ((last.money - prev.money) / prev.money) * 100 : 0;
  const dAvg = avgMoney ? ((last.money - avgMoney) / avgMoney) * 100 : 0;

  const body = `
  <div class="kpis">
    <div class="kpi"><div class="l">Заморожено в деньгах</div><div class="v">${fmtMoney(last.money)}</div>
      <div class="d ${cls(dPrev)}">${pct(dPrev)} к пред. · <span class="${cls(dAvg)}">${pct(dAvg)}</span> к среднему</div></div>
    <div class="kpi"><div class="l">Тоннаж</div><div class="v">${fmtKg(last.kg)}</div><div class="d mut">на ${esc(sub.cur)}</div></div>
    <div class="kpi"><div class="l">Подкатегорий (${esc(sub.childLabel ?? "")})</div><div class="v">${sub.now.length}</div>
      <div class="d mut">в разделе</div></div>
  </div>

  <h2>Доли подкатегорий: сейчас · прошлый · средний</h2>
  <table><thead><tr><th>${esc(sub.childLabel ?? "Подкатегория")}</th><th>Деньги</th><th>Сейчас</th><th>Пред.</th><th>Средн.</th><th>Δ сейчас-средн.</th></tr></thead>
  <tbody>${shareRows(sub)}</tbody></table>

  <h2>Конкурентный разрез</h2>
  ${dimNow(cp, "По заказчикам / поставщикам")}
  ${dimNow(mg, "По менеджерам")}
  `;
  return pageWrap(`Отчёт по разделу: ${label}`, `Актуально на ${sub.cur} · сравнение с ${sub.prevDate ?? "—"}`, body);
}

export function positionReportHtml(id: string): string {
  const c = positionCard(id);
  if (!c) return pageWrap("Позиция не найдена", "", "<p>Нет данных.</p>");

  const hist = c.history;
  const last = hist[hist.length - 1] ?? { money: 0, kg: 0 };
  const prev = hist[hist.length - 2] ?? last;
  const maxKg = Math.max(...hist.map((h: any) => h.kg), 0);
  const minKg = Math.min(...hist.map((h: any) => h.kg), 0);
  const dPrev = prev.money ? ((last.money - prev.money) / prev.money) * 100 : 0;

  const expRows = c.expiry
    .filter((b: any) => b.kg > 0)
    .map((b: any) => `<tr><td>${esc(b.label)}</td><td>${fmtKg(b.kg)}</td><td>${fmtMoney(b.money)}</td><td>${b.batches}</td></tr>`)
    .join("");

  const dimTable = (rows: any[], title: string) =>
    `<h3>${title}</h3><table><thead><tr><th>Значение</th><th>Тоннаж</th><th>Деньги</th><th>Партий</th></tr></thead><tbody>${rows
      .map((r) => `<tr><td>${esc(r.value)}</td><td>${fmtKg(r.kg)}</td><td>${fmtMoney(r.money)}</td><td>${r.batches}</td></tr>`)
      .join("")}</tbody></table>`;

  const batches = [...c.batches].sort((a, b) => b.money - a.money).slice(0, 30);
  const batchRows = batches
    .map(
      (b) =>
        `<tr><td>${esc(b.series || "—")}</td><td>${fmtKg(b.kg)}</td><td>${esc(b.manufactured ?? "—")}</td>
         <td>${esc(b.best_before ?? "—")}</td><td class="${b.days_left != null && b.days_left < 0 ? "down" : ""}">${
           b.days_left == null ? "—" : b.days_left < 0 ? "просроч." : b.days_left + "д"
         }</td><td>${esc(b.manager ?? "—")}</td><td>${esc(b.counterparty ?? "—")}</td><td>${fmtMoney(b.money)}</td></tr>`,
    )
    .join("");

  const body = `
  <div class="kpis">
    <div class="kpi"><div class="l">Заморожено</div><div class="v">${fmtMoney(c.money)}</div>
      <div class="d ${cls(dPrev)}">${pct(dPrev)} к пред. неделе</div></div>
    <div class="kpi"><div class="l">Остаток</div><div class="v">${fmtKg(c.kg)}</div><div class="d mut">цена ${fmtMoney(c.price)}/кг</div></div>
    <div class="kpi"><div class="l">Партий</div><div class="v">${c.batchCount}</div><div class="d mut">на ${esc(hist[hist.length - 1]?.date ?? "")}</div></div>
    <div class="kpi"><div class="l">Диапазон остатка (78 нед.)</div><div class="v" style="font-size:14px">${fmtKg(minKg)} – ${fmtKg(maxKg)}</div></div>
  </div>

  <h2>Сроки годности</h2>
  <table><thead><tr><th>Группа</th><th>Тоннаж</th><th>Деньги</th><th>Партий</th></tr></thead><tbody>${expRows}</tbody></table>

  <h2>Конкурентный разрез позиции</h2>
  ${dimTable(c.counterparties, "По заказчикам / поставщикам")}
  ${dimTable(c.managers, "По менеджерам")}

  <h2>Партии (топ‑30 по сумме)</h2>
  <table><thead><tr><th>Серия</th><th>Остаток</th><th>Изготовлено</th><th>Годен до</th><th>Осталось</th><th>Менеджер</th><th>Контрагент</th><th>₽</th></tr></thead>
  <tbody>${batchRows}</tbody></table>
  `;
  return pageWrap(c.name, `${c.tip} · ${c.vid} · ${c.grp}`, body);
}

/** Печатная версия отчёта по срокам годности с детализацией по номенклатуре. */
export function expiryReportHtml(params: ExpiryParams = {}): string {
  const r = expiryReport({ ...params, limit: params.limit ?? 400 });

  const bucketRows = r.buckets
    .filter((b) => b.batches > 0)
    .map(
      (b) =>
        `<tr${b.bucket === "overdue" ? ' class="down"' : ""}><td>${esc(b.label)}</td>
         <td>${fmtKg(b.kg)}</td><td>${fmtMoney(b.money)}</td><td>${b.batches}</td></tr>`,
    )
    .join("");

  const daysCell = (d: number | null) =>
    d == null
      ? '<td class="mut">—</td>'
      : d < 0
        ? `<td class="down">просрочено ${-d}д</td>`
        : `<td${d <= 30 ? ' class="down"' : ""}>${d}д</td>`;

  const posRows = r.rows
    .map((row) => {
      const head =
        `<tr class="lvl-tip"><td>${esc(row.name)}</td><td class="mut">${esc(row.tip)} · ${esc(
          row.grp,
        )}</td><td>${esc(row.nearest ?? "—")}</td>${daysCell(row.daysLeft)}
         <td>${fmtKg(row.kg)}</td><td>${fmtMoney(row.money)}</td><td>${row.batches}</td></tr>`;
      const items = row.items
        .map(
          (b) =>
            `<tr><td class="mut">└ серия ${esc(b.series || "—")}</td>
             <td class="mut">${esc(b.manager ?? "—")} / ${esc(b.counterparty ?? "—")}</td>
             <td>${esc(b.bestBefore ?? "—")}</td>${daysCell(b.daysLeft)}
             <td>${fmtKg(b.kg)}</td><td>${fmtMoney(b.money)}</td><td></td></tr>`,
        )
        .join("");
      return head + items;
    })
    .join("");

  const f = r.filter;
  const filters = [
    f.tip ? `тип: ${f.tip}` : "все типы",
    f.bucket ? `срок: ${EXPIRY_LABELS[f.bucket]}` : null,
    f.withinDays != null ? `истекает в ближайшие ${f.withinDays} дн.` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  const body = `
  <div class="kpis">
    <div class="kpi"><div class="l">Позиций в отчёте</div><div class="v">${r.totals.positions}</div>
      <div class="d mut">партий ${r.totals.batches}</div></div>
    <div class="kpi"><div class="l">Остаток</div><div class="v">${fmtKg(r.totals.kg)}</div></div>
    <div class="kpi"><div class="l">Заморожено</div><div class="v">${fmtMoney(r.totals.money)}</div></div>
    <div class="kpi"><div class="l">Просрочено</div><div class="v ${
      r.totals.overdueKg > 0 ? "down" : ""
    }">${fmtKg(r.totals.overdueKg)}</div></div>
  </div>

  <h2>Сводка по срокам</h2>
  <table><thead><tr><th>Группа</th><th>Остаток</th><th>Деньги</th><th>Партий</th></tr></thead>
  <tbody>${bucketRows}</tbody></table>

  <h2>Детализация по номенклатуре</h2>
  <table><thead><tr><th>Номенклатура</th><th>Тип / группа</th><th>Годен до</th><th>Осталось</th>
  <th>Остаток</th><th>Деньги</th><th>Партий</th></tr></thead><tbody>${posRows}</tbody></table>
  ${r.truncated ? '<p class="mut">Список обрезан: показаны только первые позиции по срочности.</p>' : ""}
  `;
  return pageWrap("Сроки годности", `На ${r.date} · ${filters}`, body);
}
