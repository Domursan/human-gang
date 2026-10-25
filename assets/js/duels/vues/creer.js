// ===== Humane Gang — Duels : nouveau duel (#creer, #creer/<jeu>, #creer/robot, #creer/membre/<uuid>) =====
/*
 * Rôle : formulaire en trois étapes (1. le jeu · 2. l'adversaire · 3. les réglages du jeu choisi) et récapitulatif « Ton duel ».
 *   Un membre : défi (duel.creer, expire après 10 min). Un code : duel en attente à partager. Le robot : démarre tout de suite.
 *   Dans les trois cas, on ouvre ensuite #partie/CODE.
 * Adresse : #creer/<jeu> présélectionne le jeu ; #creer/robot présélectionne le robot ;
 *   #creer/membre/<uuid> présélectionne ce membre (s'il peut être défié).
 * Les choix sont de vrais <input type="radio"> masqués, stylés en pastilles (clavier et lecteurs d'écran OK).
 * Dépendances : core.js (esc, toast), duels/api.js (duel, erreurTexte, JEUX, ROBOTS), vues/commun.js (avatarHtml, nomJoueur).
 * Exporte : afficher.
 */
import { esc, toast } from '../../core.js';
import { duel, erreurTexte, JEUX, ROBOTS } from '../api.js';
import { avatarHtml, nomJoueur } from './commun.js';

const FORMATS = [[1, '1 manche'], [3, 'Au meilleur des 3'], [5, 'Au meilleur des 5']];
const COMMENCE = [['moi', 'Moi'], ['lui', 'Lui'], ['hasard', 'Au hasard']];
const ADVERSAIRES = [['membre', 'Un membre'], ['code', 'Un code à partager'], ['robot', 'Le robot']];
const CODES = [['choisis', 'Choisis par chacun'], ['hasard', 'Tirés au hasard']];
const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12l5 5 9-10"/></svg>';

