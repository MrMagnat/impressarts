// Выпуск и подпись лицензии (запускать ТОЛЬКО у поставщика — нужен приватный ключ).
//
// Примеры:
//   node sign-license.mjs --customer "ООО Клиент" --days 35            > license.json
//   node sign-license.mjs --customer "ООО Клиент" --days 35 --inactive > license.json   (сразу выключена)
//   node sign-license.mjs --customer "ООО Клиент" --days 0             > license.json   (бессрочно активна)
//
// Затем разместите license.json по адресу LICENSE_URL (ваш VPS / GitHub Gist raw / S3).
// «Выключить» клиента = перевыпустить с --inactive (или дать сроку истечь) и обновить файл.

import { sign as edSign } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { createPrivateKey } from "node:crypto";

const dir = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const args = process.argv.slice(2);
const get = (k, d) => {
  const i = args.indexOf("--" + k);
  return i >= 0 ? args[i + 1] : d;
};
const has = (k) => args.includes("--" + k);

const customer = get("customer", "Client");
const days = parseInt(get("days", "35"), 10);
const id = get("id", "lic-" + Math.random().toString(36).slice(2, 10));
const active = !has("inactive");

const now = Math.floor(Date.now() / 1000);
const payload = {
  active,
  customer,
  exp: days > 0 ? now + days * 86400 : now + 100 * 365 * 86400, // days=0 → ~бессрочно
  iat: now,
  id,
};

// canonical (sorted keys) — должно совпадать с сервером license.ts
const canonical = JSON.stringify({
  active: payload.active,
  customer: payload.customer,
  exp: payload.exp,
  iat: payload.iat,
  id: payload.id,
});

const privPath = path.join(dir, "vendor-private.pem");
if (!fs.existsSync(privPath)) {
  console.error("Нет приватного ключа:", privPath, "\nСначала: node keygen.mjs");
  process.exit(1);
}
const priv = createPrivateKey(fs.readFileSync(privPath));
const sig = edSign(null, Buffer.from(canonical), priv).toString("base64");

const out = JSON.stringify({ payload, sig }, null, 2);
process.stdout.write(out + "\n");
process.stderr.write(
  `\n✓ Лицензия: ${customer} · ${active ? "АКТИВНА" : "ВЫКЛЮЧЕНА"} · до ${new Date(payload.exp * 1000)
    .toISOString()
    .slice(0, 10)}\n`,
);
