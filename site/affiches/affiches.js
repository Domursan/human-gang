// =====================================================================
// Affiches A3 : chiffres et listes lus sur le site (prix, gains, taux, critères des badges, quêtes, badges).
// Une affiche déclare sa page avec <main class="affiche" data-affiche="badges | paillettes | boosters | boosters-gamme">
// (les autres affiches, secrets et jeux, n'ont que des chiffres : data-cfg / data-expr, lus par reglages-jetons.js).
// Boosters : la gamme (boosters-gamme) est reconstruite depuis hg_booster_types (types actifs, ordre « sort ») ;
// la liste BOOSTERS écrite dans gamme.js reste le repli (sans session). boosters : prix et taille du Classique lus sur son type.
// Les chiffres sont des éléments data-cfg (valeur d'un réglage), data-expr (calcul) ou data-cfg-calc
// (calcul de la page) : voir assets/js/reglages-jetons.js. Le texte écrit dans la page est le repli :
// il reste affiché si un réglage est illisible (par exemple sans session, les affiches sont imprimées connecté).
// Les badges viennent de hg_badges (noms, images, niveaux, critères) ; sans lecture, BADGES_REPLI est affiché.
// Les quêtes viennent de hg_card_quests_templates ; sans lecture, la liste écrite dans la page reste.
// Dépendances : core/supabase.js (sb), reglages-jetons.js (valeurs et mise en forme), badge-levels.js (niveaux).
// Ne fait rien d'autre que remplir la page : la mise en page A3 est celle du HTML et de affiche.css (impression inchangée).
// =====================================================================
import { sb } from '../assets/commun/core/supabase.js';
import { chargerReglages, appliquerReglages, jetons, fmt } from '../assets/espaces/admin/reglages-jetons.js';
import { sortedLevels, hasLevels, levelImage, metricCount } from '../assets/espaces/compte/badge-levels.js';

