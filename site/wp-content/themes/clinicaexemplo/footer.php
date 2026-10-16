<footer class="site-footer">
  <div class="container footer-grid">
    <div><a class="brand brand--footer" href="<?php echo esc_url(home_url('/')); ?>"><img class="brand-logo brand-logo--footer" src="<?php echo esc_url(get_theme_file_uri('/assets/images/logo-clinica-exemplo.png')); ?>" width="248" height="156" alt="Clínica Exemplo — Fisioterapia e Psicologia"></a><p class="footer-tagline">Cuidado para cada fase da vida.</p></div>
    <div><h2>Contato</h2><a href="<?php echo esc_url(clinicaexemplo_whatsapp_url()); ?>">WhatsApp: <?php echo esc_html(clinicaexemplo_format_phone_display('whatsapp')); ?></a><a href="<?php echo esc_attr(clinicaexemplo_tel_href('phone_1')); ?>"><?php echo esc_html(clinicaexemplo_get_setting('phone_1')); ?></a><a href="<?php echo esc_attr(clinicaexemplo_tel_href('phone_2')); ?>"><?php echo esc_html(clinicaexemplo_get_setting('phone_2')); ?></a></div>
    <div><h2>Onde estamos</h2><p><?php echo esc_html(clinicaexemplo_get_setting('address')); ?></p><p><?php echo esc_html(clinicaexemplo_get_setting('hours')); ?></p></div>
  </div>
  <div class="container footer-bottom"><span>© <?php echo esc_html(wp_date('Y')); ?> Clínica Exemplo</span><a href="<?php echo esc_url(get_privacy_policy_url()); ?>">Política de privacidade</a></div>
</footer>
<div class="lightbox" data-lightbox-dialog role="dialog" aria-modal="true" aria-label="Visualização da foto" hidden><button type="button" data-lightbox-close aria-label="Fechar">×</button><button type="button" data-lightbox-prev aria-label="Foto anterior">‹</button><img src="" alt=""><button type="button" data-lightbox-next aria-label="Próxima foto">›</button></div>
<?php wp_footer(); ?></body></html>
