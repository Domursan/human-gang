// Parcours : idée S6 « Galerie Gartic Phone » (gartic.html) et vue admin « Gartic ».
// Liste des albums, carte « Dessin de l'année » (ouvre dans N jours / vote ouvert), album (chaîne mise en avant, phrases
// de départ et d'arrivée, réactions, bande de miniatures, visionneuse), dépôt d'un GIF (vignette fixe + fichier, RPC),
// vote (pas pour sa propre chaîne), nouvel album, admin (ouverture du vote, masquer). 360 px sans défilement horizontal.
// Faux Supabase : fixtures/fake-sb-contenu.mjs.  Lancer : node tests/parcours-s6-gartic.cjs
const { check, finish, openPage, adminSection, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

// GIF 1 × 1 (transparent)
const GIF = Buffer.from('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==', 'base64');

(async () => {
  const browser = await chromium.launch();
  const F = 'fake-sb-contenu.mjs';
  const rpcs = async (p, fn) => (await log(p)).filter((e) => e[0] === 'rpc' && e[1] === fn);

  /* ---------- Galerie ---------- */
  let p = await openPage(browser, { page: 'gartic', fixture: F, width: 360 });
  await p.waitForSelector('.gartic-album', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.gartic-album').count()) === 1 && (await p.locator('.gartic-album').innerText()).includes('3 chaînes'), 'galerie : un album, 3 chaînes');
  const vote = await p.locator('#gartic-vote').innerText();
  const dec = new Date().getMonth() === 11;
  check(vote.includes('Dessin de l’année') && (dec || vote.includes('Ouvre dans')), 'vote : carte « Dessin de l’année » (ouvre dans N jours hors décembre)');
  check((await hscroll(p)) <= 0, '360 px : pas de défilement horizontal (galerie)');
  check(p.errs.length === 0, 'galerie : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Album, vote ouvert ---------- */
  p = await openPage(browser, { page: 'gartic', fixture: F, width: 390, scenario: { voteOpen: true } });
  await p.goto(p.url().replace('gartic.html', 'gartic.html?album=gp-1'));
  await p.waitForSelector('.gartic-chain', { timeout: 5000 }).catch(() => {});
  check((await p.locator('.gartic-title').innerText()) === 'Soirée du 11 octobre', 'album : titre');
  // textContent : l'étiquette est en majuscules par CSS (innerText renverrait « 3 CHAÎNES »)
  check((await p.locator('.gartic-album-head .eyebrow').textContent()).includes('3 chaînes'), 'album : « Album · 3 chaînes »');
  check((await p.locator('.gartic-chain').innerText()).includes('Un canard qui fait ses impôts') && (await p.locator('.gartic-phr-end').innerText()).includes('Tzatzikistan'), 'chaîne : phrases de départ et d’arrivée');
  check((await p.locator('.gartic-pill').innerText()) === 'Chaîne 1 sur 3', 'chaîne : « Chaîne 1 sur 3 »');
  check((await p.locator('.gartic-chain .react-btn').count()) === 6, 'chaîne : réactions');
  check(!(await p.locator('.gartic-chain').innerText()).includes('Alice'), 'chaîne : pas de nom d’auteur');
  await p.click('.gartic-chain [data-vote]');
  await sleep(300);
  check((await rpcs(p, 'hg_gartic_vote')).length === 1 && (await p.locator('.gartic-chain [data-vote]').getAttribute('aria-pressed')) === 'true', 'vote : enregistré, bouton pressé');
  await p.click('[data-pick="2"]');
  await sleep(150);
  check((await p.locator('.gartic-pill').innerText()) === 'Chaîne 3 sur 3', 'miniatures : choisir la chaîne 3');
  check((await p.locator('.gartic-chain [data-vote]').count()) === 0 && (await p.locator('[data-remove]').count()) === 1, 'ma chaîne : pas de vote, « Retirer ma chaîne »');
  await p.click('.gartic-actions [data-anim]');
  await sleep(200);
  check((await p.locator('dialog.lightbox[open]').count()) === 1, 'Voir l’animation : visionneuse');
  await p.keyboard.press('Escape');
  /* Dépôt d'une chaîne */
  await p.click('[data-add]');
  await p.setInputFiles('#ga-f', { name: 'chaine.gif', mimeType: 'image/gif', buffer: GIF });
  await p.fill('#ga-s', 'Un chat astronaute');
  await p.fill('#ga-e', 'La lune est en fromage');
  await p.click('dialog[open] [type=submit]');
  await sleep(800);
  const ups = (await log(p)).filter((e) => e[0] === 'upload').map((e) => e[1]);
  check(ups.length === 2 && ups[0].startsWith('11111111-1111-4111-8111-111111111111/gartic/') && ups[0].endsWith('.gif') && /-v\.(webp|jpg)$/.test(ups[1]), 'dépôt : GIF et vignette fixe dans mon dossier');
  const add = (await rpcs(p, 'hg_gartic_add_chain')).pop();
  check(add && add[2].p_party === 'gp-1' && add[2].p_start === 'Un chat astronaute', 'dépôt : hg_gartic_add_chain');
  check((await p.locator('.gartic-pill').innerText()) === 'Chaîne 4 sur 4', 'dépôt : la nouvelle chaîne est affichée');
  check((await hscroll(p)) <= 0, '390 px : pas de défilement horizontal (album)');
  check(p.errs.length === 0, 'album : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- Fichier trop lourd ---------- */
  p = await openPage(browser, { page: 'gartic', fixture: F });
  await p.goto(p.url().replace('gartic.html', 'gartic.html?album=gp-1'));
  await p.waitForSelector('[data-add]', { timeout: 5000 }).catch(() => {});
  await p.click('[data-add]');
  await p.setInputFiles('#ga-f', { name: 'gros.gif', mimeType: 'image/gif', buffer: Buffer.alloc(8 * 1024 * 1024 + 10) });
  await p.fill('#ga-s', 'a'); await p.fill('#ga-e', 'b');
  await p.click('dialog[open] [type=submit]');
  await sleep(200);
  check((await p.locator('dialog[open] .form-error').innerText()).includes('8 Mo'), 'dépôt : plus de 8 Mo refusé');
  await p.ctx.close();

  /* ---------- Nouvel album ---------- */
  p = await openPage(browser, { page: 'gartic', fixture: F });
  await p.click('#gartic-new');
  await p.fill('#ga-t', 'Soirée test');
  await p.click('dialog[open] [type=submit]');
  await p.waitForURL(/album=/, { timeout: 5000 }).catch(() => {});
  check((await rpcs(p, 'hg_gartic_party_create')).length >= 0 && /album=/.test(p.url()), 'nouvel album : ouverture de l’album créé');
  await p.ctx.close();

  /* ---------- Admin ---------- */
  p = await openPage(browser, { page: 'admin', fixture: F });
  await adminSection(p, 'vie/souvenirs');
  await p.evaluate(() => { location.hash = 'vie/souvenirs/gartic'; });
  await p.waitForSelector('#ga-list .sv-row', { timeout: 5000 }).catch(() => {});
  check((await p.locator('#ga-list .sv-row').count()) === 3, 'admin : 3 chaînes');
  await p.selectOption('#ga-vote', 'ouvert');
  await sleep(200);
  check((await rpcs(p, 'hg_contenu_reglages_set')).pop()[2].p.gartic_vote === 'ouvert', 'admin : ouvrir le vote');
  await p.locator('#ga-list [data-ga]').first().click();
  await sleep(200);
  const h = (await rpcs(p, 'hg_gartic_hide')).pop();
  check(h && h[2].p_hidden === true, 'admin : masquer une chaîne');
  check(p.errs.length === 0, 'admin : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
