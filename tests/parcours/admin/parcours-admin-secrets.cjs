// Parcours : Jeux et cartes › Secrets (admin-eggs.js), sur le faux Supabase.
// (a) valeurs lues dans hg_settings.eggs (récompense absente = valeur par défaut) ;
// (b) valeurs invalides refusées avec message, rien n'est enregistré ;
// (c) enregistrement : seule la clé « eggs » est écrite, clés et récompenses inconnues conservées, date vide = null ;
// (d) « Rétablir les valeurs par défaut » remplit le formulaire sans enregistrer ;
// (e) journal « Qui a trouvé quoi » groupé par membre (lettres comptées ensemble), recherche ;
// (f) Staff « reglages » : formulaire actif, journal remplacé par une explication, aucune lecture de hg_egg_log ;
// (g) Staff « cartes » : pas de sous-section Secrets (si la route est branchée) ; 375 px sans défilement horizontal ; aucune erreur JS.
// La section est ouverte par sa route #fete/secrets si admin.js la branche, sinon montée directement (mountEggsSection).
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours/admin/parcours-admin-secrets.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium } = require('../../lib/harness.cjs');

/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ME = '11111111-1111-4111-8111-111111111111';
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();

/** Réglage « eggs » de départ : quelques valeurs changées, une récompense absente (nuit), des clés inconnues. */
const EGGS = { anniversaire_gang: '08-14', mot_secret: 'SECRETS', note_interne: 'garder',
  recompenses: { konami: 150, logo: 50, humane: 25, jeu404: 5, heure_gang: 13, anniversaire: 100, console: 50, lettres: 200, secousse: 0, rembobine: 25, inconnu: 7 } };
/** Journal : Alice a trouvé 3 secrets (dont 2 parties du jeu 404) et 7 lettres ; Bruno 2 lettres ; Ethan le code. */
const LOG = [
  { user_id: U(2), egg: 'konami', period: 'once', reward: 150, found_at: iso(-10) },
  { user_id: U(2), egg: 'jeu404', period: '2026-10-01', reward: 5, found_at: iso(-9) },
  { user_id: U(2), egg: 'jeu404', period: '2026-10-02', reward: 5, found_at: iso(-8) },
  ...[1, 2, 3, 4, 5, 6, 7].map((n) => ({ user_id: U(2), egg: `lettre_${n}`, period: 'once', reward: 0, found_at: iso(-7 + n / 10) })),
  { user_id: U(2), egg: 'lettres', period: 'once', reward: 200, found_at: iso(-6) },
  { user_id: U(3), egg: 'lettre_1', period: 'once', reward: 0, found_at: iso(-3) },
  { user_id: U(3), egg: 'lettre_4', period: 'once', reward: 0, found_at: iso(-2) },
  { user_id: ME, egg: 'konami', period: 'once', reward: 150, found_at: iso(-1) },
];

/**
 * Ouvre la section Secrets : par sa route si elle existe, sinon en la montant dans la zone principale.
 * @returns {Promise<'route'|'direct'>}
 */
async function openSecrets(p) {
  const routed = await p.locator('a.shell-sub[href="#fete/secrets"]').count();
  if (routed) { await adminSection(p, 'fete/secrets'); await p.waitForSelector('#eggs-root #aeg-form, #eggs-root .empty', { timeout: 8000 }); return 'route'; }
  await p.evaluate(async () => {
    if (!document.querySelector('link[href$="admin-eggs.css"]')) {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/espaces/admin/admin-eggs.css'; document.head.appendChild(l);
    }
    const app = document.querySelector('#app');
    app.innerHTML = '<div id="eggs-root"></div>';
    const m = await import(new URL('assets/espaces/admin/admin-eggs.js', location.href).href);
    await m.mountEggsSection(document.querySelector('#eggs-root'));
  });
  return 'direct';
}

