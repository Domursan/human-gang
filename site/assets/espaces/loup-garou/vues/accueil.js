// ===== Humane Gang — Loup-Garou : accueil (#, sans adresse de partie) =====
/*
 * Rôle : écran d'accueil du Loup-Garou. Héros avec la lune en éclipse et les deux boutons principaux, rejoindre avec un
 * code, parties en cours du membre (masquées si vide), parties publiques en attente (rafraîchies toutes les 10 s),
 * statistiques résumées et présentation des camps. Chaque bloc charge ses données à part : une erreur n'empêche pas les autres.
 * Dépendances : core.js (esc), loup-garou/api.js (lg, erreurTexte), loup-garou/roles.js (CAMPS, EXTENSIONS, ROLES, roleById),
 *   loup-garou/ui.js (icone, avatar, pseudo, libellePhase).
 * Exporte : afficher.
 */
import { esc } from '../../core.js';
import { lg, erreurTexte } from '../api.js';
import { CAMPS, EXTENSIONS, ROLES, roleById } from '../roles.js';
import { icone, avatar, pseudo, libellePhase } from '../ui.js';

/** Intervalle de rafraîchissement des parties publiques (ms). */
const INTERVALLE_PUBLIQUES = 10000;

/** Présentation des camps (couleurs : CAMPS dans roles.js). */
const CAMPS_ACCUEIL = [
  { cle: 'village', icone: 'maison', titre: 'Village', texte: 'Démasquer et éliminer les loups' },
  { cle: 'loups', icone: 'patte', titre: 'Loups-garous', texte: 'Dévorer le village sans se faire prendre' },
  { cle: 'solo', icone: 'etoile', titre: 'Solitaires', texte: 'Gagner seul, contre tout le monde' },
];

const nombre = (n) => Number(n || 0).toLocaleString('fr-CH');
const urlPartie = (code) => `#partie/${encodeURIComponent(code)}`;
const urlRejoindre = (code) => `#rejoindre/${encodeURIComponent(code)}`;

/** « 4821 », « hglg4821 » ou « HGLG-4821 » donnent « HGLG-4821 ». Renvoie null si le format ne colle pas. */
function normaliserCode(saisie) {
  const m = String(saisie || '').toUpperCase().replace(/\s+/g, '').match(/^(?:HGLG-?)?(\d{4})$/);
  return m ? `HGLG-${m[1]}` : null;
}

/* ---------- Blocs ---------- */

function htmlHero() {
  return `<section class="lg-acc-hero" aria-labelledby="lg-acc-titre">
    <div class="lg-acc-hero-texte">
      <span class="eyebrow">Jeux du gang</span>
      <h1 id="lg-acc-titre" class="lg-acc-titre display">Loup-Garou</h1>
      <p class="lg-acc-intro">De 6 à 50 joueurs, avec un meneur humain ou automatique. Le chat est intégré, la voix reste sur Discord.</p>
      <div class="lg-acc-actions">
        <a class="btn btn-primary lg-btn-grand" href="#creer">${icone('plus', 18)}<span>Créer une partie</span></a>
        <a class="btn btn-ghost lg-btn-grand" href="#roles">${icone('cartes', 18)}<span>Découvrir les ${ROLES.length} rôles</span></a>
      </div>
    </div>
    <div class="lg-lune" style="--lg-lune: 270px; width:260px; height:260px" aria-hidden="true"></div>
  </section>`;
}

function htmlRejoindre() {
  return `<section class="lg-acc-carte" aria-labelledby="lg-acc-rejoindre-titre">
    <h2 id="lg-acc-rejoindre-titre" class="lg-acc-titre-carte">Rejoindre avec un code</h2>
    <form class="lg-acc-rejoindre" id="lg-acc-form" novalidate>
      <label for="lg-acc-code" class="visually-hidden">Code de partie</label>
      <input id="lg-acc-code" class="lg-acc-code" type="text" name="code" placeholder="HGLG-4821" autocomplete="off"
        autocapitalize="characters" spellcheck="false" aria-describedby="lg-acc-aide lg-acc-erreur">
      <button type="submit" class="btn btn-light lg-btn-grand">Rejoindre</button>
    </form>
    <p id="lg-acc-erreur" class="lg-acc-erreur" role="alert" hidden></p>
    <p id="lg-acc-aide" class="lg-acc-aide">Le code est donné par la personne qui a créé la partie. Un lien d'invitation fonctionne aussi.</p>
  </section>`;
}

