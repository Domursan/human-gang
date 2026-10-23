// Parcours : sous-menus du panel admin (admin.html) — titres de groupe dans la colonne de navigation, routes des parties
// (Économie, Réglages, Badges, Accès aux pages) et des nouvelles sections (Secrets, Fil d'activité, Champs du profil),
// garde de longueur des onglets, filtrage Staff, mobile. Sur le faux Supabase (fixtures/fake-sb.mjs).
// (a) administrateur : chaque domaine affiche ses titres de groupe (texte annoncé, role="group", rien de cliquable)
// (b) chaque route de l'arbre s'ouvre (adresse et lien actif) ; anciennes adresses : #reglages → #site/identite,
//     #cartes/economie, #vie/badges, #membres/acces, #site/reglages restent valides ; palette « Groupe · Libellé »
// (c) garde de longueur : à 1 280 × 900, #app.scrollHeight ≤ 1 400 px pour chaque sous-section, partie, onglet du Bot et
//     onglet de la fiche membre (données du faux Supabase), sauf la liste d'exceptions EXCEPTIONS ci-dessous
// (d) Staff ['cartes'] : ni Secrets, ni Fil, ni Questions, ni GeoGuessr, ni Citations ; seul « Jeux du jour » (droit cartes) sous « Jeux » ; titres Catalogue, Économie, Animation, Suivi, Jeux
// (e) 375 px : 6 onglets en bas, écran du domaine avec ses titres, sans défilement horizontal
// Lancer : node tests/parcours-admin-sousmenus.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

/** Identifiant de test du membre n (mêmes identifiants que le faux client : U(3) = Bruno). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
// Hauteur maximale d'un onglet (px CSS, zone principale, fenêtre 1 280 × 900).
const MAX_H = 1400;
// Exceptions documentées à la garde de longueur (route → raison). Toute autre route au-delà de MAX_H échoue.
const EXCEPTIONS = {
  'cartes/boosters': 'liste des 9 types et statistiques par type (onglet Boosters, chantier séparé : statistiques à replier)',
  'membres/invitations': 'codes + liens + règles des codes, à la limite (≈ 1 403 px avec la fixture) : « Règles des codes » à séparer plus tard (audit §3.3)',
};

// Arbre attendu : domaine → [titre de groupe (null : sans titre), [sous-sections]].
const TREE = {
  pilotage: [[null, ['apercu', 'planning', 'journal', 'staff']]],
  membres: [['Comptes', ['comptes', 'relance', 'invitations', 'champs']], ['Accès aux pages', ['acces', 'acces-matrice']]],
  vie: [['Sorties et souvenirs', ['sorties', 'souvenirs']], ['Rendez-vous', ['secret-santa', 'evenements']],
    ['Badges', ['badges', 'badges-attribution', 'badges-criteres']]],
  cartes: [['Catalogue', ['series', 'cartes', 'boosters']], ['Économie', ['economie', 'tirage', 'recyclage', 'limites']],
    ['Animation', ['quetes', 'defis', 'drops', 'cagnotte', 'champions']], ['Suivi', ['joueurs', 'echanges', 'stats']],
    ['Jeux', ['questions', 'pronos', 'sutom', 'secrets', 'geoguessr', 'jeux-du-jour', 'citations', 'preuves', 'framed-heardle', 'bataille', 'mes-jeux']]],
  communication: [['Demandes', ['assistance', 'idees']], ['Conversations', ['messagerie', 'fil']], ['Discord', ['bot']]],
  site: [['Identité et textes', ['identite', 'textes', 'menu']], ['Fonctionnement', ['etat', 'reglages']], ['Apparence', ['theme']]],
};
const ROUTES = Object.entries(TREE).flatMap(([d, groups]) => groups.flatMap(([, subs]) => subs.map((s) => `${d}/${s}`)));

/** Titres de groupe et sous-sections de la colonne d'un domaine, dans l'ordre : [[titre|null, [ids]]]. */
const columnTree = (p, dom) => p.$$eval(`#shell-subs [data-dom-subs="${dom}"] > *`, (nodes) => nodes.reduce((acc, n) => {
  if (n.classList.contains('shell-subgroup')) {
    acc.push([n.querySelector('.shell-subhead')?.textContent.trim() ?? '?', [...n.querySelectorAll('.shell-sub')].map((a) => a.dataset.sub)]);
  } else if (n.classList.contains('shell-sub')) {
    const last = acc[acc.length - 1];
    if (last && last[0] === null) last[1].push(n.dataset.sub); else acc.push([null, [n.dataset.sub]]);
  }
  return acc;
}, []));

