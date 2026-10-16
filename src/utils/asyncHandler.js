/**
 * Express 4 não encaminha exceções de handlers async pro middleware de erro
 * automaticamente — sem isso, um throw dentro de um handler async vira uma
 * promise rejeitada sem dono, e a requisição fica pendurada sem resposta.
 * Esse wrapper garante que qualquer erro caia no error handler global
 * (src/app.js), mesmo que o handler individual esqueça o try/catch.
 */
export function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
