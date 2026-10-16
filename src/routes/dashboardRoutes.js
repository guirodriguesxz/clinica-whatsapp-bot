import { Router } from "express";
import { asyncHandler } from "../utils/asyncHandler.js";
import { dashboardLoginLimiter } from "../middleware/rateLimit.js";
import { exigirLogin, exigirCsrf, exigirPapel } from "../middleware/dashboardAuth.js";
import {
  processarDesativacaoUsuario,
  processarNovoUsuario,
  processarRedefinicaoSenha,
  processarTrocaPropriaSenha,
  telaNovoUsuario,
  telaTrocarSenha,
  telaUsuarios,
} from "../controllers/usuarioController.js";
import {
  telaPsicologos,
  telaNovoPsicologo,
  processarNovoPsicologo,
  telaEditarPsicologo,
  processarEditarPsicologo,
  processarDesativarPsicologo,
  processarReativarPsicologo,
  servirFotoPsicologo,
  gerarPdfTermoCienciaPsicologiaController,
} from "../controllers/psicologoController.js";
import { telaPrestador, processarPrestador } from "../controllers/prestadorController.js";
import { telaTiss, gerarLoteTiss } from "../controllers/tissController.js";
import {
  telaConvenios,
  telaNovoConvenio,
  processarNovoConvenio,
  telaEditarConvenio,
  processarEditarConvenio,
  processarDesativarConvenio,
  processarReativarConvenio,
} from "../controllers/convenioController.js";
import {
  telaBaseConhecimento,
  telaNovaEntradaBaseConhecimento,
  processarNovaEntradaBaseConhecimento,
  telaEditarEntradaBaseConhecimento,
  processarEditarEntradaBaseConhecimento,
  processarDesativarEntradaBaseConhecimento,
  processarReativarEntradaBaseConhecimento,
} from "../controllers/baseConhecimentoController.js";
import {
  telaSugestoesConhecimento,
  processarDescartarSugestaoConhecimento,
} from "../controllers/sugestaoConhecimentoController.js";
import {
  telaLogin,
  telaHoje,
  processarLogin,
  processarLogout,
  telaAgendamentos,
  telaProximosAgendamentos,
  processarCancelarAgendamento,
  processarExcluirAgendamento,
  processarEnviarConfirmacao,
  telaRemarcarAgendamento,
  processarRemarcarAgendamento,
  telaNovoAgendamento,
  processarNovoAgendamento,
  telaEditarAgendamento,
  processarEditarAgendamento,
  buscarPacientesJson,
  buscarHistoricoResumoPacienteJson,
  telaControleSessoes,
  processarEnviarControleSessoes,
  telaFichaPaciente,
  telaNovoPaciente,
  processarNovoPaciente,
  telaEditarPaciente,
  processarEditarPaciente,
  telaPacientes,
  processarPresencaAgendamento,
  processarPresencaImportado,
  processarPresencaLote,
  gerarLaudoBot,
  gerarLaudoImportado,
  gerarGuiaConvenio,
  telaFinanceiro,
  telaRelatorioFinanceiro,
  telaEstatisticas,
  processarPagamentoAgendamento,
  processarPagamentoImportado,
  processarEstorno,
  processarCriarPacote,
  processarCancelarPacote,
  processarExcluirPaciente,
} from "../controllers/dashboardController.js";
import {
  telaNovaAvaliacao,
  processarNovaAvaliacao,
  telaEditarAvaliacao,
  processarEditarAvaliacao,
  gerarPdfAvaliacaoController,
} from "../controllers/avaliacaoFisioterapeuticaController.js";
import {
  telaNovoRelatorio,
  processarNovoRelatorio,
  telaEditarRelatorio,
  processarEditarRelatorio,
  gerarPdfRelatorioController,
  gerarDocxRelatorioController,
  processarRascunhoRelatorioPdf,
  processarRascunhoRelatorioDocx,
  processarExcluirRelatorio,
} from "../controllers/relatorioFisioterapeuticoController.js";
import {
  telaFisioterapeutas,
  telaNovoFisioterapeuta,
  processarNovoFisioterapeuta,
  telaEditarFisioterapeuta,
  processarEditarFisioterapeuta,
  processarDesativarFisioterapeuta,
  processarReativarFisioterapeuta,
  servirAssinaturaFisioterapeuta,
} from "../controllers/fisioterapeutaController.js";
import { uploadAssinatura, uploadFotoPsicologo } from "../middleware/upload.js";

