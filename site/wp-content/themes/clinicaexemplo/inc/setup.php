<?php
function clinicaexemplo_setup(): void {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('responsive-embeds');
    add_theme_support('editor-styles');
    add_theme_support('custom-logo', ['height' => 90, 'width' => 260, 'flex-height' => true, 'flex-width' => true]);
    register_nav_menus(['primary' => __('Menu principal', 'clinicaexemplo')]);
    add_image_size('clinicaexemplo-card', 720, 560, true);
    add_image_size('clinicaexemplo-gallery', 1200, 800, true);
}
add_action('after_setup_theme', 'clinicaexemplo_setup');

function clinicaexemplo_assets(): void {
    $version = wp_get_theme()->get('Version');
    wp_enqueue_style('clinicaexemplo-site', get_theme_file_uri('/assets/css/site.css'), [], $version);
    wp_enqueue_script('clinicaexemplo-site', get_theme_file_uri('/assets/js/site.js'), [], $version, true);
}
add_action('wp_enqueue_scripts', 'clinicaexemplo_assets');

/**
 * Keep the clinic's institutional templates in control even when an existing
 * page was previously saved with an Elementor canvas template.
 */
function clinicaexemplo_template_include(string $template): string {
    if (is_front_page()) {
        $front_page = get_theme_file_path('/front-page.php');
        return file_exists($front_page) ? $front_page : $template;
    }

    $page_templates = [
        'fisioterapia' => '/templates/page-fisioterapia.php',
        'psicologia'   => '/templates/page-psicologia.php',
        'convenios'    => '/templates/page-convenios.php',
        'estrutura'    => '/templates/page-estrutura.php',
        'contato'      => '/templates/page-contato.php',
        'avaliacoes'   => '/templates/page-avaliacoes.php',
    ];

    foreach ($page_templates as $slug => $theme_template) {
        if (is_page($slug)) {
            $path = get_theme_file_path($theme_template);
            // Se o arquivo mapeado for removido/renomeado um dia mas a
            // página com esse slug continuar existindo, cair de volta pro
            // $template padrão em vez de load_template() num caminho
            // inexistente (que dá fatal error/tela branca).
            return file_exists($path) ? $path : $template;
        }
    }

    return $template;
}
add_filter('template_include', 'clinicaexemplo_template_include', PHP_INT_MAX);

/**
 * Add a conservative baseline of browser security headers to public pages.
 * These policies do not interfere with WordPress admin, the Customizer or the
 * external services intentionally linked by the clinic.
 */
function clinicaexemplo_security_headers(): void {
    if (is_admin() || headers_sent()) {
        return;
    }

    if (is_ssl()) {
        header('Strict-Transport-Security: max-age=31536000');
    }

    header('X-Frame-Options: SAMEORIGIN');
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: strict-origin-when-cross-origin');
    header('Permissions-Policy: camera=(), microphone=(), geolocation=()');
}
add_action('send_headers', 'clinicaexemplo_security_headers');

function clinicaexemplo_menu_fallback(): void {
    $items = ['Início' => '/', 'Fisioterapia' => '/fisioterapia/', 'Psicologia' => '/psicologia/', 'Convênios' => '/convenios/', 'Estrutura' => '/estrutura/', 'Contato' => '/contato/'];
    echo '<ul id="menu-principal">';
    foreach ($items as $label => $path) {
        printf('<li><a href="%s">%s</a></li>', esc_url(home_url($path)), esc_html($label));
    }
    echo '</ul>';
}

function clinicaexemplo_image(string $filename, string $alt, string $class = ''): void {
    // Dimensão real do arquivo evita layout shift (CLS) — a maioria das
    // fotos reais é retrato (1600x2133), bem diferente do 1200x800 que
    // estava fixo aqui pra toda imagem, independente do arquivo.
    $path = get_theme_file_path('/assets/images/structure/' . $filename);
    $dimensoes = file_exists($path) ? @getimagesize($path) : false;
    $width = $dimensoes[0] ?? 1200;
    $height = $dimensoes[1] ?? 800;
    printf(
        '<img src="%s" alt="%s" class="%s" width="%d" height="%d" loading="lazy">',
        esc_url(get_theme_file_uri('/assets/images/structure/' . $filename)),
        esc_attr($alt),
        esc_attr($class),
        $width,
        $height
    );
}

// Vídeo vertical (avatar de IA apresentando a clínica) que o visitante toca
// clicando em qualquer ponto — ver data-tap-to-play em assets/js/site.js.
// Sem controles nativos. Sem $autoplayMuted/$autoplayInView, também sem
// autoplay: autoplay com som é bloqueado pelo navegador mesmo, e o clique já
// conta como gesto do usuário liberando o áudio. $autoplayMuted já começa
// tocando (mudo, único autoplay que os navegadores permitem) assim que a
// página carrega — pro vídeo do hero, sempre visível de cara. $autoplayInView
// não toca ao carregar (fica só com o atributo muted, sem autoplay nativo),
// mas o IntersectionObserver em site.js chama .play() quando o vídeo entra
// na tela ao rolar — pra vídeos mais abaixo na página, que não devem gastar
// dados/CPU tocando fora da tela. Em ambos os casos o clique passa a religar
// o áudio em vez de iniciar a reprodução — mesma lógica em site.js.
// width/height são só dica de proporção pra evitar layout shift (CLS), não
// precisam bater exatamente com o arquivo real.
function clinicaexemplo_video(
    string $filename,
    string $poster,
    string $alt,
    string $class = '',
    bool $loop = false,
    bool $autoplayMuted = false,
    bool $autoplayInView = false
): void {
    printf(
        '<video src="%s" poster="%s" aria-label="%s" class="%s" width="720" height="1280" preload="metadata" playsinline%s%s%s%s data-tap-to-play></video>',
        esc_url(get_theme_file_uri('/assets/video/' . $filename)),
        esc_url(get_theme_file_uri('/assets/video/' . $poster)),
        esc_attr($alt),
        esc_attr($class),
        $loop ? ' loop' : '',
        $autoplayMuted ? ' autoplay' : '',
        ($autoplayMuted || $autoplayInView) ? ' muted' : '',
        $autoplayInView ? ' data-autoplay-in-view' : ''
    );
}

add_filter('language_attributes', function (string $output): string {
    return $output . ' class="no-js"';
});
