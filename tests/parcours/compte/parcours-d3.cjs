// Parcours D3 (et administration de V8 / V9) : panel admin et compte.
// Couvre : Communication › Commandes slash (quatre interrupteurs, couper /carte enregistre, Staff sans droit « bot » sans la
// sous-section) ; Vie du gang › Calendrier et ciné (rendez-vous récurrents listés, retrait après confirmation, réglage du
// ciné-club : seuil hors bornes refusé, projectionniste enregistré) ; Mon compte : ligne « Commandes Discord disponibles »
// quand l'ID Discord est enregistré ; aucune erreur console.
// Les commandes elles-mêmes (signature, rejeu, boutons) sont testées par tests/check-hg-discord.mjs.
// Lancer : node tests/parcours/compte/parcours-d3.cjs (à travers le verrou commun des tests navigateur).
const { check, finish, openPage, adminSection, hscroll, sleep, chromium } = require('../../lib/harness.cjs');

const vd = (p, fn, a) => p.evaluate(fn, a);
const U2 = '00000002-0000-4000-8000-000000000002';

(async () => {
  const browser = await chromium.launch();

  /* ---------- Admin ---------- */
  let p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-vd.mjs', width: 1280 });
  await adminSection(p, 'poste/commandes');
  await p.waitForSelector('#commandes-root [data-cmd]', { timeout: 6000 });
  check(await p.locator('#commandes-root [data-cmd]').count() === 4, 'quatre interrupteurs de commande');
  check(await p.locator('#commandes-root [data-cmd][role="switch"]:checked').count() === 4, 'toutes actives par défaut');
  await p.uncheck('#commandes-root [data-cmd="carte"]');
  await sleep(300);
  check(await vd(p, () => window.__VD.commands.carte === false), '/carte coupée et enregistrée');

  await adminSection(p, 'fete/rdv');
  await p.waitForSelector('#rdv-root .avd-row', { timeout: 6000 });
  check(await p.locator('#rdv-root .avd-row').count() === 2, 'deux rendez-vous récurrents listés');
  await p.fill('#avd-seuil', '50');
  await p.click('#avd-cine [type="submit"]');
  await sleep(300);
  check(/1 à 20/.test(await p.textContent('#avd-cine .avd-err')), 'seuil hors bornes refusé avec message');
  await p.fill('#avd-seuil', '3');
  await p.check(`#avd-cine input[name="host"][value="${U2}"]`);
  await p.click('#avd-cine [type="submit"]');
  await sleep(300);
  check(await vd(p, () => window.__VD.cfg.seuil === 3 && window.__VD.cfg.host_ids.length === 1), 'réglage du ciné-club enregistré');
  await p.click('#rdv-root [data-avd="archive"] >> nth=0');
  await p.waitForSelector('dialog.hg-dialog[open]');
  await p.click('dialog.hg-dialog[open] .dialog-actions .btn:last-child');
  await sleep(500);
  check(await vd(p, () => window.__VD.slots.filter((s) => s.archived_at).length === 1), 'rendez-vous retiré après confirmation');
  check(await p.locator('#rdv-root .avd-row').count() === 1, 'liste mise à jour');
  check(p.errs.length === 0, 'admin : aucune erreur console' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Staff « cartes » seulement : ni commandes, ni calendrier ---------- */
  p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-vd.mjs', scenario: { uid: U2, staff: ['cartes'] }, width: 1280 });
  await sleep(500);
  check(await p.locator('.shell-sub[href="#poste/commandes"]').count() === 0, 'Staff sans « bot » : pas de Commandes slash');
  check(await p.locator('.shell-sub[href="#fete/rdv"]').count() === 0, 'Staff sans « evenements » : pas de Calendrier et ciné');
  await p.ctx.close();

  /* ---------- Mon compte (360 px) ---------- */
  p = await openPage(browser, { page: 'compte', fixture: 'fake-sb-vd.mjs', scenario: { discord: true }, width: 360, height: 780 });
  await p.waitForSelector('#pf-discord', { timeout: 6000 });
  check(await p.locator('text=Commandes Discord disponibles').count() === 1, 'compte : ligne « Commandes Discord disponibles » quand l’ID est enregistré');
  check(await p.locator('a[href="/pages/infos/aide.html#commandes-discord"]').count() === 1, 'compte : lien vers le tuto des commandes');
  check(p.errs.length === 0, 'compte : aucune erreur console' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  check(await hscroll(p) <= 0, 'compte 360 px : pas de défilement horizontal');
  await p.ctx.close();

  await browser.close();
  finish();
})();
