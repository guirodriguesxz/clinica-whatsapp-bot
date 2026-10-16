// src/services/controleSessoesMensagemService.js
import { formatarData } from "../utils/data.js";

const NOME_CLINICA = "Clínica Exemplo — Controle de Fisioterapia";

// "confirmado" no banco significa "sessão agendada, ainda não aconteceu" —
// pro paciente ler no controle, "agendado" é mais claro que o nome interno
// do status (decisão do usuário, 2026-09-14). Os demais status (compareceu,
// faltou, cancelado, concluido) já são claros como estão.
const NOMES_STATUS_SESSAO = {
  confirmado: "agendado",
};

function rotuloStatus(status) {
  return NOMES_STATUS_SESSAO[status] ?? status ?? "";
}

/**
 * Alternativa em texto ao PDF do controle de sessões, pra mandar direto
 * como mensagem de WhatsApp (decisão do usuário, 2026-09-14, substituindo o
 * envio por PDF/documento). Ao contrário do cartão impresso (sempre 10
 * linhas, preenchendo o resto em branco pra assinatura física), aqui só
 * entram as sessões que já têm data marcada — linha em branco não faz
 * sentido numa mensagem de texto.
 */
export function montarMensagemControleSessoes({ paciente, sessoes, dataAvaliacao = null }) {
  const sessoesPreenchidas = sessoes.filter((sessao) => sessao.data);

  const linhas = [
    `*${NOME_CLINICA}*`,
    `Paciente: ${paciente.nome}`,
    `Avaliação: ${dataAvaliacao ? formatarData(dataAvaliacao) : "—"}`,
    "",
  ];

  if (sessoesPreenchidas.length === 0) {
    linhas.push("Nenhuma sessão registrada ainda.");
  } else {
    for (const sessao of sessoesPreenchidas) {
      const hora = sessao.hora ? String(sessao.hora).slice(0, 5) : "";
      linhas.push(`${sessao.numero}. ${formatarData(sessao.data)} ${hora} — ${rotuloStatus(sessao.status)}`.trim());
    }
  }

  return linhas.join("\n");
}
