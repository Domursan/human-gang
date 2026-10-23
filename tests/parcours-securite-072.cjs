// Parcours : correctifs de sécurité 072 côté front (économie, Secret Santa, secrets cachés, assistance).
// (a) Secret Santa : inscrits lus par la RPC hg_ss_people (sans les dates d'envoi des autres), ma ligne seule lue
//     dans hg_ss_participants ; phase « envoi » : « J'ai envoyé » actif ; phase « revelation » : envoi fermé,
//     réception ouverte (règles de la base).
// (b) Plafonds de Paillettes : souvenir au-delà de 5 par jour, sortie au-delà d'1 par semaine → message clair.
// (c) Sortie datée dans le passé par un membre : refus clair côté client (renvoi vers « rencontre passée »).
// (d) Anniversaire du gang : bannière décidée par la RPC hg_eggs_public (aucune lecture de hg_settings.eggs).
// (e) Assistance (visiteur) : sujets lus par la RPC hg_support_public.
// Faux Supabase : fixtures/fake-sb.mjs (RPC hg_ss_people, hg_eggs_public, hg_support_public, hg_eco_quota simulées).
// Lancer : node tests/parcours-securite-072.cjs
const { check, finish, openPage, log, sleep, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U2 = '00000002-0000-4000-8000-000000000002';
/** Date du jour à Zurich au format MM-JJ (pour l'anniversaire du gang). */
const mdZurich = () => {
  const parts = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  return `${parts.find((x) => x.type === 'month').value}-${parts.find((x) => x.type === 'day').value}`;
};
/** Texte de tous les messages temporaires affichés. */
const toasts = (p) => p.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
/** Date locale (datetime-local) décalée de n jours. */
function dansJours(n) {
  const d = new Date(Date.now() + n * 864e5);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:30`;
}

(async () => {
  const browser = await chromium.launch();

  /* ---------- (a) Secret Santa : inscrits par RPC ---------- */
  let p = await openPage(browser, { page: 'secret-santa' });
  await p.waitForSelector('#ss-signup .ss-big', { timeout: 8000 }).catch(() => {});
  const big = (await p.textContent('#ss-signup .ss-big').catch(() => '')) || '';
  check(/6\s+inscrits/.test(big.replace(/\s+/g, ' ')), `SS : 6 inscrits affichés (« ${big.trim()} »)`);
  let lg = await log(p);
  check(lg.some((x) => x[0] === 'rpc' && x[1] === 'hg_ss_people'), 'SS : liste des inscrits lue par hg_ss_people');
  check(await p.locator('#ss-people .ss-person').count() === 6, 'SS : 6 inscrits listés');
  check(await p.locator('#ss-people .ss-person.is-me').count() === 1, 'SS : ma ligne mise en évidence');
  check(!p.errs.length, 'SS : aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
  await p.ctx.close();

  // Phase « envoi » puis « revelation » avec une cible (membre non admin : pas de mode sans limite).
  for (const [status, sentOn, recOn] of [['envoi', true, true], ['revelation', false, true]]) {
    p = await openPage(browser, { page: 'secret-santa', scenario: {
      uid: U2,
      editions: [{ id: 'E25', year: 2025, status, budget: '20 CHF', drawn_at: new Date(Date.now() - 864e5).toISOString(), shared_fields: [] }],
      ssTarget: { receiver_id: ME, pseudo: 'Ethan' },
    } });
    await p.waitForSelector('#ss-sent', { timeout: 8000 }).catch(() => {});
    const sentDis = await p.$eval('#ss-sent', (b) => b.disabled).catch(() => null);
    const recDis = await p.$eval('#ss-received', (b) => b.disabled).catch(() => null);
    check(sentDis === !sentOn, `SS ${status} : « J’ai envoyé le cadeau » ${sentOn ? 'actif' : 'désactivé'} (${sentDis})`);
    check(recDis === !recOn, `SS ${status} : « J’ai reçu le mien » ${recOn ? 'actif' : 'désactivé'} (${recDis})`);
    if (status === 'envoi' && sentDis === false) {
      await p.click('#ss-sent');
      await sleep(400);
      lg = await log(p);
      check(lg.some((x) => x[0] === 'update' && x[1] === 'hg_ss_participants' && x[2]?.sent_at), 'SS envoi : seule la date d’envoi est envoyée');
    }
    check(!p.errs.length, `SS ${status} : aucune erreur JS` + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
    await p.ctx.close();
  }

  /* ---------- (b) Souvenir au-delà du plafond du jour ---------- */
  p = await openPage(browser, { page: 'historique', scenario: { ecoQuota: { souvenirs: { payes: 5, plafond: 5 } } } });
  await p.click('#btn-moment');
  await p.fill('#mo-title', 'Souvenir de test 072');
  await p.fill('#mo-date', '2026-10-01');
  await p.click('#mo-submit');
  await sleep(600);
  let t = await toasts(p);
  check(t.includes('mais tu as déjà gagné tes Paillettes souvenir du jour'), `souvenir : message de plafond (« ${t} »)`);
  await p.ctx.close();
  p = await openPage(browser, { page: 'historique', scenario: { ecoQuota: { souvenirs: { payes: 2, plafond: 5 } } } });
  await p.click('#btn-moment');
  await p.fill('#mo-title', 'Souvenir payé');
  await p.fill('#mo-date', '2026-10-01');
  await p.click('#mo-submit');
  await sleep(600);
  t = await toasts(p);
  check(t.includes('Moment ajouté à la frise.') && !t.includes('déjà gagné'), `souvenir sous le plafond : message habituel (« ${t} »)`);
  await p.ctx.close();

  /* ---------- (b) Sortie au-delà d'une par semaine ---------- */
  p = await openPage(browser, { page: 'irl', scenario: { ecoQuota: { sortie: { payees: 1, plafond: 1 } } } });
  await p.click('#btn-new');
  await p.fill('#ev-title', 'Sortie de test 072');
  await p.fill('#ev-starts', dansJours(10));
  await p.click('#ev-submit');
  await sleep(700);
  t = await toasts(p);
  check(t.includes('Tu as déjà gagné tes Paillettes de sortie cette semaine'), `sortie : message de plafond (« ${t} »)`);
  await p.ctx.close();

  /* ---------- (c) Sortie datée dans le passé (membre) ---------- */
  p = await openPage(browser, { page: 'irl', scenario: { uid: U2 } });
  await p.click('#btn-new');
  await p.fill('#ev-title', 'Hier soir');
  await p.fill('#ev-starts', dansJours(-1));
  await p.click('#ev-submit');
  await sleep(500);
  t = await toasts(p);
  lg = await log(p);
  check(t.includes('Ajouter une rencontre passée'), `sortie passée : message clair (« ${t} »)`);
  check(!lg.some((x) => x[0] === 'insert' && x[1] === 'hg_events'), 'sortie passée : rien n’est envoyé');
  await p.ctx.close();

  /* ---------- (d) Anniversaire du gang via hg_eggs_public ---------- */
  p = await openPage(browser, { page: 'accueil', scenario: { settings: [{ key: 'eggs', value: { anniversaire_gang: mdZurich(), mot_secret: 'X', recompenses: {} } }] } });
  await p.waitForSelector('.egg-anniv', { timeout: 8000 }).catch(() => {});
  check(await p.locator('.egg-anniv').count() === 1, 'anniversaire : bannière affichée');
  lg = await log(p);
  check(lg.some((x) => x[0] === 'rpc' && x[1] === 'hg_eggs_public'), 'anniversaire : décidé par hg_eggs_public');
  await p.ctx.close();

  /* ---------- (e) Assistance : sujets par hg_support_public (visiteur) ---------- */
  p = await openPage(browser, { page: 'assistance', scenario: { guest: true, settings: [{ key: 'support', value: { sujets: ['Bug sur le site', 'Autre', 'Sujet 072'], message_min: 10, max_par_heure: 3 } }] } });
  await p.waitForSelector('#support-form select[name="subject"] option', { state: 'attached', timeout: 8000 }).catch(() => {});
  const opts = await p.$$eval('#support-form select[name="subject"] option', (o) => o.map((x) => x.textContent));
  check(opts.includes('Sujet 072'), `assistance : sujets lus par hg_support_public (${opts.join(', ')})`);
  lg = await log(p);
  check(lg.some((x) => x[0] === 'rpc' && x[1] === 'hg_support_public') && !lg.some((x) => x[0] === 'rpc-401'), 'assistance : RPC accessible sans compte');
  check(!p.errs.length, 'assistance : aucune erreur JS' + (p.errs.length ? ` (${p.errs.join(' | ')})` : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