/** Texte sans accents ni majuscules (recherche de membres). */
const normaliser = (t) => String(t || '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '');
const libelle = (liste, valeur) => liste.find(([v]) => String(v) === String(valeur))?.[1] || '';

/** Choix radio en pastille. aide : texte secondaire ; etat : affiche « Sélectionné » quand il est coché. */
function choix(nom, valeur, texte, { aide = '', etat = true, classe = '' } = {}) {
  return `<label class="duels-choix ${classe}">
    <input class="visually-hidden" type="radio" name="${nom}" value="${esc(String(valeur))}">
    <span class="duels-choix-txt"><strong>${esc(texte)}</strong>${aide ? `<span class="duels-choix-aide">${esc(aide)}</span>` : ''}</span>
    ${etat ? `<span class="duels-choix-etat">${CHECK}<span>Sélectionné</span></span>` : ''}
  </label>`;
}

/** Groupe de choix (fieldset avec légende visible). */
const groupe = (titre, contenu, attrs = '') => `<fieldset class="duels-groupe" ${attrs}>
  <legend>${esc(titre)}</legend>
  <div class="duels-choix-liste">${contenu}</div>
</fieldset>`;

/** Interrupteur (case à cocher affichée en bouton). */
function interrupteur(nom, titre, aide, coche) {
  const id = `creer-${nom}-aide`;
  return `<label class="duels-switch">
    <span class="duels-switch-txt"><strong>${esc(titre)}</strong><span class="duels-choix-aide" id="${id}">${esc(aide)}</span></span>
    <input class="visually-hidden" type="checkbox" role="switch" name="${nom}" aria-describedby="${id}"${coche ? ' checked' : ''}>
    <span class="duels-piste" aria-hidden="true"></span>
  </label>`;
}

/** Réglages lus et écrits par le formulaire. */
function etatInitial(arg, arg2) {
  const jeu = Object.hasOwn(JEUX, arg) ? arg : 'p4';
  return {
    jeu,
    variante: JEUX[jeu].variantes[0][0],
    adversaire: arg === 'robot' ? 'robot' : 'membre',
    membre: arg === 'membre' && arg2 ? arg2 : null,
    robot: 2,
    commence: 'moi',
    format: 3,
    t_coup: JEUX[jeu].tempsDefaut,
    visibilite: 'publique',
    invites: false,
    codes: 'choisis',
  };
}

/**
 * Affiche le formulaire « Nouveau duel » et gère l'envoi.
 * @param {HTMLElement} root zone d'affichage (#app).
 * @param {{ arg: string|null, arg2: string|null, naviguer: Function }} ctx arg = jeu ou « robot » ou « membre » ; arg2 = uuid du membre.
 */
export async function afficher(root, { arg, arg2, naviguer }) {
  const s = etatInitial(arg, arg2);
  let membres = [];
  let membresPrets = false;
  let dernierJeu = null;
  let occupe = false;

  const jeuxHtml = Object.entries(JEUX).map(([cle, j]) => `<label class="duels-jeu">
      <input class="visually-hidden" type="radio" name="jeu" value="${esc(cle)}">
      <img class="duels-vignette" src="assets/img/jeux/${esc(j.image)}.webp" alt="" loading="lazy">
      <span class="duels-jeu-nom">${esc(j.nom)}</span>
      <span class="duels-choix-etat">${CHECK}<span>Sélectionné</span></span>
      <span class="duels-jeu-aide">${esc(j.texte)}</span>
    </label>`).join('');

  root.innerHTML = `
    <p class="duels-fil"><a href="duels.html">Duels</a> › Nouveau duel</p>
    <h1 class="duels-titre">Nouveau duel</h1>
    <p class="duels-sous">Trois étapes, puis tu envoies le défi.</p>

    <form id="creer-duel" class="duels-creer" novalidate>
      <div class="duels-creer-colonnes">
        <div class="duels-etapes">

          <section class="card duels-etape" aria-labelledby="creer-etape1">
            <h2 id="creer-etape1" class="duels-etape-titre">1. Le jeu</h2>
            <fieldset class="duels-jeux">
              <legend class="visually-hidden">Jeu</legend>
              <div class="duels-jeux-liste">${jeuxHtml}</div>
            </fieldset>
          </section>

          <section class="card duels-etape" aria-labelledby="creer-etape2">
            <h2 id="creer-etape2" class="duels-etape-titre">2. L'adversaire</h2>
            <fieldset class="duels-seg-fs">
              <legend class="visually-hidden">Type d'adversaire</legend>
              <div class="duels-seg">${ADVERSAIRES.map(([v, t]) => choix('adv', v, t, { etat: false, classe: 'duels-seg-choix' })).join('')}</div>
            </fieldset>

            <div data-panneau="membre" class="duels-panneau">
              <div class="field">
                <label for="creer-recherche">Chercher un membre</label>
                <input id="creer-recherche" class="input" type="search" autocomplete="off" data-recherche>
              </div>
              <fieldset class="duels-membres-fs">
                <legend class="visually-hidden">Membre à défier</legend>
                <div class="duels-membres" data-membres><p class="muted small" role="status">Chargement des membres…</p></div>
              </fieldset>
              <p class="muted small" data-vide hidden>Aucun membre ne correspond.</p>
            </div>

            <div data-panneau="code" class="duels-panneau" hidden>
              <p class="muted small">Tu obtiens un code à partager. Le duel démarre quand quelqu'un le rejoint avec ce code.</p>
              ${interrupteur('publique', 'Partie publique', 'Les membres peuvent regarder', true)}
              ${interrupteur('invites', 'Invités acceptés', 'Des visiteurs sans compte peuvent rejoindre avec le lien.', false)}
            </div>

            <div data-panneau="robot" class="duels-panneau" hidden>
              ${groupe('Niveau', ROBOTS.map(([v, t]) => choix('robot', v, t)).join(''))}
              <p class="duels-pastille-ligne"><span class="duels-pastille">Sans Paillettes</span> <span class="muted small">Les parties contre le robot ne rapportent pas de Paillettes.</span></p>
            </div>
          </section>

          <section class="card duels-etape" aria-labelledby="creer-etape3">
            <h2 id="creer-etape3" class="duels-etape-titre">3. Les réglages</h2>
            <div class="duels-reglages-trois">
              ${groupe('Qui commence', COMMENCE.map(([v, t]) => choix('commence', v, t)).join(''))}
              ${groupe('Format', FORMATS.map(([v, t]) => choix('format', v, t)).join(''))}
              <fieldset class="duels-groupe"><legend>Temps par coup</legend><div class="duels-choix-liste" data-temps></div></fieldset>
            </div>
            <fieldset class="duels-groupe duels-groupe-large"><legend>Variante</legend><div class="duels-variantes" data-variantes></div></fieldset>
            <fieldset class="duels-groupe" data-codes hidden><legend>Les codes</legend>
              <div class="duels-choix-liste">${CODES.map(([v, t]) => choix('codes', v, t)).join('')}</div>
            </fieldset>
          </section>
        </div>

        <aside class="card duels-recap" aria-labelledby="creer-recap">
          <h2 id="creer-recap" class="duels-recap-titre">Ton duel</h2>
          <dl class="duels-recap-liste">
            <div><dt>Jeu</dt><dd data-r="jeu"></dd></div>
            <div><dt>Adversaire</dt><dd data-r="adv"></dd></div>
            <div><dt>Qui commence</dt><dd data-r="commence"></dd></div>
            <div><dt>Format</dt><dd data-r="format"></dd></div>
            <div><dt>Temps par coup</dt><dd data-r="temps"></dd></div>
            <div><dt>Variante</dt><dd data-r="variante"></dd></div>
            <div data-r-codes hidden><dt>Les codes</dt><dd data-r="codes"></dd></div>
          </dl>
          <p class="duels-erreur-envoi" data-erreur role="alert" hidden></p>
          <button type="submit" class="btn btn-primary duels-envoyer" data-envoyer>Envoyer le défi</button>
          <p class="duels-aide-envoi small muted" data-note role="status"></p>
        </aside>
      </div>
    </form>`;

  const form = root.querySelector('#creer-duel');
  const bouton = root.querySelector('[data-envoyer]');
  const note = root.querySelector('[data-note]');
  const erreurEl = root.querySelector('[data-erreur]');
  const listeEl = root.querySelector('[data-membres]');
  const champ = root.querySelector('[data-recherche]');
  const videEl = root.querySelector('[data-vide]');
  const variantesEl = root.querySelector('[data-variantes]');
  const tempsEl = root.querySelector('[data-temps]');
  const codesEl = root.querySelector('[data-codes]');

  /** Le membre choisi (ou undefined). */
  const membreChoisi = () => membres.find((m) => m.user_id === s.membre);

  /** Lit le formulaire dans l'état. Les membres ne sont relus qu'une fois la liste affichée. */
  function lire() {
    const fd = new FormData(form);
    if (fd.get('jeu')) s.jeu = fd.get('jeu');
    if (fd.get('adv')) s.adversaire = fd.get('adv');
    if (membresPrets) s.membre = fd.get('membre') || null;
    if (fd.get('robot')) s.robot = Number(fd.get('robot'));
    if (fd.get('commence')) s.commence = fd.get('commence');
    if (fd.get('format')) s.format = Number(fd.get('format'));
    if (fd.get('t_coup')) s.t_coup = Number(fd.get('t_coup'));
    if (fd.get('variante')) s.variante = fd.get('variante');
    if (fd.get('codes')) s.codes = fd.get('codes');
    s.visibilite = form.querySelector('[name="publique"]').checked ? 'publique' : 'privee';
    s.invites = form.querySelector('[name="invites"]').checked;
  }

  /** Variantes et temps du jeu choisi (reconstruits seulement quand le jeu change, pour garder le focus). */
  function rendreReglages() {
    if (dernierJeu === s.jeu) return;
    dernierJeu = s.jeu;
    const j = JEUX[s.jeu];
    if (!j.variantes.some(([id]) => id === s.variante)) s.variante = j.variantes[0][0];
    if (!j.temps.includes(s.t_coup)) s.t_coup = j.tempsDefaut;
    variantesEl.innerHTML = j.variantes.map(([id, nom, aide]) => choix('variante', id, nom, { aide, classe: 'duels-choix-large' })).join('');
    tempsEl.innerHTML = j.temps.map((t) => choix('t_coup', t, `${t} s`)).join('');
  }

  /** Coche les choix d'après l'état et affiche le panneau de l'adversaire choisi. */
  function peindre() {
    const coches = { jeu: s.jeu, adv: s.adversaire, robot: s.robot, commence: s.commence, format: s.format,
      t_coup: s.t_coup, variante: s.variante, codes: s.codes };
    for (const [nom, val] of Object.entries(coches)) {
      form.querySelectorAll(`input[name="${nom}"]`).forEach((el) => { el.checked = el.value === String(val); });
    }
    if (membresPrets) form.querySelectorAll('input[name="membre"]').forEach((el) => { el.checked = el.value === String(s.membre); });
    form.querySelector('[name="publique"]').checked = s.visibilite === 'publique';
    form.querySelector('[name="invites"]').checked = s.invites;
    form.querySelectorAll('[data-panneau]').forEach((p) => { p.hidden = p.dataset.panneau !== s.adversaire; });
    codesEl.hidden = s.jeu !== 'mastermind';
  }

  /** Récapitulatif « Ton duel ». */
  function majRecap() {
    const j = JEUX[s.jeu];
    const m = membreChoisi();
    const set = (cle, html) => { const el = root.querySelector(`[data-r="${cle}"]`); if (el) el.innerHTML = html; };
    let adv;
    if (s.adversaire === 'membre') adv = m ? nomJoueur(m) : '<span class="muted">À choisir</span>';
    else if (s.adversaire === 'code') adv = 'Un code à partager';
    else adv = `<span style="color:#9A9A9F">Le robot</span> · ${esc(libelle(ROBOTS, s.robot))}`;
    set('jeu', esc(j.nom));
    set('adv', adv);
    set('commence', esc(libelle(COMMENCE, s.commence)));
    set('format', esc(libelle(FORMATS, s.format)));
    set('temps', `${s.t_coup} s`);
    set('variante', esc(j.variantes.find(([id]) => id === s.variante)?.[1] || ''));
    set('codes', esc(libelle(CODES, s.codes)));
    root.querySelector('[data-r-codes]').hidden = s.jeu !== 'mastermind';
  }

  /** Bouton d'envoi et note sous le bouton, selon l'adversaire. */
  function majBouton() {
    const m = membreChoisi();
    if (s.adversaire === 'membre') {
      bouton.textContent = m ? `Envoyer le défi à ${m.pseudo}` : 'Envoyer le défi';
      note.textContent = m ? `${m.pseudo} reçoit une notification sur le site et un message du bot s'il l'a activé.` : 'Choisis un membre à défier.';
      bouton.disabled = occupe || !m;
    } else if (s.adversaire === 'code') {
      bouton.textContent = 'Créer le duel';
      note.textContent = 'Tu reçois un code à partager. Le duel démarre quand quelqu\'un le rejoint.';
      bouton.disabled = occupe;
    } else {
      bouton.textContent = 'Jouer contre le robot';
      note.textContent = 'Le duel démarre tout de suite.';
      bouton.disabled = occupe;
    }
  }

  /** Relit, met à jour l'affichage, sans relancer l'envoi. */
  function mettreAJour() {
    lire();
    rendreReglages();
    peindre();
    majRecap();
    majBouton();
  }

  /** Affiche ou efface l'erreur d'envoi. */
  const erreur = (msg) => { erreurEl.textContent = msg; erreurEl.hidden = !msg; };

  /** Liste des membres, filtrée par la recherche. */
  function afficherMembres() {
    if (!membres.length) {
      listeEl.innerHTML = '<p class="muted small">Aucun membre à défier pour l\'instant.</p>';
      return;
    }
    listeEl.innerHTML = membres.map((m) => `<label class="duels-choix duels-membre" data-membre data-cherche="${esc(normaliser(m.pseudo))}">
        <input class="visually-hidden" type="radio" name="membre" value="${esc(m.user_id)}">
        ${avatarHtml(m, { taille: 36 })}
        <span class="duels-membre-nom">${nomJoueur(m)}</span>
        <span class="duels-choix-etat">${CHECK}<span>Sélectionné</span></span>
      </label>`).join('');
  }

  champ.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
  champ.addEventListener('input', () => {
    const q = normaliser(champ.value.trim());
    let n = 0;
    listeEl.querySelectorAll('[data-membre]').forEach((el) => {
      const ok = !q || el.dataset.cherche.includes(q);
      el.hidden = !ok;
      if (ok) n += 1;
    });
    videEl.hidden = n > 0 || !membres.length;
  });

  /** Envoi : crée le duel côté serveur, puis ouvre sa page. */
  async function envoyer(e) {
    e.preventDefault();
    if (occupe) return;
    lire();
    if (s.adversaire === 'membre' && !s.membre) {
      erreur('Choisis un membre à défier.');
      champ.focus();
      return;
    }
    const p = { jeu: s.jeu, variante: s.variante, adversaire: s.adversaire, commence: s.commence,
      format: s.format, t_coup: s.t_coup, visibilite: s.visibilite };
    if (s.adversaire === 'membre') p.membre = s.membre;
    if (s.adversaire === 'robot') p.robot = s.robot;
    if (s.adversaire === 'code') p.invites = s.invites;
    if (s.jeu === 'mastermind') p.codes = s.codes;

    erreur('');
    occupe = true;
    bouton.disabled = true;
    bouton.textContent = s.adversaire === 'membre' ? 'Envoi du défi…' : 'Création…';
    try {
      const code = await duel.creer(p);
      if (!code) throw new Error('Le duel est créé, mais son code est introuvable. Ouvre-le depuis l\'accueil.');
      naviguer(`#partie/${encodeURIComponent(code)}`);
    } catch (err) {
      occupe = false;
      toast(erreurTexte(err), 'error');
      majBouton();
    }
  }

  form.addEventListener('change', () => { erreur(''); mettreAJour(); });
  form.addEventListener('submit', envoyer);

  // Premier affichage avec la présélection de l'adresse, puis chargement des membres.
  mettreAJour();
  try {
    membres = (await duel.membres()) || [];
  } catch (err) {
    listeEl.innerHTML = `<p class="muted small" role="status">${esc(erreurTexte(err))}</p>`;
    membres = [];
  }
  membresPrets = true;
  afficherMembres();
  peindre();
  majRecap();
  majBouton();
}
