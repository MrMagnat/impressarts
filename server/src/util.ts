// Small deterministic helpers (no Date.now / Math.random in data modeling — reproducible history)

/** FNV-1a 32-bit hash → hex string, stable across runs. */
export function hashId(...parts: (string | number)[]): string {
  const s = parts.join("");
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/** Deterministic pseudo-random in [0,1) seeded by a string. */
export function seededUnit(seed: string): number {
  let h = 0x2166136f;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // mix
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Deterministic value in [-1,1]. */
export function seededSigned(seed: string): number {
  return seededUnit(seed) * 2 - 1;
}

export function round(n: number, digits = 2): number {
  const f = Math.pow(10, digits);
  return Math.round(n * f) / f;
}

/** Format a JS Date to YYYY-MM-DD (UTC-safe on plain dates). */
export function ymd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseYmd(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

export function addDays(s: string, days: number): string {
  const d = parseYmd(s);
  d.setUTCDate(d.getUTCDate() + days);
  return ymd(d);
}

export function monthKey(s: string): string {
  return s.slice(0, 7); // YYYY-MM
}

/** Group prefix of a nomenclature name: text before first ':' , else marker. */
export function groupOf(name: string): string {
  const i = name.indexOf(":");
  const g = i >= 0 ? name.slice(0, i).trim() : "";
  return g || "Без группы";
}
