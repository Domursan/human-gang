// ===== Humane Gang — Codenames : chat à onglets (vues/chat.js) =====
/*
 * Rôle : chat d'une partie, partagé par la salle d'attente (vues/salle.js) et la table (vues/table.js).
 * Deux onglets : « Général » (tous) et « Équipe Jaune » / « Équipe Rose » (mon équipe seulement, présent si etat.moi.equipe).
 * Chaque message va dans son onglet (son canal). Un onglet caché garde une pastille de non-lus.
 * L'espion lit le canal de son équipe mais ne peut pas y écrire pendant la partie.
 * Pseudo dans sa couleur de profil ; invité en gris avec l'étiquette « invité ».
 * Dépendances : core.js (esc, toast), ../api.js (ndc, erreurTexte, EQUIPES).
 * Exporte : creerChat.
 */
import { esc, toast } from '../../core.js';
import { ndc, erreurTexte, EQUIPES } from '../api.js';

const LONGUEUR_MAX = 300;
const COULEUR = /^#[0-9a-f]{6}$/i;
const LECTURE_ESPION = "L'espion ne peut pas écrire à son équipe.";
let compteur = 0;

/** Canal d'un message : 'general' ou 'equipe' (le temps réel peut donner la couleur de l'équipe à la place). */
const canalDe = (m) => (m.canal === 'general' ? 'general' : 'equipe');

/**
 * Monte le chat dans el.
 * @param {HTMLElement} el conteneur (vidé puis rempli ; reçoit la classe ndc-chat).
 * @param {{code: string, moi?: object|null, suivi?: object|null}} o code de la partie ; moi = profil connecté
 *   (sert à repérer ses messages) ; suivi = pour relire l'état après un envoi (facultatif).
 * @returns {{ ajouter(msg: object): void, maj(etat: object): void, detruire(): void }}
 *   ajouter : un message {id, user_id, pseudo, canal, texte, created_at} ; maj : l'état de la partie.
 */