/** Appels d'écriture sur hg_settings notés par le faux client. */
const settingsWrites = (p) => p.evaluate(() => window.__LOG.filter((l) => l[1] === 'hg_settings' && l[0] !== 'select'));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const scenario = { settings: [{ key: 'eggs', value: EGGS }], eggLog: LOG };

  /* (a) Lecture */
  const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario });
  const how = await openSecrets(p);
  console.log(`  (section ouverte : ${how === 'route' ? 'route #fete/secrets' : 'montage direct, route pas encore branchée'})`);
  await p.waitForSelector('#aeg-form', { timeout: 8000 });
  check((await p.inputValue('#aeg-anniv')) === '08-14', '(a) anniversaire lu (08-14)');
  check((await p.inputValue('#aeg-mot')) === 'SECRETS', '(a) mot secret lu');
  check((await p.inputValue('#aeg-r-konami')) === '150', '(a) récompense « konami » lue (150)');
  check((await p.inputValue('#aeg-r-nuit')) === '30', '(a) récompense absente : valeur par défaut (30)');
  check(await p.locator('.aeg-reward').count() === 19, '(a) 19 récompenses (12 secrets d\'origine, dont l\'arcade, et 7 nouveaux secrets)');
  check((await p.textContent('label[for="aeg-r-lettres"]')).includes('Les sept lettres cachées'), '(a) libellés de la page secrète');
  const hs = await p.evaluate(() => document.getElementById('app').scrollHeight);
  check(hs <= 1800, `(a) onglet Réglages : longueur ≤ 1 800 px à 1 280 px (${hs}) : récompenses et bloc Cueillette compris`);
  check((await p.getAttribute('#aeg-tab-reglages', 'aria-selected')) === 'true' && await p.isHidden('#aeg-pan-journal'), '(a) onglet « Réglages » ouvert par défaut');
  check(!(await p.evaluate(() => window.__LOG.some((l) => l[1] === 'hg_egg_log'))), '(a) journal pas encore lu (lecture à l\'ouverture de l\'onglet)');

  /* (b) Valeurs invalides */
  await p.fill('#aeg-anniv', '13-01');
  await p.fill('#aeg-mot', 'ab1');
  await p.fill('#aeg-r-logo', '-4');
  await p.fill('#aeg-r-humane', '2.5');
  await p.click('#aeg-save');
  await p.waitForTimeout(200);
  check(await p.isVisible('[data-err="anniversaire_gang"]') && (await p.textContent('[data-err="anniversaire_gang"]')).includes('mois'), '(b) mois 13 refusé avec message');
  check(await p.isVisible('[data-err="mot_secret"]'), '(b) mot secret « AB1 » refusé');
  check(await p.isVisible('[data-err="r.logo"]') && await p.isVisible('[data-err="r.humane"]'), '(b) récompenses négative et décimale refusées');
  check((await p.getAttribute('#aeg-anniv', 'aria-invalid')) === 'true', '(b) champ marqué aria-invalid');
  check((await p.textContent('#aeg-status')).includes('à corriger'), '(b) message d\'état (aria-live)');
  check((await settingsWrites(p)).length === 0, '(b) rien n\'est enregistré');
  await p.fill('#aeg-anniv', '02-30');
  await p.click('#aeg-save');
  await p.waitForTimeout(150);
  check((await p.textContent('[data-err="anniversaire_gang"]')).includes('30'), '(b) 30 février refusé');

  /* (c) Enregistrement valide */
  await p.fill('#aeg-anniv', '');
  await p.fill('#aeg-mot', 'secrets');
  check((await p.inputValue('#aeg-mot')) === 'SECRETS', '(c) mot secret mis en majuscules pendant la saisie');
  await p.fill('#aeg-r-logo', '60');
  await p.fill('#aeg-r-humane', '0');
  await p.fill('#aeg-r-konami', '200');
  await p.click('#aeg-save');
  await p.waitForFunction(() => document.querySelector('#aeg-status')?.textContent.includes('enregistrés'), null, { timeout: 5000 });
  const writes = await settingsWrites(p);
  check(writes.length === 1 && writes[0][0] === 'upsert' && writes[0][2].key === 'eggs', '(c) une seule écriture : upsert de la clé « eggs »');
  const saved = await p.evaluate(() => window.__DB.hg_settings.find((r) => r.key === 'eggs').value);
  check(saved.anniversaire_gang === null, '(c) date vide enregistrée comme null');
  check(saved.recompenses.konami === 200 && saved.recompenses.logo === 60 && saved.recompenses.humane === 0, '(c) récompenses enregistrées (nombres)');
  check(saved.recompenses.nuit === 30, '(c) récompense absente enregistrée avec sa valeur par défaut');
  check(saved.note_interne === 'garder' && saved.recompenses.inconnu === 7, '(c) clés inconnues conservées');
  check(await p.evaluate(() => window.__DB.hg_settings.some((r) => r.key === 'theme')), '(c) les autres clés ne sont pas touchées');

  /* (d) Valeurs par défaut */
  await p.click('[data-aeg="defaults"]');
  check((await p.inputValue('#aeg-r-konami')) === '100' && (await p.inputValue('#aeg-r-logo')) === '50', '(d) valeurs par défaut remises dans le formulaire');
  check((await p.inputValue('#aeg-anniv')) === '', '(d) anniversaire par défaut : vide');
  check((await settingsWrites(p)).length === 1, '(d) rien n\'est enregistré sans clic sur Enregistrer');

  /* (e) Journal */
  await p.focus('#aeg-tab-reglages');
  await p.keyboard.press('ArrowRight');
  await p.waitForSelector('.aeg-member', { timeout: 5000 });
  check((await p.getAttribute('#aeg-tab-journal', 'aria-selected')) === 'true' && await p.evaluate(() => document.activeElement?.id === 'aeg-tab-journal'), '(e) onglet « Qui a trouvé quoi » au clavier (flèche droite)');
  check(await p.isHidden('#aeg-pan-reglages'), '(e) panneau Réglages masqué');
  const hj = await p.evaluate(() => document.getElementById('app').scrollHeight);
  check(hj <= 1400, `(e) onglet journal : longueur ≤ 1 400 px (${hj})`);
  check(await p.locator('.aeg-member').count() === 3, '(e) 3 membres dans le journal');
  const alice = p.locator(`.aeg-member[data-user="${U(2)}"]`);
  const aliceTxt = await alice.textContent();
  check(aliceTxt.includes('Alice') && aliceTxt.includes('3 secrets'), '(e) Alice : 3 secrets (les 7 lettres comptent pour un)');
  check(aliceTxt.includes('360'), '(e) Alice : 360 Paillettes au total');
  check(aliceTxt.includes('× 2'), '(e) jeu 404 trouvé deux fois (× 2)');
  check((await p.locator('.aeg-member').first().getAttribute('data-user')) === U(2), '(e) le membre qui a le plus de secrets est en tête');
  check((await p.textContent(`.aeg-member[data-user="${U(3)}"]`)).includes('Lettres 2/7'), '(e) Bruno : lettres partielles (2/7)');
  await p.fill('#aeg-search', 'bruno');
  await p.waitForTimeout(400);
  check(await p.locator('.aeg-member').count() === 1, '(e) recherche par pseudo');
  check((await p.textContent('#aeg-search-count')).includes('1 résultat'), '(e) compteur de résultats');
  check(p.errs.length === 0, '(a–e) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* (f) Staff « reglages » */
  const s = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { ...scenario, uid: U(4), staff: ['reglages'] } });
  await openSecrets(s);
  await s.waitForSelector('#aeg-form', { timeout: 8000 });
  check(!(await s.isDisabled('#aeg-r-konami')) && await s.isVisible('#aeg-save'), '(f) Staff « reglages » : formulaire actif');
  await s.click('#aeg-tab-journal');
  check((await s.textContent('#aeg-log')).includes('réservé à l’administrateur'), '(f) journal remplacé par une explication');
  await s.click('#aeg-tab-reglages');
  check(await s.locator('.aeg-member').count() === 0, '(f) aucun membre affiché');
  check(!(await s.evaluate(() => window.__LOG.some((l) => l[1] === 'hg_egg_log'))), '(f) aucune lecture de hg_egg_log');
  await s.fill('#aeg-r-nuit', '45');
  await s.click('#aeg-save');
  await s.waitForFunction(() => document.querySelector('#aeg-status')?.textContent.includes('enregistrés'), null, { timeout: 5000 });
  check((await s.evaluate(() => window.__DB.hg_settings.find((r) => r.key === 'eggs').value.recompenses.nuit)) === 45, '(f) Staff « reglages » : enregistrement possible');
  check(s.errs.length === 0, '(f) aucune erreur JS' + (s.errs.length ? ' : ' + s.errs.join(' | ') : ''));
  await s.ctx.close();

  /* (g) Staff « cartes » ; mobile */
  const c = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: U(4), staff: ['cartes'] } });
  if (how === 'route') check(await c.locator('a.shell-sub[href="#fete/secrets"]').count() === 0, '(g) Staff « cartes » : pas de sous-section Secrets');
  else console.log('  (g) route #fete/secrets non branchée : contrôle du Staff « cartes » laissé au paquet A');
  await c.ctx.close();
  const m = await openPage(browser, { page: 'admin', width: 375, height: 800, scenario });
  await openSecrets(m);
  check((await hscroll(m)) <= 0, '(g) 375 px, réglages : pas de défilement horizontal');
  await m.click('#aeg-tab-journal');
  await m.waitForSelector('.aeg-member', { timeout: 8000 });
  check((await hscroll(m)) <= 0, '(g) 375 px : pas de défilement horizontal');
  const small = await m.evaluate(() => [...document.querySelectorAll('#eggs-root button, #eggs-root input')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 44).map((el) => el.id || el.textContent.trim()));
  check(small.length === 0, '(g) cibles ≥ 44 px' + (small.length ? ' : ' + small.join(', ') : ''));
  check(m.errs.length === 0, '(g) aucune erreur JS (mobile)' + (m.errs.length ? ' : ' + m.errs.join(' | ') : ''));
  await m.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
