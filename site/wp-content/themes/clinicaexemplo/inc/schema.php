<?php
function clinicaexemplo_schema(): void {
    if (!is_front_page()) { return; }
    $schema = [
        '@context' => 'https://schema.org', '@type' => 'MedicalBusiness', 'name' => get_bloginfo('name'),
        'telephone' => clinicaexemplo_get_setting('phone_1'),
        'address' => ['@type' => 'PostalAddress', 'streetAddress' => clinicaexemplo_get_setting('address'), 'addressLocality' => 'São Paulo', 'addressRegion' => 'SP', 'postalCode' => '02332-001', 'addressCountry' => 'BR'],
        'openingHours' => 'Mo-Fr 07:00-19:30', 'sameAs' => [clinicaexemplo_get_setting('instagram')],
    ];
    printf('<script type="application/ld+json">%s</script>', wp_json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
add_action('wp_head', 'clinicaexemplo_schema');

