// Parcours : défi de duel reçu (/pages/jeux/duels.html#rejoindre/CODE et liste « Défis reçus » de l'accueil des duels).
// Conditions proches du réel : ordinateur 1280 px, thème Halloween forcé avec pluie d'emojis, temps réel simulé,
// arrivée par le lien de la notification depuis une autre page du site.
//  1. Défi ouvert : carte du défi, rien par-dessus « Accepter », le clic affiche « Connexion… », appelle hg_duel_rejoindre et ouvre #partie/CODE.
//  2. Défi annulé par l'hôte avant l'arrivée (cas réel du 27 octobre : notification ouverte après l'annulation, décompte encore
//     en cours) : « Ce défi n'est plus ouvert », pas de bouton Accepter, « Le défier à ton tour » vers #creer/membre/<hôte>.
//  3. Hôte qui annule pendant que la carte est ouverte (temps réel) : la carte est remplacée.
//  4. Défi fermé entre l'affichage et le clic (le serveur répond « Ce duel a déjà commencé. ») : la vraie raison est affichée.
//  5. Défi déjà accepté (moi.joue) : le lien mène directement à #partie/CODE.
//  6. Défi expiré (décompte à zéro) : « Ce défi n'est plus ouvert ».
//  7. Accueil, « Défis reçus » : Accepter appelle hg_duel_rejoindre et ouvre #partie/CODE ; défi fermé entre-temps : message clair.
// Faux Supabase : fixtures/fake-sb-duels-plateaux.mjs (état dans window.__DUELS.etat, réponses dans window.__DUELS.rpc).
const { check, finish, openPage, sleep, chromium } = require('../../lib/harness.cjs');

const CODE = 'HGP4-6392';
const HOTE = '95351323-b929-4c6f-b87c-0003985d4c97';
const HALLOWEEN = { slug: 'halloween', name: 'Halloween', is_default: false, active: true, start_md: '10-01', end_md: '10-31', priority: 3, logo_url: null,
  emojis: ['🎃', '👻', '🦇'], effect: 'pluie', colors: { bg: '#120B12', text: '#F4EAE0', muted: '#B9A9A0', accent: '#E8742E', surface: '#1E141E', highlight: '#F2A341' } };
const SCENARIO = { realtime: true, themes: [HALLOWEEN], themeSetting: { mode: 'forced', forced_slug: 'halloween' } };

/** État renvoyé par hg_duel_etat au membre défié (forme réelle : partie, joueurs, maintenant, moi). */
function etat({ statut = 'attente', expireDans = 6 * 60 * 1000, joue = false } = {}) {
  const now = Date.now();
  return {
    maintenant: new Date(now).toISOString(),
    moi: { user_id: 'moi', joue, defie: true, hote: false, invite: false, spectateur: false, place: joue ? 2 : null },
    partie: { id: 'p-6392', code: CODE, jeu: 'p4', nom: 'Puissance 4', variante: 'classique', format: 3, t_coup: 30, statut, hote: HOTE,
      defie: 'moi', defi_expire: new Date(now + expireDans).toISOString(), version: 1, robot: null, visibilite: 'privee', invites: false },
    joueurs: [{ user_id: HOTE, pseudo: 'Domu', place: 1, couleur: '#E8742E' }].concat(joue ? [{ user_id: 'moi', pseudo: 'Moi', place: 2 }] : []),
  };
}

/** Script d'initialisation : état du duel et réponses des RPC (texte : exécuté dans la page avant le chargement). */
const init = (e, rpc = '') => ({ content: `window.__DUELS = { possibles: [], appels: [], etat: ${JSON.stringify(e)}, rpc: {${rpc}} };` });

/** Appels RPC journalisés par la fausse base, pour une fonction. */
const appels = (p, fn) => p.evaluate((f) => (window.__LOG || []).filter((x) => x[0] === 'rpc' && x[1] === f).map((x) => x[2]), fn);

/** Ouvre une autre page, puis suit le lien de la notification (comme un membre qui clique dans la cloche). */
async function parLaNotification(browser, initScript) {
  const p = await openPage(browser, { page: 'jeux', fixture: 'fake-sb-duels-plateaux.mjs', width: 1280, height: 900, scenario: SCENARIO, init: initScript });
  await p.evaluate((href) => {
    const a = document.createElement('a');
    a.href = href; a.textContent = 'Domu te défie !'; a.id = 'lien-notif';
    a.style.cssText = 'position:fixed;left:400px;top:300px;z-index:99999;background:#000;color:#fff;padding:12px';
    document.body.append(a);
  }, `/pages/jeux/duels.html#rejoindre/${CODE}`);
  await Promise.all([p.waitForURL(/duels\.html/), p.click('#lien-notif')]);
  return p;
}

