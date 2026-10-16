# Site WordPress Clínica Exemplo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir localmente um site WordPress multipágina, responsivo, editável e empacotável para substituir o site atual da Clínica Exemplo.

**Architecture:** O site público ficará isolado em `site/`, com WordPress e MariaDB executados por Docker Compose. Um tema próprio chamado `clinicaexemplo` fornecerá templates, padrões de blocos, opções globais de contato e assets sem framework; um script WP-CLI criará as páginas e o conteúdo inicial sem acoplar o site ao bot existente.

**Tech Stack:** WordPress 6.6+, PHP 8.2+, MariaDB 11, Docker Compose, HTML5, CSS nativo, JavaScript progressivo, Node.js 20 para testes estruturais.

**Spec:** `docs/superpowers/specs/2026-08-31-site-wordpress-clinicaexemplo-design.md`

## Global Constraints

- Todo o site público deve ficar sob `site/`; não alterar rotas, serviços, banco ou dashboard do bot.
- Criar seis páginas: Início, Fisioterapia, Psicologia, Convênios, Estrutura e Contato.
- Usar um único H1 por página e HTML semântico.
- Não duplicar seções para desktop e mobile.
- Contatos iniciais: WhatsApp `(11) 99999-0100`, telefones `(11) 5555-0101` e `(11) 5555-0102`.
- Endereço inicial: `Av. Exemplo, 1000 — Bairro Exemplo — São Paulo/SP`.
- Horário inicial: `segunda a sexta, 07:00–19:30`.
- Hospedar Lora e Manrope localmente; não depender de Google Fonts.
- Priorizar imagens reais e sinalizar qualquer imagem provisória no ambiente local.
- Todos os CTAs devem funcionar sem JavaScript e abrir o WhatsApp oficial.
- WCAG 2.2 AA, foco visível, `prefers-reduced-motion` e alvos de toque mínimos de 44 × 44 px.
- Meta local de Lighthouse acima de 90 em desempenho, acessibilidade, boas práticas e SEO nas páginas principais.
- Não integrar agenda, prontuário, Instagram ou avaliações automáticas nesta versão.

## File Map

```text
site/
├── .env.example                         # variáveis locais sem segredos
├── docker-compose.yml                   # WordPress, MariaDB e WP-CLI
├── README.md                            # instalação, importação e empacotamento
├── package.json                         # testes estruturais do tema
├── scripts/
│   ├── bootstrap.sh                     # instala WordPress, ativa tema e cria conteúdo
│   ├── import-content.sh                # conteúdo inicial idempotente
│   ├── package-theme.sh                 # produz o ZIP instalável
│   └── smoke-test.sh                    # HTTP, PHP e páginas esperadas
├── tests/
│   ├── compose.test.mjs                 # contrato do ambiente local
│   ├── theme-structure.test.mjs         # contrato de arquivos e metadados do tema
│   ├── content.test.mjs                 # conteúdo e CTAs obrigatórios
│   └── accessibility.test.mjs           # invariantes estáticas de acessibilidade
└── wp-content/themes/clinicaexemplo/
    ├── style.css                        # metadados do tema e estilos globais
    ├── theme.json                       # tokens e suporte ao editor de blocos
    ├── functions.php                    # bootstrap do tema
    ├── front-page.php                   # home
    ├── page.php                         # fallback das páginas
    ├── index.php                        # fallback WordPress
    ├── header.php                       # cabeçalho e navegação
    ├── footer.php                       # contatos e rodapé
    ├── screenshot.png                   # preview no painel
    ├── inc/
    │   ├── setup.php                    # suportes, menus e imagens
    │   ├── settings.php                 # opções globais sanitizadas
    │   ├── whatsapp.php                 # URL e CTA reutilizáveis
    │   ├── patterns.php                 # registro de padrões de blocos
    │   └── schema.php                   # JSON-LD LocalBusiness
    ├── assets/
    │   ├── css/site.css                 # componentes e responsividade
    │   ├── js/site.js                   # menu e lightbox progressivos
    │   ├── fonts/                       # Lora e Manrope WOFF2
    │   └── images/                      # fotos reais otimizadas da clínica
    ├── parts/
    │   ├── hero.php
    │   ├── treatments.php
    │   ├── insurance.php
    │   ├── home-care.php
    │   ├── testimonials.php
    │   ├── psychology.php
    │   ├── gallery.php
    │   └── contact.php
    └── templates/
        ├── page-fisioterapia.php
        ├── page-psicologia.php
        ├── page-convenios.php
        ├── page-estrutura.php
        └── page-contato.php
```

---

### Task 1: Ambiente WordPress local reproduzível

**Files:**
- Create: `site/.env.example`
- Create: `site/docker-compose.yml`
- Create: `site/package.json`
- Create: `site/tests/compose.test.mjs`
- Create: `site/scripts/bootstrap.sh`
- Create: `site/README.md`

