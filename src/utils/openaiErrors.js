// A OpenAI devolve HTTP 429 tanto para rate limit comum (transitório, resolve
// sozinho em segundos) quanto para falta de créditos/saldo (não resolve
// sozinho — fica preso até alguém recarregar). O `code` exato pra esse
// segundo caso já variou entre contas/planos: "insufficient_quota" é o mais
// documentado, mas testando ao vivo nesta conta (2026-08-24, sem crédito de
// propósito) a API devolveu "credit_balance_exhausted" — por isso checamos
// os dois em vez de confiar só na doc. Helper compartilhado entre aiService
// (fallback durante uma conversa real) e openaiHealthService (checagem
// proativa) pra não duplicar essa distinção em dois lugares.
const CODIGOS_SEM_CREDITO = new Set(["insufficient_quota", "credit_balance_exhausted"]);

export function ehErroDeCreditosEsgotados(err) {
  return err?.status === 429 && CODIGOS_SEM_CREDITO.has(err?.code);
}
