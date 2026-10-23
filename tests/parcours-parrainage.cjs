// Parcours : parrainage des nouveaux (idée P8, migration 091).
// (a) Accueil du filleul : carte « Semaine d'accueil » (duo, jours restants, 2 étapes sur 4, récompense, « Proposer un échange »).
// (b) 4 étapes faites : « Réclamer ma récompense » (hg_mentor_claim) puis « Récompense reçue ».
// (c) Sans parrainage en cours : aucun bloc. (d) Admin : Membres › Parrainage, attribution par hg_mentor_assign.
// Faux Supabase : fixtures/fake-sb.mjs + fake-sb-social2.mjs. Lancer : node tests/parcours-parrainage.cjs
const { ROOT, check, finish, openPage, adminSection, log, chromium } = require('./lib/harness.cjs');
const errs = (p) => (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : '');

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  {
    const p = await openPage(browser, { page: 'accueil', width: 360, height: 900, scenario: { extra: 'fake-sb-social2.mjs', mentor: true } });
    await p.waitForSelector('.mt-duo', { timeout: 8000 }).catch(() => {});
    check(await p.isVisible('.home-own-parrainage'), '(a) bloc « Semaine d’accueil » affiché');
    const t = await p.textContent('.home-own-parrainage');
    check(/ton parrain\s*Alice/.test(t) && /encore \d+ jours/.test(t), '(a) duo et jours restants');
    check(await p.locator('.mt-step.is-done').count() === 2 && /2 étapes restantes/.test(t), '(a) 2 étapes sur 4');
    check(/carte « Filleul » \+ 50 Paillettes/.test(t), '(a) récompense annoncée');
    check(await p.locator('.mt-cta[href^="cartes.html#collection/"]').count() === 1, '(a) « Proposer un échange à Alice »');
    check(await p.locator('[data-claim]').count() === 0, '(a) pas de réclamation avant 4/4');
    const order = await p.evaluate(() => [...document.querySelectorAll('#app > [data-home-id]')].map((e) => e.dataset.homeId));
    check(order.indexOf('parrainage') <= 1, '(a) bloc placé en haut (après les bandeaux)');
    check(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '(a) 360 px : pas de défilement horizontal');
    check(!p.errs.length, '(a) aucune erreur JS' + errs(p));
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'accueil', scenario: { extra: 'fake-sb-social2.mjs', mentor: true, mentorAll: true } });
    await p.waitForSelector('[data-claim]', { timeout: 8000 }).catch(() => {});
    await p.click('[data-claim]');
    await p.waitForSelector('.home-own-parrainage .pill-ok', { timeout: 5000 }).catch(() => {});
    check((await log(p)).some((l) => l[0] === 'rpc' && l[1] === 'hg_mentor_claim'), '(b) hg_mentor_claim appelée');
    check(/Récompense reçue/.test(await p.textContent('.home-own-parrainage')), '(b) récompense reçue');
    check(!p.errs.length, '(b) aucune erreur JS' + errs(p));
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'accueil', scenario: { extra: 'fake-sb-social2.mjs' } });
    await p.waitForTimeout(800);
    check(await p.locator('.home-own-parrainage:not([hidden])').count() === 0, '(c) sans parrainage : aucun bloc');
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, scenario: { extra: 'fake-sb-social2.mjs' } });
    await adminSection(p, 'membres/parrainage').catch((e) => console.log(e.message));
    await p.waitForSelector('#pr-assign', { timeout: 8000 }).catch(() => {});
    check(await p.isVisible('#pr-cfg') && await p.isVisible('#pr-assign'), '(d) réglages et attribution affichés');
    check(!p.errs.length, '(d) aucune erreur JS' + errs(p));
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
