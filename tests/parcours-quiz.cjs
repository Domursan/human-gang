// Parcours : Questions du gang (quiz.html).
// La page s'affiche ; chaque type de question a le bon contrôle (radio, cases, texte, nombre) ; répondre juste affiche le
// gain ; répondre faux affiche la bonne réponse ; une question répondue passe dans l'historique ; filtre de difficulté ;
// accès depuis l'encart de la page Cartes et le menu ; 390 px sans défilement horizontal ; aucune erreur JS.
// Faux Supabase : fixtures/fake-sb.mjs (QUIZ : une question par type, réponses correctes ou fausses selon le test).
// Lancer : node tests/parcours-quiz.cjs   (HG_ROOT / HG_PREFIX comme les autres parcours)
const { ROOT, SHOTS, check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const fs = require('fs');
const path = require('path');

/** Attend que la question id ait quitté les ouvertes (elle est répondue) : le bandeau du tour est alors à jour. */
async function attendApres(p, id) {
  return p.waitForFunction((q) => !document.querySelector(`form[data-id="${q}"]`), id, { timeout: 4000 }).then(() => true).catch(() => false);
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- Affichage et contrôles par type ---------- */
  let p = await openPage(browser, { page: 'quiz', width: 1280 });
  await p.waitForSelector('.quiz-card', { timeout: 4000 }).catch(() => {});
  check(await p.locator('#quiz-title').innerText().then((t) => t.trim() === 'Questions du gang'), 'page : titre « Questions du gang »');
  check((await p.locator('.quiz-summary .quiz-tile').count()) === 3, 'résumé : trois chiffres (ouvertes, bonnes, Paillettes)');
  check((await p.locator('.quiz-summary .quiz-tile').nth(0).innerText()).includes('7'), 'résumé : 7 questions ouvertes');
  check((await p.locator('.quiz-summary .quiz-tile').nth(1).innerText()).includes('1'), 'résumé : 1 bonne réponse');
  check((await p.locator('.quiz-summary .quiz-tile').nth(2).innerText()).includes('50'), 'résumé : 50 Paillettes gagnées');
  check((await p.locator('#quiz-open .quiz-card').count()) === 7, 'liste : 7 questions ouvertes affichées');
  check((await p.locator('#quiz-open .quiz-card').nth(0).getAttribute('class')).includes('is-secret'), 'secrète : la question secrète est en tête des ouvertes');
  check((await p.locator('#quiz-open .quiz-card').nth(0).textContent()).includes('Question secrète'), 'secrète : libellé « Question secrète » dans la carte');
  check((await p.locator('#quiz-open .quiz-card.is-secret').count()) === 1 && (await p.locator('#quiz-open .quiz-card').nth(1).getAttribute('class')).includes('is-secret') === false, 'secrète : une seule carte secrète, les autres sont normales');
  check((await p.locator('form[data-id="qz-1"] input[type="radio"]').count()) === 3, 'choix unique : 3 boutons radio');
  check((await p.locator('form[data-id="qz-1"] input[type="checkbox"]').count()) === 0, 'choix unique : aucune case à cocher');
  check((await p.locator('form[data-id="qz-2"] input[type="radio"]').count()) === 2, 'vrai/faux : 2 boutons radio (Vrai, Faux)');
  check((await p.locator('form[data-id="qz-3"] input[type="checkbox"]').count()) === 4, 'choix multiple : 4 cases à cocher');
  check((await p.locator('form[data-id="qz-3"]').innerText()).includes('Plusieurs réponses possibles'), 'choix multiple : consigne « Plusieurs réponses possibles »');
  check((await p.locator('form[data-id="qz-4"] input[type="text"]').count()) === 1 && (await p.locator('form[data-id="qz-4"] input[type="radio"]').count()) === 0, 'texte : un champ texte, pas de choix');
  check((await p.locator('form[data-id="qz-5"] input[inputmode="decimal"]').count()) === 1, 'nombre : champ numérique qui accepte la virgule');
  check((await p.locator('.quiz-diff').first().innerText()).length > 0, 'difficulté : pastille avec libellé et étoiles');
  check((await p.locator('.quiz-card', { has: p.locator('form[data-id="qz-1"]') }).innerText()).includes('+50 ✦'), 'récompense : « +50 ✦ » affichée sur la carte');
  check((await p.locator('.quiz-card').filter({ hasText: 'logo' }).locator('img').count()) === 0, 'image : absente quand la question n’en a pas');
  check((await p.locator('form[data-id="qz-5"]').evaluate((f) => f.closest('.quiz-card').querySelector('img')?.getAttribute('src') || '').then((s) => s.startsWith('data:'))), 'image : affichée quand la question en a une');
  check((await p.locator('#quiz-open').innerText()).includes('Une seule réponse possible'), 'confirmation : « Une seule réponse possible » près du bouton');
  check((await p.locator('.nav a[href="quiz.html"]').count()) === 1, 'menu : lien « Questions du gang » dans la navigation');
  check(p.errs.length === 0, 'aucune erreur JS ni 404 sur la page' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));

  /* ---------- Filtre par difficulté ---------- */
  await p.click('#quiz-filter button[data-diff="expert"]');
  await sleep(120);
  check((await p.locator('#quiz-open .quiz-card').count()) === 1 && (await p.locator('form[data-id="qz-5"]').count()) === 1, 'filtre « Expert » : seule la question expert reste');
  check((await p.locator('#quiz-filter button[data-diff="expert"]').getAttribute('aria-pressed')) === 'true', 'filtre : le bouton choisi est marqué aria-pressed');
  await p.click('#quiz-filter button[data-diff="facile"]');
  await sleep(120);
  check((await p.locator('#quiz-open .quiz-card').count()) === 1 && (await p.locator('form[data-id="qz-1"]').count()) === 1, 'filtre « Facile » : la question facile est seule');
  check((await p.locator('#quiz-done .quiz-card').count()) === 1, 'filtre « Facile » : l’historique montre la réponse facile déjà donnée');
  await p.click('#quiz-filter button[data-diff="tous"]');
  await sleep(120);
  check((await p.locator('#quiz-open .quiz-card').count()) === 7, 'filtre « Tous » : toutes les questions ouvertes reviennent');

  /* ---------- Réponse juste ---------- */
  await p.check('form[data-id="qz-1"] input[value="b"]');
  await p.click('form[data-id="qz-1"] button[type="submit"]');
  check(await attendApres(p, 'qz-1'), 'réponse juste : la question est répondue et un bandeau de résultat s’affiche');
  check((await p.locator('#quiz-feedback').innerText()).includes('Bravo'), 'réponse juste : « Bravo » affiché');
  check((await p.locator('#quiz-feedback').innerText()).includes('+50 ✦'), 'réponse juste : le gain « +50 ✦ » est affiché');
  check((await p.locator('#quiz-feedback').innerText()).includes('Le logo reprend le bleu'), 'réponse juste : l’explication est affichée');
  check((await p.locator('form[data-id="qz-1"]').count()) === 0, 'après réponse : la question n’est plus dans les ouvertes');
  check((await p.locator('#quiz-done').innerText()).includes('De quelle couleur est le logo'), 'après réponse : la question passe dans « Déjà répondues »');
  check(await p.locator('#quiz-history').evaluate((d) => d.open), 'après réponse : l’historique est déplié');
  check((await p.locator('.quiz-summary .quiz-tile').nth(2).innerText()).includes('100'), 'résumé mis à jour : 100 Paillettes gagnées (50 + 50)');
  let calls = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_quiz_answer');
  check(calls.length === 1 && calls[0][2].p_question === 'qz-1' && calls[0][2].p_response === 'b', 'appel : hg_quiz_answer envoyé une fois, avec la bonne question et la réponse « b »');

  /* ---------- Réponse fausse : bonne réponse affichée ---------- */
  await p.check('form[data-id="qz-2"] input[value="faux"]');
  await p.click('form[data-id="qz-2"] button[type="submit"]');
  await attendApres(p, 'qz-2');
  check((await p.locator('#quiz-feedback').innerText()).includes('Raté'), 'réponse fausse : « Raté » affiché');
  check((await p.locator('#quiz-feedback').innerText()).includes('Bonne réponse : Vrai'), 'réponse fausse : la bonne réponse « Vrai » (texte, pas l’identifiant)');
  check(!(await p.locator('#quiz-feedback').innerText()).includes('Bravo'), 'réponse fausse : aucun « Bravo », donc aucun gain annoncé');

  /* ---------- Choix multiple : rien coché, puis une mauvaise sélection ---------- */
  await p.click('form[data-id="qz-3"] button[type="submit"]');
  await sleep(150);
  check((await p.locator('form[data-id="qz-3"] .quiz-error').innerText()).includes('Coche au moins une réponse'), 'choix multiple vide : message « Coche au moins une réponse » sans envoi');
  check((await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_quiz_answer' && e[2].p_question === 'qz-3').length === 0, 'choix multiple vide : aucun appel au serveur');
  await p.check('form[data-id="qz-3"] input[value="html"]');
  await p.click('form[data-id="qz-3"] button[type="submit"]');
  await attendApres(p, 'qz-3');
  check((await p.locator('#quiz-feedback').innerText()).includes('Raté'), 'choix multiple incomplet : « Raté »');
  check((await p.locator('#quiz-feedback').innerText()).includes('JavaScript'), 'choix multiple : la bonne réponse liste les textes des choix');

  /* ---------- Texte : réponse acceptée (sans accents ni casse) ---------- */
  await p.fill('form[data-id="qz-4"] input[type="text"]', '  PAILLETTÉS ');
  await p.click('form[data-id="qz-4"] button[type="submit"]');
  await attendApres(p, 'qz-4');
  check((await p.locator('#quiz-feedback').innerText()).includes('Bravo'), 'texte : « PAILLETTÉS » accepté pour « Paillettes »');

  /* ---------- Nombre : saisie invalide refusée sans envoi, puis valeur juste ---------- */
  await p.fill('form[data-id="qz-5"] input[type="text"]', 'beaucoup');
  await p.click('form[data-id="qz-5"] button[type="submit"]');
  await sleep(150);
  check((await p.locator('form[data-id="qz-5"] .quiz-error').innerText()).includes('Écris un nombre'), 'nombre : « beaucoup » refusé avec un message, sans envoi');
  check((await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_quiz_answer' && e[2].p_question === 'qz-5').length === 0, 'nombre invalide : aucun appel au serveur');
  await p.fill('form[data-id="qz-5"] input[type="text"]', '62');
  await p.click('form[data-id="qz-5"] button[type="submit"]');
  await attendApres(p, 'qz-5');
  check((await p.locator('#quiz-feedback').innerText()).includes('Bravo'), 'nombre : 62 juste');

  /* ---------- Réponse libre à valider par l'admin ---------- */
  await p.fill('form[data-id="qz-6"] input[type="text"]', 'Le soir du réveillon');
  await p.click('form[data-id="qz-6"] button[type="submit"]');
  await attendApres(p, 'qz-6');
  check((await p.locator('#quiz-feedback').innerText()).includes('Ta réponse est enregistrée'), 'réponse libre : « Ta réponse est enregistrée » (en attente)');
  check((await p.locator('#quiz-done').innerText()).includes('En attente de validation par l’admin'), 'réponse libre : pastille « En attente de validation par l’admin » dans l’historique');

  /* ---------- Question secrète : réponse juste, gain de 300 ---------- */
  await p.fill('form[data-id="qz-9"] input[type="text"]', 'secrets');
  await p.click('form[data-id="qz-9"] button[type="submit"]');
  await attendApres(p, 'qz-9');
  check((await p.locator('#quiz-feedback').innerText()).includes('+300 ✦'), 'secrète : réponse juste « secrets » donne « +300 ✦ »');

  /* ---------- Toutes les réponses sont dans l'historique, sans formulaire restant ---------- */
  check((await p.locator('#quiz-open .quiz-card').count()) === 0, 'après toutes les réponses : plus aucune question ouverte');
  check((await p.locator('#quiz-open').innerText()).includes('Aucune question ouverte'), 'après toutes les réponses : message « Aucune question ouverte »');
  check((await p.locator('#quiz-done .quiz-card').count()) === 9, 'historique : les 9 questions répondues y figurent');
  check((await p.locator('#quiz-done-count').innerText()).includes('9'), 'historique : compteur (9) dans le titre repliable');
  check(p.errs.length === 0, 'aucune erreur JS pendant les réponses' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));

  /* ---------- Téléphone 390 px ---------- */
  await p.ctx.close();
  p = await openPage(browser, { page: 'quiz', width: 390 });
  await p.waitForSelector('.quiz-card', { timeout: 4000 }).catch(() => {});
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  check((await p.locator('#quiz-filter button').count()) === 5, '390 px : les cinq filtres sont là');
  await p.screenshot({ path: path.join(SHOTS, 'quiz-390.png') }).catch(() => {});
  check(p.errs.length === 0, '390 px : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Chargement en erreur : la page le dit sans bloquer le reste ---------- */
  p = await openPage(browser, { page: 'quiz', width: 1280, scenario: { quizFail: true } });
  await sleep(300);
  check((await p.locator('#quiz-open').innerText()).includes('Questions indisponibles'), 'erreur de chargement : message « Questions indisponibles »');
  check(await p.locator('#quiz-summary').evaluate((e) => e.innerHTML === ''), 'erreur de chargement : résumé vide');
  await p.ctx.close();

  /* ---------- Encart de la page Cartes ---------- */
  p = await openPage(browser, { page: 'cartes', fixture: 'fake-sb-cartes.mjs', width: 1280 });
  await p.waitForSelector('#cartes-quests', { timeout: 6000 }).catch(() => {});
  await sleep(400);
  check((await p.locator('#cartes-quests a[href="quiz.html"]').count()) === 1, 'Cartes : encart « Questions du gang » sous les quêtes, avec un lien vers quiz.html');
  await p.ctx.close();

  /* ---------- Tuto ---------- */
  const tuto = fs.existsSync(path.join(ROOT, 'assets/js/tutos/cartes-avance.js'))
    ? fs.readFileSync(path.join(ROOT, 'assets/js/tutos/cartes-avance.js'), 'utf8') : '';
  check(tuto.includes("slug: 'questions-du-gang'") && tuto.includes("page: 'quiz.html'"), 'tuto : « questions-du-gang » pointe vers quiz.html');

  await browser.close();
  finish();
})();