**Interfaces:**
- Consumes: Docker Engine com Compose e Node.js 20+.
- Produces: WordPress em `http://localhost:8088`, serviço `db`, serviço `wordpress` e runner `wpcli`.

- [ ] **Step 1: Write the failing environment contract test**

```js
// site/tests/compose.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const compose = readFileSync(new URL('../docker-compose.yml', import.meta.url), 'utf8');

test('compose isolates the public site and exposes WordPress on 8088', () => {
  assert.match(compose, /wordpress:/);
  assert.match(compose, /db:/);
  assert.match(compose, /wpcli:/);
  assert.match(compose, /8088:80/);
  assert.match(compose, /\.\/wp-content:\/var\/www\/html\/wp-content/);
});
```

- [ ] **Step 2: Run the contract test to verify it fails**

Run: `node --test site/tests/compose.test.mjs`
Expected: FAIL with `ENOENT` for `site/docker-compose.yml`.

- [ ] **Step 3: Create the Docker Compose environment**

```yaml
# site/docker-compose.yml
services:
  db:
    image: mariadb:11
    restart: unless-stopped
    environment:
      MARIADB_DATABASE: ${WORDPRESS_DB_NAME:-clinicaexemplo_site}
      MARIADB_USER: ${WORDPRESS_DB_USER:-wordpress}
      MARIADB_PASSWORD: ${WORDPRESS_DB_PASSWORD:-wordpress}
      MARIADB_ROOT_PASSWORD: ${MARIADB_ROOT_PASSWORD:-root-local-only}
    volumes:
      - db_data:/var/lib/mysql
    healthcheck:
      test: ["CMD", "healthcheck.sh", "--connect", "--innodb_initialized"]
      interval: 5s
      timeout: 3s
      retries: 20

  wordpress:
    image: wordpress:php8.3-apache
    restart: unless-stopped
    depends_on:
      db:
        condition: service_healthy
    ports:
      - "8088:80"
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_NAME: ${WORDPRESS_DB_NAME:-clinicaexemplo_site}
      WORDPRESS_DB_USER: ${WORDPRESS_DB_USER:-wordpress}
      WORDPRESS_DB_PASSWORD: ${WORDPRESS_DB_PASSWORD:-wordpress}
      WORDPRESS_DEBUG: ${WORDPRESS_DEBUG:-1}
    volumes:
      - wordpress_data:/var/www/html
      - ./wp-content:/var/www/html/wp-content

  wpcli:
    image: wordpress:cli
    user: "33:33"
    depends_on:
      - wordpress
    environment:
      WORDPRESS_DB_HOST: db:3306
      WORDPRESS_DB_NAME: ${WORDPRESS_DB_NAME:-clinicaexemplo_site}
      WORDPRESS_DB_USER: ${WORDPRESS_DB_USER:-wordpress}
      WORDPRESS_DB_PASSWORD: ${WORDPRESS_DB_PASSWORD:-wordpress}
    volumes:
      - wordpress_data:/var/www/html
      - ./wp-content:/var/www/html/wp-content
    working_dir: /var/www/html
    entrypoint: ["wp"]

volumes:
  db_data:
  wordpress_data:
```

```dotenv
# site/.env.example
WORDPRESS_DB_NAME=clinicaexemplo_site
WORDPRESS_DB_USER=wordpress
WORDPRESS_DB_PASSWORD=wordpress
MARIADB_ROOT_PASSWORD=root-local-only
WORDPRESS_DEBUG=1
WP_ADMIN_USER=admin
WP_ADMIN_PASSWORD=change-me-local
WP_ADMIN_EMAIL=admin@example.test
```

- [ ] **Step 4: Add the bootstrap script**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
docker compose up -d db wordpress
until docker compose run --rm wpcli core is-installed >/dev/null 2>&1; do
  docker compose run --rm wpcli core install \
    --url=http://localhost:8088 \
    --title="Clínica Exemplo" \
    --admin_user="${WP_ADMIN_USER:-admin}" \
    --admin_password="${WP_ADMIN_PASSWORD:-change-me-local}" \
    --admin_email="${WP_ADMIN_EMAIL:-admin@example.test}" \
    --skip-email && break
  sleep 3
