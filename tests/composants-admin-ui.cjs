// Tests des composants admin/ui (liste, fil, panneau d'infos, en-tête de détail) sur la page de démonstration
// tests/fixtures/admin-ui-demo.html, servie depuis le dépôt par un petit serveur local (les modules ES ne marchent pas en file://).
// Lancer : NODE_PATH=/home/claude/.npm-global/lib/node_modules PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers node tests/composants-admin-ui.cjs
const http = require('http');
const fs = require('fs');
const path = require('path');
const { ROOT, check, finish, chromium } = require('./lib/harness.cjs');

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.webp': 'image/webp' };

function serve() {
  return new Promise((resolve) => {
    const srv = http.createServer((req, res) => {
      const url = decodeURIComponent(req.url.split('?')[0]);
      const file = path.join(ROOT, url);
      if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
      fs.readFile(file, (err, data) => {
        if (err) { res.writeHead(404); return res.end('introuvable'); }
        res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

(async () => {
  const srv = await serve();
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await chromium.launch();
  const errs = [];
  const open = async (width, height) => {
    const ctx = await browser.newContext({ viewport: { width, height } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
    await p.goto(`${base}/tests/fixtures/admin-ui-demo.html`);
    await p.waitForFunction(() => window.__demo && document.querySelectorAll('.ui-row').length > 0);
    return { ctx, p };
  };
  const rowNames = (p) => p.$$eval('#list .ui-row', (els) => els.map((e) => e.getAttribute('aria-label').split(',')[0]));
  const counts = (p) => p.$$eval('#list .ui-chip', (els) => els.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  try {
    // ----- affichage et compteurs -----
    let { ctx, p } = await open(1440, 900);
    const c = await counts(p);
    check(c.join(' | ') === 'Toutes 6 | Ouvertes 3 | En cours 2', `compteurs des filtres : ${c.join(' | ')}`);
    check((await rowNames(p)).length === 6, 'six lignes affichées');
    check(await p.$eval('#list .ui-row.is-sel', (e) => e.getAttribute('aria-selected') === 'true'), 'la ligne active a aria-selected=true');
    check(await p.$eval('#dhead h2', (e) => e.textContent) === 'Carzy', 'en-tête de détail : Carzy au départ');

    // ----- recherche : casse et accents, délai 150 ms -----
    await p.fill('#list input[type=search]', 'ACCÈS');
    await sleep(260);
    let names = await rowNames(p);
    check(names.join(',') === 'Wae', `recherche « ACCÈS » (sans accents, casse ignorée) : ${names.join(',')}`);
    await p.fill('#list input[type=search]', 'paillettes');
    await sleep(260);
    names = await rowNames(p);
    check(names.join(',') === 'Carzy', `recherche « paillettes » dans le sujet : ${names.join(',')}`);
    await p.fill('#list input[type=search]', 'zzz');
    await sleep(260);
    check(await p.$eval('#list .ui-empty', (e) => !e.hidden && /Aucun résultat/.test(e.textContent)), 'état vide avec message « Aucun résultat »');
    await p.press('#list input[type=search]', 'Escape');
    await sleep(60);
    check((await rowNames(p)).length === 6, 'Échap vide la recherche');

    // ----- filtres en puces -----
    await p.click('#list [data-filter="open"]');
    names = await rowNames(p);
    check(names.length === 3 && (await p.$eval('#list [data-filter="open"]', (e) => e.getAttribute('aria-pressed'))) === 'true', `filtre « Ouvertes » : ${names.join(',')}`);
    await p.click('#list [data-filter="all"]');
    check((await rowNames(p)).length === 6, 'retour à « Toutes »');

    // ----- sélection clavier : recherche → ↓ → lignes, ↓ sélectionne, Entrée, Début/Fin -----
    await p.click('#list input[type=search]');
    await p.keyboard.press('ArrowDown');
    await sleep(30);
    check(await p.evaluate(() => document.activeElement?.getAttribute('role') === 'option'), 'ArrowDown depuis la recherche donne le focus à la première ligne');
    await p.keyboard.press('ArrowDown');
    await sleep(30);
    check(await p.$eval('#dhead h2', (e) => e.textContent) === 'Wae', 'ArrowDown sélectionne la ligne suivante (Wae)');
    await p.keyboard.press('Enter');
    check(await p.$eval('#list .ui-row.is-sel', (e) => e.dataset.id) === 't2', 'Entrée garde la ligne active');
    await p.keyboard.press('End');
    await sleep(30);
    check(await p.$eval('#dhead h2', (e) => e.textContent) === 'Mavi', 'Fin va à la dernière ligne (Mavi)');
    await p.keyboard.press('Home');
    await sleep(30);
    check(await p.$eval('#dhead h2', (e) => e.textContent) === 'Carzy', 'Début revient à la première ligne (Carzy)');
    await p.keyboard.press('ArrowDown');
    await p.keyboard.press('ArrowUp');
    check(await p.$eval('#dhead h2', (e) => e.textContent) === 'Carzy', 'ArrowUp revient à la ligne précédente');

    // ----- envoi d'un message (Ctrl+Entrée) -----
    const before = await p.$$eval('#thread .ui-msg', (els) => els.length);
    await p.click('#thread textarea');
    await p.keyboard.type('Test envoi depuis le fil');
    await p.keyboard.press('Control+Enter');
    await p.waitForFunction(() => [...document.querySelectorAll('#thread .ui-bubble')].some((b) => b.textContent === 'Test envoi depuis le fil'));
    const after = await p.$$eval('#thread .ui-msg', (els) => els.length);
    check(after === before + 1, `message envoyé avec Ctrl+Entrée : ${before} → ${after}`);
    check(await p.$eval('#thread .ui-msg:last-child', (e) => e.classList.contains('is-admin')), 'le message de l’admin est à droite (is-admin)');
    check(await p.$eval('#thread textarea', (e) => e.value === ''), 'zone de réponse vidée après envoi');

    // ----- note interne -----
    await p.click('#thread .ui-note-toggle');
    check(await p.$eval('#thread .ui-note-toggle', (e) => e.getAttribute('aria-pressed') === 'true'), 'bascule « Note interne » activée');
    await p.click('#thread textarea');
    await p.keyboard.type('Note pour l’équipe');
    await p.click('#thread .ui-send');
    await p.waitForFunction(() => [...document.querySelectorAll('#thread .ui-msg.is-note .ui-bubble')].some((b) => b.textContent === 'Note pour l’équipe'));
    check(true, 'note interne ajoutée avec la teinte dédiée (is-note)');
    await p.click('#thread .ui-note-toggle');

    // ----- changement de statut (en-tête et panneau) -----
    await p.selectOption('#dhead select', 'prog');
    await sleep(50);
    check(await p.$eval('#list .ui-row[data-id="t1"] .ui-pill', (e) => e.textContent) === 'En cours', 'statut changé depuis l’en-tête : la ligne affiche « En cours »');
    check(await p.evaluate(() => window.__demo.tickets[0].status.id) === 'prog', 'statut enregistré dans le modèle');
    check(await p.$eval('#info select', (e) => e.value) === 'prog', 'le panneau d’infos reflète le nouveau statut');
    await p.click('#dhead [data-primary]');
    await sleep(50);
    check(await p.evaluate(() => window.__demo.tickets[0].status.id) === 'done', 'bouton « Résoudre » passe la demande en « Résolue »');
    check(await p.$eval('#dhead select', (e) => e.value) === 'done', 'sélecteur de l’en-tête à « Résolue »');

    // ----- panneau d'infos : action -----
    await p.click('#info [data-action="0"]');
    check(await p.evaluate(() => window.__fiche) === 1, 'bouton « Ouvrir la fiche membre » déclenche son action');

    // ----- lots de 50 et « Afficher plus » -----
    await p.evaluate(() => {
      const many = Array.from({ length: 120 }, (_, i) => ({ id: 'x' + i, member: { pseudo: 'Membre' + i, color: '#7E93C9' }, title: 'Sujet ' + i, at: new Date(Date.now() - i * 60000), status: { id: 'open', label: 'Ouverte', tone: 'open' } }));
      window.__demo.list.update(many);
    });
    check((await rowNames(p)).length === 50, 'premier lot : 50 lignes');
    await p.click('#list .ui-more-btn');
    check((await rowNames(p)).length === 100, '« Afficher plus » ajoute le lot suivant (100 lignes)');
    await p.evaluate(() => window.__demo.list.select('x110'));
    check((await rowNames(p)).length === 120, 'select() sur un élément hors lot affiche le lot nécessaire');
    await ctx.close();

    // ----- mobile 390 px : pas de défilement horizontal, navigation en piles -----
    ({ ctx, p } = await open(390, 844));
    const hs = await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(hs <= 0, `390 px : pas de défilement horizontal (${hs})`);
    await p.click('#list .ui-row:nth-child(2)');
    check(await p.$eval('#dhead h2', (e) => e.textContent) === 'Wae' && (await p.evaluate(() => document.body.dataset.screen)) === 'detail', 'mobile : toucher une ligne ouvre le détail');
    await ctx.close();

    // ----- formats de dates (time.js) et repli des accents (common.js) -----
    ({ ctx, p } = await open(1440, 900));
    const t = await p.evaluate(async () => {
      const time = await import('/assets/js/admin/ui/time.js');
      const common = await import('/assets/js/admin/ui/common.js');
      const now = new Date(2026, 9, 21, 15, 0, 0);
      const ago = (ms) => new Date(now.getTime() - ms);
      return {
        instant: time.relTime(ago(20_000), now),
        min: time.relTime(ago(12 * 60000), now),
        hour: time.relTime(ago(3600000 + 60000), now),
        hier: time.relTime(new Date(2026, 9, 20, 9, 0), now),
        jours: time.relTime(new Date(2026, 9, 18, 9, 0), now),
        date: time.relTime(new Date(2026, 8, 3, 9, 0), now),
        seen: time.seenAgo(ago(2 * 3600000), now),
        clock: time.clock(new Date(2026, 9, 21, 14, 18)),
        fold: common.fold('Éléphant Ça'),
      };
    });
    check(t.instant === "à l'instant", `relTime < 1 min : « ${t.instant} »`);
    check(t.min === '12 min', `relTime 12 min : « ${t.min} »`);
    check(t.hour === '1 h', `relTime 1 h : « ${t.hour} »`);
    check(t.hier === 'Hier', `relTime hier : « ${t.hier} »`);
    check(t.jours === '3 j', `relTime 3 j : « ${t.jours} »`);
    check(/3 sept\./.test(t.date), `relTime date courte : « ${t.date} »`);
    check(t.seen === 'Vu il y a 2 h', `seenAgo : « ${t.seen} »`);
    check(t.clock === '14:18', `clock : « ${t.clock} »`);
    check(t.fold === 'elephant ca', `fold : « ${t.fold} »`);
    await ctx.close();

    check(errs.length === 0, `aucune erreur JavaScript ou console${errs.length ? ' : ' + errs.join(' | ') : ''}`);
  } catch (e) {
    check(false, 'exécution du test : ' + e.message);
  } finally {
    await browser.close();
    srv.close();
    finish();
  }
})();
