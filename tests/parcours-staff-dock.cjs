// Parcours : raccourcis Staff (barre à gauche sur ordinateur, bouton flottant sur téléphone), core/staff-dock.js.
// (a) admin, 1280 px : barre visible, 5 raccourcis, décalage du contenu, pas de défilement horizontal, aucune erreur JS.
// (b) admin, 390 px tactile : bouton flottant seul ; la liste s'ouvre, Échap la referme et rend le focus au bouton.
// (c) membre simple : aucune barre. Vue « comme un membre » (admin) : aucune barre. admin.html : aucune barre.
// (d) Staff { assistance } seul : seuls les raccourcis permis (Assistance, Boîte à idées) sont affichés.
// (e) choix mémorisé par membre (localStorage hg_staff_dock:<id>) : retrait de Bot Discord, puis rechargement.
// (f) pas de bouton de repli : icônes toujours visibles.
// (g) chaque raccourci ouvre la bonne section du panel.
// (h) compteurs « à traiter » : Assistance (demandes ouvertes) et Boîte à idées (idées nouvelles).
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-staff-dock.cjs
const { check, finish, openPage, hscroll, chromium } = require('./lib/harness.cjs');

/* ---------- Constantes ---------- */
/** Identifiant de l'admin (connecté par défaut dans le faux client). */
const ME = '11111111-1111-4111-8111-111111111111';
/** Identifiant de test du membre n (U(2) = Alice, membre simple). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const MEMBRE = U(2);
/** Adresses attendues des raccourcis, dans l'ordre d'affichage, et la section du panel où elles mènent. */
const ATTENDU = [
  { id: 'assistance', href: 'admin.html#poste/assistance', section: 'assistance' },
  { id: 'idees', href: 'admin.html#poste/idees', section: 'idees' },
  { id: 'bot', href: 'admin.html#poste/bot', section: 'bot' },
  { id: 'drops', href: 'admin.html#fabrique/drops', section: 'drops' },
  { id: 'evenements', href: 'admin.html#fete/evenements', section: 'evenements' },
];
const CLE = `hg_staff_dock:${ME}`;
const ETIQUETTES = 'Assistance, Boîte à idées, Bot Discord, Drops de cartes, Événement de cartes';

/** Nombre de raccourcis visibles dans la barre (li non masqués). */
const visibles = (p) => p.$$eval('#sd-links li', (lis) => lis.filter((li) => !li.hidden).map((li) => li.dataset.id));

