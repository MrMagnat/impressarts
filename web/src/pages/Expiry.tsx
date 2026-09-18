import React, { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api, ExpiryRow } from "../api";
import { Card, ErrorBox, Loading, useAsync } from "../ui";
import { fmtDate, fmtNum, money, TIP_COLORS, weight } from "../format";

const BUCKET_COLORS: Record<string, string> = {
  overdue: "#d63b3b",
  d30: "#e08a1e",
  d60: "#f0b429",
  d90: "#8fb0ff",
  ok: "#123454",
  no_date: "#c7cfdd",
};

/** Подпись «сколько осталось» с цветом по срочности. */
function DaysLeft({ days }: { days: number | null }) {
  if (days == null) return <span className="text-ink-faint">без срока</span>;
  if (days < 0) return <span className="text-down font-semibold num">просрочено {-days} дн.</span>;
  const cls = days <= 30 ? "text-down" : days <= 60 ? "text-amber-700" : "text-ink-soft";
  return <span className={cls + " num"}>{days} дн.</span>;
}

export default function Expiry() {
  const [params, setParams] = useSearchParams();
  const tip = params.get("tip") ?? "";
  const bucket = params.get("bucket") ?? "";
  const [open, setOpen] = useState<Set<string>>(new Set());

  const { data, loading, error } = useAsync(
    () => api.expiryReport({ tip: tip || undefined, bucket: bucket || undefined, limit: 300 }),
    [tip, bucket],
  );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next, { replace: true });
  };

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(id) ? n.delete(id) : n.add(id);
      return n;
    });

  if (loading) return <Loading />;
  if (error) return <ErrorBox msg={error} />;
  if (!data) return null;

  const active = data.buckets.filter((b) => b.batches > 0);
  const maxKg = Math.max(...active.map((b) => b.kg), 1);

  return (
    <div className="space-y-5">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Сроки годности</h1>
          <p className="text-ink-mut text-sm">
            Партии на складе по состоянию на {fmtDate(data.date)} — что горит первым, с разбором по
            номенклатуре
          </p>
        </div>
        <a
          className="btn-line"
          href={api.expiryPdfUrl({ tip: tip || undefined, bucket: bucket || undefined })}
          target="_blank"
          rel="noreferrer"
        >
          Скачать PDF
        </a>
      </div>

      {/* KPI */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Tile label="Позиций в отчёте" value={fmtNum(data.totals.positions)} sub={fmtNum(data.totals.batches) + " партий"} />
        <Tile label="Остаток" value={weight(data.totals.kg)} />
        <Tile label="Заморожено" value={money(data.totals.money)} />
        <Tile
          label="Просрочено"
          value={weight(data.totals.overdueKg)}
          accent={data.totals.overdueKg > 0 ? "#d63b3b" : undefined}
        />
      </div>

      {/* фильтры */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-1 bg-white rounded-lg border border-line p-1 flex-wrap">
          <Chip label="Все типы" active={tip === ""} onClick={() => setFilter("tip", "")} />
          {data.tips.map((t) => (
            <Chip
              key={t}
              label={t}
              color={TIP_COLORS[t]}
              active={tip === t}
              onClick={() => setFilter("tip", t)}
            />
          ))}
        </div>
        <div className="flex gap-1 bg-white rounded-lg border border-line p-1 flex-wrap">
          <Chip label="Любой срок" active={bucket === ""} onClick={() => setFilter("bucket", "")} />
          {data.buckets.map((b) => (
            <Chip
              key={b.bucket}
              label={b.label}
              color={BUCKET_COLORS[b.bucket]}
              active={bucket === b.bucket}
              onClick={() => setFilter("bucket", b.bucket)}
              disabled={b.batches === 0}
            />
          ))}
        </div>
      </div>

      {/* сводка по корзинам */}
      <Card className="p-4" title={"Сводка по срокам" + (tip ? " · " + tip : "")}>
        <div className="space-y-2.5 mt-1">
          {active.map((b) => (
            <button
              key={b.bucket}
              onClick={() => setFilter("bucket", bucket === b.bucket ? "" : b.bucket)}
              className="w-full flex items-center gap-3 text-left"
            >
              <span className="w-24 text-sm text-ink-soft shrink-0">{b.label}</span>
              <span className="flex-1 h-5 rounded-md bg-line/50 overflow-hidden block">
                <span
                  className="h-full rounded-md block"
                  style={{
                    width: Math.max(1.5, (b.kg / maxKg) * 100) + "%",
                    background: BUCKET_COLORS[b.bucket],
                  }}
                />
              </span>
              <span className="w-24 text-right text-sm num font-semibold shrink-0">{weight(b.kg)}</span>
              <span className="w-20 text-right text-xs text-ink-mut num shrink-0">{fmtNum(b.batches)} парт.</span>
              <span className="w-28 text-right text-sm num shrink-0">{money(b.money)}</span>
            </button>
          ))}
        </div>
      </Card>

      {/* детализация */}
      <Card
        title={`Детализация по номенклатуре · ${data.rows.length} позиций`}
        right={<span className="text-xs text-ink-faint">отсортировано по ближайшему сроку</span>}
        className="overflow-hidden"
      >
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-mut text-xs bg-bg/60">
              <th className="px-4 py-2.5 font-semibold">Номенклатура</th>
              <th className="px-4 py-2.5 font-semibold w-44">Тип / группа</th>
              <th className="px-4 py-2.5 font-semibold w-28">Годен до</th>
              <th className="px-4 py-2.5 font-semibold w-32">Осталось</th>
              <th className="px-4 py-2.5 font-semibold text-right w-24">Остаток</th>
              <th className="px-4 py-2.5 font-semibold text-right w-28">Заморожено</th>
              <th className="px-4 py-2.5 font-semibold text-right w-20">Партий</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-ink-faint">
                  Под фильтр ничего не попало
                </td>
              </tr>
            )}
            {data.rows.map((r) => (
              <Row key={r.id} row={r} open={open.has(r.id)} onToggle={() => toggle(r.id)} />
            ))}
          </tbody>
        </table>
      </Card>

      {data.truncated && (
        <p className="text-xs text-ink-faint">
          Показаны первые {data.rows.length} позиций по срочности. Сузьте фильтр, чтобы увидеть
          остальные.
        </p>
      )}

      <p className="text-xs text-ink-faint">
        Отчёт считается по партиям текущего снимка, поэтому он всегда про «сейчас на складе»:
        построить его задним числом нельзя.
      </p>
    </div>
  );
}

