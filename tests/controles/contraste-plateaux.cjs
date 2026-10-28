// Contraste des pseudos et des initiales des plateaux (controles/contraste-plateaux.cjs, revue r9, constat A1).
// Table de poker (fixtures/fake-sb-plateaux-cartes.mjs) à 390 et 1280 px, en mode sombre et en mode clair :
// - chaque pseudo coloré (.plat-pseudo) et chaque initiale sur pastille (.pk-pastille) atteint 4,5:1 sur le fond où elle est lue ;
// - le fond de lecture est le plus contrasté des surfaces du thème (fond, carte, carte claire), comme dans vues/commun.js.
// Lancer : node tests/controles/contraste-plateaux.cjs
const { check, finish, openPage, chromium } = require('../lib/harness.cjs');

const MIN = 4.5;
/** Couleur CSS (#rrggbb, rgb(), rgba(), color(srgb …)) : { rgb: [r, g, b] (0 à 255), a: opacité }. */
function parse(c) {
  if (c.startsWith('#')) return { rgb: [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)), a: 1 };
  if (c.startsWith('color(srgb')) { const m = c.match(/[\d.]+/g).map(Number); return { rgb: m.slice(0, 3).map((x) => x * 255), a: m[3] ?? 1 }; }
  const m = c.match(/[\d.]+/g).map(Number);
  return { rgb: m.slice(0, 3), a: m[3] ?? 1 };
}
/** Fond réellement vu : les couches translucides de l'élément (de la racine vers l'élément) sont superposées. */
function fondVu(couches, base) {
  let fond = base.rgb.slice();
  for (const c of couches) { const k = c.a; fond = fond.map((v, i) => k * c.rgb[i] + (1 - k) * v); }
  return fond;
}
/** Luminance relative WCAG d'une couleur [r, g, b] (0 à 255). */
function lumRgb(rgb) {
  const l = rgb.map((x) => { const v = x / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
const ratio = (a, b) => { const [x, y] = [lumRgb(a), lumRgb(b)]; return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

const MODE_CLAIR = { content: "try { localStorage.setItem('hg_prefs', JSON.stringify({ mode: 'clair', special: true, effects: true, sound: false, volume: .6, revealDirect: false, shortcuts: true })); } catch (e) {}" };

(async () => {
  const browser = await chromium.launch();
  for (const mode of ['sombre', 'clair']) {
    for (const w of [390, 1280]) {
      const p = await openPage(browser, { page: 'poker', fixture: 'fake-sb-plateaux-cartes.mjs', scenario: { jeu: 'poker' }, hash: '#partie/HGPOK-1234',
        width: w, height: w < 600 ? 844 : 900, mobile: w < 600, init: mode === 'clair' ? MODE_CLAIR : null });
      await p.waitForSelector('.plat-pseudo, .pk-pastille', { timeout: 5000 }).catch(() => {});
      const mesures = await p.evaluate(() => {
        // Couches de fond de l'élément, de la racine vers l'élément (les translucides se superposent)
        const couches = (el) => { const c = []; for (let e = el; e; e = e.parentElement) c.unshift(getComputedStyle(e).backgroundColor); return c; };
        const base = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
        return {
          base,
          items: [...document.querySelectorAll('.plat-pseudo, .pk-pastille')].map((el) => ({
            pastille: el.classList.contains('pk-pastille'), texte: el.textContent.trim(), couleur: getComputedStyle(el).color,
            couches: el.classList.contains('pk-pastille') ? [getComputedStyle(el).backgroundColor] : couches(el),
          })),
        };
      });
      let pires = Infinity, nom = '';
      for (const it of mesures.items) {
        const fond = it.pastille ? parse(it.couches[0]).rgb : fondVu(it.couches.map(parse), parse(mesures.base));
        const r = ratio(parse(it.couleur).rgb, fond);
        if (r < pires) { pires = r; nom = `${it.pastille ? 'initiale' : 'pseudo'} ${it.texte}`; }
      }
      check(mesures.items.length >= 2 && pires >= MIN, `plateau poker ${mode} ${w} px : pseudos et initiales à ${MIN}:1 au moins (pire : ${nom || 'aucun'} ${Number.isFinite(pires) ? pires.toFixed(2) : '-'}, ${mesures.items.length} élément(s))`);
      check((await p.evaluate(() => document.documentElement.scrollWidth - innerWidth)) === 0, `plateau poker ${mode} ${w} px : pas de défilement horizontal`);
      await p.ctx.close();
    }
  }
  finish();
  await browser.close();
})();
