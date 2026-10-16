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
