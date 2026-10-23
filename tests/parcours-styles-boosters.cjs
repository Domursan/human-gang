// Parcours : 30 nouveaux styles de cartouche de booster (migration 077, booster-styles.js, boosters-styles.css).
// (a) Admin 1280 px : sélecteur de l'éditeur regroupé par famille (8 groupes, 56 styles, nom affiché et motif au survol),
//     les deux feuilles de styles chargées, choix de « Lagon » : aperçu, charge utile de hg_booster_type_save, miniature
//     de la liste ; style inconnu en base : miniature en Classique.
// (b) Admin 390 px : éditeur sans défilement horizontal.
// (c) Boutique (cartes.html, types) : un type en « Braise » affiche sa cartouche (dégradé et motif de boosters-styles.css),
//     un style inconnu ou malveillant retombe sur « cart--classique » (aucun attribut injecté) ; la tuile de stock et la
//     scène d'ouverture reprennent le style ; mode daltonien : motifs renforcés (--bs-k) ; 390 px sans défilement horizontal.
// (d) Thèmes à décor dessiné (booster-themes.js) : chaque thème rend son décor, calques non cliquables, identifiants SVG uniques,
//     effets coupés et mouvement réduit sans animation, 360 px sans défilement horizontal.
// (e) Animation d'ouverture : feux d'artifice et gâteau seulement (calque posé sur la scène, 1,5 à 2,2 s, non bloquant), aucun
//     autre thème ; mouvement réduit : flash doux au lieu de la scène.
// Faux Supabase : fixtures/fake-sb.mjs (admin) et fixtures/fake-sb-cartes.mjs (typeOverrides). Captures dans scratchpad/nuit2/shots/.
// Lancer : node tests/parcours-styles-boosters.cjs
const fs = require('fs');
const path = require('path');
const { check, finish, openPage, adminSection, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const SHOTS = '/tmp/claude-0/-home-claude/745c1954-a6f8-5445-b8b6-c526f6aef9c2/scratchpad/nuit2/shots';
fs.mkdirSync(SHOTS, { recursive: true });
/** Familles attendues dans le sélecteur, dans l'ordre, avec leur nombre de styles. */
const FAMS = [['Styles d’origine', 9], ['Rouges', 5], ['Roses et violets', 5], ['Oranges et bruns', 5], ['Jaunes et verts', 5], ['Bleus et cyans', 5], ['Indigos et neutres', 5], ['Thèmes', 14]];
/** Appels de hg_booster_type_save reçus par le faux (charges utiles). */
const saves = (p) => p.evaluate(() => (window.__LOG || []).filter((x) => x[0] === 'booster_type_save').map((x) => x[2]));

(async () => {
  const browser = await chromium.launch();

  /* ---------- (a) Admin 1280 px ---------- */
  let p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  check(await p.locator('link[data-abt-css]').count() === 2, '(a) cartes-boosters.css et boosters-styles.css chargées à la demande');
  await p.click('[data-bt="edit"][data-id="serie"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  check(await p.locator('.abt-style input[name="style"]').count() === 56, '(a) 56 styles dans le sélecteur');
  const fams = await p.$$eval('.abt-style-fam', (fs) => fs.map((f) => [f.querySelector('.abt-style-fh').firstChild.textContent.trim(), f.querySelectorAll('input[name="style"]').length]));
  check(JSON.stringify(fams) === JSON.stringify(FAMS), `(a) 8 familles dans l'ordre avec leurs effectifs (${fams.map((f) => f.join(' ')).join(', ')})`);
  check(await p.$$eval('.abt-style-fam', (fs) => fs.every((f) => f.getAttribute('role') === 'group' && document.getElementById(f.getAttribute('aria-labelledby')))), '(a) chaque famille est un groupe nommé (role=group, aria-labelledby)');
  check(await p.$eval('.abt-style:has(input[value="cart--lagon"])', (l) => l.querySelector('.abt-style-l').textContent === 'Lagon' && /ondes, moyen/.test(l.title)), '(a) nom affiché sous la cartouche, motif et luminosité au survol');
  const small = await p.$$eval('.abt-style', (ls) => ls.filter((l) => l.getBoundingClientRect().height < 44).length);
  check(small === 0, `(a) cibles d'au moins 44 px (${small} trop petites)`);
  // Les 30 nouveaux styles ont bien une règle CSS (fond du corps différent du Classique).
  const plain = await p.$$eval('.abt-style .cart-box', (bs) => bs.filter((b) => !b.classList.contains('cart--classique') && !/gradient/.test(getComputedStyle(b.querySelector('.cart-body')).backgroundImage) && getComputedStyle(b.querySelector('.cart-body')).backgroundColor === 'rgb(43, 40, 54)').map((b) => b.className));
  check(plain.length === 0, `(a) chaque style a son propre fond (${plain.join(', ') || 'tous'})`);
  const sel = await p.$('.abt-styles');
  await sel.screenshot({ path: path.join(SHOTS, 'styles-selecteur-1280.png') });
  await p.click('.abt-style:has(input[value="cart--lagon"])');
  check(await p.isChecked('.abt-style input[value="cart--lagon"]'), '(a) « Lagon » coché');
  check(await p.$eval('#abt-preview .cart-box', (b) => b.classList.contains('cart--lagon')), '(a) aperçu : classe cart--lagon');
  check(/repeating-radial-gradient/.test(await p.$eval('#abt-preview .cart-body', (e) => getComputedStyle(e).backgroundImage)), '(a) aperçu : motif « ondes » appliqué');
  await p.click('[data-drawer-submit]');
  await p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
  const sv = await saves(p);
  check(sv.length === 1 && sv[0].id === 'serie' && sv[0].style === 'cart--lagon', `(a) charge utile : style cart--lagon (${JSON.stringify(sv[0] || {})})`);
  await p.waitForSelector('.abt-row[data-type="serie"] .cart-box.cart--lagon', { timeout: 5000 }).catch(() => {});
  check(await p.locator('.abt-row[data-type="serie"] .cart-box.cart--lagon').count() === 1, '(a) liste : miniature en Lagon');
  check(p.errs.length === 0, `(a) aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  // Style inconnu en base (ex. ligne écrite avant 077 ou à la main) : la miniature retombe sur Classique.
  p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await p.evaluate(() => { window.__DB.hg_booster_types.find((t) => t.id === 'dore').style = 'cart--pirate'; });
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  check(await p.$eval('.abt-row[data-type="dore"] .cart-box', (b) => b.classList.contains('cart--classique') && !b.classList.contains('cart--pirate')), '(a) style inconnu : miniature en Classique');
  await p.ctx.close();

  /* ---------- (b) Admin 390 px : éditeur ---------- */
  p = await openPage(browser, { page: 'admin', width: 390, height: 844 });
  await adminSection(p, 'cartes/boosters');
  await p.waitForSelector('.abt-row', { timeout: 8000 });
  await p.click('[data-bt="edit"][data-id="serie"]');
  await p.waitForSelector('dialog.ui-drawer.abt-drawer[open]', { timeout: 5000 });
  const over = await p.$eval('dialog.ui-drawer', (d) => d.scrollWidth - d.clientWidth);
  const hs = await hscroll(p);
  check(over <= 0 && hs <= 0, `(b) 390 px : éditeur sans défilement horizontal (tiroir ${over}, page ${hs})`);
  await (await p.$('.abt-styles')).screenshot({ path: path.join(SHOTS, 'styles-selecteur-390.png') });
  await p.ctx.close();

  /* ---------- (c) Boutique, Inventaire, Ouverture ---------- */
  const scenario = { types: true, bal: 20000, stock: { dore: 1 },
    typeOverrides: { dore: { style: 'cart--braise' }, argente: { style: 'cart--pirate' }, diamant: { style: 'cart--x" onmouseover="alert(1)' } } };
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario });
  await p.click('[data-tab=boutique]'); await sleep(300);
  const cls = (id) => p.$eval(`#cartes-p-boutique .shop-item[data-type=${id}] .cart-box`, (b) => b.className);
  check(/\bcart--braise\b/.test(await cls('dore')), '(c) Boutique : le type Doré passé en « Braise » affiche cart--braise');
  check(/radial-gradient/.test(await p.$eval('#cartes-p-boutique .shop-item[data-type=dore] .cart-body', (e) => getComputedStyle(e).backgroundImage)), '(c) Boutique : motif « étincelles » appliqué (boosters-styles.css)');
  check(/\bcart--classique\b/.test(await cls('argente')) && !/pirate/.test(await cls('argente')), '(c) style inconnu : retombe sur cart--classique');
  check(/\bcart--classique\b/.test(await cls('diamant')) && await p.locator('[onmouseover]').count() === 0, '(c) style malveillant : Classique, aucun attribut injecté');
  check(/\bcart--holo\b/.test(await cls('holographique')), '(c) styles d’origine inchangés (Holographique)');
  await (await p.$('#cartes-p-boutique .shop-item[data-type=dore]')).screenshot({ path: path.join(SHOTS, 'styles-boutique-braise.png') });
  await p.click('[data-tab=ouverture]'); await sleep(300);
  check(await p.locator('#cartes-p-ouverture [data-stock-type=dore] .cart-box.cart--braise').count() === 1, '(c) Ouverture : la tuile du stock « Doré » est dessinée en Braise');
  await p.click('#cartes-p-ouverture [data-action=open-stock][data-type=dore]');
  await p.waitForSelector('.op-cart .cart-box', { timeout: 8000 }).catch(() => {});
  check(await p.locator('.op-cart .cart-box.cart--braise').count() === 1, '(c) scène d’ouverture : la cartouche qui tombe est en Braise');
  await p.evaluate(() => { document.documentElement.dataset.mode = 'daltonien'; });
  check((await p.$eval('.cart-box.cart--braise', (b) => getComputedStyle(b).getPropertyValue('--bs-k').trim())) === '1.8', '(c) mode daltonien : motifs renforcés (--bs-k = 1.8)');
  check(p.errs.length === 0, `(c) aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await p.ctx.close();

  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 390, height: 844, scenario });
  await p.click('[data-tab=boutique]'); await sleep(300);
  check(await hscroll(p) <= 0, '(c) 390 px : Boutique sans défilement horizontal');
  await p.ctx.close();

  /* ---------- (d) Thèmes à décor : chaque thème rend son décor, calques non cliquables, mouvement réduit ---------- */
  // Neuf types portent neuf thèmes (le dixième, Gâteau, est vérifié en (e)).
  const THEMES = [['classique', 'pate', '.cart-body > svg'], ['serie', 'saucisse', '.cart-body > svg'], ['argente', 'pate-saucisse', '.cart-scr > svg pattern'],
    ['dore', 'raclette', '.cart-body > svg .bs-rc-dr'], ['diamant', 'fondue', '.bs-over svg.fd-bx'], ['quitte_double', 'usine', '.cart-scr .ug-b'],
    ['holographique', 'halloween', '.bs-over .bs-spl .bs-wk'], ['collectionneur', 'saint-nicolas', '.bs-over .bs-sk'], ['identite', 'feux-artifice', '.cart-scr > svg circle']];
  const ovr = {}; THEMES.forEach(([id, slug]) => { ovr[id] = { style: `cart--theme-${slug}` }; });
  const scnD = { types: true, bal: 20000, stock: { dore: 1 }, typeOverrides: ovr };
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario: scnD });
  await p.click('[data-tab=boutique]'); await sleep(400);
  for (const [id, slug, sel] of THEMES) {
    const box = `#cartes-p-boutique .shop-item[data-type=${id}] .cart-box.cart--theme-${slug}`;
    check(await p.locator(`${box} ${sel}`).count() > 0, `(d) thème « ${slug} » : son décor est dessiné (${sel})`);
    check(await p.locator(`${box} .cart-scr img`).count() === 0 || slug === 'raclette', `(d) thème « ${slug} » : la scène remplace le logo à l’écran`);
  }
  check(await p.locator('#cartes-p-boutique .shop-item[data-type=dore] .cart-box.cart--theme-raclette .bs-rc-dr').count() >= 4, '(d) Raclette : la patate coupée a ses coulées animées');
  check(await p.locator('#cartes-p-boutique .cart-box.cart--theme-halloween .bs-wk').count() === 8 && await p.locator('#cartes-p-boutique .cart-box.cart--theme-halloween .bs-hd').count() === 3, '(d) Halloween : huit araignées qui marchent, trois pendues à leur fil');
  check(await p.locator('#cartes-p-boutique .cart-box.cart--theme-saint-nicolas .cart-scr .bs-fl').count() === 12, '(d) Saint-Nicolas : douze flocons');
  check(await p.$$eval('#cartes-p-boutique .bs-over', (os) => os.length >= 4 && os.every((o) => getComputedStyle(o).pointerEvents === 'none')), '(d) calques décoratifs : pointer-events none');
  check(await p.$$eval('#cartes-p-boutique .bs-over, #cartes-p-boutique .bs-over *', (os) => os.every((o) => getComputedStyle(o).pointerEvents === 'none')), '(d) calques décoratifs : aucun descendant ne capte le pointeur');
  const dupD = await p.evaluate(() => { const ids = [...document.querySelectorAll('[id]')].map((e) => e.id); return ids.filter((x, i) => ids.indexOf(x) !== i); });
  check(dupD.length === 0, `(d) identifiants SVG uniques (${dupD.slice(0, 3).join(', ') || 'aucun doublon'})`);
  check((await p.$eval('#cartes-p-boutique .cart-box.cart--theme-halloween .bs-wk', (e) => getComputedStyle(e).animationName)) !== 'none', '(d) Halloween : les araignées sont animées en mouvement normal');
  check(await p.$eval('#cartes-p-boutique .cart-box.cart--theme-raclette .cart-label', (e) => getComputedStyle(e).display) === 'none', '(d) Raclette : pas d’étiquette (toute la cartouche est la patate)');
  check(p.errs.length === 0, `(d) aucune erreur console (${p.errs.join(' | ') || 'rien'})`);
  await (await p.$('#cartes-p-boutique .cart-tiles, #cartes-p-boutique')).screenshot({ path: path.join(SHOTS, 'styles-themes-boutique.png') }).catch(() => {});
  // Effets coupés : les animations des décors s'arrêtent.
  await p.evaluate(() => { document.documentElement.dataset.fx = 'off'; });
  check((await p.$eval('#cartes-p-boutique .cart-box.cart--theme-halloween .bs-wk', (e) => getComputedStyle(e).animationName)) === 'none', '(d) effets coupés : les araignées ne bougent plus');
  await p.ctx.close();
  // Mouvement réduit (préférence système) : décor présent, animations coupées.
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario: scnD, reducedMotion: 'reduce' });
  await p.click('[data-tab=boutique]'); await sleep(400);
  check(await p.locator('#cartes-p-boutique .cart-box.cart--theme-halloween .bs-wk').count() === 8, '(d) mouvement réduit : le décor est toujours dessiné');
  const anims = await p.$$eval('#cartes-p-boutique .cart-box[class*="cart--theme-"], #cartes-p-boutique .cart-box[class*="cart--theme-"] *', (es) => es.filter((e) => getComputedStyle(e).animationName !== 'none').length);
  check(anims === 0, `(d) mouvement réduit : aucune animation dans les décors (${anims})`);
  await p.ctx.close();
  // 360 px : aucun défilement horizontal avec tous les thèmes affichés (Boutique, puis Ouverture).
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 360, height: 780, scenario: scnD });
  await p.click('[data-tab=boutique]'); await sleep(400);
  check(await hscroll(p) <= 0, '(d) 360 px : Boutique sans défilement horizontal (thèmes à décor)');
  await p.click('[data-tab=ouverture]'); await sleep(300);
  check(await hscroll(p) <= 0, '(d) 360 px : Ouverture sans défilement horizontal');
  await p.ctx.close();

  /* ---------- (e) Animation d'ouverture : feux d'artifice et gâteau seulement, non bloquante ---------- */
  /** Ouvre le booster « dore » (stock) avec le style donné ; observe les calques d'animation ajoutés et retirés. */
  const openWith = async (style, reducedMotion = 'no-preference') => {
    const q = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, reducedMotion,
      scenario: { types: true, bal: 20000, stock: { dore: 1 }, typeOverrides: { dore: { style } } } });
    await q.click('[data-tab=ouverture]'); await sleep(300);
    await q.evaluate(() => {
      window.__fx = { stage: 0, soft: 0, kinds: [], t0: 0, t1: 0, sample: null, flips: 0 };
      new MutationObserver((ms) => {
        for (const m of ms) {
          for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.matches('.bs-fx')) {
              window.__fx.stage++; window.__fx.kinds.push(n.dataset.fxKind); window.__fx.t0 = Date.now();
              const c = document.querySelector('.op-cart .cart-box').getBoundingClientRect();
              const top = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
              window.__fx.sample = { passes: !!top && !top.closest('.bs-fx'), parts: n.querySelectorAll('i').length, events: getComputedStyle(n).pointerEvents };
            }
            if (n.matches('.bs-fx-soft')) window.__fx.soft++;
          }
          for (const n of m.removedNodes) if (n.nodeType === 1 && n.matches('.bs-fx')) window.__fx.t1 = Date.now();
        }
      }).observe(document.body, { childList: true, subtree: true });
    });
    await q.click('#cartes-p-ouverture [data-action=open-stock][data-type=dore]');
    return q;
  };
  /** Attend la fin de la révélation (bouton Fermer) puis le retrait du calque. */
  const settle = async (q) => { await q.waitForSelector('[data-action=close-reveal]', { timeout: 20000 }).catch(() => {}); await sleep(2600); return q.evaluate(() => window.__fx); };

  let q = await openWith('cart--theme-feux-artifice');
  await q.waitForSelector('.op-stage .bs-fx', { timeout: 15000 }).catch(() => {});
  check(await q.locator('.op-stage .bs-fx--feux').count() === 1, '(e) feux d’artifice : le calque d’animation est posé sur la scène d’ouverture');
  check(await q.locator('.op-stage .bs-fx--feux .bs-bu').count() === 5 && await q.locator('.op-stage .bs-fx--feux .bs-bu i').count() === 80, '(e) feux d’artifice : cinq bouquets de seize étincelles');
  await q.screenshot({ path: path.join(SHOTS, 'styles-ouverture-feux.png') });
  let fx = await settle(q);
  check(fx.stage === 1 && fx.kinds[0] === 'feux' && fx.soft === 0, `(e) feux d’artifice : une seule animation, sans flash doux (${JSON.stringify({ s: fx.stage, k: fx.kinds, f: fx.soft })})`);
  check(fx.sample && fx.sample.passes && fx.sample.events === 'none', '(e) feux d’artifice : le calque laisse passer le pointeur (rien ne gêne la révélation)');
  const dur = fx.t1 - fx.t0;
  check(dur >= 1500 && dur <= 2200, `(e) feux d’artifice : durée de 1,5 à 2,2 s (${dur} ms)`);
  check(await q.locator('.bs-fx').count() === 0, '(e) feux d’artifice : le calque se retire de lui-même');
  check(await q.locator('[data-action=close-reveal]').count() === 1 && await q.locator('.op-card.is-flip').count() === 5, '(e) feux d’artifice : les cinq cartes sont révélées (la séquence n’est pas bloquée)');
  check(q.errs.length === 0, `(e) feux d’artifice : aucune erreur console (${q.errs.join(' | ') || 'rien'})`);
  await q.ctx.close();

  q = await openWith('cart--theme-gateau-anniversaire');
  await q.waitForSelector('.op-stage .bs-fx', { timeout: 15000 }).catch(() => {});
  check(await q.locator('.op-stage .bs-fx--confettis .bs-cf').count() === 44, '(e) gâteau : pluie de 44 confettis sur la scène d’ouverture');
  await q.screenshot({ path: path.join(SHOTS, 'styles-ouverture-gateau.png') });
  fx = await settle(q);
  check(fx.stage === 1 && fx.kinds[0] === 'confettis' && fx.soft === 0 && fx.t1 - fx.t0 >= 1500 && fx.t1 - fx.t0 <= 2200, `(e) gâteau : une animation de 1,5 à 2,2 s (${fx.t1 - fx.t0} ms)`);
  check(await q.locator('.op-card.is-flip').count() === 5, '(e) gâteau : les cinq cartes sont révélées');
  await q.ctx.close();

  for (const style of ['cart--theme-halloween', 'cart--theme-fondue', 'cart--braise', 'cart--classique']) {
    q = await openWith(style);
    fx = await settle(q);
    check(fx.stage === 0 && fx.soft === 0 && await q.locator('.bs-fx, .bs-fx-soft').count() === 0, `(e) ${style} : aucune animation d’ouverture`);
    check(await q.locator('.op-card.is-flip').count() === 5, `(e) ${style} : l’ouverture se déroule normalement`);
    await q.ctx.close();
  }

  // Mouvement réduit : pas de scène animée, un flash doux pour les deux thèmes seulement.
  for (const [style, kind] of [['cart--theme-feux-artifice', 'feux'], ['cart--theme-gateau-anniversaire', 'confettis']]) {
    q = await openWith(style, 'reduce');
    await q.waitForSelector('.bs-fx-soft', { timeout: 8000 }).catch(() => {});
    check(await q.locator(`.bs-fx-soft--${kind}`).count() === 1 && await q.locator('.op-stage').count() === 0, `(e) ${style} en mouvement réduit : flash doux, pas de scène animée`);
    check(await q.$eval('.bs-fx-soft', (e) => getComputedStyle(e).pointerEvents) === 'none', '(e) flash doux : pointer-events none');
    await sleep(2600);
    fx = await q.evaluate(() => window.__fx);
    check(fx.stage === 0 && fx.soft === 1 && await q.locator('.bs-fx-soft').count() === 0, `(e) ${style} en mouvement réduit : un seul flash, retiré ensuite (${fx.soft})`);
    check(await q.locator('.cartes-booster-grid').count() === 1 && await q.locator('[data-action=close-reveal]').count() === 1, `(e) ${style} en mouvement réduit : les cartes sont affichées tout de suite`);
    await q.ctx.close();
  }
  q = await openWith('cart--theme-halloween', 'reduce');
  await sleep(1800);
  check(await q.evaluate(() => window.__fx.soft) === 0, '(e) mouvement réduit : pas de flash pour un autre thème');
  await q.ctx.close();

  await browser.close();
  finish();
})();
