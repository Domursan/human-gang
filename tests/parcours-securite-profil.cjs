// Parcours : correctifs de sécurité des profils (migration 073).
// (a) Mon compte : l'ID Discord est en lecture seule (« demande au Staff »), l'enregistrement du profil ne l'envoie plus.
// (b) Inscription : un pseudo réservé à un fantôme (refus de hg_join) affiche le message de la base.
// (c) Staff « membres » sur la fiche de l'admin : formulaire Profil désactivé, aucune écriture.
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-securite-profil.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ME = '11111111-1111-4111-8111-111111111111';
const RESERVE = 'Ce pseudo est réservé : demande ton lien personnel au Staff.';

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Mon compte, membre Alice */
  {
    const p = await openPage(browser, { page: 'compte', width: 360, height: 800, scenario: { uid: U(2) } });
    await p.waitForSelector('#pf-discord', { timeout: 8000 }).catch(() => {});
    check(await p.isVisible('#pf-discord'), '(a) champ ID Discord affiché');
    check(await p.getAttribute('#pf-discord', 'readonly') !== null, '(a) ID Discord en lecture seule');
    check(await p.locator('#pf-discord-hint a[href="assistance.html"]').count() === 1, '(a) lien « demande au Staff » vers l’assistance');
    await p.fill('#pf-pseudo', 'Alice B');
    await p.click('#profile-form button[type=submit]');
    await p.waitForTimeout(600);
    const upd = (await log(p)).filter((l) => l[0] === 'update' && l[1] === 'hg_profiles');
    check(upd.length === 1 && upd[0][2] && upd[0][2].pseudo === 'Alice B', '(a) profil enregistré (pseudo)');
    check(upd.length === 1 && !('discord_id' in (upd[0][2] || {})), '(a) l’ID Discord n’est plus envoyé');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '(a) 360 px : pas de défilement horizontal');
    check(!p.errs.length, '(a) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Inscription : connecté sans profil, pseudo réservé */
  {
    const p = await openPage(browser, { page: 'compte', scenario: { uid: 'abcdef00-0000-4000-8000-000000000099', joinError: RESERVE } });
    await p.waitForSelector('#join-form', { timeout: 8000 }).catch(() => {});
    check(await p.isVisible('#join-form'), '(b) écran « Rejoindre le gang »');
    await p.fill('#jn-code', 'HG-ABC123');
    await p.fill('#jn-pseudo', 'Léa');
    await p.check('#jn-privacy');
    await p.click('#join-form button[type=submit]');
    await p.waitForSelector('#join-form .form-error:not([hidden])', { timeout: 5000 }).catch(() => {});
    const err = await p.textContent('#join-form .form-error').catch(() => '');
    check(err.includes('Ce pseudo est réservé') && err.includes('lien personnel'), '(b) message « pseudo réservé, demande ton lien personnel »');
    check((await log(p)).some((l) => l[0] === 'rpc' && l[1] === 'hg_join'), '(b) hg_join appelé');
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Staff « membres » sur la fiche de l'admin */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, scenario: { uid: U(3), staff: ['membres'] }, hash: `#place/comptes/${ME}` });
    await p.waitForSelector('#acc-tab-profil', { timeout: 8000 }).catch(() => {});
    await p.click('[data-tab="profil"]').catch(() => {});
    await p.waitForSelector('form[data-form="profile"]', { timeout: 5000 }).catch(() => {});
    check(await p.locator('form[data-form="profile"] fieldset.acc-lock[disabled]').count() === 1, '(c) profil de l’admin : formulaire désactivé pour le Staff');
    check(/seul un admin peut le modifier/i.test(await p.textContent('form[data-form="profile"]').catch(() => '')), '(c) mention « seul un admin peut le modifier »');
    check(!(await log(p)).some((l) => l[0] === 'update' && l[1] === 'hg_profiles'), '(c) aucune écriture');
    check(!p.errs.length, '(c) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (d) Admin sur la fiche d'un membre : formulaire actif */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900, hash: `#place/comptes/${U(2)}` });
    await p.waitForSelector('[data-tab="profil"]', { timeout: 8000 }).catch(() => {});
    await p.click('[data-tab="profil"]').catch(() => {});
    await p.waitForSelector('form[data-form="profile"]', { timeout: 5000 }).catch(() => {});
    check(await p.locator('form[data-form="profile"] fieldset.acc-lock:not([disabled])').count() === 1, '(d) admin : formulaire Profil actif');
    check(!p.errs.length, '(d) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
