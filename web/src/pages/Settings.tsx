import React, { useEffect, useState } from "react";
import { api, PriceRow } from "../api";
import { Card, Loading, Spinner, useAsync } from "../ui";
import { fmtDate, money, moneyFull, weight } from "../format";

const TABS = [
  { k: "prices", label: "Цены (₽/кг)" },
  { k: "import", label: "Импорт из 1С" },
  { k: "general", label: "Общие" },
] as const;
type Tab = (typeof TABS)[number]["k"];

export default function Settings() {
  const [tab, setTab] = useState<Tab>("prices");
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold">Настройки</h1>
        <p className="text-ink-mut text-sm">Цены для расчёта «заморожено в деньгах», загрузка данных, параметры</p>
      </div>
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.k}
            onClick={() => setTab(t.k)}
            className={"px-4 py-2.5 text-sm font-medium border-b-2 -mb-px " + (tab === t.k ? "border-brand-500 text-brand-600" : "border-transparent text-ink-mut hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>
      {tab === "prices" && <Prices />}
      {tab === "import" && <Import />}
      {tab === "general" && <General />}
    </div>
  );
}

function Prices() {
  const { data, loading, reload } = useAsync(() => api.prices(), []);
  const [edit, setEdit] = useState<Record<string, number>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    setEdit({});
  }, [data]);

  if (loading || !data) return <Loading />;

  const priceOf = (r: PriceRow) => (edit[r.vid] ?? r.price);
  const totalMoney = data.reduce((s, r) => s + r.kg * priceOf(r), 0);
  const dirty = Object.keys(edit).length > 0;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      await api.savePrices(Object.entries(edit).map(([vid, price]) => ({ vid, price })));
      setSaved(true);
      reload();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="text-sm text-ink-mut">
          Цена ₽/кг по видам номенклатуры. Итого заморожено:{" "}
          <b className="text-ink num">{moneyFull(totalMoney)}</b>
        </div>
        <div className="flex items-center gap-3">
          {saved && !dirty && <span className="text-sm text-up">✓ Сохранено</span>}
          <button disabled={!dirty || saving} className="btn-primary" onClick={save}>
            {saving ? <Spinner className="!border-white/40 !border-t-white" /> : "Сохранить цены"}
          </button>
        </div>
      </div>
      <Card className="overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-ink-mut text-xs bg-bg/60">
              <th className="px-4 py-2.5 font-semibold">Вид номенклатуры</th>
              <th className="px-4 py-2.5 font-semibold">Тип</th>
              <th className="px-4 py-2.5 font-semibold text-right">Остаток</th>
              <th className="px-4 py-2.5 font-semibold text-right w-36">Цена ₽/кг</th>
              <th className="px-4 py-2.5 font-semibold text-right">Заморожено</th>
            </tr>
          </thead>
          <tbody>
            {data.map((r) => (
              <tr key={r.vid} className="border-t border-line/70">
                <td className="px-4 py-2 font-medium">{r.vid}</td>
                <td className="px-4 py-2 text-ink-mut text-xs">{r.tip}</td>
                <td className="px-4 py-2 text-right num text-ink-mut">{weight(r.kg)}</td>
                <td className="px-4 py-2 text-right">
                  <input
                    type="number"
                    min={0}
                    value={priceOf(r)}
                    onChange={(e) => setEdit((s) => ({ ...s, [r.vid]: Number(e.target.value) }))}
                    className="w-28 text-right rounded-md border border-line px-2 py-1 num outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
                  />
                </td>
                <td className="px-4 py-2 text-right num font-semibold">{money(r.kg * priceOf(r))}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="text-xs text-ink-faint">
        Цены модельные — до подключения прайса из 1С. После сохранения суммы во всех отчётах и на дашборде
        пересчитываются автоматически.
      </p>
    </div>
  );
}

function Import() {
  const { data, reload } = useAsync(() => api.general(), []);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const upload = async (file: File) => {
    setBusy(true);
    setMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/settings/import", { method: "POST", body: fd, credentials: "same-origin" });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Ошибка импорта");
      setMsg({ ok: true, text: `Загружено: снимок на ${fmtDate(j.date)}, позиций ${j.positions}, строк ${j.rows}.` });
      reload();
    } catch (e: any) {
      setMsg({ ok: false, text: e?.message ?? "Ошибка" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="p-6">
        <h3 className="font-semibold mb-1">Загрузка ежедневной выгрузки из 1С</h3>
        <p className="text-sm text-ink-mut mb-4">
          Excel-файл в формате выгрузки остатков (колонки: Дата, Номенклатура, Вид, Тип, Серия, ОстатокКГ,
          Годен до, Дата изготовления, Менеджер, Заказчик). Файл станет актуальным снимком.
        </p>
        <label className={"btn-primary cursor-pointer " + (busy ? "opacity-60 pointer-events-none" : "")}>
          {busy ? <Spinner className="!border-white/40 !border-t-white" /> : "Выбрать .xlsx файл"}
          <input
            type="file"
            accept=".xlsx"
            hidden
            onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
          />
        </label>
        {msg && (
          <div className={"mt-4 text-sm rounded-lg px-3 py-2 " + (msg.ok ? "bg-green-50 text-up" : "bg-red-50 text-down")}>
            {msg.text}
          </div>
        )}
      </Card>
      <Card className="p-4" title="Загруженные файлы">
        <div className="text-sm space-y-1 mt-1">
          {(data?.uploads ?? []).length === 0 && <div className="text-ink-faint">Нет загрузок</div>}
          {(data?.uploads ?? []).map((f) => (
            <div key={f} className="flex items-center gap-2 text-ink-soft">
              <span className="text-ink-faint">📄</span> {f}
            </div>
          ))}
        </div>
      </Card>
      <div className="text-xs text-ink-faint">
        Автопроверка каждый день: настраивается на сервере (cron / планировщик) — кладите свежую выгрузку в
        папку <code>data/uploads</code> или загружайте здесь.
      </div>
    </div>
  );
}

function General() {
  const { data, loading, reload } = useAsync(() => api.general(), []);
  const [currency, setCurrency] = useState("₽");
  const [expiry, setExpiry] = useState(60);
  const [pw, setPw] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (data) {
      setCurrency(data.currency);
      setExpiry(data.expiryWarnDays);
    }
  }, [data]);

  if (loading || !data) return <Loading />;

  const save = async () => {
    setSaving(true);
    setSaved(false);
    await api.saveGeneral({ currency, expiryWarnDays: expiry, password: pw || undefined });
    setPw("");
    setSaving(false);
    setSaved(true);
    reload();
  };

  return (
    <div className="max-w-lg space-y-4">
      <Card className="p-6 space-y-4">
        <Field label="Валюта отображения">
          <input value={currency} onChange={(e) => setCurrency(e.target.value)} className="inp" />
        </Field>
        <Field label="Порог предупреждения о годности (дней)">
          <input type="number" value={expiry} onChange={(e) => setExpiry(Number(e.target.value))} className="inp" />
        </Field>
        <Field label="Новый пароль доступа (оставьте пустым, чтобы не менять)">
          <input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="••••••" className="inp" />
        </Field>
        <div className="flex items-center gap-3 pt-1">
          <button disabled={saving} className="btn-primary" onClick={save}>
            {saving ? <Spinner className="!border-white/40 !border-t-white" /> : "Сохранить"}
          </button>
          {saved && <span className="text-sm text-up">✓ Сохранено</span>}
        </div>
      </Card>
      <div className="text-sm text-ink-mut">
        Актуальный снимок: <b>{fmtDate(data.currentDate)}</b>
      </div>
      <style>{`.inp{width:100%;border:1px solid #e6eaf2;border-radius:8px;padding:8px 12px;outline:none}.inp:focus{border-color:#f59c21;box-shadow:0 0 0 2px #ffe7c2}`}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <div className="text-sm font-medium text-ink-soft mb-1.5">{label}</div>
      {children}
    </label>
  );
}