(async () => {
  const browser = await chromium.launch();

  // 1. Défi ouvert, arrivée par la notification depuis la page Jeux.
  let p = await parLaNotification(browser, init(etat(), `
    hg_duel_rejoindre: (a) => { window.__DUELS.etat.partie.statut = 'en_cours'; window.__DUELS.etat.moi.joue = true; window.__DUELS.etat.partie.version = 2; return a.p_code; },`));
  await p.waitForSelector('[data-accepter]', { timeout: 5000 }).catch(() => {});
  check(await p.locator('.fx-layer.fx-pluie').count() === 1, '1. thème Halloween : pluie d’emojis active');
  check((await p.locator('#defi-titre').innerText().catch(() => '')).includes('Domu te défie au Puissance 4'), '1. carte du défi : « Domu te défie au Puissance 4 »');
  check(await p.locator('[data-accepter]').isEnabled().catch(() => false), '1. « Accepter le duel » actif');
  const dessus = await p.evaluate(() => {
    const b = document.querySelector('[data-accepter]').getBoundingClientRect();
    const pts = [[0.5, 0.5], [0.1, 0.5], [0.9, 0.5]].map(([fx, fy]) => document.elementFromPoint(b.left + b.width * fx, b.top + b.height * fy));
    return pts.every((el) => el?.closest('[data-accepter]'));
  });
  check(dessus, '1. rien ne recouvre « Accepter » (centre et bords, 1280 px)');
  await p.locator('[data-accepter]').click();
  await p.waitForFunction((c) => location.hash === `#partie/${c}`, CODE, { timeout: 4000 }).catch(() => {});
  const rj = await appels(p, 'hg_duel_rejoindre');
  check(rj.length === 1 && rj[0].p_code === CODE, '1. Accepter appelle hg_duel_rejoindre avec le code');
  check(await p.evaluate(() => location.hash) === `#partie/${CODE}`, '1. le duel s’ouvre (#partie/CODE)');
  await p.ctx.close();

  // 2. Défi annulé par l'hôte avant l'arrivée (décompte côté serveur encore positif).
  p = await parLaNotification(browser, init(etat({ statut: 'annulee' })));
  await p.waitForSelector('.duels-defi-ferme', { timeout: 5000 }).catch(() => {});
  check(await p.locator('.duels-defi-ferme').count() === 1, '2. défi annulé : carte « Ce défi n’est plus ouvert »');
  check(await p.locator('[data-accepter]').count() === 0, '2. défi annulé : pas de bouton Accepter');
  check((await p.locator('.duels-defi-ferme').innerText()).includes('annulé'), '2. la raison est donnée (annulé ou délai passé)');
  check(await p.locator(`.duels-defi-ferme a[href="#creer/membre/${HOTE}"]`).count() === 1, '2. « Le défier à ton tour » mène à #creer/membre/<hôte>');
  check(p.errs.length === 0, '2. aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  // 3. L'hôte annule pendant que la carte est ouverte : temps réel sur hg_duel_parties.
  p = await parLaNotification(browser, init(etat()));
  await p.waitForSelector('[data-accepter]', { timeout: 5000 }).catch(() => {});
  check((await p.evaluate(() => window.__fakeRealtime.tables())).includes('hg_duel_parties'), '3. la carte du défi suit le duel en temps réel');
  await p.evaluate(() => {
    // Nouvel objet, comme une vraie réponse du serveur (le suivi compare l'ancienne et la nouvelle version).
    const e = structuredClone(window.__DUELS.etat);
    Object.assign(e.partie, { statut: 'annulee', version: 2 });
    window.__DUELS.etat = e;
    window.__fakeRealtime.emit('hg_duel_parties', { eventType: 'UPDATE', new: { id: 'p-6392' } });
  });
  await p.waitForSelector('.duels-defi-ferme', { timeout: 2000 }).catch(() => {});
  check(await p.locator('.duels-defi-ferme').count() === 1 && await p.locator('[data-accepter]').count() === 0, '3. annulation par l’hôte : la carte est remplacée tout de suite');
  await p.ctx.close();

  // 4. Défi fermé entre l'affichage et le clic : le serveur répond « Ce duel a déjà commencé. ».
  p = await parLaNotification(browser, init(etat(), `
    hg_duel_rejoindre: () => { window.__DUELS.etat.partie.statut = 'annulee'; throw new Error('Ce duel a déjà commencé.'); },`));
  await p.waitForSelector('[data-accepter]', { timeout: 5000 }).catch(() => {});
  await p.locator('[data-accepter]').click();
  await p.waitForSelector('.duels-defi-ferme', { timeout: 3000 }).catch(() => {});
  check(await p.locator('.duels-defi-ferme').count() === 1, '4. clic sur un défi fermé entre-temps : « Ce défi n’est plus ouvert »');
  check(!(await p.locator('.toast').allInnerTexts()).some((t) => t.includes('déjà commencé')), '4. pas de message trompeur « Ce duel a déjà commencé »');
  await p.ctx.close();

  // 5. Défi déjà accepté : le lien de la notification mène à la partie.
  p = await parLaNotification(browser, init(etat({ statut: 'en_cours', joue: true })));
  await p.waitForFunction((c) => location.hash === `#partie/${c}`, CODE, { timeout: 4000 }).catch(() => {});
  check(await p.evaluate(() => location.hash) === `#partie/${CODE}`, '5. défi déjà accepté : ouverture directe de #partie/CODE');
  await p.ctx.close();

  // 6. Défi expiré (décompte à zéro, le serveur ne l'a pas encore annulé).
  p = await openPage(browser, { page: 'duels', fixture: 'fake-sb-duels-plateaux.mjs', hash: `#rejoindre/${CODE}`, width: 1280, scenario: SCENARIO, init: init(etat({ expireDans: -30000 })) });
  await p.waitForSelector('.duels-defi-ferme', { timeout: 4000 }).catch(() => {});
  check((await p.locator('.duels-defi-ferme').innerText().catch(() => '')).includes('a expiré'), '6. défi expiré : « Le défi de Domu a expiré. », pas de bouton Accepter');
  await p.ctx.close();

  // 7. Accueil des duels, liste « Défis reçus ».
  const accueil = (rejoindre) => init(etat(), `
    hg_duel_accueil: () => ({ defis_recus: window.__DUELS.etat.partie.statut === 'attente' ? [{ code: '${CODE}', jeu: 'p4', variante: 'classique', nom: 'Puissance 4', format: 3, t_coup: 30,
      expire: window.__DUELS.etat.partie.defi_expire, hote_pseudo: 'Domu', hote_couleur: '#E8742E' }] : [], mes_duels: [], ouverts: [], en_direct: [], resume: null }),
    hg_duel_membres: () => [],
    hg_duel_rejoindre: ${rejoindre},`);
  p = await openPage(browser, { page: 'duels', fixture: 'fake-sb-duels-plateaux.mjs', width: 1280, scenario: SCENARIO,
    init: accueil(`(a) => { Object.assign(window.__DUELS.etat.partie, { statut: 'en_cours', version: 2 }); window.__DUELS.etat.moi.joue = true; return a.p_code; }`) });
  const btnAcc = p.locator('#acc-defis button[data-action="accepter"]');
  await btnAcc.waitFor({ timeout: 5000 }).catch(() => {});
  check(await btnAcc.count() === 1, '7. accueil : le défi reçu est listé avec « Accepter »');
  await btnAcc.click().catch(() => {});
  await p.waitForFunction((c) => location.hash === `#partie/${c}`, CODE, { timeout: 4000 }).catch(() => {});
  check((await appels(p, 'hg_duel_rejoindre')).length === 1 && await p.evaluate(() => location.hash) === `#partie/${CODE}`, '7. accueil : Accepter rejoint le duel et l’ouvre');
  await p.ctx.close();

  p = await openPage(browser, { page: 'duels', fixture: 'fake-sb-duels-plateaux.mjs', width: 1280, scenario: SCENARIO,
    init: accueil(`() => { window.__DUELS.etat.partie.statut = 'annulee'; throw new Error('Ce duel a déjà commencé.'); }`) });
  await p.locator('#acc-defis button[data-action="accepter"]').waitFor({ timeout: 5000 }).catch(() => {});
  await p.locator('#acc-defis button[data-action="accepter"]').click().catch(() => {});
  await sleep(800);
  const toasts = (await p.locator('.toast').allInnerTexts()).join(' | ');
  check(toasts.includes('n’est plus ouvert') && !toasts.includes('déjà commencé'), '7. accueil : défi fermé entre-temps, message clair (pas « déjà commencé »)');
  await p.waitForFunction(() => !document.querySelector('#acc-defis button[data-action="accepter"]'), null, { timeout: 3000 }).catch(() => {});
  check(await p.locator('#acc-defis button[data-action="accepter"]').count() === 0, '7. accueil : le défi fermé disparaît de la liste');
  check(p.errs.length === 0, '7. aucune erreur JS' + (p.errs.length ? ' : ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
