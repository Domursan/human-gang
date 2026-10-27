// Clavier sur les plateaux où l'on choisit une case, un territoire ou une intersection : Monopoly (anneau de 40 cases),
// Risk (carte des territoires cliquables) et Catan (sommets, routes et tuiles cibles). Les flèches déplacent le focus
// vers l'élément le plus proche dans la direction, avec un contour visible ; Entrée ou Espace sont ceux des boutons.
// Partie créée par SQL (t_partie) sur la base locale « plat », vue par le joueur 1. Lancer : node tests/bancs/plateaux/ui/s8_clavier.js
const { ouvrir, fermer, su } = require('./lib.js');

let ok = 0, ko = 0;
const check = (c, m) => { if (c) { ok++; console.log('OK     ' + m); } else { ko++; console.log('ECHEC  ' + m); } };

/** Libellé de l'élément qui a le focus, et vrai s'il est en focus-visible. */
const focus = (p) => p.evaluate(() => {
  const a = document.activeElement;
  return { nom: a?.getAttribute('aria-label') || a?.dataset?.case || a?.dataset?.terr || '', visible: !!a?.matches(':focus-visible') };
});

/** Les flèches déplacent le focus d'une case à l'autre (touche par touche, dans une direction). */
async function fleche(p, touche) {
  const avant = (await focus(p)).nom;
  await p.keyboard.press(touche);
  const apres = await focus(p);
  return { avant, apres: apres.nom, visible: apres.visible };
}

async function monopoly() {
  const code = su(`select t_partie('monopoly', 2)`);
  const a = await ouvrir(1, '/pages/jeux/monopoly.html', `#partie/${code}`);
  await a.waitForSelector('button[data-case]', { timeout: 10000 });
  await a.focus('button[data-case]');
  // La case de départ est dans un coin de l'anneau : on essaie les quatre directions, une flèche doit bouger le focus.
  let r = null;
  for (const touche of ['ArrowLeft', 'ArrowUp', 'ArrowRight', 'ArrowDown']) {
    const essai = await fleche(a, touche);
    if (essai.apres !== essai.avant) { r = { ...essai, touche }; break; }
  }
  check(!!r, `Monopoly : une flèche déplace le focus sur une autre case (${r ? r.touche + ' vers « ' + r.apres + ' »' : 'aucune'})`);
  check(r?.visible === true, 'Monopoly : la case au focus est en focus-visible');
}

async function risk() {
  const code = su(`select t_partie('risk', 2)`);
  const a = await ouvrir(1, '/pages/jeux/risk.html', `#partie/${code}`);
  await a.waitForSelector('button[data-terr]:not([disabled])', { timeout: 10000 });
  const n = await a.$$eval('button[data-terr]:not([disabled])', (e) => e.length);
  check(n >= 2, `Risk : ${n} territoires cliquables pour le joueur 1`);
  await a.focus('button[data-terr]:not([disabled])');
  const r = await fleche(a, 'ArrowRight');
  check(r.apres !== r.avant, `Risk : la flèche droite passe de « ${r.avant} » à « ${r.apres} »`);
  const r2 = await fleche(a, 'ArrowLeft');
  check(r2.apres !== r.apres, `Risk : la flèche gauche quitte « ${r.apres} » pour un territoire voisin à gauche`);
}

async function catan() {
  // Catan est en développement : seuls les administrateurs peuvent le rejoindre (comme dans s5 des duels).
  su('update hg_profiles set is_admin = true where id in (t_uid(1), t_uid(2), t_uid(3))');
  const code = su(`select t_partie('catan', 3)`);
  // La mise en place commence par le joueur dont c'est le tour : c'est lui qui voit les intersections à choisir.
  const qui = Number(su(`select t_num(tour) from hg_plat_parties where code='${code}'`));
  const a = await ouvrir(qui, '/pages/jeux/catan.html', `#partie/${code}`);
  await a.waitForSelector('[data-sommet]', { timeout: 10000 });
  const n = await a.$$eval('[data-sommet]', (e) => e.length);
  check(n >= 2, `Catan : ${n} intersections proposées au joueur dont c'est le tour (${qui})`);
  await a.focus('[data-sommet]');
  const r = await fleche(a, 'ArrowRight');
  check(r.apres !== r.avant && r.apres !== '', `Catan : la flèche droite passe de « ${r.avant} » à « ${r.apres} »`);
}

(async () => {
  for (const [nom, f] of [['Monopoly', monopoly], ['Risk', risk], ['Catan', catan]]) {
    try { await f(); } catch (e) { ko++; console.log(`ECHEC  ${nom} : ${e.message.split('\n')[0]}`); }
  }
  await fermer();
  console.log(`${ok} OK, ${ko} ECHEC(S)`);
  process.exit(ko ? 1 : 0);
})();
