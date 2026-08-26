import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const DATA_DIR = path.resolve(__dirname, "../../data");
export const DB_PATH = process.env.DB_PATH ?? path.join(DATA_DIR, "sklad.db");

fs.mkdirSync(DATA_DIR, { recursive: true });
fs.mkdirSync(path.join(DATA_DIR, "uploads"), { recursive: true });

let _db: DatabaseSync | null = null;

export function db(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA foreign_keys = ON;");
  return _db;
}

/** Create schema if missing. */
export function initSchema(): void {
  const d = db();
  d.exec(`
    CREATE TABLE IF NOT EXISTS snapshot (
      date        TEXT PRIMARY KEY,      -- YYYY-MM-DD
      kind        TEXT NOT NULL,         -- 'real' | 'modeled'
      created_at  TEXT NOT NULL,
      note        TEXT
    );

    CREATE TABLE IF NOT EXISTS position (
      position_id TEXT PRIMARY KEY,
      tip         TEXT NOT NULL,         -- ТипНоменклатуры  (уровень 1)
      vid         TEXT NOT NULL,         -- ВидНоменклатуры  (уровень 2)
      grp         TEXT NOT NULL,         -- группа (префикс)  (уровень 3)
      name        TEXT NOT NULL          -- Номенклатура      (уровень 4)
    );
    CREATE INDEX IF NOT EXISTS ix_position_tree ON position(tip, vid, grp);

    -- История остатков на уровне позиция × дата (реальный + смоделированный).
    CREATE TABLE IF NOT EXISTS fact (
      date        TEXT NOT NULL,
      position_id TEXT NOT NULL,
      kg          REAL NOT NULL,
      money       REAL NOT NULL,
      PRIMARY KEY (date, position_id)
    );
    CREATE INDEX IF NOT EXISTS ix_fact_pos ON fact(position_id, date);

    -- Партии/серии — детальный уровень ТОЛЬКО для последнего реального снимка.
    CREATE TABLE IF NOT EXISTS batch (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      date          TEXT NOT NULL,
      position_id   TEXT NOT NULL,
      series        TEXT,
      kg            REAL NOT NULL,
      best_before   TEXT,               -- YYYY-MM-DD
      manufactured  TEXT,               -- YYYY-MM-DD
      manager       TEXT,
      counterparty  TEXT,
      price_per_kg  REAL NOT NULL,
      money         REAL NOT NULL
    );
    CREATE INDEX IF NOT EXISTS ix_batch_pos ON batch(position_id);
    CREATE INDEX IF NOT EXISTS ix_batch_mgr ON batch(manager);
    CREATE INDEX IF NOT EXISTS ix_batch_cp  ON batch(counterparty);

    -- Доли распределения килограммов позиции по измерению (менеджер / заказчик).
    CREATE TABLE IF NOT EXISTS position_dim (
      position_id TEXT NOT NULL,
      dim_type    TEXT NOT NULL,        -- 'manager' | 'counterparty'
      dim_value   TEXT NOT NULL,
      share       REAL NOT NULL,        -- 0..1, сумма по позиции = 1
      PRIMARY KEY (position_id, dim_type, dim_value)
    );
    CREATE INDEX IF NOT EXISTS ix_pdim ON position_dim(dim_type, dim_value);

    -- Цена ₽/кг по виду (категории). Редактируется в Настройках.
    CREATE TABLE IF NOT EXISTS price (
      vid          TEXT PRIMARY KEY,
      price_per_kg REAL NOT NULL
    );

    CREATE TABLE IF NOT EXISTS setting (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
}

export function getSetting(key: string, fallback = ""): string {
  const row = db().prepare("SELECT value FROM setting WHERE key = ?").get(key) as
    | { value: string }
    | undefined;
  return row?.value ?? fallback;
}

export function setSetting(key: string, value: string): void {
  db()
    .prepare(
      "INSERT INTO setting(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(key, value);
}

/** Latest real snapshot date (the "current" state). */
export function currentDate(): string {
  const row = db()
    .prepare("SELECT date FROM snapshot WHERE kind = 'real' ORDER BY date DESC LIMIT 1")
    .get() as { date: string } | undefined;
  return row?.date ?? getSetting("current_date", "");
}