const router = Router();

router.get("/", (req, res) => {
  res.redirect(req.session?.usuarioId ? "/hoje" : "/login");
});

router.get("/hoje", asyncHandler(exigirLogin), asyncHandler(telaHoje));

router.get("/login", telaLogin);
router.post("/login", dashboardLoginLimiter, asyncHandler(processarLogin));
router.post("/logout", asyncHandler(exigirLogin), exigirCsrf, processarLogout);

router.get("/usuarios", asyncHandler(exigirLogin), exigirPapel("administradora"), asyncHandler(telaUsuarios));
router.get("/usuarios/novo", asyncHandler(exigirLogin), exigirPapel("administradora"), telaNovoUsuario);
router.post(
  "/usuarios",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarNovoUsuario)
);
router.post(
  "/usuarios/:id/redefinir-senha",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarRedefinicaoSenha)
);
router.post(
  "/usuarios/:id/desativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarDesativacaoUsuario)
);
router.get(
  "/configuracoes/prestador",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaPrestador)
);
router.post(
  "/configuracoes/prestador",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarPrestador)
);

router.get("/minha-senha", asyncHandler(exigirLogin), telaTrocarSenha);
router.post("/minha-senha", asyncHandler(exigirLogin), exigirCsrf, asyncHandler(processarTrocaPropriaSenha));

router.get("/psicologos", asyncHandler(exigirLogin), asyncHandler(telaPsicologos));
router.get("/psicologos/novo", asyncHandler(exigirLogin), telaNovoPsicologo);
router.post(
  "/psicologos/novo",
  asyncHandler(exigirLogin),
  uploadFotoPsicologo,
  exigirCsrf,
  asyncHandler(processarNovoPsicologo)
);
router.get(
  "/psicologos/:id/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarPsicologo)
);
router.post(
  "/psicologos/:id/editar",
  asyncHandler(exigirLogin),
  uploadFotoPsicologo,
  exigirCsrf,
  asyncHandler(processarEditarPsicologo)
);
router.post(
  "/psicologos/:id/desativar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarDesativarPsicologo)
);
router.post(
  "/psicologos/:id/reativar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarReativarPsicologo)
);
router.get(
  "/psicologos/:id/foto",
  asyncHandler(exigirLogin),
  asyncHandler(servirFotoPsicologo)
);
router.get(
  "/psicologos/termo-ciencia",
  asyncHandler(exigirLogin),
  asyncHandler(gerarPdfTermoCienciaPsicologiaController)
);

router.get("/fisioterapeutas", asyncHandler(exigirLogin), asyncHandler(telaFisioterapeutas));
router.get(
  "/fisioterapeutas/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  telaNovoFisioterapeuta
);
router.post(
  "/fisioterapeutas/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  uploadAssinatura,
  exigirCsrf,
  asyncHandler(processarNovoFisioterapeuta)
);
router.get(
  "/fisioterapeutas/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaEditarFisioterapeuta)
);
router.post(
  "/fisioterapeutas/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  uploadAssinatura,
  exigirCsrf,
  asyncHandler(processarEditarFisioterapeuta)
);
router.post(
  "/fisioterapeutas/:id/desativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarDesativarFisioterapeuta)
);
router.post(
  "/fisioterapeutas/:id/reativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarReativarFisioterapeuta)
);
router.get(
  "/fisioterapeutas/:id/assinatura",
  asyncHandler(exigirLogin),
  asyncHandler(servirAssinaturaFisioterapeuta)
);

router.get("/convenios", asyncHandler(exigirLogin), asyncHandler(telaConvenios));
router.get("/convenios/novo", asyncHandler(exigirLogin), telaNovoConvenio);
router.post(
  "/convenios/novo",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovoConvenio)
);
router.get(
  "/convenios/:id/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarConvenio)
);
router.post(
  "/convenios/:id/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarConvenio)
);
router.post(
  "/convenios/:id/desativar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarDesativarConvenio)
);
router.post(
  "/convenios/:id/reativar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarReativarConvenio)
);

