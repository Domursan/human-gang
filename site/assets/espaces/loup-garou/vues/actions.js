// ===== Humane Gang — Loup-Garou : panneau « ce que tu dois faire maintenant » (plateau) =====
/*
 * Rôle : décrit l'action du joueur selon l'étape (nuit, réveil, vote, tir du Chasseur…) : consigne, cible choisie,
 * options (potions, cartes, Oui/Non…), bouton de confirmation, « Passer » pour les actions facultatives, et envoi
 * au serveur (lg.agir / lg.voter). Le choix en cours (sel) est tenu par plateau.js :
 *   { cible, cible2, choix, vie, modif }.
 * Dépendances : core.js (esc), ui.js (icone, pseudo, vignetteRole, pastilleCamp), roles.js (roleById, CAMPS).
 * Exporte : typeAction, choisissable, badgesCible, comptesVote, votesMeute, panneauAction, choisir, executer, attenteTexte, LIENS.
 */
import { esc } from '../../core.js';
import { icone, pseudo, vignetteRole, pastilleCamp } from '../ui.js';
import { roleById } from '../roles.js';

/** Types dont la cible se choisit sur la table. */
const CIBLE = new Set(['devorer', 'sonder', 'proteger', 'corbeau', 'envouter', 'renard', 'loup_blanc', 'grand_mechant',
  'sorciere', 'chasseur', 'succession', 'modele', 'cupidon']);
/** Actions qu'on peut changer tant que l'étape dure. */
const MODIFIABLE = new Set(['devorer', 'proteger', 'corbeau', 'loup_blanc', 'grand_mechant', 'renard']);
/** Actions facultatives : bouton « Passer ». */
const FACULTATIF = new Set(['corbeau', 'loup_blanc', 'grand_mechant']);
export const LIENS = { loup: 'Loup-garou', amoureux: 'Amoureux·se', famille: 'Famille' };

/** Texte de chaque action : titre, icône, consigne, libellé du bouton. */
const FICHE = {
  sonder: { titre: 'Sonder un joueur', ico: 'oeil', consigne: 'Touche un joueur pour découvrir son rôle.', bouton: 'Découvrir son rôle' },
  devorer: { titre: 'Choisir la victime', ico: 'patte', consigne: "Touche un joueur qui n'est pas un loup. La meute décide ensemble.", bouton: 'Dévorer' },
  proteger: { titre: 'Protéger un joueur', ico: 'bouclier', consigne: 'Touche la personne à protéger cette nuit.', bouton: 'Protéger' },
  corbeau: { titre: 'Désigner un suspect', ico: 'info', consigne: 'Touche un joueur : il recevra deux voix de plus demain.', bouton: 'Désigner' },
  envouter: { titre: 'Envoûter deux joueurs', ico: 'lien', consigne: 'Touche deux joueurs différents pour les envoûter.', bouton: 'Envoûter' },
  renard: { titre: 'Flairer un groupe', ico: 'etoile', consigne: 'Touche un joueur : tu sauras si lui et ses deux voisins cachent un loup.', bouton: 'Flairer' },
  loup_blanc: { titre: 'Éliminer un loup', ico: 'patte', consigne: 'Touche un autre loup-garou : il sera dévoré seul cette nuit.', bouton: 'Éliminer' },
  grand_mechant: { titre: 'Dévorer en plus', ico: 'couronne', consigne: 'Touche un joueur à dévorer en plus, ou passe ton tour.', bouton: 'Dévorer' },
  cupidon: { titre: 'Lier deux amoureux', ico: 'coeur', consigne: 'Touche deux joueurs différents : ils deviendront amoureux.', bouton: 'Lier' },
  voleur: { titre: 'Choisir une carte', ico: 'cartes', consigne: "Prends une carte du centre pour remplacer la tienne, ou garde la tienne.", bouton: 'Confirmer' },
  chien: { titre: 'Choisir ton camp', ico: 'patte', consigne: 'Rejoins le village ou les loups-garous.', bouton: 'Confirmer' },
  modele: { titre: 'Choisir un modèle', ico: 'lien', consigne: 'Touche le joueur dont tu deviens le modèle.', bouton: 'Choisir' },
  infecter: { titre: 'Infecter ?', ico: 'patte', consigne: "Veux-tu utiliser ton pouvoir d'infection cette nuit ?", bouton: 'Confirmer' },
  sorciere: { titre: 'Ta potion', ico: 'etoile', consigne: '', bouton: 'Confirmer' },
  chasseur: { titre: 'Ton dernier tir', ico: 'croix', consigne: 'Tu meurs : touche un joueur qui meurt avec toi.', bouton: 'Tirer' },
  succession: { titre: 'Désigner ton successeur', ico: 'couronne', consigne: 'Touche le joueur qui prend ta place de Capitaine.', bouton: 'Désigner' },
  vote: { titre: 'Vote du village', ico: 'maison', consigne: '', bouton: 'Confirmer mon vote' },
};

