import rateLimit from "express-rate-limit";

// A Evolution API roda num host fixo e manda no máximo alguns eventos por
// mensagem real — 60/min por IP já é folgado para tráfego legítimo e reduz
// o custo de um flood (forjado ou não) de chamadas à OpenAI.
export const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
});

export const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
});

// Limite mais apertado que o adminLimiter — dificulta força bruta de senha
// sem incomodar um usuário real que errou a senha uma ou duas vezes.
export const dashboardLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});
