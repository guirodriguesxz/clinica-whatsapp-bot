import * as Sentry from "@sentry/node";

const SENTRY_DSN = process.env.SENTRY_DSN;

// Desligado por padrão (sem SENTRY_DSN) — ambiente local não precisa de conta
// no Sentry, e capturarErro/capturarAviso viram só console.error/console.warn.
export const sentryAtivo = Boolean(SENTRY_DSN);

// O segredo do webhook faz parte da URL (/webhook/:secret) — sem mascarar,
// ele aparece no Sentry e nos e-mails de alerta (visto em 2026-10-01).
const mascarar = (texto) =>
  typeof texto === "string" ? texto.replace(/\/webhook\/[^/?#\s]+/g, "/webhook/***") : texto;

export function mascararSegredoWebhook(evento) {
  if (evento.transaction) evento.transaction = mascarar(evento.transaction);
  if (evento.request?.url) evento.request.url = mascarar(evento.request.url);
  if (evento.tags?.url) evento.tags.url = mascarar(evento.tags.url);
  return evento;
}

if (sentryAtivo) {
  Sentry.init({
    dsn: SENTRY_DSN,
    // "development" por padrão de propósito (não "production"): o projeto
    // nunca seta NODE_ENV, e um fallback pra "production" faria todo teste
    // local aparecer no Sentry misturado com erro de produção de verdade.
    // Configure NODE_ENV=production nas variáveis da Railway (ver
    // DEPLOY_RAILWAY.md) para os eventos de lá virem marcados corretamente.
    environment: process.env.NODE_ENV || "development",
    // Só error tracking — sem tracing de performance, que tem custo/quota
    // separado no Sentry e não é o que falta aqui (ver README).
    tracesSampleRate: 0,
    beforeSend: mascararSegredoWebhook,
    // server.js já tem seu próprio handler de uncaughtException/
    // unhandledRejection (com aviso por WhatsApp e flush antes de sair) —
    // sem filtrar essas duas integrações padrão do SDK, todo crash real
    // vira DOIS eventos no Sentry (um automático do SDK, outro do nosso
    // handler) pro mesmo erro.
    integrations: (integracoesPadrao) =>
      integracoesPadrao.filter(
        (integracao) =>
          integracao.name !== "OnUncaughtException" && integracao.name !== "OnUnhandledRejection"
      ),
  });
}

/**
 * Substitui console.error nos pontos de erro do projeto: sempre loga no
 * console (comportamento anterior) e, se SENTRY_DSN estiver configurado,
 * também reporta ao Sentry — sem isso, um erro em produção só existe no log
 * da plataforma de deploy, sem alerta nem histórico.
 */
export function capturarErro(mensagem, err) {
  if (err !== undefined) {
    console.error(mensagem, err);
  } else {
    console.error(mensagem);
  }
  if (!sentryAtivo) return;
  if (err instanceof Error) {
    Sentry.captureException(err, { extra: { mensagem } });
  } else {
    Sentry.captureMessage(mensagem, "error");
  }
}

/** Mesma ideia de capturarErro, mas para avisos (console.warn) em nível "warning" no Sentry. */
export function capturarAviso(mensagem, err) {
  if (err !== undefined) {
    console.warn(mensagem, err);
  } else {
    console.warn(mensagem);
  }
  if (!sentryAtivo) return;
  if (err instanceof Error) {
    Sentry.captureException(err, { level: "warning", extra: { mensagem } });
  } else {
    Sentry.captureMessage(mensagem, "warning");
  }
}

export { Sentry };
