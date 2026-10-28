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

/**
 * Палитра для категорийных разрезов. Соседние цвета разведены по тону и
 * светлоте, чтобы различаться и в легенде, и в узкой полоске графика с
 * накоплением, и на распечатанном в серой гамме PDF.
 */
export const PALETTE = [
  "#f59c21", // оранжевый (бренд)
  "#123454", // тёмно-синий (бренд)
  "#0a8f5b", // зелёный
  "#e0568a", // розовый
  "#00aeef", // голубой
  "#9e0502", // тёмно-красный
  "#6b4fbb", // фиолетовый
  "#8a6d1f", // охра
  "#f25830", // коралловый (бренд)
  "#2b7a78", // бирюзовый
  "#b4472e", // кирпичный
  "#4b6cb7", // стальной синий
  "#7a9a01", // оливковый
  "#c2185b", // малиновый
  "#5d7a8c", // серо-синий
  "#d98b00", // янтарный
];

/** Исторические цвета типов демо-базы — чтобы знакомые экраны не «переехали». */
const TIP_COLOR_OVERRIDES: Record<string, string> = {
  "Готовая продукция": "#f59c21",
  "Материалы в ролях": "#123454",
  Полуфабрикаты: "#f25830",
};

/**
 * Цвета типов номенклатуры по фактическому списку типов.
 *
 * Раньше это был словарь на три захардкоженных названия, а всё остальное
 * получало один и тот же оранжевый fallback — на реальной выгрузке из 1С,
 * где названия типов другие, график с накоплением рисовался одним цветом.
 * Теперь цвет назначается по позиции типа в списке, а знакомые названия
 * сохраняют прежние цвета.
 */
export function tipColors(tips: string[]): Record<string, string> {
  const used = new Set<string>();
  const out: Record<string, string> = {};
  for (const t of tips) {
    const fixed = TIP_COLOR_OVERRIDES[t];
    if (fixed) {
      out[t] = fixed;
      used.add(fixed);
    }
  }
  let i = 0;
  for (const t of tips) {
    if (out[t]) continue;
    while (used.has(PALETTE[i % PALETTE.length]) && i < PALETTE.length) i++;
    const c = PALETTE[i % PALETTE.length];
    out[t] = c;
    used.add(c);
    i++;
  }
  return out;
}

/** Цвет одного типа вне списка (поиск, карточка) — стабилен по имени. */
export function tipColor(tip: string, map?: Record<string, string>): string {
  if (map?.[tip]) return map[tip];
  if (TIP_COLOR_OVERRIDES[tip]) return TIP_COLOR_OVERRIDES[tip];
  let h = 0;
  for (let i = 0; i < tip.length; i++) h = (h * 31 + tip.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
