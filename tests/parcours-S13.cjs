// Parcours : Mur des citations (citations.html), idée S13.
// Mur des citations validées (les propositions en attente n'y sont pas), filtres par année et par personne,
// réaction, bandeau « On t'a cité » (OK pour le quiz), proposition d'une citation, retrait par la personne citée,
// menu, 360 px sans défilement horizontal, aucune erreur JS.
// Faux Supabase : fixtures/fake-sb-contenus.mjs.
const { SHOTS, check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');
const FX = 'fake-sb-contenus.mjs';

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'citations', fixture: FX, width: 1280 });
  await p.waitForSelector('.qt-note', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.qt-note').count()) === 4, 'mur : 4 citations validées (les propositions en attente n’y sont pas)');
  check(!(await p.locator('#qt-wall').innerText()).includes('Encore une partie'), 'mur : ma proposition en attente n’est pas affichée');
  check((await p.locator('.qt-note').first().innerText()).includes('«'), 'post-it : citation entre guillemets « »');
  check((await p.locator('#qt-filters [data-year="tous"]').innerText()).includes('4'), 'filtre : « Toutes · 4 »');
  await p.click('#qt-filters [data-year="2023"]');
  check((await p.locator('.qt-note').count()) === 1 && (await p.locator('.qt-note').innerText()).includes('Le livre est mieux'), 'filtre année 2023 : une citation');
  check((await p.locator('#qt-filters [data-year="2023"]').getAttribute('aria-pressed')) === 'true', 'filtre : aria-pressed sur l’année choisie');
  await p.click('#qt-filters [data-year="tous"]');
  await p.selectOption('#qt-person', { label: 'Tout le gang' });
  check((await p.locator('.qt-note').count()) === 1 && (await p.locator('.qt-note').innerText()).includes('retard'), 'filtre personne : auteur collectif « Tout le gang »');
  await p.selectOption('#qt-person', '');
  // Réactions
  check((await p.locator('.qt-note').filter({ hasText: 'Le livre est mieux' }).locator('.qt-rx').innerText()).includes('2'), 'réactions : résumé « 😂 2 » sur le post-it');
  const note = p.locator('.qt-note').filter({ hasText: 'Le livre est mieux' });
  await note.locator('[data-react-open]').click();
  check(await note.locator('.qt-bar').isVisible(), 'réagir : la barre de réactions s’ouvre');
  check((await note.locator('[data-react-open]').getAttribute('aria-expanded')) === 'true', 'réagir : aria-expanded à true');
  await note.locator('[data-emoji="❤️"]').click();
  await sleep(300);
  const calls = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_toggle_reaction');
  check(calls.length === 1 && calls[0][2].p_kind === 'quote', 'réaction : hg_toggle_reaction avec la cible « quote »');
  check((await note.locator('.qt-rx').innerText()).includes('1'), 'réaction : le résumé du post-it suit (❤️ 1)');
  // On t'a cité
  check(await p.locator('#qt-cited').isVisible(), 'bandeau « On t’a cité » visible');
  check((await p.locator('#qt-cited').innerText()).includes('Domu-mobile') && (await p.locator('#qt-cited').innerText()).includes('par David'), 'bandeau : citation et auteur de la proposition');
  await p.click('#qt-cited [data-decide="jeu_oui"]');
  await sleep(300);
  const dec = (await log(p)).filter((e) => e[1] === 'hg_quote_author_decide');
  check(dec.length === 1 && dec[0][2].p_action === 'jeu_oui', 'décision : hg_quote_author_decide « jeu_oui »');
  check(await p.locator('#qt-cited').isHidden(), 'bandeau : disparaît une fois la décision prise');
  // Mes propositions : retirer la citation qui me concerne
  await p.locator('#qt-mine-box summary').click();
  check((await p.locator('#qt-mine .qt-mine-row').count()) === 3, 'mes propositions : 3 lignes (2 proposées par moi, 1 qui me cite)');
  check((await p.locator('#qt-mine').innerText()).includes('En attente du Staff'), 'mes propositions : statut « En attente du Staff »');
  await p.locator('#qt-mine [data-decide="retirer"]').first().click();
  await sleep(300);
  check((await p.locator('#qt-mine').innerText()).includes('Refusée'), 'retrait par la personne citée : statut « Refusée »');
  // Proposer
  await p.click('#qt-propose');
  check(await p.locator('dialog.ct-dialog[open]').isVisible(), 'proposer : la boîte de dialogue s’ouvre');
  await p.click('dialog.ct-dialog button[type="submit"]');
  check((await p.locator('.ct-dlg-err').innerText()).includes('Écris la citation'), 'proposer : citation vide refusée avec un message');
  await p.fill('#qp-text', 'On joue à Codenames ce soir ?');
  await p.selectOption('#qp-author', '__label');
  check(await p.locator('#qp-label-f').isVisible(), 'proposer : champ « auteur collectif » quand on le choisit');
  await p.fill('#qp-label', 'Tout le gang');
  await p.fill('#qp-context', 'vocal');
  await p.click('dialog.ct-dialog button[type="submit"]');
  await sleep(400);
  const prop = (await log(p)).filter((e) => e[1] === 'hg_quote_propose');
  check(prop.length === 1 && prop[0][2].p_author === null && prop[0][2].p_author_label === 'Tout le gang' && prop[0][2].p_context === 'vocal', 'proposer : hg_quote_propose avec les bons paramètres');
  check((await p.locator('dialog.ct-dialog[open]').count()) === 0, 'proposer : la boîte se ferme');
  check((await p.locator('.qt-note').count()) === 4, 'proposer : la proposition n’apparaît pas sur le mur avant validation');
  check((await p.locator('.nav a[href="citations.html"]').count()) === 1, 'menu : lien « Citations »');
  check(p.errs.length === 0, 'aucune erreur JS ni 404' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.screenshot({ path: path.join(SHOTS, 'S13-1280.png'), fullPage: true }).catch(() => {});
  await p.ctx.close();

  /* ---------- Téléphone ---------- */
  for (const w of [360, 390]) {
    p = await openPage(browser, { page: 'citations', fixture: FX, width: w, height: 844 });
    await p.waitForSelector('.qt-note', { timeout: 5000 }).catch(() => {});
    check(await hscroll(p) <= 0, `${w} px : pas de défilement horizontal`);
    const small = await p.$$eval('#app button, #app select', (els) => els.filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).length);
    check(small === 0, `${w} px : cibles d’au moins 44 px`);
    await p.screenshot({ path: path.join(SHOTS, `S13-${w}.png`), fullPage: true }).catch(() => {});
    check(p.errs.length === 0, `${w} px : aucune erreur JS` + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
    await p.ctx.close();
  }

  /* ---------- Mur vide ---------- */
  p = await openPage(browser, { page: 'citations', fixture: FX, scenario: { emptyWall: true } });
  await sleep(400);
  check((await p.locator('#qt-wall').innerText()).includes('Propose la première'), 'mur vide : message d’invitation');
  await p.ctx.close();

  await browser.close();
  finish();
})();
