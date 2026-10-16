# Site WordPress Clínica Exemplo — Especificação de design

**Data:** 2026-08-31
**Status:** aprovado para planejamento
**Objetivo:** substituir o site atual por um tema WordPress próprio, leve, responsivo e editável, construído inicialmente em ambiente local.

## Objetivo do produto

O site deve transformar visitas em contatos pelo WhatsApp e, ao mesmo tempo, apresentar com clareza os serviços reais da Clínica Exemplo. O público principal são pessoas da Zona Norte de São Paulo buscando fisioterapia, reabilitação, prevenção, psicologia ou informações sobre convênios.

O trabalho principal de cada página é responder rapidamente a três perguntas: o atendimento serve para mim, a clínica transmite confiança e como faço para agendar?

## Abordagem escolhida

Será criado um tema WordPress próprio, sem construtor visual pesado. O tema usará os recursos nativos do editor de blocos para textos, imagens e informações recorrentes. Componentes que precisam manter consistência visual serão implementados como padrões de blocos e campos configuráveis do tema.

Essa abordagem foi escolhida por oferecer:

- identidade visual própria;
- carregamento mais rápido que uma página montada integralmente em Elementor;
- controle preciso da experiência mobile;
- conteúdo editável pela equipe no WordPress;
- base adequada para SEO local e evolução futura.

## Arquitetura de páginas

### Início

- Cabeçalho com logotipo, navegação e botão “Agende sua avaliação”.
- Hero com mensagem principal, CTA para WhatsApp e fotografia de atendimento.
- Resumo dos tratamentos de fisioterapia.
- Bloco de convênios e atendimento particular.
- Destaque de fisioterapia domiciliar.
- Diferenciais: atendimento individualizado, recursos terapêuticos, acompanhamento próximo e atendimento humanizado.
- Avaliações reais, quando fornecidas ou incorporadas de fonte autorizada.
- Resumo de psicologia.
- Galeria compacta da estrutura com fotografias reais.
- Endereço, horários, mapa e contatos.

### Fisioterapia

- Reabilitação física.
- Tratamento de dores crônicas.
- Prevenção e mobilidade.
- Recursos terapêuticos.
- Atendimento domiciliar particular na Zona Norte, mediante disponibilidade.
- CTA para avaliação.

O conteúdo não fará promessas clínicas absolutas nem garantias de resultado.

### Psicologia

- Atendimento para crianças, adolescentes e adultos.
- Escuta, respeito e acompanhamento individualizado.
- Convênios e particular.
- CTA para consultar disponibilidade e cobertura.

### Convênios

- Lista editável de convênios atendidos.
- Orientação para confirmar cobertura pelo WhatsApp.
- Informação sobre atendimento particular.
- Logos apresentados em grade legível, sem carrossel excessivo.

### Estrutura

- Galeria completa com fotos reais da sala principal de fisioterapia, consultórios, psicologia, recepção, corredores, entrada e fachada.
- Lightbox acessível para ampliar imagens.
- Legendas descritivas e textos alternativos editáveis.

### Contato

- WhatsApp: (11) 99999-0100.
- Telefones: (11) 5555-0101 e (11) 5555-0102.
- Endereço: Av. Exemplo, 1000 — Bairro Exemplo — São Paulo/SP.
- Horário: segunda a sexta, 07:00–19:30.
- Mapa incorporado com alternativa em link para abrir o aplicativo de mapas.

## Direção visual

### Conceito

O visual comunicará movimento, cuidado e realidade. As curvas usadas nas transições entre seções serão inspiradas no movimento da coluna presente no símbolo da Clínica Exemplo. Essa será a assinatura visual do site; o restante permanecerá sóbrio e funcional.

As fotografias reais da clínica terão prioridade sobre ambientes gerados ou imagens genéricas. Fotos de banco poderão ser usadas apenas provisoriamente em cenas de atendimento que ainda não tenham equivalente real, sempre identificadas como provisórias no ambiente local.

### Paleta

- **Verde profundo — `#174D32`:** títulos, navegação e fundos de destaque.
- **Verde Clínica Exemplo — `#5F8F3E`:** botões secundários, ícones e detalhes.
- **Sálvia clara — `#E7EFE1`:** fundos suaves e agrupamento de conteúdo.
- **Branco clínico — `#FCFDFB`:** fundo principal.
- **Grafite — `#202722`:** textos corridos.
- **Areia neutra — `#E9E3D8`:** apoio para fotografias e seções de acolhimento.

### Tipografia

- **Display:** Lora, para títulos editoriais e acolhedores.
- **Texto e interface:** Manrope, para legibilidade e aparência contemporânea.
- As fontes serão hospedadas localmente no tema para reduzir dependências externas e melhorar privacidade e desempenho.

### Layout

- Conteúdo máximo de 1200 px, com margens fluidas.
- Hero assimétrico: texto à esquerda e imagem dominante à direita.
- Cards usados somente quando representarem grupos equivalentes.
- Galerias com proporções consistentes e cortes definidos por contexto.
- Um botão primário verde por agrupamento visual.
- WhatsApp flutuante discreto, com rótulo acessível.

