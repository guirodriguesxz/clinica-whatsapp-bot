#!/usr/bin/env bash
set -euo pipefail
base="${SITE_URL:-http://localhost:8088}"
for path in / /fisioterapia/ /psicologia/ /convenios/ /estrutura/ /contato/; do
  html="$(curl -fsS "$base$path")"
  count="$(grep -o '<h1' <<<"$html" | wc -l | tr -d ' ')"
  [[ "$count" == "1" ]] || { echo "$path: esperado 1 H1, encontrado $count"; exit 1; }
  grep -q 'https://wa.me/11999990100' <<<"$html" || { echo "$path: CTA do WhatsApp ausente"; exit 1; }
  echo "PASS $path"
done

