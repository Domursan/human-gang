// Parcours : arcade sans limite de temps (Paillettes, Raclette : trois vies ; Domu-mobile : premier accrochage).
// Règles testées sur les vrais modules (importés dans la page, hasard graîné) : pièges et cornichons coûtent une vie,
// fin à zéro vie, pas de chrono, Domu non plafonné, cadence des paillettes et des cornichons sous le plafond serveur
// (6 points par seconde), HUD des vies (cœurs + texte lu par les lecteurs d'écran, absent pour Domu-mobile).
// Faux Supabase : fixtures/fake-sb.mjs (scénario arcadeGame).
const { check, finish, openPage, chromium } = require('./lib/harness.cjs');

(async () => {
  const browser = await chromium.launch();

  /* ---------- Règles, sur les modules réels (pas de dessin, pas d'horloge) ---------- */
  let p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 1280, scenario: { arcadeGame: 'paillettes' } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  const r = await p.evaluate(async () => {
    const P = (await import('/assets/js/eggs/jeu-paillettes.js')).JEU;
    const R = (await import('/assets/js/eggs/jeu-raclette.js')).JEU;
    const D = (await import('/assets/js/eggs/jeu-domu.js')).JEU;
    const { H } = await import('/assets/js/eggs/arcade.js');
    const SOL = H - 52, CY = H - 70;
    const aucune = { cible: null, fleche: 0, pas: 0 };
    /** Générateur graîné (mulberry32) : la suite de tests est reproductible. */
    const graine = (g) => { let a = g >>> 0; Math.random = () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
    /** Simule `secondes` de jeu (pas de 0,05 s), compte les apparitions (objets nouveaux) et les pièges. */
    const simule = (J, s, secondes, extra = {}) => {
      const vus = new WeakSet(); let n = 0, pieges = 0, grele = 0, grele30 = 0;
      for (let i = 0; i < secondes / 0.05; i++) {
        J.update(s, 0.05, { ...aucune, ...extra });
        for (const it of s.items) if (!vus.has(it)) { vus.add(it); n++; if (it.piege) pieges++; if (it.piege === 'grele') { grele++; if (s.ecoule < 30) grele30++; } }
        s.x = s.cible = 9999; // panier hors champ : on ne ramasse rien, la cadence seule est mesurée
      }
      return { n, pieges, grele, grele30 };
    };
    const out = {};
    graine(7);
    // Paillettes
    let s = P.init({ reduit: false });
    out.temps = 'temps' in P;
    out.viesDepart = JSON.stringify(P.vies(s));
    out.finDepart = P.fini(s);
    s.items = [{ x: s.x, y: SOL + 2, v: 0, r: 9, t: 0, piege: 'fausse' }];
    P.update(s, 0.016, aucune);
    out.piegeVies = s.vies; out.piegeScore = s.score; out.piegeSecousse = s.secousse > 0; out.piegeFlash = s.flash > 0;
    s.items = [{ x: s.x, y: SOL + 2, v: 0, r: 9, t: 0, piege: 'grele' }];
    P.update(s, 0.016, aucune);
    out.greleVies = s.vies;
    s.items = [{ x: s.x, y: SOL + 2, v: 0, r: 9, t: 0, piege: 'fausse' }];
    P.update(s, 0.016, aucune);
    out.finApresTroisPieges = P.fini(s) && s.vies === 0;
    s = P.init({ reduit: false });
    s.items = [{ x: s.x, y: SOL + 2, v: 0, r: 9, t: 0, piege: null }];
    P.update(s, 0.016, aucune);
    out.paillettePoints = s.score; out.pailletteVies = s.vies;
    s = P.init({ reduit: false });
    s.items = [{ x: s.x, y: H + 30, v: 0, r: 9, t: 0, piege: 'fausse' }];
    P.update(s, 0.016, aucune);
    out.ratePiege = [s.items.length, s.vies];
    s = P.init({ reduit: true });
    s.items = [{ x: s.x, y: SOL + 2, v: 0, r: 9, t: 0, piege: 'fausse' }];
    P.update(s, 0.016, aucune);
    out.reduitVies = s.vies; out.reduitSecousse = s.secousse;
    // Cadence et mix sur deux minutes (tous les pièges, sans ramasser)
    out.paill = simule(P, P.init({ reduit: false }), 120);
    out.paillReduit = simule(P, P.init({ reduit: true }), 120).n;
    // Raclette
    s = R.init({ reduit: false }); s.score = 2;
    out.racVies = JSON.stringify(R.vies(s));
    s.items = [{ corn: true, x: s.x, y: H - 48, v: 0, a: 0 }];
    R.update(s, 0.016, aucune);
    out.cornichonVies = s.vies; out.cornichonScore = s.score;
    s.items = [{ corn: true, x: s.x, y: H - 48, v: 0, a: 0 }]; R.update(s, 0.016, aucune);
    s.items = [{ corn: true, x: s.x, y: H - 48, v: 0, a: 0 }]; R.update(s, 0.016, aucune);
    out.racFin = R.fini(s) && s.vies === 0 && s.score === 2;
    out.racCadence = simule(R, R.init({ reduit: false }), 120).n;
    // Domu-mobile : pas de vies, pas de plafond de temps
    s = D.init({ reduit: false });
    out.domuVies = D.vies(s);
    s.ecoule = 200;
    D.update(s, 0.016, aucune);
    out.domuFinSansAccroc = D.fini(s); out.domuScore = D.score(s);
    s.items = [{ j: false, voie: s.voie, y: CY, c: '#5A5A62' }];
    D.update(s, 0.016, aucune);
    out.domuFinAccroc = D.fini(s);
    s = D.init({ reduit: false });
    s.items = [{ j: true, voie: s.voie, y: CY, c: null }];
    D.update(s, 0.016, aucune);
    out.domuJerry = D.score(s);
    return out;
  });
  check(!r.temps, 'Paillettes : plus de fonction temps (pas de chrono)');
  check(r.viesDepart === '{"left":3,"max":3}' && !r.finDepart, 'Paillettes : trois vies au départ, partie en cours');
  check(r.piegeVies === 2 && r.piegeScore === 0 && r.piegeSecousse && r.piegeFlash, 'Paillettes : une fausse paillette coûte une vie (flash, secousse), ne rapporte rien');
  check(r.greleVies === 1, 'Paillettes : un grêlon coûte aussi une vie');
  check(r.finApresTroisPieges, 'Paillettes : la partie finit à zéro vie');
  check(r.paillettePoints === 1 && r.pailletteVies === 3, 'Paillettes : une paillette ramassée = 1 point, vies intactes');
  check(r.ratePiege[0] === 0 && r.ratePiege[1] === 3, 'Paillettes : un piège raté ne coûte rien');
  check(r.reduitVies === 2 && r.reduitSecousse === 0, 'Paillettes, animation réduite : la vie est perdue, sans secousse');
  check(r.paill.n >= 300 && r.paill.n <= 3.34 * 120 + 2, `Paillettes : cadence ≤ 3,34 apparitions/s sur 2 min (${r.paill.n} en 120 s, plafond serveur 6 pts/s)`);
  check(r.paill.pieges > 0 && r.paill.pieges / r.paill.n <= 0.26, `Paillettes : pièges ${r.paill.pieges}/${r.paill.n} (≤ 25 %, jamais majoritaires)`);
  check(r.paill.grele > 0 && r.paill.grele30 === 0, `Paillettes : grêlons après 30 s seulement (${r.paill.grele} au total)`);
  check(r.paillReduit >= 300, 'Paillettes, animation réduite : même cadence, jeu plus lent seulement');
  check(r.racVies === '{"left":3,"max":3}', 'Raclette : trois vies au départ');
  check(r.cornichonVies === 2 && r.cornichonScore === 2, 'Raclette : un cornichon coûte une vie, sans retirer de point');
  check(r.racFin, 'Raclette : la partie finit à zéro vie, score conservé');
  check(r.racCadence <= 3.2 * 120 + 2, `Raclette : cadence ≤ 3,2 tranches/s sur 2 min (${r.racCadence} en 120 s, plafond serveur 6 pts/s)`);
  check(r.domuVies === null, 'Domu-mobile : pas de vies (HUD sans cœurs)');
  check(!r.domuFinSansAccroc && r.domuScore === 200, 'Domu-mobile : pas de limite de 90 s (200 s de route sans fin, 200 points)');
  check(r.domuFinAccroc, 'Domu-mobile : le premier accrochage termine la partie');
  check(r.domuJerry === 3, `Domu-mobile : un jerrican vaut 3 points (${r.domuJerry} à la première seconde)`);
  check(p.errs.length === 0, 'règles : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  /* ---------- HUD réel : cœurs et texte lu, absent pour Domu-mobile ---------- */
  p = await openPage(browser, { page: 'jeux', hash: '#arcade', width: 1280, scenario: { arcadeGame: 'paillettes' } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  check((await p.textContent('#arc-vies-txt')) === '', 'HUD : aucune vie affichée avant la partie ou tant que le jeu ne tourne pas');
  await p.click('#arc-jouer');
  await p.waitForFunction(() => document.querySelector('#arc-vies-txt')?.textContent === '3 vies sur 3', null, { timeout: 5000 }).catch(() => {});
  check((await p.textContent('.arc-coeurs')) === '♥♥♥', 'HUD : trois cœurs pleins au départ');
  check((await p.textContent('#arc-vies-txt')) === '3 vies sur 3' && !(await p.locator('#arc-vies').isHidden()), 'HUD : « 3 vies sur 3 » lu par les lecteurs d’écran');
  check((await p.locator('#arc-temps').count()) === 0, 'HUD : plus de décompte en secondes');
  check(p.errs.length === 0, 'HUD Paillettes : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  p = await openPage(browser, { page: 'jeux', hash: '#arcade-domu', width: 1280, scenario: { arcadeGame: 'domu' } });
  await p.waitForSelector('#arc-jouer', { timeout: 5000 });
  await p.click('#arc-jouer');
  await p.waitForTimeout(400);
  check(await p.locator('#arc-vies').isHidden(), 'HUD Domu-mobile : pas de vies affichées pendant la partie');
  check((await p.locator('#arc-temps').count()) === 0, 'HUD Domu-mobile : plus de décompte');
  check(p.errs.length === 0, 'HUD Domu-mobile : aucune erreur JS' + (p.errs.length ? ' — ' + p.errs.join(' | ') : ''));
  await p.ctx.close();

  await browser.close();
  finish();
})();
