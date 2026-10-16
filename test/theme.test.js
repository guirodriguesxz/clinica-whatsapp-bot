import { URL } from "node:url";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const script = await readFile(new URL('../public/theme.js', import.meta.url), 'utf8');
test('tema restaura preferência, alterna e grava a escolha', () => {
  let valor = 'dark'; let clique;
  const button = { setAttribute(chave, valor) { this[chave] = valor; }, addEventListener(evento, fn) { clique = fn; } };
  const document = { documentElement: { dataset: {} }, querySelector: () => button, addEventListener: (e, fn) => fn() };
  vm.runInNewContext(script, { document, localStorage: { getItem: () => valor, setItem: (chave, novo) => { valor = novo; } } });
  assert.equal(document.documentElement.dataset.theme, 'dark');
  clique();
  assert.equal(valor, 'light');
  assert.equal(button['aria-pressed'], 'false');
});
test('tema funciona mesmo quando armazenamento é bloqueado', () => {
  let clique;
  const document = { documentElement: { dataset: {} }, querySelector: () => ({ setAttribute() {}, addEventListener(e, fn) { clique = fn; } }), addEventListener: (e, fn) => fn() };
  vm.runInNewContext(script, { document, localStorage: { getItem() { throw Error(); }, setItem() { throw Error(); } } });
  clique();
  assert.equal(document.documentElement.dataset.theme, 'dark');
});