const nomDe = (e, uid) => (e?.joueurs || []).find((j) => j.user_id === uid) || null;
const pseudoHtml = (e, uid) => pseudo(nomDe(e, uid) || {});
const pseudoTexte = (e, uid) => nomDe(e, uid)?.pseudo || '?';

/** Le loup-garou est-il un loup (connu de moi) ? */
function estLoup(e, uid) {
  if (nomDe(e, uid)?.camp === 'loups') return true;
  if (uid === e.moi?.user_id) return e.moi?.camp === 'loups';
  return !!e.moi?.allies?.some((a) => a.user_id === uid && a.lien === 'loup');
}

/** Peut-on voter (vivant, pas exclu du vote) ? */
function peutVoter(e) {
  return !!e?.moi?.vivant && nomDe(e, e.moi.user_id)?.peut_voter !== false;
}

/**
 * Type d'action en cours : « vote » pendant le vote, sinon le type donné par le serveur (null si aucune).
 */
export function typeAction(e) {
  if (e?.partie?.phase === 'vote') return 'vote';
  return e?.moi?.action?.type || null;
}

/** Votes du jour de la manche courante (le dernier vote de chacun compte). */
export function comptesVote(e) {
  const manche = e?.partie?.manche;
  const joueurs = e?.joueurs || [];
  const eligibles = joueurs.filter((j) => j.vivant && j.peut_voter !== false);
  const dernier = new Map();
  for (const v of e?.votes || []) if (v.manche == manche) dernier.set(v.de, v.pour);
  const votes = {};
  for (const [de, pour] of dernier) {
    const poids = nomDe(e, de)?.capitaine ? 2 : 1;
    votes[pour] = (votes[pour] || 0) + poids;
  }
  return { votes, dernier, votants: new Set(dernier.keys()), eligibles };
}

/** Votes de la meute (action.meute), à plat : { de, pour }. */
export function votesMeute(e) {
  const m = e?.moi?.action?.meute;
  const out = [];
  if (Array.isArray(m)) {
    m.forEach((x) => { const pour = x?.pour ?? x?.cible ?? x?.cible_id; if (pour) out.push({ de: x.de ?? x.user_id ?? null, pour }); });
  } else if (m && typeof m === 'object') {
    Object.entries(m).forEach(([pour, v]) => {
      if (Array.isArray(v)) v.forEach((de) => out.push({ de: typeof de === 'string' ? de : de?.user_id ?? null, pour }));
      else for (let i = 0; i < (Number(v) || 0); i++) out.push({ de: null, pour });
    });
  }
  return out;
}

/** Nombre de voix affiché sur les sièges : vote du jour, ou votes de la meute. */
export function badgesCible(e) {
  const t = typeAction(e);
  if (t === 'vote') return comptesVote(e).votes;
  if (t === 'devorer') {
    const b = {};
    votesMeute(e).forEach((v) => { b[v.pour] = (b[v.pour] || 0) + 1; });
    return b;
  }
  return {};
}

