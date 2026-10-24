// Parcours : réglages du lot 3 (Secret Santa, sorties IRL, souvenirs et albums).
// 1. Admin : les blocs « Réglages » apparaissent dans Vie · Sorties, Vie · Secret Santa et Souvenirs.
// 2. Admin : validation (minimum supérieur au maximum refusé), enregistrement dans hg_settings,
//    « Rétablir la valeur par défaut » par champ.
// 3. Site : un réglage enregistré est lu par la page Secret Santa (limite de souhaits) ; sans réglage, aucune limite.
// Faux Supabase (fixtures/fake-sb.mjs) : le test vérifie ce que le client envoie (journal) et ce que la page affiche.
// Lancer : node tests/parcours-reglages-lot3.cjs
const { ROOT, check, finish, openPage, adminSection, log, chromium } = require('./lib/harness.cjs');

/** Sélecteur du bloc de réglages du domaine donné. */
const bloc = (domaine) => `details.rg3-bloc[data-domaine="${domaine}"]`;
/** Attend ms millisecondes. */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Dernier upsert de hg_settings pour une clé, dans le journal du faux client. */
function upsertDe(journal, cle) {
  const ups = journal.filter((l) => l[0] === 'upsert' && l[1] === 'hg_settings' && l[2] && l[2].key === cle);
  return ups.length ? ups[ups.length - 1][2] : null;
}

