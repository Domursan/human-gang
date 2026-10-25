// ===== Humane Gang — Duels : accueil (duels.html, sans adresse de duel) =====
/*
 * Rôle : écran d'accueil des duels. Rejoindre avec un code, les trois jeux (Puissance 4, Morpion, Mastermind),
 * code du jour, défis reçus (accepter ou refuser), mes duels, duels ouverts, duels en direct, défier un membre
 * (liste avec recherche), jouer contre le robot et résumé des statistiques (lien vers #stats).
 * Les blocs viennent de duel.accueil(), relu toutes les 10 s tant que l'écran est ouvert ; la liste des membres
 * est chargée une fois. Chaque bloc se met à jour seul : une erreur ne bloque pas les autres.
 * Dépendances : core.js (esc, toast), duels/api.js (duel, erreurTexte, JEUX), vues/commun.js (avatarHtml, couleurJoueur).
 * Exporte : afficher.
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte, JEUX } from '../api.js';
import { avatarHtml, couleurJoueur } from './commun.js';

/** Intervalle de rafraîchissement de l'accueil (ms). */
const INTERVALLE = 10000;
/** Forme d'un code de duel : HGP4-2190, HGMO-1234, HGMM-1234. */
const FORME_CODE = /^HG[A-Z0-9]{2}-\d{4}$/;
const CHARGEMENT = '<p class="duels-acc-aide">Chargement…</p>';

const nombre = (n) => Number(n || 0).toLocaleString('fr-CH');
const arr = (x) => (Array.isArray(x) ? x : []);
const urlPartie = (code) => `#partie/${encodeURIComponent(code)}`;
const urlRejoindre = (code) => `#rejoindre/${encodeURIComponent(code)}`;

/** « hgp4 2190 », « HGP4-2190 » ou « hgp42190 » donnent « HGP4-2190 ». Renvoie null si le format ne colle pas. */
function normaliserCode(saisie) {
  const s = String(saisie || '').toUpperCase().replace(/\s+/g, '').replace(/^(HG[A-Z0-9]{2})(\d{4})$/, '$1-$2');
  return FORME_CODE.test(s) ? s : null;
}

