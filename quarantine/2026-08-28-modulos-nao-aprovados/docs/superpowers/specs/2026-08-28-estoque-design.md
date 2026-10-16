# Estoque/fornecedores/centro de custo (sub-projeto 7)

Status: escopo mínimo, direto do macro-design ("CRUD básico ... sem
integração fiscal/NF-e"). Sem spec longa — módulo simples, sem decisão de
negócio pendente como o de Guia de Convênio.

## Escopo

3 telas, mesmo padrão de `usuarios` (só criar + listar, sem editar/excluir —
"ativo" existe no schema pra desativar no futuro se precisar, mas sem UI
agora):

- **Fornecedores**: nome, telefone, observação.
- **Centros de custo**: nome, descrição.
- **Materiais consumíveis**: nome, categoria, unidade de medida, quantidade
  em estoque, estoque mínimo (opcional — quando quantidade < mínimo, a
  listagem mostra um aviso visual), fornecedor (opcional, dropdown) e centro
  de custo (opcional, dropdown).

**Não entra:** NF-e/fiscal, movimentação de estoque (entradas/saídas como
lançamentos separados — quantidade é só um campo editável direto, sem
histórico), qualquer ligação com `pagamentos`/despesas (fica pra quando/se
isso virar necessidade real).

## Modelo de dados (`015_estoque.sql`)

```sql
CREATE TABLE fornecedores (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  telefone TEXT,
  observacao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE centros_custo (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  descricao TEXT,
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE materiais (
  id SERIAL PRIMARY KEY,
  nome TEXT NOT NULL,
  categoria TEXT,
  unidade_medida TEXT,
  quantidade_em_estoque INTEGER NOT NULL DEFAULT 0 CHECK (quantidade_em_estoque >= 0),
  estoque_minimo INTEGER CHECK (estoque_minimo IS NULL OR estoque_minimo >= 0),
  fornecedor_id INTEGER REFERENCES fornecedores(id),
  centro_custo_id INTEGER REFERENCES centros_custo(id),
  ativo BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Só lista fornecedores/centros de custo `ativo = true` nos dropdowns de
materiais (mesmo padrão de "ativo" de `usuarios`).

## Rotas

```
GET  /fornecedores      lista + form de criar
POST /fornecedores
GET  /centros-custo     lista + form de criar
POST /centros-custo
GET  /estoque           lista materiais + form de criar
POST /estoque
```

## Pendência pro usuário confirmar depois

Igual combinado — guardar pra depois: que categorias de materiais/tipos de
fornecedor a clínica realmente usa (fisioterapia consome bem mais consumível
que psicologia) — não bloqueia porque os campos são texto livre, dá pra
ajustar sem migração nova.
