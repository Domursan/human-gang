const { openPage, sleep, chromium, check, finish } = require('../../lib/harness.cjs');
(async () => {
  const b = await chromium.launch();
  const p = await openPage(b, { page: 'accueil', width: 1280 });
  await sleep(800);
  const r = await p.evaluate(async () => {
    const d = document.createElement('dialog'); d.innerHTML = '<p style="padding:40px">Bonjour</p><button id="x">x</button>'; d.style.width = '300px';
    document.body.appendChild(d); d.showModal();
    const out = {};
    const fire = (el, x, y) => { el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: x, clientY: y })); el.dispatchEvent(new MouseEvent('click', { bubbles: true, clientX: x, clientY: y })); };
    const rc = d.getBoundingClientRect();
    fire(d, rc.left + 10, rc.top + 10); out.dedans = d.open;          // clic dans la boîte : reste ouverte
    fire(d, 5, 5); out.dehors = d.open;                              // clic à côté : fermée
    d.showModal(); d.addEventListener('cancel', (e) => e.preventDefault(), { once: true });
    fire(d, 5, 5); out.refus = d.open;                               // cancel refusé : reste ouverte
    d.setAttribute('data-no-dismiss', ''); fire(d, 5, 5); out.nodismiss = d.open;
    return out;
  });
  check(r.dedans === true, 'clic dans la fenêtre : reste ouverte');
  check(r.dehors === false, 'clic à côté : fermée');
  check(r.refus === true, 'fenêtre qui refuse (cancel) : reste ouverte');
  check(r.nodismiss === true, 'data-no-dismiss : reste ouverte');
  await b.close(); finish();
})();
