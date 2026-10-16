# Checklist de qualidade

- [ ] Capturas em 360, 390, 768, 1024 e 1440 px
- [ ] Navegação completa por teclado
- [ ] Menu móvel abre, fecha e mantém foco visível
- [ ] Lightbox fecha com Escape e devolve o foco
- [ ] Sem rolagem horizontal
- [ ] Textos alternativos conferidos
- [ ] Preferência de movimento reduzido respeitada
- [ ] Nenhuma seção duplicada entre desktop e mobile
- [ ] A galeria mostra a recepção real de `IMG_0553.jpeg`

## Auditoria

Meta: pelo menos 90 em desempenho, acessibilidade, boas práticas e SEO para Início, Fisioterapia, Psicologia e Contato. Relatórios locais não devem ser versionados.

## Revisão realizada em 31 de agosto de 2026

- Desktop (1200 px): `.playwright-mcp/clinicaexemplo-home-desktop.png`
- Mobile (390 px): `.playwright-mcp/clinicaexemplo-home-mobile.png`
- Seis rotas aprovadas pelo smoke test; um H1 e CTA de WhatsApp em cada página.
- Galeria confirmada com a recepção real originada de `IMG_0553.jpeg`.
- Lighthouse não executado nesta rodada porque a ferramenta não faz parte das dependências locais; o orçamento permanece documentado para a auditoria de publicação.
