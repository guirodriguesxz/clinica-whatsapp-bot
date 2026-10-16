// Preposições que ficam em minúsculo no meio do nome (ex: "Maria DA Silva
// DE Souza" -> "Maria da Silva de Souza"), exceto quando é a primeira
// palavra do nome.
const PREPOSICOES = new Set(["da", "de", "do", "das", "dos", "e"]);

/**
 * Deixa um nome em Title Case (ex: "KARIN REGINA ROCHA" -> "Karin Regina
 * Rocha"). Usado pros nomes vindos do sistema de agenda anterior (agendamentos_importados),
 * que chegam em CAIXA ALTA — sem isso, mensagens automáticas pro paciente
 * (lembrete etc) saem gritando o nome dele todo em maiúsculo.
 */
export function capitalizarNome(nome) {
  if (!nome) return nome;
  return nome
    .toLowerCase()
    .split(" ")
    .filter(Boolean)
    .map((palavra, indice) =>
      indice > 0 && PREPOSICOES.has(palavra) ? palavra : palavra[0].toUpperCase() + palavra.slice(1)
    )
    .join(" ");
}