/* ---------- Badges : regroupement, textes et liste de repli ---------- */
// Sections de l'affiche, dans l'ordre. Un badge absent de ces listes va dans la section « Événements » (fin de page).
const SECTIONS = [
  { titre: 'Secret Santa', codes: ['premier_noel', 'veteran', 'lutin_express', 'sur_le_fil', 'liste_parfaite'] },
  { titre: 'Sorties IRL', codes: ['toujours_la', 'organisateur', 'globe_trotter'] },
  { titre: 'Fidélité', codes: ['fondateur', 'fidele', 'saisonnier', 'anciennete'] },
  { titre: 'Communauté', codes: ['cupidon', 'paparazzi', 'boite_a_idees', 'chasseur_bugs'] },
  { titre: 'Secrets et cartes', codes: ['initie', 'chasseur_secrets', 'cueilleur', 'pentakill'] },
  { titre: 'Arène', codes: ['gladiateur'] },
];
// Texte de chaque badge sur l'affiche, avec les critères réglables (jetons). Un badge sans modèle garde sa description de la base.
const MODELES = {
  premier_noel: 'A participé à un Secret Santa terminé.',
  veteran: 'A participé à {{badges.criteres.veteran_editions|5}} Secret Santa.',
  lutin_express: 'A envoyé son cadeau en premier.',
  sur_le_fil: 'A envoyé son cadeau le dernier jour.',
  liste_parfaite: 'Un souhait dans sa liste avant le tirage.',
  toujours_la: 'Présent à {{badges.criteres.toujours_la_sorties|5}} sorties passées (RSVP « oui »).',
  organisateur: 'A créé une sortie.',
  globe_trotter: 'Sorties passées dans {{badges.criteres.globe_trotter_lieux|3}} lieux différents.',
  fondateur: 'Arrivé dès la première année du gang.',
  fidele: '{{badges.criteres.fidele_annees|3}} ans dans le gang, depuis la date d’arrivée.',
  saisonnier: 'Connecté pendant les {{badges.criteres.saisonnier_themes|7}} thèmes du site.',
  cupidon: 'Un membre a rejoint avec son code d’invitation.',
  paparazzi: '{{badges.criteres.paparazzi_photos|50}} photos ajoutées aux albums.',
  boite_a_idees: 'Une de ses idées retenue par l’admin.',
  chasseur_bugs: 'Un bug signalé via l’assistance, traité.',
  anciennete: 'Calculé sur les années passées dans le gang, depuis la date d’arrivée.',
  initie: 'A trouvé le code secret du gang.',
  chasseur_secrets: 'A réuni les 7 lettres cachées du site.',
  cueilleur: 'A cueilli le champignon caché des quatre saisons.',
  pentakill: 'Des boosters parfaits : 5 cartes de même rareté (rare ou mieux), ou 5 nouvelles.',
  gladiateur: 'Meilleure ligue atteinte en fin de saison de l’Arène : Argent, Or, Diamant ou Légende.',
};
// Liste de repli (sans lecture de hg_badges) : les 21 badges tels qu'ils sont affichés.
const IMG = (f) => `https://zqbdzokyhgavgmqgiwuw.supabase.co/storage/v1/object/public/hg-assets/badges/${f}`;
const BADGES_REPLI = [
  { code: 'premier_noel', name: 'Premier Noël', image_url: IMG('premier_noel.png?v=1792524833665') },
  { code: 'veteran', name: 'Vétéran', image_url: IMG('veteran.png?v=1792524838448') },
  { code: 'lutin_express', name: 'Lutin express', image_url: IMG('lutin_express.png?v=1792524869344') },
  { code: 'sur_le_fil', name: 'Sur le fil', image_url: IMG('sur_le_fil.png?v=1792524930375') },
  { code: 'liste_parfaite', name: 'Liste parfaite', image_url: IMG('liste_parfaite.png?v=1792524990655') },
  { code: 'toujours_la', name: 'Toujours là', image_url: IMG('toujours_la.png?v=1792525011471') },
  { code: 'organisateur', name: 'Organisateur', image_url: IMG('organisateur.png?v=1792525054543') },
  { code: 'globe_trotter', name: 'Globe-trotter', image_url: IMG('globe_trotter.png?v=1792525100426') },
  { code: 'fondateur', name: 'Membre fondateur', image_url: IMG('fondateur.png?v=1792525710316') },
  { code: 'fidele', name: 'Fidèle', image_url: IMG('fidele.png?v=1792525260919') },
  { code: 'saisonnier', name: 'Saisonnier', image_url: IMG('saisonnier.png?v=1792525336189') },
  {
    code: 'anciennete', name: 'Ancienneté', levels_enabled: true, metric: 'anciennete_annees',
    levels: [
      { level: 1, threshold: 1, name: 'Bronze', image_url: IMG('fondateur-n1.png?v=1792525710889') },
      { level: 2, threshold: 2, name: 'Argent', image_url: IMG('fondateur-n2.png?v=1792525711177') },
      { level: 3, threshold: 5, name: 'Or', image_url: IMG('fondateur-n3.png?v=1792525711382') },
      { level: 4, threshold: 10, name: 'Platine', image_url: IMG('fondateur-n4.png?v=1792525711802') },
      { level: 5, threshold: 20, name: 'Diamant', image_url: IMG('fondateur-n5.png?v=1792525712341') },
    ],
  },
  { code: 'cupidon', name: 'Cupidon du gang', image_url: IMG('cupidon.png?v=1792525404565') },
  { code: 'paparazzi', name: 'Paparazzi', image_url: IMG('paparazzi.png?v=1792525140417') },
  { code: 'boite_a_idees', name: 'Boîte à idées', image_url: IMG('boite_a_idees.png?v=1792525184828') },
  { code: 'chasseur_bugs', name: 'Chasseur de bugs', image_url: IMG('chasseur_bugs.png?v=1792525293492') },
  { code: 'initie', name: 'Initié', image_url: null },
  { code: 'chasseur_secrets', name: 'Chasseur de secrets', image_url: null },
  { code: 'cueilleur', name: 'Cueilleur', image_url: null },
  {
    code: 'pentakill', name: 'Pentakill', levels_enabled: true, metric: 'pentakills', image_url: null,
    levels: [
      { level: 1, threshold: 1, name: null, image_url: null },
      { level: 2, threshold: 3, name: null, image_url: null },
      { level: 3, threshold: 10, name: null, image_url: null },
    ],
  },
  {
    code: 'gladiateur', name: 'Gladiateur', levels_enabled: true, metric: 'arene_ligue', image_url: null,
    levels: [
      { level: 1, threshold: 1, name: 'Argent', image_url: null },
      { level: 2, threshold: 2, name: 'Or', image_url: null },
      { level: 3, threshold: 3, name: 'Diamant', image_url: null },
      { level: 4, threshold: 4, name: 'Légende', image_url: null },
    ],
  },
  { code: 'it_s_halloween_time', name: 'It\'s Halloween Time !', description: 'A attrapé It\'s Halloween Time ! pendant l\'événement.', image_url: null },
];

