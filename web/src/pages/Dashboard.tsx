import React, { useState } from "react";
import { api } from "../api";
import { Card, DeltaBadge, ErrorBox, Loading, useAsync } from "../ui";
import { Donut, HBars, TrendArea } from "../components/charts";
import { fmtDate, fmtNum, money, moneyFull, PALETTE, pct, TIP_COLORS, weight } from "../format";

function Stat({
  label,
  value,
  sub,
  delta,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  delta?: number;
  accent?: string;
}) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />
      <div className="text-ink-mut text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1.5 num">{value}</div>
      <div className="flex items-center gap-2 mt-1.5">
        {delta !== undefined && <DeltaBadge value={delta} />}
        {sub && <span className="text-xs text-ink-faint">{sub}</span>}
      </div>
    </div>
  );
}

const EXP_COLORS: Record<string, string> = {
  overdue: "#d63b3b",
  d30: "#e08a1e",
  d60: "#f0b429",
  d90: "#8fb0ff",
  ok: "#123454",
  no_date: "#c7cfdd",
};

export default function Dashboard() {
  const { data, loading, error } = useAsync(() => api.dashboard(), []);
  const [metric, setMetric] = useState<"money" | "kg">("money");

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  if (!data) return null;

  const d = data;
  const tipData = d.byTip.map((t) => ({
    label: t.tip,
    value: metric === "money" ? t.money : t.kg,
    color: TIP_COLORS[t.tip] ?? "#f59c21",
  }));
  const vidData = d.topVids.slice(0, 8).map((v) => ({
    label: v.vid,
    value: metric === "money" ? v.money : v.kg,
  }));
  const expiryActive = d.expiry.filter((b) => b.kg > 0);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Дашборд складских запасов</h1>
          <p className="text-ink-mut text-sm">
            Общая картина на {fmtDate(d.currentDate)} · сравнение с {fmtDate(d.prevDate)}
          </p>
        </div>
        <div className="flex gap-1 bg-white rounded-lg border border-line p-1">
          {(["money", "kg"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={
                "px-3 py-1.5 rounded-md text-sm font-medium transition " +
                (metric === m ? "bg-brand-500 text-white" : "text-ink-mut hover:bg-black/5")
              }
            >
              {m === "money" ? "₽ Деньги" : "Тоннаж"}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label="Заморожено в деньгах"
          value={money(d.totals.money)}
          delta={d.wow.moneyPct}
          sub={`${pct(d.vsAvg.moneyPct)} к среднему`}
          accent="#f59c21"
        />
        <Stat
          label="Тоннаж на складе"
          value={weight(d.totals.kg)}
          delta={d.wow.kgPct}
          sub={`${pct(d.vsAvg.kgPct)} к среднему`}
          accent="#123454"
        />
        <Stat label="Позиций в каталоге" value={fmtNum(d.totals.positions)} sub="номенклатур" accent="#f25830" />
        <Stat label="Партий / серий" value={fmtNum(d.totals.batches)} sub="строк остатков" accent="#00aeef" />
      </div>

      {/* trend + donut */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-4">
        <Card className="xl:col-span-2 p-4" title={`Динамика запасов · ${metric === "money" ? "деньги" : "тоннаж"}`} right={<span className="text-xs text-ink-faint">{d.trend.length} недель</span>}>
          <TrendArea data={d.trend} metric={metric} height={260} color={metric === "money" ? "#f59c21" : "#123454"} />
        </Card>
        <Card className="p-4" title="Структура по типам">
          <Donut data={tipData} height={190} />
          <div className="mt-3 space-y-1.5">
            {d.byTip.map((t) => (
              <div key={t.tip} className="flex items-center gap-2 text-sm">
                <span className="w-2.5 h-2.5 rounded-full" style={{ background: TIP_COLORS[t.tip] ?? "#f59c21" }} />
                <span className="flex-1 truncate text-ink-soft">{t.tip}</span>
                <span className="num font-semibold">{metric === "money" ? money(t.money) : weight(t.kg)}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      {/* vids + expiry */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <Card className="p-4" title="Топ категорий (вид номенклатуры)">
          <HBars data={vidData} metric={metric} height={260} />
        </Card>
        <Card className="p-4" title="Сроки годности партий">
          <div className="space-y-2.5 mt-1">
            {expiryActive.map((b) => {
              const maxKg = Math.max(...expiryActive.map((x) => x.kg));
              return (
                <div key={b.bucket} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-ink-soft shrink-0">{b.label}</span>
                  <div className="flex-1 h-6 rounded-md bg-line/50 overflow-hidden">
                    <div
                      className="h-full rounded-md flex items-center justify-end pr-2 text-[11px] font-semibold text-white"
                      style={{ width: Math.max(6, (b.kg / maxKg) * 100) + "%", background: EXP_COLORS[b.bucket] }}
                    >
                      {weight(b.kg)}
                    </div>
                  </div>
                  <span className="w-16 text-right text-xs text-ink-mut num">{fmtNum(b.batches)} парт.</span>
                </div>
              );
            })}
          </div>
          {d.expiry[0].kg > 0 && (
            <div className="mt-3 text-sm bg-red-50 text-down rounded-lg px-3 py-2">
              ⚠ Просрочено {weight(d.expiry[0].kg)} на {money(d.expiry[0].money)} — требует списания или переоценки.
            </div>
          )}
        </Card>
      </div>

      {/* managers + counterparties */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
        <DimTable title="Топ менеджеров (по партиям на складе)" rows={d.topManagers} metric={metric} />
        <DimTable title="Топ заказчиков / поставщиков" rows={d.topCounterparties} metric={metric} />
      </div>
    </div>
  );
}

function DimTable({
  title,
  rows,
  metric,
}: {
  title: string;
  rows: { value: string; kg: number; money: number; batches: number }[];
  metric: "money" | "kg";
}) {
  const max = Math.max(...rows.map((r) => (metric === "money" ? r.money : r.kg)), 1);
  return (
    <Card className="p-4" title={title}>
      <div className="space-y-2 mt-1">
        {rows.map((r, i) => {
          const v = metric === "money" ? r.money : r.kg;
          return (
            <div key={r.value} className="flex items-center gap-3 text-sm">
              <span className="w-5 text-ink-faint num">{i + 1}</span>
              <span className="w-40 truncate text-ink-soft" title={r.value}>{r.value}</span>
              <div className="flex-1 h-2 rounded-full bg-line/70 overflow-hidden">
                <div className="h-full rounded-full" style={{ width: (v / max) * 100 + "%", background: PALETTE[i % PALETTE.length] }} />
              </div>
              <span className="w-24 text-right num font-semibold">{metric === "money" ? money(r.money) : weight(r.kg)}</span>
            </div>
          );
        })}
      </div>
    </Card>
  );
}
