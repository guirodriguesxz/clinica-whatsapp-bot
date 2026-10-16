import multer from "multer";

// Mantido igual ao TAMANHO_MAXIMO_ASSINATURA_BYTES de fisioterapeutaController.js
// (Tarefa 4) — se um dia mudar, mudar nos dois lugares.
const TAMANHO_MAXIMO_ASSINATURA_BYTES = 2 * 1024 * 1024;

const uploadMemoria = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: TAMANHO_MAXIMO_ASSINATURA_BYTES },
});

function tratarErroUpload(err, res, next, descricaoCampo = "Imagem da assinatura") {
  if (!err) return next();
  if (err.code === "LIMIT_FILE_SIZE") {
    return res.status(400).send(`${descricaoCampo} muito grande (máximo 2MB).`);
  }
  if (err.code === "LIMIT_UNEXPECTED_FILE") {
    return res.status(400).send("Campo de upload inesperado.");
  }
  next(err);
}

export function uploadAssinatura(req, res, next) {
  uploadMemoria.single("assinatura")(req, res, (err) => tratarErroUpload(err, res, next));
}
uploadAssinatura.__testarCallback = tratarErroUpload;

export function uploadFotoPsicologo(req, res, next) {
  uploadMemoria.single("foto")(req, res, (err) => tratarErroUpload(err, res, next, "Foto"));
}
uploadFotoPsicologo.__testarCallback = (err, res, next) => tratarErroUpload(err, res, next, "Foto");
