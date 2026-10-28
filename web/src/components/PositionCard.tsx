import React, { useState } from "react";
import { api } from "../api";
import { ColResizer, Loading, useAsync, useColumnWidths } from "../ui";
import { TrendArea } from "./charts";
import CompetitivePanel from "./Competitive";
import { fmtDate, fmtNum, money, moneyFull, PALETTE, weight } from "../format";

const TABS = [
  { k: "batches", label: "Партии" },
  { k: "dims", label: "Менеджеры · Заказчики" },
  { k: "history", label: "История" },
  { k: "competitive", label: "Конкурентный отчёт" },
] as const;
type Tab = (typeof TABS)[number]["k"];

function daysColor(d: number | null): string {
  if (d === null) return "text-ink-faint";
  if (d < 0) return "text-down font-semibold";
  if (d <= 30) return "text-warn font-semibold";
  if (d <= 60) return "text-warn";
  return "text-ink-soft";
}

export default function PositionCard({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, loading } = useAsync(() => api.position(id), [id]);
  const [tab, setTab] = useState<Tab>("batches");

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <div className="absolute inset-0 bg-panel/40 backdrop-blur-[1px]" onClick={onClose} />
      <div className="relative w-full max-w-6xl bg-bg h-full shadow-pop flex flex-col animate-[slidein_.18s_ease]">
        <style>{`@keyframes slidein{from{transform:translateX(24px);opacity:.4}to{transform:none;opacity:1}}`}</style>
        {loading || !data ? (
          <Loading />
        ) : (
          <>
            <div className="bg-white border-b border-line px-6 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-xs text-ink-mut mb-1">
                    {data.tip} · {data.vid} · {data.grp}
                  </div>
                  <h2 className="text-lg font-bold leading-snug">{data.name}</h2>
                </div>
                <button className="btn-ghost shrink-0 text-xl leading-none px-2" onClick={onClose}>
                  ✕
                </button>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
                <KPI label="Заморожено" value={money(data.money)} accent="#f59c21" />
                <KPI label="Остаток" value={weight(data.kg)} accent="#123454" />
                <KPI
                  label="Цена"
                  value={moneyFull(data.price) + "/кг"}
                  accent="#f25830"
                  hint={
                    data.kg > 0
                      ? "заморожено / остаток"
                      : "модельная цена по виду — остатка нет"
                  }
                />
                <KPI label="Партий" value={fmtNum(data.batchCount)} accent="#00aeef" />
              </div>
            </div>

            <div className="flex gap-1 px-6 pt-3 bg-white border-b border-line">
              {TABS.map((t) => (
                <button
                  key={t.k}
                  onClick={() => setTab(t.k)}
                  className={
                    "px-3 py-2 text-sm font-medium border-b-2 -mb-px transition " +
                    (tab === t.k
                      ? "border-brand-500 text-brand-600"
                      : "border-transparent text-ink-mut hover:text-ink")
                  }
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-auto p-6">
              {tab === "batches" && <BatchesTab data={data} />}
              {tab === "dims" && <DimsTab data={data} />}
              {tab === "history" && <HistoryTab data={data} />}
              {tab === "competitive" && (
                <CompetitivePanel scope={{ type: "position", id, label: data.name }} />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  accent,
  hint,
}: {
  label: string;
  value: string;
  accent: string;
  hint?: string;
}) {
  return (
    <div className="rounded-lg bg-bg border border-line px-3 py-2" title={hint}>
      <div className="text-[11px] text-ink-mut">{label}</div>
      <div className="font-bold num mt-0.5" style={{ color: accent }}>
        {value}
      </div>
      {hint && <div className="text-[10px] text-ink-faint leading-tight mt-0.5">{hint}</div>}
    </div>
  );
}

/** Колонки таблицы партий: ширины по умолчанию тянутся мышью, см. useColumnWidths. */
const COLS = [
  { key: "series", label: "Серия / партия", w: 190 },
  { key: "kg", label: "Остаток", w: 110, align: "right" as const },
  { key: "mfd", label: "Изготовлено", w: 120 },
  { key: "exp", label: "Годен до", w: 120 },
  { key: "left", label: "Осталось", w: 120, align: "right" as const },
  { key: "manager", label: "Менеджер", w: 170 },
  { key: "cp", label: "Контрагент", w: 220 },
  { key: "money", label: "₽", w: 130, align: "right" as const },
];

function Cell({
  children,
  align = "left",
  className = "",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={
        "px-3 py-2 break-words " + (align === "right" ? "text-right " : "") + className
      }
    >
      {children}
    </td>
  );
}

function BatchesTab({ data }: { data: any }) {
  const exp = data.expiry.filter((b: any) => b.kg > 0);
  const { widths, startResize, reset } = useColumnWidths(
    "position-batches",
    COLS.map((c) => c.w),
  );
  const total = widths.reduce((a, b) => a + b, 0);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {exp.map((b: any) => (
          <span
            key={b.bucket}
            className="tag border"
            style={{
              borderColor: b.bucket === "overdue" ? "#f3c0c0" : "#e6eaf2",
              background: b.bucket === "overdue" ? "#fdecec" : "#fff",
              color: b.bucket === "overdue" ? "#d63b3b" : "#3a4356",
            }}
          >
            {b.label}: {weight(b.kg)} · {b.batches} парт.
          </span>
        ))}
      </div>
      <div className="card overflow-x-auto">
        <table className="text-sm" style={{ width: total, tableLayout: "fixed" }}>
          <colgroup>
            {widths.map((w, i) => (
              <col key={i} style={{ width: w }} />
            ))}
          </colgroup>
          <thead>
            <tr className="text-left text-ink-mut text-xs bg-bg/60">
              {COLS.map((c, i) => (
                <th
                  key={c.key}
                  className={
                    "px-3 py-2 font-semibold relative " + (c.align === "right" ? "text-right" : "")
                  }
                >
                  <span className="block truncate">{c.label}</span>
                  {i < COLS.length - 1 && <ColResizer onMouseDown={startResize(i)} />}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.batches.map((b: any, i: number) => (
              <tr key={i} className="border-t border-line/70 hover:bg-bg/50 align-top">
                <Cell className="font-medium">{b.series || "—"}</Cell>
                <Cell align="right" className="num">{weight(b.kg)}</Cell>
                <Cell className="text-ink-mut num">{fmtDate(b.manufactured)}</Cell>
                <Cell className="num">{fmtDate(b.best_before)}</Cell>
                <Cell align="right" className={"num " + daysColor(b.days_left)}>
                  {b.days_left === null ? "—" : b.days_left < 0 ? `просроч. ${-b.days_left}д` : `${b.days_left} дн`}
                </Cell>
                <Cell className="text-ink-soft">{b.manager || "—"}</Cell>
                <Cell className="text-ink-soft">{b.counterparty || "—"}</Cell>
                <Cell align="right" className="num">{money(b.money)}</Cell>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="text-xs text-ink-faint flex items-center gap-3">
        <span>Ширину колонок можно тянуть за границу заголовка — настройка сохраняется.</span>
        <button className="link" onClick={reset}>
          Сбросить ширины
        </button>
      </div>
    </div>
  );
}

function DimBars({ title, rows }: { title: string; rows: any[] }) {
  const max = Math.max(...rows.map((r) => r.money), 1);
  return (
    <div className="card p-4">
      <h4 className="text-sm font-semibold text-ink-soft mb-3">{title}</h4>
      {rows.length === 0 && <div className="text-sm text-ink-faint">Нет данных</div>}
      <div className="space-y-2.5">
        {rows.map((r, i) => (
          <div key={r.value} className="text-sm">
            <div className="flex justify-between mb-1">
              <span className="text-ink-soft truncate pr-2">{r.value}</span>
              <span className="num font-semibold shrink-0">{money(r.money)}</span>
            </div>
            <div className="h-2 rounded-full bg-line/70 overflow-hidden">
              <div className="h-full rounded-full" style={{ width: (r.money / max) * 100 + "%", background: PALETTE[i % PALETTE.length] }} />
            </div>
            <div className="text-[11px] text-ink-faint mt-0.5">{weight(r.kg)} · {r.batches} партий</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DimsTab({ data }: { data: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <DimBars title="Менеджеры" rows={data.managers} />
      <DimBars title="Заказчики / поставщики" rows={data.counterparties} />
    </div>
  );
}

function HistoryTab({ data }: { data: any }) {
  const [metric, setMetric] = useState<"money" | "kg">("money");
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-sm font-semibold text-ink-soft">Динамика остатка позиции (78 недель)</h4>
        <div className="flex gap-1 bg-bg rounded-lg border border-line p-0.5">
          {(["money", "kg"] as const).map((m) => (
            <button key={m} onClick={() => setMetric(m)} className={"px-2.5 py-1 rounded-md text-xs font-medium " + (metric === m ? "bg-brand-500 text-white" : "text-ink-mut")}>
              {m === "money" ? "₽" : "кг"}
            </button>
          ))}
        </div>
      </div>
      <TrendArea data={data.history} metric={metric} height={280} color={metric === "money" ? "#f59c21" : "#123454"} />
    </div>
  );
}
