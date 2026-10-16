// Com entrada não-interativa (pipe), o Node entrega todas as linhas já
// disponíveis num único evento "data" — e o readline processa e emite
// 'line' para cada uma delas de forma síncrona, uma atrás da outra, sem
// esperar um consumidor se registrar entre elas. Como cada pergunta deste
// módulo só registra o próximo listener depois de um `await` (uma
// microtask, que só roda depois desse laço síncrono terminar), qualquer
// segunda linha já chegou e foi descartada antes de existir alguém
// ouvindo por ela — o `await` correspondente nunca resolve. Por isso,
// quando a entrada não é um TTY, lemos o stream inteiro uma única vez
// (a primeira pergunta feita) e respondemos cada pergunta seguinte a
// partir de uma fila de linhas já em memória, em vez de depender de
// eventos "line" ao vivo.
const filasDeLinhasPorEntrada = new WeakMap();

function lerTodasAsLinhas(entrada) {
  return new Promise((resolve) => {
    let dados = "";
    entrada.setEncoding("utf8");
    entrada.on("data", (pedaco) => {
      dados += pedaco;
    });
    entrada.on("end", () => resolve(dados.split(/\r\n|\r|\n/)));
  });
}

function obterFilaDeLinhas(entrada) {
  let fila = filasDeLinhasPorEntrada.get(entrada);
  if (!fila) {
    fila = lerTodasAsLinhas(entrada);
    filasDeLinhasPorEntrada.set(entrada, fila);
  }
  return fila;
}

export async function lerSegredo({ entrada = process.stdin, saida = process.stdout, prompt = "" } = {}) {
  if (!entrada.isTTY) {
    saida.write(prompt);
    const linhas = await obterFilaDeLinhas(entrada);
    return linhas.shift() ?? "";
  }

  return new Promise((resolve) => {
    saida.write(prompt);
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding("utf8");

    let segredo = "";

    function aoReceberDados(char) {
      if (char === "\r" || char === "\n") {
        entrada.setRawMode(false);
        entrada.pause();
        entrada.removeListener("data", aoReceberDados);
        saida.write("\n");
        resolve(segredo);
        return;
      }
      if (char === "\x7f" || char === "\b") {
        segredo = segredo.slice(0, -1);
        return;
      }
      if (char === "\x03") {
        entrada.setRawMode(false);
        process.exit(1);
      }
      segredo += char;
    }

    entrada.on("data", aoReceberDados);
  });
}
