// Parcours C4 (migration 080) : cartes « J’y étais » des sorties IRL.
// 1. irl.html : sous une sortie passée qui a sa carte, l'encart montre la carte (tampon « J’y étais »), « Dans ta collection »,
//    le nombre de membres qui l'ont reçue et « Non échangeable ».
// 2. Organisateur (dans les 14 jours) : « Il était là aussi » appelle hg_event_card_add avec le membre choisi.
// 3. Sortie sans carte : pas d'encart.
// 4. Admin › Sorties IRL : section « Carte de la sortie » ; « Créer la carte » appelle hg_event_card_set (rareté suggérée).
// 5. Téléphone 360 px : pas de défilement horizontal.
const { openPage, check, finish, hscroll, log, sleep, chromium } = require('./lib/harness.cjs');

const ME = '11111111-1111-4111-8111-111111111111';
const U = (n) => `0000000${n}-0000-4000-8000-00000000000${n}`;
const iso = (d) => new Date(Date.now() + d * 864e5).toISOString();
const EV = 'eeeeeeee-0000-4000-8000-0000000000c4';
const EV2 = 'eeeeeeee-0000-4000-8000-0000000000c5';
const scenario = {
  sorties: [
    { id: EV, title: 'RDV Lyon 2026', location: 'Lyon', starts_at: iso(-3), created_by: ME, created_at: iso(-40), card_id: 'CJY1', retro: false },
    { id: EV2, title: 'Week-end chez Wae', location: 'Annecy', starts_at: iso(-60), created_by: U(2), created_at: iso(-90), card_id: null, retro: false },
  ],
  rsvps: [{ event_id: EV, user_id: ME, status: 'oui', self_answered: true }, { event_id: EV, user_id: U(2), status: 'oui', self_answered: true }, { event_id: EV, user_id: U(3), status: 'oui', self_answered: true }],
  c080: {
    hg_cards: [{ id: 'CJY1', set_id: 'SET-SO', number: 1, name: 'RDV Lyon 2026', family: 'lieu', rarity: 'epique', image_url: 'assets/cards/hiver-raclette/001.png',
      flavor: 'La photo de famille, enfin tout le monde dessus.', caption: '20.10.2026 · J’y étais', tradeable: false, craftable: false, can_shiny: false, active: true }],
    hg_event_card_claims: [{ event_id: EV, user_id: ME }, { event_id: EV, user_id: U(2) }],
  },
};

(async () => {
  const browser = await chromium.launch();
  let p = await openPage(browser, { page: 'irl', scenario, width: 1100 });
  await p.waitForSelector(`#event-${EV} .jy`, { timeout: 8000 });
  const box = `#event-${EV} .jy`;
  check(await p.$(`${box} .hgc .hgc-stamp`), '(1) carte avec tampon « J’y étais »');
  check((await p.textContent(box)).includes('Dans ta collection'), '(1) « Dans ta collection »');
  check((await p.textContent(box)).includes('2 membres l’ont reçue'), '(1) « 2 membres l’ont reçue »');
  check((await p.textContent(box)).includes('Non échangeable'), '(1) « Non échangeable »');
  check(!(await p.$(`#event-${EV2} .jy`)), '(3) sortie sans carte : pas d’encart');
  const opts = await p.$$eval(`${box} select option`, (o) => o.map((x) => x.textContent));
  check(opts.includes('Bruno') && !opts.includes('Alice') && !opts.includes('Ethan'), `(2) choix : seulement ceux qui ne l’ont pas (${opts.join(', ')})`);
  await p.selectOption(`${box} select`, U(3));
  await p.click(`${box} [data-jy-add]`);
  await sleep(600);
  const add = (await log(p)).filter((x) => x[0] === 'rpc' && x[1] === 'hg_event_card_add').pop();
  check(add && add[2].p_event === EV && add[2].p_user === U(3), '(2) hg_event_card_add avec la sortie et le membre');
  await p.screenshot({ path: 'tests/shots/c4-irl.png' });
  check(!p.errs.length, '(1) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();

  p = await openPage(browser, { page: 'irl', scenario, width: 360, height: 780 });
  await p.waitForSelector(`#event-${EV} .jy`, { timeout: 8000 });
  check((await hscroll(p)) <= 0, '(5) 360 px : pas de défilement horizontal');
  await p.ctx.close();

  p = await openPage(browser, { page: 'admin', scenario, width: 1280, hash: `#vie/sorties/${EV2}` });
  await p.waitForSelector('#ass-d-carte .ass-jy-form', { timeout: 8000 });
  check((await p.textContent('#ass-d-carte')).includes('Carte de la sortie'), '(4) section « Carte de la sortie »');
  await p.click('#ass-d-carte [type=submit]');
  await sleep(700);
  const set = (await log(p)).filter((x) => x[0] === 'rpc' && x[1] === 'hg_event_card_set').pop();
  check(set && set[2].p_event === EV2 && set[2].p.name === 'Week-end chez Wae' && set[2].p.rarity === 'commune' && set[2].p.tradeable === false,
    `(4) hg_event_card_set : ${JSON.stringify(set && set[2].p)}`);
  check(!p.errs.length, '(4) aucune erreur de page ' + p.errs.join(' | '));
  await p.ctx.close();
  await browser.close();
  finish();
})();
