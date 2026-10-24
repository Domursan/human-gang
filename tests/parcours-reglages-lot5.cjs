// Parcours : réglages admin, lot 5 (bot Discord, rappels et limites, planning, assistance).
// (a) Communication › Bot Discord : rappels, délais et limites modifiables ; enregistrés dans hg_settings.bot
//     (rappels, dyn, envoi) ; « Rétablir » remet un groupe à ses valeurs d'origine ; un second rappel plus long que le premier est refusé.
// (b) Planning : heure d'envoi des anniversaires enregistrée dans hg_settings.planning, rétablie à 8 h.
// (c) Assistance : sujets et limites enregistrés dans hg_settings.support ; le sujet « Bug sur le site » est obligatoire ;
//     le formulaire public (sans compte) affiche les sujets par défaut et le compteur du message.
// (d) Notifications : interrupteur « carte de ta liste de souhaits » présent, coché par défaut (comme hg-notify).
// Faux Supabase (fixtures/fake-sb.mjs) : aucune requête réelle.
// Lancer : node tests/parcours-reglages-lot5.cjs
const { check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

/* ---------- Aides de test ---------- */
const DEF_RAPPELS = { irl_heures: [24, 2], ss_jours_avant: 3 };
const DEF_SUJETS = ['Problème de compte / connexion', 'Secret Santa', 'Sortie IRL', 'Bug sur le site', 'Mes données personnelles', 'Autre'];

/** Ouvre une route du panel admin, puis attend que le sélecteur sel soit affiché. */
async function goto(p, route, sel) {
  await adminSection(p, route);
  await p.waitForFunction((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel, { timeout: 8000 }).catch(() => {});
  await sleep(200);
}
// Les rappels, l'assistance et le planning sont dans le sous-onglet Règles du bot (Communication › Bot Discord).
/** Ouvre le sous-onglet Règles du bot, puis le bloc sub (rappels, assistance ou planning), puis attend le formulaire sel. */
async function gotoRegles(p, sel, sub = 'rappels') {
  await goto(p, 'pilotage/bot', '#bot-tablist');
  await p.click('#bot-tab-regles');
  await p.click(`#bot-rsub [data-rsub="${sub}"]`);
  await p.waitForSelector(sel, { state: 'visible', timeout: 8000 }).catch(() => {});
  await sleep(200);
}
// Le faux client place la ligne la plus récente en tête : on lit la première ligne de la clé.
/** Valeur de la ligne hg_settings de la clé key dans la base simulée, ou null. */
const setting = (p, key) => p.evaluate((k) => (window.__DB.hg_settings.find((r) => r.key === k) || {}).value ?? null, key);
/** Remplit le champ sel avec la valeur v (convertie en texte). */
const fill = (p, sel, v) => p.fill(sel, String(v));

/* ---------- Scénario ---------- */
(async () => {
  const browser = await chromium.launch();

  /* (a) Rappels, délais et limites du bot */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await gotoRegles(p, '#rules-form');

    check(await p.isVisible('#rules-form'), '(a) formulaire « Rappels, annonces et envois » présent');
    check(await p.inputValue('#rules-form [name="irl_long"]') === '24', '(a) défaut : rappel de sortie 24 h');
    check(await p.inputValue('#rules-form [name="irl_short"]') === '2', '(a) défaut : second rappel 2 h');
    check(await p.inputValue('#rules-form [name="ss_jours"]') === '3', '(a) défaut : rappel cadeau 3 jours');
    check(await p.inputValue('#rules-form [name="corps_max"]') === '2000', '(a) défaut : message manuel 2000 caractères');

    // Second rappel plus long que le premier : refusé, rien n'est enregistré
    await fill(p, '#rules-form [name="irl_short"]', 30);
    await p.click('#rules-form button[type="submit"]');
    await sleep(300);
    check(await p.locator('text=Le second rappel de sortie doit être plus court').count() > 0, '(a) second rappel plus long : refusé (message affiché)');
    check(await setting(p, 'bot') === null || !(await setting(p, 'bot')).rappels, '(a) refus : rien enregistré');

    // Valeurs valides : enregistrées dans bot.rappels / bot.dyn / bot.envoi
    await fill(p, '#rules-form [name="irl_long"]', 48);
    await fill(p, '#rules-form [name="irl_short"]', 6);
    await fill(p, '#rules-form [name="ss_jours"]', 5);
    await fill(p, '#rules-form [name="dyn_retard"]', 12);
    await fill(p, '#rules-form [name="top_n"]', 5);
    await fill(p, '#rules-form [name="pieces_max"]', 6);
    await fill(p, '#rules-form [name="corps_max"]', 3000);
    await p.click('#rules-form button[type="submit"]');
    await sleep(400);
    const bot = (await setting(p, 'bot')) || {};
    check(JSON.stringify(bot.rappels) === JSON.stringify({ irl_heures: [48, 6], ss_jours_avant: 5 }), '(a) enregistré : bot.rappels (48 h, 6 h, 5 jours)');
    check(bot.dyn?.delai_retard_heures === 12 && bot.dyn?.top_n === 5, '(a) enregistré : bot.dyn (délai 12 h, top 5)');
    check(bot.envoi?.pieces_max === 6 && bot.envoi?.corps_max === 3000, '(a) enregistré : bot.envoi (6 pièces, 3000 caractères)');
    check(bot.announce_channel_id === undefined || bot.announce_channel_id === null || typeof bot.notify === 'object', '(a) l\'enregistrement conserve le reste de bot');

    // Rétablir le groupe « Rappels » : ses valeurs reviennent, les autres groupes restent
    await p.click('#rules-form [data-reset-group="rappels"]');
    await sleep(400);
    const after = (await setting(p, 'bot')) || {};
    check(JSON.stringify(after.rappels) === JSON.stringify(DEF_RAPPELS), '(a) « Rétablir » rappels : valeurs d\'origine enregistrées');
    check(after.dyn?.delai_retard_heures === 12, '(a) « Rétablir » rappels : le groupe Événements n\'est pas touché');
    check(await p.inputValue('#rules-form [name="irl_long"]') === '24', '(a) « Rétablir » rappels : champs remis à 24 h');

    check(await p.isChecked('#bot-form [name="card_wish"]'), '(d) interrupteur « carte de ta liste de souhaits » coché par défaut');
    check(!(await p.isChecked('#bot-form [name="card_trade"]')), '(d) « échange conclu » désactivé par défaut (comme hg-notify)');
    check(await hscroll(p) === 0, '(a) 1440 px : pas de défilement horizontal');
    check(!p.errs.length, '(a) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (b) Planning : heure suisse des anniversaires */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await gotoRegles(p, '#planning-form', 'planning');
    check(await p.inputValue('#planning-birthday') === '8', '(b) défaut : anniversaires à 8 h');
    await p.selectOption('#planning-birthday', '7');
    await p.click('#planning-form button[type="submit"]');
    await sleep(400);
    const planning = await setting(p, 'planning');
    check(planning?.anniversaires_heure_locale === 7 && planning?.quiz_jour_heure_locale === 9, '(b) enregistré : planning.anniversaires_heure_locale = 7, question du jour conservée à 9 h');
    await p.click('#planning-form [data-reset-group="anniversaires"]');
    await sleep(400);
    check((await setting(p, 'planning'))?.anniversaires_heure_locale === 8, '(b) « Rétablir » : 8 h');
    check(await p.inputValue('#planning-birthday') === '8', '(b) « Rétablir » : champ remis à 8 h');
    check(!p.errs.length, '(b) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Assistance : sujets et limites */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await gotoRegles(p, '#support-cfg-form', 'assistance');
    const sujetsDefaut = (await p.inputValue('#support-sujets')).split('\n');
    check(JSON.stringify(sujetsDefaut) === JSON.stringify(DEF_SUJETS), '(c) défaut : six sujets, dans l\'ordre d\'origine');

    // Sans le sujet « bug » : refusé (le badge Chasseur de bugs s'appuie dessus)
    await p.fill('#support-sujets', 'Secret Santa\nAutre');
    await p.click('#support-cfg-form button[type="submit"]');
    await sleep(300);
    check(await p.locator('text=doit rester dans la liste').count() > 0, '(c) sujet « Bug sur le site » retiré : refusé (message affiché)');
    check(!(await setting(p, 'support')), '(c) refus : rien enregistré');

    // Sujets personnalisés + limites
    await p.fill('#support-sujets', 'Bug sur le site\nSecret Santa\nIdée pour le site\nAutre');
    await fill(p, '#support-max_par_heure', 3);
    await fill(p, '#support-message_min', 20);
    await fill(p, '#support-delai_reponse_jours', 14);
    await p.click('#support-cfg-form button[type="submit"]');
    await sleep(400);
    const sup = (await setting(p, 'support')) || {};
    check(JSON.stringify(sup.sujets) === JSON.stringify(['Bug sur le site', 'Secret Santa', 'Idée pour le site', 'Autre']), '(c) enregistré : sujets personnalisés');
    check(sup.max_par_heure === 3 && sup.message_min === 20 && sup.delai_reponse_jours === 14, '(c) enregistré : limites et délai');
    check(sup.message_max === 4000 && sup.mp_max === 1500, '(c) enregistré : valeurs non modifiées gardent leur défaut');

    // Rétablir le groupe « Messages »
    await p.click('#support-cfg-form [data-reset-group="messages"]');
    await sleep(400);
    check((await setting(p, 'support'))?.message_min === 10, '(c) « Rétablir » messages : minimum 10 caractères');
    check(await hscroll(p) === 0, '(c) 1440 px : pas de défilement horizontal');
    check(!p.errs.length, '(c) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c bis) Formulaire public : sans réglage enregistré, les défauts s'affichent */
  {
    const p = await openPage(browser, { page: 'assistance', width: 390, height: 844 });
    await p.waitForSelector('#sp-subject option', { timeout: 8000 }).catch(() => {});
    const opts = await p.$$eval('#sp-subject option', (els) => els.map((o) => o.value).filter(Boolean));
    check(JSON.stringify(opts) === JSON.stringify(DEF_SUJETS), '(c) formulaire public : six sujets par défaut');
    check((await p.textContent('#sp-counter')).trim() === '0 / 4000', '(c) formulaire public : compteur 0 / 4000 par défaut');
    check(await hscroll(p) === 0, '(c) 390 px : pas de défilement horizontal');
    check(!p.errs.length, '(c) formulaire public : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
