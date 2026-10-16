// Alguns módulos de config (ex: src/config/openai.js) instanciam clientes
// de API já na importação, e lançam erro se a env var faltar. Testes não
// fazem chamada real, mas precisam de um valor presente para o módulo
// carregar — inclusive em CI, que não tem .env.
process.env.OPENAI_API_KEY ??= "test-key";
process.env.ATENDENTE_HUMANO_TELEFONE ??= "5511999990000";

// O bot fica calado fora do expediente (ver expediente em chatService.js).
// Fixa como aberto pra suíte não depender da hora em que roda (o CI pode
// rodar de madrugada); o teste de fora do expediente sobrescreve com
// t.mock.method.
const { expediente } = await import("../src/services/chatService.js");
expediente.estaAberto = () => true;
