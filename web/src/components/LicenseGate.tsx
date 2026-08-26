import React, { useEffect, useState } from "react";
import { api, LicenseState } from "../api";

export default function LicenseGate({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<LicenseState | null>(null);

  useEffect(() => {
    let alive = true;
    const check = () => api.licenseStatus().then((s) => alive && setState(s)).catch(() => {});
    check();
    const id = setInterval(check, 60_000);
    const onFocus = () => check();
    window.addEventListener("focus", onFocus);
    return () => {
      alive = false;
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  if (state?.locked) return <LockScreen state={state} />;
  return <>{children}</>;
}

function LockScreen({ state }: { state: LicenseState }) {
  return (
    <div className="min-h-full grid place-items-center bg-panel p-6 text-center">
      <div className="max-w-md">
        <img src="/impress-logo-white.svg" alt="ИМПРЕСС АРТ" className="h-10 mx-auto opacity-90" />
        <div className="mt-8 grid place-items-center w-16 h-16 mx-auto rounded-2xl bg-white/5 text-3xl">
          🔒
        </div>
        <h1 className="text-white text-xl font-bold mt-5">Доступ приостановлен</h1>
        <p className="text-white/60 text-sm mt-2 leading-relaxed">
          Работа приложения временно остановлена поставщиком программного обеспечения.
          Пожалуйста, свяжитесь с поставщиком для возобновления доступа.
        </p>
        <div className="text-white/30 text-xs mt-6">код: {state.reason}</div>
      </div>
    </div>
  );
}