/** Un siège peut-il être choisi maintenant ? (la table n'en fait un bouton que dans ce cas) */
export function choisissable(e, sel, j) {
  const t = typeAction(e);
  if (!t || !j?.vivant || !e?.moi) return false;
  const moiId = e.moi.user_id;
  if (t === 'vote') return peutVoter(e);
  const a = e.moi.action;
  if (!a || (a.fait && !sel?.modif) || !CIBLE.has(t)) return false;
  switch (t) {
    case 'devorer': return !estLoup(e, j.user_id);
    case 'loup_blanc': return j.user_id !== moiId && estLoup(e, j.user_id);
    case 'proteger': return j.user_id !== a.dernier_protege;
    case 'sorciere': return !!a.potions?.mort && j.user_id !== moiId;
    default: return j.user_id !== moiId;
  }
}

/** Texte d'attente quand le joueur n'a rien à faire. */
export function attenteTexte(e) {
  const p = e?.partie?.phase;
  const vivant = !!e?.moi?.vivant;
  if (p === 'debat') return "Écoute le débat. Le vote s'ouvrira ensuite.";
  if (p === 'nuit_1' || p === 'nuit') return vivant ? 'Le village dort… ferme les yeux.' : 'Tu observes la nuit en silence.';
  if (p === 'reveil') return vivant ? 'D’autres agissent encore… ferme les yeux.' : 'Tu observes la nuit en silence.';
  if (p === 'chasseur') return 'Le Chasseur tire sa dernière flèche…';
  if (p === 'succession') return 'Le Capitaine désigne son successeur…';
  if (p === 'vote') return 'Tu es mort·e : tu observes le vote.';
  return vivant ? "Patiente, l'étape arrive." : 'Tu es spectateur·trice de la partie.';
}

/* ---------- Petits morceaux de HTML ---------- */

/** Bouton d'option (cible d'un choix) : aria-pressed + coche (la couleur ne porte jamais seule). */
function option(k, act, val, contenu, presse, { off = false } = {}) {
  return `<button type="button" class="lg-pl-option" data-act="${act}"${val != null ? ` data-val="${esc(val)}"` : ''} data-k="${esc(k)}"`
    + ` aria-pressed="${presse ? 'true' : 'false'}"${off ? ' disabled' : ''}>${contenu}${presse ? icone('coche', 16, 'lg-pl-coche') : ''}</button>`;
}

/** Ligne « cible choisie » avec le bouton pour la retirer. */
function ligneCible(e, libelle, uid, champ) {
  if (!uid) return `<div class="lg-pl-cible"><span class="lg-pl-cible-l">${esc(libelle)}</span><span class="small muted">Touche un joueur à la table</span></div>`;
  return `<div class="lg-pl-cible"><span class="lg-pl-cible-l">${esc(libelle)}</span>${pseudoHtml(e, uid)}`
    + `<button type="button" class="lg-pl-effacer" data-act="effacer" data-champ="${champ}" data-k="effacer-${champ}" aria-label="Retirer ${esc(pseudoTexte(e, uid))}">${icone('croix', 14)}</button></div>`;
}

/** Carte de l'action : même en-tête pour toutes les actions (vignette du rôle, camp, titre). */
function carte(e, titre, ico, corps, pied = '') {
  const r = roleById(e.moi?.role);
  return `<section class="lg-pl-carte lg-pl-action-carte" aria-labelledby="lg-pl-action-titre">
    <header class="lg-pl-action-tete">${vignetteRole(r.id, 44)}
      <div class="lg-pl-action-id"><p class="lg-pl-action-role"><strong>${esc(r.nom)}</strong> ${pastilleCamp(r.camp)}</p>
      <h2 id="lg-pl-action-titre" class="lg-pl-action-titre">${icone(ico, 18)}<span>${esc(titre)}</span></h2></div>
    </header>
    ${corps}
    ${pied ? `<div class="lg-pl-pied">${pied}</div>` : ''}
  </section>`;
}

/** Bouton de confirmation (désactivé tant que le choix n'est pas complet, ou pendant l'envoi). */
function confirmer(libelle, valide, occupe) {
  return `<button type="button" class="btn btn-primary" data-act="confirmer" data-k="confirmer"${valide && !occupe ? '' : ' disabled'}>${esc(libelle)}</button>`;
}

function passer(occupe) {
  return `<button type="button" class="btn btn-ghost" data-act="passer" data-k="passer"${occupe ? ' disabled' : ''}>Passer</button>`;
}

