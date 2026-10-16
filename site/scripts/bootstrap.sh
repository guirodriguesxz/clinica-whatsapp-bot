#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -f .env ]]; then
  set -a
  source .env
  set +a
fi

docker compose up -d db wordpress

until docker compose run --rm wpcli core is-installed >/dev/null 2>&1; do
  if docker compose run --rm wpcli core install \
    --url=http://localhost:8088 \
    --title="Clínica Exemplo" \
    --admin_user="${WP_ADMIN_USER:-admin}" \
    --admin_password="${WP_ADMIN_PASSWORD:-change-me-local}" \
    --admin_email="${WP_ADMIN_EMAIL:-admin@example.test}" \
    --skip-email; then
    break
  fi
  sleep 3
done

docker compose run --rm wpcli theme activate clinicaexemplo

if [[ -x scripts/import-content.sh ]]; then
  scripts/import-content.sh
fi

