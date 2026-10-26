// ===== Humane Gang — Jeux de plateau : chat de partie (partagé par la salle, la table et la fin) =====
/*
 * Rôle : chat d'une partie. creerChat monte le fil et la saisie dans un conteneur ; tiroirChat fait la même chose
 * dans un tiroir ouvert par un bouton « Chat » avec une pastille de messages non lus (tables sur téléphone).
 * Les messages arrivent par le temps réel (message(m)) ; ils sont dédoublonnés par id. Pseudos dans leur couleur
 * de profil (gris et « invité » pour un invité), tirés de etat.joueurs. 300 caractères au plus.
 * Dépendances : core.js (esc, toast), plateaux/api.js (plat, erreurTexte, estInvite).
 * Exporte : creerChat, tiroirChat.
 */
import { esc, toast } from '../../core.js';
import { plat, erreurTexte } from '../api.js';

const LONGUEUR_MAX = 300;
const COULEUR = /^#[0-9a-f]{6}$/i;
let compteur = 0;

/**
 * Monte le chat dans conteneur.
 * @param {HTMLElement} conteneur zone vidée puis remplie.
 * @param {{ code: string, moi?: object|null }} opts code de la partie ; moi = profil connecté (repérer mes messages).
 * @returns {{ message(m: object): void, maj(etat: object): void, detruire(): void }}
 *   message : un message {id, user_id, pseudo, texte, created_at} ; maj : l'état de la partie.
 */
export function creerChat(conteneur, { code, moi = null } = {}) {
  const uid = `plat-chat-${++compteur}`;
  let fini = false;
  let envoi = false;
  const moiId = moi?.id || moi?.user_id || null;
  const st = { msgs: [], ids: new Set(), joueurs: new Map(), cle: '', moiId, etat: null };

  conteneur.classList.add('plat-chat');
  conteneur.innerHTML = `
    <h2 class="plat-chat-titre">Chat</h2>
    <div class="plat-chat-fil" role="log" aria-live="polite" aria-relevant="additions" tabindex="0" aria-label="Messages de la partie" data-fil></div>
    <p class="plat-chat-lecture small muted" data-lecture hidden></p>
    <form class="plat-chat-form" autocomplete="off" data-form>
      <label class="visually-hidden" for="${uid}-champ">Ton message</label>
      <input id="${uid}-champ" class="plat-chat-champ" type="text" maxlength="${LONGUEUR_MAX}" placeholder="Écris un message" data-champ>
      <button type="submit" class="btn btn-primary plat-chat-envoyer" data-envoyer>Envoyer</button>
    </form>`;

  const fil = conteneur.querySelector('[data-fil]');
  const form = conteneur.querySelector('[data-form]');
  const champ = conteneur.querySelector('[data-champ]');
  const envoyer = conteneur.querySelector('[data-envoyer]');
  const lecture = conteneur.querySelector('[data-lecture]');

  /** Pseudo et couleur d'un auteur : d'après l'état, sinon d'après le message. */
  function auteur(m) {
    const j = st.joueurs.get(m.user_id);
    if (j) {
      const couleur = j.invite ? '#9A968F' : (COULEUR.test(j.couleur || '') ? j.couleur : '#F2EFEA');
      return { pseudo: j.pseudo || '?', couleur, invite: !!j.invite };
    }
    return { pseudo: m.pseudo || '?', couleur: '#F2EFEA', invite: false };
  }

  /** HTML d'une ligne de message (texte échappé). */
  function ligne(m) {
    const a = auteur(m);
    const estMoi = !!st.moiId && m.user_id === st.moiId;
    return `<p class="plat-chat-msg${estMoi ? ' is-moi' : ''}" data-id="${esc(m.id)}">
      <strong class="plat-chat-auteur" style="color:${a.couleur}">${esc(a.pseudo)}</strong>${a.invite ? ' <span class="plat-invite">invité</span>' : ''}
      <span class="plat-chat-texte">${esc(m.texte)}</span></p>`;
  }

  /** Reconstruit tout le fil et le fait défiler en bas. */
  function peindre() {
    fil.innerHTML = st.msgs.length
      ? st.msgs.map(ligne).join('')
      : '<p class="plat-chat-vide small muted">Aucun message pour l\'instant.</p>';
    fil.scrollTop = fil.scrollHeight;
  }

  /** Saisie ou phrase de lecture seule selon mon état dans la partie. */
  function rendreSaisie() {
    const e = st.etat?.moi;
    let texte = '';
    if (e && e.parti) texte = 'Tu as quitté la partie.';
    else if (e && !e.joue) texte = 'Rejoins la partie pour écrire.';
    const ouverte = !texte;
    form.hidden = !ouverte;
    lecture.hidden = ouverte;
    lecture.textContent = texte;
    champ.disabled = envoi;
    envoyer.disabled = envoi;
  }

  async function surEnvoi(ev) {
    ev.preventDefault();
    const texte = champ.value.trim().slice(0, LONGUEUR_MAX);
    if (!texte || envoi || fini) return;
    envoi = true;
    rendreSaisie();
    try {
      await plat.message(code, texte);
      champ.value = '';
    } catch (e) {
      toast(erreurTexte(e), 'error');
    } finally {
      envoi = false;
      if (!fini) { rendreSaisie(); champ.focus(); }
    }
  }
  form.addEventListener('submit', surEnvoi);

  peindre();
  rendreSaisie();

  return {
    /** Ajoute un message (une seule fois par id). */
    message(m) {
      if (fini || !m || m.id == null || st.ids.has(m.id)) return;
      st.ids.add(m.id);
      st.msgs.push(m);
      const pres = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 60;
      const vide = fil.querySelector('.plat-chat-vide');
      if (vide) vide.remove();
      fil.insertAdjacentHTML('beforeend', ligne(m));
      const estMoi = !!st.moiId && m.user_id === st.moiId;
      if (pres || estMoi) fil.scrollTop = fil.scrollHeight;
    },
    /** Pseudos, couleurs et droits d'écriture. Ne reconstruit le fil que si les joueurs ont changé. */
    maj(etat) {
      if (fini || !etat) return;
      st.etat = etat;
      st.moiId = etat.moi?.user_id || st.moiId;
      const joueurs = etat.joueurs || [];
      st.joueurs = new Map(joueurs.map((j) => [j.user_id, j]));
      const cle = joueurs.map((j) => `${j.user_id}|${j.pseudo}|${j.couleur}|${j.invite}`).join(';');
      if (cle !== st.cle) { st.cle = cle; peindre(); }
      rendreSaisie();
    },
    /** Retire le chat de la page. */
    detruire() {
      fini = true;
      conteneur.classList.remove('plat-chat');
      conteneur.innerHTML = '';
    },
  };
}

