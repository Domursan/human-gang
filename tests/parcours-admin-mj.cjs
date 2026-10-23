// Parcours : Jeux et cartes › Mes jeux (idée A3, permission Staff « Maître du jeu »), sur le faux Supabase.
// (a) Staff ['mj'] seul : une seule sous-section visible (Mes jeux), routes interdites redirigées ;
// (b) il ne voit que son jeu (CK3), annonce une session (confirmation), quota affiché, annulation ;
// (c) quota de 3 atteint : bouton désactivé ;
// (d) admin : tous les jeux, ajout et retrait d'un maître du jeu, « + Nouveau jeu » ; la permission figure au catalogue Staff ;
// (e) 375 px sans défilement horizontal ; hauteur ≤ 1 400 px.
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const shots = process.env.SHOTS_DIR;
const settings = [{ key: 'bot', value: { notify: {}, salons: [{ id: '333333333333333333', nom: 'ck3' }] } }];
const ok = async (p) => { await p.waitForSelector('dialog[open] button[value="ok"]'); await p.click('dialog[open] button[value="ok"]'); await sleep(500); };

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {
    const mjScn = { settings, uid: U(3), staff: ['mj'], gameMasters: [{ game_slug: 'ck3', user_id: U(3) }] };
    let p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: mjScn });
    await sleep(500);
    const subs = await p.$$eval('#shell-subs .shell-sub', (a) => a.map((x) => x.getAttribute('href')));
    check(JSON.stringify(subs) === JSON.stringify(['#cartes/mes-jeux']), `(a) Staff mj : une seule sous-section (${subs.join(', ')})`);
    await p.evaluate(() => { location.hash = 'membres/comptes'; }); await sleep(600);
    check(await p.evaluate(() => location.hash) === '#cartes/mes-jeux', '(a) #membres/comptes redirigée vers Mes jeux');
    await adminSection(p, 'cartes/mes-jeux');
    await p.waitForSelector('.mj-game');
    check(await p.$$eval('.mj-game', (g) => g.length) === 1 && (await p.textContent('.mj-title')).includes('CK3'), '(b) un seul jeu : CK3');
    check(await p.locator('.mj-masters').count() === 0 && await p.locator('#zone-actions .btn').count() === 0, '(b) ni liste des MJ ni « Nouveau jeu » pour un MJ');
    await p.fill('#mj-msg-ck3', 'Session CK3 ce samedi 21 h, shotgun en réponse');
    await p.click('[data-mj="announce"]'); await ok(p);
    check(await p.evaluate(() => window.__DB.hg_bot_scheduled.length) === 1, '(b) annonce programmée');
    check((await p.textContent('.mj-quota')).includes('1 sur 3'), '(b) quota : 1 sur 3');
    if (shots) await p.screenshot({ path: `${shots}/A3-mes-jeux-mj.png` });
    await p.click('[data-mj="cancel"]'); await ok(p);
    check(await p.evaluate(() => !!window.__DB.hg_bot_scheduled[0].cancelled_at), '(b) annonce annulée');
    for (let i = 0; i < 3; i++) { await p.click('[data-mj="announce"]'); await ok(p); }
    check(await p.isDisabled('[data-mj="announce"]') && (await p.textContent('.mj-quota')).includes('3 sur 3'), '(c) quota atteint : bouton désactivé');
    check(p.errs.length === 0, '(a-c) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''));
    await p.ctx.close();

    // (d) Admin
    p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { settings, staffRows: [{ user_id: U(3), perms: ['mj'], active: true, note: '' }] } });
    await adminSection(p, 'cartes/mes-jeux');
    await p.waitForSelector('.mj-game');
    check(await p.$$eval('.mj-game', (g) => g.length) === 2, '(d) admin : tous les jeux (2)');
    await p.selectOption('#mj-add-ck3', U(3));
    await p.click('[data-mj="set"][data-game="ck3"]'); await sleep(500);
    check(await p.evaluate((u) => window.__DB.hg_game_masters.some((m) => m.user_id === u && m.game_slug === 'ck3'), U(3)), '(d) maître du jeu ajouté');
    check((await p.textContent('.mj-chips')).includes('Bruno'), '(d) Bruno affiché comme MJ');
    if (shots) await p.screenshot({ path: `${shots}/A3-mes-jeux-admin.png` });
    const h = await p.evaluate(() => document.getElementById('app').scrollHeight);
    check(h <= 1400, `(e) hauteur ≤ 1 400 px (${h})`);
    await p.click('.mj-x'); await sleep(500);
    check(await p.evaluate(() => window.__DB.hg_game_masters.length) === 0, '(d) maître du jeu retiré');
    await p.click('#zone-actions .btn-primary');
    await p.fill('#mj-f-name', 'Age of Empires 2'); await p.fill('#mj-f-slug', 'aoe2');
    await p.click('dialog[open] [data-drawer-submit]'); await sleep(600);
    check(await p.$$eval('.mj-game', (g) => g.length) === 3, '(d) nouveau jeu créé');
    await adminSection(p, 'pilotage/staff'); await sleep(800);
    check((await p.content()).includes('Maître du jeu'), '(d) permission « Maître du jeu » proposée dans Staff');
    check(p.errs.length === 0, '(d) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''));
    await p.ctx.close();

    p = await openPage(browser, { page: 'admin', width: 375, height: 812, scenario: mjScn });
    await adminSection(p, 'cartes/mes-jeux'); await sleep(500);
    check(await hscroll(p) <= 0, '(e) 375 px : pas de défilement horizontal');
    await p.ctx.close();
  } catch (e) { check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]); }
  finally { await browser.close(); }
  finish();
})();
