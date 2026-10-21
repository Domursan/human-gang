// Parcours : « qui a offert à qui » des éditions Secret Santa.
// Historique (historique.html, bloc dépliable sur chaque édition affichée) et page Secret Santa (édition la plus récente).
// Règles vérifiées : les paires d'une édition terminée s'affichent, dans l'ordre de la chaîne ; celles d'une édition en
// cours (envoi) ne s'affichent jamais ; une édition terminée sans paires n'affiche rien ; une seule requête hg_ss_reveal
// par édition affichée. Faux Supabase (fixtures/fake-sb.mjs) : on vérifie ce que le client affiche, pas la base.
// Captures : tests/shots/ (ignoré par git). Lancer : node tests/parcours-ss-paires.cjs
const path = require('path');
const { SHOTS, check, finish, openPage, hscroll, log, chromium } = require('./lib/harness.cjs');

// Ordre attendu de la boucle 2023 : Ethan → Léa, Léa → Bruno, Bruno → Tom, Tom → Nina, Nina → Ethan.
// Le départ est le premier donneur par ordre alphabétique (Bruno), puis on suit les receveurs.
const CHAIN_2023 = [['Bruno', 'Tom'], ['Tom', 'Nina'], ['Nina', 'Ethan'], ['Ethan', 'Léa'], ['Léa', 'Bruno']];
const CHAIN_2024 = [['Alice', 'Ethan'], ['Ethan', 'Alice']];
const CHAIN_2025 = [['Alice', 'Chloé'], ['Chloé', 'David'], ['David', 'Emma'], ['Emma', 'Alice']];

// Éditions : 2025 en inscriptions, 2024 et 2023 terminées (2023 vient du scénario, pas de la liste par défaut).
const EDITIONS = [
  { id: 'E25', year: 2025, status: 'inscriptions', budget: '20 CHF', drawn_at: null, shared_fields: [] },
  { id: 'E24', year: 2024, status: 'termine', budget: '20 CHF', drawn_at: null, shared_fields: [] },
  { id: 'E23', year: 2023, status: 'termine', budget: '20 CHF', drawn_at: null, shared_fields: [] },
];

// Lit les paires affichées d'une édition : [donneur, receveur] dans l'ordre du DOM.
const pairsOf = (p, edition) => p.evaluate((ed) => {
  const root = document.querySelector(`[data-edition="${ed}"]`) || document.querySelector('#ss-reveal');
  if (!root) return null;
  return [...root.querySelectorAll('.ssp-item')].map((li) => [...li.querySelectorAll('.ssp-name')].map((n) => n.textContent));
}, edition);

const revealCalls = (journal) => journal.filter((l) => l[0] === 'rpc' && l[1] === 'hg_ss_reveal').map((l) => l[2].p_edition);