/** Texte sans accents ni majuscules (recherche de membres). */
const sansAccents = (s) => String(s || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

/** Pseudo dans sa couleur de joueur (gris pour le robot). */
function pseudo(nom, couleur, robot = false) {
  return `<span class="duels-acc-pseudo" style="color:${couleurJoueur({ couleur, robot })}">${esc(nom || '?')}</span>`;
}

/** Délai avant une échéance, en phrase (« Expire dans 4 min »). Chaîne vide si la date n'est pas valable. */
function expireTexte(fin) {
  const t = new Date(fin).getTime();
  if (isNaN(t)) return '';
  const s = Math.ceil((t - Date.now()) / 1000);
  if (s <= 0) return 'Expiré';
  return s < 60 ? 'Expire dans moins d’une minute' : `Expire dans ${Math.ceil(s / 60)} min`;
}

/** Temps restant du tour, « · reste 0:31 » (vide si pas d'échéance valable). */
function tempsTour(fin) {
  const t = new Date(fin).getTime();
  if (isNaN(t)) return '';
  const s = Math.max(0, Math.ceil((t - Date.now()) / 1000));
  return ` · reste ${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Format et délai d'une partie, en phrase (« au meilleur des 3 · coups de 30 s »). */
function reglages(d) {
  const morceaux = [];
  if (d.format) morceaux.push(Number(d.format) === 1 ? 'manche unique' : `au meilleur des ${d.format}`);
  if (d.t_coup) morceaux.push(d.jeu === 'mastermind' ? `délai de ${d.t_coup} s` : `coups de ${d.t_coup} s`);
  return morceaux.join(' · ');
}

/* ---------- Blocs ---------- */

/** Squelette de l'écran : titre, rejoindre, jeux, colonnes. Les zones dynamiques démarrent en « Chargement… ». */
function squelette() {
  return `<div class="duels-acc">
    <header class="duels-acc-tete">
      <div class="duels-acc-titre">
        <nav class="duels-fil" aria-label="Fil d’Ariane"><a href="jeux.html">Jeux</a> › Duels</nav>
        <h1 class="duels-titre">Duels</h1>
        <p class="duels-acc-intro">Trois jeux à deux. Défie un membre, partage un code ou entraîne-toi contre le robot.</p>
      </div>
      <section class="card duels-acc-carte duels-acc-rejoindre" aria-labelledby="acc-rejoindre-titre">
        <h2 id="acc-rejoindre-titre" class="duels-acc-titre-carte">Rejoindre un duel</h2>
        <form id="acc-form" class="duels-acc-form" novalidate>
          <label for="acc-code" class="duels-acc-champ-nom">Code du duel</label>
          <div class="duels-acc-form-ligne">
            <input id="acc-code" class="duels-acc-code" type="text" name="code" placeholder="HGP4-2190" autocomplete="off"
              autocapitalize="characters" spellcheck="false" aria-describedby="acc-aide acc-erreur">
            <button type="submit" class="btn btn-light">Rejoindre</button>
          </div>
        </form>
        <p id="acc-erreur" class="duels-acc-erreur" role="alert" hidden></p>
        <p id="acc-aide" class="duels-acc-aide">Le code est donné par l'hôte du duel. Un lien d'invitation fonctionne aussi.</p>
      </section>
    </header>

    <section class="duels-acc-jeux" aria-label="Les jeux">${htmlJeux()}</section>

    <div class="duels-acc-grille">
      <div class="duels-acc-colonne">
        <section class="card duels-acc-carte" aria-labelledby="acc-defis-titre">
          <div class="duels-acc-entete">
            <h2 id="acc-defis-titre" class="duels-acc-titre-carte">Défis reçus</h2>
            <span id="acc-defis-nb" class="duels-acc-nb" hidden></span>
          </div>
          <div id="acc-defis" aria-live="polite">${CHARGEMENT}</div>
        </section>
        <section class="card duels-acc-carte" aria-labelledby="acc-mes-titre">
          <h2 id="acc-mes-titre" class="duels-acc-titre-carte">Mes duels</h2>
          <div id="acc-mes" aria-live="polite">${CHARGEMENT}</div>
        </section>
        <section class="card duels-acc-carte" aria-labelledby="acc-ouverts-titre">
          <h2 id="acc-ouverts-titre" class="duels-acc-titre-carte">Duels ouverts</h2>
          <div id="acc-ouverts" aria-live="polite">${CHARGEMENT}</div>
        </section>
        <section class="card duels-acc-carte" aria-labelledby="acc-direct-titre">
          <h2 id="acc-direct-titre" class="duels-acc-titre-carte">En direct</h2>
          <div id="acc-direct" aria-live="polite">${CHARGEMENT}</div>
        </section>
      </div>

      <div class="duels-acc-colonne">
        <section class="card duels-acc-carte" aria-labelledby="acc-jour-titre">
          <h2 id="acc-jour-titre" class="duels-acc-titre-carte">Code du jour</h2>
          <p class="duels-acc-aide">Le même code secret pour tout le gang, à percer en Mastermind.</p>
          <a class="btn btn-ghost duels-acc-bouton duels-acc-alignee" href="#jour">Jouer le code du jour</a>
        </section>
        <section class="card duels-acc-carte" aria-labelledby="acc-membres-titre">
          <h2 id="acc-membres-titre" class="duels-acc-titre-carte">Défier un membre</h2>
          <label for="acc-recherche" class="duels-acc-champ-nom">Chercher un membre</label>
          <input id="acc-recherche" class="duels-acc-recherche" type="search" autocomplete="off" placeholder="Pseudo">
          <p id="acc-recherche-compte" class="duels-acc-aide" aria-live="polite"></p>
          <div id="acc-membres" aria-live="polite">${CHARGEMENT}</div>
        </section>
        <section class="card duels-acc-carte" aria-labelledby="acc-robot-titre">
          <h2 id="acc-robot-titre" class="duels-acc-titre-carte">Contre le robot</h2>
          <p class="duels-acc-aide">Pour t'entraîner, sans Paillettes.</p>
          <a class="btn btn-ghost duels-acc-bouton duels-acc-alignee" href="#creer/robot">Affronter le robot</a>
        </section>
        <section class="card duels-acc-carte" aria-labelledby="acc-stats-titre">
          <h2 id="acc-stats-titre" class="duels-acc-titre-carte">Mes statistiques</h2>
          <div id="acc-stats" aria-live="polite">${CHARGEMENT}</div>
        </section>
      </div>
    </div>
  </div>`;
}

/** Les trois jeux : image, nom, texte et bouton « Jouer » vers la création du duel. */
function htmlJeux() {
  return Object.entries(JEUX).map(([cle, j]) => `
    <article class="duels-acc-jeu">
      <img class="duels-vignette" src="assets/img/jeux/${esc(j.image)}.webp" alt="" loading="lazy">
      <div class="duels-acc-jeu-corps">
        <h2 class="duels-acc-jeu-nom">${esc(j.nom)}</h2>
        <p class="duels-acc-jeu-texte">${esc(j.texte)}</p>
        <a class="btn btn-primary duels-acc-jouer" href="#creer/${esc(cle)}">Jouer<span class="visually-hidden"> à ${esc(j.nom)}</span></a>
      </div>
    </article>`).join('');
}

/** Défis reçus : accepter ou refuser. Les boutons en cours d'envoi restent désactivés. */
function htmlDefis(liste, occupes) {
  if (!liste.length) return '<p class="duels-acc-aide">Aucun défi en attente.</p>';
  return `<ul class="duels-acc-liste">${liste.map((d) => {
    const nom = d.hote_pseudo || 'un membre';
    const occupe = occupes.has(d.code) ? ' disabled' : '';
    const infos = [reglages(d), expireTexte(d.expire)].filter(Boolean).join(' · ');
    return `<li class="duels-acc-ligne">
      ${avatarHtml({ pseudo: d.hote_pseudo, couleur: d.hote_couleur })}
      <div class="duels-acc-ligne-texte">
        <strong>${pseudo(d.hote_pseudo, d.hote_couleur)} te défie au ${esc(d.nom)}</strong>
        <span class="duels-acc-sous">${esc(infos)}</span>
      </div>
      <div class="duels-acc-actions">
        <button type="button" class="btn btn-primary duels-acc-bouton" data-action="accepter" data-code="${esc(d.code)}"
          aria-label="Accepter le défi de ${esc(nom)}"${occupe}>Accepter</button>
        <button type="button" class="btn btn-ghost duels-acc-bouton" data-action="refuser" data-code="${esc(d.code)}"
          aria-label="Refuser le défi de ${esc(nom)}"${occupe}>Refuser</button>
      </div>
    </li>`;
  }).join('')}</ul>`;
}

/** Mes duels : reprendre une partie ; mise en avant (or) quand c'est mon tour. */
function htmlMesDuels(liste) {
  if (!liste.length) return '<p class="duels-acc-aide">Aucun duel en cours. Défie un membre ou lance une partie contre le robot.</p>';
  return `<ul class="duels-acc-liste">${liste.map((d) => {
    const adv = d.robot ? 'Le robot' : (d.adversaire_pseudo || '');
    let etat;
    if (d.statut === 'attente') etat = d.defi_en_attente ? 'en attente de sa réponse' : 'salle d’attente, personne n’a encore rejoint';
    else if (d.mon_tour) etat = `à toi de jouer${tempsTour(d.tour_fin)}`;
    else if (d.jeu === 'mastermind') etat = 'chacun joue de son côté';
    else etat = 'à l’autre de jouer';
    const contre = adv ? `Contre ${pseudo(adv, d.adversaire_couleur, !!d.robot)} · ` : '';
    return `<li class="duels-acc-ligne${d.mon_tour ? ' is-tour' : ''}">
      ${avatarHtml({ pseudo: adv || '?', couleur: d.robot ? null : d.adversaire_couleur, robot: !!d.robot })}
      <div class="duels-acc-ligne-texte">
        <strong>${esc(d.nom)}${d.mon_tour ? ' <span class="duels-acc-etiquette">À toi</span>' : ''}</strong>
        <span class="duels-acc-sous">${contre}${esc(etat)}</span>
      </div>
      <a class="btn ${d.mon_tour ? 'btn-sand' : 'btn-ghost'} duels-acc-bouton" href="${urlPartie(d.code)}">Reprendre<span class="visually-hidden"> ${esc(d.nom)}</span></a>
    </li>`;
  }).join('')}</ul>`;
}

/** Duels ouverts : rejoindre une partie qui attend un second joueur. */
function htmlOuverts(liste) {
  if (!liste.length) return '<p class="duels-acc-aide">Aucun duel ouvert pour le moment. Crée le tien : il apparaîtra ici.</p>';
  return `<ul class="duels-acc-liste">${liste.map((o) => `<li class="duels-acc-ligne">
      ${avatarHtml({ pseudo: o.hote_pseudo, couleur: o.hote_couleur }, { taille: 40 })}
      <div class="duels-acc-ligne-texte">
        <strong>${esc(o.nom)}</strong>
        <span class="duels-acc-sous">Par ${pseudo(o.hote_pseudo, o.hote_couleur)}${reglages(o) ? ` · ${esc(reglages(o))}` : ''}</span>
      </div>
      <a class="btn btn-ghost duels-acc-bouton" href="${urlRejoindre(o.code)}">Rejoindre<span class="visually-hidden"> ${esc(o.nom)}</span></a>
    </li>`).join('')}</ul>`;
}

/** Duels en direct : regarder une partie en cours. */
function htmlDirect(liste) {
  if (!liste.length) return '<p class="duels-acc-aide">Aucun duel en direct pour le moment.</p>';
  return `<ul class="duels-acc-liste">${liste.map((d) => {
    const joueurs = arr(d.joueurs).map((j) => pseudo(j.pseudo, j.couleur)).join(' contre ') || 'Duel en cours';
    return `<li class="duels-acc-ligne">
      <div class="duels-acc-ligne-texte">
        <strong>${esc(d.nom)}</strong>
        <span class="duels-acc-sous">${joueurs}</span>
      </div>
      <a class="btn btn-ghost duels-acc-bouton" href="${urlPartie(d.code)}">Regarder<span class="visually-hidden"> ${esc(d.nom)}</span></a>
    </li>`;
  }).join('')}</ul>`;
}

/** Résumé des statistiques : duels, victoires, série, rival ; lien vers #stats. */
function htmlResume(s) {
  if (!s) return '<p class="duels-acc-aide">Statistiques indisponibles pour l’instant.</p>';
  const duels = Number(s.duels) || 0;
  const rival = s.rival && Number(s.rival.duels)
    ? `<p class="duels-acc-sous">Rival favori : ${pseudo(s.rival.pseudo, s.rival.couleur)} · ${nombre(s.rival.duels)} duel${Number(s.rival.duels) > 1 ? 's' : ''}</p>`
    : '';
  return `<div class="duels-acc-tuiles">
      <div class="duels-acc-tuile"><span class="duels-acc-chiffre">${nombre(duels)}</span><span class="duels-acc-tuile-nom">duels</span></div>
      <div class="duels-acc-tuile is-vert"><span class="duels-acc-chiffre">${nombre(s.victoires)}</span><span class="duels-acc-tuile-nom">victoires</span></div>
      <div class="duels-acc-tuile is-or"><span class="duels-acc-chiffre">${nombre(s.serie)}</span><span class="duels-acc-tuile-nom">série</span></div>
    </div>
    ${duels ? rival : '<p class="duels-acc-aide">Pas encore de duel joué. Tes statistiques apparaîtront ici après ton premier duel.</p>'}
    <a class="duels-acc-lien" href="#stats">Voir toutes mes statistiques</a>`;
}

/** Une ligne de la liste des membres, avec son bouton « Défier ». */
function ligneMembre(m) {
  return `<li class="duels-acc-membre">
    ${avatarHtml(m, { taille: 36 })}
    <span class="duels-acc-membre-nom">${pseudo(m.pseudo, m.couleur)}</span>
    <a class="btn btn-ghost duels-acc-bouton" href="#creer/membre/${encodeURIComponent(m.user_id)}">Défier<span class="visually-hidden"> ${esc(m.pseudo || '')}</span></a>
  </li>`;
}

/* ---------- Écran ---------- */

/**
 * Affiche l'accueil des duels dans root. Renvoie la fonction de nettoyage (arrêt du rafraîchissement).
 * @param {HTMLElement} root conteneur de la page (#app).
 * @param {{ naviguer: (hash: string) => void }} ctx naviguer(hash) change d'écran.
 * @returns {() => void} arrête le rafraîchissement de 10 s.
 */
export async function afficher(root, { naviguer }) {
  let actif = true;
  let charge = false;
  let enVol = false;
  const occupes = new Set();
  let membres = [];

  root.innerHTML = squelette();
  const ecran = root.querySelector('.duels-acc');
  const el = (id) => ecran.querySelector(`#${id}`);
  const zones = { defis: el('acc-defis'), mes: el('acc-mes'), ouverts: el('acc-ouverts'), direct: el('acc-direct'), stats: el('acc-stats') };
  const rendu = {};
  const nbDefis = el('acc-defis-nb');
  const formulaire = el('acc-form');
  const champ = el('acc-code');
  const erreur = el('acc-erreur');
  const recherche = el('acc-recherche');
  const compte = el('acc-recherche-compte');
  const zoneMembres = el('acc-membres');

  /** Remplit une zone seulement si son contenu a changé (évite de perdre le focus). */
  const poser = (cle, html) => {
    if (rendu[cle] !== html) { zones[cle].innerHTML = html; rendu[cle] = html; }
  };

  // Rejoindre avec un code : normalisation puis navigation vers le duel.
  champ.addEventListener('input', () => {
    if (!erreur.hidden) { erreur.hidden = true; champ.removeAttribute('aria-invalid'); }
  });
  formulaire.addEventListener('submit', (e) => {
    e.preventDefault();
    const code = normaliserCode(champ.value);
    if (!code) {
      erreur.textContent = 'Le code ressemble à HGP4-2190.';
      erreur.hidden = false;
      champ.setAttribute('aria-invalid', 'true');
      champ.focus();
      return;
    }
    champ.value = code;
    naviguer(urlRejoindre(code));
  });

  // Défis reçus : accepter (puis aller au duel) ou refuser. Délégation : les boutons sont redessinés à chaque relecture.
  ecran.addEventListener('click', async (e) => {
    const bouton = e.target.closest('button[data-action]');
    if (!bouton || bouton.disabled) return;
    const code = bouton.dataset.code;
    occupes.add(code);
    bouton.closest('li')?.querySelectorAll('button').forEach((b) => { b.disabled = true; });
    try {
      if (bouton.dataset.action === 'accepter') {
        const c = await duel.rejoindre(code);
        naviguer(urlPartie(typeof c === 'string' && c ? c : code));
        return;
      }
      await duel.refuser(code);
      toast('Défi refusé.');
    } catch (err) {
      toast(erreurTexte(err), 'error');
    }
    occupes.delete(code);
    delete rendu.defis;
    if (actif) chargerAccueil();
  });

  // Défier un membre : filtre la liste déjà chargée.
  function filtrerMembres() {
    const saisie = recherche.value.trim();
    const q = sansAccents(saisie);
    const liste = q ? membres.filter((m) => sansAccents(m.pseudo).includes(q)) : membres;
    zoneMembres.innerHTML = liste.length
      ? `<ul class="duels-acc-membres">${liste.map(ligneMembre).join('')}</ul>`
      : `<p class="duels-acc-aide">${membres.length && saisie ? `Aucun membre ne correspond à « ${esc(saisie)} ».` : 'Aucun membre à défier pour le moment.'}</p>`;
    compte.textContent = membres.length && saisie ? `${liste.length} sur ${membres.length}` : '';
  }
  recherche.addEventListener('input', filtrerMembres);

  /** Relit l'accueil et met à jour chaque bloc. */
  async function chargerAccueil() {
    if (enVol) return;
    enVol = true;
    try {
      const d = await duel.accueil();
      if (!actif) return;
      charge = true;
      const defis = arr(d?.defis_recus);
      poser('defis', htmlDefis(defis, occupes));
      nbDefis.textContent = String(defis.length);
      nbDefis.hidden = !defis.length;
      poser('mes', htmlMesDuels(arr(d?.mes_duels)));
      poser('ouverts', htmlOuverts(arr(d?.ouverts)));
      poser('direct', htmlDirect(arr(d?.en_direct)));
      poser('stats', htmlResume(d?.resume));
    } catch (e) {
      if (!actif || charge) return;
      const msg = `<p class="duels-acc-aide">Indisponible pour l’instant. ${esc(erreurTexte(e))}</p>`;
      for (const cle of ['defis', 'mes', 'ouverts', 'direct', 'stats']) poser(cle, msg);
    } finally {
      enVol = false;
    }
  }

  /** Charge la liste des membres une seule fois. */
  async function chargerMembres() {
    try {
      const liste = await duel.membres();
      if (!actif) return;
      membres = arr(liste);
      filtrerMembres();
    } catch (e) {
      if (!actif) return;
      zoneMembres.innerHTML = `<p class="duels-acc-aide">Liste indisponible pour l’instant. ${esc(erreurTexte(e))}</p>`;
    }
  }

  chargerAccueil();
  chargerMembres();
  const minuterie = setInterval(chargerAccueil, INTERVALLE);

  return () => {
    actif = false;
    clearInterval(minuterie);
  };
}
