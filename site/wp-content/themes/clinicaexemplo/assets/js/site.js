document.documentElement.classList.remove('no-js');
document.documentElement.classList.add('js');

// O botão flutuante do WhatsApp (plugin Join.chat) fica sobre o texto dos
// cards ao rolar no mobile. Some com ele durante o scroll e volta a mostrar
// quando o usuário para, em vez de tampar o conteúdo o tempo todo.
const joinchat = document.querySelector('.joinchat');
if (joinchat) {
  let scrollTimer;
  window.addEventListener('scroll', () => {
    joinchat.classList.add('joinchat--scrolling');
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => joinchat.classList.remove('joinchat--scrolling'), 400);
  }, { passive: true });
}

const toggle = document.querySelector('[data-menu-toggle]');
const menu = document.getElementById('menu-principal');
if (toggle && menu) {
  toggle.addEventListener('click', () => {
    const open = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!open));
    menu.toggleAttribute('data-open', !open);
  });
}

// Vídeo com autoplay mudo (ver clinicaexemplo_video em inc/setup.php): o toque
// religa o áudio (e garante que está tocando) em vez de iniciar a
// reprodução. Vídeo sem autoplay: toque alterna tocar/pausar, como antes.
document.querySelectorAll('[data-tap-to-play]').forEach((video) => {
  video.addEventListener('click', () => {
    if (video.muted) {
      video.muted = false;
      video.play();
    } else if (video.paused) {
      video.play();
    } else {
      video.pause();
    }
  });
});

// Vídeos abaixo da dobra (ver $autoplayInView em clinicaexemplo_video, inc/setup.php)
// só começam a tocar (mudo) quando entram na tela ao rolar, pra não gastar
// dados/CPU tocando fora da vista. Não usa o atributo autoplay nativo, que
// tocaria assim que o elemento entra no DOM independente de estar visível.
const autoplayInViewVideos = document.querySelectorAll('[data-autoplay-in-view]');
if (autoplayInViewVideos.length && 'IntersectionObserver' in window) {
  const autoplayObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) entry.target.play();
      });
    },
    { threshold: 0.5 }
  );
  autoplayInViewVideos.forEach((video) => autoplayObserver.observe(video));
}

const galleryLinks = [...document.querySelectorAll('[data-lightbox]')];
const dialog = document.querySelector('[data-lightbox-dialog]');
if (galleryLinks.length && dialog) {
  const image = dialog.querySelector('img');
  const close = dialog.querySelector('[data-lightbox-close]');
  let index = 0;
  let returnFocus = null;
  const show = (nextIndex) => {
    index = (nextIndex + galleryLinks.length) % galleryLinks.length;
    image.src = galleryLinks[index].href;
    image.alt = galleryLinks[index].querySelector('img')?.alt ?? '';
  };
  const dismiss = () => { dialog.hidden = true; document.body.style.overflow = ''; returnFocus?.focus(); };
  galleryLinks.forEach((link, linkIndex) => link.addEventListener('click', (event) => {
    event.preventDefault(); returnFocus = event.currentTarget; show(linkIndex);
    dialog.hidden = false; document.body.style.overflow = 'hidden'; close.focus();
  }));
  close.addEventListener('click', dismiss);
  dialog.querySelector('[data-lightbox-prev]').addEventListener('click', () => show(index - 1));
  dialog.querySelector('[data-lightbox-next]').addEventListener('click', () => show(index + 1));
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') dismiss();
    if (event.key === 'ArrowLeft') show(index - 1);
    if (event.key === 'ArrowRight') show(index + 1);
    if (event.key === 'Tab') {
      const controls = [...dialog.querySelectorAll('button')];
      const current = controls.indexOf(document.activeElement);
      event.preventDefault(); controls[(current + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    }
  });
}
