<?php
function clinicaexemplo_default_settings(): array {
    return [
        'whatsapp' => '11999990100',
        'phone_1' => '(11) 5555-0101',
        'phone_2' => '(11) 5555-0102',
        'address' => 'Av. Exemplo, 1000 — Bairro Exemplo — São Paulo/SP',
        'hours' => 'Segunda a sexta, 07:00–19:30',
        'instagram' => 'https://www.instagram.com/clinica.exemplo/',
        'maps_url' => 'https://www.google.com/maps/search/?api=1&query=Av.+Exemplo,+1000,+São+Paulo',
    ];
}

function clinicaexemplo_get_setting(string $key): string {
    $defaults = clinicaexemplo_default_settings();
    $settings = get_option('clinicaexemplo_settings', []);
    $value = $settings[$key] ?? $defaults[$key] ?? '';
    return in_array($key, ['instagram', 'maps_url'], true) ? esc_url_raw((string) $value) : sanitize_text_field((string) $value);
}

// Deriva um href tel: a partir de um número formatado (ex.: "(11) 5555-0101")
// guardado numa configuração — nunca hardcoded, senão o link continua
// discando o número antigo depois que a clínica troca o telefone no painel.
function clinicaexemplo_tel_href(string $setting_key): string {
    $digits = preg_replace('/\D+/', '', clinicaexemplo_get_setting($setting_key));
    return 'tel:+55' . $digits;
}

// O WhatsApp é guardado só com dígitos (usado no link wa.me); formata para
// exibição para casar com o padrão "(11) 5555-0101" dos outros telefones.
function clinicaexemplo_format_phone_display(string $setting_key): string {
    $digits = preg_replace('/\D+/', '', clinicaexemplo_get_setting($setting_key));
    if (strlen($digits) === 11) {
        return sprintf('(%s) %s-%s', substr($digits, 0, 2), substr($digits, 2, 5), substr($digits, 7));
    }
    if (strlen($digits) === 10) {
        return sprintf('(%s) %s-%s', substr($digits, 0, 2), substr($digits, 2, 4), substr($digits, 6));
    }
    return clinicaexemplo_get_setting($setting_key);
}

function clinicaexemplo_sanitize_settings(array $input): array {
    $clean = [];
    foreach (clinicaexemplo_default_settings() as $key => $default) {
        $value = $input[$key] ?? $default;
        $clean[$key] = in_array($key, ['instagram', 'maps_url'], true) ? esc_url_raw($value) : sanitize_text_field($value);
    }
    return $clean;
}

function clinicaexemplo_register_settings(): void {
    register_setting('clinicaexemplo_settings_group', 'clinicaexemplo_settings', ['sanitize_callback' => 'clinicaexemplo_sanitize_settings']);
    add_theme_page(__('Dados da clínica', 'clinicaexemplo'), __('Dados da clínica', 'clinicaexemplo'), 'manage_options', 'clinicaexemplo-settings', 'clinicaexemplo_settings_page');
}
add_action('admin_menu', 'clinicaexemplo_register_settings');

function clinicaexemplo_settings_page(): void {
    if (!current_user_can('manage_options')) { return; }
    $labels = ['whatsapp' => 'WhatsApp', 'phone_1' => 'Telefone 1', 'phone_2' => 'Telefone 2', 'address' => 'Endereço', 'hours' => 'Horário', 'instagram' => 'Instagram', 'maps_url' => 'Google Maps'];
    echo '<div class="wrap"><h1>' . esc_html__('Dados da clínica', 'clinicaexemplo') . '</h1><form method="post" action="options.php">';
    settings_fields('clinicaexemplo_settings_group');
    foreach ($labels as $key => $label) {
        printf('<p><label for="fl-%1$s"><strong>%2$s</strong></label><br><input class="regular-text" id="fl-%1$s" name="clinicaexemplo_settings[%1$s]" value="%3$s"></p>', esc_attr($key), esc_html($label), esc_attr(clinicaexemplo_get_setting($key)));
    }
    submit_button();
    echo '</form></div>';
}

