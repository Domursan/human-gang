// Parcours : gérer les sorties IRL depuis l'administration (section « Sorties IRL », admin.html#sorties).
// Faux Supabase (fixtures/fake-sb.mjs) : le test vérifie ce que le client envoie (journal), pas ce que la base enregistre.
// Scénario : créer une sortie, la modifier, ajouter et retirer un inscrit, fixer une date, supprimer avec confirmation.
// Lancer : node tests/parcours-admin-sorties.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const EV_A = 'ea000000-0000-4000-8000-00000000000a'; // à venir, date fixée
const EV_B = 'eb000000-0000-4000-8000-00000000000b'; // à caler, deux dates proposées
const EV_C = 'ec000000-0000-4000-8000-00000000000c'; // passée, à supprimer
const D1 = 'd1000000-0000-4000-8000-000000000001';
const D2 = 'd2000000-0000-4000-8000-000000000002';
const days = (n) => new Date(Date.now() + n * 864e5).toISOString();

// Scénario : trois sorties, des inscriptions et deux dates avec un vote.
const SCN = {
  sorties: [
    { id: EV_A, title: 'Raclette au chalet', description: null, location: 'Villars', starts_at: days(10), cover_path: null, created_by: ME, created_at: days(-5), retro: false },
    { id: EV_B, title: 'Karaoké surprise', description: 'À choisir', location: null, starts_at: null, cover_path: null, created_by: U(2), created_at: days(-2), retro: false },
    { id: EV_C, title: 'Bowling de l\'hiver', description: null, location: 'Morges', starts_at: days(-20), cover_path: null, created_by: ME, created_at: days(-30), retro: false },
  ],
  rsvps: [
    { event_id: EV_A, user_id: U(2), status: 'oui', updated_at: days(-1) },
    { event_id: EV_A, user_id: U(3), status: 'peut-etre', updated_at: days(-1) },
  ],
  eventDates: [
    { id: D1, event_id: EV_B, proposed_at: days(5) },
    { id: D2, event_id: EV_B, proposed_at: days(6) },
  ],
  eventVotes: [{ date_id: D1, user_id: U(2) }],
};

const TITRE = 'Tartiflette de test CI';
const LIEU = 'Lausanne';

