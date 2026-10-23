// Parcours : idée J17, « Qui main ce champion ? » (onglet « Qui main ? » de jeux.html, paquet xJ4).
// Questions du quiz de catégorie « Qui main ? » jouées avec des avatars : pastille du jeu, énoncé en grand, 4 membres,
// réponse unique (hg_quiz_answer), résultat (bonne réponse marquée), question suivante ; sans question : message.
// Faux Supabase : fixtures/fake-sb.mjs (scénario quiMain).
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'jeux', hash: '#qui-main', width: 390, height: 900, scenario: { quiMain: true } });
  await p.waitForSelector('.qm-carte', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.qm-titre').innerText()) === 'Qui main ce champion ?', 'titre : « Qui main ce champion ? »');
  check((await p.locator('.qm-jeu').innerText()) === 'League of Legends', 'pastille : le jeu tiré de la catégorie');
  check((await p.locator('.qm-champion').innerText()) === 'XAYAH', 'énoncé : le champion en grand');
  check((await p.locator('.qm-opt').count()) === 4 && (await p.locator('.qm-opt .avatar').count()) === 4, 'choix : 4 membres avec avatar');
  check((await p.locator('.qm-ligne').first().innerText()).includes('Question 1 / 2'), 'compteur : Question 1 / 2');
  await p.click('.qm-opt[data-opt="b"]');
  await p.waitForSelector('.qm-res', { timeout: 4000 }).catch(() => {});
  const c = (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_quiz_answer');
  check(c.length === 1 && c[0][2].p_question === 'qm-1' && c[0][2].p_response === 'b', 'réponse : hg_quiz_answer(qm-1, b) une fois');
  check((await p.locator('.qm-res').innerText()).includes('Bien vu !') && (await p.locator('.qm-res').innerText()).includes('main de Bruno'), 'résultat : « Bien vu ! » et le contexte');
  check((await p.locator('.qm-opt.is-bon').innerText()).includes('Bonne réponse · ton choix'), 'résultat : bonne réponse marquée « ton choix »');
  check(await p.locator('.qm-opt').first().isDisabled(), 'résultat : plus de seconde tentative');
  check((await p.locator('.qm-boite').innerText()).includes('Quelle civilisation AoE2'), 'aperçu : question suivante');
  await p.click('[data-suivante]');
  check((await p.locator('.qm-prompt').innerText()).includes('Quelle civilisation') && (await p.locator('.qm-opt').count()) === 2, 'question suivante affichée');
  await p.click('.qm-opt[data-opt="a"]');
  await p.waitForSelector('.qm-res', { timeout: 4000 }).catch(() => {});
  check((await p.locator('.qm-res').innerText()).includes('Raté') && (await p.locator('.qm-opt.is-faux').count()) === 1, 'mauvaise réponse : « Raté… » et mon choix marqué');
  check(await hscroll(p) <= 0, '390 px : pas de défilement horizontal');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  p = await openPage(browser, { page: 'jeux', hash: '#qui-main', width: 360, height: 800 });
  await p.waitForSelector('.qm', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.qm-carte').innerText()).includes('Pas encore de question'), 'sans question « Qui main ? » : message');
  check((await p.getAttribute('.qm-profil', 'href')) === 'compte.html', 'lien : renseigner mes mains dans mon profil');
  check(await hscroll(p) <= 0, '360 px : pas de défilement horizontal');
  await p.ctx.close();
  await browser.close();
  finish();
})();