function Row({ row, open, onToggle }: { row: ExpiryRow; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr
        onClick={onToggle}
        className={
          "border-t border-line/70 cursor-pointer hover:bg-brand-50/40 " +
          (row.bucket === "overdue" ? "bg-red-50/40" : "")
        }
      >
        <td className="px-4 py-2.5 font-medium max-w-md">
          <span className="text-ink-faint mr-1.5">{open ? "▾" : "▸"}</span>
          <span className="align-middle">{row.name}</span>
        </td>
        <td className="px-4 py-2.5 text-xs text-ink-mut">
          <span className="inline-block w-2 h-2 rounded-full mr-1.5" style={{ background: TIP_COLORS[row.tip] ?? "#f59c21" }} />
          {row.tip} · {row.grp}
        </td>
        <td className="px-4 py-2.5 num">{row.nearest ? fmtDate(row.nearest) : "—"}</td>
        <td className="px-4 py-2.5"><DaysLeft days={row.daysLeft} /></td>
        <td className="px-4 py-2.5 text-right num">{weight(row.kg)}</td>
        <td className="px-4 py-2.5 text-right num font-semibold">{money(row.money)}</td>
        <td className="px-4 py-2.5 text-right num text-ink-mut">{row.batches}</td>
      </tr>
      {open &&
        row.items.map((b, i) => (
          <tr key={i} className="bg-bg/40 text-xs">
            <td className="px-4 py-1.5 pl-10 text-ink-mut">серия {b.series || "—"}</td>
            <td className="px-4 py-1.5 text-ink-mut truncate">
              {b.manager ?? "—"} / {b.counterparty ?? "—"}
            </td>
            <td className="px-4 py-1.5 num">{b.bestBefore ? fmtDate(b.bestBefore) : "—"}</td>
            <td className="px-4 py-1.5"><DaysLeft days={b.daysLeft} /></td>
            <td className="px-4 py-1.5 text-right num">{weight(b.kg)}</td>
            <td className="px-4 py-1.5 text-right num">{money(b.money)}</td>
            <td className="px-4 py-1.5"></td>
          </tr>
        ))}
    </>
  );
}

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      {accent && <div className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />}
      <div className="text-ink-mut text-xs font-medium uppercase tracking-wide">{label}</div>
      <div className="text-2xl font-bold mt-1.5 num" style={accent ? { color: accent } : undefined}>
        {value}
      </div>
      {sub && <div className="text-xs text-ink-faint mt-1">{sub}</div>}
    </div>
  );
}

function Chip({
  label,
  color,
  active,
  disabled,
  onClick,
}: {
  label: string;
  color?: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={
        "px-3 py-1 rounded-md text-sm font-medium transition flex items-center gap-1.5 " +
        (active ? "bg-brand-500 text-white" : "text-ink-mut hover:bg-black/5") +
        (disabled ? " opacity-40 pointer-events-none" : "")
      }
    >
      {color && <span className="w-2 h-2 rounded-full" style={{ background: active ? "#fff" : color }} />}
      {label}
    </button>
  );
}
