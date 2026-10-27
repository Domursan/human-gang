// Parcours : Membres › À relancer (idée A4, admin-accounts/remind.js), sur le faux Supabase.
// (a) liste (vu il y a N semaines, choses en attente), compteur de la sous-section, fiche du premier membre ;
// (b) modèle « Secret Santa » choisi si sa liste de souhaits est vide ; changement de modèle ;
// (c) « Copier » : relance notée, le membre passe dans « Déjà relancés » ;
// (d) MP : bouton désactivé sans opt-in ; avec opt-in, confirmation puis hg-notify admin_dm et relance « mp » ;
// (e) « Ne plus proposer » ; durée 21 / 30 / 60 j ; Staff sans « bot » : pas de MP ; Staff ['cartes'] : pas de sous-section ;
// (f) 375 px sans défilement horizontal ; hauteur ≤ 1 400 px ; aucun envoi automatique (aucun appel hg-notify sans clic).
const { ROOT, check, finish, openPage, adminSection, countOf, hscroll, chromium, sleep } = require('../../lib/harness.cjs');
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const shots = process.env.SHOTS_DIR;
const remind = { todo: [
  { id: U(4), pseudo: 'Chloé', color: '#8FC39F', since_year: 2022, weeks: 6, bot_ok: true, pending: { trades: 0, ss_inscrit: true, ss_souhaits_vides: true }, last_irl: 'RDV de Lyon' },
  { id: U(5), pseudo: 'David', color: '#E0909A', since_year: 2023, weeks: 5, bot_ok: false, pending: { trades: 2 }, last_irl: null },
  { id: U(6), pseudo: 'Emma', color: '#9A88C4', since_year: 2024, weeks: 4, bot_ok: true, pending: {}, last_irl: null },
], done: [{ id: U(2), pseudo: 'Alice', color: '#7E93C9', at: new Date(Date.now() - 10 * 864e5).toISOString(), by: 'Ethan', canal: 'copie', back: true }], paused: [] };
const ok = async (p) => { await p.waitForSelector('dialog[open] button[value="ok"]'); await p.click('dialog[open] button[value="ok"]'); await sleep(500); };

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {
    let p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { remind } });
    await p.context().grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
    await adminSection(p, 'place/relance');
    await p.waitForSelector('.rl-row');
    check(await p.$$eval('.rl-list:first-of-type .rl-row', (r) => r.length) === 3, '(a) 3 membres à relancer');
    check((await p.textContent('.rl-col')).includes('vu il y a 6 semaines · Secret Santa : souhaits vides'), '(a) « vu il y a 6 semaines » et choses en attente');
    check((await p.textContent('.rl-col')).includes('2 échanges de cartes en attente'), '(a) échanges en attente');
    check((await countOf(p, 'place', 'relance')) === '3', '(a) compteur de la sous-section : 3');
    check((await p.textContent('.rl-fiche h3')) === 'Chloé' && (await p.textContent('.rl-fiche')).includes('RDV de Lyon'), '(a) fiche de Chloé (dernière sortie)');
    check((await p.inputValue('#rl-msg')).includes('Coucou Chloé') && (await p.getAttribute('.rl-chip[data-i="0"]', 'aria-pressed')) === 'true', '(b) modèle Secret Santa, pseudo remplacé');
    await p.click('.rl-chip[data-i="2"]');
    check((await p.inputValue('#rl-msg')).includes('tu nous manques'), '(b) modèle « Simple coucou »');
    check((await p.textContent('.rl-col')).includes('Revenu'), '(a) déjà relancés : Alice revenue');
    if (shots) await p.screenshot({ path: `${shots}/A4-relance.png` });
    const h = await p.evaluate(() => document.getElementById('app').scrollHeight);
    check(h <= 1400, `(f) hauteur ≤ 1 400 px (${h})`);
    check(!(await p.evaluate(() => window.__LOG.some((l) => l[0] === 'fn'))), '(f) aucun MP sans clic');
    // (d) MP à Chloé
    await p.click('[data-rl="mp"]'); await ok(p);
    const fn = await p.evaluate(() => window.__LOG.filter((l) => l[0] === 'fn').map((l) => l[2]));
    check(fn.length === 1 && fn[0].event === 'admin_dm' && fn[0].user_ids[0] === '00000004-0000-4000-8000-000000000004', '(d) MP par hg-notify admin_dm, un seul destinataire');
    check(await p.evaluate(() => window.__DB.hg_relances.some((r) => r.canal === 'mp')), '(d) relance notée « mp »');
    // (c) David : pas d'opt-in, Copier
    await p.click('.rl-row[data-id="00000005-0000-4000-8000-000000000005"]');
    check(await p.isDisabled('[data-rl="mp"]') && (await p.textContent('.rl-fiche')).includes('pas accepté les MP'), '(d) sans opt-in : MP désactivé, raison affichée');
    await p.click('[data-rl="copy"]'); await sleep(600);
    check(await p.evaluate(() => window.__DB.hg_relances.some((r) => r.canal === 'copie')), '(c) « Copier » note la relance');
    check((await p.textContent('.rl-col')).includes('Déjà relancés') && (await p.$$eval('.rl-list:first-of-type .rl-row', (r) => r.length)) === 1, '(c) relancés sortis de la liste');
    // (e) Ne plus proposer Emma
    await p.click('[data-rl="pause"]'); await ok(p);
    check((await p.textContent('.rl-col')).includes('Ne plus proposer') && (await p.textContent('.rl-paused')).includes('Emma'), '(e) Emma en pause');
    await p.click('.rl-segb[data-days="60"]'); await sleep(400);
    check(await p.evaluate(() => window.__LOG.some((l) => l[1] === 'hg_admin_to_remind' && l[2].p_days === 60)), '(e) durée 60 j demandée');
    check(p.errs.length === 0, '(a-e) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''));
    await p.ctx.close();

    p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { remind, uid: U(2), staff: ['membres'] } });
    await adminSection(p, 'place/relance'); await p.waitForSelector('.rl-row');
    check(await p.isDisabled('[data-rl="mp"]') && (await p.textContent('.rl-fiche')).includes('Staff « Bot Discord »'), '(e) Staff membres sans bot : MP réservé');
    await p.ctx.close();
    p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { remind, uid: U(2), staff: ['cartes'] } });
    check(await p.locator('.plateau-lieu[href="#place"]').count() === 0, '(e) Staff cartes : pas de La Place (donc pas de « À relancer »)');
    await p.ctx.close();
    p = await openPage(browser, { page: 'admin', width: 375, height: 812, scenario: { remind } });
    await adminSection(p, 'place/relance'); await p.waitForSelector('.rl-row');
    check(await hscroll(p) <= 0, '(f) 375 px : pas de défilement horizontal');
    if (shots) await p.screenshot({ path: `${shots}/A4-relance-mobile.png`, fullPage: true });
    await p.ctx.close();
  } catch (e) { check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]); }
  finally { await browser.close(); }
  finish();
})();