/** Meute : qui vote pour qui (action.meute). */
function htmlMeute(e) {
  const liste = votesMeute(e);
  if (!liste.length) return '';
  return `<div class="lg-pl-meute"><p class="small muted">Votes de la meute</p><ul class="lg-pl-liste">${liste.map((v) =>
    `<li>${v.de ? `${pseudoHtml(e, v.de)} <span aria-hidden="true">→</span><span class="visually-hidden"> vote pour </span>` : ''}${pseudoHtml(e, v.pour)}</li>`).join('')}</ul></div>`;
}

/* ---------- Corps par type d'action ---------- */

function corpsSimple(e, t, a, sel, occupe) {
  const f = FICHE[t];
  const extra = t === 'devorer' ? htmlMeute(e)
    : (t === 'proteger' && a.dernier_protege) ? '<p class="small muted">Tu ne peux pas protéger la même personne deux nuits de suite.</p>' : '';
  const corps = `<p class="lg-pl-consigne">${esc(f.consigne)}</p>${extra}${ligneCible(e, 'Cible choisie', sel.cible, 'cible')}`;
  const pied = (FACULTATIF.has(t) ? passer(occupe) : '') + confirmer(f.bouton, !!sel.cible, occupe);
  return carte(e, f.titre, f.ico, corps, pied);
}

function corpsDouble(e, t, sel, occupe) {
  const f = FICHE[t];
  const ok = !!(sel.cible && sel.cible2 && sel.cible !== sel.cible2);
  const corps = `<p class="lg-pl-consigne">${esc(f.consigne)}</p>
    ${ligneCible(e, 'Joueur 1', sel.cible, 'cible')}${ligneCible(e, 'Joueur 2', sel.cible2, 'cible2')}`;
  return carte(e, f.titre, f.ico, corps, confirmer(f.bouton, ok, occupe));
}

function corpsSorciere(e, a, sel, occupe) {
  const p = a.potions || {};
  const victime = a.victime ? (a.victime_pseudo || pseudoTexte(e, a.victime)) : '';
  const texte = victime ? `Les loups ont attaqué <strong>${esc(victime)}</strong>.` : "Les loups n'ont attaqué personne cette nuit.";
  const opts = [];
  if (p.vie) {
    opts.push(option('vie', 'vie', null,
      `${icone('coeur', 18)}<span>${victime ? `Utiliser la potion de vie pour sauver ${esc(victime)}` : 'Utiliser la potion de vie'}</span>`,
      !!sel.vie, { off: !victime }));
  }
  if (p.vie || p.mort) {
    opts.push(option('rien', 'rien', null, `${icone('croix', 18)}<span>Ne rien faire</span>`, !sel.vie && !sel.cible));
  }
  const mort = p.mort
    ? `<div class="lg-pl-potion-mort"><p class="small muted">Potion de mort : touche un joueur à la table pour l'empoisonner.</p>${ligneCible(e, 'Empoisonné·e', sel.cible, 'cible')}</div>`
    : '';
  const corps = `<p class="lg-pl-consigne">${texte}</p>${opts.length ? `<div class="lg-pl-options">${opts.join('')}</div>` : '<p class="small muted">Tu n\'as plus de potion.</p>'}${mort}`;
  const pied = (p.vie && p.mort ? passer(occupe) : '') + confirmer(FICHE.sorciere.bouton, true, occupe);
  return carte(e, FICHE.sorciere.titre, FICHE.sorciere.ico, corps, pied);
}

function corpsVoleur(e, a, sel, occupe) {
  const f = FICHE.voleur;
  const cartes = (a.centre || []).map((c) => (typeof c === 'string' ? c : (c?.role || c?.id || null)));
  const items = cartes.map((rid, i) => {
    const contenu = `<span class="lg-pl-carte-centre">${rid
      ? `${vignetteRole(rid, 40)}<span>${esc(roleById(rid).nom)}</span>`
      : `<span class="lg-pl-inconnu" aria-hidden="true">?</span><span>Carte cachée</span>`}</span>`;
    return option(`choix-${i}`, 'choix', String(i), contenu, sel.choix === String(i));
  }).join('');
  const corps = `<p class="lg-pl-consigne">${esc(f.consigne)}</p>
    <div class="lg-pl-options lg-pl-cartes">${items}${option('garder', 'choix', 'garder', `${icone('cartes', 18)}<span>Garder ma carte</span>`, sel.choix === 'garder')}</div>`;
  return carte(e, f.titre, f.ico, corps, confirmer(f.bouton, !!sel.choix, occupe));
}

