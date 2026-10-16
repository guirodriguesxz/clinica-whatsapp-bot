// Lista fixa usada só na UI (dropdown de criar/editar) — o banco continua
// aceitando qualquer TEXT em base_conhecimento.categoria, sem enum, então
// entradas antigas fora desta lista continuam válidas e aparecem como
// "Categoria (livre)" na tela de edição em vez de sumir.
export const CATEGORIAS_BASE_CONHECIMENTO = [
  { valor: "horarios", rotulo: "Horários" },
  { valor: "convenios", rotulo: "Convênios" },
  { valor: "precos", rotulo: "Preços" },
  { valor: "localizacao", rotulo: "Localização" },
  { valor: "politicas", rotulo: "Políticas" },
  { valor: "fisioterapia", rotulo: "Fisioterapia" },
  { valor: "psicologia", rotulo: "Psicologia" },
  { valor: "geral", rotulo: "Geral" },
];
