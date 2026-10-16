import { test } from "node:test";
import assert from "node:assert/strict";
import multer from "multer";
import { uploadAssinatura, uploadFotoPsicologo } from "../src/middleware/upload.js";

test("uploadAssinatura: é uma função de middleware Express (req, res, next)", () => {
  assert.equal(typeof uploadAssinatura, "function");
  assert.equal(uploadAssinatura.length, 3);
});

test("uploadAssinatura: erro LIMIT_FILE_SIZE do multer responde 400 amigável, sem propagar pro next", () => {
  const erroMulter = new multer.MulterError("LIMIT_FILE_SIZE");
  const res = {
    statusCode: null,
    corpo: null,
    status(codigo) { this.statusCode = codigo; return this; },
    send(corpo) { this.corpo = corpo; },
  };
  let proximoChamadoCom = "não chamado";

  // Simula o callback interno do multer.single(), sem precisar de um
  // request multipart real — é esse callback que uploadAssinatura envolve.
  const callbackInterno = uploadAssinatura.__testarCallback ?? null;
  assert.ok(callbackInterno, "uploadAssinatura precisa expor __testarCallback pra este teste");
  callbackInterno(erroMulter, res, (erro) => { proximoChamadoCom = erro; });

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /máximo 2MB/);
  assert.equal(proximoChamadoCom, "não chamado");
});

test("uploadAssinatura: erro LIMIT_UNEXPECTED_FILE do multer responde 400 amigável, sem propagar pro next", () => {
  const erroMulter = new multer.MulterError("LIMIT_UNEXPECTED_FILE");
  const res = {
    statusCode: null,
    corpo: null,
    status(codigo) { this.statusCode = codigo; return this; },
    send(corpo) { this.corpo = corpo; },
  };
  let proximoChamadoCom = "não chamado";

  const callbackInterno = uploadAssinatura.__testarCallback ?? null;
  assert.ok(callbackInterno, "uploadAssinatura precisa expor __testarCallback pra este teste");
  callbackInterno(erroMulter, res, (erro) => { proximoChamadoCom = erro; });

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /Campo de upload inesperado/);
  assert.equal(proximoChamadoCom, "não chamado");
});

test("uploadFotoPsicologo: é uma função de middleware Express (req, res, next)", () => {
  assert.equal(typeof uploadFotoPsicologo, "function");
  assert.equal(uploadFotoPsicologo.length, 3);
});

test("uploadFotoPsicologo: erro LIMIT_FILE_SIZE do multer responde 400 amigável com rótulo 'Foto'", () => {
  const erroMulter = new multer.MulterError("LIMIT_FILE_SIZE");
  const res = {
    statusCode: null,
    corpo: null,
    status(codigo) { this.statusCode = codigo; return this; },
    send(corpo) { this.corpo = corpo; },
  };
  let proximoChamadoCom = "não chamado";

  const callbackInterno = uploadFotoPsicologo.__testarCallback ?? null;
  assert.ok(callbackInterno, "uploadFotoPsicologo precisa expor __testarCallback pra este teste");
  callbackInterno(erroMulter, res, (erro) => { proximoChamadoCom = erro; });

  assert.equal(res.statusCode, 400);
  assert.match(res.corpo, /^Foto muito grande \(máximo 2MB\)\.$/);
  assert.equal(proximoChamadoCom, "não chamado");
});
