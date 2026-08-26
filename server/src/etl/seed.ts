import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { db, initSchema, DATA_DIR, setSetting } from "../db.js";
import { importExcel } from "./import-excel.js";
import { ingestSnapshot, modelHistory } from "./ingest.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const arg = process.argv[2];
  const demo = arg ?? path.resolve(__dirname, "../../../data/seed/demo.xlsx");
  if (!fs.existsSync(demo)) {
    console.error("Файл выгрузки не найден:", demo);
    process.exit(1);
  }

  console.log("→ Инициализация схемы…");
  initSchema();

  // чистый пере-сид
  for (const t of ["batch", "fact", "position_dim", "position", "snapshot"]) {
    db().exec(`DELETE FROM ${t}`);
  }

  console.log("→ Чтение Excel:", demo);
  const res = await importExcel(demo);
  console.log(`   дата снимка: ${res.snapshotDate}, строк: ${res.rows.length}`);

  console.log("→ Загрузка снимка…");
  const ing = ingestSnapshot(res);
  console.log(`   позиций: ${ing.positions}`);

  console.log("→ Моделирование истории (78 недель назад)…");
  const weeks = modelHistory(78);
  console.log(`   сгенерировано недель: ${weeks}`);

  setSetting("currency", "₽");
  setSetting("expiry_warn_days", "60");

  const stats = db()
    .prepare(
      `SELECT
        (SELECT COUNT(*) FROM position) AS positions,
        (SELECT COUNT(*) FROM batch)    AS batches,
        (SELECT COUNT(*) FROM fact)     AS facts,
        (SELECT COUNT(*) FROM snapshot) AS snapshots,
        (SELECT ROUND(SUM(kg))    FROM fact WHERE date = (SELECT MAX(date) FROM snapshot WHERE kind='real')) AS kg_now,
        (SELECT ROUND(SUM(money)) FROM fact WHERE date = (SELECT MAX(date) FROM snapshot WHERE kind='real')) AS money_now`,
    )
    .get();
  console.log("✓ Готово:", stats);

  // сохраним копию для истории загрузок
  const dest = path.join(DATA_DIR, "uploads", `${res.snapshotDate}_seed.xlsx`);
  try {
    fs.copyFileSync(demo, dest);
  } catch {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
