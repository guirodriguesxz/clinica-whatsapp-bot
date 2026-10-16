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

