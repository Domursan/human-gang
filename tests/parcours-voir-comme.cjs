// Parcours : « Voir le site comme un membre » (admin/fiche + core/view-as.js, pages-access.js, header.js, init.js).
// (a) ordinateur 1280 px : Membres › Comptes, clic sur Alice dans la liste, bouton « Voir le site comme Alice » dans la fiche ;
//     hg_admin_view_as appelée pour Alice, la vue est gardée dans sessionStorage « hg_view_as », le site s'ouvre dans le même onglet ;
//     bandeau « Tu vois le site comme Alice · … », menus réduits aux pages d'Alice (pas de « Le jeu de cartes », pas de « Jeux »,
//     « Questions du gang » sous Autres) ; Admin, Staff et Sans limite masqués ; une page réservée (cartes.html) renvoie à l'accueil ;
//     « Revenir au panel » efface la vue et ouvre admin.html#place/comptes. Ouvrir admin.html à la main efface aussi la vue.
// (b) téléphone 390 px : bandeau visible, sans défilement horizontal, cible « Revenir au panel » ≥ 44 px.
// (c) non-admin avec la clé : la clé est ignorée et effacée (aucun bandeau, menus et pages normaux, pas d'accès à cartes.html).
// Faux Supabase (fixtures/fake-sb.mjs : hg_admin_view_as, hg_my_pages, hg_pages). Captures : tests/shots/voir-comme-*.png.
// Lancer : node tests/parcours-voir-comme.cjs
const path = require('path');
const { SHOTS, ORIGIN, PREFIX, check, finish, openPage, adminSection, hscroll, sleep, chromium } = require('./lib/harness.cjs');

/** Identifiant de test du membre n (U(2) = Alice, comme dans le faux client). */
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
/** Clé sessionStorage de la vue. */
const KEY = 'hg_view_as';
/** Vue telle que la rend hg_admin_view_as pour un membre sans accès à la page cartes (test (c) : cartes est seulement dans la clé). */
const VUE_CARTES = { id: U(2), pseudo: 'Alice', is_admin: false, roles: [], pages: [{ slug: 'cartes', label: 'Cartes à collectionner', in_nav: true, sort: 8 }] };

/** Lit la clé de vue dans la page (objet, ou null). */
const cle = (p) => p.evaluate((k) => { try { return JSON.parse(sessionStorage.getItem(k) || 'null'); } catch { return 'illisible'; } }, KEY);
/** Texte visible de la barre de menus. */
const menus = (p) => p.evaluate(() => document.querySelector('#site-nav')?.textContent.replace(/\s+/g, ' ').trim() || '');
/** Vrai si le bandeau « vue comme » est affiché. */
const bandeau = (p) => p.evaluate(() => { const b = document.querySelector('.view-as-bar'); return !!b && b.getClientRects().length > 0; });
/** Attend le bandeau (ou sa disparition) : true si l'état voulu est atteint. */
const attendBandeau = (p, want = true) => p.waitForFunction((w) => {
  const b = document.querySelector('.view-as-bar');
  const vis = !!b && b.getClientRects().length > 0;
  return vis === w;
}, want, { timeout: 6000 }).then(() => true, () => false);
/** Va à une adresse du site (même onglet, même origine) et laisse la page s'initialiser. */
async function aller(p, chemin) { await p.goto(`${ORIGIN}${PREFIX}/${chemin}`); await sleep(1200); }
/** Pose la clé de vue dans l'onglet courant, puis recharge la page pour qu'elle soit lue. */
async function poser(p, valeur) {
  await p.evaluate(([k, v]) => sessionStorage.setItem(k, JSON.stringify(v)), [KEY, valeur]);
  await p.reload();
  await sleep(1200);
}

