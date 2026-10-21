// Parcours : temps réel du panel admin (assets/js/admin/live.js), sur le faux Supabase (fixtures/fake-sb.mjs).
// (a) admin, temps réel confirmé : indicateur « En direct », abonnements à toutes les tables de ses droits ;
//     une demande émise en direct met à jour le compteur de navigation, les tuiles et la liste ;
//     pendant la saisie (dialogue Staff ouvert) : bandeau « Mises à jour disponibles », liste inchangée, puis « Actualiser » ;
//     coupure du canal : indicateur gris, puis reconnexion et indicateur vert.
// (b) Staff { cartes } : aucun abonnement à hg_support, hg_ideas, hg_staff ni hg_admin_log.
// (c) sans temps réel : indicateur gris « Hors direct », aucune erreur JS, sections inchangées.
// Lancer : node tests/parcours-admin-direct.cjs
const { adminSection, ROOT, check, finish, openPage, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const demande = (id, message) => ({ id, user_id: null, pseudo: 'Bruno', subject: 'Question', message, contact: 'bruno@ex.ch',
  status: 'ouverte', created_at: new Date().toISOString(), discord_sent: false });
const tablesOf = (p) => p.evaluate(() => window.__fakeRealtime.tables());
// Ajoute une ligne à hg_support (fausse base) et émet l'événement temps réel correspondant.
const emettre = (p, row) => p.evaluate((r) => {
  window.__DB.hg_support.push(r);
  window.__fakeRealtime.emit('hg_support', { eventType: 'INSERT', new: r });
}, row);

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Administrateur, temps réel actif */
  {
    const p = await openPage(browser, { page: 'admin', scenario: { realtime: true } });
    await p.waitForSelector('.live-status[data-state="on"]', { timeout: 5000 }).catch(() => {});
    check(await p.getAttribute('.live-status', 'data-state') === 'on', '(a) indicateur « En direct » passé au vert (canal confirmé)');
    check((await p.textContent('.live-status .live-label')).trim() === 'En direct', '(a) l\'indicateur porte un libellé lisible par un lecteur d\'écran');

    const tables = await tablesOf(p);
    const attendues = ['hg_support', 'hg_ideas', 'hg_profiles', 'hg_staff', 'hg_admin_log', 'hg_events', 'hg_moments', 'hg_ss_participants'];
    check(attendues.every((t) => tables.includes(t)), '(a) admin : abonné aux tables de ses droits');
    check(new Set(tables).size === tables.length, '(a) une seule écoute par table (pas de doublon)');

    check(await p.isHidden('.nav-count[data-count="assistance"]'), '(a) avant l\'événement : aucun compteur Assistance');

    await emettre(p, demande('sup-live-1', 'Message reçu en direct'));
    await p.waitForFunction(() => document.querySelector('.nav-count[data-count="assistance"]')?.textContent === '1', null, { timeout: 5000 }).catch(() => {});
    check(await p.isVisible('.nav-count[data-count="assistance"]') && (await p.textContent('.nav-count[data-count="assistance"]')).trim() === '1',
      '(a) événement hg_support : compteur de navigation Assistance mis à jour (1)');
    check((await p.textContent('#stats a[href="#assistance"] .stat-value')).trim() === '1', '(a) événement hg_support : tuile de la vue d\'ensemble mise à jour');
    check((await p.textContent('#support-list')).includes('Message reçu en direct'), '(a) événement hg_support : liste Assistance rafraîchie');

    // Saisie en cours : un dialogue est ouvert dans le panel, la liste ne doit pas être remplacée
    await adminSection(p, 'staff');
    await p.click('#staff [data-staff-add]');
    await p.waitForSelector('#staff-dialog[open]', { timeout: 5000 });
    await emettre(p, demande('sup-live-2', 'Message pendant la saisie'));
    await sleep(1500);
    check(await p.locator('#assistance .live-banner').count() === 1, '(a) dialogue ouvert : bandeau « Mises à jour disponibles » dans Assistance');
    check(!(await p.textContent('#support-list')).includes('Message pendant la saisie'), '(a) dialogue ouvert : la liste n\'est pas remplacée');
    check((await p.textContent('.nav-count[data-count="assistance"]')).trim() === '2', '(a) dialogue ouvert : le compteur de navigation reste à jour');
    await p.keyboard.press('Escape');
    await p.waitForFunction(() => !document.querySelector('dialog[open]'), null, { timeout: 5000 }).catch(() => {});
    await adminSection(p, 'assistance');
    await p.click('#assistance .live-banner button');
    await p.waitForTimeout(300);
    check((await p.textContent('#support-list')).includes('Message pendant la saisie'), '(a) « Actualiser » : la liste est rafraîchie');
    check(await p.locator('#assistance .live-banner').count() === 0, '(a) « Actualiser » : le bandeau disparaît');

    // Coupure du canal : indicateur gris, puis reconnexion automatique
    await p.evaluate(() => window.__fakeRealtime.status('CHANNEL_ERROR'));
    await p.waitForTimeout(200);
    check(await p.getAttribute('.live-status', 'data-state') === 'off', '(a) coupure : indicateur repassé au gris');
    await p.waitForFunction(() => document.querySelector('.live-status')?.dataset.state === 'on', null, { timeout: 8000 }).catch(() => {});
    check(await p.getAttribute('.live-status', 'data-state') === 'on', '(a) reconnexion : indicateur de nouveau vert');
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  /* (b) Staff { cartes } : seulement ses tables */
  {
    const p = await openPage(browser, { page: 'admin', scenario: { uid: U(2), staff: ['cartes'], realtime: true } });
    await p.waitForSelector('.live-status[data-state="on"]', { timeout: 5000 }).catch(() => {});
    const tables = await tablesOf(p);
    check(tables.includes('hg_card_trades'), '(b) Staff cartes : abonné à hg_card_trades');
    check(!['hg_support', 'hg_ideas', 'hg_staff', 'hg_admin_log', 'hg_ss_participants', 'hg_profiles'].some((t) => tables.includes(t)),
      '(b) Staff cartes : aucun abonnement à hg_support, hg_ideas, hg_staff, hg_admin_log, hg_ss_participants ni hg_profiles');
    await emettre(p, demande('sup-hors-droits', 'Hors droits'));
    await sleep(1200);
    check(await p.isHidden('#assistance') && await p.isHidden('.nav-count[data-count="assistance"]'), '(b) Staff cartes : Assistance reste masquée, aucun compteur');
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  /* (c) Sans temps réel : le panel fonctionne, indicateur gris */
  {
    const p = await openPage(browser, { page: 'admin' });
    check(await p.getAttribute('.live-status', 'data-state') === 'off', '(c) sans temps réel : indicateur gris');
    check((await p.textContent('.live-status .live-label')).trim() === 'Hors direct', '(c) sans temps réel : libellé « Hors direct »');
    check(await p.isVisible('#stats') && await p.locator('#stats .stat').count() > 0, '(c) sans temps réel : vue d\'ensemble affichée');
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.context().close();
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