/* ---------- Outils de construction (DOM, sans HTML venant de la base) ---------- */
/** Crée un élément avec sa classe et son texte (textContent : rien n'est interprété comme du HTML). */
const el = (tag, cls = '', texte) => {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (texte !== undefined) n.textContent = texte;
  return n;
};

/** Description affichée d'un badge : le modèle de l'affiche (critères réglables), sinon la description de la base. */
const descriptionDe = (b) => (MODELES[b.code] ? jetons(MODELES[b.code]) : (b.description || ''));

/** Pastille de badge : l'image de la base, ou une médaille si elle manque. */
function pastille(src, classe) {
  const ico = el('div', classe);
  if (src) {
    const img = el('img');
    img.src = src;
    img.alt = '';
    ico.append(img);
  } else {
    ico.setAttribute('aria-hidden', 'true');
    ico.textContent = '🏅';
  }
  return ico;
}

/** Carte d'un badge simple (sans niveaux). */
function carte(b, evenement) {
  const card = el('div', evenement ? 'card hot' : 'card');
  const txt = el('div');
  txt.append(el('h3', '', b.name), el('p', '', descriptionDe(b)));
  card.append(pastille(b.image_url, 'ico'), txt);
  return card;
}

/** Libellé d'un niveau selon la métrique du badge (les métriques sans libellé donnent le nombre seul). */
function libelleNiveau(b, n) {
  if (b.metric === 'pentakills') return `${n} Pentakill${n > 1 ? 's' : ''}`;
  return metricCount(b.metric, n);
}

/** Bloc d'un badge à niveaux (Ancienneté, Pentakill) : description, puis une ligne par niveau, avec son seuil lu sur la base. */
function blocNiveaux(b) {
  const niveaux = sortedLevels(b);
  const bloc = el('div', 'anc');
  bloc.append(el('h3', '', b.name));
  const desc = descriptionDe(b);
  if (desc) bloc.append(el('p', 'anc-desc', desc));
  const liste = el('div', 'levels');
  for (const n of niveaux) {
    const lvl = el('div', 'lvl');
    const src = levelImage(b, n.level);
    lvl.append(pastille(src, 'lvl-ico'), el('b', '', n.name || `Niveau ${n.level}`), el('span', '', libelleNiveau(b, n.threshold)));
    liste.append(lvl);
  }
  bloc.append(liste);
  return bloc;
}

/** Une section de l'affiche : titre, nombre, cartes et blocs de niveaux. Renvoie l'élément (les colonnes sont faites par le CSS). */
function section(titre, badges, tagDefaut) {
  const simples = badges.filter((b) => !hasLevels(b));
  const niveaux = badges.filter((b) => hasLevels(b));
  const evenement = titre === 'Événements';
  const sec = el('section', 'bloc');
  const t = el('div', 'sec-title');
  const suite = niveaux.map((b) => ` + ${b.name}`).join('');
  t.append(el('h2', '', titre), el('span', 'tag', tagDefaut ?? `${simples.length} badge${simples.length > 1 ? 's' : ''}${suite}`));
  sec.append(t);
  if (simples.length) {
    const grille = el('div', 'grid');
    grille.append(...simples.map((b) => carte(b, evenement)));
    sec.append(grille);
  }
  for (const b of niveaux) sec.append(blocNiveaux(b));
  return sec;
}

/* ---------- Lectures sur la base (chacune se replie sans bruit) ---------- */
/** Badges de hg_badges (membres seulement). Liste vide si la lecture échoue. */
async function lireBadges() {
  try {
    const { data, error } = await sb.from('hg_badges').select('code, name, description, image_url, sort, levels_enabled, metric, levels').order('sort');
    if (error) throw error;
    return (data ?? []).filter((b) => b && b.code && b.name);
  } catch (e) {
    console.warn('[affiches] badges illisibles, liste de repli :', e?.message || e);
    return [];
  }
}

/** Quêtes actives de la semaine (hg_card_quests_templates). Liste vide si la lecture échoue. */
async function lireQuetes() {
  try {
    const { data, error } = await sb.from('hg_card_quests_templates').select('code, label, metric, reward, active, sort').eq('active', true).order('sort');
    if (error) throw error;
    return (data ?? []).filter((q) => q && q.label && Number.isFinite(Number(q.reward)));
  } catch (e) {
    console.warn('[affiches] quêtes illisibles, liste écrite dans la page :', e?.message || e);
    return [];
  }
}

