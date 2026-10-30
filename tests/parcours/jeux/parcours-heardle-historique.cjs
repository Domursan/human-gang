// Parcours : historique du Heardle (/pages/jeux/jeux.html#heardle, sous le jeu du jour ; heardle-historique.js, migration 178).
// Mes chiffres (trouvés, moyenne, série) ; les 3 dernières manches, puis « Voir tout l'historique » et « Réduire » ; une ligne s'ouvre en menu déroulant
// (aria-expanded, joueurs, moyenne, scores du gang avec ma ligne marquée, lien YouTube au bon instant) et se referme ;
// recherche par titre ou artiste ; filtres Trouvés / Ratés ; un seul appel au serveur ; historique en panne sans casser
// le jeu ; 360 px sans défilement horizontal ; aucune erreur JS. Faux Supabase : fixtures/fake-sb-jeux3.mjs (23 manches).
const { check, finish, openPage, hscroll, log, sleep, chromium } = require('../../lib/harness.cjs');

const appels = async (p) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === 'hg_heardle_historique').length;
const lignes = (p) => p.locator('#jh-hist .jhh-ligne');

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-jeux3.mjs', hash: '#heardle', width: 1280, height: 900 });
  await p.waitForSelector('#jh-hist .jhh-ligne', { timeout: 6000 }).catch(() => {});
  check((await p.locator('#jhh-h').innerText()).includes('Historique du Heardle'), 'section : « Historique du Heardle » sous le jeu du jour');
  const stats = await p.locator('.jhh-stats').innerText();
  check(stats.includes('21 / 22') && stats.includes('2') && stats.includes('3 jours'), 'mes chiffres : 21 / 22 trouvés, moyenne, série de 3 jours');
  check(await lignes(p).count() === 3, 'liste : les 3 dernières manches au départ');
  check((await lignes(p).first().innerText()).includes('#23') && (await lignes(p).first().innerText()).includes('Tout va bien'), 'liste : la plus récente en tête (#23 Tout va bien)');
  check((await p.locator('.jhh-plus').innerText()).trim() === 'Voir tout l’historique (23 morceaux)', 'bouton : « Voir tout l’historique (23 morceaux) »');
  await p.click('.jhh-plus');
  check(await lignes(p).count() === 23 && (await p.locator('.jhh-plus').innerText()).includes('Réduire'), '« Voir tout » : les 23 manches, puis « Réduire aux 3 derniers »');
  await p.click('.jhh-plus');
  check(await lignes(p).count() === 3, '« Réduire » : de nouveau 3 manches');

  // Ouvrir la #23 : panneau déroulant
  const tete = p.locator('.jhh-tete[data-day]').first();
  check(await tete.getAttribute('aria-expanded') === 'false', 'ligne : fermée au départ (aria-expanded)');
  await tete.click();
  await sleep(100);
  check(await p.locator('.jhh-tete[data-day]').first().getAttribute('aria-expanded') === 'true', 'ligne : ouverte au clic');
  const pan = p.locator('.jhh-panneau').first();
  check(/joueurs/i.test(await pan.innerText()) && (await pan.locator('.jhh-chiffre b').first().innerText()) === '3', 'panneau : 3 joueurs');
  check((await pan.locator('.jhh-score').count()) === 3 && (await pan.locator('.jhh-score.is-me').count()) === 1, 'panneau : 3 scores, ma ligne marquée');
  check((await pan.locator('.jhh-score').first().innerText()).includes('Alice') && (await pan.locator('.jhh-score').first().innerText()).includes('1/6'), 'panneau : Alice en tête (1/6)');
  check((await pan.locator('.jhh-score').last().innerText()).includes('raté'), 'panneau : Bruno (tout passé) est « raté »');
  check((await pan.locator('.jhh-score.is-me .jhh-c.is-x').count()) === 2 && (await pan.locator('.jhh-score.is-me .jhh-c.is-ok').count()) === 1, 'panneau : mes carrés (2 erreurs puis trouvé)');
  check((await pan.locator('.jhh-yt').getAttribute('href')) === 'https://www.youtube.com/watch?v=VHoT4N43jK8&t=12s', 'panneau : « Réécouter » vers YouTube au bon instant');
  await p.locator('.jhh-tete[data-day]').first().click();
  check(!(await p.$('.jhh-panneau')), 'ligne : se referme au second clic');

  // Recherche et filtres
  await p.fill('#jhh-q', 'orelsan');
  await sleep(100);
  check(await lignes(p).count() === 1, 'recherche « orelsan » : une manche');
  await p.fill('#jhh-q', 'morceau 5');
  check(await lignes(p).count() === 1, 'recherche : cherche aussi au-delà des 3 dernières (« morceau 5 »)');
  check(await p.evaluate(() => document.activeElement?.id) === 'jhh-q', 'recherche : le champ garde le focus');
  await p.fill('#jhh-q', 'introuvable');
  check((await p.locator('.jhh-vide').innerText()).includes('Aucun morceau'), 'recherche sans résultat : message');
  await p.fill('#jhh-q', '');
  await p.click('.jhh-filtre[data-f="rates"]');
  check(await lignes(p).count() === 1 && (await lignes(p).first().innerText()).includes('#20'), 'filtre « Ratés » : la #20');
  check(await p.locator('.jhh-filtre[data-f="rates"]').getAttribute('aria-pressed') === 'true', 'filtre : aria-pressed');
  await p.click('.jhh-filtre[data-f="trouves"]');
  check(await lignes(p).count() === 21 && !(await p.$('.jhh-ligne:has-text("#21")')), 'filtre « Trouvés » : les 21 manches trouvées, sans la #21 non jouée');
  check(await appels(p) === 1, 'serveur : hg_heardle_historique appelé une seule fois');
  check(p.errs.length === 0, 'aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.screenshot({ path: __dirname + '/../../shots/heardle-historique.png', fullPage: true });
  await p.ctx.close();

  // Téléphone : 360 px, ligne ouverte, sans défilement horizontal
  p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-jeux3.mjs', hash: '#heardle', width: 360, height: 800, mobile: true });
  await p.waitForSelector('#jh-hist .jhh-ligne', { timeout: 6000 }).catch(() => {});
  await p.locator('.jhh-tete[data-day]').first().click();
  await sleep(100);
  check(!!(await p.$('.jhh-panneau')), '360 px : la ligne s’ouvre');
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal');
  const h = await p.locator('.jhh-tete').first().boundingBox();
  check(!!h && h.height >= 44, `360 px : ligne ≥ 44 px (${h && Math.round(h.height)})`);
  await p.screenshot({ path: __dirname + '/../../shots/heardle-historique-360.png', fullPage: true });
  await p.ctx.close();

  // Historique en panne : message, le jeu du jour reste jouable
  p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-jeux3.mjs', hash: '#heardle', width: 1280, scenario: { heardleHistErr: true } });
  await p.waitForSelector('#jh-hist .jhh', { timeout: 6000 }).catch(() => {});
  await sleep(300);
  check((await p.locator('#jh-hist').innerText()).includes('Historique indisponible'), 'en panne : « Historique indisponible »');
  check(!!(await p.$('#jh-play')), 'en panne : le jeu du jour reste là');
  await p.ctx.close();

  await browser.close();
  finish();
})();
