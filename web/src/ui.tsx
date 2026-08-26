import React, { useEffect, useRef, useState } from "react";
import { pct, trendColor } from "./format";

export function useAsync<T>(fn: () => Promise<T>, deps: any[]): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fnRef
      .current()
      .then((d) => alive && setData(d))
      .catch((e) => alive && setError(e?.message ?? "Ошибка загрузки"))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, error, reload: () => setTick((t) => t + 1) };
}

export function Spinner({ className = "" }: { className?: string }) {
  return (
    <div
      className={"inline-block animate-spin rounded-full border-2 border-brand-300 border-t-brand-600 " + className}
      style={{ width: 18, height: 18 }}
    />
  );
}

export function Loading({ label = "Загрузка…" }: { label?: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-ink-mut">
      <Spinner /> {label}
    </div>
  );
}

export function ErrorBox({ msg }: { msg: string }) {
  return (
    <div className="card p-4 text-down bg-red-50 border-red-200">
      Ошибка: {msg}
    </div>
  );
}

export function Card({
  children,
  className = "",
  title,
  right,
}: {
  children: React.ReactNode;
  className?: string;
  title?: React.ReactNode;
  right?: React.ReactNode;
}) {
  return (
    <div className={"card " + className}>
      {(title || right) && (
        <div className="flex items-center justify-between px-4 pt-3.5 pb-2">
          <h3 className="text-sm font-semibold text-ink-soft">{title}</h3>
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function DeltaBadge({ value, invert = false }: { value: number; invert?: boolean }) {
  const arrow = value > 0.05 ? "▲" : value < -0.05 ? "▼" : "—";
  const color = invert
    ? value > 0.05
      ? "text-down"
      : value < -0.05
        ? "text-up"
        : "text-ink-faint"
    : trendColor(value);
  return (
    <span className={"num text-xs font-semibold " + color}>
      {arrow} {pct(value)}
    </span>
  );
}

export function Bar({ value, max, color = "#f59c21" }: { value: number; max: number; color?: string }) {
  const w = max > 0 ? Math.max(2, (value / max) * 100) : 0;
  return (
    <div className="h-2 rounded-full bg-line/70 overflow-hidden">
      <div className="h-full rounded-full" style={{ width: w + "%", background: color }} />
    </div>
  );
}

export function Chip({
  children,
  active,
  onClick,
}: {
  children: React.ReactNode;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "px-3 py-1.5 rounded-lg text-sm font-medium transition " +
        (active ? "bg-brand-500 text-white shadow-sm" : "text-ink-mut hover:bg-black/5")
      }
    >
      {children}
    </button>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-ink-faint text-sm">{children}</div>;
}
