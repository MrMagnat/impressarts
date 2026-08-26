import React, { useMemo, useState } from "react";
import { api, Break, Competitive } from "../api";
import { Loading, useAsync } from "../ui";
import { Donut, MultiLine } from "./charts";
import { fmtDate, money, PALETTE } from "../format";

export interface Scope {
  type: "category" | "position";
  id?: string;
  tip?: string;
  vid?: string;
  grp?: string;
  label: string;
}

type Dim = "subcategory" | "counterparty" | "manager";

export default function CompetitivePanel({ scope }: { scope: Scope }) {
  const allowSub = scope.type === "category";
  const [dim, setDim] = useState<Dim>(allowSub ? "subcategory" : "counterparty");
  const { data, loading } = useAsync(
    () =>
      api.competitive({
        type: scope.type,
        id: scope.id,
        tip: scope.tip,
        vid: scope.vid,
        grp: scope.grp,
        dim,
      }),
    [scope.type, scope.id, scope.tip, scope.vid, scope.grp, dim],
  );

  const dims: { k: Dim; label: string }[] = [
    ...(allowSub ? [{ k: "subcategory" as Dim, label: "Подкатегории" }] : []),
    { k: "counterparty", label: "Заказчики" },
    { k: "manager", label: "Менеджеры" },
  ];

  const pdfHref =
    scope.type === "position"
      ? api.positionPdfUrl(scope.id!)
      : api.scopePdfUrl({ tip: scope.tip, vid: scope.vid, grp: scope.grp });

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <h3 className="text-sm font-semibold text-ink-soft">
          Конкурентный отчёт: {scope.label}
          {data?.childLabel && dim === "subcategory" ? ` · по «${data.childLabel.toLowerCase()}»` : ""}
        </h3>
        <div className="flex items-center gap-2">
          <div className="flex gap-1 bg-bg rounded-lg border border-line p-0.5">
            {dims.map((d) => (
              <button
                key={d.k}
                onClick={() => setDim(d.k)}
                className={
                  "px-2.5 py-1 rounded-md text-xs font-medium " +
                  (dim === d.k ? "bg-brand-500 text-white" : "text-ink-mut hover:bg-black/5")
                }
              >
                {d.label}
              </button>
            ))}
          </div>
          <a href={pdfHref} target="_blank" rel="noreferrer" className="btn-line !py-1.5 !px-2.5 text-xs">
            ⬇ PDF
          </a>
        </div>
      </div>
      {loading || !data ? <Loading /> : <Body data={data} dim={dim} />}
    </div>
  );
}

function Body({ data, dim }: { data: Competitive; dim: Dim }) {
  // unified color per value across the three pies + legend
  const colorMap = useMemo(() => {
    const order: string[] = [];
    const push = (arr: Break[]) => arr.forEach((r) => !order.includes(r.value) && order.push(r.value));
    push(data.now);
    push(data.prev);
    push(data.avg);
    const m: Record<string, string> = {};
    let ci = 0;
    for (const v of order) m[v] = v === "Прочее" ? "#c7cfdd" : PALETTE[ci++ % PALETTE.length];
    return m;
  }, [data]);

  const pie = (arr: Break[]) =>
    arr.map((r) => ({ label: r.value, value: r.money, color: colorMap[r.value] }));

  // merge series by date for the dynamics chart
  const lineData = useMemo(() => {
    const merged: Record<string, any> = {};
    Object.entries(data.series).forEach(([k, pts]) =>
      pts.forEach((p) => {
        merged[p.date] = merged[p.date] ?? { date: p.date };
        merged[p.date][k] = p.money;
      }),
    );
    return Object.values(merged).sort((a: any, b: any) => a.date.localeCompare(b.date));
  }, [data]);

  const pies = [
    { title: "Актуальный", sub: fmtDate(data.cur), arr: data.now },
    { title: "Прошлый период", sub: fmtDate(data.prevDate), arr: data.prev },
    { title: "Средний период", sub: `${data.avgCount} нед.`, arr: data.avg },
  ];

  const legend = data.now.slice(0, 10);

  return (
    <div className="space-y-4">
      {/* three pies */}
      <div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {pies.map((p) => (
            <div key={p.title} className="text-center">
              <div className="text-xs font-semibold text-ink-soft">{p.title}</div>
              <div className="text-[11px] text-ink-faint mb-1">{p.sub}</div>
              {p.arr.length ? <Donut data={pie(p.arr)} height={150} /> : <div className="h-[150px] grid place-items-center text-xs text-ink-faint">нет данных</div>}
            </div>
          ))}
        </div>
        {/* shared legend */}
        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 justify-center">
          {legend.map((r) => (
            <span key={r.value} className="inline-flex items-center gap-1.5 text-xs text-ink-soft">
              <span className="w-2.5 h-2.5 rounded-full" style={{ background: colorMap[r.value] }} />
              {r.value} <span className="text-ink-faint num">{r.sharePct}%</span>
            </span>
          ))}
        </div>
      </div>

      {/* dynamics */}
      {lineData.length > 1 && (
        <div>
          <div className="text-sm font-semibold text-ink-soft mb-1">Динамика (деньги)</div>
          <MultiLine
            data={lineData}
            series={data.seriesValues.map((v) => ({ key: v, name: v, color: colorMap[v] ?? "#f59c21" }))}
            metric="money"
            height={260}
          />
        </div>
      )}
    </div>
  );
}