router.get(
  "/base-conhecimento",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaBaseConhecimento)
);
router.get(
  "/base-conhecimento/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  telaNovaEntradaBaseConhecimento
);
router.post(
  "/base-conhecimento/novo",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarNovaEntradaBaseConhecimento)
);
router.get(
  "/base-conhecimento/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaEditarEntradaBaseConhecimento)
);
router.post(
  "/base-conhecimento/:id/editar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarEditarEntradaBaseConhecimento)
);
router.post(
  "/base-conhecimento/:id/desativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarDesativarEntradaBaseConhecimento)
);
router.post(
  "/base-conhecimento/:id/reativar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarReativarEntradaBaseConhecimento)
);

router.get(
  "/sugestoes-conhecimento",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  asyncHandler(telaSugestoesConhecimento)
);
router.post(
  "/sugestoes-conhecimento/:id/descartar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarDescartarSugestaoConhecimento)
);

router.get(
  "/agendamentos",
  asyncHandler(exigirLogin),
  asyncHandler((req, res) => telaAgendamentos(req, res, { tipoAtendimentoFixo: "fisioterapia" }))
);
router.get(
  "/agendamentos/proximos",
  asyncHandler(exigirLogin),
  asyncHandler((req, res) => telaProximosAgendamentos(req, res, { tipoAtendimentoFixo: "fisioterapia" }))
);
router.get(
  "/psicologia",
  asyncHandler(exigirLogin),
  asyncHandler((req, res) => telaAgendamentos(req, res, { tipoAtendimentoFixo: "psicologia" }))
);
router.get(
  "/psicologia/proximos",
  asyncHandler(exigirLogin),
  asyncHandler((req, res) => telaProximosAgendamentos(req, res, { tipoAtendimentoFixo: "psicologia" }))
);
router.post(
  "/agendamentos/:origem/:id/cancelar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarCancelarAgendamento)
);
router.post(
  "/agendamentos/:origem/:id/excluir",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarExcluirAgendamento)
);
router.post(
  "/agendamentos/:origem/:id/confirmar-whatsapp",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEnviarConfirmacao)
);
router.get(
  "/agendamentos/:origem/:id/remarcar",
  asyncHandler(exigirLogin),
  asyncHandler(telaRemarcarAgendamento)
);
router.post(
  "/agendamentos/:origem/:id/remarcar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarRemarcarAgendamento)
);
router.get("/agendamentos/novo", asyncHandler(exigirLogin), asyncHandler(telaNovoAgendamento));
router.post(
  "/agendamentos/novo",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovoAgendamento)
);
router.get(
  "/agendamentos/:origem/:id/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarAgendamento)
);
router.post(
  "/agendamentos/:origem/:id/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarAgendamento)
);
router.get("/api/pacientes/busca", asyncHandler(exigirLogin), asyncHandler(buscarPacientesJson));
router.get(
  "/api/pacientes/:id/historico-resumo",
  asyncHandler(exigirLogin),
  asyncHandler(buscarHistoricoResumoPacienteJson)
);
router.get("/pacientes", asyncHandler(exigirLogin), asyncHandler(telaPacientes));
router.get("/pacientes/novo", asyncHandler(exigirLogin), asyncHandler(telaNovoPaciente));
router.post(
  "/pacientes/novo",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovoPaciente)
);
router.get("/pacientes/:id/ficha", asyncHandler(exigirLogin), asyncHandler(telaFichaPaciente));
router.get("/pacientes/:id/editar", asyncHandler(exigirLogin), asyncHandler(telaEditarPaciente));
router.post(
  "/pacientes/:id/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarPaciente)
);
router.get(
  "/pacientes/:id/controle-sessoes",
  asyncHandler(exigirLogin),
  asyncHandler(telaControleSessoes)
);
router.post(
  "/pacientes/:id/controle-sessoes/enviar-whatsapp",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEnviarControleSessoes)
);

