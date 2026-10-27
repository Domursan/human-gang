// Parcours : Membres › Champs du profil (admin-champs.js), sur le faux Supabase.
// (a) sans réglage : liste d'origine du site (5 groupes), premier groupe déplié, identifiants figés ;
// (b) libellé modifié, ordre ↑ ↓ d'un champ, nouveau champ (identifiant tiré du libellé, sans accents), nouveau groupe ;
// (c) erreurs : libellé vide, identifiant en double → message, rien n'est enregistré ;
// (d) enregistrement : upsert de profile_fields accepté par validateInfoGroups, clés inconnues conservées,
//     identifiants figés après enregistrement ; retrait d'un champ enregistré confirmé ;
// (e) réglage existant lu ; Staff « reglages » ; 375 px sans défilement horizontal ; longueur ≤ 1 400 px ; aucune erreur JS.
// La section est ouverte par sa route #place/champs si admin.js la branche, sinon montée directement (mountChampsSection).
// Faux Supabase (fixtures/fake-sb.mjs). Lancer : node tests/parcours/admin/parcours-admin-champs.cjs
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium } = require('../../lib/harness.cjs');

const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;

/** Ouvre la section : route si elle existe, sinon montage direct dans la zone principale. */
async function openChamps(p) {
  const routed = await p.locator('a.shell-sub[href="#place/champs"]').count();
  if (routed) await adminSection(p, 'place/champs');
  else {
    await p.evaluate(async () => {
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = window.__HG_RACINE + '/assets/espaces/admin/admin-champs.css'; document.head.appendChild(l);
      document.querySelector('#app').innerHTML = '<div id="champs-root"></div>';
      const m = await import(new URL(window.__HG_RACINE + '/assets/espaces/admin/admin-champs.js', location.origin).href);
      await m.mountChampsSection(document.querySelector('#champs-root'));
    });
  }
  await p.waitForSelector('#champs-root .ach-group', { timeout: 8000 });
  return routed ? 'route' : 'direct';
}
/** Clé interne (data-k) d'un groupe par position. */
const groupK = (p, i) => p.locator('#champs-root .ach-group').nth(i).getAttribute('data-k');
/** Libellés des champs d'un groupe (par clé). */
const labelsOf = (p, gk) => p.$$eval(`.ach-group[data-k="${gk}"] .ach-field input[data-prop="label"]`, (els) => els.map((e) => e.value));
/** Écritures sur hg_settings. */
const writes = (p) => p.evaluate(() => window.__LOG.filter((l) => l[1] === 'hg_settings' && l[0] !== 'select'));

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  /* (a) Liste d'origine */
  const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
  const how = await openChamps(p);
  console.log(`  (section ouverte : ${how === 'route' ? 'route #place/champs' : 'montage direct'})`);
  check(await p.locator('.ach-group').count() === 5, '(a) 5 groupes d\'origine');
  check(await p.locator('.ach-group details[open]').count() === 1, '(a) seul le premier groupe est déplié');
  const g0 = await groupK(p, 0);
  check((await labelsOf(p, g0))[0] === 'Nom et prénom (pour le colis)', '(a) premier champ « Nom et prénom »');
  check(await p.locator(`.ach-group[data-k="${g0}"] .ach-lock`).count() > 0 && await p.locator(`.ach-group[data-k="${g0}"] input[data-prop="id"]`).count() === 0, '(a) identifiants figés (pas de champ d\'identifiant)');
  const h = await p.evaluate(() => document.getElementById('app').scrollHeight);
  check(h <= 1400, `(a) longueur de la section ≤ 1 400 px (${h})`);

  /* (b) Modifications */
  const f0 = p.locator(`.ach-group[data-k="${g0}"] .ach-field`).nth(0);
  const f0k = await f0.getAttribute('data-k');
  await p.fill(`#ach-${f0k}-l`, 'Nom complet');
  check((await p.textContent(`.ach-field[data-k="${f0k}"] .ach-id`)).includes('nom_complet'), '(b) libellé modifié, identifiant inchangé');
  await p.click(`[data-ach="down"][data-k="${f0k}"]`);
  check((await labelsOf(p, g0))[1] === 'Nom complet', '(b) champ descendu d\'un cran');
  check(await p.evaluate((k) => document.activeElement?.dataset.k === k, f0k), '(b) le focus reste sur le bouton d\'ordre');
  await p.click(`[data-ach="up"][data-k="${f0k}"]`);
  check((await labelsOf(p, g0))[0] === 'Nom complet', '(b) champ remonté');
  await p.click(`[data-ach="add-field"][data-k="${g0}"]`);
  const newF = await p.evaluate(() => document.activeElement?.dataset.k);
  await p.keyboard.type('Code de la porte d’entrée');
  check((await p.inputValue(`#ach-${newF}-id`)) === 'code_de_la_porte_d_entree', '(b) identifiant tiré du libellé (sans accents)');
  await p.selectOption(`#ach-${newF}-t`, 'textarea');
  await p.fill(`#ach-${newF}-p`, 'Ex. 1234A');
  await p.click('[data-ach="add-group"]');
  const newG = await p.evaluate(() => document.activeElement?.dataset.k);
  await p.keyboard.type('Préférences cadeaux');
  check((await p.inputValue(`#ach-${newG}-id`)) === 'preferences_cadeaux', '(b) nouveau groupe : identifiant tiré du nom');
  check(await p.locator('.ach-group').count() === 6, '(b) 6 groupes');

  /* (c) Erreurs */
  const gField = await p.locator(`.ach-group[data-k="${newG}"] .ach-field`).first().getAttribute('data-k');
  await p.fill(`#ach-${gField}-id`, 'adresse');
  await p.click('#ach-save');
  await p.waitForTimeout(200);
  const st = await p.textContent('#ach-status');
  check(st.includes('obligatoire') && st.includes('déjà utilisé'), '(c) libellé vide et identifiant en double signalés');
  check((await p.getAttribute(`#ach-${gField}-l`, 'aria-invalid')) === 'true', '(c) champ marqué aria-invalid');
  check((await writes(p)).length === 0, '(c) rien n\'est enregistré');

  /* (d) Enregistrement */
  await p.fill(`#ach-${gField}-l`, 'Idée de cadeau rêvée');
  await p.fill(`#ach-${gField}-id`, 'cadeau_reve');
  await p.click('#ach-save');
  await p.waitForFunction(() => document.querySelector('#ach-status')?.textContent.includes('enregistrés'), null, { timeout: 5000 });
  const w = await writes(p);
  check(w.length === 1 && w[0][0] === 'upsert' && w[0][2].key === 'profile_fields', '(d) une écriture : upsert de profile_fields');
  const ok = await p.evaluate(async () => {
    const m = await import(new URL(window.__HG_RACINE + '/assets/espaces/compte/profile-fields.js', location.origin).href);
    const v = window.__DB.hg_settings.find((r) => r.key === 'profile_fields').value;
    const g = m.validateInfoGroups(v.groups);
    return { valid: !!g, n: v.groups.length, first: v.groups[0].fields[0], last: v.groups[5], newf: v.groups[0].fields.find((f) => f.id === 'code_de_la_porte_d_entree') };
  });
  check(ok.valid && ok.n === 6, '(d) valeur acceptée par validateInfoGroups (6 groupes)');
  check(ok.first.id === 'nom_complet' && ok.first.label === 'Nom complet', '(d) libellé modifié enregistré, identifiant gardé');
  check(ok.newf?.type === 'textarea' && ok.newf?.placeholder === 'Ex. 1234A', '(d) nouveau champ (type, exemple) enregistré');
  check(ok.last.id === 'preferences_cadeaux' && ok.last.fields[0].id === 'cadeau_reve', '(d) nouveau groupe enregistré');
  check(await p.locator('#champs-root input[data-prop="id"]').count() === 0, '(d) identifiants figés après enregistrement');
  // Retrait d'un champ enregistré : confirmation
  const g4 = await groupK(p, 4);
  const before = (await labelsOf(p, g4)).length;
  const firstK = await p.locator(`.ach-group[data-k="${g4}"] .ach-field`).first().getAttribute('data-k');
  await p.locator(`.ach-group[data-k="${g4}"] summary`).click();
  await p.click(`[data-ach="remove"][data-k="${firstK}"]`);
  await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
  await p.click('dialog[open] button[value="ok"]');
  await p.waitForTimeout(300);
  check((await labelsOf(p, g4)).length === before - 1, '(d) champ enregistré retiré après confirmation');
  check(p.errs.length === 0, '(a–d) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* (e) Réglage existant, Staff « reglages », mobile */
  const saved = { note: 'garder', groups: [{ id: 'livraison', label: 'Livraison', fields: [{ id: 'adresse', label: 'Adresse', type: 'textarea' }] },
    { id: 'jeux', label: 'Jeux', fields: [{ id: 'steam', label: 'Steam', type: 'text', placeholder: 'pseudo' }] }] };
  const s = await openPage(browser, { page: 'admin', width: 375, height: 800, scenario: { uid: U(4), staff: ['reglages'], settings: [{ key: 'profile_fields', value: saved }] } });
  await openChamps(s);
  check(await s.locator('.ach-group').count() === 2, '(e) réglage existant lu (2 groupes)');
  check((await hscroll(s)) <= 0, '(e) 375 px : pas de défilement horizontal');
  await s.locator('.ach-group').nth(1).locator('summary').click();
  const k = await s.locator('.ach-group').nth(1).locator('.ach-field').first().getAttribute('data-k');
  await s.fill(`#ach-${k}-l`, 'Steam (pseudo)');
  await s.click('#ach-save');
  await s.waitForFunction(() => document.querySelector('#ach-status')?.textContent.includes('enregistrés'), null, { timeout: 5000 });
  const v = await s.evaluate(() => window.__DB.hg_settings.find((r) => r.key === 'profile_fields').value);
  check(v.note === 'garder' && v.groups[1].fields[0].label === 'Steam (pseudo)', '(e) Staff « reglages » : enregistré, clés inconnues conservées');
  const small = await s.evaluate(() => [...document.querySelectorAll('#champs-root button, #champs-root input, #champs-root select, #champs-root summary')].filter((el) => el.getClientRects().length && el.getBoundingClientRect().height < 44).map((el) => el.id || el.textContent.trim()));
  check(small.length === 0, '(e) cibles ≥ 44 px' + (small.length ? ' : ' + small.join(', ') : ''));
  check(s.errs.length === 0, '(e) aucune erreur JS' + (s.errs.length ? ' : ' + s.errs.join(' | ') : ''));
  await s.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