function corpsChoixDeux(e, t, valeurs, sel, occupe) {
  const f = FICHE[t];
  const opts = valeurs.map(([val, libelle, ico]) => option(val, 'choix', val, `${icone(ico, 18)}<span>${esc(libelle)}</span>`, sel.choix === val)).join('');
  const corps = `<p class="lg-pl-consigne">${esc(f.consigne)}</p><div class="lg-pl-options">${opts}</div>`;
  return carte(e, f.titre, f.ico, corps, confirmer(f.bouton, !!sel.choix, occupe));
}

function panneauVote(e, sel, occupe) {
  const m = e.moi;
  const c = comptesVote(e);
  const f = FICHE.vote;
  if (!peutVoter(e)) {
    return carte(e, f.titre, f.ico, `<p class="lg-pl-consigne">${m.vivant ? 'Tu ne peux pas voter aujourd’hui.' : 'Tu es mort·e : tu observes le vote.'}</p>`);
  }
  const monVote = c.dernier.get(m.user_id);
  const eligibles = c.eligibles;
  const pasVotes = eligibles.filter((j) => !c.votants.has(j.user_id));
  const n = pasVotes.length;
  const listeVotes = [...c.dernier].map(([de, pour]) => {
    const cap = nomDe(e, de)?.capitaine ? ' (×2)' : '';
    return `<li>${pseudoHtml(e, de)} <span aria-hidden="true">→</span><span class="visually-hidden"> vote pour </span>${pseudoHtml(e, pour)}${cap}</li>`;
  }).join('');
  const manque = n
    ? `<p class="small">${n} joueur${n > 1 ? 's' : ''} ${n > 1 ? "n'ont" : "n'a"} pas encore voté : ${pasVotes.map((j) => pseudo(j)).join(', ')}.</p>`
    : '<p class="small muted">Tout le monde a voté.</p>';
  const ton = monVote
    ? `<p>Ton vote : <strong>${esc(pseudoTexte(e, monVote))}</strong></p>`
    : "<p>Tu n'as pas encore voté.</p>";
  const choix = sel.cible ? `<p class="lg-pl-choix">Ton choix : <strong>${esc(pseudoTexte(e, sel.cible))}</strong> <span class="small muted">(pas encore envoyé)</span></p>` : '';
  const corps = `${ton}${choix}
    <p class="small muted">Touche un joueur à la table pour voter, puis confirme. Tu peux changer d'avis jusqu'à la fin du temps.</p>
    <div class="lg-pl-votes-liste"><h3 class="lg-pl-sous-titre">Qui vote pour qui</h3>
      ${listeVotes ? `<ul class="lg-pl-liste">${listeVotes}</ul>` : '<p class="small muted">Personne n\'a encore voté.</p>'}
      ${manque}
    </div>
    <p class="small muted">En cas d'égalité, personne n'est éliminé.</p>`;
  return carte(e, f.titre, f.ico, corps, confirmer(f.bouton, !!sel.cible, occupe));
}

