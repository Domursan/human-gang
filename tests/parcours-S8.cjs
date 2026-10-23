// Parcours : Playlist du gang (playlist.html), idée S8.
// Morceau de la semaine épinglé, morceaux de la semaine avec votes (pas pour son morceau), filtre par étiquette,
// lecteur chargé seulement au clic, partage d'un lien (liste blanche), 360 px, aucune erreur JS.
// Faux Supabase : fixtures/fake-sb-contenus.mjs.
const { SHOTS, check, finish, openPage, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');
const path = require('path');
const FX = 'fake-sb-contenus.mjs';

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'playlist', fixture: FX, width: 1280 });
  await p.waitForSelector('.pl-row', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#pl-winner').innerText()).includes('Mea Culpa'), 'morceau de la semaine épinglé : « Mea Culpa »');
  check((await p.locator('#pl-week .pl-row').count()) === 2, 'cette semaine : 2 morceaux');
  check((await p.locator('#pl-week').innerText()).includes('ton morceau'), 'mon morceau : pas de bouton de vote');
  check((await p.locator('#pl-week [data-vote]').count()) === 1, 'un seul bouton de vote (le morceau d’un autre)');
  check((await p.locator('iframe').count()) === 0, 'aucun lecteur tiers chargé avant un clic');
  check((await p.locator('#pl-hof li').count()) === 1, 'palmarès : 1 morceau de la semaine');
  // Vote
  await p.click('[data-vote="t-1"]');
  await sleep(400);
  const v = (await log(p)).filter((e) => e[1] === 'hg_track_vote');
  check(v.length === 1 && v[0][2].p_track === 't-1', 'vote : hg_track_vote pour le morceau choisi');
  check((await p.locator('[data-vote="t-1"]').getAttribute('aria-pressed')) === 'true' && (await p.locator('[data-vote="t-1"]').innerText()).includes('2 voix'), 'vote : bouton « Ton vote · 2 voix », aria-pressed');
  await p.click('[data-vote="t-1"]');
  await sleep(400);
  check((await log(p)).filter((e) => e[1] === 'hg_track_vote').pop()[2].p_track === null, 'revoter : retire le vote (p_track null)');
  // Filtre par étiquette
  await p.click('#pl-tags-f [data-tag="eurovision"]');
  check((await p.locator('#pl-week .pl-row').count()) === 1 && (await p.locator('#pl-week').innerText()).includes('Tattoo'), 'filtre « Eurovision » : un morceau');
  await p.click('#pl-tags-f [data-tag=""]');
  // Lecteur au clic
  await p.click('[data-play="t-1"]');
  await sleep(200);
  const src = await p.locator('.pl-player iframe').getAttribute('src');
  check(src === 'https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ', 'écouter ici : lecteur YouTube sans cookie, chargé au clic');
  check((await p.locator('[data-play="t-1"]').getAttribute('aria-expanded')) === 'true', 'écouter ici : aria-expanded');
  // Partage
  await p.click('#pl-add');
  await p.fill('#pa-url', 'http://evil.example/x');
  await p.fill('#pa-title', 'Faux');
  await p.click('dialog.ct-dialog button[type="submit"]');
  check((await p.locator('.ct-dlg-err').innerText()).includes('Lien non accepté'), 'partage : lien hors liste blanche refusé côté site');
  await p.fill('#pa-url', 'https://open.spotify.com/track/abc123');
  await p.fill('#pa-title', 'Thème Pokémon');
  await p.fill('#pa-tag', 'jeux');
  await p.click('dialog.ct-dialog button[type="submit"]');
  await sleep(400);
  const add = (await log(p)).filter((e) => e[1] === 'hg_track_add');
  check(add.length === 1 && add[0][2].p_title === 'Thème Pokémon' && add[0][2].p_tag === 'jeux', 'partage : hg_track_add avec titre et étiquette');
  check((await p.locator('#pl-week .pl-row').count()) === 3, 'partage : le morceau apparaît dans la semaine');
  check((await p.locator('#pl-week-info').innerText()).includes('Il te reste 1 partage'), 'partage : compteur du jour « Il te reste 1 partage »');
  check(p.errs.length === 0, 'aucune erreur JS ni 404' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  for (const w of [360, 390]) {
    p = await openPage(browser, { page: 'playlist', fixture: FX, width: w, height: 900 });
    await p.waitForSelector('.pl-row', { timeout: 5000 }).catch(() => {});
    check(await hscroll(p) <= 0, `${w} px : pas de défilement horizontal`);
    await p.screenshot({ path: path.join(SHOTS, `S8-${w}.png`), fullPage: true }).catch(() => {});
    check(p.errs.length === 0, `${w} px : aucune erreur JS` + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
    await p.ctx.close();
  }
  await browser.close();
  finish();
})();
