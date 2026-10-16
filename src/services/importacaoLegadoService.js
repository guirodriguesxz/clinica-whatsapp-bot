import { readdir, readFile as lerArquivo } from "node:fs/promises";
import { join as juntarCaminho } from "node:path";
import { normalizarTelefone } from "../utils/phone.js";
import { pool } from "../db/pool.js";
import { CONVENIOS_FISIOTERAPIA } from "../config/clinica.js";

const REGEX_HORA_VALIDA = /^([01][0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;

function decodificarEntidades(texto) {
  return texto
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function extrairTag(bloco, tag) {
  const match = bloco.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`));
  return match ? decodificarEntidades(match[1]).trim() : "";
}

function converterNascimento(dataBr) {
  const match = dataBr.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const [, dia, mes, ano] = match;
  return `${ano}-${mes}-${dia}`;
}

// O campo `Tipo` do sistema de agenda anterior codifica o tipo da consulta no prefixo
// antes da barra (ex: "AVAL/OK", "RETORNO/OK") — a parte depois da barra
// indica presença, tratada por `derivarPresenca` abaixo (registros_atendimento).
// Confirmado com a clínica em 2026-09-10.
export function derivarPrimeiraConsulta(tipo) {
  if (!tipo) return null;
  const prefixo = tipo.split("/")[0].trim().toUpperCase();
  if (prefixo === "AVAL") return true;
  if (prefixo === "RETORNO") return false;
  return null;
}

// Sufixo depois da barra (ou o texto inteiro, quando não tem prefixo de tipo
// de consulta — ex: um "OK" sozinho) indica presença. Só reconhece "OK"
// (compareceu) — não existe marcador de falta no export do sistema de agenda anterior,
// então nunca inferimos "faltou" automaticamente daqui (decisão em
// 2026-09-11: só automatiza o que o dado realmente confirma).
export function derivarPresenca(tipo) {
  if (!tipo) return null;
  const partes = tipo.split("/");
  const sufixo = partes[partes.length - 1].trim().toUpperCase();
  return sufixo === "OK" ? "compareceu" : null;
}

// O export do sistema de agenda anterior traz telefone digitado localmente, sem DDI
// (convenção normal: ninguém escreve o próprio código de país no cadastro
// da própria clínica) — `normalizarTelefone` só remove não-dígitos, não
// completa DDI. Sem completar, um paciente que já é usuário real do bot
// (telefone salvo com DDI, ex: "5511999991111") nunca bateria com o mesmo
// telefone vindo do sistema de agenda anterior ("11999991111"), e viraria um paciente
// duplicado. Só completa quando o resultado tem exatamente 10 ou 11
// dígitos (DDD + número, faltando só o "55") — um número mais curto (ex:
// "22676690", 8 dígitos, fixo sem DDD — caso real encontrado no export)
// não tem como ser completado com segurança, então fica como está em vez
// de arriscar um DDD errado.
export function completarDDI(telefoneNormalizado) {
  if (!telefoneNormalizado) return null;
  if (telefoneNormalizado.length === 10 || telefoneNormalizado.length === 11) {
    return `55${telefoneNormalizado}`;
  }
  return telefoneNormalizado;
}

/**
 * Faz o parse de um arquivo de agenda do sistema de agenda anterior (formato
 * NewDataSet/Table1). `dataArquivo` (YYYY-MM-DD) vem do nome do arquivo
 * (ex: Agenda_Manha_26-08-2026.xml → "2026-08-26") — o XML em si não traz a
 * data da linha, só a hora.
 */
export function parsearArquivoAgenda(conteudoXml, dataArquivo) {
  const blocos = conteudoXml.match(/<Table1>[\s\S]*?<\/Table1>/g) ?? [];
  const linhas = [];

  for (const bloco of blocos) {
    const hora = extrairTag(bloco, "Hora");
    if (hora === "Hora") continue; // linha de cabeçalho (valor = nome da própria tag)

    const nome = extrairTag(bloco, "Paciente");
    const telefoneCru = extrairTag(bloco, "Telefone");
    if (!nome && !telefoneCru) continue; // slot vazio da grade, ninguém marcado

    linhas.push({
      data: dataArquivo,
      hora,
      nome,
      telefoneNormalizado: telefoneCru ? completarDDI(normalizarTelefone(telefoneCru)) : null,
      cpf: extrairTag(bloco, "CPF") || null,
      nascimento: converterNascimento(extrairTag(bloco, "Nascimento")),
      categoria: extrairTag(bloco, "Categoria") || null,
      atendente: extrairTag(bloco, "Atendente") || null,
      tipo: extrairTag(bloco, "Tipo") || null,
      primeiraConsulta: derivarPrimeiraConsulta(extrairTag(bloco, "Tipo")),
      obs: extrairTag(bloco, "Obs") || null,
      flagF: extrairTag(bloco, "F") || null,
      flagC: extrairTag(bloco, "C") || null,
      flagE: extrairTag(bloco, "E") || null,
      chegou: extrairTag(bloco, "Chegou") || null,
    });
  }

  return linhas;
}

// Compara nomes/textos ignorando acento e caixa — usado tanto pra detectar
// se um telefone já cadastrado pertence a OUTRO paciente (família dividindo
// número) quanto, na Task 7, pra checar convênio. `̀-ͯ` é a faixa
// Unicode das marcas diacríticas combinantes deixadas por normalize("NFD").
export function normalizarTexto(texto) {
  return texto
    .normalize("NFD")
    .replace(new RegExp("[\\u0300-\\u036f]", "g"), "")
    .toLowerCase()
    .trim();
}

// Compara só a primeira palavra normalizada, dos dois lados: o export traz
// o convênio truncado/abreviado (ex: "Norte", "Santa Luz"), e a
// lista oficial tem o nome completo (ex: "Norte Intermed", "São
// Cristóvão Saúde") — comparar a string inteira quase nunca bateria.
// Reduzir os dois lados à primeira palavra é uma checagem de "pertence a
// algum credenciado", não de "identifica qual" — por isso colisão de
// primeira palavra entre dois convênios diferentes não é um problema:
// existe pelo menos uma de verdade ("Santa Luz Saúde" e "Bom Porto Saúde"
// colidem em "sao", por exemplo), e não precisamos saber qual, só que
// alguma bate. Só viraria problema se um convênio SEM ser credenciado
// coincidisse na primeira palavra com um credenciado — não observado até
// agora, mas o motivo de aceitar esse risco é a assimetria de custo: um
// aviso a menos é só menos visibilidade, nunca corrompe dado gravado.
const CONVENIOS_FISIOTERAPIA_PRIMEIRA_PALAVRA = new Set(
  CONVENIOS_FISIOTERAPIA.map((convenio) => normalizarTexto(convenio).split(" ")[0])
);

/**
 * Liga o paciente importado a um convênio já cadastrado em Convênios
 * (convenio_id), só quando o texto do export bate, sem ambiguidade, com o
 * nome de um convênio ativo — comparação por igualdade exata após
 * normalizarTexto (acento/caixa/espaço nas pontas), nunca por primeira
 * palavra ou substring: a checagem de "aviso" acima é só um alerta pra
 * revisão humana, então pode ser mais permissiva; gravar convenio_id é
 * definitivo e usado pra calcular repasse (ver pagamentoModel.js), então só
 * entra com confiança alta. "Particular" nunca vira convenio_id — mesmo
 * havendo uma linha "Particular" cadastrada em Convênios, paciente
 * particular usa convenio_id = null (ver dashboardController.js, mesmo
 * padrão do cadastro manual/pelo bot).
 */
async function buscarConvenioIdPorCategoria(categoria) {
  if (!categoria) return null;
  const normalizado = normalizarTexto(categoria);
  if (normalizado === "particular") return null;
  const { rows } = await pool.query(`SELECT id, nome FROM convenios WHERE ativo = true`);
  const encontrado = rows.find((c) => normalizarTexto(c.nome) === normalizado);
  return encontrado?.id ?? null;
}

export async function processarLinha(linha, { aplicar, usuarioPresencaId }) {
  const eventos = [];

  if (!REGEX_HORA_VALIDA.test(linha.hora)) {
    eventos.push({ tipo: "divergencia", motivo: `hora inválida ("${linha.hora}"), linha ignorada` });
    return { eventos };
  }

  if (linha.categoria && normalizarTexto(linha.categoria) !== "particular") {
    const primeiraPalavra = normalizarTexto(linha.categoria).split(" ")[0];
    if (!CONVENIOS_FISIOTERAPIA_PRIMEIRA_PALAVRA.has(primeiraPalavra)) {
      eventos.push({
        tipo: "aviso",
        motivo: `convênio "${linha.categoria}" não bate com nenhum convênio credenciado conhecido — revisar manualmente`,
      });
    }
  }

  if (!linha.telefoneNormalizado) {
    eventos.push({ tipo: "divergencia", motivo: "sem telefone, não é possível associar a um paciente" });
    return { eventos };
  }

  const { rows: pacientesExistentes } = await pool.query(
    `SELECT id, nome, cpf, data_nascimento, convenio_id FROM pacientes WHERE telefone = $1`,
    [linha.telefoneNormalizado]
  );
  const pacienteExistente = pacientesExistentes[0] ?? null;

  if (!pacienteExistente) {
    eventos.push({ tipo: "paciente_novo" });
    const convenioIdEncontrado = await buscarConvenioIdPorCategoria(linha.categoria);
    if (aplicar) {
      await pool.query(
        `INSERT INTO pacientes (nome, telefone, convenio, convenio_id, cpf, data_nascimento)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (telefone) DO NOTHING`,
        [linha.nome, linha.telefoneNormalizado, linha.categoria, convenioIdEncontrado, linha.cpf, linha.nascimento]
      );
    }
  } else if (normalizarTexto(pacienteExistente.nome) !== normalizarTexto(linha.nome)) {
    // Mesmo telefone, nome diferente do já cadastrado — provável família
    // dividindo o número (achado real, ver spec "Idempotência"). Nunca
    // grava CPF/nascimento aqui: escrever o documento de uma pessoa no
    // cadastro de outra é pior do que só deixar de preencher o campo.
    eventos.push({
      tipo: "aviso",
      motivo: `telefone já cadastrado para outro paciente ("${pacienteExistente.nome}") — CPF/nascimento de "${linha.nome}" não foram gravados, revisar manualmente`,
    });
  } else {
    // convenio_id nunca era preenchido aqui pra paciente já existente (achado
    // em 2026-09-17: agendamento importado nunca "subia" o convênio de quem
    // já tinha cadastro) — igual ao paciente novo, só entra quando o texto
    // do export bate, sem ambiguidade, com um convênio ativo já cadastrado
    // (buscarConvenioIdPorCategoria); nunca sobrescreve um convenio_id já
    // gravado.
    const convenioIdEncontrado = pacienteExistente.convenio_id
      ? null
      : await buscarConvenioIdPorCategoria(linha.categoria);
    if (!pacienteExistente.cpf || !pacienteExistente.data_nascimento || convenioIdEncontrado) {
      eventos.push({ tipo: "paciente_atualizado" });
      if (aplicar) {
        await pool.query(
          `UPDATE pacientes
           SET cpf = COALESCE(cpf, $1), data_nascimento = COALESCE(data_nascimento, $2),
               convenio_id = COALESCE(convenio_id, $3)
           WHERE id = $4`,
          [linha.cpf, linha.nascimento, convenioIdEncontrado, pacienteExistente.id]
        );
      }
    }
  }

  // `nome` entra na comparação porque o mesmo telefone pode ter mais de um
  // paciente (ex: família dividindo número) — telefone+data+hora sozinho
  // colidiria entre duas pessoas reais agendadas no mesmo horário.
  const { rows: agendamentosExistentes } = await pool.query(
    `SELECT id FROM agendamentos_importados WHERE telefone = $1 AND data = $2 AND hora = $3 AND nome = $4`,
    [linha.telefoneNormalizado, linha.data, linha.hora, linha.nome]
  );

  let agendamentoImportadoId = null;

  if (agendamentosExistentes.length > 0) {
    eventos.push({ tipo: "agendamento_ja_existe" });
    agendamentoImportadoId = agendamentosExistentes[0].id;
  } else {
    eventos.push({ tipo: "agendamento_novo" });
    if (aplicar) {
      const { rows } = await pool.query(
        `INSERT INTO agendamentos_importados
           (telefone, nome, data, hora, tipo_atendimento, convenio, atendente, tipo, obs, flag_f, flag_c, flag_e, chegou, primeira_consulta)
         VALUES ($1, $2, $3, $4, 'fisioterapia', $5, $6, $7, $8, $9, $10, $11, $12, $13)
         ON CONFLICT (regexp_replace(telefone, '\\D', '', 'g'), data, hora, nome) DO NOTHING
         RETURNING id`,
        [
          linha.telefoneNormalizado,
          linha.nome,
          linha.data,
          linha.hora,
          linha.categoria,
          linha.atendente,
          linha.tipo,
          linha.obs,
          linha.flagF,
          linha.flagC,
          linha.flagE,
          linha.chegou,
          linha.primeiraConsulta ?? null,
        ]
      );
      agendamentoImportadoId = rows[0]?.id ?? null;
    }
  }

  // Mesma escrita que `registrarPresencaImportado` (registroAtendimentoModel.js)
  // faz quando a recepção marca presença manual pelo dashboard — repetida
  // aqui (via pool.query direto, sem transação) em vez de chamar o model,
  // pra manter o mesmo estilo do resto deste arquivo (todo write aqui é um
  // pool.query isolado, nunca uma transação) e pra não puxar pool.connect
  // numa rotina que já é toda mockável em cima de pool.query nos testes.
  const presenca = derivarPresenca(linha.tipo);
  if (presenca) {
    eventos.push({ tipo: "presenca_detectada" });
    if (aplicar && agendamentoImportadoId) {
      const atualizado = await pool.query(
        `UPDATE agendamentos_importados SET status = $2 WHERE id = $1 AND status <> 'cancelado' RETURNING id`,
        [agendamentoImportadoId, presenca]
      );
      if (atualizado.rows.length === 0) {
        eventos.push({
          tipo: "aviso",
          motivo: `presença "${presenca}" não registrada (agendamento cancelado ou não encontrado)`,
        });
      } else {
        await pool.query(
          `INSERT INTO registros_atendimento (agendamento_importado_id, presenca, registrado_por)
           VALUES ($1, $2, $3)
           ON CONFLICT (agendamento_importado_id) WHERE agendamento_importado_id IS NOT NULL DO UPDATE
             SET presenca = EXCLUDED.presenca, registrado_por = EXCLUDED.registrado_por, registrado_em = now()`,
          [agendamentoImportadoId, presenca, usuarioPresencaId]
        );
        eventos.push({ tipo: "presenca_registrada" });
      }
    }
  }

  return { eventos };
}

const REGEX_ARQUIVO_AGENDA = /^Agenda_(?:Manha|Tarde)_(\d{2})-(\d{2})-(\d{4})\.xml$/;

/**
 * Lê todos os arquivos `Agenda_Manha_DD-MM-AAAA.xml` / `Agenda_Tarde_DD-MM-AAAA.xml`
 * de `diretorio`, faz o parse de cada um (`parsearArquivoAgenda`) e processa
 * cada linha (`processarLinha`), agregando um relatório único. Arquivos que
 * não batem com o padrão de nome são ignorados.
 */
export async function importarDiretorio(diretorio, { aplicar, usuarioPresencaId }) {
  const todosArquivos = await readdir(diretorio);
  const arquivos = todosArquivos.filter((nome) => REGEX_ARQUIVO_AGENDA.test(nome)).sort();

  const relatorio = {
    pacientesNovos: 0,
    pacientesAtualizados: 0,
    agendamentosNovos: 0,
    agendamentosJaExistentes: 0,
    presencasDetectadas: 0,
    presencasRegistradas: 0,
    divergencias: [],
    avisos: [],
  };

  for (const arquivo of arquivos) {
    const [, dia, mes, ano] = arquivo.match(REGEX_ARQUIVO_AGENDA);
    const dataArquivo = `${ano}-${mes}-${dia}`;
    const conteudo = await lerArquivo(juntarCaminho(diretorio, arquivo), "utf8");
    const linhas = parsearArquivoAgenda(conteudo, dataArquivo);

    // A clínica não abre sábado/domingo: arquivo com data de fim de semana
    // quase sempre é erro de digitação no sistema de agenda anterior ou nome de arquivo
    // trocado. Não grava, só reporta pra alguém conferir.
    const diaSemana = new Date(Date.UTC(Number(ano), Number(mes) - 1, Number(dia))).getUTCDay();
    if (diaSemana === 0 || diaSemana === 6) {
      const nomeDia = diaSemana === 0 ? "domingo" : "sábado";
      for (const linha of linhas) {
        relatorio.divergencias.push({
          nome: linha.nome,
          arquivo,
          motivo: `data cai num ${nomeDia} (${dia}/${mes}/${ano}), clínica fechada: linha ignorada`,
        });
      }
      continue;
    }

    for (const linha of linhas) {
      const { eventos } = await processarLinha(linha, { aplicar, usuarioPresencaId });
      for (const evento of eventos) {
        if (evento.tipo === "paciente_novo") relatorio.pacientesNovos++;
        else if (evento.tipo === "paciente_atualizado") relatorio.pacientesAtualizados++;
        else if (evento.tipo === "agendamento_novo") relatorio.agendamentosNovos++;
        else if (evento.tipo === "agendamento_ja_existe") relatorio.agendamentosJaExistentes++;
        else if (evento.tipo === "presenca_detectada") relatorio.presencasDetectadas++;
        else if (evento.tipo === "presenca_registrada") relatorio.presencasRegistradas++;
        else if (evento.tipo === "divergencia") {
          relatorio.divergencias.push({ nome: linha.nome, arquivo, motivo: evento.motivo });
        } else if (evento.tipo === "aviso") {
          relatorio.avisos.push({ nome: linha.nome, arquivo, motivo: evento.motivo });
        }
      }
    }
  }

  return relatorio;
}
