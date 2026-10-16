/**
 * Ajusta a formatação do texto gerado pela IA pro WhatsApp. O modelo às
 * vezes usa negrito de Markdown (**x**), que o WhatsApp mostra com os
 * asteriscos duplos literais — lá o negrito é *x* (caso real 2026-09-23).
 */
export function formatarParaWhatsapp(texto) {
  return texto.replace(/\*\*(.+?)\*\*/g, "*$1*");
}