/** Panneau complet (HTML). sel : choix en cours ; occupe : envoi en cours. */
export function panneauAction(e, sel = {}, occupe = false) {
  const m = e?.moi;
  if (!m) return '';
  const t = typeAction(e);
  if (t === 'vote') return panneauVote(e, sel, occupe);
  const a = m.action;
  if (!t || !a || !FICHE[t]) {
    return `<section class="lg-pl-carte lg-pl-action-carte lg-pl-attente"><p>${esc(attenteTexte(e))}</p></section>`;
  }
  if (a.fait && !sel.modif) {
    const modifier = MODIFIABLE.has(t)
      ? `<button type="button" class="btn btn-ghost" data-act="modifier" data-k="modifier">Modifier mon choix</button>` : '';
    const choisi = a.cible ? `<p class="lg-pl-choix">Ton choix : <strong>${esc(pseudoTexte(e, a.cible))}</strong></p>` : '';
    // Voyante, Renard : la réponse arrive tout de suite dans le journal privé ; on l'affiche dans le panneau
    const reponse = (t === 'sonder' || t === 'renard')
      ? (e.journal || []).filter((j) => j.type === 'prive' && j.manche === e.partie?.manche).pop() : null;
    const corps = (reponse ? `<p class="lg-pl-note lg-pl-reponse">${icone('oeil', 18)}<strong>${esc(reponse.texte)}</strong></p>`
      : `<p class="lg-pl-note">${icone('coche', 18, 'lg-pl-coche-ok')}<span>C'est noté.</span></p>`) + choisi
      + (MODIFIABLE.has(t) ? "<p class=\"small muted\">Tu peux changer d'avis jusqu'à la fin du temps.</p>" : '');
    return carte(e, FICHE[t].titre, FICHE[t].ico, corps, modifier);
  }
  switch (t) {
    case 'voleur': return corpsVoleur(e, a, sel, occupe);
    case 'chien': return corpsChoixDeux(e, t, [['village', 'Village', 'maison'], ['loups', 'Loups', 'patte']], sel, occupe);
    case 'infecter': return corpsChoixDeux(e, t, [['oui', 'Oui', 'coche'], ['non', 'Non', 'croix']], sel, occupe);
    case 'sorciere': return corpsSorciere(e, a, sel, occupe);
    case 'cupidon':
    case 'envouter': return corpsDouble(e, t, sel, occupe);
    default: return corpsSimple(e, t, a, sel, occupe);
  }
}

/**
 * Traite un clic sur une option du panneau (data-act : vie, rien, choix, effacer, modifier).
 * Renvoie true si le panneau doit être redessiné. Ne touche pas au serveur.
 */
export function choisir(b, sel) {
  const act = b.dataset.act;
  if (act === 'vie') sel.vie = !sel.vie;
  else if (act === 'rien') { sel.vie = false; sel.cible = null; }
  else if (act === 'choix') { const v = b.dataset.val; sel.choix = sel.choix === v ? null : v; }
  else if (act === 'effacer') sel[b.dataset.champ] = null;
  else if (act === 'modifier') { sel.modif = true; sel.choix = null; sel.cible = null; }
  else return false;
  return true;
}

/**
 * Envoie le choix au serveur : lg.voter pour le vote, lg.agir sinon. passer = action facultative refusée.
 * Lève une erreur (message en français) si le choix est incomplet ou si le serveur refuse.
 */
export async function executer(s, e, sel = {}, { passer: passe = false } = {}) {
  const t = typeAction(e);
  const code = s.code;
  const lg = s.lg;
  if (passe) return lg.agir(code, 'passer');
  const exige = (ok, msg) => { if (!ok) throw new Error(msg); };
  switch (t) {
    case 'vote':
      exige(sel.cible, 'Touche un joueur à la table pour voter.');
      return lg.voter(code, sel.cible);
    case 'voleur':
      exige(sel.choix, 'Choisis une carte, ou garde la tienne.');
      return lg.agir(code, 'voleur', { choix: sel.choix });
    case 'chien':
    case 'infecter':
      exige(sel.choix, 'Fais un choix avant de confirmer.');
      return lg.agir(code, t, { choix: sel.choix });
    case 'sorciere':
      return lg.agir(code, 'sorciere', { choix: sel.vie ? 'vie' : 'rien', cible: sel.cible || null });
    case 'cupidon':
    case 'envouter':
      exige(sel.cible && sel.cible2 && sel.cible !== sel.cible2, 'Choisis deux joueurs différents.');
      return lg.agir(code, t, { cible: sel.cible, cible2: sel.cible2 });
    default:
      exige(t && sel.cible, 'Touche un joueur à la table.');
      return lg.agir(code, t, { cible: sel.cible });
  }
}
