import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("script de bootstrap aceita somente o nome e não recebe senha em argv", () => {
  const resultado = spawnSync(process.execPath, ["src/db/criar-primeiro-usuario.js"], {
    cwd: process.cwd(),
    encoding: "utf8",
  });

  assert.equal(resultado.status, 1);
  assert.match(resultado.stderr, /criar-primeiro-usuario\.js "Nome Completo"/);
  assert.doesNotMatch(resultado.stderr, /SenhaForte|nome_usuario|administradora\|recepcao/);
});

test("script rejeita argumentos extras que poderiam expor senha", () => {
  const resultado = spawnSync(
    process.execPath,
    ["src/db/criar-primeiro-usuario.js", "Administradora", "admin", "segredo"],
    { cwd: process.cwd(), encoding: "utf8", input: "valor-ignorado\n" }
  );

  assert.equal(resultado.status, 1);
  assert.doesNotMatch(resultado.stdout + resultado.stderr, /segredo/);
});
