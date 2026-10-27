// Parcours : proposer une sortie IRL (irl.html, bouton « Proposer une sortie »).
// Faux Supabase (fixtures/fake-sb.mjs) : l'insertion dans hg_events est acceptée et journalisée,
// et l'appel hg-notify (annonce Discord) est simulé. Le test vérifie ce que le client envoie,
// pas ce que la base enregistre.
// Lancer : node tests/parcours/irl/parcours-sortie.cjs
const { ROOT, check, finish, openPage, log, chromium } = require('../../lib/harness.cjs');

const TITRE = 'Bowling de test CI';
const LIEU = 'Lausanne';

// Date locale au format attendu par <input type="datetime-local"> (AAAA-MM-JJTHH:MM), dans 30 jours.
/** Date ISO dans trente jours, pour une sortie à venir. */
function dansTrenteJours() {
  const d = new Date(Date.now() + 30 * 864e5);
  /** Écrit un nombre sur deux chiffres (format de date). */
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T19:30`;
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();
  const p = await openPage(browser, { page: 'irl', scenario: {} });
  check(await p.isVisible('#btn-new'), 'irl : bouton « Proposer une sortie » visible');
  await p.click('#btn-new');
  await p.waitForSelector('#event-dialog[open]', { timeout: 5000 }).catch(() => {});
  check(await p.$eval('#event-dialog', (d) => d.open), 'formulaire de sortie ouvert');

  await p.fill('#ev-title', TITRE);
  await p.fill('#ev-location', LIEU);
  await p.fill('#ev-starts', dansTrenteJours());
  await p.click('#ev-submit');
  await p.waitForFunction(() => !document.querySelector('#event-dialog').open, null, { timeout: 5000 }).catch(() => {});
  await p.waitForTimeout(400);

  const journal = await log(p);
  const insert = journal.find((l) => l[0] === 'insert' && l[1] === 'hg_events');
  check(!!insert, 'insertion envoyée à hg_events');
  check(!!insert && insert[2].title === TITRE && insert[2].location === LIEU, 'la sortie contient le titre et le lieu saisis');
  check(!!insert && typeof insert[2].starts_at === 'string' && !Number.isNaN(Date.parse(insert[2].starts_at)), 'la date de début est envoyée en ISO');
  const notif = journal.find((l) => l[0] === 'fn' && l[1] === 'hg-notify' && l[2]?.event === 'irl_new');
  check(!!notif, 'annonce irl_new envoyée (hg-notify)');
  check(!(await p.$eval('#event-dialog', (d) => d.open).catch(() => false)), 'formulaire refermé après création');
  check(!p.errs.length, 'aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();
  await browser.close();
  finish();
})();
