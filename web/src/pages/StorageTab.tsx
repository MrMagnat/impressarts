import React, { useState } from "react";
import { api, BackfillResult, StorageStats } from "../api";
import { Card, Loading, Spinner, useAsync } from "../ui";
import { fmtDate, fmtNum } from "../format";

function mb(bytes: number): string {
  if (!bytes) return "—";
  return (bytes / 1024 / 1024).toFixed(1) + " МБ";
}

export default function StorageTab() {
  const { data, loading, reload } = useAsync(() => api.storageStats(), []);
  const [days, setDays] = useState<number | null>(null);
  const [busy, setBusy] = useState<"" | "compact" | "backfill">("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [step, setStep] = useState<"day" | "week" | "month">("month");
  const [bf, setBf] = useState<BackfillResult | null>(null);

  if (loading || !data) return <Loading />;
  const retention = days ?? data.retentionDays;

  const compact = async () => {
    setBusy("compact");
    setMsg(null);
    try {
      const r = await api.storageCompact(retention);
      setMsg({
        ok: true,
        text:
          "Сжато дат: " +
          r.aggregated.length +
          ". Удалено строк остатков: " +
          fmtNum(r.factRowsDeleted) +
          ", партий: " +
          fmtNum(r.batchRowsDeleted) +
          ". Граница детализации — " +
          fmtDate(r.cutoff) +
          ".",
      });
      reload();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Ошибка" });
    } finally {
      setBusy("");
    }
  };

  const backfill = async () => {
    if (!from || !to) return;
    setBusy("backfill");
    setMsg(null);
    setBf(null);
    try {
      setBf(await api.storageBackfill({ from, to, step, maxPoints: 24 }));
      reload();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Ошибка" });
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="space-y-5 max-w-3xl">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile label="Размер базы" value={mb(data.dbBytes)} sub={fmtNum(data.aggRows) + " строк агрегата"} />
        <Tile
          label="Глубина истории"
          value={fmtNum(data.aggDates) + " точек"}
          sub={data.firstDate ? fmtDate(data.firstDate) + " — " + fmtDate(data.lastDate ?? "") : "—"}
        />
        <Tile
          label="Полная детализация"
          value={fmtNum(data.detailDates) + " дат"}
          sub={fmtNum(data.factRows) + " строк остатков"}
        />
        <Tile label="Партии" value={fmtNum(data.batchRows)} sub="только за текущий снимок" />
      </div>

      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-semibold">Горячее окно детализации</h3>
          <p className="text-sm text-ink-mut mt-1">
            Партии, менеджеры, заказчики и топ-движения по позициям требуют детальных строк — они
            хранятся только за последние N дней. Всё, что старше, сжимается в агрегат по дереву
            (тип → вид → группа): тренды, дашборд и отчёты по категориям продолжают работать на всю
            глубину, а объём базы перестаёт расти линейно по позициям.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="block">
            <div className="text-sm font-medium text-ink-soft mb-1.5">Хранить детализацию, дней</div>
            <input
              type="number"
              min={7}
              max={3650}
              value={retention}
              onChange={(e) => setDays(Number(e.target.value))}
              className="inp w-40"
            />
          </label>
          <button disabled={!!busy} className="btn-primary" onClick={compact}>
            {busy === "compact" ? <Spinner className="!border-white/40 !border-t-white" /> : "Сжать сейчас"}
          </button>
        </div>
        <p className="text-xs text-ink-faint">
          Значение сохраняется на вкладке «Источник 1С» и применяется автоматически после каждой
          загрузки. Кнопка выполняет сжатие немедленно и уплотняет файл базы.
        </p>
      </Card>

      <Card className="p-6 space-y-4">
        <div>
          <h3 className="font-semibold">Догрузить историю из 1С</h3>
          <p className="text-sm text-ink-mut mt-1">
            Недостающие точки запрашиваются у 1С по одной дате и сохраняются сразу агрегатом, минуя
            детализацию. Для многолетней глубины достаточно шага «месяц» — это ~12 запросов на год.
          </p>
        </div>
        <div className="flex items-end gap-3 flex-wrap">
          <label className="block">
            <div className="text-sm font-medium text-ink-soft mb-1.5">С</div>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="inp" />
          </label>
          <label className="block">
            <div className="text-sm font-medium text-ink-soft mb-1.5">По</div>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="inp" />
          </label>
          <label className="block">
            <div className="text-sm font-medium text-ink-soft mb-1.5">Шаг</div>
            <select value={step} onChange={(e) => setStep(e.target.value as any)} className="inp">
              <option value="month">Месяц</option>
              <option value="week">Неделя</option>
              <option value="day">День</option>
            </select>
          </label>
          <button disabled={!!busy || !from || !to} className="btn-primary" onClick={backfill}>
            {busy === "backfill" ? <Spinner className="!border-white/40 !border-t-white" /> : "Догрузить"}
          </button>
        </div>
        <p className="text-xs text-ink-faint">За один раз загружается не более 24 точек — повторите для более длинного периода.</p>

        {bf && (
          <div className="text-sm space-y-1">
            <div className="text-up">Загружено точек: {bf.loaded.length}</div>
            {bf.skipped.length > 0 && (
              <div className="text-ink-mut">Уже были в базе: {bf.skipped.length}</div>
            )}
            {bf.failed.length > 0 && (
              <div className="text-down">
                Не удалось: {bf.failed.map((f) => f.date + " (" + f.error + ")").join("; ")}
              </div>
            )}
          </div>
        )}
      </Card>

      {msg && (
        <div className={"text-sm rounded-lg px-3 py-2 " + (msg.ok ? "bg-green-50 text-up" : "bg-red-50 text-down")}>
          {msg.text}
        </div>
      )}

      <style>{`.inp{border:1px solid #e6eaf2;border-radius:8px;padding:8px 12px;outline:none;background:#fff}.inp:focus{border-color:#f59c21;box-shadow:0 0 0 2px #ffe7c2}`}</style>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-ink-mut">{label}</div>
      <div className="text-lg font-bold mt-0.5">{value}</div>
      {sub && <div className="text-xs text-ink-faint mt-0.5">{sub}</div>}
    </div>
  );
}
