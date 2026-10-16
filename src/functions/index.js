import { listarAgendamentos } from "./listarAgendamentos.js";
import { consultarBaseConhecimento } from "./consultarBaseConhecimento.js";
import { encaminharHumano } from "./encaminharHumano.js";

export { toolSchemas } from "./schemas.js";

// checar_disponibilidade, criar_agendamento, cancelar_agendamento e
// remarcar_agendamento não são mais oferecidas ao modelo (ver schemas.js) —
// agendamento, cancelamento e remarcação são sempre feitos pela equipe, não
// pelo bot. Os handlers continuam em ./checarDisponibilidade.js etc. com
// seus próprios testes, só não são mais importados/despachados aqui.

/**
 * Mapa nome-da-function -> handler. O aiService usa isso para despachar as
 * tool_calls que a OpenAI devolve, sempre passando `context` (dados do
 * paciente que o próprio sistema já conhece, nunca fornecidos pelo modelo).
 */
export const functionHandlers = {
  listar_agendamentos: listarAgendamentos,
  consultar_base_conhecimento: consultarBaseConhecimento,
  encaminhar_humano: encaminharHumano,
};
