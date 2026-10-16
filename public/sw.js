// public/sw.js — service worker do PWA do dashboard.
//
// Só existe pra habilitar "Instalar app" no navegador (Chrome/Edge exigem um
// service worker ativo controlando a página). Não faz cache de nada: os
// dados aqui (agenda, financeiro, pacientes) mudam o tempo todo, e servir
// uma resposta antiga da fila de espera pra recepção seria pior que não ter
// app nenhum. Toda requisição passa direto pra rede, sempre.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // Passthrough intencional — sem event.respondWith(), o navegador trata a
  // requisição normalmente (rede), sem interceptação nem cache.
});
