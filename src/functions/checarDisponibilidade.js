import { listarHorariosDisponiveis } from "../services/calendarService.js";
import { validarData, validarHora, validarTipoAtendimento } from "../utils/validacao.js";

// A assinatura segue as outras functions (args, context, deps): o aiService
// despacha sempre com `context` no segundo argumento, mesmo quando a function
// não usa nada dele.
export async function checarDisponibilidade(
  { data, hora, tipo_atendimento },
  _context,
  { listarHorarios = listarHorariosDisponiveis } = {}
) {
  if (!validarTipoAtendimento(tipo_atendimento)) {
    return {
      disponivel: false,
      erro: `tipo_atendimento inválido: "${tipo_atendimento}". Use "fisioterapia" ou "psicologia".`,
    };
  }
  if (data && !validarData(data)) {
    return {
      disponivel: false,
      erro: `Formato de data inválido: "${data}". Use o formato YYYY-MM-DD.`,
    };
  }

  // Pergunta sobre um horário ESPECÍFICO: responde sobre ele de verdade, em
  // vez de deixar o modelo deduzir da lista devolvida abaixo — que é uma
  // amostra (ver amostrarMetadeDeCadaPeriodo em calendarService.js) e, por
  // pegar um slot sim outro não, costuma omitir os :30. Sem isso, o bot
  // dizia que o horário pedido estava indisponível só por ele não aparecer
  // na amostra (caso real: paciente pediu 13h30, que estava livre, e o bot
  // afirmou que não tinha vaga e ofereceu 14h).
  if (hora) {
    if (!validarHora(hora)) {
      return { disponivel: false, erro: `Formato de hora inválido: "${hora}". Use o formato HH:mm.` };
    }
    if (!data) {
      return { disponivel: false, erro: "Informe também a data (YYYY-MM-DD) para checar um horário específico." };
    }
    const todosDoDia = await listarHorarios({
      data,
      tipoAtendimento: tipo_atendimento,
      amostrar: false,
    });
    const livre = todosDoDia.some((h) => h.hora === hora);
    if (livre) return { disponivel: true, horario_solicitado: hora, horarios: [{ data, hora }] };
    return {
      disponivel: false,
      horario_solicitado: hora,
      mensagem: `O horário ${hora} não está livre em ${data}.`,
      horarios: todosDoDia,
    };
  }

  const horarios = await listarHorarios({ data, tipoAtendimento: tipo_atendimento });

  if (!horarios.length) {
    return {
      disponivel: false,
      mensagem: "Nenhum horário disponível encontrado para os critérios informados.",
    };
  }

  return { disponivel: true, horarios };
}
