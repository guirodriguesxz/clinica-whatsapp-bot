import {
  buscarNaBaseConhecimento,
  listarEntradasPorCategoria,
} from "../models/baseConhecimentoModel.js";

// A busca devolve as entradas mais PARECIDAS com a pergunta, mesmo quando
// nenhuma trata do assunto — e o modelo generalizava a partir delas (caso
// real 2026-09-23: perguntaram por terapia por ondas de choque, a busca
// trouxe a entrada "não fazemos drenagem/kinesio/perineal" e o bot afirmou
// que a clínica não faz ondas de choque, o que não estava na base). A regra
// no prompt sozinha não segurou isso na verificação contra a API real; a
// instrução vai junto do resultado, no momento em que o modelo decide.
// (De novo em 2026-10-05: perguntaram por consulta online, a busca trouxe
// a entrada de atendimento a domicílio e o bot respondeu "sim, fazemos
// online, só particular" — a clínica não faz casal online.)
//
// Desde 2026-10-05 a lista de casos de Fisioterapia da base é FECHADA
// (pedido da clínica: "tudo que não estiver na base, fala que não atende").
// Por isso as entradas de casos atendidos e de casos não atendidos vão
// SEMPRE no resultado: quando a busca não as trazia, o modelo recusava AVC
// (que está na lista) ou encaminhava autismo (que a clínica não atende).
export const CATEGORIA_CASOS_ATENDIDOS = "fisioterapia_tratamentos";
export const CATEGORIA_NAO_ATENDIDOS = "sem_atendimento";

export const INSTRUCAO_CASOS =
  "Pergunta sobre TRATAMENTO, TÉCNICA ou CONDIÇÃO/diagnóstico: use as listas casosAtendidosFisioterapia e naoAtendidos. PRIMEIRO confira naoAtendidos: se a condição estiver lá, a resposta é que a Clínica Exemplo não atende — em NENHUMA área, Psicologia inclusive —, sem encaminhar e sem oferecer a outra área. Fisioterapia: se não estiver escrito em casosAtendidosFisioterapia (confira sinônimos: derrame = AVC, torção = entorse), diga com gentileza que a Clínica Exemplo não atende esse caso, sem encaminhar e sem pedir dados. Psicologia: só o que estiver em naoAtendidos é recusado; o resto vai pra equipe (encaminhar_humano, categoria \"psicologia\"). Nunca diga \"sim, atendemos\" uma condição que não esteja escrita na lista.";

export const INSTRUCAO_RESPOSTAS_ENCONTRADAS =
  "Use as respostas SÓ se tratarem exatamente do assunto perguntado — assunto parecido NÃO é o mesmo assunto (ex: atendimento a domicílio não diz nada sobre consulta online/teleatendimento; não deduza um a partir do outro). Pra outros assuntos (que não sejam tratamento/condição) que não aparecerem nelas com todas as letras, NÃO afirme nem negue nada — use encaminhar_humano (categoria \"outro\") e diga que a equipe responde. " +
  INSTRUCAO_CASOS;

export async function consultarBaseConhecimento({ pergunta }) {
  const [resultados, listas] = await Promise.all([
    buscarNaBaseConhecimento(pergunta),
    listarEntradasPorCategoria([CATEGORIA_CASOS_ATENDIDOS, CATEGORIA_NAO_ATENDIDOS]),
  ]);
  const daCategoria = (c) => listas.filter((e) => e.categoria === c).map((e) => e.resposta);

  return {
    encontrado: resultados.length > 0,
    respostas: resultados.map((r) => r.resposta),
    casosAtendidosFisioterapia: daCategoria(CATEGORIA_CASOS_ATENDIDOS),
    naoAtendidos: daCategoria(CATEGORIA_NAO_ATENDIDOS),
    observacao: INSTRUCAO_RESPOSTAS_ENCONTRADAS,
  };
}
