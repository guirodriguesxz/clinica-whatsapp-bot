// Slug ASCII pro filename de arquivos gerados (guia, laudo, lote TISS) — um
// acento/aspas num nome real (comum em português) quebraria o header HTTP
// Content-Disposition se usado cru.
export function slugArquivo(texto) {
  return (
    texto
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "paciente"
  );
}
