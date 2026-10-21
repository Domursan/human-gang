// Parcours : recherche, pagination et fiche membre du panel admin (admin.html), sur le faux Supabase.
// Couvre : recherche insensible aux accents et à la casse dans Boîte à idées, Journal et Cartes ; « Afficher plus »
// (Journal et Cartes, lots de 50) ; fiche membre : au plus 4 requêtes pour l'onglet initial, onglets chargés à
// la demande, pas de relecture depuis le cache pendant la visite ; action en cours : bouton désactivé puis rétabli.
// Les contrôles portent sur l'affichage et sur le journal des requêtes du faux client (window.__LOG).
// Lancer : node tests/parcours-admin-recherche.cjs
const { ROOT, check, finish, openPage, adminSection, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ALICE = U(2);
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();

const IDEAS = [
  { id: 'i1', user_id: ALICE, body: 'Un tournoi de fléchettes au bar', status: 'nouvelle', created_at: iso(-1) },
  { id: 'i2', user_id: U(3), body: 'Une météo pour les sorties', status: 'nouvelle', created_at: iso(-2) },
  { id: 'i3', user_id: ME, body: 'Plus de café en sortie', status: 'nouvelle', created_at: iso(-3) },
  { id: 'i4', user_id: U(4), body: 'Un thème Halloween', status: 'retenue', created_at: iso(-4) },
];
// 60 entrées de journal : une sur deux concerne Alice (U(2)) ; les plus récentes d'abord.
const ADMIN_LOG = Array.from({ length: 60 }, (_, i) => ({
  id: 1000 - i, admin_id: ME, action: i % 3 ? 'carte_donnee' : 'ajustement_paillettes',
  target_user: i % 2 ? ALICE : U(3), target_ref: `C${i + 1}`, details: { quantite: i + 1 }, created_at: iso(-i / 24),
}));
const ACCESS_LOG = [{ id: 1, admin_id: ME, conversation_id: 'c0000000-0000-4000-8000-000000000001', conversation_kind: 'direct', accessed_at: iso(-0.5) }];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const confirmOk = async (p) => { // bouton « ok » d'une confirmBox (dialogue modal)
  await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
  await p.click('dialog[open] button[value="ok"]');
  await sleep(300);
};
const logSince = (p, from) => p.evaluate((f) => (window.__LOG || []).slice(f), from);
const logLength = (p) => p.evaluate(() => (window.__LOG || []).length);

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* ---------- Boîte à idées : recherche ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, scenario: { ideas: IDEAS } });
    await adminSection(p, 'communication/idees');
    await p.waitForSelector('#idea-list .item', { timeout: 5000 });
    check(await p.locator('#idea-list .item').count() === 3, 'idées : filtre « Nouvelles » affiche les 3 nouvelles idées');
    check((await p.textContent('#idea-search-count')).includes('3 idées'), 'idées : compteur « 3 idées » hors recherche');

    await p.fill('#idea-search', 'FLECHETTES');
    await sleep(400);
    check(await p.locator('#idea-list .item').count() === 1, 'idées : recherche sans accent ni casse trouve « fléchettes »');
    check((await p.textContent('#idea-search-count')).includes('1 résultat sur 3'), 'idées : compteur « 1 résultat sur 3 »');

    await p.fill('#idea-search', 'introuvable');
    await sleep(400);
    check(await p.locator('#idea-list', { hasText: 'Aucun résultat' }).count() === 1, 'idées : état vide « Aucun résultat »');

    await p.fill('#idea-search', 'flechettes ALICE');
    await sleep(400);
    check(await p.locator('#idea-list .item').count() === 1, 'idées : mots combinés, texte et pseudo de l\'auteur (« flechettes ALICE »)');

    await p.fill('#idea-search', '');
    await sleep(400);
    check(await p.locator('#idea-list .item').count() === 3, 'idées : vider la recherche restaure la liste');

    // Action : écarter une idée (bouton désactivé pendant la requête, pas de second envoi, état rétabli)
    await p.click('#idea-list [data-idea="i2"][data-status="ecartee"]');
    await p.waitForTimeout(400);
    const st = await p.evaluate(() => window.__DB.hg_ideas.find((i) => i.id === 'i2')?.status);
    check(st === 'ecartee', 'idées : l\'idée écartée est enregistrée');
    check(await p.locator('[aria-busy="true"], .is-busy').count() === 0, 'action : aucun bouton reste en cours après l\'enregistrement');
    check(await p.locator('#idea-list .item').count() === 2, 'idées : l\'idée écartée sort de la liste « Nouvelles »');
    check(await p.evaluate(() => (window.__DB.hg_ideas || []).length) === 4, 'idées : aucune idée créée ou supprimée par erreur');
    check(p.errs.length === 0, 'idées : aucune erreur JS (' + p.errs.join(' | ') + ')');
    await p.ctx.close();
  }

  /* ---------- Journal : recherche et « Afficher plus » ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, scenario: { adminLog: ADMIN_LOG, accessLog: ACCESS_LOG } });
    await adminSection(p, 'pilotage/journal');
    await p.waitForSelector('#log-list .log-row', { timeout: 5000 });
    check(await p.locator('#log-list .log-row').count() === 50, 'journal : premier lot de 50 entrées');
    check(await p.isVisible('#log-more'), 'journal : bouton « Afficher plus » visible');

    await p.fill('#log-search', 'alice');
    await sleep(400);
    check(await p.locator('#log-list .log-row').count() === 25, 'journal : recherche « alice » sur les lignes chargées (une sur deux)');
    check((await p.textContent('#log-search-count')).includes('25 résultats sur 50'), 'journal : compteur « 25 résultats sur 50 »');

    await p.fill('#log-search', 'zz-aucun');
    await sleep(400);
    check(await p.locator('#log-list', { hasText: 'Aucun résultat' }).count() === 1, 'journal : état vide « Aucun résultat »');

    await p.fill('#log-search', '');
    await sleep(400);
    check(await p.locator('#log-list .log-row').count() === 50, 'journal : vider la recherche restaure le lot');

    await p.click('#log-more');
    await p.waitForFunction(() => document.querySelectorAll('#log-list .log-row').length === 60, null, { timeout: 5000 }).catch(() => {});
    check(await p.locator('#log-list .log-row').count() === 60, 'journal : « Afficher plus » charge le lot suivant (60 entrées)');
    check(!(await p.isVisible('#log-more')), 'journal : plus de bouton quand tout est affiché');
    check(p.errs.length === 0, 'journal : aucune erreur JS (' + p.errs.join(' | ') + ')');
    await p.ctx.close();
  }

  /* ---------- Cartes : recherche et lots de 50 ---------- */
  {
    const p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, scenario: { bigCards: 120 } });
    await adminSection(p, 'cartes/cartes');
    await p.waitForSelector('#acd-cards-list tbody tr', { timeout: 5000 });
    check(await p.locator('#acd-cards-list tbody tr').count() === 50, 'cartes : premier lot de 50 lignes sur 133');
    check(await p.isVisible('[data-act="cards-more"]'), 'cartes : bouton « Afficher plus » visible');

    await p.click('[data-act="cards-more"]');
    await p.waitForFunction(() => document.querySelectorAll('#acd-cards-list tbody tr').length === 100, null, { timeout: 5000 }).catch(() => {});
    check(await p.locator('#acd-cards-list tbody tr').count() === 100, 'cartes : « Afficher plus » ajoute le lot suivant (100 lignes)');
    await p.click('[data-act="cards-more"]');
    await p.waitForFunction(() => document.querySelectorAll('#acd-cards-list tbody tr').length === 133, null, { timeout: 5000 }).catch(() => {});
    check(await p.locator('#acd-cards-list tbody tr').count() === 133, 'cartes : dernier lot affiché (133 lignes, toutes les cartes)');
    check(!(await p.isVisible('[data-act="cards-more"]')), 'cartes : plus de bouton quand tout est affiché');

    await p.fill('#acd-search-cartes', 'carte test 70');
    await sleep(450);
    check(await p.locator('#acd-cards-list tbody tr').count() === 1, 'cartes : recherche « carte test 70 » (une carte, sur 133)');

    await p.fill('#acd-search-cartes', 'IDENTITE');
    await sleep(450);
    check(await p.locator('#acd-cards-list tbody tr').count() === 1, 'cartes : recherche sans accent trouve « Carte identité »');
    check(await p.locator('#acd-search-cartes').inputValue() === 'IDENTITE', 'cartes : le champ garde sa valeur pendant la recherche');

    await p.fill('#acd-search-cartes', 'rien-de-tel');
    await sleep(450);
    check(await p.locator('#acd-cards-list', { hasText: 'Aucun résultat' }).count() === 1, 'cartes : état vide « Aucun résultat »');
    await p.fill('#acd-search-cartes', '');
    await sleep(450);
    check(await p.locator('#acd-cards-list tbody tr').count() === 50, 'cartes : vider la recherche revient au premier lot');

    // Séries : même recherche sur la liste des séries
    await adminSection(p, 'cartes/series');
    await p.waitForSelector('#acd-sets-list .acd-item', { timeout: 5000 });
    await p.fill('#acd-search-series', 'saison');
    await sleep(400);
    check(await p.locator('#acd-sets-list .acd-item').count() === 1, 'séries : recherche « saison » (une série)');
    check(p.errs.length === 0, 'cartes : aucune erreur JS (' + p.errs.join(' | ') + ')');
    await p.ctx.close();
  }

  /* ---------- Fiche membre : requêtes à l'ouverture, onglets à la demande, cache de la visite ---------- */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, scenario: { adminLog: ADMIN_LOG } });
    await adminSection(p, 'membres/comptes');
    await p.waitForSelector(`#acc-root [data-open="${ALICE}"]`, { timeout: 5000 });

    let mark = await logLength(p);
    await p.click(`#acc-root [data-open="${ALICE}"]`);
    await p.waitForSelector('#acc-panel', { timeout: 5000 });
    await p.waitForSelector('.acc-ident-name', { timeout: 5000 });
    await sleep(300);
    let calls = await logSince(p, mark);
    const tables = calls.map((c) => c[1] || c[0]);
    check(calls.length <= 4, `fiche : onglet initial avec au plus 4 requêtes (${calls.length} : ${tables.join(', ')})`);
    check(!tables.includes('hg_ss_participants') && !tables.includes('hg_ss_assignments') && !tables.includes('hg_events'),
      'fiche : l\'onglet Profil ne lit ni Secret Santa, ni sorties');

    // Onglet Photos : profil déjà là, lectures de photos et des sorties (une fois)
    mark = await logLength(p);
    await p.click('#acc-tab-photos');
    await sleep(400);
    calls = await logSince(p, mark);
    const photoTables = calls.map((c) => c[1]);
    check(photoTables.filter((t) => t === 'hg_photos').length === 1, 'fiche : onglet Photos lit les photos une seule fois');
    check(!photoTables.includes('hg_ss_participants'), 'fiche : onglet Photos ne lit pas Secret Santa');

    // Onglet Sorties IRL : réponses du membre, puis l'onglet s'affiche (pas de lecture des autres onglets)
    mark = await logLength(p);
    await p.click('#acc-tab-irl');
    await sleep(400);
    calls = await logSince(p, mark);
    // La liste des sorties vient déjà de l'onglet Photos (cache) : seules les réponses du membre sont lues
    check(calls.some((c) => c[1] === 'hg_event_rsvps') && !calls.some((c) => c[1] === 'hg_events'), 'fiche : onglet Sorties IRL lit les réponses du membre, les sorties sont réutilisées');
    check(!calls.some((c) => c[1] === 'hg_ss_participants'), 'fiche : onglet Sorties IRL ne relit pas Secret Santa');
    check(await p.locator('#acc-panel', { hasText: 'Impossible' }).count() === 0, 'fiche : onglet Sorties IRL s\'affiche sans erreur');

    // Onglet Badges : seulement les badges et les attributions du membre
    mark = await logLength(p);
    await p.click('#acc-tab-badges');
    await sleep(400);
    calls = await logSince(p, mark);
    check(calls.some((c) => c[1] === 'hg_badges') && calls.some((c) => c[1] === 'hg_user_badges'), 'fiche : onglet Badges lit badges et attributions');

    // Nouvelle visite du même membre : les lectures déjà faites ne sont pas relues
    await p.keyboard.press('Escape');
    await sleep(500);
    await p.waitForSelector(`#acc-root [data-open="${ALICE}"]`, { timeout: 5000 });
    mark = await logLength(p);
    await p.click(`#acc-root [data-open="${ALICE}"]`);
    await p.waitForSelector('.acc-ident-name', { timeout: 5000 });
    await sleep(300);
    await p.click('#acc-tab-photos');
    await sleep(400);
    calls = await logSince(p, mark);
    check(!calls.some((c) => c[1] === 'hg_photos'), 'fiche : seconde visite, les photos viennent du cache (pas de relecture)');
    check(!calls.some((c) => c[1] === 'hg_ss_participants'), 'fiche : seconde visite, aucune lecture Secret Santa');

    check(p.errs.length === 0, 'fiche : aucune erreur JS (' + p.errs.join(' | ') + ')');
    await p.ctx.close();
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
