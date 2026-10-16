<?php
// O Rank Math cai no fallback genérico ("Encontrou a Clínica Exemplo!") quando
// a description não é preenchida manualmente no admin de cada página.
// Aqui a gente fixa uma description específica por página direto no tema,
// sem depender de alguém lembrar de configurar isso no painel do Rank Math.
//
// Importante: as páginas em produção não têm _wp_page_template atribuído
// (ficaram salvas com template "Elementor canvas" antes desta reforma —
// ver clinicaexemplo_template_include em inc/setup.php, que já roteia essas
// páginas por SLUG, não pelo campo de template do WordPress). Por isso o
// mapa abaixo também usa slug, e não is_page_template().
function clinicaexemplo_seo_description_map(): array {
    return [
        'fisioterapia' => 'Fisioterapia personalizada na Zona Norte de SP: reabilitação física, dores crônicas e prevenção. Conheça o atendimento e agende sua avaliação.',
        'psicologia' => 'Atendimento psicológico para crianças, adolescentes e adultos na Zona Norte de São Paulo. Escuta acolhedora e acompanhamento individualizado.',
        'convenios' => 'Consulte a cobertura do seu convênio ou atendimento particular na Clínica Exemplo, na Zona Norte de São Paulo. Fale conosco pelo WhatsApp.',
        'estrutura' => 'Conheça os ambientes reais da Clínica Exemplo: salas equipadas, recepção e consultórios de psicologia na Zona Norte de São Paulo.',
        'contato' => 'Fale com a Clínica Exemplo: endereço na Av. Exemplo, telefones, horário de atendimento e WhatsApp para agendar sua avaliação.',
        'avaliacoes' => 'Veja o que os pacientes dizem sobre a Clínica Exemplo: depoimentos reais de fisioterapia e psicologia na Zona Norte de São Paulo.',
    ];
}

function clinicaexemplo_seo_description(string $default): string {
    if (is_front_page()) {
        return 'Fisioterapia e Psicologia na Zona Norte de São Paulo. Atendimento humanizado para dor, mobilidade e bem-estar. Agende sua avaliação pelo WhatsApp.';
    }
    global $post;
    if ($post && isset(clinicaexemplo_seo_description_map()[$post->post_name])) {
        return clinicaexemplo_seo_description_map()[$post->post_name];
    }
    return $default;
}
add_filter('rank_math/frontend/description', 'clinicaexemplo_seo_description');

// As páginas internas não têm excerpt cadastrado, então o Rank Math considera
// a description "vazia" antes mesmo de aplicar o filtro acima e simplesmente
// não imprime a tag <meta name="description">. Preenchendo o excerpt aqui,
// o Rank Math já parte de um valor não vazio e usa ele.
function clinicaexemplo_seo_excerpt(string $excerpt, WP_Post $post): string {
    if ($excerpt !== '') { return $excerpt; }
    return clinicaexemplo_seo_description_map()[$post->post_name] ?? $excerpt;
}
add_filter('get_the_excerpt', 'clinicaexemplo_seo_excerpt', 10, 2);
