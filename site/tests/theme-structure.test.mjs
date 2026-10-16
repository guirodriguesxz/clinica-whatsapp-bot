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

test('theme ships and renders the official Clínica Exemplo logo', () => {
  assert.equal(existsSync(new URL('assets/images/logo-clinica-exemplo.png', root)), true);
  const header = readFileSync(new URL('header.php', root), 'utf8');
  const footer = readFileSync(new URL('footer.php', root), 'utf8');
  assert.match(header, /logo-clinica-exemplo\.png/);
  assert.match(footer, /logo-clinica-exemplo\.png/);
});
