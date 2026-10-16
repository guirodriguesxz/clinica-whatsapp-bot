// src/utils/dinheiro.js

/**
 * Formata um valor monetário com sempre 2 casas decimais, aceitando tanto
 * number quanto string como entrada.
 *
 * Por quê: a mesma coluna `pagamentos.valor` (NUMERIC) chega em formatos
 * diferentes dependendo de como a query foi escrita — lida direto de uma
 * coluna, o driver `pg` devolve string (ex: "150.00"); dentro de um
 * json_build_object (usado em listarFinanceiro pra montar os itens
 * aninhados), o Postgres já serializa como JSON number e o driver faz
 * JSON.parse, chegando como JS number (ex: 150.5, sem zero à direita). Sem
 * essa normalização, a mesma quantia aparecia formatada diferente em
 * /financeiro (lista, via json_build_object) e /financeiro/relatorio
 * (coluna direta) — usar essa função nas duas views garante consistência.
 */
export function formatarMoeda(valor) {
  const numero = typeof valor === "number" ? valor : Number(valor);
  if (!Number.isFinite(numero)) return "0.00";
  return numero.toFixed(2);
}