function ligneMaPartie(p) {
  const infos = p.statut === 'attente'
    ? ["Salle d'attente"]
    : [libellePhase(p), `${nombre(p.vivants)} en vie sur ${nombre(p.nb_joueurs)}`];
  infos.push(p.mode === 'mj' ? 'meneur humain' : 'meneur automatique');
  return `<li class="lg-acc-ligne">
    <span class="lg-acc-puce" aria-hidden="true">${icone('lune', 20)}</span>
    <div class="lg-acc-ligne-texte">
      <strong>${esc(p.nom)}</strong>
      <span class="lg-acc-sous">${esc(infos.join(' · '))}</span>
    </div>
    ${p.meneur ? '<span class="lg-etiquette ambre">Meneur</span>' : ''}
    <a class="btn btn-sand lg-acc-bouton" href="${esc(urlPartie(p.code))}">Reprendre<span class="visually-hidden"> ${esc(p.nom)}</span></a>
  </li>`;
}

function htmlMesParties(parties) {
  return `<section class="lg-acc-carte" aria-labelledby="lg-acc-encours-titre">
    <h2 id="lg-acc-encours-titre" class="lg-acc-titre-carte">Mes parties en cours</h2>
    <ul class="lg-acc-liste">${parties.map(ligneMaPartie).join('')}</ul>
  </section>`;
}

function lignePublique(p) {
  const hote = { pseudo: p.hote_pseudo, couleur: p.hote_couleur };
  const extensions = (p.extensions || []).map((id) => EXTENSIONS.find((e) => e.id === id)?.label).filter(Boolean);
  const infos = [p.mode === 'mj' ? 'Meneur humain' : 'Meneur automatique'];
  if (extensions.length) infos.push(extensions.join(' + '));
  return `<li class="lg-acc-ligne">
    ${avatar(hote, 40)}
    <div class="lg-acc-ligne-texte">
      <strong>${esc(p.nom)}</strong>
      <span class="lg-acc-sous">Par ${pseudo(hote)} · ${esc(infos.join(' · '))}</span>
    </div>
    <span class="lg-acc-nb">${nombre(p.joueurs)}/${nombre(p.nb_joueurs)}<span class="visually-hidden"> joueurs</span></span>
    <a class="btn btn-ghost lg-acc-bouton" href="${esc(urlRejoindre(p.code))}">Rejoindre<span class="visually-hidden"> ${esc(p.nom)}</span></a>
  </li>`;
}

function htmlPubliques(liste) {
  if (!liste.length) {
    return `<div class="lg-acc-vide">
      <p>Personne n'attend de joueurs pour le moment.</p>
      <p class="lg-acc-aide">Lance la tienne : elle apparaîtra ici en direct.</p>
      <a class="btn btn-ghost lg-acc-bouton" href="#creer">Créer une partie</a>
    </div>`;
  }
  return `<ul class="lg-acc-liste">${liste.map(lignePublique).join('')}</ul>`;
}

/** Carte « Mes statistiques » avec son titre ; corps = HTML déjà prêt. */
function htmlCarteStats(corps) {
  return `<section class="lg-acc-carte" aria-labelledby="lg-acc-stats-titre">
    <h2 id="lg-acc-stats-titre" class="lg-acc-titre-carte">Mes statistiques</h2>
    ${corps}
  </section>`;
}

function htmlStatsResume(s) {
  const parties = Number(s.parties) || 0;
  const victoires = Number(s.victoires) || 0;
  const top = s.par_role?.[0];
  const detail = parties
    ? `<dl class="lg-acc-lignes">
        ${top ? `<div class="lg-acc-ligne-stat"><dt>Rôle le plus joué</dt><dd>${esc(roleById(top.role).nom)} (${nombre(top.parties)})</dd></div>` : ''}
        <div class="lg-acc-ligne-stat"><dt>Paillettes gagnées en jouant</dt><dd class="lg-acc-or">+ ${nombre(s.paillettes)}</dd></div>
      </dl>`
    : '<p class="lg-acc-aide">Pas encore de partie jouée. Tes statistiques apparaîtront ici après ta première partie.</p>';
  return htmlCarteStats(`
    <div class="lg-acc-tuiles">
      <div class="lg-acc-tuile"><span class="lg-acc-chiffre">${nombre(parties)}</span><span class="lg-acc-tuile-nom">parties</span></div>
      <div class="lg-acc-tuile vert"><span class="lg-acc-chiffre">${nombre(victoires)}</span><span class="lg-acc-tuile-nom">victoires</span></div>
      <div class="lg-acc-tuile rose"><span class="lg-acc-chiffre">${nombre(parties - victoires)}</span><span class="lg-acc-tuile-nom">défaites</span></div>
    </div>
    ${detail}
    <a class="lg-acc-lien" href="#stats">Voir toutes mes statistiques</a>`);
}

function htmlCamps() {
  return `<section class="lg-acc-carte lg-acc-camps" aria-labelledby="lg-acc-camps-titre">
    <h2 id="lg-acc-camps-titre" class="lg-acc-titre-carte">Les camps</h2>
    <ul class="lg-acc-liste-camps">${CAMPS_ACCUEIL.map((c) => `<li class="lg-acc-camp">
      <span class="lg-acc-camp-ico" aria-hidden="true" style="background:${CAMPS[c.cle].fond};color:${CAMPS[c.cle].texte}">${icone(c.icone, 18)}</span>
      <div class="lg-acc-camp-texte"><strong>${esc(c.titre)}</strong><span class="lg-acc-sous">${esc(c.texte)}</span></div>
    </li>`).join('')}</ul>
  </section>`;
}