done
docker compose run --rm wpcli theme activate clinicaexemplo
"$(dirname "$0")/import-content.sh"
```

- [ ] **Step 5: Add package scripts and local setup documentation**

```json
{
  "name": "clinicaexemplo-public-site",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs",
    "start": "docker compose up -d",
    "stop": "docker compose down",
    "bootstrap": "bash scripts/bootstrap.sh",
    "smoke": "bash scripts/smoke-test.sh",
    "package-theme": "bash scripts/package-theme.sh"
  }
}
```

Document in `site/README.md`: prerequisites, `cp .env.example .env`, `npm test`, `npm run bootstrap`, local URLs, admin credentials policy, reset command using `docker compose down` without `-v` by default, and explicit warning that `down -v` deletes local content.

- [ ] **Step 6: Run the environment contract test**

Run: `node --test site/tests/compose.test.mjs`
Expected: PASS.

- [ ] **Step 7: Commit the local environment**

```bash
git add site/.env.example site/docker-compose.yml site/package.json site/tests/compose.test.mjs site/scripts/bootstrap.sh site/README.md
git commit -m "feat(site): add local WordPress environment"
```

### Task 2: Fundação e tokens do tema próprio

**Files:**
- Create: `site/tests/theme-structure.test.mjs`
- Create: `site/wp-content/themes/clinicaexemplo/style.css`
- Create: `site/wp-content/themes/clinicaexemplo/theme.json`
- Create: `site/wp-content/themes/clinicaexemplo/functions.php`
- Create: `site/wp-content/themes/clinicaexemplo/inc/setup.php`
- Create: `site/wp-content/themes/clinicaexemplo/index.php`
- Create: `site/wp-content/themes/clinicaexemplo/page.php`
- Create: `site/wp-content/themes/clinicaexemplo/assets/css/site.css`
- Create: `site/wp-content/themes/clinicaexemplo/assets/js/site.js`
- Create: `site/wp-content/themes/clinicaexemplo/assets/fonts/*.woff2`

**Interfaces:**
- Consumes: volume `site/wp-content` montado pelo Task 1.
- Produces: tema ativável `clinicaexemplo`, handle CSS `clinicaexemplo-site` e handle JS `clinicaexemplo-site`.

- [ ] **Step 1: Write the failing theme structure test**

```js
// site/tests/theme-structure.test.mjs
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../wp-content/themes/clinicaexemplo/', import.meta.url);

test('theme exposes required WordPress files and metadata', () => {
  for (const file of ['style.css', 'theme.json', 'functions.php', 'index.php']) {
    assert.equal(existsSync(new URL(file, root)), true, file);
  }
  const style = readFileSync(new URL('style.css', root), 'utf8');
  assert.match(style, /Theme Name:\s*Clínica Exemplo/);
  assert.match(style, /Text Domain:\s*clinicaexemplo/);
});
```

- [ ] **Step 2: Run the theme test to verify it fails**

Run: `node --test site/tests/theme-structure.test.mjs`
Expected: FAIL because the theme files do not exist.

- [ ] **Step 3: Create theme metadata and design tokens**

```css
/*
Theme Name: Clínica Exemplo
Description: Tema institucional leve para Fisioterapia e Psicologia.
Version: 1.0.0
Requires at least: 6.6
Requires PHP: 8.2
Text Domain: clinicaexemplo
*/
```

```json
{
  "$schema": "https://schemas.wp.org/trunk/theme.json",
  "version": 3,
  "settings": {
    "appearanceTools": true,
    "layout": { "contentSize": "760px", "wideSize": "1200px" },
    "color": {
      "palette": [
        { "slug": "forest", "name": "Verde profundo", "color": "#174D32" },
        { "slug": "leaf", "name": "Verde Clínica Exemplo", "color": "#5F8F3E" },
        { "slug": "sage", "name": "Sálvia clara", "color": "#E7EFE1" },
        { "slug": "white", "name": "Branco clínico", "color": "#FCFDFB" },
        { "slug": "graphite", "name": "Grafite", "color": "#202722" },
        { "slug": "sand", "name": "Areia neutra", "color": "#E9E3D8" }
      ]
    },
    "typography": {
      "fontFamilies": [
        { "slug": "display", "name": "Lora", "fontFamily": "Lora, Georgia, serif" },
        { "slug": "body", "name": "Manrope", "fontFamily": "Manrope, Arial, sans-serif" }
      ]
    }
  }
}
```

- [ ] **Step 4: Implement theme bootstrap and asset loading**

```php
<?php
// functions.php
if (!defined('ABSPATH')) { exit; }
require_once __DIR__ . '/inc/setup.php';
require_once __DIR__ . '/inc/settings.php';
require_once __DIR__ . '/inc/whatsapp.php';
require_once __DIR__ . '/inc/patterns.php';
require_once __DIR__ . '/inc/schema.php';
```

```php
<?php
// inc/setup.php
function clinicaexemplo_setup(): void {
    add_theme_support('title-tag');
    add_theme_support('post-thumbnails');
    add_theme_support('responsive-embeds');
    add_theme_support('editor-styles');
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
```

Add local `@font-face` declarations to `assets/css/site.css`, use `font-display: swap`, define CSS custom properties from the approved palette, and implement the 1200 px container, type scale and reduced-motion reset.

- [ ] **Step 5: Add minimal WordPress fallbacks**

`index.php` and `page.php` must call `get_header()`, render content inside `<main id="conteudo">`, and call `get_footer()` with proper escaping handled by WordPress content APIs.

- [ ] **Step 6: Run static tests and PHP lint in Docker**

Run: `npm --prefix site test`
Expected: PASS.

Run: `docker compose -f site/docker-compose.yml run --rm wordpress php -l /var/www/html/wp-content/themes/clinicaexemplo/functions.php`
Expected: `No syntax errors detected`.

- [ ] **Step 7: Commit theme foundation**

```bash
git add site/tests/theme-structure.test.mjs site/wp-content/themes/clinicaexemplo
git commit -m "feat(site): add Clínica Exemplo theme foundation"
```

### Task 3: Configurações globais e WhatsApp sem JavaScript

**Files:**
- Create: `site/tests/content.test.mjs`
- Create: `site/wp-content/themes/clinicaexemplo/inc/settings.php`
- Create: `site/wp-content/themes/clinicaexemplo/inc/whatsapp.php`
- Modify: `site/wp-content/themes/clinicaexemplo/functions.php`

**Interfaces:**
- Consumes: WordPress Settings API.
- Produces: `clinicaexemplo_get_setting(string $key): string`, `clinicaexemplo_whatsapp_url(string $context = ''): string`, shortcode `[clinicaexemplo_whatsapp]`.

- [ ] **Step 1: Write the failing content contract test**

```js
// site/tests/content.test.mjs
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
```

- [ ] **Step 2: Run the content test to verify it fails**

Run: `node --test site/tests/content.test.mjs`
Expected: FAIL because settings files do not exist.

- [ ] **Step 3: Implement centralized sanitized settings**

```php
<?php
// inc/settings.php
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
    return sanitize_text_field($settings[$key] ?? $defaults[$key] ?? '');
}
```

Register a `clinicaexemplo_settings` page under Appearance. Use `register_setting()` with a sanitization callback that applies `sanitize_text_field()` to phones, address and hours, and `esc_url_raw()` to URLs.

- [ ] **Step 4: Implement reusable WhatsApp URL and shortcode**

```php
<?php
// inc/whatsapp.php
function clinicaexemplo_whatsapp_url(string $context = ''): string {
    $phone = preg_replace('/\D+/', '', clinicaexemplo_get_setting('whatsapp'));
    $message = $context !== ''
        ? sprintf('Olá, gostaria de informações sobre %s.', $context)
        : 'Olá, gostaria de agendar uma avaliação.';
    return 'https://wa.me/' . rawurlencode($phone) . '?text=' . rawurlencode($message);
}

