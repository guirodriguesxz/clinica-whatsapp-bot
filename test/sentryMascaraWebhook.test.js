import { test } from "node:test";
import assert from "node:assert/strict";
import { mascararSegredoWebhook } from "../src/config/sentry.js";

test("mascararSegredoWebhook esconde o segredo da URL do webhook no evento do Sentry", () => {
  const evento = {
    transaction: "POST /webhook/abc123segredo",
    request: { url: "https://x.up.railway.app/webhook/abc123segredo" },
    tags: { url: "https://x.up.railway.app/webhook/abc123segredo" },
  };
  const r = mascararSegredoWebhook(evento);
  assert.equal(r.transaction, "POST /webhook/***");
  assert.equal(r.request.url, "https://x.up.railway.app/webhook/***");
  assert.equal(r.tags.url, "https://x.up.railway.app/webhook/***");
});

test("mascararSegredoWebhook não mexe em evento sem URL de webhook", () => {
  const evento = { transaction: "GET /health", request: { url: "https://x/health" } };
  assert.deepEqual(mascararSegredoWebhook(evento), evento);
});
