// Parcours : Pilotage › Planning (idée A2, admin/planning.js), sur le faux Supabase (fixtures/fake-sb.mjs).
// (a) la sous-section s'ouvre ; grille du mois (7 colonnes) avec la sortie et l'événement du faux client ;
// (b) filtre par type ; changement de mois ; vue semaine ;
// (c) « + Programmer » → annonce du bot : formulaire (salons, heure suisse), enregistrement, élément dans la grille,
//     résumé avec « Part dans … », annulation avec confirmation ;
// (d) Staff ['cartes'] : la RPC ne renvoie aucune sortie ni annonce ; Staff ['membres'] seul : pas de Planning ;
// (e) 375 px : liste des jours remplis, sans défilement horizontal ; hauteur ≤ 1 400 px à 1 280 px.
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const shots = process.env.SHOTS_DIR;
const settings = [{ key: 'bot', value: { notify: {}, announce_channel_id: '111111111111111111', salons: [{ id: '222222222222222222', nom: 'soirées' }] } }];
const soon = (d) => new Date(Date.now() + d * 864e5).toISOString();
const scenario = { settings, sorties: [{ id: 'eeeeeeee-0000-4000-8000-000000000009', title: 'Ciné chez Yanninho', location: 'Lyon', starts_at: soon(1), created_by: '11111111-1111-4111-8111-111111111111' }],
  planningDrops: [{ id: 'dr1', title: 'Carte KC', start: soon(2) }, { id: 'dr2', title: 'Carte G2', start: new Date(Date.now() + 2 * 864e5 + 20 * 60e3).toISOString() }] };

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {
    let p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario });
    await adminSection(p, 'pilotage/planning');
    await p.waitForSelector('.pl-cells .pl-cell', { timeout: 5000 });
    await sleep(300);
    check(await p.$$eval('.pl-dow span', (s) => s.length) === 7, '(a) grille de 7 colonnes');
    const cells = await p.$$eval('.pl-cell', (c) => c.length);
    check(cells >= 28 && cells <= 42 && cells % 7 === 0, `(a) mois complet en semaines (${cells} cases)`);
    // la sortie peut tomber le mois suivant (fin de mois) : on avance d'un mois si besoin
    const findText = async (t) => (await p.textContent('#pl-cal')).includes(t);
    if (!(await findText('Ciné chez Yanninho'))) { await p.click('[data-pl="next"]'); await sleep(500); }
    check(await findText('Ciné chez Yanninho'), '(a) la sortie IRL apparaît');
    check((await p.textContent('#pl-watch')).includes('Deux drops dans la même heure'), '(a) « À surveiller » : deux drops dans la même heure');
    await p.click('[data-pl="kind"][data-kind="sortie"]');
    check(!(await findText('Ciné chez Yanninho')) && await p.getAttribute('[data-kind="sortie"]', 'aria-pressed') === 'false', '(b) filtre : sorties masquées');
    await p.click('[data-pl="kind"][data-kind="sortie"]');
    const t1 = await p.textContent('#pl-title');
    await p.click('[data-pl="next"]'); await sleep(400);
    check((await p.textContent('#pl-title')) !== t1, `(b) mois suivant (${await p.textContent('#pl-title')})`);
    await p.click('[data-pl="today"]'); await sleep(300);
    await p.click('[data-pl="view"][data-view="semaine"]'); await sleep(400);
    check(await p.$$eval('.pl-cell', (c) => c.length) === 7 && (await p.textContent('#pl-title')).startsWith('Semaine du'), '(b) vue semaine (7 jours)');
    await p.click('[data-pl="view"][data-view="mois"]'); await sleep(400);
    // (c) Programmer une annonce
    await p.click('#zone-actions .btn-primary');
    await p.waitForSelector('dialog[open] .pl-prog-b[data-kind="bot"]');
    await p.click('dialog[open] .pl-prog-b[data-kind="bot"]');
    await p.waitForSelector('#pl-f-body');
    check(await p.$$eval('.pl-salon input', (i) => i.length) === 2, '(c) salons connus proposés (2)');
    await p.fill('#pl-f-title', 'Soirée de vendredi');
    await p.fill('#pl-f-body', 'Ce soir, soirée pâté-saucisses ! Codenames à 21 h.');
    const k = new Date(Date.now() + 3 * 864e5); const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Zurich' }).format(k);
    await p.fill('#pl-f-at', `${key}T18:00`);
    await p.click('dialog[open] [data-drawer-submit]');
    await p.waitForSelector('#pl-f-body', { state: 'detached', timeout: 5000 }).catch(() => {});
    const sched = await p.evaluate(() => window.__DB.hg_bot_scheduled.map((b) => ({ ...b })));
    check(sched.length === 1 && sched[0].channels.length === 1 && sched[0].title === 'Soirée de vendredi', '(c) annonce enregistrée (un salon, titre)');
    const z = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit' }).format(new Date(sched[0].send_at));
    check(z === '18:00', `(c) heure suisse respectée (${z})`);
    if (!(await findText('Soirée de vendredi'))) { await p.click('[data-pl="next"]'); await sleep(500); }
    await p.click('.pl-item.pl-k-bot');
    await p.waitForSelector('#pl-detail:not([hidden])');
    check((await p.textContent('#pl-detail')).includes('Part dans') && (await p.textContent('#pl-detail')).includes('#annonces'), '(c) résumé : « Part dans … » et salon nommé');
    if (shots) await p.screenshot({ path: `${shots}/A2-planning.png` });
    const h = await p.evaluate(() => document.getElementById('app').scrollHeight);
    check(h <= 1400, `(e) hauteur ≤ 1 400 px (${h})`);
    await p.click('[data-pl="cancel"]');
    await p.waitForSelector('dialog[open] button[value="ok"]'); await p.click('dialog[open] button[value="ok"]'); await sleep(500);
    check(await p.evaluate(() => !!window.__DB.hg_bot_scheduled[0].cancelled_at), '(c) annulation avec confirmation');
    check(p.errs.length === 0, '(a-c) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''));
    await p.ctx.close();

    // (d) Staff
    p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { ...scenario, uid: U(2), staff: ['cartes'] } });
    await adminSection(p, 'pilotage/planning');
    await sleep(600);
    const kinds = await p.$$eval('[data-pl="kind"]', (b) => b.map((x) => x.dataset.kind));
    check(JSON.stringify(kinds) === JSON.stringify(['carte_drop', 'defi']), `(d) Staff cartes : filtres Drops et Défis seulement (${kinds})`);
    const rpc = await p.evaluate(() => window.__LOG.filter((l) => l[1] === 'hg_planning_items').length);
    check(rpc >= 1 && !(await p.textContent('#pl-cal')).includes('Ciné chez Yanninho'), '(d) Staff cartes : aucune sortie');
    await p.ctx.close();
    p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { uid: U(2), staff: ['membres'] } });
    check(await p.locator('#shell-subs a[href="#pilotage/planning"]').count() === 0, '(d) Staff membres seul : pas de Planning');
    await p.ctx.close();

    // (e) Mobile
    p = await openPage(browser, { page: 'admin', width: 375, height: 812, scenario });
    await adminSection(p, 'pilotage/planning');
    await sleep(600);
    check(await hscroll(p) <= 0, '(e) 375 px : pas de défilement horizontal');
    const vis = await p.$$eval('.pl-cell', (c) => c.filter((x) => x.getClientRects().length).every((x) => x.classList.contains('has-items')));
    check(vis, '(e) 375 px : seuls les jours remplis sont listés');
    if (shots) await p.screenshot({ path: `${shots}/A2-planning-mobile.png`, fullPage: true });
    await p.ctx.close();
  } catch (e) { check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]); }
  finally { await browser.close(); }
  finish();
})();
