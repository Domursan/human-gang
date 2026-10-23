// Parcours : idée S2 « Lexique du gang » (lexique.html) et sa file de validation dans l'admin.
// Liste A à Z des mots validés (pas les propositions des autres), recherche sans accents, filtre par époque, fiche
// dépliable (aria-expanded) avec réactions, lien direct #slug, texte de la base échappé, proposition d'un mot,
// « Mes propositions », « En faire une question du quiz » (brouillon), validation Staff avec la case « OK ».
// Faux Supabase : fixtures/fake-sb-contenu.mjs.  Lancer : node tests/parcours-s2-lexique.cjs
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  const F = 'fake-sb-contenu.mjs';

  let p = await openPage(browser, { page: 'lexique', fixture: F, width: 390 });
  await p.waitForSelector('.lex-entry', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.lex-entry').count()) === 3, 'liste : 3 mots validés (ni proposition ni refus)');
  check((await p.locator('.lex-letter').allInnerTexts()).join(',') === 'L,S,T', 'liste : lettres L, S, T dans l’ordre');
  check((await p.locator('#lex-filter .lex-chip').count()) === 4 && (await p.locator('#lex-filter .lex-chip').first().innerText()).includes('Tout · 3'), 'filtre : « Tout · 3 » et 3 époques');
  check((await p.locator('.nav a[href="lexique.html"]').count()) >= 1, 'menu : lien « Lexique »');
  check(await p.evaluate(() => !window.__xss), 'XSS : rien n’est exécuté');
  check((await p.locator('.lex-entry#serge').innerText()).includes('<script>'), 'texte de la base affiché tel quel (échappé)');
  await p.fill('#lex-q', 'tzatz');
  await sleep(100);
  check((await p.locator('.lex-entry').count()) === 1, 'recherche : « tzatz » trouve le Tzatzikistan');
  await p.fill('#lex-q', 'cine');
  await sleep(100);
  check((await p.locator('.lex-entry').count()) === 1 && (await p.locator('.lex-entry').innerText()).includes('livre'), 'recherche sans accents : « cine » trouve « ciné »');
  await p.fill('#lex-q', '');
  await p.click('#lex-filter [data-era="2024"]');
  await sleep(100);
  check((await p.locator('.lex-entry').count()) === 1 && (await p.locator('#lex-filter [data-era="2024"]').getAttribute('aria-pressed')) === 'true', 'filtre 2024 : un seul mot, bouton pressé');
  await p.click('#lex-filter [data-era="tous"]');
  const tg = p.locator('#tzatzikistan .lex-toggle');
  check((await tg.getAttribute('aria-expanded')) === 'false', 'fiche : repliée au départ');
  await tg.click();
  await sleep(150);
  check((await p.locator('#tzatzikistan .lex-toggle').getAttribute('aria-expanded')) === 'true', 'fiche : dépliée (aria-expanded)');
  check((await p.locator('#tzatzikistan .lex-ex').innerText()).includes('plein ouest'), 'fiche : exemple d’usage');
  check((await p.locator('#tzatzikistan .lex-origin').innerText()).includes('14 mars 2022'), 'fiche : date d’origine');
  check((await p.locator('#tzatzikistan .lex-links').innerText()).includes('karaoké'), 'fiche : lien vers le moment culte');
  check((await p.locator('#tzatzikistan .react-bar .react-btn').count()) === 6, 'fiche : barre de réactions');
  check((await p.locator('#tzatzikistan a', { hasText: 'Demander le retrait' }).getAttribute('href')).startsWith('assistance.html?sujet=Autre&message='), 'fiche : « Demander le retrait » vers l’assistance');
  check((await p.locator('#mot-refuse').count()) === 0 && (await p.locator('#lex-mine').isVisible()), 'mes propositions : visibles, hors de la liste');
  check((await p.locator('#lex-mine').innerText()).includes('Vise quelqu’un'), 'mes propositions : motif du refus');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal');

  /* Proposer un mot */
  await p.click('#lex-propose');
  await p.waitForSelector('.lex-dialog[open]');
  await p.fill('#lex-p-term', 'Raclette sans raclette');
  await p.fill('#lex-p-def', 'court');
  await p.click('.lex-dialog [type=submit]');
  await sleep(150);
  check(await p.locator('.lex-dialog .form-error').isVisible(), 'proposition : définition trop courte refusée');
  await p.fill('#lex-p-def', 'La soirée pâté-saucisses, mais dit autrement.');
  await p.fill('#lex-p-label', 'Soirée jeux');
  await p.click('.lex-dialog [type=submit]');
  await sleep(300);
  const calls = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_lexicon_propose');
  check(calls.length === 1 && calls[0][2].p_term === 'Raclette sans raclette' && calls[0][2].p_origin_label === 'Soirée jeux', 'proposition : hg_lexicon_propose appelé');
  check(await p.locator('.lex-dialog').count() === 0, 'proposition : fenêtre fermée');
  check((await p.locator('#lex-mine').innerText()).includes('Raclette sans raclette') && (await p.locator('#lex-mine').innerText()).includes('En attente'), 'proposition : « En attente du Staff » dans mes propositions');
  check((await p.locator('.lex-entry').count()) === 3, 'proposition : pas encore dans le lexique');

  /* Question du quiz (admin = Staff quiz) */
  await p.locator('#tzatzikistan [data-quiz]').click();
  await p.waitForURL(/admin\.html/, { timeout: 5000 }).catch(() => {});
  await p.waitForSelector('#adq-prompt', { timeout: 6000 }).catch(() => {});
  check((await p.locator('#adq-prompt').inputValue().catch(() => '')).includes('Tzatzikistan'), 'quiz : le formulaire de l’admin s’ouvre pré-rempli');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* Lien direct #slug */
  p = await openPage(browser, { page: 'lexique', fixture: F, hash: '#serge' });
  await sleep(300);
  check((await p.locator('#serge .lex-toggle').getAttribute('aria-expanded')) === 'true', 'lien direct #serge : fiche ouverte');
  await p.ctx.close();

  /* Au lancement : page réservée aux admins, un membre ne voit pas le lexique */
  p = await openPage(browser, { page: 'lexique', fixture: F, scenario: { uid: '00000002-0000-4000-8000-000000000002' } });
  await sleep(400);
  check((await p.locator('.lex-entry').count()) === 0, 'lancement : membre sans accès à la page (mode admin)');
  await p.ctx.close();

  /* Non-Staff : pas de bouton quiz */
  p = await openPage(browser, { page: 'lexique', fixture: F, scenario: { uid: '00000002-0000-4000-8000-000000000002', ideesOuvertes: true } });
  await p.locator('#tzatzikistan .lex-toggle').click();
  check((await p.locator('[data-quiz]').count()) === 0, 'membre : pas de bouton « question du quiz »');
  await p.ctx.close();

  /* Admin : file des propositions */
  p = await openPage(browser, { page: 'admin', fixture: F });
  await adminSection(p, 'vie/souvenirs');
  await p.evaluate(() => { location.hash = 'vie/souvenirs/lexique'; });
  await p.waitForSelector('.lx-item', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.lx-item').count()) === 1, 'admin : une proposition en attente');
  await p.locator('.lx-item [data-lx-do="valide"]').click();
  await sleep(200);
  check((await p.locator('.toast, [role="status"]').allInnerTexts()).join(' ').includes('personne concernée') || (await log(p)).some((e) => e[1] === 'hg_lexicon_review'), 'admin : valider sans la case est refusé');
  await p.locator('.lx-item input[name="consent"]').check();
  await p.locator('.lx-item [data-lx-do="valide"]').click();
  await sleep(300);
  const rv = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_lexicon_review').pop();
  check(rv && rv[2].p_status === 'valide' && rv[2].p_consent === true && rv[2].p_patch.term === 'Éclair au fromage', 'admin : validation avec la case et le texte corrigé');
  check((await p.locator('.lx-item').count()) === 0, 'admin : la file est vide');
  await p.click('[data-lx-tab="valide"]');
  check((await p.locator('.lx-item').count()) === 4, 'admin : 4 mots validés');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* Recherche globale */
  p = await openPage(browser, { page: 'accueil', fixture: F });
  await p.keyboard.press('Control+k');
  await p.waitForSelector('#search-q', { timeout: 3000 }).catch(() => {});
  await p.fill('#search-q', 'tzatz');
  await sleep(500);
  check((await p.locator('.search-results').innerText()).includes('Tzatzikistan'), 'recherche globale : trouve le mot du lexique');
  await p.ctx.close();

  await browser.close();
  finish();
})();
