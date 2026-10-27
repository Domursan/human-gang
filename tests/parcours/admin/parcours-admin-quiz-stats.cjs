// Parcours : onglet « Réponses et statistiques » des Questions du gang (assets/espaces/admin/admin-quiz-stats.js).
// Page de test : fixtures/quiz-stats-test.html ; faux Supabase : fixtures/fake-sb-quiz.mjs (données de démonstration :
// 5 questions, 23 réponses dont 5 libres en attente). Les attendus sont calculés à partir de ces données (window.__QUIZ).
// Contrôles : tuiles, synthèse, validation d'une réponse en attente, détail d'une question, tri du tableau, export CSV,
// états vides et erreurs, pas de défilement horizontal à 390 px, aucune erreur JS.
// Lancer : node tests/parcours/admin/parcours-admin-quiz-stats.cjs
const { check, finish, openPage, hscroll, log, chromium } = require('../../lib/harness.cjs');

const PAGE = 'tests/fixtures/quiz-stats-test';
const FIXTURE = 'fake-sb-quiz.mjs';
/** Texte d'un élément, espaces réduits ; '' s'il n'existe pas. */
const texte = (p, sel) => p.locator(sel).first().textContent().then((t) => (t || '').replace(/\s+/g, ' ').trim(), () => '');
/** Chiffres seulement (« 1’500 » -> 1500). */
const chiffres = (t) => Number(String(t).replace(/\D/g, ''));
/** Valeur d'une tuile du résumé (data-stat). */
const tuile = (p, id) => texte(p, `[data-stat="${id}"] .qs-tile-value`);
/** Attend que l'onglet soit affiché (une tuile au moins). */
const attendreOnglet = (p) => p.waitForSelector('[data-stat="pending"]', { timeout: 8000 });
/** Journal des appels RPC portant ce nom. */
const appels = async (p, nom) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === nom).map((e) => e[2]);

