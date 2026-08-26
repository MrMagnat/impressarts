import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DATA_DIR } from "./db.js";

/**
 * Remote "kill-switch" license gate.
 *
 * The app periodically fetches a signed license (from LICENSE_URL, controlled by
 * the VENDOR) and verifies it with an embedded Ed25519 public key. If the license
 * is inactive, expired, or cannot be validated for longer than the grace window,
 * the whole API locks (fail-closed). The vendor disables a client by publishing
 * a signed license with "active": false — or simply letting it expire.
 *
 * The client cannot forge a license (no private key) and cannot keep the app
 * running by blocking the URL (fail-closed after grace).
 */

// Vendor public key (base64 SPKI DER). Overridable via env for key rotation.
const DEFAULT_PUBKEY = "MCowBQYDK2VwAyEA77ulQPGjfG5s8Xn4nbja8FADVUg/Mml78UF0Z/HnR1Y=";

const PUBKEY_B64 = process.env.LICENSE_PUBKEY || DEFAULT_PUBKEY;
const URL = process.env.LICENSE_URL || "";
const FILE = process.env.LICENSE_FILE || "";
// Проверка обязательна в production (Docker) либо если явно задан LICENSE_REQUIRED.
const REQUIRED = process.env.LICENSE_REQUIRED
  ? process.env.LICENSE_REQUIRED.toLowerCase() !== "false"
  : process.env.NODE_ENV === "production";
const POLL_MIN = Math.max(1, parseInt(process.env.LICENSE_POLL_MIN ?? "15", 10));
const GRACE_HOURS = Math.max(0, parseInt(process.env.LICENSE_GRACE_HOURS ?? "72", 10));
const CACHE = path.join(DATA_DIR, "license.cache.json");

interface Payload {
  id: string;
  customer: string;
  active: boolean;
  iat: number; // issued unix seconds
  exp: number; // expiry unix seconds
}
interface Signed {
  payload: Payload;
  sig: string; // base64 Ed25519 signature over canonical(payload)
}

let pubKey: crypto.KeyObject | null = null;
try {
  pubKey = crypto.createPublicKey({
    key: Buffer.from(PUBKEY_B64, "base64"),
    format: "der",
    type: "spki",
  });
} catch {
  pubKey = null;
}

let cached: Payload | null = null;
let lastGoodAt = 0; // ms
let lastError = "";

/** Deterministic JSON (sorted keys) so signing/verification is stable. */
function canonical(p: Payload): string {
  return JSON.stringify({
    active: p.active,
    customer: p.customer,
    exp: p.exp,
    iat: p.iat,
    id: p.id,
  });
}

export function verifySigned(obj: Signed): Payload | null {
  if (!pubKey || !obj?.payload || !obj?.sig) return null;
  try {
    const ok = crypto.verify(null, Buffer.from(canonical(obj.payload)), pubKey, Buffer.from(obj.sig, "base64"));
    return ok ? obj.payload : null;
  } catch {
    return null;
  }
}

async function fetchLicense(): Promise<Signed | null> {
  if (URL) {
    const res = await fetch(URL, { cache: "no-store" } as any);
    if (!res.ok) throw new Error("HTTP " + res.status);
    return (await res.json()) as Signed;
  }
  if (FILE && fs.existsSync(FILE)) {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Signed;
  }
  return null;
}

async function refresh(): Promise<void> {
  try {
    const signed = await fetchLicense();
    if (!signed) {
      lastError = "no LICENSE_URL/LICENSE_FILE configured";
      return;
    }
    const payload = verifySigned(signed);
    if (!payload) {
      lastError = "bad signature";
      return;
    }
    cached = payload;
    lastGoodAt = Date.now();
    lastError = "";
    try {
      fs.writeFileSync(CACHE, JSON.stringify({ payload, at: lastGoodAt }));
    } catch {}
  } catch (e: any) {
    lastError = e?.message ?? "fetch failed";
  }
}

export interface LicenseState {
  locked: boolean;
  reason: string;
  customer: string | null;
  exp: number | null;
  expiresIn: number | null; // seconds
  lastCheck: number | null;
}

export function licenseStatus(): LicenseState {
  if (!REQUIRED) {
    return { locked: false, reason: "disabled", customer: null, exp: null, expiresIn: null, lastCheck: null };
  }
  const now = Date.now();
  if (!cached) {
    return {
      locked: true,
      reason: lastError ? "no_license: " + lastError : "no_license",
      customer: null,
      exp: null,
      expiresIn: null,
      lastCheck: lastGoodAt || null,
    };
  }
  let locked = false;
  let reason = "active";
  if (!cached.active) {
    locked = true;
    reason = "suspended";
  } else if (now / 1000 > cached.exp) {
    locked = true;
    reason = "expired";
  } else if (URL && lastGoodAt && now - lastGoodAt > GRACE_HOURS * 3600_000) {
    locked = true;
    reason = "unreachable";
  }
  return {
    locked,
    reason,
    customer: cached.customer,
    exp: cached.exp,
    expiresIn: Math.round(cached.exp - now / 1000),
    lastCheck: lastGoodAt || null,
  };
}

export function isLocked(): boolean {
  return licenseStatus().locked;
}

/** Load cache, do an initial synchronous check, and start polling. */
export async function startLicense(log: (m: string) => void): Promise<void> {
  if (!REQUIRED) {
    log("Лицензия: проверка отключена (LICENSE_REQUIRED=false)");
    return;
  }
  try {
    if (fs.existsSync(CACHE)) {
      const c = JSON.parse(fs.readFileSync(CACHE, "utf8"));
      if (c?.payload) {
        cached = c.payload;
        lastGoodAt = c.at ?? 0;
      }
    }
  } catch {}
  await refresh();
  const s = licenseStatus();
  log(
    `Лицензия: ${s.locked ? "ЗАБЛОКИРОВАНА (" + s.reason + ")" : "активна"}` +
      (s.customer ? ` · ${s.customer}` : "") +
      (s.exp ? ` · до ${new Date(s.exp * 1000).toISOString().slice(0, 10)}` : ""),
  );
  setInterval(refresh, POLL_MIN * 60_000).unref();
}
