const TIPOS_IMAGEM_VALIDOS = new Set(["image/png", "image/jpeg"]);
const TAMANHO_MAXIMO_IMAGEM_BYTES = 2 * 1024 * 1024;
const ASSINATURAS_MAGICAS = {
  "image/png": [0x89, 0x50, 0x4e, 0x47],
  "image/jpeg": [0xff, 0xd8, 0xff],
};

/**
 * Validação de upload de imagem (PNG/JPEG, até 2MB, com checagem dos bytes
 * mágicos do arquivo — não só o mimetype declarado pelo navegador).
 * Compartilhada entre a assinatura do fisioterapeuta e a foto do
 * psicólogo; `rotulo` entra na mensagem de erro (ex: "Imagem da
 * assinatura", "Foto").
 */
export function validarArquivoImagem(file, rotulo) {
  if (!file) return null;
  if (!TIPOS_IMAGEM_VALIDOS.has(file.mimetype)) {
    return `${rotulo} precisa ser PNG ou JPEG.`;
  }
  if (file.size > TAMANHO_MAXIMO_IMAGEM_BYTES) {
    return `${rotulo} muito grande (máximo 2MB).`;
  }
  const assinaturaEsperada = ASSINATURAS_MAGICAS[file.mimetype];
  const bufferInicio = file.buffer?.subarray(0, assinaturaEsperada.length) ?? [];
  const bytesConferem = assinaturaEsperada.every((byte, i) => bufferInicio[i] === byte);
  if (!bytesConferem) {
    return "Arquivo não parece ser uma imagem PNG/JPEG válida.";
  }
  return null;
}
