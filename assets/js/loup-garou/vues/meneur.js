// ===== Humane Gang — Loup-Garou : écran du meneur (partie en mode « mj ») =====
/*
 * Rôle : l'écran de celui ou celle qui mène la partie. Le meneur ne joue pas et voit tous les rôles :
 * contrôle de l'étape (pause, +30 s, étape suivante, arrêt), joueurs (éliminer, ressusciter), qui doit encore agir,
 * votes en cours, qui a vu son rôle (révélation), message au village, journal complet et salons
 * (lecture de tous, écriture dans Général).
 * Dépendances : core.js (esc), ui.js, roles.js (CAMPS, roleById), api.js (erreurTexte), chat.js (monterChat).
 * Exporte : monter.
 */
import { esc } from '../../core.js';
import { erreurTexte } from '../api.js';
import {
  icone, vignetteRole, pastilleCamp, pseudo, avatar, chrono, libellePhase, estNuit, libelleCause, confirmer, notifier,
} from '../ui.js';
import { monterChat } from '../chat.js';
import { roleById, CAMPS } from '../roles.js';

/** Salons que le meneur lit tous ; il n'écrit que dans Général. */
const SALONS = ['general', 'loups', 'morts', 'famille'];

/** Explication en clair de chaque étape. */
const EXPLICATION = {
  revelation: 'Chacun découvre son rôle en secret.',
  nuit_1: 'Les rôles de la première nuit préparent leurs pouvoirs.',
  nuit: 'Le village dort. Les rôles de nuit agissent.',
  reveil: 'La Sorcière peut sauver une victime ou empoisonner quelqu\'un.',
  debat: 'Le village débat avant le vote.',
  vote: 'Le village vote pour éliminer quelqu\'un.',
  chasseur: 'Le Chasseur tire sur un joueur avant de partir.',
  succession: 'Le Capitaine désigne son successeur.',
  fin: 'La partie est terminée.',
};

/** Action attendue de chaque type d'action (libellé lisible). */
const ACTION = {
  voleur: 'Choisir une carte (Voleur)',
  cupidon: 'Former le couple (Cupidon)',
  chien: 'Choisir son camp (Chien-loup)',
  modele: 'Choisir son modèle (Enfant sauvage)',
  devorer: 'Choisir une victime (loups)',
  sonder: 'Sonder un joueur (Voyante)',
  proteger: 'Protéger un joueur (Salvateur)',
  corbeau: 'Donner deux voix (Corbeau)',
  envouter: 'Envoûter deux joueurs (Joueur de flûte)',
  renard: 'Flairer un groupe (Renard)',
  loup_blanc: 'Éliminer un loup (Loup blanc)',
  grand_mechant: 'Choisir une victime (Grand méchant loup)',
  sorciere: 'Décider de la potion (Sorcière)',
  infecter: 'Décider d\'infecter (Infect père des loups)',
  chasseur: 'Tirer sur un joueur (Chasseur)',
  succession: 'Désigner le nouveau Capitaine',
  vote: 'Voter pour éliminer',
};

/** « 1 joueur », « 3 joueurs ». */
const nombre = (n, un, plusieurs) => `${n} ${n > 1 ? plusieurs : un}`;

