#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."

wp() { docker compose run --rm wpcli "$@"; }

ensure_page() {
  local title="$1" slug="$2" template="$3" content="${4:-}"
  local id
  id="$(wp post list --post_type=page --name="$slug" --field=ID --format=ids)"
  if [[ -z "$id" ]]; then
    id="$(wp post create --post_type=page --post_status=publish --post_title="$title" --post_name="$slug" --post_content="$content" --porcelain)"
  fi
  wp post meta update "$id" _wp_page_template "$template" >/dev/null
  printf '%s' "$id"
}

home_id="$(ensure_page 'Início' inicio default)"
fisio_id="$(ensure_page 'Fisioterapia' fisioterapia templates/page-fisioterapia.php)"
psico_id="$(ensure_page 'Psicologia' psicologia templates/page-psicologia.php)"
convenios_content='<!-- wp:columns --><div class="wp-block-columns"><!-- wp:column --><div class="wp-block-column"><!-- wp:heading {"level":3} --><h3 class="wp-block-heading">Principais convênios</h3><!-- /wp:heading --><!-- wp:list --><ul class="wp-block-list"><li>Mar Azul Saúde</li><li>Bússola Saúde</li><li>Norte Intermed</li><li>Porto Exemplo Saúde</li><li>Sulvida</li></ul><!-- /wp:list --></div><!-- /wp:column --></div><!-- /wp:columns -->'
convenios_id="$(ensure_page 'Convênios' convenios templates/page-convenios.php "$convenios_content")"
estrutura_id="$(ensure_page 'Estrutura' estrutura templates/page-estrutura.php)"
avaliacoes_id="$(ensure_page 'Avaliações' avaliacoes templates/page-avaliacoes.php)"
contato_id="$(ensure_page 'Contato' contato templates/page-contato.php)"

wp option update show_on_front page >/dev/null
wp option update page_on_front "$home_id" >/dev/null
wp option update permalink_structure '/%postname%/' >/dev/null
wp rewrite flush --hard >/dev/null

sample_id="$(wp post list --post_type=page --name=sample-page --field=ID --format=ids)"
[[ -z "$sample_id" ]] || wp post delete "$sample_id" --force >/dev/null

menu_id="$(wp term get nav_menu principal --by=slug --field=term_id 2>/dev/null || true)"
if [[ -z "$menu_id" ]]; then
  menu_id="$(wp menu create 'Principal' --porcelain)"
fi

for page_id in "$home_id" "$fisio_id" "$psico_id" "$convenios_id" "$estrutura_id" "$avaliacoes_id" "$contato_id"; do
  existing="$(wp menu item list "$menu_id" --format=csv --fields=object_id | tail -n +2 | grep -x "$page_id" || true)"
  [[ -n "$existing" ]] || wp menu item add-post "$menu_id" "$page_id" >/dev/null
done
wp menu location assign "$menu_id" primary >/dev/null