function clinicaexemplo_whatsapp_shortcode(array $atts = []): string {
    $atts = shortcode_atts(['contexto' => '', 'rotulo' => 'Agende sua avaliação'], $atts);
    return sprintf(
        '<a class="button button--whatsapp" href="%s" rel="noopener">%s</a>',
        esc_url(clinicaexemplo_whatsapp_url((string) $atts['contexto'])),
        esc_html((string) $atts['rotulo'])
    );
}
add_shortcode('clinicaexemplo_whatsapp', 'clinicaexemplo_whatsapp_shortcode');
```

- [ ] **Step 5: Run tests and verify a URL through WP-CLI**

Run: `npm --prefix site test`
Expected: PASS.

Run after bootstrap: `docker compose -f site/docker-compose.yml run --rm wpcli eval 'echo clinicaexemplo_whatsapp_url("fisioterapia");'`
Expected: URL beginning with `https://wa.me/11999990100?text=`.

- [ ] **Step 6: Commit global settings**

```bash
git add site/tests/content.test.mjs site/wp-content/themes/clinicaexemplo/inc/settings.php site/wp-content/themes/clinicaexemplo/inc/whatsapp.php site/wp-content/themes/clinicaexemplo/functions.php
git commit -m "feat(site): add editable clinic settings and WhatsApp CTA"
```

### Task 4: Cabeçalho, rodapé, navegação e schema local

**Files:**
- Create: `site/tests/accessibility.test.mjs`
- Create: `site/wp-content/themes/clinicaexemplo/header.php`
- Create: `site/wp-content/themes/clinicaexemplo/footer.php`
- Create: `site/wp-content/themes/clinicaexemplo/inc/schema.php`
- Modify: `site/wp-content/themes/clinicaexemplo/assets/css/site.css`
- Modify: `site/wp-content/themes/clinicaexemplo/assets/js/site.js`

**Interfaces:**
- Consumes: menu `primary` and funções dos Tasks 2–3.
- Produces: `.site-header`, `.site-nav`, `[data-menu-toggle]`, `.site-footer`, JSON-LD `MedicalBusiness`.

- [ ] **Step 1: Write failing accessibility invariants**

