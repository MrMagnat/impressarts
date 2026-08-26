#!/bin/sh
set -e
cd /app/server

# seed the database on first run (idempotent — only if DB is missing)
if [ ! -f /app/data/sklad.db ]; then
  echo "→ Первичная инициализация БД из data/seed/demo.xlsx…"
  npx tsx src/etl/seed.ts || echo "ВНИМАНИЕ: сид не выполнен (проверьте data/seed/demo.xlsx)"
fi

echo "→ Запуск сервера…"
exec npx tsx src/server.ts
