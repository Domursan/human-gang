// Parcours : Communication › Fil d'activité (admin-fil.js), sur le faux Supabase.
// (a) liste des entrées (plus récentes d'abord), auteur (pseudo, « Le site » pour une entrée automatique), type ;
// (b) recherche et filtre par type ;
// (c) suppression : annulation → rien ; confirmation → ligne retirée de __DB.hg_activity, notification ;
// (d) Staff « reglages » : la section fonctionne ; texte venant de la base échappé ;
// (e) 360 px sans défilement horizontal, cibles ≥ 44 px, aucune erreur JS.
// La section est ouverte par sa route #communication/fil si admin.js la branche, sinon montée directement (mountFilSection).
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours-admin-fil.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium } = require('./lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const iso = (h) => new Date(Date.now() + h * 36e5).toISOString();

/** Fil de départ : 5 entrées de types différents, dont une avec du HTML (doit rester du texte). */
const ACTIVITY = [
  { id: 101, user_id: U(2), kind: 'join', text: 'Alice a rejoint le gang', created_at: iso(-50) },
  { id: 102, user_id: null, kind: 'cartes', text: 'Une carte sauvage est apparue !', created_at: iso(-30) },
  { id: 103, user_id: U(3), kind: 'badge', text: 'Bruno a obtenu le badge « Roi du karaoké »', created_at: iso(-10) },
  { id: 104, user_id: null, kind: 'ss_draw', text: 'Le tirage du Secret Santa 2025 est fait !', created_at: iso(-5) },
  { id: 105, user_id: U(4), kind: 'secret', text: '<b>Chloé</b> a trouvé un secret caché sur le site…', created_at: iso(-1) },
];

/** Ouvre la section : route si elle existe, sinon montage direct dans la zone principale. */
async function openFil(p) {
  const routed = await p.locator('a.shell-sub[href="#communication/fil"]').count();
  if (routed) { await adminSection(p, 'communication/fil'); }
  else {
    await p.evaluate(async () => {
      if (!document.querySelector('link[href$="admin-fil.css"]')) {
        const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'assets/css/admin-fil.css'; document.head.appendChild(l);
      }
      document.querySelector('#app').innerHTML = '<div id="fil-root"></div>';
      const m = await import(new URL('assets/js/admin-fil.js', location.href).href);
      await m.mountFilSection(document.querySelector('#fil-root'));
    });
  }
  await p.waitForSelector('#fil-root .afl-row, #fil-root .empty', { timeout: 8000 });
  return routed ? 'route' : 'direct';
}
/** Identifiants des lignes affichées, dans l'ordre. */
const shownIds = (p) => p.$$eval('#fil-root .afl-row', (els) => els.map((e) => Number(e.dataset.id)));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const scenario = { activity: ACTIVITY };

  /* (a) Liste */
  const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario });
  const how = await openFil(p);
  console.log(`  (section ouverte : ${how === 'route' ? 'route #communication/fil' : 'montage direct, route pas encore branchée'})`);
  check(JSON.stringify(await shownIds(p)) === JSON.stringify([105, 104, 103, 102, 101]), '(a) 5 entrées, plus récentes d\'abord');
  const r103 = await p.textContent('.afl-row[data-id="103"]');
  check(r103.includes('Bruno') && r103.includes('Badge'), '(a) auteur (pseudo) et type affichés');
  check((await p.textContent('.afl-row[data-id="102"]')).includes('Le site'), '(a) entrée automatique : « Le site »');
  check((await p.textContent('#afl-search-count')).includes('5 entrées'), '(a) compteur');

  /* (b) Recherche et filtre */
  await p.fill('#afl-search', 'secret santa');
  await p.waitForTimeout(400);
  check(JSON.stringify(await shownIds(p)) === '[104]', '(b) recherche « secret santa »');
  await p.fill('#afl-search', '');
  await p.waitForTimeout(400);
  check(await p.locator('#afl-kind option').count() === 6, '(b) filtre : « Tous » + 5 types');
  await p.selectOption('#afl-kind', 'cartes');
  check(JSON.stringify(await shownIds(p)) === '[102]', '(b) filtre par type « Cartes »');
  await p.selectOption('#afl-kind', '');
  check((await shownIds(p)).length === 5, '(b) filtre retiré');

  /* (c) Suppression */
  await p.click('.afl-row[data-id="103"] [data-afl="del"]');
  await p.waitForSelector('dialog[open] button[value="cancel"]', { timeout: 5000 });
  check((await p.textContent('dialog[open]')).includes('Roi du karaoké'), '(c) la confirmation cite l\'entrée');
  await p.click('dialog[open] button[value="cancel"]');
  await p.waitForTimeout(300);
  check((await p.evaluate(() => window.__DB.hg_activity.length)) === 5 && (await shownIds(p)).includes(103), '(c) annulation : rien n\'est supprimé');
  check(!(await p.evaluate(() => window.__LOG.some((l) => l[0] === 'delete'))), '(c) annulation : aucune requête de suppression');
  await p.click('.afl-row[data-id="103"] [data-afl="del"]');
  await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
  await p.click('dialog[open] button[value="ok"]');
  await p.waitForFunction(() => !document.querySelector('.afl-row[data-id="103"]'), null, { timeout: 5000 });
  const ids = await p.evaluate(() => window.__DB.hg_activity.map((r) => r.id));
  check(!ids.includes(103) && ids.length === 4, '(c) entrée retirée de __DB.hg_activity');
  check(await p.evaluate(() => window.__LOG.some((l) => l[0] === 'rpc' && l[1] === 'hg_activity_remove' && l[2]?.p_id === 103)), '(c) suppression par la RPC journalisée hg_activity_remove');
  check((await p.textContent('.toasts')).includes('supprimée'), '(c) notification « Entrée supprimée »');
  check((await p.textContent('#afl-search-count')).includes('4 entrées'), '(c) compteur à jour');
  check(p.errs.length === 0, '(a–c) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* (d) Staff « reglages » */
  const s = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { ...scenario, uid: U(5), staff: ['reglages'] } });
  await openFil(s);
  check((await shownIds(s)).length === 5, '(d) Staff « reglages » : fil affiché');
  check(await s.locator('.afl-row[data-id="105"] .afl-text b').count() === 0 && (await s.textContent('.afl-row[data-id="105"] .afl-text')).includes('<b>Chloé</b>'), '(d) texte de la base échappé');
  check(s.errs.length === 0, '(d) aucune erreur JS' + (s.errs.length ? ' : ' + s.errs.join(' | ') : ''));
  await s.ctx.close();

  /* (e) Mobile 360 px */
  const m = await openPage(browser, { page: 'admin', width: 360, height: 780, scenario });
  await openFil(m);
  check((await hscroll(m)) <= 0, '(e) 360 px : pas de défilement horizontal');
  const small = await m.evaluate(() => [...document.querySelectorAll('#fil-root button, #fil-root select, #fil-root input')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 44).map((el) => el.id || el.textContent.trim()));
  check(small.length === 0, '(e) cibles ≥ 44 px' + (small.length ? ' : ' + small.join(', ') : ''));
  check(m.errs.length === 0, '(e) aucune erreur JS' + (m.errs.length ? ' : ' + m.errs.join(' | ') : ''));
  await m.ctx.close();

  /* Long fil : affichage par lots de 20, longueur de la section bornée */
  const many = Array.from({ length: 45 }, (_, i) => ({ id: 500 + i, user_id: U(2), kind: 'join', text: `Entrée numéro ${i + 1}`, created_at: iso(-i) }));
  const l = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { activity: many } });
  await openFil(l);
  check((await shownIds(l)).length === 20, '(a) long fil : 20 premières entrées');
  const hl = await l.evaluate(() => document.getElementById('app').scrollHeight);
  check(hl <= 2200, `(a) long fil : longueur bornée (${hl} px)`);
  await l.click('[data-afl="more"]');
  check((await shownIds(l)).length === 40, '(a) « Afficher plus » : 40 entrées');
  check(await l.evaluate(() => document.activeElement?.closest('.afl-row')?.dataset.id === '520'), '(a) focus sur la première entrée ajoutée');
  await l.ctx.close();

  /* Fil vide (sans scénario) */
  const v = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  await openFil(v);
  check((await v.textContent('#afl-list')).includes('Le fil est vide'), '(a) fil vide : message');
  await v.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