/** Heure locale suisse (hh:mm:ss). */
const heure = (t) => (t ? new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', second: '2-digit', timeZone: 'Europe/Zurich' }) : '');

/** Joueur d'après son identifiant. */
const trouve = (joueurs, id) => (joueurs || []).find((j) => j.user_id === id) || null;

/** Pseudo coloré d'après l'identifiant (repli : l'identifiant échappé). */
const pseudoDe = (joueurs, id) => {
  const j = trouve(joueurs, id);
  return j ? pseudo(j) : esc(id ?? '?');
};

/** Petite étiquette. Le contenu doit déjà être échappé. */
const etiq = (html, cls = '', ic = null) => `<span class="lg-etiquette${cls ? ` ${cls}` : ''}">${ic ? icone(ic, 12) : ''}${html}</span>`;

/** Potions de la Sorcière (état secret du joueur). */
function etiquettesPotions(p) {
  if (!p) return '';
  const nb = (v) => (typeof v === 'number' && v > 1 ? ` ×${v}` : '');
  let html = '';
  if (p.vie) html += etiq(`Potion de vie${nb(p.vie)}`, 'sable', 'coeur');
  if (p.mort) html += etiq(`Potion de mort${nb(p.mort)}`, '', 'croix');
  return html;
}

/** Carte d'un joueur : rôle, camp, vie ou mort, indicateurs secrets et bouton d'action. */
function carte(j, e) {
  const r = j.role ? roleById(j.role) : null;
  const em = j.etat_mj || {};
  const camp = j.camp || r?.camp;
  const amoureux = [].concat(em.amoureux ?? []).map((id) => trouve(e.joueurs, id)).filter(Boolean);
  const pills = [];
  if (camp && CAMPS[camp]) pills.push(pastilleCamp(camp));
  pills.push(j.vivant
    ? etiq('Vivant·e', 'lg-mj-vivant', 'coche')
    : etiq(esc(libelleCause(j.mort_cause, j.mort_manche)), '', 'croix'));
  if (j.capitaine) pills.push(etiq('Capitaine', 'sable', 'couronne'));
  if (amoureux.length) pills.push(etiq(`Amoureux de ${amoureux.map((a) => pseudo(a)).join(', ')}`, '', 'coeur'));
  if (em.envoute) pills.push(etiq('Envoûté·e', '', 'oeil'));
  if (em.infecte) pills.push(etiq('Infecté·e', '', 'patte'));
  pills.push(etiquettesPotions(em.potions));
  const action = j.vivant
    ? `<button type="button" class="btn btn-ghost lg-mj-action" data-action="eliminer" data-cible="${esc(j.user_id)}" aria-label="Éliminer ${esc(j.pseudo)}">${icone('croix', 16)}Éliminer</button>`
    : `<button type="button" class="btn btn-ghost lg-mj-action" data-action="ressusciter" data-cible="${esc(j.user_id)}" aria-label="Ressusciter ${esc(j.pseudo)}">${icone('coche', 16)}Ressusciter</button>`;
  return `<article class="lg-mj-carte${j.vivant ? '' : ' lg-mj-mort'}">
    <div class="lg-mj-carte-tete">${avatar(j, 40)}<div class="lg-mj-carte-nom">${pseudo(j)}${j.place != null ? `<span class="small muted">Place n° ${esc(j.place)}</span>` : ''}</div></div>
    <div class="lg-mj-role">${j.role ? vignetteRole(j.role, 40) : ''}<span>${esc(r ? r.nom : 'Rôle inconnu')}</span></div>
    <div class="lg-mj-etiquettes">${pills.join('')}</div>
    <div class="lg-mj-carte-pied">${action}</div>
  </article>`;
}

/** Ligne du déroulé (action faite) : texte fourni par le serveur, ou composé à partir des champs. */
function ligneAction(a, joueurs) {
  if (a.texte) return esc(a.texte);
  const acteur = a.pseudo ? esc(a.pseudo) : pseudoDe(joueurs, a.user_id ?? a.acteur);
  const cibles = [a.cible, a.cible2].filter((c) => c != null && c !== '');
  const libelle = ACTION[a.type] || a.type || 'Action';
  return `${acteur} · ${esc(libelle)}${cibles.length ? ` → ${cibles.map((c) => pseudoDe(joueurs, c)).join(', ')}` : ''}`;
}

/**
 * Monte l'écran du meneur dans root.
 * @param {HTMLElement} root conteneur de l'écran.
 * @param {object} s session (partie.js) : code, lg, messages, etat(), secondesRestantes(), rafraichir(), naviguer.
 * @returns {{ maj(etat:object):void, message(msg:object):void, detruire():void }}
 */
export function monter(root, s) {
  const { code } = s;
  const ac = new AbortController();
  const idMsg = `lg-mj-msg-${Math.random().toString(36).slice(2, 8)}`;

  root.innerHTML = `<div class="lg-mj">
    <div class="lg-mj-bandeau" role="note">${icone('info', 20)}<p><strong>Mode meneur</strong> · tu vois tous les rôles. Ne partage pas ton écran.</p></div>

    <section class="lg-mj-controle" aria-labelledby="lg-mj-titre-etape">
      <div class="lg-mj-etape">
        <h2 class="lg-mj-titre" id="lg-mj-titre-etape" data-zone="titre"></h2>
        <p class="lg-mj-explication" data-zone="explication"></p>
      </div>
      <div class="lg-mj-commandes">
        <span class="lg-mj-minuteur" data-zone="minuteur" aria-live="off">--:--</span>
        <div class="lg-mj-boutons">
          <button type="button" class="btn btn-ghost" data-action="pause" data-zone="pause"></button>
          <button type="button" class="btn btn-ghost" data-action="plus">+30 s</button>
          <button type="button" class="btn btn-primary" data-action="suivant">Étape suivante</button>
          <button type="button" class="btn btn-danger" data-action="arreter">Arrêter la partie</button>
        </div>
      </div>
    </section>

    <div class="lg-mj-corps">
      <div class="lg-mj-colonne">
        <section class="lg-mj-bloc" aria-labelledby="lg-mj-h-joueurs">
          <div class="lg-mj-entete"><h2 id="lg-mj-h-joueurs">Joueurs</h2><span class="small muted" data-zone="compte"></span></div>
          <div class="lg-mj-joueurs" data-zone="joueurs"></div>
        </section>
        <section class="lg-mj-bloc" data-zone="revelation" aria-labelledby="lg-mj-h-vus" hidden></section>
        <section class="lg-mj-bloc" data-zone="votes" aria-labelledby="lg-mj-h-votes" hidden></section>
      </div>

      <aside class="lg-mj-colonne">
        <section class="lg-mj-bloc" aria-labelledby="lg-mj-h-agir">
          <h2 id="lg-mj-h-agir">Qui doit encore agir</h2>
          <div>
            <h3 class="lg-mj-sous-titre">À faire</h3>
            <ul class="lg-mj-liste" data-zone="attendus"></ul>
          </div>
          <div>
            <h3 class="lg-mj-sous-titre">Déjà fait</h3>
            <ul class="lg-mj-liste" data-zone="faits"></ul>
          </div>
        </section>

        <section class="lg-mj-bloc" aria-label="Message au village">
          <form class="lg-mj-message" data-zone="message" autocomplete="off">
            <label class="lg-mj-label" for="${idMsg}">Message au village</label>
            <div class="lg-mj-message-ligne">
              <input id="${idMsg}" class="input" maxlength="300" placeholder="Le village se réveille…">
              <button type="submit" class="btn btn-light">Envoyer</button>
            </div>
          </form>
        </section>

        <section class="lg-mj-bloc lg-mj-bloc-chat" aria-label="Salons" data-zone="chat"></section>

        <section class="lg-mj-bloc" aria-labelledby="lg-mj-h-journal">
          <h2 id="lg-mj-h-journal">Journal</h2>
          <ul class="lg-mj-journal" data-zone="journal"></ul>
        </section>
      </aside>
    </div>
  </div>`;

  const z = (nom) => root.querySelector(`[data-zone="${nom}"]`);

  /** Minuteur : chaque seconde, et à chaque mise à jour. */
  function peindreMinuteur() {
    const el = z('minuteur');
    if (!el) return;
    const enPause = s.etat()?.partie?.pause_reste != null;
    el.classList.toggle('en-pause', enPause);
    el.textContent = enPause ? 'En pause' : chrono(s.secondesRestantes());
  }

  /** Barre de contrôle : étape en clair, explication, bouton Pause / Reprendre. */
  function peindreControle(e) {
    const p = e.partie;
    z('titre').textContent = libellePhase(p);
    z('explication').textContent = EXPLICATION[p.phase] || '';
    const enPause = p.pause_reste != null;
    z('pause').innerHTML = `${icone(enPause ? 'lecture' : 'pause', 16)}${enPause ? 'Reprendre' : 'Pause'}`;
  }

  /** Tableau des joueurs : cartes (ordinateur) ou liste (téléphone). */
  function peindreJoueurs(e) {
    const js = [...(e.joueurs || [])].sort((a, b) => (a.place ?? 999) - (b.place ?? 999));
    const morts = js.filter((j) => !j.vivant).length;
    z('compte').textContent = `${nombre(js.length, 'joueur', 'joueurs')} · ${js.length - morts} en vie · ${nombre(morts, 'mort', 'morts')}`;
    z('joueurs').innerHTML = js.length ? js.map((j) => carte(j, e)).join('') : '<p class="lg-mj-vide">Aucun joueur pour l’instant.</p>';
  }

  /** Qui a vu son rôle (seulement pendant la révélation). */
  function peindreRevelation(e) {
    const zone = z('revelation');
    const js = e.joueurs || [];
    zone.hidden = e.partie.statut !== 'revelation';
    if (zone.hidden) return;
    const nbVus = js.filter((j) => j.vu_role).length;
    zone.innerHTML = `<div class="lg-mj-entete"><h2 id="lg-mj-h-vus">Qui a vu son rôle</h2><span class="small muted">${nbVus} sur ${js.length}</span></div>
      <ul class="lg-mj-vus">${js.map((j) => `<li>${pseudo(j)}${j.vu_role
        ? etiq('A vu son rôle', 'sable', 'coche')
        : etiq('Pas encore', '', 'horloge')}</li>`).join('')}</ul>`;
  }

  /** Votes en cours : décompte par cible, et qui n'a pas encore voté (phase vote seulement). */
  function peindreVotes(e) {
    const zone = z('votes');
    const p = e.partie;
    const actif = p.statut === 'en_cours' && p.phase === 'vote';
    zone.hidden = !actif;
    if (!actif) return;
    const votes = (e.votes || []).filter((v) => v.manche == null || v.manche === p.manche);
    const par = new Map();
    votes.forEach((v) => par.set(v.pour, [...(par.get(v.pour) || []), v.de]));
    const eligibles = (e.joueurs || []).filter((j) => j.vivant && j.peut_voter !== false);
    const ont = new Set(votes.map((v) => v.de));
    const pasVotes = eligibles.filter((j) => !ont.has(j.user_id));
    const lignes = [...par.entries()]
      .sort((a, b) => b[1].length - a[1].length)
      .map(([cible, de]) => `<li class="lg-mj-cible"><span>${pseudoDe(e.joueurs, cible)}
          <span class="small muted"> · ${esc(de.map((id) => trouve(e.joueurs, id)?.pseudo || id).join(', '))}</span></span>
          <span class="lg-mj-cible-voix">${de.length} voix</span></li>`).join('');
    zone.innerHTML = `<div class="lg-mj-entete"><h2 id="lg-mj-h-votes">Votes en cours</h2>
        <span class="small muted">${eligibles.length - pasVotes.length} sur ${eligibles.length} ont voté</span></div>
      ${lignes ? `<ul class="lg-mj-liste">${lignes}</ul>` : '<p class="lg-mj-vide">Aucun vote pour l’instant.</p>'}
      <p class="small"><strong>Pas encore voté :</strong> ${pasVotes.length ? pasVotes.map((j) => pseudo(j)).join(', ') : 'tout le monde a voté.'}</p>`;
  }

  /** Qui doit encore agir (attendus) et ce qui a été fait pendant la manche (actions_mj). */
  function peindreAgir(e) {
    const p = e.partie;
    const attendus = e.attendus || [];
    const faits = (e.actions_mj || []).filter((a) => a.manche == null || a.manche === p.manche);
    z('attendus').innerHTML = attendus.length
      ? attendus.map((a) => `<li class="lg-mj-attendu"><span>${pseudoDe(e.joueurs, a.user_id)}</span><span class="small muted">${esc(ACTION[a.type] || a.type || 'Action')}</span></li>`).join('')
      : '<li class="lg-mj-vide">Plus personne n’est attendu pour cette étape.</li>';
    z('faits').innerHTML = faits.length
      ? faits.map((a) => `<li class="lg-mj-fait">${icone('coche', 14)}<span>${ligneAction(a, e.joueurs)}</span></li>`).join('')
      : '<li class="lg-mj-vide">Aucune action pour l’instant.</li>';
  }

  /** Journal complet, privé compris. Défile jusqu'en bas si on y était déjà. */
  function peindreJournal(e) {
    const zone = z('journal');
    const liste = e.journal || [];
    const enBas = zone.scrollHeight - zone.scrollTop - zone.clientHeight < 40;
    zone.innerHTML = liste.length
      ? liste.map((l) => `<li class="lg-mj-journal-ligne"><time>${esc(heure(l.at))}</time>${l.prive ? etiq('privé', 'ambre') : ''}<span>${esc(l.texte)}</span></li>`).join('')
      : '<li class="lg-mj-vide">Le journal est vide.</li>';
    if (enBas) zone.scrollTop = zone.scrollHeight;
  }

  /** Chat : tous les salons en lecture, écriture dans Général. */
  const chat = monterChat(z('chat'), s, {
    titre: 'Salons',
    canaux: () => SALONS.map((canal) => ({ canal, ecrire: canal === 'general' })),
  });

  /** Actions du meneur (délégation sur la racine : les boutons sont redessinés à chaque mise à jour). */
  async function agir(b) {
    const quoi = b.dataset.action;
    const cible = b.dataset.cible || null;
    const etat = s.etat();
    const nom = trouve(etat?.joueurs, cible)?.pseudo || 'ce joueur';
    b.disabled = true;
    try {
      if (quoi === 'pause') await s.lg.mj(code, etat?.partie?.pause_reste != null ? 'reprendre' : 'pause');
      else if (quoi === 'plus') await s.lg.mj(code, 'plus', { secondes: 30 });
      else if (quoi === 'suivant') await s.lg.avancer(code, true);
      else if (quoi === 'arreter') {
        if (!await confirmer('Arrêter la partie pour tout le monde ? Elle sera terminée.', { oui: 'Arrêter la partie', danger: true })) return;
        await s.lg.mj(code, 'arreter');
      } else if (quoi === 'eliminer') {
        if (!await confirmer(`Éliminer ${nom} ? Il ou elle ne jouera plus cette partie.`, { oui: 'Éliminer', danger: true })) return;
        await s.lg.mj(code, 'eliminer', { cible });
      } else if (quoi === 'ressusciter') {
        if (!await confirmer(`Ressusciter ${nom} ?`, { oui: 'Ressusciter' })) return;
        await s.lg.mj(code, 'ressusciter', { cible });
      } else return;
      s.rafraichir();
    } catch (err) {
      notifier(erreurTexte(err), 'error');
    } finally {
      b.disabled = false;
    }
  }

  /** Message au village : publié dans le journal public. */
  async function envoyerMessage(ev) {
    ev.preventDefault();
    const form = ev.currentTarget;
    const champ = form.querySelector('input');
    const bouton = form.querySelector('button');
    const texte = champ.value.trim();
    if (!texte) return;
    bouton.disabled = true;
    try {
      await s.lg.mj(code, 'message', { texte });
      champ.value = '';
      notifier('Message publié au village.', 'ok');
    } catch (err) {
      notifier(erreurTexte(err), 'error');
    } finally {
      bouton.disabled = false;
    }
  }

  root.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-action]');
    if (b && root.contains(b)) agir(b);
  }, { signal: ac.signal });
  z('message').addEventListener('submit', envoyerMessage, { signal: ac.signal });

  const tic = setInterval(peindreMinuteur, 1000);

  return {
    /** Mise à jour à chaque changement de l'état. Ne touche pas au champ de message en cours de saisie. */
    maj(e) {
      if (ac.signal.aborted || !e?.partie) return;
      document.body.dataset.lgAmbiance = estNuit(e.partie) ? 'nuit' : 'jour';
      peindreControle(e);
      peindreJoueurs(e);
      peindreRevelation(e);
      peindreVotes(e);
      peindreAgir(e);
      peindreJournal(e);
      peindreMinuteur();
      chat.maj(e);
    },
    message(msg) {
      if (!ac.signal.aborted) chat.message(msg);
    },
    detruire() {
      clearInterval(tic);
      ac.abort();
      chat.detruire();
      delete document.body.dataset.lgAmbiance;
      root.innerHTML = '';
    },
  };
}
