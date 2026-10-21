// Parcours : drops de cartes (une carte à attraper, les X premiers qui cliquent la gagnent).
// Admin (admin.html › Jeu de cartes › Drops) : lancer un drop (RPC hg_drop_create avec bornes), voir la liste, l'arrêter.
// Membre (toutes les pages) : la carte apparaît (card-drops.js), clic → hg_drop_claim → révélation ; « trop tard » si
// l'exemplaire est parti ; masquage ; pas de carte pour un visiteur ; 390 px sans défilement ; mouvement réduit.
// Faux Supabase : fixtures/fake-sb-cartes.mjs (scenario.drops, scenario.dropLate, scenario.guest).
// Lancer : node tests/parcours-drops.cjs
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const CARD = 'C2'; // « Le Paleto », commune, brillante possible
const iso = (ms) => new Date(Date.now() + ms).toISOString();
const drop = (over = {}) => ({ id: 'dr-1', card_id: CARD, shiny: false, quantity: 1, starts_at: iso(-60e3), ends_at: iso(3600e3),
  announce: true, created_by: ME, ...over });
const rpcCalls = async (p, fn) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === fn).map((e) => e[2]);

(async () => {
  console.log('Racine testée : ' + require('./lib/harness.cjs').ROOT);
  const browser = await chromium.launch();

  /* ---------- Admin ---------- */
  let p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900 });
  await adminSection(p, 'cartes/drops');
  await p.waitForSelector('[data-action="drop-new"]', { timeout: 8000 });
  check((await p.textContent('#drop-list')).includes('Aucun drop'), 'admin : liste vide au départ');

  // Quantité hors bornes : le formulaire refuse, aucun appel
  await p.click('[data-action="drop-new"]');
  await p.waitForSelector('dialog.ui-drawer[open] #drop-card', { timeout: 5000 });
  await p.fill('#drop-q', 'Paleto');
  check(await p.locator('dialog.ui-drawer[open] #drop-card option').count() === 1, 'admin : recherche « Paleto » réduit la liste à 1 carte');
  await p.selectOption('#drop-card', { index: 0 });
  await p.fill('#drop-qty', '60');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await sleep(300);
  check((await rpcCalls(p, 'hg_drop_create')).length === 0, 'admin : 60 exemplaires refusés côté formulaire (aucun appel)');
  await p.fill('#drop-qty', '3');
  await p.fill('#drop-min', '20');
  await p.click('dialog.ui-drawer[open] label:has(#drop-shiny)');
  await p.click('dialog.ui-drawer[open] [data-drawer-submit]');
  await p.waitForSelector('dialog.ui-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
  await sleep(300);
  const created = await rpcCalls(p, 'hg_drop_create');
  check(created.length === 1, 'admin : un seul appel hg_drop_create');
  check(created[0]?.p_card === CARD && created[0]?.p_shiny === true && created[0]?.p_quantity === 3 && created[0]?.p_minutes === 20 && created[0]?.p_announce === true,
    'admin : carte, brillante, 3 exemplaires, 20 minutes, annonce');
  check((await p.textContent('#drop-list')).includes('En cours'), 'admin : le drop apparaît comme en cours');
  check((await p.textContent('#drop-list')).includes('Le Paleto'), 'admin : nom de la carte dans la liste');
  check((await p.textContent('#drop-list')).includes('0 / 3'), 'admin : 0 / 3 attrapés au lancement');

  // Arrêter : confirmation, puis RPC et statut Terminé
  await p.click('[data-action="drop-stop"]');
  await p.waitForSelector('dialog.hg-dialog[open] .btn-danger', { timeout: 5000 });
  await p.click('dialog.hg-dialog[open] .btn-danger');
  await sleep(400);
  const stops = await rpcCalls(p, 'hg_drop_stop');
  check(stops.length === 1 && typeof stops[0]?.p_drop === 'string', 'admin : arrêt → hg_drop_stop appelée une fois');
  check((await p.textContent('#drop-list')).includes('Terminé'), 'admin : le drop arrêté est Terminé');
  check(!p.errs.length, 'admin : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Membre : la carte apparaît, clic = gain ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario: { drops: [drop()] } });
  await p.waitForSelector('.cd-item [data-cd-claim]', { timeout: 8000 }).catch(() => {});
  const claimBtn = await p.$('.cd-item [data-cd-claim]');
  check(!!claimBtn, 'membre : la carte du drop apparaît sur la page');
  if (claimBtn) {
    const label = await claimBtn.getAttribute('aria-label');
    check(label.includes('Le Paleto'), 'membre : la carte est nommée (bouton accessible)');
    check((await p.textContent('.cd-hint')).includes('Dernier exemplaire'), 'membre : « Dernier exemplaire ! » affiché');
    await claimBtn.click({ force: true }); // la carte flotte : clic forcé (pas de contrôle de stabilité)
    await p.waitForSelector('.cd-reveal', { timeout: 5000 }).catch(() => {});
    check((await p.textContent('.cd-reveal-t')).includes('Tu as attrapé « Le Paleto » !'), 'membre : révélation de la carte gagnée');
    const claims = await rpcCalls(p, 'hg_drop_claim');
    check(claims.length === 1 && claims[0]?.p_drop === 'dr-1', 'membre : un seul appel hg_drop_claim pour le bon drop');
    check(await p.$('.cd-item [data-cd-claim]') === null, 'membre : plus de carte à attraper après le gain');
  }
  check(!p.errs.length, 'membre : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Membre : trop tard (l'exemplaire est parti entre-temps) ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900,
    scenario: { drops: [drop({ quantity: 2 })], dropLate: true } });
  await p.waitForSelector('.cd-item [data-cd-claim]', { timeout: 8000 }).catch(() => {});
  await p.click('.cd-item [data-cd-claim]', { force: true }).catch(() => {}); // flottante : clic forcé
  await p.waitForSelector('.cd-item [data-cd-claim]', { state: 'detached', timeout: 5000 }).catch(() => {});
  check(await p.$('.cd-item [data-cd-claim]') === null, 'trop tard : la carte disparaît');
  check((await p.textContent('.toasts')).includes('Trop tard, tous les exemplaires sont partis !'), 'trop tard : message clair affiché');
  check(await p.$('.cd-reveal') === null, 'trop tard : aucune révélation');
  await sleep(1500);
  check(await p.$('.cd-item [data-cd-claim]') === null, 'trop tard : la carte ne revient pas à la mise à jour suivante');
  check(!p.errs.length, 'trop tard : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  /* ---------- Membre : masquer la carte sur la page ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario: { drops: [drop()] } });
  await p.waitForSelector('.cd-item [data-cd-hide]', { timeout: 8000 }).catch(() => {});
  await p.click('.cd-item [data-cd-hide]', { force: true }).catch(() => {});
  await sleep(300);
  check(await p.$('.cd-item') === null, 'masquer : la carte disparaît de la page');
  check((await rpcCalls(p, 'hg_drop_claim')).length === 0, 'masquer : aucun gain enregistré');
  await p.ctx.close();

  /* ---------- Visiteur : aucune carte, aucun appel ---------- */
  p = await openPage(browser, { page: 'index', fixture: 'fake-sb-cartes.mjs', width: 1280, height: 900, scenario: { guest: true, drops: [drop()] } });
  await sleep(2000);
  check(await p.$('.cd-item') === null, 'visiteur : aucune carte de drop');
  check((await rpcCalls(p, 'hg_drops_active')).length === 0, 'visiteur : hg_drops_active jamais appelée');
  await p.ctx.close();

  /* ---------- Mobile 390 px et mouvement réduit : pas de défilement, carte immobile ---------- */
  p = await openPage(browser, { page: 'accueil', fixture: 'fake-sb-cartes.mjs', width: 390, height: 844, reducedMotion: 'reduce',
    scenario: { drops: [drop()] } });
  await p.waitForSelector('.cd-item [data-cd-claim]', { timeout: 8000 }).catch(() => {});
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  const box = await p.$eval('.cd-item [data-cd-claim]', (el) => { const r = el.getBoundingClientRect(); return { right: r.right, left: r.left, w: innerWidth }; }).catch(() => null);
  check(!!box && box.left >= 0 && box.right <= box.w, '390 px : la carte tient dans l\'écran');
  check((await p.$eval('.cd-item', (el) => el.className).catch(() => '')).includes('is-still'), 'mouvement réduit : la carte ne flotte pas');
  check(!p.errs.length, '390 px : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