// Date locale (heure suisse, AAAA-MM-JJTHH:MM) dans 30 jours, pour le champ datetime-local.
function dansTrenteJours() {
  const d = new Date(Date.now() + 30 * 864e5);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:30`;
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'admin', scenario: SCN, width: 1280 });

  // 1. Navigation et liste
  check(await p.isVisible('nav.admin-nav a[href="#sorties"]'), 'admin : lien « Sorties IRL » dans la navigation');
  check((await p.getAttribute('nav.admin-nav a[href="#sorties"]', 'data-perm')) === 'evenements', 'lien de navigation marqué data-perm="evenements"');
  check((await p.getAttribute('#sorties', 'data-perm')) === 'evenements', 'section marquée data-perm="evenements"');
  check((await p.locator('#ass-list .ass-row').count()) === 2, 'filtre « À venir » : deux sorties (datée et à caler)');
  await p.selectOption('#ass-filter', 'passees');
  check((await p.locator('#ass-list .ass-row').count()) === 1, 'filtre « Passées » : la sortie passée seulement');
  await p.selectOption('#ass-filter', 'avenir');
  await p.fill('#ass-q', 'raclette');
  check((await p.locator('#ass-list .ass-row').count()) === 1, 'recherche par titre : une sortie');
  await p.fill('#ass-q', '');

  // 2. Création
  await p.click('#ass-new');
  await p.waitForSelector('#ass-e-form', { state: 'visible' });
  check(await p.$eval('#ass-edit', (d) => d.open), 'fenêtre de création ouverte');
  await p.fill('#ass-e-name', TITRE);
  await p.fill('#ass-e-loc', LIEU);
  await p.fill('#ass-e-start', dansTrenteJours());
  await p.click('#ass-e-submit');
  await p.waitForTimeout(500);
  let journal = await log(p);
  const ins = journal.find((l) => l[0] === 'insert' && l[1] === 'hg_events');
  check(!!ins && ins[2].title === TITRE && ins[2].location === LIEU, 'création : titre et lieu envoyés à hg_events');
  check(!!ins && ins[2].created_by === ME, 'création : organisateur = administrateur connecté');
  check(!!ins && !Number.isNaN(Date.parse(ins[2].starts_at)), 'création : date de début envoyée en ISO');
  check(journal.some((l) => l[0] === 'fn' && l[1] === 'hg-notify' && l[2]?.event === 'irl_new'), 'création : annonce irl_new envoyée');
  check(!(await p.$eval('#ass-edit', (d) => d.open).catch(() => false)), 'fenêtre refermée après création');

  // 3. Modification
  await p.click(`[data-act="edit"][data-id="${EV_A}"]`);
  await p.waitForSelector('#ass-e-form', { state: 'visible' });
  check((await p.inputValue('#ass-e-name')) === 'Raclette au chalet', 'modification : titre actuel pré-rempli');
  await p.fill('#ass-e-name', 'Raclette au chalet (modifiée)');
  await p.click('#ass-e-submit');
  await p.waitForTimeout(500);
  journal = await log(p);
  const upd = journal.find((l) => l[0] === 'update' && l[1] === 'hg_events' && l[2]?.title === 'Raclette au chalet (modifiée)');
  check(!!upd, 'modification : nouveau titre envoyé à hg_events');
  check(!journal.some((l) => l[0] === 'fn' && l[1] === 'hg-notify' && l[2]?.event === 'irl_new' && journal.indexOf(l) > journal.indexOf(upd)), 'modification : pas de nouvelle annonce');

  // 4. Inscrits : ajouter, changer la réponse, retirer
  await p.click(`[data-act="detail"][data-id="${EV_A}"]`);
  await p.waitForSelector('#ass-d-body', { state: 'visible' });
  check(await p.$eval('#ass-detail', (d) => d.open).catch(() => false), 'gestion : fenêtre des inscriptions ouverte');
  await p.selectOption('#ass-d-add-user', U(4));
  await p.selectOption('#ass-d-add-status', 'oui');
  await p.click('form[data-form="add-rsvp"] button[type="submit"]');
  await p.waitForTimeout(500);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'upsert' && l[1] === 'hg_event_rsvps' && l[2]?.user_id === U(4) && l[2]?.status === 'oui'), 'ajout d\'un inscrit : upsert hg_event_rsvps (membre, « je viens »)');

  await p.selectOption(`select[data-rsvp-user="${U(3)}"]`, 'non');
  await p.waitForTimeout(400);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'upsert' && l[1] === 'hg_event_rsvps' && l[2]?.user_id === U(3) && l[2]?.status === 'non'), 'changement de réponse : statut envoyé');

  await p.click(`[data-act="rm-rsvp"][data-user="${U(3)}"]`);
  await p.waitForTimeout(400);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'delete' && l[1] === 'hg_event_rsvps'), 'retrait d\'un inscrit : delete hg_event_rsvps');
  check(!(await p.$(`[data-act="rm-rsvp"][data-user="${U(3)}"]`)), 'inscrit retiré : absent de la fenêtre');
  await p.click('#ass-detail [data-close]');
  await p.waitForTimeout(200);

  // 5. Date retenue pour une sortie à caler
  await p.click(`[data-act="detail"][data-id="${EV_B}"]`);
  await p.waitForSelector('#ass-d-body', { state: 'visible' });
  await p.click(`[data-act="fix"][data-date="${D2}"]`);
  await p.waitForSelector('dialog[open] .dialog-title', { state: 'visible' });
  await p.locator('dialog[open] button.btn-primary').last().click();
  await p.waitForTimeout(500);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'update' && l[1] === 'hg_events' && l[2]?.starts_at && !Number.isNaN(Date.parse(l[2].starts_at))), 'date retenue : starts_at envoyé à hg_events');
  await p.click('#ass-detail [data-close]');
  await p.waitForTimeout(200);

  // 6. Suppression avec confirmation (la sortie passée est dans le filtre « Passées »)
  await p.selectOption('#ass-filter', 'passees');
  await p.click(`[data-act="delete"][data-id="${EV_C}"]`);
  await p.waitForSelector('dialog[open] .dialog-title', { state: 'visible' });
  const texte = await p.locator('dialog[open]').last().innerText();
  check(/inscription/.test(texte) && /photo/.test(texte), 'confirmation : indique les données liées supprimées');
  check((await log(p)).every((l) => !(l[0] === 'delete' && l[1] === 'hg_events')), 'aucune suppression avant confirmation');
  await p.locator('dialog[open] button.btn-danger').last().click();
  await p.waitForTimeout(500);
  journal = await log(p);
  check(journal.some((l) => l[0] === 'delete' && l[1] === 'hg_events'), 'suppression confirmée : delete hg_events');
  check(!(await p.$(`[data-act="delete"][data-id="${EV_C}"]`)), 'sortie supprimée : disparue de la liste');

  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
