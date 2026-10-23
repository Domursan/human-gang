// Parcours P4 « Merci public » (migration 090).
// (a) fiche de Bruno (390 px) : compteur « Remercié N fois », derniers mercis, bouton « Dire merci ».
// (b) boîte (maquette P4) : compteur 140, sortie à relier, aperçu de la ligne du fil, envoi (hg_thank), bloc rechargé.
// (c) lien direct ?merci=<sortie> (suggestion de la page IRL) : boîte ouverte, sortie choisie.
// (d) ma fiche : masquer un merci ; plafond du jour : bouton désactivé avec la raison. 360 px sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb-social.mjs. Lancer : node tests/parcours-merci.cjs
const { check, finish, openPage, hscroll, chromium, SHOTS } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const ago = (d) => new Date(Date.now() - d * 864e5).toISOString();
const EV = 'eeeeeeee-0000-4000-8000-0000000000aa';
const SCN = {
  thanks: [
    { id: 't1', from_id: U(2), to_id: U(3), body: 'pour les crêpes du dimanche', created_at: ago(9), hidden: false },
    { id: 't2', from_id: U(4), to_id: U(3), body: null, created_at: ago(20), hidden: false },
    { id: 't3', from_id: U(2), to_id: ME, body: 'pour le site', created_at: ago(3), hidden: false },
  ],
  merciEvents: [{ id: EV, title: 'Week-end chez Bruno', starts_at: ago(2) }],
};
const waitFor = (p, fn) => p.waitForFunction(fn, null, { timeout: 6000 }).catch(() => {});
const open = (b, scn, w = 390) => openPage(b, { page: 'membre', fixture: 'fake-sb-social.mjs', width: w, height: 844, scenario: scn });

(async () => {
  const browser = await chromium.launch();
  {
    const p = await open(browser, SCN);
    await p.goto(`http://hg.test/membre.html?id=${U(3)}`);
    await waitFor(p, () => !!document.querySelector('#thx-open'));
    const blk = await p.textContent('#mb-thanks');
    check(blk.includes('Remercié 2 fois'), '(a) compteur « Remercié 2 fois »');
    check(blk.includes('Alice') && blk.includes('pour les crêpes du dimanche'), '(a) derniers mercis');
    await p.click('#thx-open');
    await waitFor(p, () => !!document.querySelector('#thx-dlg[open]'));
    check(await p.$eval('#thx-dlg', (d) => d.open), '(b) boîte « Dire merci » ouverte');
    await p.fill('#thx-body', 'pour le week-end, la raclette était parfaite');
    check((await p.textContent('#thx-cnt')).trim() === '44 / 140', '(b) compteur de caractères');
    check((await p.textContent('#thx-prev')).includes('Ethan remercie Bruno : « pour le week-end, la raclette était parfaite »'), '(b) aperçu de la ligne du fil');
    check((await p.textContent('#thx-dlg')).includes('Il te reste'), '(b) mercis restants du jour');
    await p.check('input[name="thx-ev"][value="' + EV + '"]');
    check(await hscroll(p) === 0, '(b) 390 px : pas de défilement horizontal');
    await p.screenshot({ path: `${SHOTS}/p4-merci-390.png` });
    await p.click('#thx-form [type=submit]');
    await waitFor(p, () => window.__LOG.some((l) => l[1] === 'hg_thank'));
    const a = await p.evaluate(() => window.__LOG.find((l) => l[1] === 'hg_thank')[2]);
    check(a.p_to === '00000003-0000-4000-8000-000000000003' && a.p_event === 'eeeeeeee-0000-4000-8000-0000000000aa' && a.p_body.startsWith('pour le week-end'), '(b) hg_thank : destinataire, sortie, message');
    await waitFor(p, () => document.querySelector('#mb-thanks')?.textContent.includes('Remercié 3 fois'));
    check((await p.textContent('#mb-thanks')).includes('Remercié 3 fois'), '(b) bloc rechargé : Remercié 3 fois');
    check(!p.errs.length, '(b) aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
    await p.ctx.close();
  }
  {
    const p = await open(browser, SCN);
    await p.goto(`http://hg.test/membre.html?id=${U(3)}&merci=${EV}`);
    await waitFor(p, () => !!document.querySelector('#thx-dlg[open]'));
    check(await p.$eval(`input[name="thx-ev"][value="${EV}"]`, (e) => e.checked).catch(() => false), '(c) lien ?merci= : boîte ouverte, sortie déjà choisie');
    await p.ctx.close();
  }
  {
    const p = await open(browser, SCN, 360);
    await waitFor(p, () => !!document.querySelector('#mb-thanks .thx-hide'));
    check(!(await p.$('#thx-open')), '(d) ma fiche : pas de bouton « Dire merci »');
    await p.click('#mb-thanks .thx-hide');
    await waitFor(p, () => document.querySelector('#mb-thanks')?.textContent.includes('masqué de ta fiche'));
    check((await p.textContent('#mb-thanks')).includes('Réafficher'), '(d) merci masqué (réaffichable)');
    check(await hscroll(p) === 0, '(d) 360 px : pas de défilement horizontal');
    await p.ctx.close();
  }
  {
    const p = await open(browser, { ...SCN, merciPlafond: true }, 360);
    await p.goto(`http://hg.test/membre.html?id=${U(3)}`);
    await waitFor(p, () => !!document.querySelector('#thx-open'));
    check(await p.$eval('#thx-open', (b) => b.disabled), '(d) plafond du jour : bouton désactivé');
    check((await p.textContent('#thx-why')).includes('aujourd’hui'), '(d) raison affichée');
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
