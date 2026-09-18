import React, { useEffect, useMemo, useState } from "react";
import { api, TreeNode } from "../api";
import { Card, ErrorBox, Loading, useAsync } from "../ui";
import PositionCard from "../components/PositionCard";
import CompetitivePanel from "../components/Competitive";
import { fmtNum, money, weight } from "../format";

interface Path {
  tip?: string;
  vid?: string;
  grp?: string;
}

const LEVEL_LABEL: Record<string, string> = {
  tip: "Тип номенклатуры",
  vid: "Вид номенклатуры",
  grp: "Группа",
  position: "Позиция",
};

// Иерархия каталога: Тип -> Группа -> Позиция -> Партии (в карточке позиции).

export default function Catalog() {
  const [path, setPath] = useState<Path>({});
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<any[] | null>(null);
  const [showComp, setShowComp] = useState(false);

  const { data, loading, error } = useAsync(() => api.tree(path), [path.tip, path.vid, path.grp]);

  useEffect(() => {
    setShowComp(false);
  }, [path.tip, path.vid, path.grp]);

  // search (debounced)
  useEffect(() => {
    if (q.trim().length < 2) {
      setResults(null);
      return;
    }
    const t = setTimeout(() => api.search(q).then(setResults).catch(() => setResults([])), 250);
    return () => clearTimeout(t);
  }, [q]);

  const crumbs = useMemo(() => {
    const arr: { label: string; go: Path }[] = [{ label: "Все запасы", go: {} }];
    if (path.tip) arr.push({ label: path.tip, go: { tip: path.tip } });
    if (path.grp) arr.push({ label: path.grp, go: { tip: path.tip, grp: path.grp } });
    return arr;
  }, [path]);

  const drill = (n: TreeNode) => {
    if (n.level === "position") {
      setOpenId(n.key);
      return;
    }
    if (n.level === "tip") setPath({ tip: n.key });
    else if (n.level === "grp") setPath({ tip: path.tip, grp: n.key });
  };

  const canCompete = !!path.tip; // competitive available once inside a type

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold">Каталог складских запасов</h1>
          <p className="text-ink-mut text-sm">Дерево: тип → группа → позиция → партии</p>
        </div>
        <div className="relative">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Поиск позиции…"
            className="w-72 rounded-lg border border-line pl-9 pr-3 py-2 text-sm outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          <span className="absolute left-3 top-2.5 text-ink-faint">⌕</span>
          {results && (
            <div className="absolute z-20 mt-1 w-[26rem] right-0 bg-white rounded-xl2 shadow-pop border border-line max-h-96 overflow-auto">
              {results.length === 0 && <div className="p-4 text-sm text-ink-faint">Ничего не найдено</div>}
              {results.map((r) => (
                <button
                  key={r.id}
                  onClick={() => {
                    setOpenId(r.id);
                    setQ("");
                    setResults(null);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-bg border-b border-line/60 last:border-0"
                >
                  <div className="text-sm font-medium truncate">{r.name}</div>
                  <div className="text-xs text-ink-mut flex justify-between">
                    <span>{r.tip} · {r.vid}</span>
                    <span className="num">{money(r.money)}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* breadcrumb */}
      <div className="flex items-center gap-1.5 text-sm flex-wrap">
        {crumbs.map((c, i) => (
          <React.Fragment key={i}>
            {i > 0 && <span className="text-ink-faint">/</span>}
            <button
              onClick={() => setPath(c.go)}
              className={i === crumbs.length - 1 ? "font-semibold text-ink" : "link"}
            >
              {c.label}
            </button>
          </React.Fragment>
        ))}
      </div>

      {/* scope summary */}
      {data && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <SummaryTile label="Заморожено в деньгах" value={money(data.parent.money)} accent="#f59c21" />
          <SummaryTile label="Остаток" value={weight(data.parent.kg)} accent="#123454" />
          <SummaryTile label={LEVEL_LABEL[data.children[0]?.level ?? "position"] + " (шт.)"} value={fmtNum(data.children.length)} accent="#f25830" />
          <div className="card p-4 flex items-center">
            {canCompete && (
              <button className="btn-primary w-full" onClick={() => setShowComp((s) => !s)}>
                {showComp ? "Скрыть" : "Конкурентный отчёт по разделу"}
              </button>
            )}
          </div>
        </div>
      )}

      {showComp && canCompete && (
        <CompetitivePanel
          scope={{
            type: "category",
            tip: path.tip,
            vid: path.vid,
            grp: path.grp,
            label: path.grp ?? path.vid ?? path.tip ?? "",
          }}
        />
      )}

      {/* children */}
      {loading ? (
        <Loading />
      ) : error ? (
        <ErrorBox msg={error} />
      ) : data ? (
        <Card className="overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-ink-mut text-xs bg-bg/60">
                <th className="px-4 py-2.5 font-semibold">{LEVEL_LABEL[data.children[0]?.level ?? "position"]}</th>
                <th className="px-4 py-2.5 font-semibold text-right w-24">Позиций</th>
                <th className="px-4 py-2.5 font-semibold text-right w-28">Остаток</th>
                <th className="px-4 py-2.5 font-semibold w-48">Доля (деньги)</th>
                <th className="px-4 py-2.5 font-semibold text-right w-32">Заморожено</th>
                <th className="px-4 py-2.5 w-8"></th>
              </tr>
            </thead>
            <tbody>
              {data.children.map((n) => (
                <tr
                  key={n.key}
                  onClick={() => drill(n)}
                  className="border-t border-line/70 hover:bg-brand-50/40 cursor-pointer"
                >
                  <td className="px-4 py-2.5 font-medium max-w-md">
                    <div className="truncate">{n.label}</div>
                    {n.level === "position" && (
                      <div className="text-xs text-ink-faint">{n.batches} партий</div>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right num text-ink-mut">{n.level === "position" ? "—" : fmtNum(n.positions)}</td>
                  <td className="px-4 py-2.5 text-right num">{weight(n.kg)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-2 rounded-full bg-line/70 overflow-hidden">
                        <div className="h-full rounded-full bg-brand-500" style={{ width: n.sharePct + "%" }} />
                      </div>
                      <span className="w-10 text-right text-xs num text-ink-mut">{n.sharePct}%</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right num font-semibold">{money(n.money)}</td>
                  <td className="px-4 py-2.5 text-ink-faint">{n.hasChildren ? "›" : "↗"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {openId && <PositionCard id={openId} onClose={() => setOpenId(null)} />}
    </div>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="absolute left-0 top-0 h-full w-1" style={{ background: accent }} />
      <div className="text-ink-mut text-xs">{label}</div>
      <div className="text-xl font-bold mt-1 num">{value}</div>
    </div>
  );
}