/** Hauteur de la zone principale une fois le rendu posé. */
async function zoneHeight(p) {
  await sleep(600);
  return p.evaluate(() => document.getElementById('app').scrollHeight);
}
/** Ouvre une adresse par le fragment (sans attendre de lien actif : onglets de fiche, détails). */
async function goHash(p, h) {
  await p.evaluate((x) => { location.hash = x; }, h);
  await sleep(400);
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {

  /* ---------- (a) Titres de groupe, administrateur ---------- */
  let p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  for (const [dom, want] of Object.entries(TREE)) {
    const got = await columnTree(p, dom);
    check(JSON.stringify(got) === JSON.stringify(want), `(a) ${dom} : colonne = ${JSON.stringify(got)}`);
  }
  const heads = await p.$$eval('.shell-subhead', (hs) => hs.map((h) => ({
    tag: h.tagName, tab: h.tabIndex, role: h.getAttribute('role'), inLink: !!h.closest('a, button'),
    named: h.parentElement.getAttribute('role') === 'group' && h.parentElement.getAttribute('aria-labelledby') === h.id,
  })));
  check(heads.length > 0 && heads.every((h) => h.tag === 'P' && h.tab < 0 && !h.role && !h.inLink && h.named),
    `(a) titres de groupe : texte simple, non focalisable, nommant leur role="group" (${heads.length} titres)`);
  // Lisibilité : le titre est visible et de taille ≥ 11 px dans la colonne du domaine affiché
  await adminSection(p, 'cartes/tirage');
  const look = await p.$eval('[data-dom-subs="cartes"] .shell-subhead', (h) => ({ fs: parseFloat(getComputedStyle(h).fontSize), vis: h.getClientRects().length > 0 }));
  check(look.vis && look.fs >= 11, `(a) titre de groupe visible et lisible (${look.fs} px)`);
  check((await p.textContent('#zone-eyebrow')).trim() === 'Jeux et cartes · Économie' && (await p.textContent('#zone-title')).trim() === 'Tirage',
    '(a) en-tête de zone : « Jeux et cartes · Économie » puis « Tirage »');

  /* ---------- (b) Chaque route s'ouvre ; anciennes adresses ---------- */
  const bad = [];
  for (const r of ROUTES) {
    try { await adminSection(p, r); } catch { bad.push(r); }
  }
  check(!bad.length, `(b) les ${ROUTES.length} routes s'ouvrent (adresse, lien actif, section visible)${bad.length ? ' — échecs : ' + bad.join(', ') : ''}`);
  for (const [from, to] of [['#reglages', '#site/identite'], ['#cartes/economie', '#cartes/economie'], ['#vie/badges', '#vie/badges'],
    ['#membres/acces', '#membres/acces'], ['#site/reglages', '#site/reglages'], ['#eggs', '#cartes/secrets'], ['#fil', '#communication/fil']]) {
    await goHash(p, 'pilotage/apercu');
    await goHash(p, from);
    await p.waitForFunction((t) => location.hash === t, to, { timeout: 4000 }).catch(() => {});
    check(await p.evaluate(() => location.hash) === to, `(b) ${from} → ${to}`);
  }
  // Rail : l'icône Réglages mène au formulaire « Identité et textes »
  check(await p.getAttribute('#shell-foot [data-rail-reglages]', 'href') === '#site/identite', '(b) rail : Réglages → #site/identite');
  // Palette : « Groupe · Libellé », recherche sur le titre de groupe
  await p.keyboard.press('Control+k');
  await p.waitForSelector('.apal-backdrop:not([hidden])', { timeout: 5000 });
  await p.fill('#apal-q', 'économie');
  await sleep(200);
  const pal = await p.$$eval('.apal-item .apal-label', (els) => els.map((e) => e.textContent.trim()));
  check(JSON.stringify(pal) === JSON.stringify(['Économie · Paillettes et dons', 'Économie · Tirage', 'Économie · Recyclage et fabrication', 'Économie · Limites']),
    `(b) palette « économie » : ${pal.join(' | ')}`);
  await p.fill('#apal-q', 'matrice');
  await sleep(200);
  await p.keyboard.press('Enter');
  await p.waitForFunction(() => location.hash === '#membres/acces-matrice', null, { timeout: 5000 }).catch(() => {});
  check(await p.evaluate(() => location.hash) === '#membres/acces-matrice', '(b) palette : « matrice » ouvre Accès aux pages › Matrice');
  check(p.errs.length === 0, '(a-b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 5).join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- (c) Garde de longueur, 1 280 × 900 ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  const H = {};
  for (const r of ROUTES) {
    await adminSection(p, r).catch(() => {});
    H[r] = await zoneHeight(p);
    if (r === 'communication/bot') {
      for (const t of ['connexion', 'salons', 'mentions', 'annonces', 'mp', 'modeles', 'regles']) {
        if (!(await p.locator(`#bot-tab-${t}`).count())) { H[`${r} [${t}]`] = -1; continue; }
        await p.click(`#bot-tab-${t}`);
        H[`${r} [${t}]`] = await zoneHeight(p);
        if (t === 'regles') {
          for (const s of ['rappels', 'assistance', 'planning']) {
            if (!(await p.locator(`[data-rsub="${s}"]`).count())) continue;
            await p.click(`[data-rsub="${s}"]`);
            H[`${r} [regles/${s}]`] = await zoneHeight(p);
          }
        }
      }
    }
  }
  for (const t of ['profil', 'infos', 'ss', 'irl', 'photos', 'contrib', 'badges', 'acces']) {
    await goHash(p, `membres/comptes/${U(3)}/${t}`);
    H[`membres/comptes/<Bruno>/${t}`] = await zoneHeight(p);
  }
  const over = Object.entries(H).filter(([r, h]) => h > MAX_H && !EXCEPTIONS[r]);
  const missing = Object.entries(H).filter(([, h]) => h < 0).map(([r]) => r);
  console.log('       hauteurs : ' + Object.entries(H).map(([r, h]) => `${r}=${h}`).join(' · '));
  check(!over.length, `(c) garde de longueur : tous les onglets ≤ ${MAX_H} px${over.length ? ' — trop longs : ' + over.map(([r, h]) => `${r} (${h})`).join(', ') : ''}`);
  check(!missing.length, `(c) onglets du Bot tous mesurés${missing.length ? ' — absents : ' + missing.join(', ') : ''}`);
  for (const r of Object.keys(EXCEPTIONS)) console.log(`       exception : ${r} = ${H[r]} px (${EXCEPTIONS[r]})`);
  check(p.errs.length === 0, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 5).join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- (d) Staff ['cartes'] ---------- */
  p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: U(2), staff: ['cartes'] } });
  const st = await columnTree(p, 'cartes');
  check(JSON.stringify(st) === JSON.stringify([...TREE.cartes.slice(0, 4), ['Jeux', ['jeux-du-jour', 'bataille']]]),
    `(d) Staff ['cartes'] : titres Catalogue, Économie, Animation, Suivi, Jeux (Jeux du jour et Bataille) (${JSON.stringify(st)})`);
  check(await p.locator('#shell-subs a[href="#cartes/secrets"], #shell-subs a[href="#communication/fil"], #shell-subs a[href="#cartes/questions"], #shell-subs a[href="#cartes/geoguessr"], #shell-subs a[href="#cartes/citations"]').count() === 0,
    '(d) Staff [\'cartes\'] : ni Secrets, ni Fil d’activité, ni Questions du gang, ni GeoGuessr, ni Citations');
  await goHash(p, 'cartes/secrets');
  check(await p.evaluate(() => location.hash) !== '#cartes/secrets' && !(await p.isVisible('#eggs')), '(d) Staff : #cartes/secrets redirigée, section jamais affichée');
  await adminSection(p, 'cartes/limites');
  check(await p.isVisible('#cartes'), '(d) Staff : Économie › Limites s\'ouvre');
  check(p.errs.length === 0, '(d) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 5).join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- (e) Mobile 375 px ---------- */
  p = await openPage(browser, { page: 'admin', width: 375, height: 812 });
  check((await p.$$eval('#shell-tabs .shell-tab', (as) => as.length)) === 6 && await p.isVisible('#shell-tabs'), '(e) 375 px : 6 onglets de domaine en bas');
  check((await p.textContent('#shell-tabs .shell-tab[data-dom="cartes"] .shell-tab-label')).trim() === 'Jeux', '(e) libellé court « Jeux »');
  let hsMax = 0;
  /** Ouvre l'écran d'un domaine par son onglet et attend que sa colonne soit affichée. */
  const domScreen = async (dom) => {
    await p.click(`#shell-tabs .shell-tab[data-dom="${dom}"]`);
    await p.waitForFunction((d) => document.getElementById('shell').dataset.screen === 'domain'
      && !document.querySelector(`[data-dom-subs="${d}"]`)?.hidden, dom, { timeout: 5000 }).catch(() => {});
  };
  for (const dom of Object.keys(TREE)) {
    await domScreen(dom);
    hsMax = Math.max(hsMax, await hscroll(p));
  }
  await domScreen('cartes');
  const mHeads = await p.$$eval('[data-dom-subs="cartes"] .shell-subhead', (hs) => hs.filter((h) => h.getClientRects().length).map((h) => h.textContent.trim()));
  check(JSON.stringify(mHeads) === JSON.stringify(['Catalogue', 'Économie', 'Animation', 'Suivi', 'Jeux']), `(e) écran du domaine : titres de groupe visibles (${mHeads.join(', ')})`);
  check(hsMax <= 0, `(e) écrans des 6 domaines sans défilement horizontal (${hsMax})`);
  await p.click('#shell-subs a[href="#cartes/recyclage"]');
  await p.waitForFunction(() => location.hash === '#cartes/recyclage', null, { timeout: 5000 }).catch(() => {});
  await sleep(500);
  check(await p.isVisible('#cartes') && await hscroll(p) <= 0, '(e) Économie › Recyclage ouverte sans défilement horizontal');
  check(p.errs.length === 0, '(e) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.slice(0, 5).join(' | ') + ')' : ''));
  await p.ctx.close();

  } catch (e) {
    check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]);
  } finally {
    await browser.close();
  }
  finish();
})();