/* ---------- Écran ---------- */

/**
 * Affiche l'accueil dans root. Renvoie la fonction de nettoyage (arrêt du rafraîchissement, ambiance retirée).
 * @param {HTMLElement} root
 * @param {{ naviguer: (hash: string) => void }} ctx
 */
export async function afficher(root, { naviguer }) {
  document.body.dataset.lgAmbiance = 'nuit';
  let actif = true;

  root.innerHTML = `<div class="lg-acc">
    ${htmlHero()}
    <div class="lg-acc-grille">
      <div class="lg-acc-colonne">
        ${htmlRejoindre()}
        <div id="lg-acc-encours" hidden></div>
        <section class="lg-acc-carte" aria-labelledby="lg-acc-publiques-titre">
          <div class="lg-acc-carte-tete">
            <h2 id="lg-acc-publiques-titre" class="lg-acc-titre-carte">Parties publiques en attente</h2>
            <span class="lg-acc-sous" aria-hidden="true">Mises à jour en direct</span>
          </div>
          <div id="lg-acc-publiques" aria-live="polite"><p class="lg-acc-aide">Chargement…</p></div>
        </section>
      </div>
      <aside class="lg-acc-colonne" aria-label="Mes statistiques et les camps">
        <div id="lg-acc-stats">${htmlCarteStats('<p class="lg-acc-aide">Chargement…</p>')}</div>
        ${htmlCamps()}
      </aside>
    </div>
  </div>`;

  const zoneEnCours = root.querySelector('#lg-acc-encours');
  const zonePubliques = root.querySelector('#lg-acc-publiques');
  const zoneStats = root.querySelector('#lg-acc-stats');
  const formulaire = root.querySelector('#lg-acc-form');
  const champ = root.querySelector('#lg-acc-code');
  const erreur = root.querySelector('#lg-acc-erreur');

  // Rejoindre avec un code : normalisation puis navigation vers la salle d'attente.
  champ.addEventListener('input', () => {
    if (!erreur.hidden) { erreur.hidden = true; champ.removeAttribute('aria-invalid'); }
  });
  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normaliserCode(champ.value);
    if (!code) {
      erreur.textContent = 'Le code ressemble à HGLG-4821 : quatre chiffres, avec ou sans « HGLG ».';
      erreur.hidden = false;
      champ.setAttribute('aria-invalid', 'true');
      champ.focus();
      return;
    }
    champ.value = code;
    erreur.hidden = true;
    champ.removeAttribute('aria-invalid');
    naviguer(urlRejoindre(code));
  });

  // Chaque bloc charge ses données à part ; une erreur ne bloque pas les autres.
  async function chargerEnCours() {
    try {
      const parties = await lg.mesParties();
      if (!actif || !Array.isArray(parties) || !parties.length) return;
      zoneEnCours.innerHTML = htmlMesParties(parties);
      zoneEnCours.hidden = false;
    } catch (e) {
      console.warn('[loup-garou] mes parties', e);
    }
  }

  let dernierHtmlPubliques = null;
  async function chargerPubliques() {
    try {
      const liste = await lg.publiques();
      if (!actif) return;
      const html = htmlPubliques(Array.isArray(liste) ? liste : []);
      if (html !== dernierHtmlPubliques) { zonePubliques.innerHTML = html; dernierHtmlPubliques = html; }
    } catch (e) {
      if (!actif || dernierHtmlPubliques !== null) return;
      zonePubliques.innerHTML = `<p class="lg-acc-aide">Liste indisponible pour l'instant. ${esc(erreurTexte(e))}</p>`;
    }
  }

  async function chargerStats() {
    try {
      const s = await lg.stats();
      if (!actif) return;
      zoneStats.innerHTML = s
        ? htmlStatsResume(s)
        : htmlCarteStats('<p class="lg-acc-aide">Tes statistiques ne sont pas disponibles pour ton compte.</p>');
    } catch (e) {
      if (!actif) return;
      zoneStats.innerHTML = htmlCarteStats(`<p class="lg-acc-aide">Statistiques indisponibles pour l'instant. ${esc(erreurTexte(e))}</p>`);
    }
  }

  chargerEnCours();
  chargerPubliques();
  chargerStats();
  const minuterie = setInterval(() => { if (!document.hidden) chargerPubliques(); }, INTERVALLE_PUBLIQUES);

  return () => {
    actif = false;
    clearInterval(minuterie);
    delete document.body.dataset.lgAmbiance;
  };
}