/**
 * Même chat, dans un tiroir ouvert par un bouton « Chat » (pastille = messages non lus).
 * @param {HTMLElement} conteneur zone du bouton et du tiroir.
 * @param {{ code: string, moi?: object|null }} opts comme creerChat.
 * @returns {{ message(m: object): void, maj(etat: object): void, detruire(): void, ouvrir(): void, fermer(): void }}
 */
export function tiroirChat(conteneur, opts = {}) {
  const uid = `plat-tiroir-${++compteur}`;
  let ouvert = false;
  let non_lus = 0;
  const vus = new Set();
  const moiId = opts.moi?.id || opts.moi?.user_id || null;

  conteneur.classList.add('plat-tiroir-zone');
  conteneur.innerHTML = `
    <button type="button" class="btn btn-ghost plat-tiroir-bouton" data-bouton aria-expanded="false" aria-controls="${uid}">
      <span>Chat</span><span class="plat-pastille" data-pastille aria-hidden="true" hidden></span>
    </button>
    <div class="plat-tiroir" id="${uid}" role="dialog" aria-label="Chat de la partie" hidden data-tiroir>
      <div class="plat-tiroir-tete">
        <h2 class="plat-chat-titre">Chat</h2>
        <button type="button" class="btn btn-ghost plat-tiroir-fermer" data-fermer>Fermer le chat</button>
      </div>
      <div data-corps></div>
    </div>`;

  const bouton = conteneur.querySelector('[data-bouton]');
  const pastille = conteneur.querySelector('[data-pastille]');
  const tiroir = conteneur.querySelector('[data-tiroir]');
  const fermerBtn = conteneur.querySelector('[data-fermer]');
  const chat = creerChat(conteneur.querySelector('[data-corps]'), opts);

  function rendrePastille() {
    pastille.hidden = !non_lus;
    pastille.textContent = non_lus > 9 ? '9+' : String(non_lus);
    bouton.setAttribute('aria-label', non_lus ? `Chat, ${non_lus} non lu${non_lus > 1 ? 's' : ''}` : 'Chat');
  }

  function ouvrir() {
    if (ouvert) return;
    ouvert = true;
    non_lus = 0;
    rendrePastille();
    tiroir.hidden = false;
    bouton.setAttribute('aria-expanded', 'true');
    conteneur.querySelector('[data-champ]')?.focus();
  }

  function fermer() {
    if (!ouvert) return;
    ouvert = false;
    tiroir.hidden = true;
    bouton.setAttribute('aria-expanded', 'false');
    bouton.focus();
  }

  bouton.addEventListener('click', () => (ouvert ? fermer() : ouvrir()));
  fermerBtn.addEventListener('click', fermer);
  tiroir.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') fermer(); });
  rendrePastille();

  return {
    /** Message : compté comme non lu si le tiroir est fermé et que ce n'est pas le mien. */
    message(m) {
      if (!m || m.id == null || vus.has(m.id)) return;
      vus.add(m.id);
      chat.message(m);
      if (!ouvert && !(moiId && m.user_id === moiId)) { non_lus += 1; rendrePastille(); }
    },
    maj(etat) { chat.maj(etat); },
    detruire() { chat.detruire(); conteneur.classList.remove('plat-tiroir-zone'); conteneur.innerHTML = ''; },
    ouvrir,
    fermer,
  };
}
