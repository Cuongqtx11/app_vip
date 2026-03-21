(() => {
  const AD_URL = 'https://sanngon.net';
  const ICON_SRC = './logo-sanngon-v2.svg';
  const SHOW_MIN = 3200;
  const SHOW_MAX = 6500;
  const HIDE_MIN = 5000;
  const HIDE_MAX = 10000;

  const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

  function injectStyles() {
    if (document.getElementById('sanngon-ad-style')) return;
    const style = document.createElement('style');
    style.id = 'sanngon-ad-style';
    style.textContent = `
      #sanngon-floating-ad {
        position: fixed;
        left: 12px;
        top: 96px;
        width: 34px;
        height: 34px;
        z-index: 9999;
        opacity: 0;
        transform: scale(0.92);
        transition: opacity .45s ease, transform .45s ease;
        pointer-events: auto;
        -webkit-tap-highlight-color: transparent;
      }

      #sanngon-floating-ad.is-visible {
        opacity: .96;
        transform: scale(1);
      }

      #sanngon-floating-ad img {
        width: 100%;
        height: 100%;
        display: block;
        object-fit: contain;
        user-select: none;
        pointer-events: none;
        filter: drop-shadow(0 2px 6px rgba(0,0,0,.2));
      }

      #sanngon-floating-ad.is-visible {
        animation: sanngonWiggle var(--sg-wiggle,1.8s) ease-in-out infinite,
                   sanngonDrift var(--sg-drift,3.6s) ease-in-out infinite;
        animation-delay: var(--sg-delay,0s), calc(var(--sg-delay,0s) / 2);
        transform-origin: center center;
      }

      @keyframes sanngonWiggle {
        0%,100% { transform: rotate(0deg) scale(1); }
        20% { transform: rotate(-8deg) scale(1.02); }
        40% { transform: rotate(7deg) scale(.99); }
        60% { transform: rotate(-5deg) scale(1.03); }
        80% { transform: rotate(4deg) scale(1); }
      }

      @keyframes sanngonDrift {
        0%,100% { translate: 0 0; }
        25% { translate: 1px -3px; }
        50% { translate: -2px 2px; }
        75% { translate: 2px -2px; }
      }
    `;
    document.head.appendChild(style);
  }

  function createAd() {
    const a = document.createElement('a');
    a.id = 'sanngon-floating-ad';
    a.href = AD_URL;
    a.target = '_blank';
    a.rel = 'noopener noreferrer sponsored';
    a.setAttribute('aria-label', 'Mở Săn Ngon');

    const img = document.createElement('img');
    img.src = ICON_SRC;
    img.alt = 'Săn Ngon';
    img.draggable = false;
    a.appendChild(img);

    a.addEventListener('click', (e) => {
      e.stopPropagation();
    }, true);

    document.body.appendChild(a);
    return a;
  }

  function placeAd(el) {
    const vw = window.innerWidth || 390;
    const vh = window.innerHeight || 844;
    const size = rand(30, 38);
    const safeTop = 92;
    const safeBottom = 96;
    const left = rand(8, Math.max(12, vw - size - 8));
    const top = rand(safeTop, Math.max(safeTop + 10, vh - safeBottom - size));

    el.style.width = size + 'px';
    el.style.height = size + 'px';
    el.style.left = clamp(left, 8, Math.max(8, vw - size - 8)) + 'px';
    el.style.top = clamp(top, safeTop, Math.max(safeTop, vh - safeBottom - size)) + 'px';
    el.style.setProperty('--sg-wiggle', (rand(140, 240) / 100) + 's');
    el.style.setProperty('--sg-drift', (rand(260, 420) / 100) + 's');
    el.style.setProperty('--sg-delay', (rand(0, 90) / 100) + 's');
  }

  function startCycle(el) {
    const show = () => {
      placeAd(el);
      el.classList.add('is-visible');
      window.setTimeout(hide, rand(SHOW_MIN, SHOW_MAX));
    };

    const hide = () => {
      el.classList.remove('is-visible');
      window.setTimeout(show, rand(HIDE_MIN, HIDE_MAX));
    };

    window.setTimeout(show, rand(600, 2000));
  }

  function init() {
    if (document.getElementById('sanngon-floating-ad')) return;
    injectStyles();
    const ad = createAd();
    startCycle(ad);
    window.addEventListener('resize', () => {
      if (ad.classList.contains('is-visible')) placeAd(ad);
    }, { passive: true });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
