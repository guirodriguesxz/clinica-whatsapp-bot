import { buscarAgendamentosConfirmadosFuturos } from "../models/agendamentoModel.js";
import { buscarAgendamentosImportadosFuturosCompletos } from "../models/agendamentoImportadoModel.js";

// Os agendamentos do sistema interno são informados SEM id: cancelar/remarcar
// não funcionam neles (ver cancelarAgendamento.js), e os ids das duas tabelas
// se sobrepõem — devolver um id importado aqui convidaria o modelo a passá-lo
// pra cancelar_agendamento, que iria procurá-lo na tabela do bot.
const OBSERVACAO_SISTEMA_INTERNO =
  "Os agendamentos em agendamentos_do_sistema_interno são reais e valem — confirme-os ao paciente normalmente. Mas eles NÃO podem ser cancelados nem remarcados por você: pra isso, encaminhe pra equipe.";

// A agenda do sistema interno ainda é importada manualmente e fica
// incompleta entre uma importação e outra — lista vazia NÃO significa que o
// paciente não tem consulta. Sem essa instrução, o modelo repassava "não
// encontrei nenhum agendamento" pro paciente que tinha sessão marcada.
export const MENSAGEM_NADA_ENCONTRADO =
  "Nenhuma consulta encontrada nos registros, mas eles podem estar incompletos — isso NÃO significa que o paciente não tem consulta. Não diga ao paciente que não encontrou a consulta nem que ele não tem agendamento: acredite no que ele diz, não peça data/horário e use encaminhar_humano com o que ele informou.";

/**
 * Handler da function listar_agendamentos. Lista os agendamentos CONFIRMADOS
 * e futuros do paciente, das DUAS origens: os criados pelo bot (que têm id e
 * podem ser cancelados/remarcados por ele) e os do sistema interno da clínica.
 * Incluir os importados aqui é essencial — hoje quase toda a agenda vem de
 * lá, e olhar só a tabela do bot fazia a function responder "não encontrei
 * nenhum agendamento" pra paciente que tinha consulta marcada (caso real:
 * paciente ouviu isso 40 minutos antes da própria sessão).
 */
export async function listarAgendamentos(
  _args,
  { pacienteId, telefone },
  {
    buscarDoBot = buscarAgendamentosConfirmadosFuturos,
    buscarImportados = buscarAgendamentosImportadosFuturosCompletos,
  } = {}
) {
  const doBot = await buscarDoBot(pacienteId);
  const importados = telefone ? await buscarImportados(telefone) : [];

  if (!doBot.length && !importados.length) {
    return {
      agendamentos: [],
      mensagem: MENSAGEM_NADA_ENCONTRADO,
    };
  }

  const resposta = {
    agendamentos: doBot.map((a) => ({
      agendamento_id: a.id,
      data: a.data,
      hora: a.hora,
      tipo_atendimento: a.tipo_atendimento,
    })),
  };

  if (importados.length) {
    resposta.agendamentos_do_sistema_interno = importados.map((a) => ({
      data: a.data,
      hora: a.hora,
      tipo_atendimento: a.tipo_atendimento,
      ...(a.atendente ? { atendente: a.atendente } : {}),
    }));
    resposta.observacao = OBSERVACAO_SISTEMA_INTERNO;
  }

  return resposta;
}