/* ---------- Scénario ---------- */
(async () => {
  const browser = await chromium.launch();

  /* (a) Administrateur, ordinateur 1280 px */
  {
    const p = await openPage(browser, { page: 'accueil', width: 1280, height: 900 });
    check(await p.isVisible('#staff-dock'), '(a) admin 1280 px : barre Staff visible');
    check((await p.getAttribute('#staff-dock', 'aria-label')) === 'Raccourcis Staff', '(a) la barre a l’intitulé « Raccourcis Staff »');
    const liens = await p.$$eval('#sd-links a', (as) => as.map((a) => [a.textContent.trim(), a.getAttribute('href')]));
    check(liens.length === 5, `(a) 5 raccourcis (${liens.length} trouvés)`);
    check(liens.every(([t]) => t.length > 0), '(a) chaque raccourci a un libellé texte');
    const libelles = liens.map(([t]) => t.replace(/\d+$/, '').trim()).join(', ');
    check(libelles === ETIQUETTES, `(a) libellés : ${libelles}`);
    check(JSON.stringify(liens.map(([, h]) => h)) === JSON.stringify(ATTENDU.map((r) => r.href)), '(a) adresses du panel attendues (poste/assistance, poste/idees, poste/bot, fabrique/drops, fete/evenements)');
    const pad = await p.evaluate(() => getComputedStyle(document.body).paddingLeft);
    check(pad === '56px', `(a) contenu décalé de la barre (padding gauche ${pad})`);
    check(await p.evaluate(() => document.documentElement.dataset.staffDock) === 'on', '(a) html[data-staff-dock] = on');
    // Icônes toujours visibles ; au survol, la barre reste fine et le nom sort en bulle à droite de l'icône
    const opRepos = await p.evaluate(() => getComputedStyle(document.querySelector('#sd-links .sd-label')).opacity);
    await p.hover('#sd-links a');
    await p.waitForTimeout(350);
    const w0 = await p.evaluate(() => document.getElementById('staff-dock').getBoundingClientRect().width);
    const bulle = await p.evaluate(() => { const l = document.querySelector('#sd-links .sd-label'); const r = l.getBoundingClientRect(); return { op: getComputedStyle(l).opacity, x: r.left }; });
    check(opRepos === '0' && w0 < 80 && bulle.op === '1' && bulle.x >= w0, `(a) survol : barre fine, nom en bulle à droite (largeur ${Math.round(w0)} px, opacité ${bulle.op}, x ${Math.round(bulle.x)})`);
    // Clavier : le focus montre aussi le nom
    await p.mouse.move(700, 500);
    await p.focus('#sd-links a');
    await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
    await p.waitForTimeout(350);
    const op = await p.evaluate(() => getComputedStyle(document.activeElement.querySelector('.sd-label')).opacity);
    check(op === '1', `(a) clavier : le focus montre le nom du raccourci (opacité ${op})`);
    await p.evaluate(() => document.activeElement?.blur());
    await p.mouse.move(700, 500);
    check((await hscroll(p)) === 0, '(a) 1280 px : pas de défilement horizontal');
    check(!p.errs.length, '(a) 1280 px : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Administrateur, téléphone 390 px tactile */
  {
    const p = await openPage(browser, { page: 'accueil', width: 390, height: 844, mobile: true, dpr: 2 });
    check(await p.isVisible('#staff-dock .sd-fab'), '(b) 390 px : bouton flottant visible');
    check(!(await p.isVisible('#sd-body')), '(b) 390 px : la liste est fermée au départ');
    const box = await p.locator('.sd-fab').boundingBox();
    check(box && box.width >= 44 && box.height >= 44, `(b) cible du bouton au moins 44 px (${box && Math.round(box.width)}×${box && Math.round(box.height)})`);
    check(box && box.x < 60 && box.y > 700, '(b) bouton en bas à gauche');
    await p.tap('.sd-fab');
    await p.waitForSelector('#sd-body', { state: 'visible', timeout: 3000 }).catch(() => {});
    check(await p.isVisible('#sd-body'), '(b) toucher le bouton ouvre la liste');
    check((await p.getAttribute('.sd-fab', 'aria-expanded')) === 'true', '(b) aria-expanded = true à l’ouverture');
    check((await p.$$eval('#sd-links a', (as) => as.length)) === 5, '(b) la liste contient les 5 raccourcis');
    check((await p.evaluate(() => getComputedStyle(document.body).paddingLeft)) === '0px', '(b) téléphone : le contenu n’est pas décalé');
    await p.keyboard.press('Escape');
    await p.waitForTimeout(150);
    check(!(await p.isVisible('#sd-body')), '(b) Échap ferme la liste');
    check(await p.evaluate(() => document.activeElement?.classList.contains('sd-fab')), '(b) Échap rend le focus au bouton');
    check((await hscroll(p)) === 0, '(b) 390 px : pas de défilement horizontal');
    check(!p.errs.length, '(b) 390 px : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Membre simple, vue « comme un membre », admin.html */
  {
    const m = await openPage(browser, { page: 'accueil', scenario: { uid: MEMBRE } });
    check((await m.locator('#staff-dock').count()) === 0, '(c) membre simple : aucune barre Staff');
    check(!m.errs.length, '(c) membre simple : aucune erreur JS' + (m.errs.length ? ' (' + m.errs.join(' | ') + ')' : ''));
    await m.ctx.close();
  }
  {
    const v = await openPage(browser, {
      page: 'accueil',
      init: () => { try { sessionStorage.setItem('hg_view_as', JSON.stringify({ id: '00000002-0000-4000-8000-000000000002', pseudo: 'Alice', is_admin: false, pages: [], roles: [] })); } catch { /* sans objet */ } },
    });
    check(await v.isVisible('.view-as-bar'), '(c) vue « comme un membre » : bandeau affiché');
    check((await v.locator('#staff-dock').count()) === 0, '(c) vue « comme un membre » : aucune barre Staff');
    await v.ctx.close();
  }
  {
    const a = await openPage(browser, { page: 'admin', hash: '#poste/assistance' });
    check(await a.isVisible('#assistance'), '(c) admin.html : le panel s’affiche');
    check((await a.locator('#staff-dock').count()) === 0, '(c) admin.html : aucune barre Staff (le panel a sa navigation)');
    check(!a.errs.length, '(c) admin.html : aucune erreur JS' + (a.errs.length ? ' (' + a.errs.join(' | ') + ')' : ''));
    await a.ctx.close();
  }

  /* (d) Staff avec la seule permission « support » (Assistance et Boîte à idées) */
  {
    const s = await openPage(browser, { page: 'accueil', scenario: { uid: MEMBRE, staff: ['support'] } });
    check(await s.isVisible('#staff-dock'), '(d) Staff « support » : barre visible');
    const vis = await visibles(s);
    check(JSON.stringify(vis) === JSON.stringify(['assistance', 'idees']), `(d) Staff « support » : seuls Assistance et Boîte à idées (${vis.join(', ')})`);
    check((await s.locator('#sd-links a[href="admin.html#poste/bot"]').count()) === 0, '(d) pas de lien vers le Bot Discord sans droit');
    check(!s.errs.length, '(d) Staff « support » : aucune erreur JS' + (s.errs.length ? ' (' + s.errs.join(' | ') + ')' : ''));
    await s.ctx.close();
  }

  /* (e) Choix mémorisé par membre, puis rechargement */
  {
    const p = await openPage(browser, { page: 'accueil' });
    await p.click('#staff-dock .sd-config');
    await p.waitForSelector('#sd-dialog[open]', { timeout: 3000 });
    check(await p.isVisible('#sd-dialog'), '(e) « Choisir mes raccourcis » ouvre la fenêtre');
    check((await p.$$eval('#sd-dialog input[name="sd-pick"]:checked', (xs) => xs.length)) === 5, '(e) par défaut les 5 raccourcis sont cochés');
    await p.uncheck('#sd-dialog input[value="bot"]');
    await p.click('#sd-dialog .sd-dlg-ok');
    await p.waitForFunction(() => !document.getElementById('sd-dialog').open, null, { timeout: 3000 }).catch(() => {});
    check(!(await p.isVisible('#staff-dock li[data-id="bot"]')), '(e) Bot Discord retiré de la barre');
    check(await p.evaluate(() => document.activeElement?.classList.contains('sd-config')), '(e) fermer la fenêtre rend le focus au bouton');
    const stocke = await p.evaluate((k) => localStorage.getItem(k), CLE);
    const v = stocke ? JSON.parse(stocke) : null;
    check(!!v && Array.isArray(v.choix) && !v.choix.includes('bot') && v.choix.includes('assistance'), `(e) choix enregistré sous hg_staff_dock:<id> (${stocke})`);
    await p.reload();
    await p.waitForSelector('#staff-dock', { timeout: 5000 }).catch(() => {});
    check(JSON.stringify(await visibles(p)) === JSON.stringify(['assistance', 'idees', 'drops', 'evenements']), '(e) après rechargement : le choix est gardé');
    await p.keyboard.press('Tab');
    check(!p.errs.length, '(e) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (f) Plus de bouton de repli : les icônes restent toujours visibles */
  {
    const p = await openPage(browser, { page: 'accueil' });
    check(!(await p.$('#staff-dock .sd-toggle')), '(f) pas de bouton « Replier »');
    check(await p.isVisible('#sd-links'), '(f) les icônes sont visibles');
    check(!p.errs.length, '(f) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (g) Chaque raccourci ouvre la bonne section ; (h) compteurs */
  for (const r of ATTENDU) {
    const p = await openPage(browser, { page: 'accueil' });
    await Promise.all([
      p.waitForURL(new RegExp(r.href.replace(/[.#/]/g, (c) => '\\' + c)), { timeout: 8000 }).catch(() => {}),
      p.click(`#sd-links a[href="${r.href}"]`),
    ]);
    await p.waitForSelector(`#${r.section}`, { state: 'visible', timeout: 8000 }).catch(() => {});
    check(await p.isVisible(`#${r.section}`), `(g) « ${r.id} » ouvre la section #${r.section} du panel`);
    check((await p.locator('#staff-dock').count()) === 0, `(g) « ${r.id} » : pas de barre sur admin.html`);
    await p.ctx.close();
  }
  {
    const p = await openPage(browser, {
      page: 'accueil',
      scenario: {
        support: [{ id: 'sup-1', status: 'ouverte', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { id: 'sup-2', status: 'ouverte', created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
          { id: 'sup-3', status: 'traitee', created_at: new Date().toISOString(), updated_at: new Date().toISOString() }],
        ideas: [{ id: 'idea-1', status: 'nouvelle', created_at: new Date().toISOString() }],
      },
    });
    const cA = await p.textContent('#sd-links li[data-id="assistance"] .sd-count').catch(() => '');
    const cI = await p.textContent('#sd-links li[data-id="idees"] .sd-count').catch(() => '');
    check(cA.trim() === '2', `(h) Assistance : 2 demandes ouvertes affichées (${cA.trim() || 'rien'})`);
    check(cI.trim() === '1', `(h) Boîte à idées : 1 idée nouvelle affichée (${cI.trim() || 'rien'})`);
    check(await p.isHidden('#sd-links li[data-id="bot"] .sd-count'), '(h) pas de chiffre pour le Bot Discord');
    check((await p.textContent('.sd-fab-n').catch(() => '')).trim() === '3', '(h) bouton mobile : total 3');
    check(!p.errs.length, '(h) aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* Accessibilité au clavier : Échap retire le focus de la barre */
  {
    const p = await openPage(browser, { page: 'accueil', width: 1280, height: 900 });
    await p.focus('#sd-links a');
    await p.waitForTimeout(350); /* fin de l'apparition de la bulle */
    check(await p.evaluate(() => document.getElementById('staff-dock').contains(document.activeElement)), '(k) le focus au clavier entre dans la barre');
    check((await p.evaluate(() => getComputedStyle(document.activeElement.querySelector('.sd-label')).opacity)) === '1', '(k) le focus montre le nom du raccourci');
    await p.keyboard.press('Escape');
    check(await p.evaluate(() => !document.getElementById('staff-dock').contains(document.activeElement)), '(k) Échap retire le focus de la barre');
    check(await p.evaluate(() => document.getElementById('staff-dock').getAttribute('aria-label') === 'Raccourcis Staff'), '(k) nav étiquetée « Raccourcis Staff »');
    await p.ctx.close();
  }

  finish();
  await browser.close();
})();