## Componentes do tema

- Cabeçalho responsivo e navegação móvel.
- Rodapé com contatos, endereço e links legais.
- Botão de WhatsApp com mensagem configurável por página.
- Hero interno reutilizável.
- Cards de tratamento.
- Grade de convênios.
- Bloco de atendimento domiciliar.
- Bloco de avaliações.
- Galeria/lightbox.
- Bloco de endereço, horários e mapa.
- Aviso de privacidade e página de política de privacidade.

Cada componente terá uma responsabilidade visual clara e receberá dados do editor do WordPress ou das configurações do tema. Conteúdo não será duplicado em templates diferentes quando puder ser reutilizado.

## Conteúdo editável

Pelo painel, a clínica poderá editar:

- títulos e textos das páginas;
- imagens e respectivos textos alternativos;
- lista e logos dos convênios;
- avaliações exibidas;
- telefones, WhatsApp, endereço e horários;
- links de redes sociais;
- mensagem inicial do WhatsApp;
- dados básicos de SEO de cada página.

Informações globais ficarão centralizadas nas configurações do tema para evitar divergências entre páginas.

## Fluxos e integrações

### Agendamento

O site não criará um sistema de agenda nesta primeira versão. Todos os CTAs abrirão o WhatsApp oficial com uma mensagem inicial adequada à página de origem. A navegação para o WhatsApp deve funcionar mesmo se JavaScript estiver desativado.

### Mapa

O mapa será carregado de forma tardia ou mediante interação para não bloquear a renderização inicial. Haverá sempre um link textual com o endereço completo.

### Avaliações

Na primeira versão, avaliações serão cadastradas manualmente no WordPress. Integração automática com Google dependerá de credenciais e consentimento específicos e fica fora deste escopo.

## Responsividade e acessibilidade

- Breakpoints definidos pelo conteúdo, com validação mínima em 360, 390, 768, 1024 e 1440 px.
- Sem seções duplicadas para desktop e mobile.
- Navegação utilizável por teclado.
- Foco visível em links, botões e controles.
- Respeito a `prefers-reduced-motion`.
- Contraste compatível com WCAG 2.2 AA.
- Imagens com textos alternativos significativos.
- Lightbox e menu móvel com gerenciamento correto de foco.
- Alvos de toque com pelo menos 44 × 44 px.

## Desempenho e SEO

- HTML semântico com um único H1 por página.
- Metadados Open Graph e dados estruturados de negócio local.
- Imagens responsivas em WebP/AVIF com dimensões declaradas.
- Fontes locais e CSS crítico enxuto.
- JavaScript somente para menu, lightbox e melhorias progressivas.
- Carregamento tardio para galerias e mapa.
- URLs simples e títulos específicos por serviço e localização.
- Meta inicial: Lighthouse local acima de 90 em desempenho, acessibilidade, boas práticas e SEO nas páginas principais, reconhecendo que hospedagem e plugins podem afetar o resultado final.

## Tratamento de erros e conteúdo incompleto

- Imagens ausentes não quebram o layout; o componente usa fundo neutro e mantém a legenda.
- Logos de convênios ausentes aparecem como nomes em texto.
- Link de mapa ausente remove o iframe e mantém endereço e telefones.
- Campos globais essenciais terão valores iniciais com os dados confirmados, mas continuarão editáveis.
- Conteúdo provisório será sinalizado apenas no ambiente local e removido antes da publicação.

## Ambiente local

O desenvolvimento será isolado do bot já existente. A implementação do tema ficará em um diretório próprio, acompanhada de configuração local do WordPress e instruções de instalação. Nenhum arquivo do sistema de agendamento/WhatsApp será alterado para hospedar o site público.

O ambiente local deverá permitir:

- iniciar WordPress e banco de dados;
- instalar/ativar o tema;
- importar conteúdo inicial de demonstração;
- visualizar o site em desktop e mobile;
- empacotar o tema para instalação posterior no WordPress de produção.

## Validação

- Testes automatizados básicos para funções PHP e escaping, quando aplicável.
- Validação de padrões de codificação do WordPress.
- Verificação manual de todos os links e CTAs.
- Capturas comparativas em desktop e mobile.
- Auditoria de acessibilidade por teclado e ferramenta automatizada.
- Lighthouse nas páginas Início, Fisioterapia, Psicologia e Contato.
- Conferência dos dados reais e remoção de qualquer depoimento, foto ou logo provisório antes da publicação.

## Fora do escopo inicial

- Publicação no servidor de produção.
- Migração automática do site atual.
- Integração direta com agenda ou prontuário.
- Área do paciente.
- Blog e produção recorrente de conteúdo.
- Integração automática com Instagram ou avaliações do Google.
- Alterações no bot e no dashboard administrativo existente.

## Critério de conclusão

O trabalho local estará concluído quando o tema puder ser instalado em WordPress, todas as seis páginas estiverem navegáveis e responsivas, os dados confirmados estiverem corretos, as fotos reais estiverem integradas, os CTAs abrirem o WhatsApp e o pacote do tema estiver acompanhado de instruções para instalação e futura publicação.
