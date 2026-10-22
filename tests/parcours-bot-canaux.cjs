// Parcours : Communication › Bot Discord — salon par type d'annonce (bot.channels) et test d'un salon.
// (a) Réglages : une section « Salon par type d'annonce » avec un champ par type ; sans aucun salon, les mentions
//     sont grisées, dès qu'un salon par type est renseigné elles s'activent.
// (b) Validation : un ID de salon mal formé est refusé (aucune écriture), un ID valide est enregistré dans
//     hg_settings.bot : channels = { <type>: ID } (les types vides ne sont pas stockés) et le miroir birthday_channel_id.
// (c) Repli : un ancien réglage birthday_channel_id s'affiche dans le champ « Anniversaires » tant que channels.birthday est vide.
// (d) Test : « Tester le salon » = un type → hg-notify reçoit { event: 'bot_test', type } ; sans choix → événement seul.
// (e) Mobile 390 px : pas de défilement horizontal sur les réglages.
// Faux Supabase (fixtures/fake-sb.mjs) : hg-notify est simulée, aucune requête réelle.
// Lancer : node tests/parcours-bot-canaux.cjs
const { check, finish, openPage, adminSection, hscroll, chromium, sleep } = require('./lib/harness.cjs');

const ANNONCES = '112233445566778899';
const ANNIV = '223344556677889900';
const CARTES = '334455667788990011';

/** Ouvre une route du panel admin, puis attend que le formulaire des réglages soit affiché. */
async function goto(p, route, sel) {
  await adminSection(p, route);
  await p.waitForFunction((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel, { timeout: 8000 }).catch(() => {});
  await sleep(200);
}
/** Réglages du bot lus dans la base simulée (hg_settings, clé « bot »). */
const botSetting = (p) => p.evaluate(() => (window.__DB.hg_settings.find((r) => r.key === 'bot') || {}).value || {});
/** Appels de hg-notify faits depuis le panel admin pour l'événement bot_test. */
const testCalls = (p) => p.evaluate(() => window.__LOG.filter((e) => e[0] === 'fn' && e[1] === 'hg-notify' && e[2]?.event === 'bot_test').map((e) => e[2]));

(async () => {
  const browser = await chromium.launch();

  /* (a) (b) (c) (d) Réglages, validation, repli, test */
  {
    const p = await openPage(browser, { page: 'admin', width: 1440, height: 900 });
    await goto(p, 'communication/bot', '#bot-form');

    check(await p.locator('#bot-channels').count() === 1, '(a) section « Salon par type d\'annonce » présente');
    const types = ['draw', 'irl', 'birthday', 'dyn', 'card_pull', 'card_trade'];
    check((await Promise.all(types.map((k) => p.locator(`#bot-chan-${k}`).count()))).every((n) => n === 1), '(a) un champ par type d\'annonce');
    check(await p.isDisabled('#bot-mention-draw'), '(a) sans aucun salon : les mentions sont grisées');
    await p.fill('#bot-chan-draw', ANNONCES);
    check(!(await p.isDisabled('#bot-mention-draw')), '(a) un salon par type suffit : les mentions s\'activent');
    await p.fill('#bot-chan-draw', '');

    // (b) ID mal formé : refusé, rien n'est écrit
    await p.fill('#bot-chan-irl', '12345');
    await p.click('#bot-form button[type="submit"]');
    await sleep(300);
    const toasts = await p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
    check(toasts.includes('Nouvelles sorties IRL') && toasts.includes('17 à 20 chiffres'), '(b) ID de salon trop court : refusé, le libellé du type est donné');
    check(!(await botSetting(p)).channels, '(b) ID mal formé : rien n\'est enregistré');
    await p.fill('#bot-chan-irl', '');

    // (b) saisie valide : deux types renseignés, les autres vides
    await p.fill('#bot-chan-draw', ANNONCES);
    await p.fill('#bot-chan-birthday', ANNIV);
    await p.fill('#bot-chan-card_pull', CARTES);
    await p.click('#bot-form button[type="submit"]');
    await sleep(500);
    const saved = await botSetting(p);
    check(saved.channels?.draw === ANNONCES && saved.channels?.birthday === ANNIV && saved.channels?.card_pull === CARTES, '(b) enregistré : channels par type');
    check(!('irl' in (saved.channels || {})) && !('dyn' in (saved.channels || {})), '(b) types vides : non stockés (repli sur le salon d\'annonces)');
    check(saved.birthday_channel_id === ANNIV, '(b) enregistré : birthday_channel_id gardé en miroir (compatibilité)');
    check(saved.announce_channel_id === null || saved.announce_channel_id === undefined || saved.announce_channel_id === '', '(b) salon d\'annonces vide : toujours permis');

    // (d) test d'un salon précis
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

  /* (c) Repli : ancien réglage birthday_channel_id affiché tant que channels.birthday est vide */
  {
    const p = await openPage(browser, { page: 'admin', width: 1280, height: 900 });
    await p.evaluate((id) => { window.__DB.hg_settings.unshift({ key: 'bot', value: { announce_channel_id: '112233445566778899', birthday_channel_id: id, notify: {} } }); }, ANNIV)
      .catch(() => {});
    await goto(p, 'communication/bot', '#bot-form');
    check(await p.inputValue('#bot-chan-birthday') === ANNIV, '(c) ancien réglage des anniversaires affiché dans « Anniversaires »');
    check(!p.errs.length, '(c) aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  /* (e) Mobile 390 px */
  {
    const p = await openPage(browser, { page: 'admin', width: 390, height: 844 });
    await goto(p, 'communication/bot', '#bot-form');
    await p.locator('#bot-channels').scrollIntoViewIfNeeded();
    check(await hscroll(p) === 0, '(e) 390 px : pas de défilement horizontal (salons par type)');
    check(!p.errs.length, '(e) mobile : aucune erreur console' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
    await p.ctx.close();
  }

  await browser.close();
  finish();
})();