(async () => {
  console.log('Racine testée : ' + ROOT);
  const browser = await chromium.launch();

  // 1 et 2. Administration : Sorties IRL
  const p = await openPage(browser, { page: 'admin', width: 1280 });
  await adminSection(p, 'irl/sorties');
  await p.waitForSelector(`${bloc('irl')} summary`, { timeout: 8000 }).catch(() => {});
  check((await p.locator(bloc('irl')).count()) === 1, 'sorties : bloc « Réglages : Sorties IRL » présent');
  await p.locator(`${bloc('irl')} summary`).click();
  await p.waitForSelector('#rg3-irl-sondage_max', { state: 'visible', timeout: 5000 }).catch(() => {});
  check((await p.inputValue('#rg3-irl-sondage_max')) === '6', 'sorties : maximum de dates affiché avec son défaut (6)');
  check((await p.inputValue('#rg3-irl-delai_passee_heures')) === '6', 'sorties : délai de passage affiché avec son défaut (6 h)');

  // Validation : minimum supérieur au maximum
  await p.fill('#rg3-irl-sondage_min', '5');
  await p.fill('#rg3-irl-sondage_max', '3');
  await p.click(`${bloc('irl')} button[type="submit"]`);
  await sleep(400);
  let journal = await log(p);
  check(!upsertDe(journal, 'irl'), 'validation : minimum > maximum refusé, rien n’est envoyé à hg_settings');
  check((await p.textContent('[data-champ="irl.sondage_max"] .form-error')).includes('au moins égal'), 'validation : message d’erreur sous le maximum');

  // Validation : hors bornes
  await p.fill('#rg3-irl-sondage_min', '2');
  await p.fill('#rg3-irl-sondage_max', '40');
  await p.click(`${bloc('irl')} button[type="submit"]`);
  await sleep(300);
  check(!upsertDe(await log(p), 'irl'), 'validation : maximum hors bornes (40) refusé');

  // Enregistrement
  await p.fill('#rg3-irl-sondage_max', '4');
  await p.click(`${bloc('irl')} button[type="submit"]`);
  await sleep(500);
  journal = await log(p);
  const enr = upsertDe(journal, 'irl');
  check(!!enr && enr.value.sondage_max === 4 && enr.value.sondage_min === 2, 'enregistrement : hg_settings.irl reçoit sondage_max = 4');
  check(!!enr && enr.value.delai_passee_heures === 6 && enr.value.duree_defaut_heures === 2, 'enregistrement : les autres champs gardent leur valeur par défaut');

  // Rétablir la valeur par défaut d'un champ
  await p.click('[data-rg3-reset="irl|sondage_max"]');
  await sleep(500);
  journal = await log(p);
  const reset = upsertDe(journal, 'irl');
  check(!!reset && reset.value.sondage_max === 6, 'rétablir : sondage_max revient à 6 dans hg_settings');
  check((await p.inputValue('#rg3-irl-sondage_max')) === '6', 'rétablir : le champ affiche 6');

  // Les autres sections ont leur bloc
  await adminSection(p, 'irl/secret-santa');
  await p.waitForSelector(bloc('ss'), { timeout: 8000 }).catch(() => {});
  check((await p.locator(bloc('ss')).count()) === 1, 'Secret Santa : bloc « Réglages : Secret Santa » présent');
  await p.locator(`${bloc('ss')} summary`).click();
  await p.waitForSelector('#rg3-ss-min_participants', { state: 'visible', timeout: 5000 }).catch(() => {});
  check((await p.inputValue('#rg3-ss-min_participants')) === '3', 'Secret Santa : minimum de participants affiché (3)');
  await p.fill('#rg3-ss-min_participants', '4');
  await p.click(`${bloc('ss')} button[type="submit"]`);
  await sleep(500);
  const ss = upsertDe(await log(p), 'ss');
  check(!!ss && ss.value.min_participants === 4 && ss.value.eviter_meme_cible_annee_precedente === true, 'Secret Santa : minimum 4 enregistré, éviter la même cible gardé à true');

  await adminSection(p, 'irl/souvenirs');
  await p.waitForSelector(bloc('souvenirs'), { timeout: 8000 }).catch(() => {});
  check((await p.locator(bloc('souvenirs')).count()) === 1, 'Souvenirs : bloc « Réglages : Souvenirs et photos » présent');
  await p.locator(`${bloc('souvenirs')} summary`).click();
  await p.waitForSelector('#rg3-albums-max_mo', { state: 'visible', timeout: 5000 }).catch(() => {});
  check((await p.inputValue('#rg3-albums-max_mo')) === '300', 'Souvenirs : poids maximum d’un album affiché (300 Mo)');
  check((await p.inputValue('#rg3-photos-qualite')) === '0.85', 'Souvenirs : qualité des photos affichée (0,85)');
  // Rétablir un groupe entier
  await p.fill('#rg3-albums-max_mo', '50');
  await p.click(`${bloc('souvenirs')} button[type="submit"]`);
  await sleep(400);
  await p.click('[data-rg3-reset-groupe="souvenirs|Albums ZIP"]');
  await sleep(500);
  const grp = upsertDe(await log(p), 'albums');
  check(!!grp && grp.value.max_mo === 300 && grp.value.max_photos === 400, 'rétablir le groupe « Albums ZIP » : 300 Mo et 400 photos');
  check((await p.inputValue('#rg3-albums-max_mo')) === '300', 'rétablir le groupe : le champ affiche 300');
  check(!p.errs.length, 'admin : aucune erreur JS' + (p.errs.length ? ' (' + p.errs.join(' | ') + ')' : ''));
  await p.ctx.close();

  // 3. Site : limite de souhaits lue depuis hg_settings.ss
  const m = await openPage(browser, { page: 'secret-santa', width: 1280, scenario: { settings: [{ key: 'ss', value: { souhaits_max: 1 } }] } });
  await m.waitForSelector('#ss-w-label', { timeout: 8000 }).catch(() => {});
  if (await m.$('#ss-w-label')) {
    await m.fill('#ss-w-label', 'Premier souhait');
    await m.click('#ss-w-label >> xpath=ancestor::form//button[@type="submit"]');
    await sleep(500);
    await m.fill('#ss-w-label', 'Deuxième souhait');
    await m.click('#ss-w-label >> xpath=ancestor::form//button[@type="submit"]');
    await sleep(500);
    const ins = (await log(m)).filter((l) => l[0] === 'insert' && l[1] === 'hg_ss_wishes');
    check(ins.length === 1, 'souhaits_max = 1 : le second souhait est refusé (un seul insert envoyé)');
  } else {
    check(false, 'page Secret Santa : formulaire de souhaits visible (inscription du compte de test)');
  }
  check(!m.errs.length, 'page Secret Santa avec réglages : aucune erreur JS' + (m.errs.length ? ' (' + m.errs.join(' | ') + ')' : ''));
  await m.ctx.close();

  // Sans réglage : aucune limite (comportement actuel)
  const d = await openPage(browser, { page: 'secret-santa', width: 1280 });
  await d.waitForSelector('#ss-w-label', { timeout: 8000 }).catch(() => {});
  if (await d.$('#ss-w-label')) {
    for (const t of ['Un', 'Deux']) {
      await d.fill('#ss-w-label', t);
      await d.click('#ss-w-label >> xpath=ancestor::form//button[@type="submit"]');
      await sleep(400);
    }
    const ins = (await log(d)).filter((l) => l[0] === 'insert' && l[1] === 'hg_ss_wishes');
    check(ins.length === 2, 'sans réglage : deux souhaits acceptés (aucune limite)');
  }
  check(!d.errs.length, 'page Secret Santa sans réglage : aucune erreur JS');
  await d.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exitCode = 1; });
