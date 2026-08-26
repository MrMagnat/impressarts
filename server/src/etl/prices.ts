import { seededSigned } from "../util.js";

const KEYWORDS: [RegExp, number][] = [
  [/фольг/i, 520],
  [/триплекс/i, 360],
  [/мелован/i, 150],
  [/офсет|бумага|буфлен|влагопроч|крафт/i, 120],
  [/этикеточ/i, 260],
  [/ламин|лбо|лбм|лбк/i, 175],
  [/бопп/i, 250],
  [/бопа/i, 340],
  [/пэт/i, 300],
  [/cpp/i, 265],
  [/пэ\b|пэ |полиэтил/i, 195],
  [/пленк|плёнк/i, 240],
  [/полуфабрикат|^пф\b/i, 210],
];

/** Deterministic default price ₽/kg for a category (вид). Editable later in Settings. */
export function defaultPrice(tip: string, vid: string): number {
  let base = 240;
  if (/готов/i.test(tip)) base = 300;
  else if (/полуфабрикат/i.test(tip)) base = 210;
  else if (/материал/i.test(tip)) base = 225;

  for (const [re, p] of KEYWORDS) {
    if (re.test(vid)) {
      base = p;
      break;
    }
  }
  const jitter = 1 + 0.08 * seededSigned("price:" + vid);
  return Math.round((base * jitter) / 5) * 5;
}
