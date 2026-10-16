const LIMITE_PADRAO = 50;
const LIMITE_MAXIMO = 200;
const OFFSET_MAXIMO = 1_000_000;

function inteiroSeguro(valorBruto) {
  const texto = String(valorBruto ?? "");
  if (!/^-?\d+$/.test(texto)) return null;

  const numero = Number(texto);
  return Number.isSafeInteger(numero) ? numero : null;
}

export function idSeguro(valorBruto) {
  const id = inteiroSeguro(valorBruto);
  return id !== null && id >= 1 ? id : null;
}

export function limiteSeguroListagem(valorBruto) {
  const limite = inteiroSeguro(valorBruto);
  if (limite === null) return LIMITE_PADRAO;
  return Math.max(1, Math.min(limite, LIMITE_MAXIMO));
}

export function offsetSeguroListagem(valorBruto) {
  const offset = inteiroSeguro(valorBruto);
  if (offset === null) return 0;
  return Math.max(0, Math.min(offset, OFFSET_MAXIMO));
}
