import { URL } from "node:url";
import { test } from 'node:test';
import assert from 'node:assert/strict';
import ejs from 'ejs';
const caminho = new URL('../src/views/hoje/lista.ejs', import.meta.url).pathname;
test('Hoje renderiza ações protegidas e não cria ficha vazia para importado', async () => {
  const html = await ejs.renderFile(caminho, {
    itens: [{ id: 5, origem: 'importado', paciente_nome: '<Maria>', hora: '09:00:00', tipo_atendimento: 'fisioterapia', status: 'confirmado', ja_passou: true }],
    resumo: { total: 1, confirmados: 1, compareceram: 0, faltaram: 0 }, dataHoje: '2026-09-05', mensagem: null, csrfToken: 'token', usuarioAtual: null,
  });
  assert.match(html, /agendamentos\/importado\/5\/presenca/);
  assert.match(html, /financeiro\/importado\/5/);
  assert.match(html, /name="retorno" value="hoje"/);
  assert.match(html, /&lt;Maria&gt;/);
  assert.doesNotMatch(html, /pacientes\/\/ficha/);
});

test('Hoje: item com paciente_id mostra o botão de imprimir ficha (🖨️ Ficha)', async () => {
  const html = await ejs.renderFile(caminho, {
    itens: [{ id: 6, origem: 'bot', paciente_id: 42, paciente_nome: 'Ana', hora: '10:00:00', tipo_atendimento: 'fisioterapia', status: 'confirmado', ja_passou: false }],
    resumo: { total: 1, confirmados: 1, compareceram: 0, faltaram: 0 }, dataHoje: '2026-09-05', mensagem: null, csrfToken: 'token', usuarioAtual: null,
  });
  assert.match(html, /href="\/pacientes\/42\/ficha\?imprimir=1"[^>]*target="_blank"[^>]*>🖨️ Ficha</);
});

test('Hoje: item importado (sem paciente_id) não mostra o botão de imprimir ficha', async () => {
  const html = await ejs.renderFile(caminho, {
    itens: [{ id: 5, origem: 'importado', paciente_nome: 'Maria', hora: '09:00:00', tipo_atendimento: 'fisioterapia', status: 'confirmado', ja_passou: true }],
    resumo: { total: 1, confirmados: 1, compareceram: 0, faltaram: 0 }, dataHoje: '2026-09-05', mensagem: null, csrfToken: 'token', usuarioAtual: null,
  });
  assert.doesNotMatch(html, /🖨️ Ficha/);
});

test('Hoje: tem a barra de marcação de presença em lote (checkbox por atendimento + botões Compareceu/Faltou) quando há atendimento não cancelado', async () => {
  const html = await ejs.renderFile(caminho, {
    itens: [{ id: 5, origem: 'bot', paciente_id: 5, paciente_nome: 'Maria', hora: '09:00:00', tipo_atendimento: 'fisioterapia', status: 'confirmado', ja_passou: false }],
    resumo: { total: 1, confirmados: 1, compareceram: 0, faltaram: 0 }, dataHoje: '2026-09-05', mensagem: null, csrfToken: 'token', usuarioAtual: null,
  });
  assert.match(html, /id="form-presenca-lote"[^>]*action="\/agendamentos\/presenca-lote"/);
  assert.match(html, /name="retorno_url" value="\/hoje"/);
  assert.match(html, /value="bot:5" class="presenca-lote-checkbox"/);
  assert.match(html, /name="presenca" value="compareceu"/);
  assert.match(html, /name="presenca" value="faltou"/);
});

test('Hoje: sem nenhum atendimento não cancelado, não mostra a barra de presença em lote', async () => {
  const html = await ejs.renderFile(caminho, {
    itens: [{ id: 5, origem: 'bot', paciente_nome: 'Maria', hora: '09:00:00', tipo_atendimento: 'fisioterapia', status: 'cancelado', ja_passou: true }],
    resumo: { total: 1, confirmados: 0, compareceram: 0, faltaram: 0 }, dataHoje: '2026-09-05', mensagem: null, csrfToken: 'token', usuarioAtual: null,
  });
  assert.doesNotMatch(html, /id="form-presenca-lote"/);
  assert.doesNotMatch(html, /name="itens"/);
});

test('Hoje: mostra a mensagem passada (vinda do lote de presença ou de um form individual)', async () => {
  const html = await ejs.renderFile(caminho, {
    itens: [],
    resumo: { total: 0, confirmados: 0, compareceram: 0, faltaram: 0 }, dataHoje: '2026-09-05', mensagem: '2 presenças registradas.', csrfToken: 'token', usuarioAtual: null,
  });
  assert.match(html, /2 presenças registradas\./);
});