(async () => {
  const browser = await chromium.launch();
  try {
    /* (a) Bureau 1280 px : de la fiche d'Alice au site vu comme elle, puis retour au panel */
    {
      const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
      await adminSection(p, 'place/comptes');
      await p.click(`#shell-col-list .ui-row[data-id="${U(2)}"]`);
      await p.waitForFunction(() => document.querySelector('#acc-dh .ui-dhead-t')?.textContent.includes('Alice'), null, { timeout: 8000 }).catch(() => {});
      const bouton = p.locator('#acc-dh .ui-btn', { hasText: 'Voir le site comme Alice' });
      check(await bouton.count() === 1, '(a) fiche d’Alice : bouton « Voir le site comme Alice » (dans l’en-tête)');
      await p.screenshot({ path: path.join(SHOTS, 'voir-comme-fiche.png') });
      check(await p.locator('#acc-dh .ui-btn', { hasText: 'Fermer la fiche' }).count() === 1, '(a) bouton « Fermer la fiche » toujours là');
      check(await p.evaluate(() => sessionStorage.getItem('hg_view_as')) === null, '(a) avant le clic : aucune vue gardée');
      await bouton.click();
      await p.waitForURL(/accueil\.html$/, { timeout: 8000 }).catch(() => {});
      check(/accueil\.html$/.test(p.url()), '(a) clic : le site s’ouvre dans le même onglet (accueil.html)');
      await attendBandeau(p, true);
      const gardee = await cle(p);
      check(gardee && gardee.id === U(2) && gardee.pseudo === 'Alice', '(a) vue gardée dans sessionStorage « hg_view_as » pour Alice (rpc appelée avec son identifiant)');
      check(gardee && Array.isArray(gardee.pages) && !gardee.pages.some((x) => x.slug === 'cartes' || x.slug === 'jeux'), '(a) pages gardées : pas de cartes ni de jeux (réservés à l’admin)');
      check(await bandeau(p), '(a) bandeau « vue comme » affiché');
      const texteBandeau = await p.textContent('.view-as-bar');
      check(texteBandeau.includes('Tu vois le site comme Alice') && texteBandeau.includes('les pages et les menus sont les siens, les données restent les tiennes') && texteBandeau.includes('Revenir au panel'),
        '(a) bandeau : « Tu vois le site comme Alice · … · Revenir au panel »');
      check(await p.getAttribute('html', 'data-view-as') === 'on', '(a) html[data-view-as] posé (contenu décalé sous le bandeau)');
      const m = await menus(p);
      check(m.includes('IRL') && m.includes('Calendrier'), '(a) menus : IRL et Calendrier (pages d’Alice)');
      check(!m.includes('Le jeu de cartes') && !m.includes('Jeux'), '(a) menus : ni « Le jeu de cartes » ni « Jeux » (pages réservées à l’admin)');
      check(m.includes('Questions du gang'), '(a) menu « Autres » : « Questions du gang » (page en menu, accessible à Alice)');
      check(await p.evaluate(() => document.querySelector('.nav-admin')?.closest('.fan-li')?.hidden === true), '(a) entrée « Admin » du menu en arc masquée pendant la vue');
      check(await p.evaluate(() => document.querySelector('.nav-god') === null), '(a) « Sans limite » absent pendant la vue');
      check(await p.evaluate(() => document.documentElement.dataset.godmode !== 'on'), '(a) mode sans limite coupé pendant la vue');
      check(await hscroll(p) === 0, '(a) pas de défilement horizontal (1280 px)');
      check(!p.errs.length, '(a) accueil vu comme Alice : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      await p.screenshot({ path: path.join(SHOTS, 'voir-comme-1280.png') });

      // Une page réservée à l’admin (cartes) renvoie à l’accueil, comme pour Alice
      await aller(p, 'cartes.html');
      await p.waitForFunction(() => document.body.innerText.includes('Tu n’as pas accès') || document.body.innerText.includes("Tu n'as pas accès"), null, { timeout: 6000 }).catch(() => {});
      check(/accueil\.html$/.test(p.url()) && (await p.textContent('body')).includes('Cartes à collectionner'), '(a) cartes.html : renvoi à l’accueil avec le refus « Cartes à collectionner », comme pour Alice');
      check(await bandeau(p), '(a) après le renvoi : le bandeau reste');

      // Revenir au panel : efface la vue, ouvre le panel sur les comptes
      await p.click('.view-as-back');
      await p.waitForURL(/admin\.html#membres\/comptes$/, { timeout: 8000 }).catch(() => {});
      check(/admin\.html#membres\/comptes$/.test(p.url()), '(a) « Revenir au panel » : admin.html#place/comptes');
      check(await p.evaluate((k) => sessionStorage.getItem(k), KEY) === null, '(a) « Revenir au panel » : la vue est effacée');
      check(!(await bandeau(p)) && await p.locator('.view-as-bar').count() === 0, '(a) panel : aucun bandeau');
      check(await p.locator('#app .admin-section, #shell').count() > 0 && !p.errs.length, '(a) panel : retour sans erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

      // Ouvrir le panel à la main pendant une vue efface aussi la vue
      await aller(p, 'accueil.html');
      await poser(p, { id: U(2), pseudo: 'Alice', is_admin: false, roles: [], pages: [] });
      await aller(p, 'admin.html');
      check(await p.evaluate((k) => sessionStorage.getItem(k), KEY) === null, '(a) admin.html ouvert à la main : la vue est effacée');
      check(await p.locator('.view-as-bar').count() === 0, '(a) admin.html ouvert à la main : pas de bandeau');
      await p.ctx.close();
    }

    /* (b) Téléphone 390 px : bandeau, sans défilement horizontal */
    {
      // Admin (compte par défaut du faux client) : la vue est posée comme le ferait le bouton, puis rechargée en 390 px
      const p = await openPage(browser, { page: 'accueil', width: 390, height: 844, mobile: true, dpr: 2 });
      await poser(p, { id: U(2), pseudo: 'Alice', is_admin: false, roles: [], pages: [
        { slug: 'irl', label: 'IRL', in_nav: true, sort: 3 }, { slug: 'historique', label: 'Historique', in_nav: true, sort: 4 }] });
      check(await attendBandeau(p, true), '(b) 390 px : bandeau affiché');
      const bouton = await p.evaluate(() => { const r = document.querySelector('.view-as-back').getBoundingClientRect(); return { h: r.height, w: r.width }; });
      check(bouton.h >= 44, `(b) 390 px : « Revenir au panel » ≥ 44 px de haut (${Math.round(bouton.h)} px)`);
      const haut = await p.evaluate(() => Math.round(document.querySelector('.view-as-bar').getBoundingClientRect().height));
      check(haut <= 140, `(b) 390 px : bandeau compact (${haut} px)`);
      check(await hscroll(p) === 0, '(b) 390 px : pas de défilement horizontal');
      check(await p.evaluate(() => { const r = document.querySelector('.view-as-bar').getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth + 0.5; }), '(b) 390 px : bandeau dans l’écran');
      check(await p.evaluate(() => document.querySelector('.site-header').getBoundingClientRect().top >= document.querySelector('.view-as-bar').getBoundingClientRect().bottom - 1), '(b) 390 px : l’en-tête passe sous le bandeau, rien ne le recouvre');
      await p.screenshot({ path: path.join(SHOTS, 'voir-comme-390.png') });
      check(!p.errs.length, '(b) 390 px : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      await p.ctx.close();
    }

    /* (c) Non-admin avec la clé : ignorée et effacée */
    {
      const p = await openPage(browser, { page: 'accueil', width: 1280, height: 900, scenario: { uid: U(2) } });
      await poser(p, VUE_CARTES);
      check(await cle(p) === null, '(c) non-admin : la clé est effacée');
      check(!(await bandeau(p)) && await p.locator('.view-as-bar').count() === 0, '(c) non-admin : aucun bandeau');
      check(!(await menus(p)).includes('Le jeu de cartes'), '(c) non-admin : pas de « Le jeu de cartes » (la clé ne donne aucune page)');
      await aller(p, 'cartes.html');
      await p.waitForFunction(() => document.body.innerText.includes('Tu n’as pas accès') || document.body.innerText.includes("Tu n'as pas accès"), null, { timeout: 6000 }).catch(() => {});
      check(/accueil\.html$/.test(p.url()) && (await p.textContent('body')).includes('Cartes à collectionner'), '(c) non-admin : cartes.html reste refusée (renvoi à l’accueil)');
      check(await p.evaluate(() => document.documentElement.dataset.viewAs) === undefined, '(c) non-admin : pas de contenu décalé pour une vue');
      check(!p.errs.length, '(c) non-admin : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
      await p.ctx.close();
    }
  } finally {
    await browser.close();
  }
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
