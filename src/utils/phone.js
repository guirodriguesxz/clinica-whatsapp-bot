/**
 * Normaliza um número de telefone/JID recebido da Evolution API para
 * o formato "somente dígitos com DDI" usado como chave nas tabelas
 * pacientes/conversas (ex: "5511988887777").
 */
export function normalizarTelefone(numeroOuJid) {
  return String(numeroOuJid).replace("@s.whatsapp.net", "").replace(/\D/g, "");
}

/**
 * Formata um telefone já normalizado (ex: "5511988887777") pro formato
 * legível "(11) 98888-7777" — usado nas notificações que a recepção recebe
 * por WhatsApp, pra facilitar ligar/mandar mensagem sem abrir o WhatsApp.
 */
export function formatarTelefoneExibicao(telefone) {
  const digitos = normalizarTelefone(telefone);
  const semDDI = digitos.startsWith("55") ? digitos.slice(2) : digitos;
  const ddd = semDDI.slice(0, 2);
  const resto = semDDI.slice(2);
  if (resto.length === 9) return `(${ddd}) ${resto.slice(0, 5)}-${resto.slice(5)}`;
  if (resto.length === 8) return `(${ddd}) ${resto.slice(0, 4)}-${resto.slice(4)}`;
  return digitos;
}

/**
 * Normaliza um telefone digitado à mão (recepção cadastrando paciente novo
 * pelo dashboard) pro mesmo formato (dígitos + DDI) que pacientes.telefone
 * já usa. Mesma regra de comprimento de buscarPacientePorTelefoneNormalizado
 * (pacienteModel.js): 10/11 dígitos sem DDI ganham "55" na frente; 12/13 já
 * com "55" ficam como estão; qualquer outro comprimento é inválido.
 */
export function normalizarTelefoneComDDI(bruto) {
  const digitos = String(bruto ?? "").replace(/\D/g, "");
  if (digitos.length === 10 || digitos.length === 11) return `55${digitos}`;
  if ((digitos.length === 12 || digitos.length === 13) && digitos.startsWith("55")) return digitos;
  return null;
}
