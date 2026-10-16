<?php
// Depoimentos fictícios de demonstração; substitua pelos depoimentos reais
// da clínica ao adaptar o tema.
$clinicaexemplo_reviews = [
    ['author' => 'Paciente A', 'text' => 'Só tenho elogios à clínica! O atendimento é sempre excelente, com muita atenção e carinho desde a recepção. Os profissionais são competentes e dedicados.'],
    ['author' => 'Paciente B', 'text' => 'Quero parabenizar a clínica pelo atendimento e profissionalismo de toda a equipe. A evolução do meu tratamento foi muito boa.'],
    ['author' => 'Paciente C', 'text' => 'Nota 10, excelentes profissionais, me sentindo muito melhor a cada dia. Lugar bonito e ambiente aconchegante.'],
    ['author' => 'Paciente D', 'text' => 'Fui muito bem atendida, todos são muito atenciosos. Super recomendo!'],
    ['author' => 'Paciente E', 'text' => 'Amei o atendimento, pessoas educadas e simpáticas. A experiência foi ótima.'],
    ['author' => 'Paciente F', 'text' => 'Minha experiência foi muito boa, consegui uma ótima recuperação. A equipe é educada e atenciosa.'],
    ['author' => 'Paciente G', 'text' => 'Profissionais atenciosos e dedicados, preocupados com a dor dos pacientes e com a evolução do tratamento.'],
    ['author' => 'Paciente H', 'text' => 'Atendimento acolhedor e humanizado. Equipe dedicada no tratamento e na recuperação.'],
    ['author' => 'Paciente I', 'text' => 'Ótima estrutura e ótimos profissionais! Fui muito bem atendido em todas as sessões.'],
];

// Marquee em loop: duplica a lista pra criar a ilusão de rolagem infinita
// (a animação anda -50%, exatamente a largura de uma cópia da faixa).
$clinicaexemplo_review_card = static function (array $review, bool $duplicate = false): void { ?>
<figure class="review-card"<?php echo $duplicate ? ' aria-hidden="true"' : ''; ?>><span class="reviews-stars" aria-hidden="true">★★★★★</span><blockquote><p>“<?php echo esc_html($review['text']); ?>”</p></blockquote><figcaption><strong><?php echo esc_html($review['author']); ?></strong><span>Avaliação no Google</span></figcaption></figure>
<?php };
?>
<?php $clinicaexemplo_show_reviews_heading = $args['heading'] ?? true; ?>
<section class="section section--reviews"><div class="container">
<?php if ($clinicaexemplo_show_reviews_heading): ?>
<div class="section-head"><span class="eyebrow">Avaliações</span><h2>O que os pacientes dizem da Clínica Exemplo</h2><p class="reviews-rating"><span class="reviews-stars" aria-hidden="true">★★★★★</span> 5,0 — depoimentos fictícios de demonstração</p></div>
<?php else: ?>
<p class="reviews-rating"><span class="reviews-stars" aria-hidden="true">★★★★★</span> 5,0 — depoimentos fictícios de demonstração</p>
<?php endif; ?>
</div>
<div class="reviews-marquee">
<div class="reviews-track">
<?php foreach ($clinicaexemplo_reviews as $review) { $clinicaexemplo_review_card($review); } ?>
<?php foreach ($clinicaexemplo_reviews as $review) { $clinicaexemplo_review_card($review, true); } ?>
</div>
</div>
</section>
