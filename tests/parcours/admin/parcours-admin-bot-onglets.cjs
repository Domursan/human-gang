// Parcours : Communication › Bot Discord — sous-onglets, salons connus, salon par type d'annonce, annonce libre.
// (a) Sept sous-onglets dans l'ordre (ARIA : tablist, tab, aria-controls), un seul panneau affiché.
// (b) Clavier : flèches (en boucle), Début et Fin ; le focus suit l'onglet.
// (c) Dernier onglet mémorisé (localStorage) : après rechargement, le même onglet est ouvert.
// (d) Salons : contrôle (nom vide, nom trop long, ID mal formé, doublon d'ID, doublon de nom), ajout, Entrée.
// (e) Salon par type : cases à cocher, 5 au plus, enregistrées en tableaux (channels) ; types vides non stockés.
// (f) Retrait d'un salon : confirmation en ligne, décoche le salon partout, enregistré sans confirm().
// (g) Ancien réglage (chaîne par type, anniversaires) : coché, ajouté à la liste « Salon <id> », gardé en tableau.
// (h) Annonce libre : salons cochés par défaut (salon d'annonces), confirmation « Publier cette annonce dans N salons ? »,
//     admin_dm avec channels, résultat ✓ / ✗ par salon (un salon en échec par scénario).
// (i) 360 px : pas de défilement horizontal, cibles de 44 px au moins, sur chaque sous-onglet.
// (k) Réglages non chargés : bandeau, enregistrement bloqué ; test du bot : résumé par salon.
// (j) Captures (si BOT_SHOTS est défini) : chaque sous-onglet à 1280 px, deux fois plus dense (bot-<onglet>.png).
// Faux Supabase (fixtures/fake-sb.mjs) : hg-notify simulée, aucune requête réelle.
// Lancer : node tests/parcours/admin/parcours-admin-bot-onglets.cjs
const path = require('path');
const { check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('../../lib/harness.cjs');

const SHOTS_DIR = process.env.BOT_SHOTS || '';
const CHAN = '112233445566778899', ANIV = '223344556677889900', CARTES = '334455667788990011', ROLE = '445566778899001122';
const X1 = '556677889900112233', X2 = '667788990011223344', ENTREE = '778899001122334455';
const TABS = ['connexion', 'salons', 'mentions', 'annonces', 'mp', 'modeles', 'regles'];
const LABELS = ['Connexion', 'Salons', 'Mentions', 'Annonces', 'Messages privés', 'Messages types', 'Règles'];

/** Ouvre une route du panel admin, puis attend que l'élément sel soit affiché. */
async function goto(p, route, sel) {
  await adminSection(p, route);
  await p.waitForFunction((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel, { timeout: 8000 }).catch(() => {});
  await sleep(200);
}
/** Ouvre un sous-onglet du bot en cliquant dessus, puis attend son panneau. */
async function tab(p, id) {
  await p.click(`#bot-tab-${id}`);
  await p.waitForSelector(`#bot-p-${id}`, { state: 'visible', timeout: 5000 });
  await sleep(120);
}
/** Enregistre les réglages : le bouton « Enregistrer » du panneau affiché (le formulaire des réglages en a un par panneau). */
async function save(p) { await p.click('#bot-form button[type="submit"]:visible'); await sleep(500); }
/** Réglages du bot lus dans la base simulée (hg_settings, clé « bot »). */
const botSetting = (p) => p.evaluate(() => (window.__DB.hg_settings.find((r) => r.key === 'bot') || {}).value || {});
/** Appels de hg-notify faits depuis le panel admin pour une annonce (admin_dm). */
const adminCalls = (p) => p.evaluate(() => window.__LOG.filter((e) => e[0] === 'fn' && e[1] === 'hg-notify' && e[2]?.event === 'admin_dm').map((e) => e[2]));
/** Identifiant de l'onglet sélectionné, et de l'élément qui a le focus. */
const selectedTab = (p) => p.$eval('#bot-tablist [aria-selected="true"]', (e) => e.id);
const activeId = (p) => p.evaluate(() => document.activeElement?.id || '');
/** Texte d'un toast affiché (tous, réunis). */
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
/** Fichier PDF factice pour une pièce jointe. */
const pdf = () => Buffer.from('%PDF-1.4\n%test\n');

(async () => {
  const browser = await chromium.launch();

  /* (a) Sous-onglets : ordre, ARIA, un seul panneau */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    const tabs = await p.$$eval('#bot-tablist [role="tab"]', (els) => els.map((e) => ({ text: e.textContent.trim(), id: e.id, controls: e.getAttribute('aria-controls') })));
    check(JSON.stringify(tabs.map((t) => t.text)) === JSON.stringify(LABELS), '(a) sept sous-onglets dans l\'ordre : ' + tabs.map((t) => t.text).join(' · '));
    check(tabs.every((t, i) => t.id === `bot-tab-${TABS[i]}` && t.controls === `bot-p-${TABS[i]}`), '(a) identifiants bot-tab-<id> et aria-controls bot-p-<id>');
    check(await selectedTab(p) === 'bot-tab-connexion', '(a) Connexion sélectionné par défaut');
    const shown = await p.$$eval('[role="tabpanel"]', (els) => els.filter((e) => e.getClientRects().length > 0).map((e) => e.id));
    check(JSON.stringify(shown) === '["bot-p-connexion"]', '(a) un seul panneau affiché : ' + shown.join(','));
    check(await hscroll(p) === 0, '(a) 1280 px : pas de défilement horizontal');
    check(!p.errs.length, '(a) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Clavier, (c) mémoire, (d)(e)(f) salons et cases, enregistrement */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
    await goto(p, 'pilotage/bot', '#bot-tablist');

    // (b) flèches, Fin, Début ; boucle aux extrémités
    await p.focus('#bot-tab-connexion');
    await p.keyboard.press('ArrowRight');
    check(await selectedTab(p) === 'bot-tab-salons' && await activeId(p) === 'bot-tab-salons', '(b) flèche droite : Salons sélectionné, focus suivi');
    await p.keyboard.press('End');
    check(await selectedTab(p) === 'bot-tab-regles', '(b) Fin : dernier onglet (Règles)');
    await p.keyboard.press('ArrowRight');
    check(await selectedTab(p) === 'bot-tab-connexion', '(b) flèche droite sur le dernier : retour au premier (boucle)');
    await p.keyboard.press('ArrowLeft');
    check(await selectedTab(p) === 'bot-tab-regles', '(b) flèche gauche sur le premier : dernier onglet (boucle)');
    await p.keyboard.press('Home');
    check(await selectedTab(p) === 'bot-tab-connexion', '(b) Début : premier onglet');
    check(await p.getAttribute('#bot-tab-connexion', 'tabindex') === '0' && await p.getAttribute('#bot-tab-salons', 'tabindex') === '-1', '(b) tabindex : 0 sur l\'onglet choisi, -1 sur les autres');

    // (d) Salons : contrôles et ajout
    await tab(p, 'salons');
    await p.click('#bot-salon-add');
    check((await p.textContent('#bot-salon-err')).includes('Donne un nom'), '(d) nom vide : refusé');
    await p.fill('#bot-salon-name', 'Annonces');
    await p.fill('#bot-salon-id', '12345');
    await p.click('#bot-salon-add');
    check((await p.textContent('#bot-salon-err')).includes('17 à 20 chiffres'), '(d) ID mal formé : refusé (17 à 20 chiffres)');
    // Nom : 50 caractères au plus (la saisie s'arrête à 50, comme la règle du serveur)
    check(await p.getAttribute('#bot-salon-name', 'maxlength') === '50', '(d) nom : limite de 50 caractères sur le champ');
    await p.fill('#bot-salon-name', 'x'.repeat(60));
    check((await p.inputValue('#bot-salon-name')).length === 50, '(d) nom trop long : la saisie s\'arrête à 50 caractères');
    await p.fill('#bot-salon-name', 'Annonces');
    await p.fill('#bot-salon-id', CHAN);
    await p.click('#bot-salon-add');
    check(await p.locator('#bot-salon-list .salon-row').count() === 1, '(d) salon valide : ajouté à la liste');
    check(!(await p.isVisible('#bot-salon-err')), '(d) erreur effacée après un ajout réussi');
    await p.fill('#bot-salon-name', 'Autre');
    await p.fill('#bot-salon-id', CHAN);
    await p.click('#bot-salon-add');
    check((await p.textContent('#bot-salon-err')).includes('déjà dans la liste'), '(d) même ID : doublon refusé');
    await p.fill('#bot-salon-name', 'ANNONCES ');
    await p.fill('#bot-salon-id', X1);
    await p.click('#bot-salon-add');
    check((await p.textContent('#bot-salon-err')).includes('déjà ce nom'), '(d) même nom (sans casse) : doublon refusé');
    await p.fill('#bot-salon-name', 'Anniversaires');
    await p.fill('#bot-salon-id', ANIV);
    await p.click('#bot-salon-add');
    await p.fill('#bot-salon-name', 'Cartes');
    await p.fill('#bot-salon-id', CARTES);
    await p.click('#bot-salon-add');
    await p.fill('#bot-salon-name', 'Parfum');
    await p.fill('#bot-salon-id', X1);
    await p.click('#bot-salon-add');
    check(await p.locator('#bot-salon-list .salon-row').count() === 4, '(d) quatre salons dans la liste (le doublon de nom n\'a pas été ajouté)');
    await p.fill('#bot-salon-name', 'Bar');
    await p.fill('#bot-salon-id', X2);
    await p.click('#bot-salon-add');
    await p.fill('#bot-salon-name', 'Entrée');
    await p.fill('#bot-salon-id', ENTREE);
    await p.press('#bot-salon-id', 'Enter');
    check(await p.locator('#bot-salon-list .salon-row').count() === 6, '(d) Entrée dans l\'ID ajoute le salon (6 au total)');
    await sleep(300);
    check(!(await p.isVisible('#bot-salons-dirty')), '(d) ajout enregistré tout de suite (pas de « non enregistré »)');
    check((await botSetting(p)).salons?.some((x) => x.id === ENTREE && x.nom === 'Entrée'), '(d) le salon ajouté est dans hg_settings.bot (nom gardé)');

    // (e) cases par type : draw = deux salons, irl = un, card_pull = un, dyn = cinq (sixième refusé)
    await p.check(`#bot-chan-draw input[value="${CHAN}"]`);
    await p.check(`#bot-chan-draw input[value="${ANIV}"]`);
    await p.check(`#bot-chan-irl input[value="${ANIV}"]`);
    await p.check(`#bot-chan-card_pull input[value="${CARTES}"]`);
    for (const id of [CHAN, ANIV, CARTES, X1, X2]) await p.check(`#bot-chan-dyn input[value="${id}"]`);
    await p.click(`#bot-chan-dyn input[value="${ENTREE}"]`);
    await sleep(200);
    check(!(await p.isChecked(`#bot-chan-dyn input[value="${ENTREE}"]`)), '(e) sixième salon refusé : 5 au plus par type');
    check((await toasts(p)).includes('5 salons maximum'), '(e) message « 5 salons maximum par type d\'annonce »');
    check((await p.textContent('#bot-chan-n-dyn')).trim() === '5 / 5', '(e) compteur du type : 5 / 5');
    check((await p.textContent('#bot-chan-h-irl')).trim() === '', '(e) type avec un salon coché : pas de rappel « salon par défaut »');
    check((await p.textContent('#bot-chan-h-birthday')).includes('Aucun salon coché'), '(e) type sans case : rappel « salon d\'annonces par défaut »');
    await save(p);
    let s = await botSetting(p);
    check(JSON.stringify(s.channels?.draw) === JSON.stringify([CHAN, ANIV]), '(e) enregistré : draw = tableau [salon, salon] dans l\'ordre coché');
    check(JSON.stringify(s.channels?.irl) === JSON.stringify([ANIV]) && JSON.stringify(s.channels?.card_pull) === JSON.stringify([CARTES]), '(e) enregistré : irl et card_pull sont des tableaux');
    check(s.channels?.dyn?.length === 5 && !s.channels.dyn.includes(ENTREE), '(e) enregistré : dyn = 5 salons, pas le sixième');
    check(!('birthday' in (s.channels || {})) && !('card_drop' in (s.channels || {})), '(e) types vides : non stockés');
    check(s.birthday_channel_id === null, '(e) miroir birthday_channel_id vide quand aucun salon d\'anniversaires');
    check(s.salons?.length === 6 && s.salons[0].id === CHAN && s.salons[0].nom === 'Annonces', '(e) enregistré : la liste des salons (id et nom)');
    check(!(await p.isVisible('#bot-salons-dirty')), '(e) après enregistrement : plus de mention « non enregistré »');

    // (f) retrait : confirmation en ligne (sans boîte de dialogue), Annuler, puis retrait ; décoche partout
    await p.click(`[data-salon-ask="${CARTES}"]`);
    check(await p.locator('#bot-salon-list .salon-ask').count() === 1, '(f) retrait : confirmation affichée sur la ligne');
    await p.click(`[data-salon-no="${CARTES}"]`);
    check(await p.locator('#bot-salon-list .salon-ask').count() === 0 && await p.locator('#bot-salon-list .salon-row').count() === 6, '(f) Annuler : rien n\'est retiré');
    await p.click(`[data-salon-ask="${CARTES}"]`);
    await p.click(`[data-salon-yes="${CARTES}"]`);
    await sleep(150);
    check(await p.locator('#bot-salon-list .salon-row').count() === 5, '(f) Retirer : le salon disparaît de la liste');
    check(await p.locator(`#bot-chan-card_pull input[value="${CARTES}"]`).count() === 0, '(f) le salon n\'est plus proposé dans les cases par type');
    check((await p.textContent('#bot-chan-h-card_pull')).includes('Aucun salon coché'), '(f) le type qui le cochait revient au salon par défaut');
    await sleep(300);
    check(!(await p.isVisible('#bot-salons-dirty')), '(f) retrait enregistré tout de suite');
    check(!(await botSetting(p)).salons?.some((x) => x.id === CARTES), '(f) le salon retiré n\'est plus dans hg_settings.bot');
    await save(p);
    s = await botSetting(p);
    check(!(s.salons || []).some((x) => x.id === CARTES) && !('card_pull' in (s.channels || {})), '(f) enregistré : salon retiré de la liste et de card_pull');
    check(JSON.stringify(s.channels?.draw) === JSON.stringify([CHAN, ANIV]), '(f) les autres réglages par type sont conservés');
    check(!p.errs.length, '(b)(d)(e)(f) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));

    // (c) mémoire : après rechargement, le même sous-onglet est ouvert
    await p.reload();
    await sleep(1200);
    await goto(p, 'pilotage/bot', '#bot-tablist');
    check(await selectedTab(p) === 'bot-tab-salons', '(c) dernier onglet mémorisé : Salons ouvert après rechargement');
    await p.ctx.close();
  }

  /* (g) Ancien réglage : chaîne par type et anniversaires, ajoutés à la liste */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { settings: [
      { key: 'bot', value: { announce_channel_id: CHAN, birthday_channel_id: ANIV, channels: { card_pull: CARTES }, mentions: {}, notify: {} } },
    ] } });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    await tab(p, 'salons');
    check(await p.isChecked(`#bot-chan-card_pull input[value="${CARTES}"]`), '(g) ancienne chaîne (card_pull) : cochée');
    check(await p.isChecked(`#bot-chan-birthday input[value="${ANIV}"]`), '(g) ancien réglage des anniversaires (birthday_channel_id) : coché');
    const names = await p.$$eval('#bot-salon-list .salon-name', (els) => els.map((e) => e.textContent.trim()));
    check(names.length === 2 && names.every((n) => n.startsWith('Salon ')), '(g) salons absents de la liste : ajoutés comme « Salon <id> » : ' + names.join(', '));
    await save(p);
    const s = await botSetting(p);
    check(JSON.stringify(s.channels?.card_pull) === JSON.stringify([CARTES]) && JSON.stringify(s.channels?.birthday) === JSON.stringify([ANIV]), '(g) enregistré : tableaux, rien n\'est perdu');
    check((s.salons || []).length === 2, '(g) enregistré : les salons ajoutés sont dans salons');
    check(!p.errs.length, '(g) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (h) Annonce libre : salons cochés, confirmation, admin_dm avec channels, résultat par salon (un salon en échec) */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: {
      botChannelFail: [CARTES],
      settings: [{ key: 'bot', value: { announce_channel_id: CHAN, mention_role_id: ROLE, salons: [{ id: ANIV, nom: 'Anniversaires' }, { id: CARTES, nom: 'Cartes' }], channels: {}, mentions: {}, notify: {} } }],
    } });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    await tab(p, 'annonces');
    check(await p.locator('#ann-chan-list input').count() === 3, '(h) trois salons proposés : salon par défaut + salons connus');
    check(await p.isChecked(`#ann-chan-list input[value="${CHAN}"]`), '(h) le salon d\'annonces par défaut est coché au départ');
    check(await p.locator('#ann-chan-list .pill').count() === 1, '(h) le salon par défaut est signalé');
    await p.check(`#ann-chan-list input[value="${ANIV}"]`);
    await p.check(`#ann-chan-list input[value="${CARTES}"]`);
    await p.fill('#ann-title', 'Info importante');
    await p.fill('#ann-text', 'Salut {pseudo}, la sortie est confirmée !');
    await p.selectOption('#ann-mention', 'role');
    check((await p.textContent('#ann-preview .dc-mention')).trim() === '@rôle', '(h) aperçu : mention du rôle en tête');
    check(await p.evaluate(() => document.querySelector('#ann-preview .dc-where')?.textContent.includes('Cartes')), '(h) aperçu : les salons choisis sont nommés');
    await p.setInputFiles('#ann-file-input', [{ name: 'programme.pdf', mimeType: 'application/pdf', buffer: pdf() }]);
    check(await p.locator('#ann-file-list .bm-file').count() === 1, '(h) pièce jointe ajoutée');
    await p.click('#ann-send');
    await p.waitForSelector('dialog[open] button[value="ok"]', { timeout: 5000 });
    const txt = await p.textContent('#bm-dlg-p');
    check(txt.includes('Publier cette annonce dans 3 salons ?'), '(h) confirmation : « Publier cette annonce dans 3 salons ? »');
    check(txt.includes('1 pièce jointe'), '(h) confirmation : mentionne la pièce jointe');
    await p.click('dialog[open] button[value="ok"]');
    await p.waitForSelector('#ann-result .bm-result-box', { timeout: 8000 });
    const calls = await adminCalls(p);
    check(calls.length === 1, '(h) hg-notify (admin_dm) appelé une fois');
    const c = calls[0] || {};
    check(JSON.stringify(c.channels) === JSON.stringify([CHAN, ANIV, CARTES]), '(h) appel : channels = les trois salons cochés, dans l\'ordre de la liste');
    check(Array.isArray(c.user_ids) && c.user_ids.length === 0 && c.title === 'Info importante' && c.body.includes('{pseudo}'), '(h) appel : sans destinataires, titre et corps');
    check(c.mention === 'role' && Array.isArray(c.attachments) && c.attachments.length === 1 && c.attachments[0].startsWith('manuel/'), '(h) appel : mention role et une pièce jointe');
    const rows = await p.$$eval('#ann-result .bm-res-row', (els) => els.map((e) => e.textContent));
    check(rows.length === 3, '(h) résultat : une ligne par salon');
    check(rows.filter((r) => r.includes('✓')).length === 2, '(h) résultat : ✓ pour les salons publiés');
    const failed = rows.find((r) => r.includes('✗'));
    check(!!failed && failed.includes('Cartes') && failed.includes('Le bot ne peut pas écrire dans ce salon.'), '(h) résultat : ✗ avec la raison pour le salon en échec');
    check(await p.locator('#ann-file-list .bm-file').count() === 0, '(h) après publication : pièces jointes retirées de la liste');
    const up = await p.evaluate(() => window.__LOG.findIndex((e) => e[0] === 'upload'));
    const fn = await p.evaluate(() => window.__LOG.findIndex((e) => e[0] === 'fn' && e[1] === 'hg-notify'));
    check(up >= 0 && up < fn, '(h) pièce jointe téléversée avant l\'appel');
    check(!p.errs.length, '(h) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (i) 360 px : pas de défilement horizontal, sous-onglets de 44 px au moins */
  {
    const p = await openPage(browser, { page: 'admin', width: 360, height: 740 });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    check(await hscroll(p) === 0, '(i) 360 px : pas de défilement horizontal (Connexion)');
    const sizes = await p.$$eval('#bot-tablist [role="tab"]', (els) => els.map((e) => e.getBoundingClientRect().height));
    check(sizes.length === 7 && sizes.every((h) => h >= 44), '(i) 360 px : sous-onglets de 44 px au moins');
    for (const id of TABS) {
      await tab(p, id);
      check(await hscroll(p) === 0, `(i) 360 px : pas de défilement horizontal (${id})`);
    }
    check(!p.errs.length, '(i) mobile : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (k) Réglages non chargés : bandeau, aucune écriture possible ; test du bot : résumé par salon */
  {
    const p = await openPage({ newContext: (o) => browser.newContext(o) }, { page: 'admin', width: 1280, height: 900, scenario: { botSettingsFail: true } });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    check(await p.isVisible('.bot-unloaded'), '(k) réglages non chargés : bandeau « recharge la page » affiché');
    check(await p.isVisible('#bot-reload'), '(k) réglages non chargés : bouton Recharger présent');
    check(await p.isDisabled('#bot-form button[type="submit"]'), '(k) réglages non chargés : Enregistrer désactivé');
    await p.evaluate(() => document.querySelector('#bot-form').requestSubmit());
    await sleep(400);
    check(!(await p.evaluate(() => window.__LOG.some((e) => e[0] === 'upsert' && e[1] === 'hg_settings'))), '(k) réglages non chargés : aucune écriture de hg_settings (rien d\'écrasé)');
    check(!p.errs.length, '(k) réglages non chargés : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }
  {
    const p = await openPage({ newContext: (o) => browser.newContext(o) }, { page: 'admin', width: 1280, height: 900, scenario: {
      settings: [{ key: 'bot', value: { announce_channel_id: CHAN, salons: [{ id: CHAN, nom: 'Annonces' }, { id: X1, nom: 'Bruit' }], channels: {}, mentions: {}, notify: {} } }],
      botChannelFail: [X1],
    } });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    await p.click('#bot-test');
    await sleep(500);
    check((await toasts(p)).includes('1 salon OK, 1 en échec : Le bot ne peut pas écrire dans ce salon.'), '(k) test du bot : résumé par salon (« 1 salon OK, 1 en échec : … »)');
    await p.ctx.close();
  }

  /* (j) Captures de chaque sous-onglet, à 1280 px et deux fois plus dense */
  if (SHOTS_DIR) {
    // openPage crée le contexte : on lui passe un navigateur qui ajoute la densité 2x (aucun autre réglage ne change).
    const dense = { newContext: (opts) => browser.newContext({ ...opts, deviceScaleFactor: 2 }) };
    const p = await openPage(dense, { page: 'admin', width: 1280, height: 900, scenario: {
      settings: [{ key: 'bot', value: { announce_channel_id: CHAN, mention_role_id: ROLE, admin_discord_id: ANIV, salons: [{ id: CHAN, nom: 'Annonces' }, { id: ANIV, nom: 'Anniversaires' }, { id: CARTES, nom: 'Cartes' }], channels: { draw: [CHAN], card_pull: [CARTES, ANIV] }, mentions: { draw: 'role' }, notify: {} } }],
    } });
    await goto(p, 'pilotage/bot', '#bot-tablist');
    for (const id of TABS) {
      await tab(p, id);
      // La zone de contenu défile : on agrandit la fenêtre à la hauteur du contenu pour tout capturer d'un coup.
      const h = await p.evaluate(() => Math.max(900, document.querySelector('#app').scrollHeight));
      await p.setViewportSize({ width: 1280, height: h });
      await sleep(300);
      await p.screenshot({ path: path.join(SHOTS_DIR, `bot-${id}.png`) });
      await p.setViewportSize({ width: 1280, height: 900 });
      await sleep(200);
    }
    check(!p.errs.length, '(j) captures : aucune erreur console');
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