(async () => {
  console.log('Racine testée : ' + require('../../lib/harness.cjs').ROOT);
  const browser = await chromium.launch();

  // Attendus : calculés depuis les données de démonstration, pas écrits en dur.
  let p = await openPage(browser, { page: PAGE, fixture: FIXTURE, width: 1280, height: 900 });
  const D = await p.evaluate(() => window.__QUIZ);
  const reponses = D.answers;
  const attendu = {
    questions: D.questions.length,
    ouvertes: D.questions.filter((q) => q.active && new Date(q.starts_at) <= Date.now() && (!q.ends_at || new Date(q.ends_at) > Date.now())).length,
    reponses: reponses.length,
    justes: reponses.filter((r) => r.is_correct === true).length,
    fausses: reponses.filter((r) => r.is_correct === false).length,
    attente: reponses.filter((r) => r.is_correct === null).length,
    joueurs: new Set(reponses.map((r) => r.user_id)).size,
    paillettes: reponses.reduce((s, r) => s + (r.reward || 0), 0),
  };
  attendu.taux = Math.round((100 * attendu.justes) / (attendu.justes + attendu.fausses));
  const idQ3 = D.questions.find((q) => q.id === 'q3').id;
  const idQ4 = D.questions.find((q) => q.id === 'q4').id;

  // 1. Affichage : tuiles, à valider, difficulté, tableau, classement, synthèse.
  await attendreOnglet(p);
  check(!p.errs.length, '1280 px : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  check((await tuile(p, 'questions')) === String(attendu.questions), `tuile Questions = ${attendu.questions}`);
  check((await texte(p, '[data-stat="questions"] .qs-tile-sub')).startsWith(`${attendu.ouvertes} ouvertes`), `tuile Questions : ${attendu.ouvertes} ouvertes`);
  check((await tuile(p, 'answers')) === String(attendu.reponses), `tuile Réponses = ${attendu.reponses}`);
  check((await tuile(p, 'rate')).startsWith(String(attendu.taux)), `tuile Taux de réussite = ${attendu.taux} % sur les réponses corrigées`);
  check(chiffres(await tuile(p, 'players')) === attendu.joueurs, `tuile Joueurs = ${attendu.joueurs}`);
  check(chiffres(await tuile(p, 'paillettes')) === attendu.paillettes, `tuile Paillettes versées = ${attendu.paillettes}`);
  check((await p.locator('[data-stat="pending"]').getAttribute('class')).includes('is-alert'), 'tuile En attente mise en avant (réponses à valider)');
  check((await p.locator('.qs-pend').count()) === attendu.attente, `à valider : ${attendu.attente} réponses libres listées`);
  check((await p.locator('.qs-bar').count()) === 4, 'par difficulté : 4 barres');
  check((await texte(p, '.qs-bar').then((t) => t)).length > 0, 'par difficulté : barres avec texte lisible');
  check((await p.locator('.qs-table').first().locator('tbody [data-q]').count()) === attendu.questions, `par question : ${attendu.questions} lignes`);
  check((await p.locator('.qs-table').last().locator('tbody tr').count()) === attendu.joueurs, `classement : ${attendu.joueurs} membres`);
  const synthese = await p.locator('.qs-synth li').allTextContents();
  check(synthese.length >= 3 && synthese.length <= 5, `synthèse : entre 3 et 5 phrases (${synthese.length} affichées)`);
  check(synthese.some((t) => t.includes(`${attendu.attente} réponses attendent ta validation`)), 'synthèse : phrase « réponses attendent ta validation »');
  check(synthese.some((t) => t.startsWith('La question la plus difficile') && t.includes('% de réussite')), 'synthèse : question la plus difficile');
  check(synthese.some((t) => t.includes('Le meilleur joueur : Alice (3 bonnes réponses sur 5)')), 'synthèse : meilleur joueur (Alice, 3 bonnes réponses sur 5)');
  check(synthese.some((t) => t.startsWith('Les questions faciles sont réussies à')), 'synthèse : réussite des questions faciles');
  await p.click('[data-act="refresh"]');
  await p.waitForFunction(() => document.querySelectorAll('[data-act="refresh"]').length === 1 && !document.querySelector('[data-act="refresh"]').disabled, null, { timeout: 5000 });
  check((await appels(p, 'hg_quiz_stats')).length >= 2, 'Actualiser : les statistiques sont relues');

  // 2. Tri du tableau par « Réponses » : d'abord décroissant (défaut), puis croissant, puis décroissant.
  const colonne = () => p.evaluate(() => [...document.querySelector('.qs-table').querySelectorAll('tbody tr')].map((tr) => Number(tr.children[2].firstChild.textContent.replace(/\D/g, ''))));
  const monotone = (v, sens) => v.every((x, i) => i === 0 || (sens > 0 ? v[i - 1] <= x : v[i - 1] >= x));
  check(monotone(await colonne(), -1), 'tri par défaut : réponses décroissantes');
  await p.click('[data-sort="answers"]');
  check((await p.getAttribute('[data-sort="answers"]', 'aria-sort').catch(() => null)) === null, 'tri : contrôle sans attribut aria-sort (l’attribut est sur la cellule)');
  check(await p.evaluate(() => document.querySelector('th[aria-sort] [data-sort="answers"]')?.parentElement.getAttribute('aria-sort') === 'ascending'), 'tri : clic sur Réponses -> croissant (aria-sort)');
  check(monotone(await colonne(), 1), 'tri : colonne croissante');
  await p.click('[data-sort="answers"]');
  check(monotone(await colonne(), -1), 'tri : second clic -> décroissant');

  // 3. Validation d'une réponse libre en attente : Juste, puis Faux. La liste et les tuiles suivent.
  const attenteAvant = attendu.attente;
  await p.locator('.qs-pend [data-juste="1"]').first().click();
  await p.waitForFunction((n) => document.querySelectorAll('.qs-pend').length === n, attenteAvant - 1, { timeout: 5000 });
  const validations = await appels(p, 'hg_quiz_validate');
  check(validations.length === 1 && validations[0].p_correct === true && typeof validations[0].p_answer === 'number', 'validation Juste : hg_quiz_validate(réponse, true) appelée');
  check(chiffres(await tuile(p, 'pending')) === attenteAvant - 1, 'validation Juste : tuile En attente décrémentée');
  check(chiffres(await tuile(p, 'paillettes')) === attendu.paillettes + D.questions.find((q) => q.id === 'q4').reward, 'validation Juste : Paillettes versées mises à jour');
  await p.locator('.qs-pend [data-juste="0"]').first().click();
  await p.waitForFunction((n) => document.querySelectorAll('.qs-pend').length === n, attenteAvant - 2, { timeout: 5000 });
  const validations2 = await appels(p, 'hg_quiz_validate');
  check(validations2.length === 2 && validations2[1].p_correct === false, 'validation Faux : hg_quiz_validate(réponse, false) appelée');
  check(chiffres(await tuile(p, 'answers')) === attendu.reponses, 'validation : le total de réponses ne change pas');
  check(!p.errs.length, 'validation : aucune erreur JS');

  // 4. Détail d'une question à choix multiples : répartition des choix, puis toutes les réponses.
  await p.locator('[data-q]', { hasText: 'cantons' }).click();
  await p.waitForSelector('#qs-detail tbody tr', { timeout: 5000 });
  const barresChoix = await p.locator('#qs-detail .qs-bar-label').allTextContents();
  check(JSON.stringify(barresChoix) === JSON.stringify(['Tessin', 'Valais', 'Grisons', 'Vaud']), 'détail : répartition avec le texte des choix');
  check((await p.locator('#qs-detail .qs-bar-val').first().textContent()).startsWith('2 · 100'), 'détail : Tessin choisi par 2 réponses sur 2 (100 %)');
  check((await p.locator('#qs-detail tbody tr').count()) === 2, 'détail : les 2 réponses de la question sont listées');
  check((await log(p)).some((e) => e[0] === 'rpc' && e[1] === 'hg_quiz_answers_list' && e[2].p_question === idQ3), 'détail : réponses de la question demandées (hg_quiz_answers_list)');
  check(await p.locator('[data-q]', { hasText: 'cantons' }).getAttribute('aria-expanded') === 'true', 'détail : la ligne ouverte est annoncée (aria-expanded)');

  // 5. Détail d'une question libre : réponses les plus fréquentes, regroupées sans accents ni casse.
  await p.locator('[data-q]', { hasText: 'en un mot' }).click();
  await p.waitForSelector('#qs-detail .qs-top li', { timeout: 5000 });
  const top = await p.locator('#qs-detail .qs-top li').allTextContents();
  check(top.length === 4, 'détail libre : 4 formes de réponse distinctes');
  check(top[0].includes('Humane Gang') && /\b2\b/.test(top[0]), 'détail libre : « Humane Gang » et « humane gang » regroupées (2)');
  check(!p.errs.length, 'détail : aucune erreur JS');
  await p.click('[data-act="fermer"]');
  await p.waitForSelector('#qs-detail', { state: 'detached', timeout: 3000 }).catch(() => {});
  check((await p.locator('#qs-detail').count()) === 0, 'détail : fermé');
  check(!!idQ4, 'question libre identifiée');

  // 6. Export CSV : un Blob avec BOM UTF-8, l'en-tête attendu, une ligne par réponse.
  await p.evaluate(() => {
    window.__BLOBS = [];
    const original = URL.createObjectURL;
    URL.createObjectURL = (b) => { window.__BLOBS.push(b); return original.call(URL, b); };
  });
  await p.click('[data-act="export"]');
  await p.waitForFunction(() => (window.__BLOBS || []).length > 0, null, { timeout: 5000 });
  // Lecture des octets bruts : Blob.text() retire le BOM, il faut donc vérifier EF BB BF avant décodage.
  const csv = await p.evaluate(async () => {
    const b = window.__BLOBS[0];
    const o = new Uint8Array(await b.arrayBuffer());
    return { type: b.type, bom: o[0] === 0xef && o[1] === 0xbb && o[2] === 0xbf, texte: new TextDecoder('utf-8').decode(o.slice(3)) };
  });
  check(csv.bom, 'export : BOM UTF-8 en tête (EF BB BF, Excel lit les accents)');
  check(csv.type.startsWith('text/csv'), 'export : type text/csv');
  const lignes = csv.texte.split('\r\n');
  check(lignes[0] === 'Numéro;Question;Type;Difficulté;Membre;Réponse;Résultat;Paillettes;Répondu le;Corrigé le', 'export : en-tête attendu');
  check(lignes.length - 1 === attendu.reponses, `export : ${attendu.reponses} lignes de réponses`);
  check(lignes.some((l) => l.includes('Tessin, Valais, Grisons')), 'export : choix multiples écrits avec leur texte');
  check(!p.errs.length, 'export : aucune erreur JS');
  await p.ctx.close();

  // 7. Mobile 390 px : pas de défilement horizontal de la page, ni d'erreur.
  p = await openPage(browser, { page: PAGE, fixture: FIXTURE, width: 390, height: 844 });
  await attendreOnglet(p);
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal');
  check(!p.errs.length, '390 px : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 8. Aucune question : message d'état vide, pas de tuiles.
  p = await openPage(browser, { page: PAGE, fixture: FIXTURE, width: 1280, height: 900, scenario: { empty: true } });
  await p.waitForSelector('.qs-empty-block, #qs-h-vide', { timeout: 8000 }).catch(() => {});
  check((await p.locator('text=Aucune question pour l’instant').count()) === 1, 'sans question : message « Aucune question pour l’instant »');
  check((await p.locator('[data-stat]').count()) === 0, 'sans question : pas de tuiles');
  check(!p.errs.length, 'sans question : aucune erreur JS');
  await p.ctx.close();

  // 9. Chargement en erreur : message en français, pas d'erreur JS.
  p = await openPage(browser, { page: PAGE, fixture: FIXTURE, width: 1280, height: 900, scenario: { statsError: true } });
  await p.waitForSelector('[role="alert"]', { timeout: 8000 }).catch(() => {});
  check((await texte(p, '[role="alert"]')).includes('Impossible de charger les statistiques'), 'erreur de chargement : message en français');
  check(await p.locator('[data-act="refresh"]').count() === 1, 'erreur de chargement : Actualiser toujours proposé');
  check(!p.errs.length, 'erreur de chargement : aucune erreur JS');
  await p.ctx.close();

  // 10. Validation refusée : la réponse reste dans la liste, un message le dit.
  p = await openPage(browser, { page: PAGE, fixture: FIXTURE, width: 1280, height: 900, scenario: { validateError: true } });
  await attendreOnglet(p);
  await p.locator('.qs-pend [data-juste="1"]').first().click();
  await p.waitForSelector('[role="alert"]', { timeout: 5000 }).catch(() => {});
  check((await texte(p, '[role="alert"]')).includes('Impossible de valider cette réponse'), 'validation refusée : message en français');
  check((await p.locator('.qs-pend').count()) === attendu.attente, 'validation refusée : la réponse reste à valider');
  check(!p.errs.length, 'validation refusée : aucune erreur JS');
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
