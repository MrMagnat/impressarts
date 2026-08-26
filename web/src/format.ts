const CUR = "₽";

const nf0 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 });

export function fmtNum(n: number, d = 0): string {
  return (d === 1 ? nf1 : nf0).format(n ?? 0);
}

/** Compact money: 8.4 млрд ₽ / 985 млн ₽ / 320 тыс ₽. */
export function money(n: number): string {
  const a = Math.abs(n ?? 0);
  if (a >= 1e9) return nf1.format(n / 1e9) + " млрд " + CUR;
  if (a >= 1e6) return nf1.format(n / 1e6) + " млн " + CUR;
  if (a >= 1e3) return nf0.format(n / 1e3) + " тыс " + CUR;
  return nf0.format(n) + " " + CUR;
}

export function moneyFull(n: number): string {
  return nf0.format(Math.round(n ?? 0)) + " " + CUR;
}

/** Weight: tons when large, else kg. */
export function weight(kg: number): string {
  const a = Math.abs(kg ?? 0);
  if (a >= 1000) return nf1.format(kg / 1000) + " т";
  return nf1.format(kg) + " кг";
}

export function tons(kg: number): number {
  return (kg ?? 0) / 1000;
}

export function pct(n: number): string {
  const v = n ?? 0;
  return (v > 0 ? "+" : "") + nf1.format(v) + "%";
}

export function fmtDate(s?: string | null): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  if (!d) return s;
  return `${d}.${m}.${y}`;
}

export function fmtDateShort(s?: string | null): string {
  if (!s) return "—";
  const [y, m, d] = s.split("-");
  return `${d}.${m}`;
}

export function trendColor(n: number): string {
  return n > 0.05 ? "text-up" : n < -0.05 ? "text-down" : "text-ink-faint";
}

/** For inventory, a DROP in stock is usually "good" (less frozen money). Neutral coloring by default. */
export const TIP_COLORS: Record<string, string> = {
  "Готовая продукция": "#f59c21",
  "Материалы в ролях": "#123454",
  Полуфабрикаты: "#f25830",
};

// Impress-brand derived palette: orange, navy, coral, cyan, deep-red, teal…
export const PALETTE = [
  "#f59c21",
  "#123454",
  "#f25830",
  "#00aeef",
  "#9e0502",
  "#0a8f5b",
  "#db8410",
  "#3d6b99",
  "#e0568a",
  "#6b4fbb",
];