(async () => {
  const browser = await chromium.launch();

  /* 1. Historique : éditions 2023 et 2024 terminées, 2025 en inscriptions (absente de la frise). */
  {
    const p = await openPage(browser, { page: 'historique', width: 1280, scenario: { editions: EDITIONS } });
    await p.waitForSelector('[data-edition="E23"]', { timeout: 8000 }).catch(() => {});
    check(!(await p.$('[data-edition="E25"]')), 'historique : l\'édition en cours (2025, inscriptions) n\'a aucun bloc de paires');
    check(!(await p.$('#timeline .tl-card-ss:has-text("2025")')), 'historique : pas de carte pour l\'édition 2025');
    const calls = revealCalls(await log(p));
    check(calls.length === 2 && calls.includes('E23') && calls.includes('E24') && !calls.includes('E25'),
      `historique : une requête hg_ss_reveal par édition affichée (${calls.join(', ')})`);

    const sum23 = await p.$('[data-edition="E23"] > summary');
    check(!!sum23, 'historique 2023 : bloc dépliable présent');
    check((await sum23.textContent()).trim() === 'Qui a offert à qui ?', 'historique : libellé « Qui a offert à qui ? » pour une édition terminée');
    check(!(await p.$eval('[data-edition="E23"]', (d) => d.open)), 'historique : le bloc est replié par défaut');
    await sum23.click();
    const rows23 = await pairsOf(p, 'E23');
    check(JSON.stringify(rows23) === JSON.stringify(CHAIN_2023), `historique 2023 : paires dans l'ordre de la chaîne (${JSON.stringify(rows23)})`);
    check(await p.$eval('[data-edition="E23"] .ssp-list', (ol) => ol.getAttribute('aria-label') === 'Chaîne des cadeaux'), 'historique : liste étiquetée « Chaîne des cadeaux »');
    check(await p.$eval('[data-edition="E23"]', (d) => d.querySelectorAll('.ssp-item .avatar').length === 10), 'historique 2023 : chaque personne a un avatar (initiales pour les fantômes)');
    check(await p.$eval('[data-edition="E23"]', (d) => !d.querySelector('.ssp-item .avatar img')), 'historique 2023 : aucun avatar image (fantômes sans avatar pour un membre)');
    check(await p.$eval('[data-edition="E23"]', (d) => d.querySelectorAll('.ssp-item.is-chain-start').length === 0), 'historique 2023 : une seule boucle, aucune rupture de chaîne');
    check((await p.$eval('[data-edition="E23"]', (d) => d.querySelectorAll('.ssp-item.is-me').length)) === 2, 'historique 2023 : mes deux lignes sont surlignées');

    await p.$eval('[data-edition="E24"] > summary', (s) => s.click());
    check(JSON.stringify(await pairsOf(p, 'E24')) === JSON.stringify(CHAIN_2024), 'historique 2024 : Alice → Ethan puis Ethan → Alice');

    await p.setViewportSize({ width: 1280, height: 900 });
    await p.screenshot({ path: path.join(SHOTS, 'ss-paires-historique-1280.png'), fullPage: true });
    check(await hscroll(p) <= 0, 'historique 1280 : pas de défilement horizontal');
    check(!p.errs.length, 'historique 1280 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* 2. Historique en mobile 375 px : même contenu, sans défilement horizontal. */
  {
    const p = await openPage(browser, { page: 'historique', width: 375, scenario: { editions: EDITIONS } });
    await p.waitForSelector('[data-edition="E23"]', { timeout: 8000 }).catch(() => {});
    await p.$eval('[data-edition="E23"] > summary', (s) => s.click());
    await p.waitForTimeout(300);
    check(JSON.stringify(await pairsOf(p, 'E23')) === JSON.stringify(CHAIN_2023), 'historique 375 : paires 2023 affichées');
    check(await hscroll(p) <= 0, 'historique 375 : pas de défilement horizontal');
    await p.locator('[data-edition="E23"]').scrollIntoViewIfNeeded();
    await p.screenshot({ path: path.join(SHOTS, 'ss-paires-historique-375.png'), fullPage: true });
    check(!p.errs.length, 'historique 375 : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* 3. Édition en cours (envoi) et édition terminée sans paires. Le faux répond selon le statut, comme la base. */
  {
    const editions = [
      { id: 'E25', year: 2025, status: 'envoi', budget: '20 CHF', drawn_at: null, shared_fields: [] },
      { id: 'E24', year: 2024, status: 'termine', budget: '20 CHF', drawn_at: null, shared_fields: [] },
      { id: 'E22', year: 2022, status: 'termine', budget: null, drawn_at: null, shared_fields: [] },
    ];
    const h = await openPage(browser, { page: 'historique', width: 1280, scenario: { editions } });
    await h.waitForSelector('[data-edition="E24"]', { timeout: 8000 }).catch(() => {});
    check(!(await h.$('[data-edition="E25"]')), 'édition en cours (envoi) : aucun bloc sur l\'historique');
    check(!(await h.$('[data-edition="E22"]')), 'édition 2022 terminée sans paires : aucun bloc');
    check(!revealCalls(await log(h)).includes('E25'), 'édition en cours : aucune requête de paires');
    check(!!(await h.$('[data-edition="E24"]')), 'édition 2024 terminée : bloc présent');
    check(!h.errs.length, 'historique (envoi/2022) : aucune erreur JS' + (h.errs.length ? ' (' + h.errs.join(' | ') + ')' : ''));
    await h.ctx.close();

    const s = await openPage(browser, { page: 'secret-santa', width: 1280, scenario: { editions } });
    await s.waitForSelector('#app .page-title', { timeout: 8000 }).catch(() => {});
    check(!(await s.$('#ss-reveal')), 'page Secret Santa, édition en cours (envoi) : pas de révélation');
    check(!(await s.$('.ssp-list')), 'page Secret Santa, édition en cours : aucune paire affichée');
    check(!revealCalls(await log(s)).length, 'page Secret Santa, édition en cours : aucune requête hg_ss_reveal');
    check(!s.errs.length, 'page Secret Santa (envoi) : aucune erreur JS' + (s.errs.length ? ' (' + s.errs.join(' | ') + ')' : ''));
    await s.ctx.close();
  }

  /* 4. Page Secret Santa : la dernière édition est terminée, la révélation affiche la chaîne. */
  {
    const editions = [{ id: 'E25', year: 2025, status: 'termine', budget: '20 CHF', drawn_at: null, shared_fields: [] }];
    const s = await openPage(browser, { page: 'secret-santa', width: 1280, scenario: { editions } });
    await s.waitForSelector('#ss-reveal', { timeout: 8000 }).catch(() => {});
    check((await s.textContent('#ss-reveal-t')).trim() === 'Qui a offert à qui', 'page Secret Santa terminée : titre « Qui a offert à qui »');
    check(JSON.stringify(await pairsOf(s, undefined)) === JSON.stringify(CHAIN_2025), 'page Secret Santa terminée : paires dans l\'ordre de la chaîne');
    check(await s.$eval('#ss-reveal .ssp-list', (ol) => ol.getAttribute('aria-label') === 'Chaîne des cadeaux'), 'page Secret Santa : liste étiquetée « Chaîne des cadeaux »');
    await s.screenshot({ path: path.join(SHOTS, 'ss-paires-secret-santa-1280.png'), fullPage: true });
    check(await hscroll(s) <= 0, 'page Secret Santa 1280 : pas de défilement horizontal');
    await s.ctx.close();

    const m = await openPage(browser, { page: 'secret-santa', width: 375, scenario: { editions } });
    await m.waitForSelector('#ss-reveal', { timeout: 8000 }).catch(() => {});
    check(await hscroll(m) <= 0, 'page Secret Santa 375 : pas de défilement horizontal');
    await m.locator('#ss-reveal').scrollIntoViewIfNeeded();
    await m.screenshot({ path: path.join(SHOTS, 'ss-paires-secret-santa-375.png'), fullPage: true });
    check(!m.errs.length, 'page Secret Santa 375 : aucune erreur JS' + (m.errs.length ? ' (' + m.errs.join(' | ') + ')' : ''));
    await m.ctx.close();
  }

  await browser.close();
  finish();
})();