```js
// site/tests/accessibility.test.mjs
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('../wp-content/themes/clinicaexemplo/', import.meta.url);

test('header has skip link and an expanded-state menu control', () => {
  const header = readFileSync(new URL('header.php', root), 'utf8');
  assert.match(header, /href="#conteudo"/);
  assert.match(header, /aria-expanded="false"/);
  assert.match(header, /aria-controls="menu-principal"/);
});

test('CSS preserves focus and reduced motion', () => {
  const css = readFileSync(new URL('assets/css/site.css', root), 'utf8');
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test site/tests/accessibility.test.mjs`
Expected: FAIL because header/footer do not exist.

- [ ] **Step 3: Build semantic header and footer**

The header must include: skip link, custom logo fallback, primary menu, mobile button with `aria-expanded`, and a server-rendered WhatsApp link. The footer must escape every setting, expose real contact links (`tel:` and `https://wa.me/`), link to privacy policy and include `wp_footer()`.

```php
<a class="skip-link" href="#conteudo"><?php esc_html_e('Pular para o conteúdo', 'clinicaexemplo'); ?></a>
<button class="menu-toggle" type="button" aria-expanded="false" aria-controls="menu-principal" data-menu-toggle>
  <span class="screen-reader-text"><?php esc_html_e('Abrir menu', 'clinicaexemplo'); ?></span>
  <span aria-hidden="true"></span>
</button>
```

- [ ] **Step 4: Implement progressive menu behavior**

```js
const toggle = document.querySelector('[data-menu-toggle]');
const menu = document.getElementById('menu-principal');

if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    menu.toggleAttribute('data-open', !open);
  });
}
```

CSS must leave desktop navigation visible without JS, hide only the mobile collapsible menu after a `.js` class is added to `<html>`, show `:focus-visible` outlines, and avoid animating under reduced motion.

- [ ] **Step 5: Add escaped LocalBusiness schema**

```php
<?php
// inc/schema.php
function clinicaexemplo_schema(): void {
    if (!is_front_page()) { return; }
    $schema = [
        '@context' => 'https://schema.org',
        '@type' => 'MedicalBusiness',
        'name' => get_bloginfo('name'),
        'telephone' => clinicaexemplo_get_setting('phone_1'),
        'address' => [
            '@type' => 'PostalAddress',
            'streetAddress' => 'Av. Exemplo, 1000',
            'addressLocality' => 'São Paulo',
            'addressRegion' => 'SP',
            'postalCode' => '02332-001',
            'addressCountry' => 'BR',
        ],
        'sameAs' => [clinicaexemplo_get_setting('instagram')],
    ];
    printf('<script type="application/ld+json">%s</script>', wp_json_encode($schema, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
}
add_action('wp_head', 'clinicaexemplo_schema');
```

- [ ] **Step 6: Run tests and inspect rendered header**

Run: `npm --prefix site test`
Expected: PASS.

Run: `curl -fsS http://localhost:8088 | grep -E 'Pular para o conteúdo|menu-principal|application/ld\+json'`
Expected: all three markers found.

- [ ] **Step 7: Commit the global shell**

```bash
git add site/tests/accessibility.test.mjs site/wp-content/themes/clinicaexemplo/header.php site/wp-content/themes/clinicaexemplo/footer.php site/wp-content/themes/clinicaexemplo/inc/schema.php site/wp-content/themes/clinicaexemplo/assets
git commit -m "feat(site): add responsive global navigation and footer"
```

### Task 5: Home completa com componentes editáveis

**Files:**
- Create: `site/wp-content/themes/clinicaexemplo/front-page.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/hero.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/treatments.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/insurance.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/home-care.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/testimonials.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/psychology.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/gallery.php`
- Create: `site/wp-content/themes/clinicaexemplo/parts/contact.php`
- Create: `site/wp-content/themes/clinicaexemplo/inc/patterns.php`
- Modify: `site/wp-content/themes/clinicaexemplo/assets/css/site.css`
- Modify: `site/tests/content.test.mjs`

**Interfaces:**
- Consumes: WordPress page content, media IDs and global settings.
- Produces: `front-page.php` with one H1 and eight ordered sections; block pattern category `clinicaexemplo`.

- [ ] **Step 1: Extend the failing content test for home sections**

