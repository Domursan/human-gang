// Parcours : import CSV des questions du gang (idée A1, admin-quiz-import.js), sur le faux Supabase (fixtures/fake-sb.mjs).
// (a) le tiroir s'ouvre depuis Jeux et cartes › Questions du gang ; un fichier « ; » en UTF-8 avec BOM est lu ;
// (b) contrôle à blanc : pastilles Prête / Doublon / Erreur, raison en clair (« la réponse “d” n’est pas dans les choix ») ;
// (c) lignes prêtes cochées, doublon décoché, erreur non cochable ; bouton « Importer N questions » ;
// (d) « 1 question par jour » : dates réparties ; import réel : questions et clés dans la base simulée, liste rechargée ;
// (e) fichier Windows-1252 : proposition « Réessayer en Windows-1252 », accents corrects ; 375 px sans défilement horizontal.
// Lancer : node tests/parcours-admin-quiz-import.cjs (variable SHOTS_DIR : dossier des captures, facultatif)
const { ROOT, check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

const CSV = '﻿question;type;difficulte;categorie;choix;reponse;explication;recompense;debut;fin\r\n'
  + 'Quel plat définit la « soirée pâté-saucisses » ?;Choix unique;facile;Le gang;Raclette|Pâté et saucisses|Fondue;b;;60;;\r\n'
  + 'Qui a fabriqué les gobelets du RDV de Lyon ?;Réponse écrite;moyen;Le gang;;Carzy;;;;\r\n'
  + 'Question déjà là ?;Vrai ou faux;facile;;;vrai;;;;\r\n'
  + 'Combien de fois Worldle a-t-il été collé ?;Nombre;difficile;;;130±10;;250;;\r\n'
  + 'Quel jeu de mots se joue avec plus de 100 liens de salle ?;Choix unique;facile;;Codenames|Gartic|Skribbl;d;;;;\r\n';
const shots = process.env.SHOTS_DIR;

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  try {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
    // Une question existante, pour le doublon
    await p.evaluate(() => window.__DB.hg_quiz_questions.push({ id: 'q-old', prompt: 'Question déjà là ?', qtype: 'vrai_faux', difficulty: 'facile', options: [], reward: 50, starts_at: new Date().toISOString(), active: true, created_at: new Date().toISOString() }));
    await adminSection(p, 'jeux/questions');
    await p.click('[data-adq="import"]');
    await p.waitForSelector('dialog.qi-drawer[open]', { timeout: 5000 });
    check(await p.isVisible('dialog[open] [data-qi="model"]') && await p.isVisible('dialog[open] [data-qi="example"]'), '(a) tiroir ouvert : modèle CSV et exemple proposés');
    await p.setInputFiles('#qi-input', { name: 'questions-novembre.csv', mimeType: 'text/csv', buffer: Buffer.from(CSV, 'utf8') });
    await p.waitForSelector('.qi-row', { timeout: 5000 });
    await sleep(300);
    const rows = await p.$$eval('.qi-row', (els) => els.map((e) => ({ t: e.querySelector('.qi-pill').textContent, c: e.querySelector('input').checked, d: e.querySelector('input').disabled, txt: e.textContent })));
    check(rows.length === 5, `(a) 5 lignes lues (${rows.length})`);
    check((await p.textContent('.qi-drop-t')).includes('questions-novembre.csv') && (await p.textContent('.qi-file')).includes('séparateur « ; »'), '(a) nom du fichier et séparateur affichés');
    check(rows.map((r) => r.t).join(',') === 'Prête,Prête,Doublon,Prête,Erreur', `(b) pastilles : ${rows.map((r) => r.t).join(',')}`);
    check(rows[4].txt.includes('la réponse « d » n’est pas dans les choix (a, b, c)'), '(b) erreur en clair, avec le numéro de ligne');
    check(rows[0].txt.includes('Pâté et saucisses') || rows[0].txt.includes('b'), '(b) réponse affichée');
    check(rows[0].c && rows[1].c && !rows[2].c && rows[3].c && rows[4].d, '(c) prêtes cochées, doublon décoché, erreur non cochable');
    check((await p.textContent('#qi-n-ok')) === '3' && (await p.textContent('#qi-n-dup')) === '1' && (await p.textContent('#qi-n-err')) === '1', '(b) compteurs 3 / 1 / 1');
    check((await p.textContent('dialog[open] [data-drawer-submit]')).trim() === 'Importer 3 questions', '(c) bouton « Importer 3 questions »');
    await p.check('.qi-row:nth-child(3) input');
    check((await p.textContent('dialog[open] [data-drawer-submit]')).trim() === 'Importer 4 questions', '(c) doublon coché : « Importer 4 questions »');
    await p.uncheck('.qi-row:nth-child(3) input');
    // (d) Une question par jour à partir du 1er novembre, catégorie commune
    await p.fill('#qi-start', '2026-11-01T08:00');
    await p.dispatchEvent('#qi-start', 'change');
    await p.check('#qi-daily');
    await p.fill('#qi-cat', 'Novembre');
    await p.dispatchEvent('#qi-cat', 'change');
    await sleep(900);
    if (shots) await p.screenshot({ path: `${shots}/A1-import.png` });
    const before = await p.evaluate(() => window.__DB.hg_quiz_questions.length);
    await p.click('dialog[open] [data-drawer-submit]');
    await p.waitForSelector('dialog.qi-drawer', { state: 'detached', timeout: 5000 }).catch(() => {});
    const added = await p.evaluate(() => window.__DB.hg_quiz_questions.filter((q) => q.category === 'Novembre').map((q) => ({ s: q.starts_at, p: q.prompt, id: q.id })));
    check(added.length === 3 && await p.evaluate(() => window.__DB.hg_quiz_questions.length) === before + 3, `(d) 3 questions importées (${added.length})`);
    const days = added.map((a) => a.s.slice(0, 10)).sort();
    check(JSON.stringify(days) === JSON.stringify(['2026-11-01', '2026-11-02', '2026-11-03']), `(d) une par jour à partir du 1er novembre (${days.join(', ')})`);
    const keys = await p.evaluate((ids) => ids.map((id) => window.__DB.hg_quiz_keys.find((k) => k.question_id === id)?.answer), added.map((a) => a.id));
    check(keys.every(Boolean) && JSON.stringify(keys).includes('"value":130') && JSON.stringify(keys).includes('"correct":["b"]'), '(d) clés de réponse enregistrées (choix b, nombre 130 ± 10)');
    check(await p.evaluate(() => window.__DB.hg_quiz_questions.every((q) => !JSON.stringify(q.options || []).includes('correct'))), '(d) aucune réponse dans les choix visibles');
    check((await p.textContent('#adq-list')).includes('Combien de fois Worldle'), '(d) liste rechargée');
    check(p.errs.length === 0, '(a-d) aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.slice(0, 3).join(' | ') : ''));
    await p.ctx.close();

    // (e) Windows-1252 et mobile
    const m = await openPage(browser, { page: 'admin', width: 375, height: 812 });
    await adminSection(m, 'jeux/questions');
    await m.click('[data-adq="import"]');
    await m.waitForSelector('dialog.qi-drawer[open]');
    const cp = Buffer.from('question;type;reponse\r\nQuel pays est né d’un Worldle ?;Réponse écrite;Tzatzikistan\r\n', 'latin1');
    cp[cp.indexOf(0x19, 0) ] = 0x92; // apostrophe typographique en Windows-1252
    await m.setInputFiles('#qi-input', { name: 'excel.csv', mimeType: 'text/csv', buffer: cp });
    await m.waitForSelector('[data-qi="cp1252"]', { timeout: 5000 });
    check(true, '(e) fichier non UTF-8 : « Réessayer en Windows-1252 » proposé');
    await m.click('[data-qi="cp1252"]');
    await m.waitForSelector('.qi-row .qi-pill', { timeout: 5000 });
    check((await m.textContent('.qi-row')).includes('Réponse écrite') && (await m.textContent('.qi-row')).includes('né'), '(e) accents lus correctement en Windows-1252');
    check(await hscroll(m) <= 0, '(e) 375 px : pas de défilement horizontal');
    if (shots) await m.screenshot({ path: `${shots}/A1-import-mobile.png` });
    check(m.errs.length === 0, '(e) aucune erreur JS' + (m.errs.length ? ' : ' + m.errs.slice(0, 3).join(' | ') : ''));
    await m.ctx.close();
  } catch (e) {
    check(false, 'arrêt sur erreur : ' + String(e.message).split('\n')[0]);
  } finally { await browser.close(); }
  finish();
})();
