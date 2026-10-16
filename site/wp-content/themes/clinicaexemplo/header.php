<!doctype html>
<html <?php language_attributes(); ?>>
<head><meta charset="<?php bloginfo('charset'); ?>"><meta name="viewport" content="width=device-width, initial-scale=1"><?php wp_head(); ?></head>
<body <?php body_class(); ?>>
<?php wp_body_open(); ?>
<a class="skip-link" href="#conteudo"><?php esc_html_e('Pular para o conteúdo', 'clinicaexemplo'); ?></a>
<header class="site-header">
  <div class="container header-inner">
    <a class="brand" href="<?php echo esc_url(home_url('/')); ?>" aria-label="<?php esc_attr_e('Clínica Exemplo — Início', 'clinicaexemplo'); ?>">
      <?php if (has_custom_logo()) { the_custom_logo(); } else { ?><img class="brand-logo" src="<?php echo esc_url(get_theme_file_uri('/assets/images/logo-clinica-exemplo.png')); ?>" width="248" height="156" alt="Clínica Exemplo — Fisioterapia e Psicologia"><?php } ?>
    </a>
    <button class="menu-toggle" type="button" aria-expanded="false" aria-controls="menu-principal" data-menu-toggle><span class="screen-reader-text"><?php esc_html_e('Abrir menu', 'clinicaexemplo'); ?></span><span aria-hidden="true"></span></button>
    <nav class="site-nav" aria-label="<?php esc_attr_e('Menu principal', 'clinicaexemplo'); ?>">
      <?php wp_nav_menu(['theme_location' => 'primary', 'container' => false, 'menu_id' => 'menu-principal', 'fallback_cb' => 'clinicaexemplo_menu_fallback']); ?>
    </nav>
    <a class="button header-cta" href="<?php echo esc_url(clinicaexemplo_whatsapp_url()); ?>" rel="noopener">Agendar avaliação</a>
  </div>
</header>
