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

/**
 * Ширины колонок таблицы, которые можно тянуть мышью за границу заголовка.
 *
 * Нужно там, где содержимое непредсказуемой длины — серии, названия
 * контрагентов, имена менеджеров: фиксированные доли либо режут текст, либо
 * растягивают таблицу за край панели. Ширины живут в localStorage по ключу,
 * поэтому настройка переживает перезагрузку.
 */
export function useColumnWidths(key: string, initial: number[]) {
  const [widths, setWidths] = useState<number[]>(() => {
    try {
      const raw = localStorage.getItem("colw:" + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed) && parsed.length === initial.length) return parsed;
      }
    } catch {
      /* приватный режим — просто начинаем с умолчаний */
    }
    return initial;
  });

  const drag = useRef<{ i: number; x: number; w: number } | null>(null);

  useEffect(() => {
    const move = (e: MouseEvent) => {
      const d = drag.current;
      if (!d) return;
      e.preventDefault();
      setWidths((ws) => {
        const next = [...ws];
        next[d.i] = Math.max(56, Math.round(d.w + (e.clientX - d.x)));
        return next;
      });
    };
    const up = () => {
      if (!drag.current) return;
      drag.current = null;
      document.body.style.cursor = "";
      setWidths((ws) => {
        try {
          localStorage.setItem("colw:" + key, JSON.stringify(ws));
        } catch {
          /* не критично */
        }
        return ws;
      });
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [key]);

  const startResize = (i: number) => (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    drag.current = { i, x: e.clientX, w: widths[i] };
    document.body.style.cursor = "col-resize";
  };

  const reset = () => {
    setWidths(initial);
    try {
      localStorage.removeItem("colw:" + key);
    } catch {
      /* не критично */
    }
  };

  return { widths, startResize, reset };
}

/** Невидимая полоска на правой границе заголовка — за неё тянут ширину. */
export function ColResizer({ onMouseDown }: { onMouseDown: (e: React.MouseEvent) => void }) {
  return (
    <span
      onMouseDown={onMouseDown}
      onClick={(e) => e.stopPropagation()}
      title="Потяните, чтобы изменить ширину"
      className="absolute top-0 right-0 h-full w-2 cursor-col-resize select-none hover:bg-brand-300/60"
    />
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="py-10 text-center text-ink-faint text-sm">{children}</div>;
}
