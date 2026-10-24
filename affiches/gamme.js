// =====================================================================
// Affiche « La gamme des boosters » : données de repli et tableau (script classique, avant affiches.js).
// Une seule source pour les boosters écrits dans la page : à modifier ici (valeurs de la spécification §1, ordre d'affichage).
// affiches.js relit les boosters actifs en base et redessine le tableau avec la même ligne (window.HG_GAMME.ligne).
// taux : pourcentage de chaque rareté tirée ; brillante : part de cartes brillantes (par carte).
// =====================================================================
(function () {
  const RARETES = [
    { k: 'commune', nom: 'Commune', c: '#c4c9d6' },
    { k: 'peu_commune', nom: 'Peu commune', c: '#2fd17a' },
    { k: 'rare', nom: 'Rare', c: '#4f80ff' },
    { k: 'epique', nom: 'Épique', c: '#a674f5' },
    { k: 'legendaire', nom: 'Légendaire', c: '#FCA301' },
    { k: 'mythique', nom: 'Mythique', c: '#FE3104' },
    { k: 'identite', nom: 'Identité', c: '#FBD32D' },
  ];
  const BOOSTERS = [
    { nom: 'Classique', cls: 'cart--classique', lbl2: 'BOOSTER CLASSIQUE', tint: '#c4c9d6', prix: 100, cartes: 5, tirage: 'Toutes',
      taux: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 }, brillante: 3,
      possibles: 'toutes sauf les uniques', limite: null, gratuit: '1 gratuit / jour' },
    { nom: 'Série', cls: 'cart--serie', lbl2: 'SÉRIE 1', tint: '#2fd17a', prix: 150, cartes: 5, tirage: 'Série choisie',
      taux: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.88, mythique: 0.1, identite: 0.02 }, brillante: 3,
      possibles: 'la série choisie à l’ouverture', limite: null },
    { nom: 'Argenté', cls: 'cart--argente', lbl2: 'BOOSTER ARGENTÉ', tint: '#d9dee9', prix: 250, cartes: 5, tirage: 'Toutes',
      taux: { commune: 45, peu_commune: 30, rare: 14.88, epique: 8, legendaire: 2, mythique: 0.1, identite: 0.02 }, brillante: 4,
      possibles: 'toutes sauf les uniques', limite: null },
    { nom: 'Doré', cls: 'cart--dore', lbl2: 'BOOSTER DORÉ', tint: '#FBD32D', prix: 350, cartes: 5, tirage: 'Toutes',
      taux: { commune: 34, peu_commune: 31, rare: 18.68, epique: 12, legendaire: 4, mythique: 0.3, identite: 0.02 }, brillante: 4,
      possibles: 'toutes sauf les uniques', limite: null },
    { nom: 'Diamant', cls: 'cart--diamant', lbl2: 'BOOSTER DIAMANT', tint: '#4f80ff', prix: 500, cartes: 5, tirage: 'Toutes',
      taux: { commune: 15, peu_commune: 28, rare: 25, epique: 20, legendaire: 10, mythique: 1.98, identite: 0.02 }, brillante: 10,
      possibles: 'toutes sauf les uniques', limite: '5 / semaine' },
    { nom: 'Quitte ou double', cls: 'cart--quitte', lbl2: 'QUITTE OU DOUBLE', tint: '#1f9d5c', prix: 500, cartes: 5, tirage: 'Toutes',
      taux: { commune: 90, peu_commune: 1.5, rare: 1.5, epique: 1.5, legendaire: 3.98, mythique: 1.5, identite: 0.02 }, brillante: 10,
      possibles: 'toutes sauf les uniques', limite: '5 / semaine' },
    { nom: 'Collectionneur', cls: 'cart--collection', lbl2: 'COLLECTIONNEUR', tint: '#a674f5', prix: 500, cartes: 10, tirage: 'Manquantes',
      taux: { commune: 60, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.5, mythique: 0.4, identite: 0.1 }, brillante: 3,
      possibles: 'uniquement les cartes que tu n’as pas, sauf uniques (différence remboursée)', limite: null },
    { nom: 'Holographique', cls: 'cart--holo', lbl2: 'HOLOGRAPHIQUE', tint: 'linear-gradient(90deg,#FE3104,#FCA301,#FBD32D,#159946,#2B5AE2,#4E2398)', prix: 1000, cartes: 5, tirage: 'Toutes',
      taux: { commune: 0, peu_commune: 20, rare: 20, epique: 20, legendaire: 20, mythique: 20, identite: 0 }, brillante: 10,
      possibles: 'toutes sauf les uniques', limite: '1 / semaine' },
    { nom: 'Identité', cls: 'cart--identite', lbl2: 'IDENTITÉ', tint: '#FE3104', prix: 10000, cartes: 5, tirage: 'Toutes',
      taux: { commune: 45, peu_commune: 25, rare: 10, epique: 4, legendaire: 0.5, mythique: 0.5, identite: 15 }, brillante: 3,
      possibles: 'toutes sauf les uniques', limite: null },
  ];

  /* Mise en forme française : espace insécable pour les milliers, virgule pour les décimales. */
  const milliers = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const pct = (n) => String(n).replace('.', ',');   // taux en % : l'unité est dans l'en-tête et la note
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /** Cartouche de booster (aperçu réduit dans la cellule). */
  function cartouche(b) {
    return '<div class="cart-box ' + b.cls + '" aria-hidden="true">'
      + '<div class="cart-body"></div><div class="cart-notch"></div>'
      + '<div class="cart-label"><div class="cart-label-fl"></div><div class="cart-scr"><img src="../assets/img/logo-512.webp" alt=""></div></div>'
      + '<p class="cart-lbl1">LE GANG</p>'
      + '<p class="cart-lbl2">' + esc(b.lbl2) + '</p>'
      + '<div class="cart-stripe"><i></i><i></i><i></i><i></i><i></i><i></i></div>'
      + '<div class="cart-ridge"></div>'
      + '<p class="cart-foot">' + b.cartes + ' CARTES</p>'
      + '</div>';
  }

  /** Accès d'un booster : gratuit, limite, date (texte court, sous le booster). */
  /* Noms longs : coupures douces (&shy;) pour ne pas casser un mot en plein milieu dans une colonne étroite. */
  const COUPES = { 'Classique': 'Clas&shy;sique', 'Collectionneur': 'Collec&shy;tion&shy;neur', 'Holographique': 'Holo&shy;gra&shy;phique' };
  const nomCoupe = (n) => COUPES[n] || esc(n);

  const acces = (b) => [b.gratuit, b.limite, b.jusqua].filter(Boolean).map(esc).join(' · ') || '—';

  /**
   * Tableau de la gamme : une colonne par booster (en-tête : cartouche et nom), puis prix, cartes, tirage,
   * accès, taux par rareté et brillante. Renvoie le contenu de l'en-tête (tete) et du corps (corps).
   */
  function tableau(liste) {
    const tete = '<tr><th scope="col" class="lab">Booster</th>' + liste.map((b, i) =>
      '<th scope="col" class="bo" style="--tint:' + b.tint + '"><span class="barre" aria-hidden="true"></span>'
      + '<span class="vitrine">' + cartouche(b) + '</span>'
      + '<span class="bn"><span class="n">' + String(i + 1).padStart(2, '0') + '</span> ' + nomCoupe(b.nom) + '</span></th>').join('') + '</tr>';
    const cellule = (html, cls) => '<td' + (cls ? ' class="' + cls + '"' : '') + '>' + html + '</td>';
    const meta = (libelle, fn) => '<tr class="meta"><th scope="row">' + libelle + '</th>' + liste.map((b) => cellule(fn(b), 'mc')).join('') + '</tr>';
    const taux = RARETES.map((r) => '<tr><th scope="row" class="rar" style="--c:' + r.c + '">' + r.nom + '</th>'
      + liste.map((b) => { const v = b.taux[r.k] ?? 0; return cellule(pct(v), v === 0 ? 'zero' : ''); }).join('') + '</tr>').join('');
    const brill = '<tr class="brill"><th scope="row" class="rar">✦ Brillante</th>' + liste.map((b) => cellule(pct(b.brillante))).join('') + '</tr>';
    const corps = meta('Prix', (b) => '<span class="prix">' + milliers(b.prix) + ' ✦</span>')
      + meta('Cartes', (b) => String(b.cartes))
      + meta('Tirage', (b) => (b.tirage === 'Manquantes' ? 'Manquan&shy;tes' : esc(b.tirage)))
      + meta('Accès', (b) => acces(b))
      + taux + brill;
    return { tete, corps };
  }

  /* Repli : le tableau écrit ici, sans lecture de la base. */
  const tete = document.getElementById('gamme-tete');
  const corps = document.getElementById('gamme');
  if (tete && corps) {
    const t = tableau(BOOSTERS);
    tete.innerHTML = t.tete;
    corps.innerHTML = t.corps;
  }
  window.HG_GAMME = { tableau, BOOSTERS, esc };
})();
