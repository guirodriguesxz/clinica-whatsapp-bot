import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const theme = new URL('../wp-content/themes/clinicaexemplo/', import.meta.url);

test('confirmed contact values and wa.me fallback exist in theme defaults', () => {
  const settings = readFileSync(new URL('inc/settings.php', theme), 'utf8');
  const whatsapp = readFileSync(new URL('inc/whatsapp.php', theme), 'utf8');
  assert.match(settings, /11999990100/);
  assert.match(settings, /5555-0101/);
  assert.match(settings, /5555-0102/);
  assert.match(settings, /Av\. Exemplo, 1000/);
  assert.match(whatsapp, /https:\/\/wa\.me\//);
});

test('front page composes every approved section exactly once', () => {
  const home = readFileSync(new URL('front-page.php', theme), 'utf8');
  for (const part of ['hero', 'treatments', 'insurance', 'home-care', 'testimonials', 'psychology', 'gallery', 'contact']) {
    const matches = home.match(new RegExp(`get_template_part\\('parts/${part}'`, 'g')) ?? [];
    assert.equal(matches.length, 1, part);
  }
});

test('all approved internal templates exist and identify themselves', () => {
  for (const slug of ['fisioterapia', 'psicologia', 'convenios', 'estrutura', 'contato']) {
    const source = readFileSync(new URL(`templates/page-${slug}.php`, theme), 'utf8');
    assert.match(source, /Template Name:/);
    assert.match(source, /<h1/);
  }
});

test('hero video autoplays muted on load; the home-care video autoplays muted only when scrolled into view; both loop', () => {
  const hero = readFileSync(new URL('parts/hero.php', theme), 'utf8');
  const homeCare = readFileSync(new URL('parts/home-care.php', theme), 'utf8');
  const setup = readFileSync(new URL('inc/setup.php', theme), 'utf8');
  assert.match(setup, /\$loop \? ' loop' : ''/);
  assert.match(setup, /\$autoplayMuted \? ' autoplay' : ''/);
  assert.match(setup, /\(\$autoplayMuted \|\| \$autoplayInView\) \? ' muted' : ''/);
  assert.match(setup, /\$autoplayInView \? ' data-autoplay-in-view' : ''/);
  assert.match(
    hero,
    /clinicaexemplo_video\('hero-boas-vindas\.mp4', 'hero-boas-vindas-poster\.jpg', '[^']*', '', true, true\)/
  );
  assert.match(
    homeCare,
    /clinicaexemplo_video\('atendimento-domiciliar\.mp4', 'atendimento-domiciliar-poster\.jpg', '[^']*', '', true, false, true\)/
  );
});

test('tap unmutes an autoplaying video instead of toggling playback', () => {
  const siteJs = readFileSync(new URL('assets/js/site.js', theme), 'utf8');
  assert.match(siteJs, /if \(video\.muted\) \{/);
  assert.match(siteJs, /video\.muted = false;/);
});

test('below-the-fold video autoplays via IntersectionObserver when scrolled into view, not natively on load', () => {
  const siteJs = readFileSync(new URL('assets/js/site.js', theme), 'utf8');
  assert.match(siteJs, /data-autoplay-in-view/);
  assert.match(siteJs, /new IntersectionObserver/);
  assert.match(siteJs, /entry\.isIntersecting\) entry\.target\.play\(\)/);
});

test('structure uses the new real treatment room in an editorial gallery', () => {
  const structure = readFileSync(new URL('templates/page-estrutura.php', theme), 'utf8');
  const gallery = readFileSync(new URL('parts/gallery.php', theme), 'utf8');
  assert.match(structure, /sala-recursos-terapeuticos\.webp/);
  assert.match(structure, /structure-gallery--editorial/);
  assert.match(gallery, /gallery-preview--editorial/);
});

test('content importer creates all pages and remains idempotent', () => {
  const script = readFileSync(new URL('../scripts/import-content.sh', import.meta.url), 'utf8');
  for (const slug of ['inicio', 'fisioterapia', 'psicologia', 'convenios', 'estrutura', 'contato']) {
    assert.match(script, new RegExp(`ensure_page [^\\n]*${slug}`));
  }
  assert.match(script, /wp post list.*--name=/);
  assert.match(script, /show_on_front/);
  assert.match(script, /wp term get nav_menu principal --by=slug/);
});
