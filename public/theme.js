/* global document, localStorage */
(() => {
  const root = document.documentElement;
  let theme = 'light';
  try { theme = localStorage.getItem('clinicaexemploTheme') === 'dark' ? 'dark' : 'light'; } catch { /* Preferência local indisponível. */ }
  root.dataset.theme = theme;
  document.addEventListener('DOMContentLoaded', () => {
    const button = document.querySelector('[data-theme-toggle]');
    if (!button) return;
    const update = () => {
      const dark = root.dataset.theme === 'dark';
      button.textContent = dark ? 'Tema claro' : 'Tema escuro';
      button.setAttribute('aria-pressed', String(dark));
    };
    update();
    button.addEventListener('click', () => {
      root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem('clinicaexemploTheme', root.dataset.theme); } catch { /* Tema continua nesta página. */ }
      update();
    });
  });
})();
