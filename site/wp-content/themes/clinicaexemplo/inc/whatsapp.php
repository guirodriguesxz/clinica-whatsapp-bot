<?php
function clinicaexemplo_whatsapp_url(string $context = ''): string {
    $phone = preg_replace('/\D+/', '', clinicaexemplo_get_setting('whatsapp'));
    $message = $context !== '' ? sprintf('Olá, gostaria de informações sobre %s.', $context) : 'Olá, gostaria de agendar uma avaliação.';
    return 'https://wa.me/' . rawurlencode($phone) . '?text=' . rawurlencode($message);
}

function clinicaexemplo_whatsapp_shortcode(array $atts = []): string {
    $atts = shortcode_atts(['contexto' => '', 'rotulo' => 'Agende sua avaliação'], $atts);
    return sprintf('<a class="button button--whatsapp" href="%s" rel="noopener">%s</a>', esc_url(clinicaexemplo_whatsapp_url((string) $atts['contexto'])), esc_html((string) $atts['rotulo']));
}
add_shortcode('clinicaexemplo_whatsapp', 'clinicaexemplo_whatsapp_shortcode');

