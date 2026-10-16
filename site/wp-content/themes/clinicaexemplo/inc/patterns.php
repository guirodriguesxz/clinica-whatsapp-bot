<?php
function clinicaexemplo_register_patterns(): void {
    if (!function_exists('register_block_pattern')) { return; }
    register_block_pattern_category('clinicaexemplo', ['label' => __('Clínica Exemplo', 'clinicaexemplo')]);
    register_block_pattern('clinicaexemplo/cta', [
        'title' => __('Chamada para avaliação', 'clinicaexemplo'), 'categories' => ['clinicaexemplo'],
        'content' => '<!-- wp:group {"className":"cta-panel"} --><div class="wp-block-group cta-panel"><!-- wp:heading --><h2>Vamos cuidar do seu movimento?</h2><!-- /wp:heading --><!-- wp:shortcode -->[clinicaexemplo_whatsapp]<!-- /wp:shortcode --></div><!-- /wp:group -->',
    ]);
}
add_action('init', 'clinicaexemplo_register_patterns');

