// Parcours : hors gestion des comptes, l'admin ne montre que les comptes actifs (/pages/admin/admin.html).
// Un fantôme présent dans le faux Supabase n'apparaît ni dans Jeu de cartes › Joueurs, ni dans les choix :
// palette « Aller à… » (Ctrl/Cmd+K), éditeur de carte (membre lié), ajout de présence et votes des sorties,
// auteur des souvenirs et filtre des réactions, exclusions Secret Santa.
// Historique conservé : une présence déjà enregistrée à une sortie garde le fantôme, et une carte déjà liée
// à un fantôme reste éditable avec la mention « (fantôme) ».
// Aucune erreur console. Lancer : node tests/parcours/admin/parcours-admin-actifs.cjs
const { check, finish, openPage, adminSection, chromium } = require('../../lib/harness.cjs');

const GHOST = '00000077-0000-4000-8000-000000000077';
const EV = 'eeeeeeee-0000-4000-8000-0000000000aa'; // sortie à venir avec une présence du fantôme (historique)
const EV2 = 'eeeeeeee-0000-4000-8000-0000000000ab'; // sortie à venir sans présence du fantôme (choix)
const drawer = 'dialog.ui-drawer[open]';
/** Ferme le tiroir ouvert en cliquant sur son bouton de fermeture. */
const closeDrawer = (p) => p.click(`${drawer} .ui-drawer-foot [data-drawer-close]`);
/** Textes (espaces réduits) des éléments qui correspondent au sélecteur sel. */
const texts = (p, sel) => p.$$eval(sel, (els) => els.map((e) => e.textContent.trim()));
/** Horodatage ISO actuel, pour les données créées pendant le test. */
const now = () => new Date().toISOString();