router.get(
  "/pacientes/:id/avaliacoes/nova",
  asyncHandler(exigirLogin),
  asyncHandler(telaNovaAvaliacao)
);
router.post(
  "/pacientes/:id/avaliacoes/nova",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovaAvaliacao)
);
router.get(
  "/pacientes/:id/avaliacoes/:avaliacaoId/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarAvaliacao)
);
router.post(
  "/pacientes/:id/avaliacoes/:avaliacaoId/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarAvaliacao)
);
router.get(
  "/pacientes/:id/avaliacoes/:avaliacaoId/pdf",
  asyncHandler(exigirLogin),
  asyncHandler(gerarPdfAvaliacaoController)
);

router.get(
  "/pacientes/:id/relatorios/novo",
  asyncHandler(exigirLogin),
  asyncHandler(telaNovoRelatorio)
);
router.post(
  "/pacientes/:id/relatorios/novo",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarNovoRelatorio)
);
router.get(
  "/pacientes/:id/relatorios/:relatorioId/editar",
  asyncHandler(exigirLogin),
  asyncHandler(telaEditarRelatorio)
);
router.post(
  "/pacientes/:id/relatorios/:relatorioId/editar",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarEditarRelatorio)
);
router.get(
  "/pacientes/:id/relatorios/:relatorioId/pdf",
  asyncHandler(exigirLogin),
  asyncHandler(gerarPdfRelatorioController)
);
router.get(
  "/pacientes/:id/relatorios/:relatorioId/docx",
  asyncHandler(exigirLogin),
  asyncHandler(gerarDocxRelatorioController)
);
router.post(
  "/pacientes/:id/relatorios/rascunho/pdf",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarRascunhoRelatorioPdf)
);
router.post(
  "/pacientes/:id/relatorios/rascunho/docx",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarRascunhoRelatorioDocx)
);
router.post(
  "/pacientes/:id/relatorios/:relatorioId/excluir",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarExcluirRelatorio)
);

router.post(
  "/pacientes/:id/pacotes",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarCriarPacote)
);
router.post(
  "/pacientes/:id/pacotes/:pacoteId/cancelar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarCancelarPacote)
);
router.post(
  "/pacientes/:id/excluir",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarExcluirPaciente)
);

router.post(
  "/agendamentos/bot/:id/presenca",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPresencaAgendamento)
);
router.post(
  "/agendamentos/importado/:id/presenca",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPresencaImportado)
);
router.post(
  "/agendamentos/presenca-lote",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPresencaLote)
);
router.get(
  "/agendamentos/bot/:id/laudo",
  asyncHandler(exigirLogin),
  asyncHandler(gerarLaudoBot)
);
router.get(
  "/agendamentos/importado/:id/laudo",
  asyncHandler(exigirLogin),
  asyncHandler(gerarLaudoImportado)
);
router.get("/financeiro", asyncHandler(exigirLogin), asyncHandler(telaFinanceiro));
router.get(
  "/financeiro/relatorio",
  asyncHandler(exigirLogin),
  asyncHandler(telaRelatorioFinanceiro)
);
router.get("/financeiro/tiss", asyncHandler(exigirLogin), asyncHandler(telaTiss));
router.get("/financeiro/tiss/lote", asyncHandler(exigirLogin), asyncHandler(gerarLoteTiss));
router.get(
  "/financeiro/pagamento/:id/guia",
  asyncHandler(exigirLogin),
  asyncHandler(gerarGuiaConvenio)
);
router.get("/estatisticas", asyncHandler(exigirLogin), asyncHandler(telaEstatisticas));
router.post(
  "/financeiro/agendamento/:id",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPagamentoAgendamento)
);
router.post(
  "/financeiro/importado/:id",
  asyncHandler(exigirLogin),
  exigirCsrf,
  asyncHandler(processarPagamentoImportado)
);
router.post(
  "/financeiro/pagamento/:id/estornar",
  asyncHandler(exigirLogin),
  exigirPapel("administradora"),
  exigirCsrf,
  asyncHandler(processarEstorno)
);
export default router;
