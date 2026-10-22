// Parcours : filtres et aperçu dans l'éditeur d'offre d'échange (cartes.html › Échanges › Proposer).
// Faux Supabase : fixtures/fake-sb-cartes.mjs, scénario « echanges » (Alice a des doublons ; moi, 11 exemplaires
// dont 7 en double). Contrôles : filtres indépendants par liste (recherche, Série, Rareté, Doublons), combinaison
// Doublons + Série, compteur « X sur Y affichées », Réinitialiser, carte de l'offre toujours visible, aperçu au survol,
// au focus clavier et au toucher, bandeau replié / déplié sur 390 px, envoi d'une offre, aucune erreur console.
// Lancer : node tests/parcours-echanges-filtres.cjs
const { ROOT, check, finish, openPage, log, hscroll, sleep, chromium } = require('./lib/harness.cjs');

const ALICE = '00000002-0000-4000-8000-000000000002';
const DIALOG = '#trd-edit[open]';

/** Ouvre « Proposer un échange » avec Alice : cartes.html › Échanges › Proposer › Composer l'offre. */
/** Ouvre l'éditeur d'offre depuis Échanges › Proposer. */
async function openEditor(p) {
  await p.click('button.cartes-tab[data-tab=echanges]');
  await p.waitForSelector('#trd-tab-proposer', { timeout: 5000 });
  await p.click('#trd-tab-proposer');
  await p.selectOption('#trd-who', ALICE);
  await p.click('[data-act=compose]');
  await p.waitForSelector(DIALOG, { timeout: 5000 });
  await sleep(150);
}
/** Texte (espaces réduits) de l'élément sel. */
const txt = (p, sel) => p.textContent(sel).then((t) => (t || '').replace(/\s+/g, ' ').trim());
/** Lignes de l'aperçu : « Libellé valeur » (dt puis dd). */
/** Lignes du détail d'aperçu de l'offre, sous forme « libellé valeur ». */
const dlText = (p) => p.$$eval('#trd-peek-dl > div', (rows) => rows.map((r) => r.querySelector('dt').textContent + ' ' + r.querySelector('dd').textContent.replace(/\s+/g, ' ').trim()).join(' | '));
/** Identifiants des cartes affichées dans la grille du côté side de l'éditeur. */
const picks = (p, side) => p.$$eval(`#trd-grid-${side} button[data-side][data-id]`, (x) => x.map((b) => b.dataset.id));
/** Valeur de aria-pressed (état d'un bouton de filtre) pour l'élément sel. */
const pressed = (p, sel) => p.getAttribute(sel, 'aria-pressed');

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const SCN = { echanges: true };

  /* ---------- Ordinateur 1440 px ---------- */
  let p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: SCN, width: 1440, height: 1000 });
  await openEditor(p);
  const dlgBox = await p.locator(DIALOG).boundingBox();
  check(dlgBox && Math.abs(dlgBox.width - 1080) < 3, 'fenêtre élargie à ≈ 1080 px sur ordinateur');
  check(await txt(p, '#trd-fres-give') === '11 cartes' && await txt(p, '#trd-fres-want') === '8 cartes',
    'compteurs initiaux : 11 cartes (tes cartes), 8 cartes (ses cartes)');
  check(JSON.stringify(await p.$$eval('#trd-set-give option', (o) => o.map((x) => x.textContent))) === JSON.stringify(['Toutes les séries', 'Première édition', 'Saison 2']),
    'menu Série : « Toutes les séries » puis chaque série présente dans la liste');
  check(await p.$$eval('#trd-rar-give option', (o) => o.length) === 9, 'menu Rareté : « Toutes » + 8 raretés (dont Unique)');
  // Le survol de la souris (mouseover) peut remplir l'aperçu dès l'ouverture : on ne vérifie le libellé vide que s'il est vide.
  // Le libellé vide existe en deux formes (gabarit « Survole… », rendu JS « Touche… ») : les deux sont acceptées.
  if (await p.getAttribute('#trd-peek', 'data-state') === 'empty') {
    check(/(Survole|Touche) une carte pour voir ses détails/.test((await txt(p, '#trd-peek-name')) + ' ' + (await txt(p, '#trd-peek-empty'))),
      'aperçu vide au départ : « Survole/Touche une carte pour voir ses détails »');
  } else {
    console.log('INFO aperçu déjà rempli par le survol de la souris : libellé vide non vérifié');
  }
  const peekBox = await p.locator('#trd-peek').boundingBox();
  const colsBox = await p.locator('.trd-cols').boundingBox();
  check(peekBox && colsBox && peekBox.x < colsBox.x, 'aperçu à gauche des listes (ordinateur)');

  // Filtres indépendants : Doublons côté « Tes cartes » ne touche pas « Ses cartes »
  await p.click('[data-fchip=give]');
  check(await pressed(p, '[data-fchip=give]') === 'true', 'puce « Doublons seulement » activée (tes cartes)');
  check(await txt(p, '#trd-fres-give') === '7 sur 11 affichées', 'compteur « 7 sur 11 affichées » (doublons)');
  check(await p.isVisible('[data-freset=give]'), 'lien « Réinitialiser » visible quand un filtre est actif');
  check(await txt(p, '#trd-fres-want') === '8 cartes' && await pressed(p, '[data-fchip=want]') === 'false',
    'filtres indépendants : « Ses cartes » inchangées');
  await p.click('[data-fchip=want]');
  check(await txt(p, '#trd-fres-want') === '4 sur 8 affichées', 'doublons côté « Ses cartes » : 4 sur 8 affichées');
  check(await txt(p, '#trd-fres-give') === '7 sur 11 affichées', 'doublons côté « Tes cartes » conservés');

  // Doublons + Série : aucune carte de la série « Saison 2 » n'est en double
  await p.selectOption('#trd-set-give', 'SET2');
  check(await txt(p, '#trd-fres-give') === '0 sur 11 affichées' && /Aucune carte ne correspond aux filtres/.test(await txt(p, '#trd-grid-give')),
    'Doublons + Série « Saison 2 » : aucune carte, message « Aucune carte ne correspond aux filtres »');
  await p.selectOption('#trd-set-give', 'SET1');
  check(await txt(p, '#trd-fres-give') === '7 sur 11 affichées', 'Doublons + Série « Première édition » : 7 sur 11');
  await p.click('[data-freset=give]');
  check(await txt(p, '#trd-fres-give') === '11 cartes' && !(await p.isVisible('[data-freset=give]')),
    'Réinitialiser : retour à 11 cartes, lien masqué');
  check(await pressed(p, '[data-fchip=give]') === 'false' && (await picks(p, 'give')).length === 11, 'Réinitialiser : puce désactivée, 11 cartes affichées');
  check(await txt(p, '#trd-fres-want') === '4 sur 8 affichées', 'Réinitialiser « Tes cartes » ne touche pas « Ses cartes »');
  check(await p.evaluate(() => document.activeElement?.id) === 'trd-q-give', 'après Réinitialiser, le focus revient à la recherche');
  await p.click('[data-freset=want]');

  // Recherche par nom et Rareté
  await p.fill('#trd-q-give', 'pizza');
  check(await txt(p, '#trd-fres-give') === '2 sur 11 affichées', 'recherche « pizza » : 2 sur 11');
  await p.fill('#trd-q-give', '');
  await p.selectOption('#trd-rar-give', 'rare');
  check(await txt(p, '#trd-fres-give') === '2 sur 11 affichées', 'rareté « Rare » : 2 sur 11');
  await p.selectOption('#trd-rar-give', ''); // plus aucun filtre : « Réinitialiser » est masqué

  // Carte déjà dans l'offre : reste visible même si elle ne correspond pas aux filtres
  await p.click('#trd-grid-give button[data-id="4"]');
  check(await pressed(p, '#trd-grid-give button[data-id="4"]') === 'true', 'carte C2 sélectionnée (tes cartes)');
  check(await txt(p, '#trd-n-give') === '1 carte sélectionnée', 'compteur de sélection « 1 carte sélectionnée »');
  await p.selectOption('#trd-rar-give', 'rare');
  check((await picks(p, 'give')).includes('4') && await txt(p, '#trd-fres-give') === '3 sur 11 affichées',
    'carte sélectionnée toujours visible sous le filtre « Rare » (3 sur 11)');
  await p.selectOption('#trd-rar-give', ''); // plus aucun filtre : « Réinitialiser » est masqué

  // Aperçu au survol
  await p.hover('#trd-grid-give button[data-id="7"]');
  await sleep(100);
  check(await p.getAttribute('#trd-peek', 'data-state') === 'card' && await txt(p, '#trd-peek-name') === 'Grapeseed',
    'aperçu au survol : carte affichée en grand (Grapeseed)');
  check(await p.isVisible('#trd-peek-stage .hgc'), 'aperçu : carte en grand (vraie carte cardHtml)');
  const dl7 = await dlText(p);
  check(/Rareté Rare/.test(dl7) && /Série Première édition/.test(dl7) && /Brillante Oui/.test(dl7) && /Exemplaires possédés Tu en possèdes 1/.test(dl7)
    && /Dans l’offre Non/.test(dl7) && /Texte d’ambiance/.test(dl7), 'aperçu : nom, rareté, série, brillante, possédés, dans l’offre, ambiance');
  await p.hover('#trd-grid-give button[data-id="4"]');
  await sleep(60);
  check(/Dans l’offre Oui, dans ton offre/.test(await dlText(p)), 'aperçu : « dans l’offre » oui pour une carte sélectionnée');
  check(/Exemplaire N° /.test(await dlText(p)) === false, 'aperçu : pas de numéro d’exemplaire sans numérotation');

  // Aperçu au focus clavier, carte de l'autre liste
  await p.focus('#trd-grid-want button[data-id="105"]');
  await sleep(60);
  check(await txt(p, '#trd-peek-name') === 'Saison deux', 'aperçu au focus clavier (carte d’Alice)');
  check(/Exemplaires possédés Tu en possèdes 1 · Alice en a 1/.test(await dlText(p)),
    'aperçu d’une carte d’Alice : « Tu en possèdes 1 · Alice en a 1 »');
  check(/Série Saison 2/.test(await dlText(p)), 'aperçu : série « Saison 2 »');

  // Cas sans exemplaire chez moi, carte brillante et numérotée (Alice)
  await p.hover('#trd-grid-want button[data-id="104"]');
  await sleep(60);
  check(/Exemplaires possédés Tu n’en possèdes aucun · Alice en a 1/.test(await dlText(p)) && /Exemplaire N° 03/.test(await dlText(p)),
    'aperçu : « Tu n’en possèdes aucun · Alice en a 1 » et numéro d’exemplaire « N° 03 »');
  await p.hover('#trd-grid-want button[data-id="108"]');
  await sleep(60);
  check(/Brillante Oui, cet exemplaire/.test(await dlText(p)), 'aperçu : carte brillante signalée');

  // Carte de la liste « Ses cartes » et envoi
  await p.click('#trd-grid-want button[data-id="101"]');
  check(await txt(p, '#trd-peek-name') === 'Ethan' && await txt(p, '#trd-n-want') === '1 carte sélectionnée', 'sélection côté « Ses cartes » et aperçu');
  await p.fill('#trd-msg', 'Salut Alice');
  await p.click('#trd-send');
  await p.waitForSelector(DIALOG, { state: 'detached', timeout: 4000 }).catch(() => {});
  await sleep(300);
  const rpcs = (await log(p)).filter((l) => l[0] === 'rpc' && l[1] === 'hg_trade_propose');
  check(rpcs.length === 1 && JSON.stringify(rpcs[0][2].p_give) === '[4]' && JSON.stringify(rpcs[0][2].p_want) === '[101]' && rpcs[0][2].p_message === 'Salut Alice',
    'envoi : hg_trade_propose avec la carte donnée (4), la carte demandée (101) et le message');
  check(!(await p.$(DIALOG)), 'envoi : la fenêtre se ferme');
  check(!p.errs.length, 'ordinateur : aucune erreur JS ni console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Échap ferme la fenêtre (ordinateur) ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: SCN, width: 1280, height: 900 });
  await openEditor(p);
  await p.keyboard.press('Escape');
  await sleep(150);
  check(!(await p.$(DIALOG)), 'Échap ferme la fenêtre d’offre');
  check(!p.errs.length, '1280 px : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Téléphone 390 px ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', scenario: SCN, width: 390, height: 844, touch: true });
  await openEditor(p);
  check(await hscroll(p) === 0, '390 px : pas de défilement horizontal de la page');
  const dlg390 = await p.evaluate(() => { const d = document.getElementById('trd-edit'); return d.scrollWidth <= d.clientWidth; });
  check(dlg390, '390 px : pas de débordement horizontal dans la fenêtre');
  check(await p.evaluate(() => getComputedStyle(document.getElementById('trd-peek')).position) === 'sticky', 'bandeau d’aperçu collé en haut (sticky)');
  check(await p.isVisible('.trd-peek-toggle') === false && await p.isVisible('#trd-peek-more') === false, 'bandeau replié et vide au départ : pas de « Détails »');
  check(await p.isVisible('#trd-peek-name') && /Touche une carte/.test(await txt(p, '#trd-peek-name')), 'bandeau vide : « Touche une carte pour voir ses détails »');
  // Toucher une carte : le bandeau reprend son nom ; « Détails » le déplie
  await p.tap('#trd-grid-give button[data-id="7"]');
  await sleep(120);
  check(await txt(p, '#trd-peek-name') === 'Grapeseed' && await p.isVisible('.trd-peek-toggle'), 'au toucher : le bandeau montre la carte (Grapeseed) et « Détails »');
  check(await p.getAttribute('.trd-peek-toggle', 'aria-expanded') === 'false' && !(await p.isVisible('#trd-peek-dl')), 'bandeau replié : détails cachés');
  await p.click('.trd-peek-toggle');
  await sleep(100);
  check(await p.getAttribute('.trd-peek-toggle', 'aria-expanded') === 'true' && await p.isVisible('#trd-peek-stage .hgc') && await p.isVisible('#trd-peek-dl'),
    'bandeau déplié : carte en grand et détails');
  check(await p.evaluate(() => document.getElementById('trd-peek').getBoundingClientRect().width) <= 390, 'bandeau déplié dans la largeur du téléphone');
  await p.click('.trd-peek-toggle');
  await sleep(80);
  check(await p.getAttribute('.trd-peek-toggle', 'aria-expanded') === 'false', 'bandeau : « Détails » replie de nouveau');
  // Le bandeau reste visible en faisant défiler la fenêtre
  await p.evaluate(() => { document.getElementById('trd-edit').scrollTop = 400; });
  await sleep(120);
  const drift = await p.evaluate(() => {
    const d = document.getElementById('trd-edit').getBoundingClientRect().top;
    return Math.abs(document.getElementById('trd-peek').getBoundingClientRect().top - d);
  });
  check(drift < 2, 'bandeau collé en haut de la fenêtre pendant le défilement');
  check(await hscroll(p) === 0, '390 px : pas de défilement horizontal après défilement');
  check(!p.errs.length, '390 px : aucune erreur JS ni console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
