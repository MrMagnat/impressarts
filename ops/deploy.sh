#!/usr/bin/env bash
# Деплой складского дашборда на удалённый сервер по SSH (сборка Docker-образа на сервере).
#
# Предпосылки:
#   • на СЕРВЕРЕ установлены docker и docker compose;
#   • у вас настроен SSH-доступ по КЛЮЧУ (рекомендуется):  ssh-copy-id op@СЕРВЕР
#   • локально заполнен .env (скопируйте из .env.example).
#
# Запуск:
#   SSH_HOST=op@192.168.233.2 ./ops/deploy.sh
set -euo pipefail

SSH_HOST="${SSH_HOST:?Укажите SSH_HOST, напр. op@192.168.233.2}"
REMOTE_DIR="${REMOTE_DIR:-/opt/impress-sklad}"
HERE="$(cd "$(dirname "$0")/.." && pwd)"

echo "→ Проверка .env"
[ -f "$HERE/.env" ] || { echo "Нет .env — скопируйте .env.example в .env и заполните"; exit 1; }

echo "→ Проверка Docker на сервере"
ssh "$SSH_HOST" 'command -v docker >/dev/null || { echo "Docker не установлен на сервере"; exit 1; }'

echo "→ Копирование проекта в $SSH_HOST:$REMOTE_DIR"
ssh "$SSH_HOST" "mkdir -p '$REMOTE_DIR'"
# rsync без секретов и мусора (см. .dockerignore-подобный список)
rsync -az --delete \
  --exclude 'node_modules' --exclude 'dist' --exclude '.git' \
  --exclude 'data/*.db' --exclude 'data/*.db-*' --exclude 'data/uploads/*' \
  --exclude 'ops/license/vendor-private.pem' \
  "$HERE/" "$SSH_HOST:$REMOTE_DIR/"

echo "→ Сборка и запуск на сервере"
ssh "$SSH_HOST" "cd '$REMOTE_DIR' && docker compose up -d --build"

echo "✓ Готово. Приложение слушает на сервере 127.0.0.1:8080 (по умолчанию)."
echo "  Открыть локально:  ssh -L 8080:127.0.0.1:8080 $SSH_HOST   → http://localhost:8080"