```js
test('front page composes every approved section exactly once', () => {
  const home = readFileSync(new URL('front-page.php', theme), 'utf8');
  for (const part of ['hero', 'treatments', 'insurance', 'home-care', 'testimonials', 'psychology', 'gallery', 'contact']) {
    const matches = home.match(new RegExp(`get_template_part\\('parts/${part}'`, 'g')) ?? [];
    assert.equal(matches.length, 1, part);
  }
});
```

- [ ] **Step 2: Run the home contract test to verify it fails**

Run: `node --test site/tests/content.test.mjs`
Expected: FAIL because `front-page.php` does not exist.

- [ ] **Step 3: Compose the front page from focused parts**

```php
<?php get_header(); ?>
<main id="conteudo">
  <?php get_template_part('parts/hero'); ?>
  <?php get_template_part('parts/treatments'); ?>
  <?php get_template_part('parts/insurance'); ?>
  <?php get_template_part('parts/home-care'); ?>
  <?php get_template_part('parts/testimonials'); ?>
  <?php get_template_part('parts/psychology'); ?>
  <?php get_template_part('parts/gallery'); ?>
  <?php get_template_part('parts/contact'); ?>
</main>
<?php get_footer(); ?>
```

Each part must have one semantic heading level, query its editable page/block content or theme setting, escape direct values, declare image dimensions and use `wp_get_attachment_image()` for responsive `srcset`.

- [ ] **Step 4: Implement the hero thesis and signature curve**

Hero copy:

```text
Fisioterapia na Zona Norte para viver com mais força e movimento
Atendimento personalizado para aliviar a dor, recuperar sua mobilidade e fortalecer seu corpo.
Agende sua avaliação
```

Use a CSS pseudo-element with an SVG mask inspired by the logo curve as the single signature element. Do not use gradients or animated decorative particles. The hero CTA must be a normal `<a href="https://wa.me/...">`.

- [ ] **Step 5: Implement approved home content**

- Treatments: Reabilitação física, Dores crônicas, Prevenção e mobilidade.
- Insurance: editable grid, textual fallback and “Consulte a cobertura do seu plano pelo WhatsApp.”
- Home care: “Atendimento particular na Zona Norte de São Paulo, mediante disponibilidade.”
- Benefits: four approved differentiators.
- Testimonials: render only published items; when none exist, omit the section rather than invent reviews.
- Psychology: exact approved audience copy and link to `/psicologia/`.
- Gallery: real media only, with captions/alt text.
- Contact: real settings, lazy map and maps link.

- [ ] **Step 6: Register reusable block patterns**

Register category `clinicaexemplo` and patterns for CTA, two-column service intro and contact panel. Pattern content must use core blocks and the WhatsApp shortcode; do not duplicate full PHP components inside block markup.

- [ ] **Step 7: Run tests and inspect H1 count**

Run: `npm --prefix site test`
Expected: PASS.

Run: `curl -fsS http://localhost:8088 | grep -o '<h1' | wc -l`
Expected: `1`.

- [ ] **Step 8: Commit the home page**

```bash
git add site/wp-content/themes/clinicaexemplo/front-page.php site/wp-content/themes/clinicaexemplo/parts site/wp-content/themes/clinicaexemplo/inc/patterns.php site/wp-content/themes/clinicaexemplo/assets/css/site.css site/tests/content.test.mjs
git commit -m "feat(site): build the Clínica Exemplo home page"
```

### Task 6: Templates das cinco páginas internas

**Files:**
- Create: `site/wp-content/themes/clinicaexemplo/templates/page-fisioterapia.php`
- Create: `site/wp-content/themes/clinicaexemplo/templates/page-psicologia.php`
- Create: `site/wp-content/themes/clinicaexemplo/templates/page-convenios.php`
- Create: `site/wp-content/themes/clinicaexemplo/templates/page-estrutura.php`
- Create: `site/wp-content/themes/clinicaexemplo/templates/page-contato.php`
- Modify: `site/wp-content/themes/clinicaexemplo/assets/css/site.css`
- Modify: `site/tests/content.test.mjs`

**Interfaces:**
- Consumes: global header/footer, WhatsApp helper, settings and WordPress page content.
- Produces: five selectable page templates with one H1 each.

- [ ] **Step 1: Extend the failing page-template contract**

```js
test('all approved internal templates exist and identify themselves', () => {
  const templates = ['fisioterapia', 'psicologia', 'convenios', 'estrutura', 'contato'];
  for (const slug of templates) {
    const source = readFileSync(new URL(`templates/page-${slug}.php`, theme), 'utf8');
    assert.match(source, /Template Name:/);
    assert.match(source, /<h1/);
  }
});
```

- [ ] **Step 2: Run the page-template test to verify it fails**

Run: `node --test site/tests/content.test.mjs`
Expected: FAIL on the first missing template.

- [ ] **Step 3: Implement Fisioterapia and Psicologia templates**

Both templates use a shared internal hero structure but retain page-specific content. Fisioterapia includes the three treatment areas, resources, home care and CTA. Psicologia includes children, adolescents and adults, individualized follow-up, insurance/private label and CTA. Do not make clinical guarantees.

- [ ] **Step 4: Implement Convênios template**

Render a server-side grid from core blocks saved in the Convênios page, using one Group block per provider. Each item supports name, logo and external coverage URL; editors add and reorder providers directly in the block editor without a custom post type. If a logo is absent, show the escaped provider name. Include the WhatsApp coverage message.

- [ ] **Step 5: Implement Estrutura template and accessible lightbox**

Gallery anchors must link directly to full image files so they work without JavaScript. JavaScript may enhance them into a dialog with `aria-modal="true"`, focus trap, Escape close, previous/next buttons and focus return. The page must show only real uploaded media.

- [ ] **Step 6: Implement Contato template**

Render WhatsApp, both telephone links, address and opening hours. For the map, render a lightweight static preview with the clinic address, an “Abrir mapa” button and a normal link to the configured Google Maps URL; do not load an interactive iframe before user action. Do not add a contact form in this scope.

- [ ] **Step 7: Run tests and PHP lint all templates**

Run: `npm --prefix site test`
Expected: PASS.

Run: `find site/wp-content/themes/clinicaexemplo -name '*.php' -print0 | xargs -0 -n1 php -l`
Expected: every file reports no syntax errors. If local PHP is unavailable, run the equivalent command inside the `wordpress` container.

- [ ] **Step 8: Commit internal pages**

```bash
git add site/wp-content/themes/clinicaexemplo/templates site/wp-content/themes/clinicaexemplo/assets site/tests/content.test.mjs
git commit -m "feat(site): add service, structure and contact pages"
```

### Task 7: Fotografias reais e conteúdo inicial idempotente

**Files:**
- Create: `site/wp-content/themes/clinicaexemplo/assets/images/structure/*.webp`
- Create: `site/wp-content/themes/clinicaexemplo/assets/images/structure/*.avif`
- Create: `site/wp-content/themes/clinicaexemplo/assets/images/README.md`
- Create: `site/scripts/import-content.sh`
- Modify: `site/scripts/bootstrap.sh`
- Modify: `site/tests/content.test.mjs`

**Interfaces:**
- Consumes: fotos fornecidas pelo proprietário e templates dos Tasks 5–6.
- Produces: mídia otimizada, seis páginas publicadas, menu principal e página inicial configurada.

- [ ] **Step 1: Add a failing content-import contract**

```js
test('content importer creates all pages and remains idempotent', () => {
  const script = readFileSync(new URL('../scripts/import-content.sh', import.meta.url), 'utf8');
  for (const slug of ['inicio', 'fisioterapia', 'psicologia', 'convenios', 'estrutura', 'contato']) {
    assert.match(script, new RegExp(`ensure_page .*${slug}`));
  }
  assert.match(script, /wp post list.*--name=/);
  assert.match(script, /show_on_front/);
});
```

- [ ] **Step 2: Run the importer contract to verify it fails**

Run: `node --test site/tests/content.test.mjs`
Expected: FAIL because `import-content.sh` does not exist.

- [ ] **Step 3: Copy and optimize selected real photos**

Use the selected files:

- main physiotherapy room: `IMG_0548.jpeg`;
- psychology room: `IMG_0550.jpeg`;
- reception: `IMG_0553.jpeg`;
- psychology access: `IMG_0551.jpeg`;
- existing facade photographs `clinica.webp` and `clinica2.webp`.

Create 1600 px WebP and AVIF outputs with quality preserving signage. Never use generative edits on the production asset; allow only crop, perspective, exposure and white-balance corrections. Record original filename, output filename, alt text and recommended placement in `assets/images/README.md`.

- [ ] **Step 4: Implement idempotent page creation**

```bash
#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
wpcli=(docker compose run --rm wpcli)

ensure_page() {
  local title="$1" slug="$2" template="$3"
  local id
  id="$(${wpcli[@]} post list --post_type=page --name="$slug" --field=ID --format=ids)"
  if [[ -z "$id" ]]; then
    id="$(${wpcli[@]} post create --post_type=page --post_status=publish --post_title="$title" --post_name="$slug" --porcelain)"
  fi
  ${wpcli[@]} post meta update "$id" _wp_page_template "$template" >/dev/null
  printf '%s' "$id"
}

home_id="$(ensure_page 'Início' inicio default)"
ensure_page 'Fisioterapia' fisioterapia templates/page-fisioterapia.php >/dev/null
ensure_page 'Psicologia' psicologia templates/page-psicologia.php >/dev/null
ensure_page 'Convênios' convenios templates/page-convenios.php >/dev/null
ensure_page 'Estrutura' estrutura templates/page-estrutura.php >/dev/null
ensure_page 'Contato' contato templates/page-contato.php >/dev/null
${wpcli[@]} option update show_on_front page
${wpcli[@]} option update page_on_front "$home_id"
```

Extend the script to create the primary menu only when absent, attach the six pages in the approved order, import media only when a matching `_wp_attached_file` is not present, and set alt text explicitly.

- [ ] **Step 5: Bootstrap twice and verify idempotence**

Run: `npm --prefix site run bootstrap && npm --prefix site run bootstrap`
Expected: both runs succeed; the second does not create duplicate pages, menu items or attachments.

Run: `docker compose -f site/docker-compose.yml run --rm wpcli post list --post_type=page --format=count`
Expected: exactly `6` site pages before WordPress-generated privacy/sample content is considered; delete the default Sample Page during import.

- [ ] **Step 6: Commit real media and content seed**

```bash
git add site/wp-content/themes/clinicaexemplo/assets/images site/scripts/import-content.sh site/scripts/bootstrap.sh site/tests/content.test.mjs
git commit -m "feat(site): seed real clinic content and photography"
```

### Task 8: Smoke tests, responsive QA and theme package

**Files:**
- Create: `site/scripts/smoke-test.sh`
- Create: `site/scripts/package-theme.sh`
- Create: `site/qa/README.md`
- Create: `site/qa/lighthouse-budget.json`
- Modify: `site/README.md`
- Modify: `site/package.json`

**Interfaces:**
- Consumes: complete local site from Tasks 1–7.
- Produces: verified local site and `site/dist/clinicaexemplo-theme-1.0.0.zip`.

- [ ] **Step 1: Write the failing smoke script**

```bash
#!/usr/bin/env bash
set -euo pipefail
base="${SITE_URL:-http://localhost:8088}"
for path in / /fisioterapia/ /psicologia/ /convenios/ /estrutura/ /contato/; do
  html="$(curl -fsS "$base$path")"
  [[ "$(grep -o '<h1' <<<"$html" | wc -l | tr -d ' ')" == "1" ]]
  grep -q 'https://wa.me/11999990100' <<<"$html"
done
```

- [ ] **Step 2: Run smoke test before final routing/content and confirm any failures**

Run: `bash site/scripts/smoke-test.sh`
Expected: FAIL if any page, H1 or WhatsApp CTA is missing.

- [ ] **Step 3: Fix only failures revealed by smoke testing**

For each failing route, correct template assignment, permalink flush or CTA composition. Do not add new features. Re-run until all six routes pass.

- [ ] **Step 4: Add responsive and accessibility QA checklist**

`site/qa/README.md` must require screenshots at widths 360, 390, 768, 1024 and 1440 px; keyboard traversal; menu focus return; lightbox Escape close; visible focus; image alt inspection; no horizontal overflow; reduced-motion verification; and confirmation that no desktop/mobile duplicate sections exist.

- [ ] **Step 5: Add Lighthouse budget and run audits**

```json
{
  "performance": 0.9,
  "accessibility": 0.9,
  "best-practices": 0.9,
  "seo": 0.9
}
```

Run Lighthouse against `/`, `/fisioterapia/`, `/psicologia/` and `/contato/`. Save reports outside Git or under `site/qa/reports/` ignored by Git. Record scores and any accepted limitations in `site/qa/README.md`.

- [ ] **Step 6: Implement deterministic theme packaging**

```bash
#!/usr/bin/env bash
set -euo pipefail
root="$(cd "$(dirname "$0")/.." && pwd)"
version="1.0.0"
mkdir -p "$root/dist"
cd "$root/wp-content/themes"
zip -qr "$root/dist/clinicaexemplo-theme-$version.zip" clinicaexemplo \
  -x '*/.DS_Store' '*/node_modules/*' '*/tests/*'
unzip -t "$root/dist/clinicaexemplo-theme-$version.zip"
```

- [ ] **Step 7: Run the full verification suite**

Run: `npm --prefix site test`
Expected: all Node tests PASS.

Run: `npm --prefix site run smoke`
Expected: all six pages PASS.

Run: `find site/wp-content/themes/clinicaexemplo -name '*.php' -print0 | xargs -0 -n1 php -l`
Expected: no PHP syntax errors.

Run: `npm --prefix site run package-theme`
Expected: ZIP integrity check passes and archive exists at `site/dist/clinicaexemplo-theme-1.0.0.zip`.

- [ ] **Step 8: Perform final visual review in browser**

Open the local site at desktop and mobile widths. Compare against the approved direction, confirm that the real reception—not an idealized replacement—appears in the structure gallery, remove one decorative element if the page feels crowded, and record the final screenshot paths in `site/qa/README.md`.

- [ ] **Step 9: Commit verification and handoff**

```bash
git add site/scripts/smoke-test.sh site/scripts/package-theme.sh site/qa site/README.md site/package.json
git commit -m "test(site): verify and package the Clínica Exemplo theme"
```

## Final Acceptance Checklist

- [ ] `npm --prefix site test` passes.
- [ ] WordPress boots locally at `http://localhost:8088`.
- [ ] Six approved pages exist and each has exactly one H1.
- [ ] Every CTA opens `wa.me/11999990100` without requiring JavaScript.
- [ ] Contact data matches the approved specification.
- [ ] Real clinic photos are used for structure and psychology; no idealized reception remains.
- [ ] Desktop and mobile screenshots have no whitespace gaps, duplication or horizontal overflow.
- [ ] Keyboard, focus, reduced-motion and lightbox checks pass.
- [ ] Lighthouse scores meet or document deviations from the 90-point target.
- [ ] Theme ZIP validates and installation instructions are complete.
