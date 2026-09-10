import React, { useState } from "react";
import { api, SourceConfig, SyncLogRow, SyncResult, SourceProbe } from "../api";
import { Card, Loading, Spinner, useAsync } from "../ui";
import { fmtDate, fmtNum, money, weight } from "../format";

const STATUS: Record<string, { label: string; cls: string }> = {
  imported: { label: "Загружено", cls: "bg-green-50 text-up" },
  ok: { label: "Совпадает", cls: "bg-green-50 text-up" },
  diff: { label: "Расхождения", cls: "bg-amber-50 text-amber-700" },
  error: { label: "Ошибка", cls: "bg-red-50 text-down" },
};

const TRIGGER: Record<string, string> = {
  schedule: "по расписанию",
  manual: "вручную",
  backfill: "догрузка истории",
};

function dt(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return (
    String(d.getDate()).padStart(2, "0") +
    "." +
    String(d.getMonth() + 1).padStart(2, "0") +
    " " +
    String(d.getHours()).padStart(2, "0") +
    ":" +
    String(d.getMinutes()).padStart(2, "0")
  );
}

export default function SourceTab() {
  const { data, loading, reload } = useAsync(() => api.sourceConfig(), []);
  const logQ = useAsync(() => api.sourceLog(50), []);
  const [form, setForm] = useState<Partial<SourceConfig> & { password?: string }>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [run, setRun] = useState<SyncResult | null>(null);
  const [busy, setBusy] = useState<"" | "check" | "probe">("");
  const [probe, setProbe] = useState<SourceProbe | null>(null);
  const [probeDate, setProbeDate] = useState("");

  if (loading || !data) return <Loading />;

  const v = <K extends keyof SourceConfig>(k: K): SourceConfig[K] =>
    (form[k] as SourceConfig[K]) ?? data[k];
  const set = (patch: Partial<SourceConfig> & { password?: string }) =>
    setForm((f) => ({ ...f, ...patch }));
  const dirty = Object.keys(form).length > 0;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.saveSourceConfig(form);
      setForm({});
      setSaved(true);
      reload();
    } finally {
      setSaving(false);
    }
  };

  const check = async (mode: "compare" | "import") => {
    setBusy("check");
    setRun(null);
    try {
      setRun(await api.sourceCheck({ date: probeDate || undefined, mode }));
      logQ.reload();
      reload();
    } catch (e: any) {
      setRun({ status: "error", message: e?.message ?? "Ошибка" } as SyncResult);
    } finally {
      setBusy("");
    }
  };

  const doProbe = async () => {
    setBusy("probe");
    setProbe(null);
    try {
      setProbe(await api.sourceProbe(probeDate || undefined));
    } catch (e: any) {
      setProbe({ error: e?.message ?? "Ошибка" } as SourceProbe);
    } finally {
      setBusy("");
    }
  };

  const sch = data.schedule;

  return (
    <div className="space-y-5">
      {/* состояние расписания */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Tile
          label="Расписание"
          value={sch.enabled ? "1 раз в сутки" : "выключено"}
          sub={sch.enabled ? "после " + String(sch.hour).padStart(2, "0") + ":00" : "источник отключён"}
        />
        <Tile label="Следующий запрос" value={dt(sch.nextRunAt)} sub={sch.running ? "идёт прямо сейчас" : "по часам сервера"} />
        <Tile
          label="Последний запрос"
          value={dt(sch.lastRunAt)}
          sub={sch.lastStatus ? (STATUS[sch.lastStatus]?.label ?? sch.lastStatus) : "ещё не было"}
        />
        <Tile
          label="Режим"
          value={data.mode === "import" ? "Загрузка в базу" : "Только сверка"}
          sub={data.mode === "import" ? "новые позиции заводятся" : "база не меняется"}
        />
      </div>

      {/* настройки подключения */}
      <Card className="p-6 space-y-4">
        <h3 className="font-semibold">Подключение к 1С</h3>
        <Field
          label="Адрес HTTP-сервиса"
          hint="Плейсхолдер {date} подставляется как ДД.ММ.ГГГГ. Если его нет — параметр date добавится сам."
        >
          <input
            value={v("url")}
            onChange={(e) => set({ url: e.target.value })}
            spellCheck={false}
            className="inp font-mono text-xs"
          />
        </Field>
        <div className="text-xs text-ink-faint break-all">
          Пример запроса: <code>{data.exampleUrl}</code>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Логин (пусто — без авторизации)">
            <input value={v("login")} onChange={(e) => set({ login: e.target.value })} className="inp" />
          </Field>
          <Field label={"Пароль" + (data.passwordSet ? " (задан)" : "")}>
            <input
              type="password"
              placeholder={data.passwordSet ? "••••••" : "не требуется"}
              value={form.password ?? ""}
              onChange={(e) => set({ password: e.target.value })}
              className="inp"
            />
          </Field>
        </div>

        <div className="grid grid-cols-3 gap-4">
          <Field label="Час ежедневного запроса">
            <input
              type="number"
              min={0}
              max={23}
              value={v("hour")}
              onChange={(e) => set({ hour: Number(e.target.value) })}
              className="inp"
            />
          </Field>
          <Field label="Таймаут, с">
            <input
              type="number"
              min={5}
              max={900}
              value={v("timeoutSec")}
              onChange={(e) => set({ timeoutSec: Number(e.target.value) })}
              className="inp"
            />
          </Field>
          <Field label="Что делать с данными">
            <select
              value={v("mode")}
              onChange={(e) => set({ mode: e.target.value as "compare" | "import" })}
              className="inp"
            >
              <option value="import">Загружать в базу</option>
              <option value="compare">Только сверять</option>
            </select>
          </Field>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={v("enabled")}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
          Ежедневный запрос включён
        </label>

        <div className="flex items-center gap-3 pt-1">
          <button disabled={!dirty || saving} className="btn-primary" onClick={save}>
            {saving ? <Spinner className="!border-white/40 !border-t-white" /> : "Сохранить"}
          </button>
          {saved && !dirty && <span className="text-sm text-up">✓ Сохранено</span>}
        </div>
      </Card>

      {/* ручной прогон и диагностика */}
      <Card className="p-6 space-y-4">
        <h3 className="font-semibold">Проверить сейчас</h3>
        <div className="flex items-end gap-3 flex-wrap">
          <Field label="Дата (пусто — сегодня)">
            <input
              type="date"
              value={probeDate}
              onChange={(e) => setProbeDate(e.target.value)}
              className="inp"
            />
          </Field>
          <button disabled={!!busy} className="btn-primary" onClick={() => check("compare")}>
            {busy === "check" ? <Spinner className="!border-white/40 !border-t-white" /> : "Сверить"}
          </button>
          <button disabled={!!busy} className="btn-line" onClick={() => check("import")}>
            Сверить и загрузить
          </button>
          <button disabled={!!busy} className="btn-line" onClick={doProbe}>
            {busy === "probe" ? <Spinner /> : "Показать сырой ответ"}
          </button>
        </div>

        {run && <RunResult r={run} />}
        {probe && <ProbeResult p={probe} />}
      </Card>

      {/* журнал */}
      <Card title="Журнал обращений к 1С" right={<button className="btn-line" onClick={() => logQ.reload()}>Обновить</button>} className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-mut text-xs bg-bg/60">
              <th className="px-4 py-2.5 font-semibold w-32">Когда</th>
              <th className="px-4 py-2.5 font-semibold w-28">Дата данных</th>
              <th className="px-4 py-2.5 font-semibold w-32">Повод</th>
              <th className="px-4 py-2.5 font-semibold w-32">Результат</th>
              <th className="px-4 py-2.5 font-semibold text-right w-20">Строк</th>
              <th className="px-4 py-2.5 font-semibold text-right w-20">Новых</th>
              <th className="px-4 py-2.5 font-semibold">Подробности</th>
              <th className="px-4 py-2.5 font-semibold text-right w-20">Время</th>
            </tr>
          </thead>
          <tbody>
            {(logQ.data ?? []).length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-ink-faint">
                  Обращений ещё не было
                </td>
              </tr>
            )}
            {(logQ.data ?? []).map((r: SyncLogRow) => {
              const st = STATUS[r.status] ?? { label: r.status, cls: "bg-bg text-ink-mut" };
              return (
                <tr key={r.id} className="border-t border-line/70 align-top">
                  <td className="px-4 py-2 num text-ink-mut">{dt(r.started_at)}</td>
                  <td className="px-4 py-2 num">{r.ask_date ? fmtDate(r.ask_date) : "—"}</td>
                  <td className="px-4 py-2 text-xs text-ink-mut">{TRIGGER[r.trigger] ?? r.trigger}</td>
                  <td className="px-4 py-2">
                    <span className={"px-2 py-0.5 rounded-md text-xs font-semibold " + st.cls}>
                      {st.label}
                    </span>
                  </td>
                  <td className="px-4 py-2 text-right num">{r.rows != null ? fmtNum(r.rows) : "—"}</td>
                  <td className="px-4 py-2 text-right num">
                    {r.new_positions != null ? fmtNum(r.new_positions) : "—"}
                  </td>
                  <td className="px-4 py-2 text-xs text-ink-soft">{r.message}</td>
                  <td className="px-4 py-2 text-right num text-ink-faint">
                    {r.duration_ms != null ? r.duration_ms + " мс" : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>

      <p className="text-xs text-ink-faint">
        Те же записи пишутся в стандартный вывод сервера с префиксом <code>[sync]</code> — их видно в{" "}
        <code>docker logs impress-sklad</code>.
      </p>

      <style>{`.inp{width:100%;border:1px solid #e6eaf2;border-radius:8px;padding:8px 12px;outline:none;background:#fff}.inp:focus{border-color:#f59c21;box-shadow:0 0 0 2px #ffe7c2}`}</style>
    </div>
  );
}

function RunResult({ r }: { r: SyncResult }) {
  const st = STATUS[r.status] ?? { label: r.status, cls: "bg-bg text-ink-mut" };
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <div className={"px-4 py-2 text-sm font-semibold " + st.cls}>
        {st.label} — {r.message}
      </div>
      {r.status !== "error" && (
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <KV k="Строк в ответе" v={fmtNum(r.rows)} />
          <KV k="Позиций" v={fmtNum(r.positions)} />
          <KV k="Новых позиций" v={fmtNum(r.newPositions.length)} />
          <KV k="Пропали из выгрузки" v={fmtNum(r.gonePositions.length)} />
          <KV k="Остаток в источнике" v={weight(r.src.kg)} />
          <KV k="Заморожено в источнике" v={money(r.src.money)} />
          <KV k="Было в базе" v={weight(r.dbBefore.kg)} />
          <KV k="Изменилось позиций" v={fmtNum(r.changedPositions)} />
        </div>
      )}
      {r.diag && (
        <div className="px-4 pb-4 text-xs text-ink-faint space-y-1">
          <div>
            Формат: <b>{r.diag.format}</b>, распознанные колонки:{" "}
            {Object.entries(r.diag.mappedColumns)
              .map(([k, val]) => k + " → " + val)
              .join(", ") || "—"}
          </div>
          {r.diag.unmapped.length > 0 && <div>Не использованы: {r.diag.unmapped.join(", ")}</div>}
        </div>
      )}
    </div>
  );
}

function ProbeResult({ p }: { p: SourceProbe }) {
  return (
    <div className="rounded-xl border border-line overflow-hidden">
      <div className="px-4 py-2 bg-bg/60 text-xs text-ink-mut break-all">
        {p.url} · HTTP {p.httpStatus} · {p.contentType || "без Content-Type"} · {fmtNum(p.bytes)} байт ·{" "}
        {p.durationMs} мс
      </div>
      {p.error && <div className="px-4 py-2 text-sm text-down">{p.error}</div>}
      {p.parseError && <div className="px-4 py-2 text-sm text-down">Разбор: {p.parseError}</div>}
      {p.parsed && (
        <div className="px-4 py-2 text-sm text-ink-soft">
          Разобрано строк: <b>{fmtNum(p.parsed.rows)}</b>, дата снимка: <b>{p.parsed.snapshotDate}</b>
        </div>
      )}
      <pre className="px-4 py-3 text-[11px] leading-relaxed bg-panel text-white/80 overflow-auto max-h-96 whitespace-pre-wrap break-all">
        {p.bodyHead || "(пустое тело)"}
      </pre>
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

function KV({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-xs text-ink-mut">{k}</div>
      <div className="num font-semibold">{v}</div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-ink-soft mb-1.5">{label}</div>
      {children}
      {hint && <div className="text-xs text-ink-faint mt-1">{hint}</div>}
    </label>
  );
}
