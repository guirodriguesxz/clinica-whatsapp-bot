// src/db/seed-demo.js
// Popula o banco com dados 100% fictícios (pacientes, agendamentos, presenças
// e pagamentos) para demonstrar o painel — usado nos prints de docs/screenshots.
// Pré-requisitos: migrations aplicadas e ao menos um usuário criado
// (node src/db/criar-primeiro-usuario.js).
// Rodar com: node src/db/seed-demo.js
// Só roda contra banco local e vazio, para nunca misturar dados de demonstração
// com dados reais.

import "dotenv/config";
import { pool } from "./pool.js";

const url = process.env.DATABASE_URL ?? "";
if (!/@(localhost|127\.0\.0\.1|\[::1\])(:|\/|$)/.test(url)) {
  console.error("Recusado: DATABASE_URL não aponta para um banco local.");
  process.exit(1);
}

const { rows: existentes } = await pool.query("SELECT count(*)::int AS n FROM pacientes");
if (existentes[0].n > 0) {
  console.error("Recusado: o banco já tem pacientes. Use um banco vazio.");
  process.exit(1);
}

const { rows: usuarios } = await pool.query("SELECT id FROM usuarios ORDER BY id LIMIT 1");
if (usuarios.length === 0) {
  console.error("Crie um usuário antes (node src/db/criar-primeiro-usuario.js).");
  process.exit(1);
}
const usuarioId = usuarios[0].id;

const insert = async (sql, params) => (await pool.query(sql, params)).rows[0];

const convenios = {};
for (const [i, nome] of ["Plano Saúde Alfa", "Plano Vida Beta", "Convênio Gama"].entries()) {
  convenios[nome] = (
    await insert(
      "INSERT INTO convenios (nome, valor_repasse_avaliacao, valor_repasse_sessao) VALUES ($1, $2, $3) RETURNING id",
      [nome, 60 + i * 5, 45 + i * 5]
    )
  ).id;
}

const fisioterapeutas = [];
for (const [nome, crefito] of [
  ["Dra. Helena Souza", "CREFITO-3/000001"],
  ["Dr. Rafael Lima", "CREFITO-3/000002"],
]) {
  fisioterapeutas.push(
    (
      await insert("INSERT INTO fisioterapeutas (nome, crefito) VALUES ($1, $2) RETURNING id", [
        nome,
        crefito,
      ])
    ).id
  );
}

const psicologos = [];
for (const nome of ["Marina Duarte", "Paulo Andrade"]) {
  psicologos.push(
    (await insert("INSERT INTO psicologos (nome) VALUES ($1) RETURNING id", [nome])).id
  );
}

const nomes = [
  "Ana Beatriz Moreira",
  "Carlos Eduardo Pinto",
  "Fernanda Alves",
  "João Pedro Ramos",
  "Luciana Barros",
  "Marcos Vinícius Teixeira",
  "Patrícia Gomes",
  "Ricardo Nogueira",
  "Sandra Cardoso",
  "Thiago Azevedo",
  "Vanessa Monteiro",
  "Bruno Carvalho",
  "Camila Ferraz",
  "Eduardo Salles",
];
const planos = [null, "Plano Saúde Alfa", "Plano Vida Beta", "Convênio Gama"];
const pacientes = [];
for (const [i, nome] of nomes.entries()) {
  const plano = planos[i % planos.length];
  pacientes.push(
    (
      await insert(
        `INSERT INTO pacientes (nome, telefone, convenio, convenio_id, cpf, data_nascimento, sexo, email, cidade, uf)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'São Paulo', 'SP') RETURNING id`,
        [
          nome,
          `55119555501${String(i).padStart(2, "0")}`,
          plano,
          plano ? convenios[plano] : null,
          `000.000.${String(i).padStart(3, "0")}-00`,
          `${1960 + i * 3}-0${(i % 9) + 1}-1${i % 9}`,
          i % 2 ? "M" : "F",
          `paciente${i + 1}@exemplo.com`,
        ]
      )
    ).id
  );
}

const horas = ["08:00", "09:00", "10:00", "11:00", "14:00", "15:00", "16:00", "17:00"];
const queixas = ["Dor lombar", "Reabilitação de joelho", "Cervicalgia", "Pós-operatório de ombro"];
const statusHoje = [
  "compareceu",
  "compareceu",
  "confirmado",
  "confirmado",
  "confirmado",
  "faltou",
  "confirmado",
];
const statusPassado = ["compareceu", "compareceu", "compareceu", "faltou", "cancelado"];

const compareceram = [];
let k = 0;
for (let d = -10; d <= 6; d++) {
  const diaDaSemana = new Date(Date.now() + d * 864e5).getDay();
  if (diaDaSemana === 0 || diaDaSemana === 6) continue;
  const quantidade = d === 0 ? statusHoje.length : 3;
  for (let j = 0; j < quantidade; j++, k++) {
    const tipo = k % 3 === 2 ? "psicologia" : "fisioterapia";
    const status =
      d < 0 ? statusPassado[k % statusPassado.length] : d === 0 ? statusHoje[j] : "confirmado";
    const ag = await insert(
      `INSERT INTO agendamentos (paciente_id, data, hora, tipo_atendimento, status, primeira_consulta,
                                queixa_principal, psicologo_id, fisioterapeuta_id, criado_por_usuario_id)
       VALUES ($1, current_date + $2::int, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, paciente_id`,
      [
        pacientes[k % pacientes.length],
        d,
        horas[(j * 2 + k) % horas.length],
        tipo,
        status,
        k % 7 === 0,
        tipo === "fisioterapia" ? queixas[k % queixas.length] : "Acompanhamento",
        tipo === "psicologia" ? psicologos[k % psicologos.length] : null,
        tipo === "fisioterapia" ? fisioterapeutas[k % fisioterapeutas.length] : null,
        usuarioId,
      ]
    );
    if (status === "compareceu" || status === "faltou") {
      await pool.query(
        "INSERT INTO registros_atendimento (agendamento_id, presenca, registrado_por) VALUES ($1, $2, $3)",
        [ag.id, status, usuarioId]
      );
    }
    if (status === "compareceu") compareceram.push(ag);
  }
}

const formas = ["pix", "cartao", "convenio"];
const valores = [120, 150, 180, 200];
for (const [i, ag] of compareceram.entries()) {
  const forma = formas[i % formas.length];
  await pool.query(
    `INSERT INTO pagamentos (agendamento_id, paciente_id, valor, forma_pagamento, parcelas, status, data,
                             registrado_por, tipo_lancamento)
     VALUES ($1, $2, $3, $4, $5, $6, current_date, $7, 'pagamento')`,
    [
      ag.id,
      ag.paciente_id,
      valores[i % valores.length],
      forma,
      forma === "cartao" ? 1 : null,
      i % 5 === 4 ? "pendente" : "pago",
      usuarioId,
    ]
  );
}

console.log(
  `Seed concluído: ${pacientes.length} pacientes, ${k} agendamentos, ${compareceram.length} pagamentos.`
);
await pool.end();
