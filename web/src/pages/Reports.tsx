import React, { useEffect, useMemo, useState } from "react";
import { api, ScopeReport, ScopeChild } from "../api";
import { Card, DeltaBadge, ErrorBox, Loading, useAsync } from "../ui";
import { TrendArea } from "../components/charts";
import CompetitivePanel from "../components/Competitive";
import { fmtDate, money, pct, TIP_COLORS, weight } from "../format";

interface Scope {
  tip?: string;
  vid?: string;
  grp?: string;
}

export default function Reports() {
  const [kind, setKind] = useState<"weekly" | "monthly">("weekly");
  const [period, setPeriod] = useState<string | undefined>(undefined);
  const [scope, setScope] = useState<Scope>({});
  const [metric, setMetric] = useState<"money" | "kg">("money");

  const weeks = useAsync(() => api.weeks(), []);
  const months = useAsync(() => api.months(), []);
  const rep = useAsync(
    () => api.scopeReport({ ...scope, kind, period }),
    [scope.tip, scope.vid, scope.grp, kind, period],
  );

  const periods =
    kind === "weekly"
      ? (weeks.data ?? []).map((d) => ({ value: d, label: "Неделя от " + fmtDate(d) }))
      : (months.data ?? []).map((m) => ({ value: m.month, label: m.month }));

  const crumbs = useMemo(() => {
    const arr: { label: string; go: Scope }[] = [{ label: "Все данные", go: {} }];
    if (scope.tip) arr.push({ label: scope.tip, go: { tip: scope.tip } });
    if (scope.vid) arr.push({ label: scope.vid, go: { tip: scope.tip, vid: scope.vid } });
    if (scope.grp) arr.push({ label: scope.grp, go: { ...scope } });
    return arr;
  }, [scope]);

  const drill = (c: ScopeChild) => {
    if (!c.hasChildren) return;
    if (!scope.tip) setScope({ tip: c.key });
    else if (!scope.vid) setScope({ tip: scope.tip, vid: c.key });
    else if (!scope.grp) setScope({ tip: scope.tip, vid: scope.vid, grp: c.key });
  };

  const pdfHref = scope.tip
    ? api.scopePdfUrl(scope)
    : api.pdfUrl(kind, period);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Отчёты по складским запасам</h1>
          <p className="text-ink-mut text-sm">
            Сверху — вся картина, ниже — раскрытие по категориям. История доступна за весь период.
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1 bg-white rounded-lg border border-line p-1">
            {(["weekly", "monthly"] as const).map((k) => (
              <button
                key={k}
                onClick={() => {
                  setKind(k);
                  setPeriod(undefined);
                }}
                className={"px-3 py-1.5 rounded-md text-sm font-medium " + (kind === k ? "bg-brand-500 text-white" : "text-ink-mut hover:bg-black/5")}
              >
                {k === "weekly" ? "Недельный" : "Месячный"}
              </button>
            ))}
          </div>
          <select
            value={period ?? ""}
            onChange={(e) => setPeriod(e.target.value || undefined)}
            className="rounded-lg border border-line px-3 py-2 text-sm bg-white outline-none focus:border-brand-500 max-w-[190px]"
          >
            <option value="">Последний период</option>
            {periods.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          <a href={pdfHref} target="_blank" rel="noreferrer" className="btn-primary">
            ⬇ PDF
          </a>
        </div>
      </div>

      {/* breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm flex-wrap">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-ink-faint">/</span>}
            <button
              onClick={() => setScope(c.go)}
              className={i === crumbs.length - 1 ? "font-semibold text-ink" : "link"}
            >
              {c.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {rep.loading ? (
        <Loading />
      ) : rep.error ? (
        <ErrorBox msg={rep.error} />
      ) : rep.data ? (
        <ReportBody r={rep.data} metric={metric} setMetric={setMetric} onDrill={drill} scope={scope} />
      ) : null}
    </div>
  );
}

function ReportBody({
  r,
  metric,
  setMetric,
  onDrill,
  scope,
}: {
  r: ScopeReport;
  metric: "money" | "kg";
  setMetric: (m: "money" | "kg") => void;
  onDrill: (c: ScopeChild) => void;
  scope: Scope;
}) {
  const t = r.totals;
  const periodName =
    r.kind === "weekly" ? `неделя от ${fmtDate(r.target)}` : `месяц ${r.targetMonth}`;
  const prevName = r.kind === "weekly" ? fmtDate(r.prevDate) : "пред. месяц";
  const avgName = r.kind === "weekly" ? `${r.avgCount} нед.` : `${r.avgCount} мес.`;

  return (
    <div className="space-y-5">
      {/* KPI row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="p-5">
          <div className="text-xs text-ink-mut uppercase tracking-wide">Заморожено · {r.label}</div>
          <div className="text-3xl font-bold num mt-1">{money(t.money)}</div>
          <div className="flex items-center gap-3 mt-2">
            <DeltaBadge value={t.vsPrev.money.pct} />
            <span className="text-xs text-ink-faint">к пред. ({prevName})</span>
          </div>
          <div className="flex items-center gap-3 mt-1">
            <DeltaBadge value={t.vsAvg.money.pct} />
            <span className="text-xs text-ink-faint">к среднему ({avgName})</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-ink-mut uppercase tracking-wide">Тоннаж</div>
          <div className="text-3xl font-bold num mt-1">{weight(t.kg)}</div>
          <div className="flex items-center gap-3 mt-2">
            <DeltaBadge value={t.vsPrev.kg.pct} />
            <span className="text-xs text-ink-faint">к пред.</span>
          </div>
        </Card>
        <Card className="p-5">
          <div className="text-xs text-ink-mut uppercase tracking-wide">Период</div>
          <div className="text-lg font-bold mt-1 capitalize">{periodName}</div>
          <div className="text-sm text-ink-soft mt-1 leading-relaxed">
            Сравнение с предыдущим и средним ({avgName}). Ниже — раскрытие и вся история.
          </div>
        </Card>
      </div>

      {/* full-period history */}
      <Card
        className="p-4"
        title={`История за весь период · ${r.label}`}
        right={
          <div className="flex items-center gap-2">
            <span className="text-xs text-ink-faint">{r.history.length} точек</span>
            <div className="flex gap-1 bg-bg rounded-lg border border-line p-0.5">
              {(["money", "kg"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={"px-2.5 py-1 rounded-md text-xs font-medium " + (metric === m ? "bg-brand-500 text-white" : "text-ink-mut")}
                >
                  {m === "money" ? "₽" : "кг"}
                </button>
              ))}
            </div>
          </div>
        }
      >
        <TrendArea data={r.history} metric={metric} height={260} color={metric === "money" ? "#f59c21" : "#123454"} />
      </Card>

      {/* children breakdown */}
      {r.children.length > 0 && (
        <Card className="p-4" title={`Раскрытие · ${r.childLabel ?? "категории"}`}>
          <div className="overflow-hidden rounded-lg border border-line">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-ink-mut text-xs bg-bg/60">
                  <th className="px-4 py-2.5 font-semibold">{r.childLabel}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Тоннаж</th>
                  <th className="px-4 py-2.5 font-semibold w-40">Доля</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Заморожено</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Δ пред.</th>
                  <th className="px-4 py-2.5 font-semibold text-right">Δ сред.</th>
                  <th className="px-4 py-2.5 w-6"></th>
                </tr>
              </thead>
              <tbody>
                {r.children.map((c) => (
                  <tr
                    key={c.key}
                    onClick={() => onDrill(c)}
                    className={
                      "border-t border-line/70 " +
                      (c.hasChildren ? "cursor-pointer hover:bg-brand-50/50" : "")
                    }
                  >
                    <td className="px-4 py-2.5 font-medium max-w-md">
                      {c.level === "tip" && (
                        <span
                          className="inline-block w-2.5 h-2.5 rounded-full mr-2 align-middle"
                          style={{ background: TIP_COLORS[c.label] ?? "#f59c21" }}
                        />
                      )}
                      <span className="align-middle">{c.label}</span>
                    </td>
                    <td className="px-4 py-2.5 text-right num">{weight(c.kg)}</td>
                    <td className="px-4 py-2.5">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-line/70 overflow-hidden">
                          <div className="h-full rounded-full bg-brand-500" style={{ width: c.sharePct + "%" }} />
                        </div>
                        <span className="w-10 text-right text-xs num text-ink-mut">{c.sharePct}%</span>
                      </div>
                    </td>
                    <td className="px-4 py-2.5 text-right num font-semibold">{money(c.money)}</td>
                    <td className="px-4 py-2.5 text-right"><DeltaBadge value={c.vsPrev.money.pct} /></td>
                    <td className="px-4 py-2.5 text-right"><DeltaBadge value={c.vsAvg.money.pct} /></td>
                    <td className="px-4 py-2.5 text-ink-faint">{c.hasChildren ? "›" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {r.children.some((c) => c.hasChildren) && (
            <p className="text-xs text-ink-faint mt-2">Нажмите на строку, чтобы открыть отчёт по этому блоку.</p>
          )}
        </Card>
      )}

      {/* movers */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MoversCard title="Рост запаса за период" rows={r.movers.grew} dir="up" />
        <MoversCard title="Снижение запаса за период" rows={r.movers.fell} dir="down" />
      </div>

      {/* competitive for this scope */}
      <CompetitivePanel scope={{ type: "category", tip: scope.tip, vid: scope.vid, grp: scope.grp, label: r.label }} />
    </div>
  );
}

function MoversCard({ title, rows, dir }: { title: string; rows: any[]; dir: "up" | "down" }) {
  return (
    <Card className="p-4" title={title}>
      {rows.length === 0 ? (
        <div className="text-sm text-ink-faint py-4">Нет значимых изменений</div>
      ) : (
        <div className="space-y-1.5 mt-1">
          {rows.map((m, i) => (
            <div key={i} className="flex items-center gap-3 text-sm py-1.5 border-b border-line/50 last:border-0">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{m.name}</div>
                <div className="text-xs text-ink-faint">{m.tip} · {m.vid}</div>
              </div>
              <div className="text-right shrink-0">
                <div className="num font-semibold">{money(m.curMoney)}</div>
                <div className={"text-xs num font-semibold " + (dir === "up" ? "text-up" : "text-down")}>{pct(m.diffPct)}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