(async () => {
  const browser = await chromium.launch();

  /* ---------- 1. Jeu de cartes : Joueurs et éditeur de carte (faux cartes) ---------- */
  {
    const p = await openPage(browser, { page: 'admin', fixture: 'fake-sb-cartes.mjs', width: 1440, height: 900 });
    // Le fantôme est un profil de hg_profiles (is_ghost = true) ; une carte Membre lui est liée (historique).
    await p.evaluate(({ g, now }) => {
      const DB = window.__DB;
      DB.hg_profiles.push({ id: g, pseudo: 'Léa', is_admin: false, color: '#8F5F4F', avatar_url: null, created_at: now, joined_on: null, birthday: null, is_ghost: true });
      const base = DB.hg_cards[0];
      DB.hg_cards.push({ ...base, id: 'carte-lea', set_id: DB.hg_card_sets[0].id, number: 90, name: 'Carte Léa', family: 'membre', rarity: 'commune', member_id: g, active: true, max_copies: null, image_url: null });
    }, { g: GHOST, now: now() });

    await adminSection(p, 'fabrique/joueurs');
    await p.waitForSelector('#shell-col .ui-row', { timeout: 8000 });
    const joueurs = await texts(p, '#shell-col .ui-row');
    check(joueurs.some((t) => t.includes('Alice')), 'joueurs : les comptes actifs sont listés (Alice)');
    check(!joueurs.some((t) => t.includes('Léa')), 'joueurs : le fantôme Léa n\'apparaît pas dans la liste');

    await adminSection(p, 'fabrique/cartes');
    await p.click('[data-act="card-new"]');
    await p.waitForSelector(`${drawer} #acc-member`, { timeout: 5000 });
    const neuve = await texts(p, '#acc-member option');
    check(neuve.includes('Alice') && !neuve.some((t) => t.includes('Léa')), 'éditeur (nouvelle carte) : « Membre lié » sans fantôme');
    await closeDrawer(p);
    await p.waitForSelector(drawer, { state: 'detached', timeout: 5000 }).catch(() => {});

    await p.click('[data-act="card-edit"][data-id="carte-lea"]');
    await p.waitForSelector(`${drawer} #acc-member`, { timeout: 5000 });
    const liee = await p.$$eval('#acc-member option', (os) => os.filter((o) => o.textContent.includes('(fantôme)'))
      .map((o) => ({ value: o.value, selected: o.selected, text: o.textContent })));
    check(liee.length === 1 && liee[0].value === GHOST && liee[0].selected, 'éditeur (carte liée) : le fantôme déjà lié reste choisi, mention « (fantôme) »');
    const autres = (await texts(p, '#acc-member option')).filter((t) => t.includes('(fantôme)')).length;
    check(autres === 1, 'éditeur (carte liée) : aucun autre fantôme proposé');
    await closeDrawer(p);
    check(p.errs.length === 0, `cartes : aucune erreur console${p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''}`);
    await p.close();
  }

  /* ---------- 2. Palette, sorties, souvenirs, Secret Santa (faux principal, un fantôme dans hg_admin_ghosts) ---------- */
  {
    const ghost = { id: GHOST, pseudo: 'Léa', avatar_url: null, color: '#8F5F4F', invite_code: null, invite_expires_at: null, created_at: now() };
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { ghosts: [ghost] } });
    // Historique : une présence déjà enregistrée à une sortie, et une participation Secret Santa 2025.
    await p.evaluate(({ g, ev, ev2, t }) => {
      window.__DB.hg_events.push({ id: ev, title: 'Raclette au chalet', description: null, location: 'Villars', starts_at: new Date(Date.now() + 10 * 864e5).toISOString(), cover_path: null, created_by: '11111111-1111-4111-8111-111111111111', created_at: t, retro: false });
      window.__DB.hg_events.push({ id: ev2, title: 'Fondue du mardi', description: null, location: 'Morges', starts_at: new Date(Date.now() + 20 * 864e5).toISOString(), cover_path: null, created_by: '11111111-1111-4111-8111-111111111111', created_at: t, retro: false });
      window.__DB.hg_event_rsvps.push({ event_id: ev, user_id: g, status: 'oui', created_at: t });
      window.__DB.hg_ss_participants.push({ edition_id: 'E25', user_id: g, joined_at: t });
    }, { g: GHOST, ev: EV, ev2: EV2, t: now() });

    // Palette « Aller à… » : recherche d'un compte actif (témoin), puis du fantôme
    await p.keyboard.press('Control+k');
    await p.waitForSelector('#apal-q', { timeout: 5000 });
    await p.fill('#apal-q', 'Alic');
    await p.waitForTimeout(700);
    const trouves = await texts(p, '#apal-list .apal-item');
    check(trouves.some((t) => t.includes('Alice')), 'palette : un compte actif (Alice) se trouve');
    await p.fill('#apal-q', 'Léa');
    await p.waitForTimeout(400);
    const fantome = await texts(p, '#apal-list .apal-item');
    check(!fantome.some((t) => t.includes('Léa')) && !(await p.locator('#apal-list .apal-kind', { hasText: 'Fantôme' }).count()), 'palette : le fantôme Léa n\'est pas proposé');
    await p.keyboard.press('Escape');

    // Sorties : ajout d'un inscrit (choix sans fantôme), présence déjà enregistrée (historique)
    await adminSection(p, 'camp/sorties');
    await p.click(`#shell-col .ui-row[data-id="${EV}"]`);
    await p.waitForSelector('#ass-d-body .ass-person', { timeout: 5000 });
    const inscrits = await texts(p, '#ass-d-body .ass-person-name');
    check(inscrits.some((t) => t.includes('Léa')), 'sorties : la présence enregistrée du fantôme reste affichée (historique)');
    await p.click(`#shell-col .ui-row[data-id="${EV2}"]`);
    await p.waitForFunction(() => (document.querySelector('#ass-d-head h2')?.textContent || '').includes('Fondue'), null, { timeout: 5000 });
    await p.waitForSelector('#ass-d-add-user', { timeout: 5000 });
    const ajout = await texts(p, '#ass-d-add-user option');
    check(ajout.includes('Alice') && !ajout.some((t) => t.includes('Léa')), 'sorties : « Ajouter un membre » ne propose pas le fantôme');

    // Souvenirs : auteur d'un nouveau souvenir et filtre des réactions
    await adminSection(p, 'camp/souvenirs');
    await p.click('#shell-col .sv-views a[data-view="reactions"]');
    await p.waitForSelector('#sv-re-member', { timeout: 5000 });
    const membres = await texts(p, '#sv-re-member option');
    check(membres.includes('Alice') && !membres.some((t) => t.includes('Léa')), 'souvenirs (réactions) : filtre membre sans fantôme');
    await p.click('#shell-col .sv-views a[data-view="souvenirs"]');
    // Auteur : la liste proposée à l'édition d'un souvenir (la création n'a pas de champ auteur)
    await p.locator('#shell-col .ui-row:visible').first().click();
    await p.waitForSelector('#sv-d-head h2', { timeout: 5000 });
    await p.locator('#sv-d-head button', { hasText: 'Modifier' }).click();
    await p.waitForSelector('dialog.hg-dialog[open] #sv-mo-f-author', { state: 'attached', timeout: 5000 });
    await p.waitForFunction(() => document.querySelectorAll('dialog.hg-dialog[open] #sv-mo-f-author option').length > 1, null, { timeout: 5000 }).catch(() => {});
    const auteurs = await texts(p, 'dialog.hg-dialog[open] #sv-mo-f-author option');
    check(auteurs.includes('Alice') && !auteurs.some((t) => t.includes('Léa')), 'souvenirs (auteur) : liste sans fantôme');
    await p.keyboard.press('Escape');

    // Secret Santa : exclusion (choix des deux personnes sans fantôme)
    await adminSection(p, 'camp/secret-santa');
    await p.click('.shell-slot:not([hidden]) .ui-row[data-id="E25"]');
    await p.waitForSelector('#ss-dhead h2', { timeout: 5000 });
    await p.click('[data-ss-act="excl-new"]');
    await p.waitForSelector(`${drawer} #ex-a`, { timeout: 5000 });
    const excl = await texts(p, `${drawer} #ex-a option`);
    check(excl.includes('Alice') && !excl.some((t) => t.includes('Léa')), 'Secret Santa (exclusion) : choix des personnes sans fantôme');
    await closeDrawer(p);

    check(p.errs.length === 0, `palette, sorties, souvenirs, Secret Santa : aucune erreur console${p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''}`);
    await p.close();
  }

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