/* ---------- Remplissage par page ---------- */
/** Page des badges : sections construites depuis hg_badges, réparties en colonnes, puis nombre total. */
async function afficherBadges() {
  const lus = await lireBadges();
  const badges = lus.length ? lus : BADGES_REPLI;
  const reste = [...badges];
  const sectionsBox = document.getElementById('sections');
  // Au-delà de 21 badges (la mise en page de base), quatre colonnes plus serrées : voir badges-dense dans badges-a3.html.
  document.querySelector('[data-affiche="badges"]')?.classList.toggle('badges-dense', badges.length > 21);
  const blocs = SECTIONS.map((s) => {
    const membres = s.codes.map((c) => reste.find((b) => b.code === c)).filter(Boolean);
    membres.forEach((b) => reste.splice(reste.indexOf(b), 1));
    return membres.length ? section(s.titre, membres) : null;
  }).filter(Boolean);
  if (reste.length) blocs.push(section('Événements', reste, 'Limité'));
  sectionsBox.replaceChildren(...blocs);
  const nb = document.getElementById('nb-badges');
  if (nb) nb.textContent = String(badges.length);
}

/** Nombre de quêtes montrées sur l'affiche (une grille de 6 tuiles). */
const QUETES_MONTREES = 6;

/**
 * Exemples de quêtes pour l'affiche : une quête par action différente, réparties sur toute la liste
 * (sinon les premières de la liste se ressembleraient toutes).
 * @param {object[]} quetes quêtes actives, triées par ordre d'affichage
 * @returns {object[]} au plus QUETES_MONTREES quêtes
 */
function exemplesQuetes(quetes) {
  if (quetes.length <= QUETES_MONTREES) return quetes;
  const vues = new Set();
  const uniques = quetes.filter((q) => { const k = q.metric || q.code; if (vues.has(k)) return false; vues.add(k); return true; });
  const pas = uniques.length / QUETES_MONTREES;
  return Array.from({ length: Math.min(QUETES_MONTREES, uniques.length) }, (_, i) => uniques[Math.floor(i * pas)]);
}

/** Page Paillettes : exemples de quêtes lus sur la base, si elle répond (le total est affiché dans la note). */
function afficherQuetes(quetes) {
  const liste = document.getElementById('quetes');
  if (!liste || !quetes.length) return;
  liste.replaceChildren(...exemplesQuetes(quetes).map((q) => {
    const d = el('div');
    d.append(el('div', 'q', q.label), el('div', 'v', `${fmt(q.reward)} ✦`));
    return d;
  }));
}

/* ---------- Boosters (idée A5) : gamme et prix lus sur hg_booster_types ---------- */
const GAMME_MAX = 9;   // une colonne par booster : neuf colonnes tiennent sur l’A3 (au-delà, signalés en pied)
// Teinte de la barre de chaque style de cartouche (comme la liste de gamme.js) ; or par défaut.
const TEINTES = { 'cart--classique': '#c4c9d6', 'cart--serie': '#2fd17a', 'cart--argente': '#d9dee9', 'cart--dore': '#FBD32D',
  'cart--diamant': '#4f80ff', 'cart--quitte': '#1f9d5c', 'cart--collection': '#a674f5', 'cart--identite': '#FE3104',
  'cart--holo': 'linear-gradient(90deg,#FE3104,#FCA301,#FBD32D,#159946,#2B5AE2,#4E2398)' };
// Cartes possibles selon le tirage (colonne pool) : texte long (note) et libellé court (colonne du tableau).
const POOLS = { tous: 'toutes sauf les uniques', serie: 'la série choisie à l’ouverture',
  manquantes: 'uniquement les cartes que tu n’as pas, sauf uniques (différence remboursée)' };
