// Parcours : Communication › Bot Discord — salons connus, salon par type d'annonce (bot.channels, tableaux) et test d'un salon.
// (a) Sans salon connu, l'onglet Salons l'indique ; les mentions sont grisées. Dès qu'un salon est ajouté, chaque type
//     d'annonce a ses cases à cocher ; une case suffit à activer les mentions.
// (b) Validation : un ID de salon mal formé est refusé dans le formulaire d'ajout (aucune écriture), un ID valide est
//     enregistré dans hg_settings.bot : salons (liste) et channels = { <type>: [ID, …] } (les types vides ne sont pas
//     stockés), le miroir birthday_channel_id reprend le premier salon des anniversaires.
// (c) Repli : un ancien réglage birthday_channel_id est coché dans « Anniversaires » tant que channels.birthday est vide.
// (d) Test : « Envoyer un message de test » = un type → hg-notify reçoit { event: 'bot_test', type } ; sans choix → événement seul.
// (e) Mobile 390 px : pas de défilement horizontal sur l'onglet Salons.
// Faux Supabase (fixtures/fake-sb.mjs) : hg-notify est simulée, aucune requête réelle.
// Lancer : node tests/parcours/admin/parcours-bot-canaux.cjs
const { check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('../../lib/harness.cjs');

const ANNONCES = '112233445566778899';
const ANIV = '223344556677889900';
const CARTES = '334455667788990011';

/** Ouvre une route du panel admin, puis attend que la barre des sous-onglets soit affichée. */
async function goto(p, route) {
  await adminSection(p, route);
  await p.waitForFunction(() => { const e = document.querySelector('#bot-tablist'); return !!e && e.getClientRects().length > 0; }, null, { timeout: 8000 }).catch(() => {});
  await sleep(200);
}
/** Ouvre un sous-onglet du bot en cliquant dessus, puis attend son panneau. */
async function tab(p, id) {
  await p.click(`#bot-tab-${id}`);
  await p.waitForSelector(`#bot-p-${id}`, { state: 'visible', timeout: 5000 });
  await sleep(120);
}
/** Ajoute un salon connu (nom et ID) dans l'onglet Salons. */
async function addSalon(p, nom, id) {
  await p.fill('#bot-salon-name', nom);
  await p.fill('#bot-salon-id', id);
  await p.click('#bot-salon-add');
  await sleep(100);
}
/** Enregistre les réglages avec le bouton du panneau affiché. */
async function save(p) { await p.click('#bot-form button[type="submit"]:visible'); await sleep(500); }
/** Réglages du bot lus dans la base simulée (hg_settings, clé « bot »). */
const botSetting = (p) => p.evaluate(() => (window.__DB.hg_settings.find((r) => r.key === 'bot') || {}).value || {});
/** Appels de hg-notify faits depuis le panel admin pour l'événement bot_test. */
const testCalls = (p) => p.evaluate(() => window.__LOG.filter((e) => e[0] === 'fn' && e[1] === 'hg-notify' && e[2]?.event === 'bot_test').map((e) => e[2]));

(async () => {
  const browser = await chromium.launch();

  /* (a) (b) (d) Salons, cases par type, validation, enregistrement, test */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await goto(p, 'pilotage/bot');
    await tab(p, 'salons');

    check(await p.locator('#bot-channels').count() === 1, '(a) section « Où part chaque type d\'annonce » présente');
    check((await p.textContent('#bot-chan-list')).includes('Ajoute d\'abord un salon'), '(a) sans salon connu : l\'onglet le demande');
    check(await p.locator('#bot-chan-draw').count() === 0, '(a) sans salon : pas encore de cases par type');
    await tab(p, 'mentions');
    check(await p.isDisabled('#bot-mention-draw'), '(a) sans aucun salon : les mentions sont grisées');
    await tab(p, 'salons');

    // (b) ID mal formé : refusé dans le formulaire d'ajout, rien n'est écrit
    await addSalon(p, 'Trop court', '12345');
    check((await p.textContent('#bot-salon-err')).includes('17 à 20 chiffres'), '(b) ID de salon trop court : refusé, message donné');
    await save(p);
    check(!(await botSetting(p)).salons?.length, '(b) ID mal formé : rien n\'est enregistré');

    // Trois salons connus valides : le formulaire crée une case par salon pour chaque type
    await addSalon(p, 'Annonces', ANNONCES);
    await addSalon(p, 'Anniversaires', ANIV);
    await addSalon(p, 'Cartes', CARTES);
    check(await p.locator('#bot-chan-draw input[type="checkbox"]').count() === 3, '(a) un type d\'annonce propose les trois salons connus');
    check((await Promise.all(['draw', 'irl', 'birthday', 'dyn', 'card_pull', 'card_trade', 'card_drop']
      .map((k) => p.locator(`#bot-chan-${k}`).count()))).every((n) => n === 1), '(a) un bloc de cases par type d\'annonce');

    // Saisie : draw → Annonces, birthday → Anniversaires, card_pull → Cartes ; les autres types restent vides
    await p.check(`#bot-chan-draw input[value="${ANNONCES}"]`);
    await p.check(`#bot-chan-birthday input[value="${ANIV}"]`);
    await p.check(`#bot-chan-card_pull input[value="${CARTES}"]`);
    await tab(p, 'mentions');
    check(!(await p.isDisabled('#bot-mention-draw')), '(a) une case cochée suffit : les mentions s\'activent');
    await tab(p, 'salons');
    await save(p);

    const saved = await botSetting(p);
    check(JSON.stringify(saved.channels?.draw) === JSON.stringify([ANNONCES]), '(b) enregistré : channels.draw = tableau [Annonces]');
    check(JSON.stringify(saved.channels?.birthday) === JSON.stringify([ANIV]) && JSON.stringify(saved.channels?.card_pull) === JSON.stringify([CARTES]), '(b) enregistré : birthday et card_pull sont des tableaux');
    check(!('irl' in (saved.channels || {})) && !('dyn' in (saved.channels || {})), '(b) types vides : non stockés (repli sur le salon d\'annonces)');
    check(saved.birthday_channel_id === ANIV, '(b) enregistré : birthday_channel_id gardé en miroir (premier salon des anniversaires)');
    check(saved.salons?.length === 3, '(b) enregistré : les trois salons connus dans salons');
    check(saved.announce_channel_id === null || saved.announce_channel_id === undefined || saved.announce_channel_id === '', '(b) salon d\'annonces vide : toujours permis');

    // (d) test d'un salon précis, puis du salon d'annonces (sans type)
    await tab(p, 'connexion');
    await p.selectOption('#bot-test-type', 'card_pull');
    await p.click('#bot-test');
    await sleep(400);
    const t1 = await testCalls(p);
    check(t1.length === 1 && t1[0].type === 'card_pull', '(d) test « Belles cartes » : hg-notify reçoit { event: bot_test, type: card_pull }');
    await p.selectOption('#bot-test-type', '');
    await p.click('#bot-test');
    await sleep(400);
    const t2 = await testCalls(p);
    check(t2.length === 2 && !t2[1].type, '(d) test « Salon d\'annonces » : événement bot_test sans type');
    check(!p.errs.length, '(a)(b)(d) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (c) Repli : ancien réglage birthday_channel_id coché tant que channels.birthday est vide */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900, scenario: { settings: [
      { key: 'bot', value: { announce_channel_id: ANNONCES, birthday_channel_id: ANIV, notify: {} } },
    ] } });
    await goto(p, 'pilotage/bot');
    await tab(p, 'salons');
    check(await p.isChecked(`#bot-chan-birthday input[value="${ANIV}"]`), '(c) ancien réglage des anniversaires coché dans « Anniversaires »');
    check((await p.textContent('#bot-salon-list')).includes(`Salon ${ANIV}`), '(c) salon absent de la liste : ajouté comme « Salon <id> »');
    check(!p.errs.length, '(c) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (e) Mobile 390 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844 });
    await goto(p, 'pilotage/bot');
    await tab(p, 'salons');
    await p.locator('#bot-channels').scrollIntoViewIfNeeded();
    check(await hscroll(p) === 0, '(e) 390 px : pas de défilement horizontal (salons)');
    check(!p.errs.length, '(e) mobile : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
