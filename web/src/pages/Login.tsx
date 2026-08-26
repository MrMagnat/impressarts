import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth";
import { Spinner } from "../ui";

export default function Login() {
  const { login } = useAuth();
  const nav = useNavigate();
  const [pw, setPw] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await login(pw);
      nav("/");
    } catch (e: any) {
      setErr(e?.message ?? "Не удалось войти");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-full grid place-items-center bg-panel p-6">
      <div className="w-full max-w-sm">
        <div className="mb-7 text-center">
          <img src="/impress-logo-white.svg" alt="ИМПРЕСС АРТ" className="h-11 mx-auto w-auto" />
          <div className="text-white/55 text-sm mt-3">Складской дашборд · управление запасами</div>
        </div>
        <form onSubmit={submit} className="bg-white rounded-xl2 shadow-pop p-6">
          <h1 className="text-lg font-semibold mb-1">Вход в панель</h1>
          <p className="text-ink-mut text-sm mb-5">Введите пароль доступа</p>
          <input
            type="password"
            autoFocus
            value={pw}
            onChange={(e) => setPw(e.target.value)}
            placeholder="Пароль"
            className="w-full rounded-lg border border-line px-3.5 py-2.5 outline-none focus:border-brand-500 focus:ring-2 focus:ring-brand-100"
          />
          {err && <div className="mt-3 text-sm text-down">{err}</div>}
          <button disabled={busy || !pw} className="btn-primary w-full mt-5">
            {busy ? <Spinner className="!border-white/40 !border-t-white" /> : "Войти"}
          </button>
          <p className="text-xs text-ink-faint mt-4 text-center">
            Демо-пароль: <b>demo</b>
          </p>
        </form>
      </div>
    </div>
  );
}