export function creerChat(el, { code, moi = null, suivi = null } = {}) {
  const uid = `ndc-chat-${++compteur}`;
  let fini = false;
  el.classList.add('ndc-chat');
  el.innerHTML = `
    <div class="ndc-chat-onglets" role="tablist" aria-label="Canaux du chat" data-onglets></div>
    <div class="ndc-chat-panneau" role="tabpanel" id="${uid}-panneau" data-panneau>
      <div class="ndc-chat-fil" role="log" aria-live="polite" aria-relevant="additions" tabindex="0" aria-label="Messages du canal Général" data-fil="general"></div>
      <div class="ndc-chat-fil" role="log" aria-live="polite" aria-relevant="additions" tabindex="0" aria-label="Messages de l'équipe" data-fil="equipe" hidden></div>
      <p class="ndc-chat-lecture" data-lecture hidden></p>
      <form class="ndc-chat-form" autocomplete="off" data-form hidden>
        <label class="visually-hidden" for="${uid}-champ">Ton message</label>
        <input id="${uid}-champ" class="ndc-chat-champ" type="text" maxlength="${LONGUEUR_MAX}" placeholder="Écris un message" data-champ>
        <button type="submit" class="btn btn-primary ndc-chat-envoyer" data-envoyer>Envoyer</button>
      </form>
    </div>`;

  const onglets = el.querySelector('[data-onglets]');
  const panneau = el.querySelector('[data-panneau]');
  const fils = { general: el.querySelector('[data-fil="general"]'), equipe: el.querySelector('[data-fil="equipe"]') };
  const lecture = el.querySelector('[data-lecture]');
  const form = el.querySelector('[data-form]');
  const champ = el.querySelector('[data-champ]');
  const envoyer = el.querySelector('[data-envoyer]');

  const st = {
    canal: 'general',                 // onglet affiché
    tous: [],                         // tous les messages reçus (dédoublonnés), tous canaux
    ids: new Set(),
    non_lus: { general: 0, equipe: 0 },
    moi: null,                        // etat.moi (dernier connu)
    moiId: moi?.id || moi?.user_id || null,
    partie: null,                     // statut de la partie
    joueurs: new Map(),               // user_id -> joueur (pseudo, couleur, équipe)
    cleOnglets: '',
    cle: '',
    envoi: false,
  };

  /** Vrai si le message doit apparaître chez moi : canal général, ou message de mon équipe. */
  function accepte(m) {
    if (canalDe(m) === 'general') return true;
    const eq = st.moi?.equipe;
    if (!eq) return false;
    const auteur = st.joueurs.get(m.user_id);
    return !auteur || auteur.equipe === eq;
  }

  /** HTML d'une ligne de message (texte échappé, pseudo dans sa couleur de profil). */
  function ligne(m) {
    const a = st.joueurs.get(m.user_id);
    const estMoi = !!st.moiId && m.user_id === st.moiId;
    const invite = !!a?.invite;
    const pseudo = a?.pseudo || m.pseudo || '?';
    const couleur = invite ? '#9A968F' : (COULEUR.test(a?.couleur || '') ? a.couleur : '');
    return `<p class="ndc-chat-msg${estMoi ? ' is-moi' : ''}" data-id="${esc(m.id)}">
      <strong class="ndc-chat-auteur"${couleur ? ` style="color:${couleur}"` : ''}>${esc(pseudo)}</strong>${invite ? ' <span class="ndc-invite-tag">invité</span>' : ''}
      <span class="ndc-chat-texte">${esc(m.texte)}</span></p>`;
  }

  /** Reconstruit le fil d'un canal et le fait défiler jusqu'en bas. */
  function rendreFil(canal) {
    const fil = fils[canal];
    const liste = st.tous.filter((m) => canalDe(m) === canal && accepte(m));
    fil.innerHTML = liste.length
      ? liste.map(ligne).join('')
      : `<p class="ndc-chat-vide">${canal === 'general' ? 'Aucun message pour l\'instant.' : 'Aucun message dans ton équipe pour l\'instant.'}</p>`;
    fil.scrollTop = fil.scrollHeight;
  }

  /** Onglets : créés selon mon équipe, pastilles de non-lus et état sélectionné mis à jour. */
  function rendreOnglets() {
    const eq = st.moi?.equipe || null;
    const cle = eq || '-';
    if (cle !== st.cleOnglets) {
      st.cleOnglets = cle;
      if (!eq && st.canal === 'equipe') st.canal = 'general';
      const defs = [{ canal: 'general', titre: 'Général' }];
      if (eq) defs.push({ canal: 'equipe', titre: `Équipe ${EQUIPES[eq].nom}`, eq });
      onglets.innerHTML = defs.map((d) => `<button type="button" role="tab" class="ndc-chat-onglet${d.eq ? ` is-${d.eq}` : ''}" id="${uid}-onglet-${d.canal}" data-canal="${d.canal}" data-titre="${esc(d.titre)}"><span>${esc(d.titre)}</span><span class="ndc-chat-pastille" data-pastille aria-hidden="true" hidden></span></button>`).join('');
      fils.equipe.setAttribute('aria-label', eq ? `Messages de l'équipe ${EQUIPES[eq].nom}` : "Messages de l'équipe");
    }
    for (const b of onglets.querySelectorAll('[role="tab"]')) {
      const c = b.dataset.canal;
      const actif = c === st.canal;
      const n = st.non_lus[c];
      b.setAttribute('aria-selected', String(actif));
      b.tabIndex = actif ? 0 : -1;
      b.classList.toggle('is-actif', actif);
      const pastille = b.querySelector('[data-pastille]');
      pastille.hidden = !n;
      pastille.textContent = n > 9 ? '9+' : String(n);
      b.setAttribute('aria-label', n ? `${b.dataset.titre}, ${n} non lu${n > 1 ? 's' : ''}` : b.dataset.titre);
    }
    panneau.setAttribute('aria-labelledby', `${uid}-onglet-${st.canal}`);
    for (const c of ['general', 'equipe']) fils[c].hidden = c !== st.canal;
  }

  /** Affiche un onglet, remet ses non-lus à zéro et descend au dernier message. */
  function selectionner(canal) {
    if (!onglets.querySelector(`[data-canal="${canal}"]`)) return;
    st.canal = canal;
    st.non_lus[canal] = 0;
    rendreOnglets();
    rendreSaisie();
    const fil = fils[canal];
    fil.scrollTop = fil.scrollHeight;
  }

  /** Peut-on écrire dans l'onglet affiché ? Sinon, la phrase à montrer à la place de la saisie. */
  function ecriture() {
    const m = st.moi;
    if (!m) return { ok: false, texte: 'Rejoins la partie pour écrire.' };
    if (m.parti) return { ok: false, texte: 'Tu as quitté la partie.' };
    if (!m.joue) return { ok: false, texte: 'Rejoins la partie pour écrire.' };
    if (st.canal === 'equipe' && m.espion && st.partie === 'en_cours') return { ok: false, texte: LECTURE_ESPION };
    return { ok: true, texte: '' };
  }

  /** Saisie ou phrase de lecture seule, selon l'onglet et mon rôle. */
  function rendreSaisie() {
    const e = ecriture();
    form.hidden = !e.ok;
    lecture.hidden = e.ok;
    lecture.textContent = e.texte;
    champ.disabled = st.envoi;
    envoyer.disabled = st.envoi;
  }

  /** Envoi dans l'onglet affiché ; le message revient par le temps réel (dédoublonné par id). */
  async function surEnvoi(ev) {
    ev.preventDefault();
    const texte = champ.value.trim().slice(0, LONGUEUR_MAX);
    if (!texte || st.envoi || !ecriture().ok) return;
    st.envoi = true;
    rendreSaisie();
    try {
      await ndc.message(code, texte, st.canal);
      champ.value = '';
      suivi?.rafraichir?.();
    } catch (e) {
      toast(erreurTexte(e), 'error');
    } finally {
      st.envoi = false;
      rendreSaisie();
      if (!fini) champ.focus();
    }
  }

  // Onglets : clic, puis flèches, Début et Fin (motif de tablist).
  onglets.addEventListener('click', (ev) => {
    const b = ev.target.closest('[role="tab"]');
    if (b) selectionner(b.dataset.canal);
  });
  onglets.addEventListener('keydown', (ev) => {
    const liste = [...onglets.querySelectorAll('[role="tab"]')];
    const i = liste.indexOf(ev.target);
    if (i < 0) return;
    const j = { ArrowRight: (i + 1) % liste.length, ArrowLeft: (i - 1 + liste.length) % liste.length, Home: 0, End: liste.length - 1 }[ev.key];
    if (j === undefined) return;
    ev.preventDefault();
    liste[j].focus();
    selectionner(liste[j].dataset.canal);
  });
  form.addEventListener('submit', surEnvoi);

  rendreOnglets();
  rendreFil('general');
  rendreFil('equipe');
  rendreSaisie();

  return {
    /** Ajoute un message (une seule fois par id) dans son canal ; pastille si l'onglet est caché. */
    ajouter(m) {
      if (fini || !m || m.id == null || st.ids.has(m.id)) return;
      st.ids.add(m.id);
      st.tous.push(m);
      if (!accepte(m)) return;
      const canal = canalDe(m);
      const estMoi = !!st.moiId && m.user_id === st.moiId;
      if (canal === st.canal) {
        const fil = fils[canal];
        const pres = fil.scrollHeight - fil.scrollTop - fil.clientHeight < 60;
        fil.querySelector('.ndc-chat-vide')?.remove();
        fil.insertAdjacentHTML('beforeend', ligne(m));
        if (pres || estMoi) fil.scrollTop = fil.scrollHeight;
      } else if (!estMoi) {
        st.non_lus[canal] += 1;
        rendreOnglets();
      }
    },
    /** Pseudos, couleurs, équipes et droits d'écriture. Ne reconstruit les fils que si ces données ont changé. */
    maj(etat) {
      if (fini || !etat) return;
      st.moi = etat.moi || null;
      st.moiId = etat.moi?.user_id || st.moiId;
      st.partie = etat.partie?.statut || null;
      const joueurs = etat.joueurs || [];
      st.joueurs = new Map(joueurs.map((j) => [j.user_id, j]));
      const cle = JSON.stringify([
        st.moi?.equipe || null, !!st.moi?.joue, !!st.moi?.parti,
        joueurs.map((j) => [j.user_id, j.pseudo, j.couleur, !!j.invite, j.equipe]),
      ]);
      if (cle !== st.cle) {
        st.cle = cle;
        rendreOnglets();
        rendreFil('general');
        rendreFil('equipe');
      }
      rendreSaisie();
    },
    /** Retire le chat de la page. */
    detruire() {
      fini = true;
      el.classList.remove('ndc-chat');
      el.innerHTML = '';
    },
  };
}