const TIRAGES = { tous: 'Toutes', serie: 'Série choisie', manquantes: 'Manquantes' };
const jourFr = (d) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'long', year: 'numeric' }).format(d);
const jourCourt = (d) => new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', day: 'numeric', month: 'short' }).format(d);
// Nombres en toutes lettres pour l'accroche (jusqu'à 12).
const LETTRES = ['Zéro', 'Un', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix', 'Onze', 'Douze'];

/** Types de boosters actifs (hg_booster_types, lisible par tout membre connecté). Liste vide si la lecture échoue. */
async function lireBoosters() {
  try {
    const { data, error } = await sb.from('hg_booster_types').select('*').eq('active', true).order('sort');
    if (error) throw error;
    return (data ?? []).filter((t) => t && t.id && t.name && Number.isFinite(Number(t.price)));
  } catch (e) {
    console.warn('[affiches] boosters illisibles, liste écrite dans la page :', e?.message || e);
    return [];
  }
}

/** Ligne de hg_booster_types → ligne du tableau de l'affiche (mêmes champs que la liste BOOSTERS de gamme.js). Les taux sont ceux du tirage. */
function boosterDeType(t) {
  const fin = t.ends_at || t.available_until || null;   // booster saisonnier (colonne facultative, idées C1 à C3)
  const debut = t.starts_at || t.available_from || null;
  const futur = debut && new Date(debut) > Date.now();
  return {
    nom: String(t.name).slice(0, 28), cls: /^cart--[a-z0-9-]+$/.test(t.style || '') ? t.style : 'cart--classique',
    lbl2: String(t.name).toUpperCase().slice(0, 18), tint: TEINTES[t.style] || '#e2c77e',
    prix: Number(t.price), cartes: Number(t.size) || 5, taux: t.rates || {}, brillante: Number(t.shiny_rate) || 0,
    possibles: POOLS[t.pool] || POOLS.tous, tirage: TIRAGES[t.pool] || TIRAGES.tous,
    limite: t.weekly_limit ? `${t.weekly_limit} / semaine` : null,
    gratuit: t.free_daily ? '1 gratuit / jour' : null,
    jusqua: futur ? `Dès le ${jourCourt(new Date(debut))}` : fin ? `Jusqu’au ${jourCourt(new Date(fin))}` : null,
  };
}

/** Page de la gamme : tableau reconstruit (une colonne par booster), date des données. */
async function afficherGamme() {
  const g = window.HG_GAMME;
  if (!g?.tableau) return;
  const types = await lireBoosters();
  if (!types.length) return;   // repli : le tableau écrit par gamme.js reste
  const liste = types.slice(0, GAMME_MAX).map(boosterDeType);
  const n = liste.length;
  const tete = document.getElementById('gamme-tete');
  const corps = document.getElementById('gamme');
  if (!tete || !corps) return;
  const t = g.tableau(liste);
  tete.innerHTML = t.tete;
  corps.innerHTML = t.corps;
  const intro = document.getElementById('gamme-intro');
  if (intro) intro.textContent = `${LETTRES[n] || n} booster${n > 1 ? 's' : ''} pour agrandir ta collection, achetés avec des Paillettes dans la Boutique.`;
  const date = document.getElementById('gamme-date');
  if (date) date.textContent = `Données du ${jourFr(new Date())}${types.length > GAMME_MAX ? ` · ${types.length - GAMME_MAX} autre(s) dans la Boutique` : ''}`;
}

/** Affiche des boosters : prix et taille du booster Classique lus sur son type (sinon les réglages cartes.*). */
async function prixClassique() {
  const types = await lireBoosters();
  const c = types.find((t) => t.id === 'classique') || types[0];
  if (!c) return;
  for (const el of document.querySelectorAll('[data-cfg="cartes.booster_price"]')) el.textContent = fmt(Number(c.price));
  for (const el of document.querySelectorAll('[data-expr="cartes.booster_price*5"]')) el.textContent = fmt(Number(c.price) * 5);
  for (const el of document.querySelectorAll('[data-cfg="cartes.booster_size"]')) el.textContent = fmt(Number(c.size) || 5);
}

/** Noms des boosters dans l'en-tête de la gamme : sans césure, réduits (1 px à la fois, 13 px au plus petit) si un mot ne tient pas. */
function ajusterNoms() {
  for (const th of document.querySelectorAll('.gamme th.bo')) {
    let taille = parseFloat(getComputedStyle(th).fontSize);
    while (th.scrollWidth > th.clientWidth + 1 && taille > 13) {
      taille -= 1;
      th.style.fontSize = `${taille}px`;
    }
  }
}

/* ---------- Démarrage ---------- */
const page = document.querySelector('[data-affiche]')?.dataset.affiche;
await chargerReglages();
let quetes = [];
if (page === 'badges') await afficherBadges();
if (page === 'paillettes') {
  quetes = await lireQuetes();
  afficherQuetes(quetes);
}
// Calculs propres à une page, pour les éléments data-cfg-calc.
appliquerReglages(document, {
  // Nombre de quêtes actives (sinon le nombre écrit dans la page).
  quetes: () => quetes.length || undefined,
});
// Boosters : après les réglages, pour que les valeurs du type l'emportent sur cartes.booster_price.
if (page === 'boosters-gamme') {
  await afficherGamme();
  ajusterNoms();
}
if (page === 'boosters') await prixClassique();
