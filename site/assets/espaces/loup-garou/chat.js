// ===== Humane Gang — Loup-Garou : salons de discussion (onglets, non-lus, envoi) =====
/*
 * Rôle : composant de chat réutilisé par la salle d'attente, le plateau, l'écran du meneur et la fin de partie.
 * Les salons visibles dépendent de l'état (la base ne renvoie de toute façon que les messages autorisés).
 * Invité (pas de temps réel) : les salons visibles sont relus toutes les 4 s pour recevoir les nouveaux messages.
 * Dépendances : core.js (esc), ui.js, api.js (erreurTexte, estInvite).
 * Exporte : monterChat.
 */
import { esc } from '../../commun/core.js';
import { icone, CANAUX, notifier } from './ui.js';
import { erreurTexte, estInvite } from './api.js';

/**
 * Monte un chat dans el.
 * @param {HTMLElement} el conteneur.
 * @param {object} s session de partie (partie.js) : code, lg, messages(canal, depuis), etat().
 * @param {object} o
 * @param {(etat:object)=>Array<{canal:string, label?:string, ecrire:boolean, raison?:string}>} o.canaux salons à montrer et droit d'écrire.
 * @param {string} [o.titre] titre au-dessus du chat.
 * @returns {{ maj(etat:object):void, message(m:object):void, detruire():void }}
 */
export function monterChat(el, s, { canaux, titre = 'Discussion' } = {}) {
  const st = { actif: null, liste: [], msgs: {}, dernier: {}, nonLus: {}, charges: new Set(), envoi: false };
  el.classList.add('lg-chat');
  el.innerHTML = `<div class="lg-chat-tete"><h2 class="lg-chat-titre">${esc(titre)}</h2><div class="lg-chat-onglets" role="tablist" aria-label="Salons"></div></div>
    <div class="lg-chat-fil" role="log" aria-live="polite" aria-relevant="additions" tabindex="0"></div>
    <form class="lg-chat-form" autocomplete="off">
      <label class="visually-hidden" for="lg-chat-${s.code}">Écrire un message</label>
      <input id="lg-chat-${s.code}" class="input lg-chat-input" maxlength="500" placeholder="Écrire un message…">
      <button type="submit" class="lg-btn-icone lg-chat-envoyer" aria-label="Envoyer">${icone('envoyer')}</button>
    </form>
    <p class="lg-chat-raison small muted" hidden></p>`;
  const onglets = el.querySelector('.lg-chat-onglets');
  const fil = el.querySelector('.lg-chat-fil');
  const form = el.querySelector('.lg-chat-form');
  const input = el.querySelector('.lg-chat-input');
  const raison = el.querySelector('.lg-chat-raison');

  const joueur = (uid) => s.etat()?.joueurs?.find((j) => j.user_id === uid);
  const auteur = (uid) => {
    const e = s.etat();
    const j = joueur(uid);
    if (j) {
      const c = j.invite ? '#9A968F' : (/^#[0-9a-f]{6}$/i.test(j.couleur || '') ? j.couleur : '#F2EFEA');
      return `<strong style="color:${c}">${esc(j.pseudo)}</strong>`;
    }
    if (e?.partie?.hote === uid && e?.partie?.mode === 'mj') return '<strong class="lg-chat-meneur">Meneur</strong>';
    return '<strong>?</strong>';
  };
  const heure = (t) => new Date(t).toLocaleTimeString('fr-CH', { hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
  const ligne = (m) => `<p class="lg-chat-msg">${auteur(m.user_id)} <span class="lg-chat-heure">${heure(m.created_at)}</span><br>${esc(m.texte)}</p>`;

  function peindreFil() {
    const msgs = st.msgs[st.actif] || [];
    fil.innerHTML = msgs.length ? msgs.map(ligne).join('') : '<p class="lg-chat-vide small muted">Aucun message pour l\'instant.</p>';
    fil.scrollTop = fil.scrollHeight;
  }
  function peindreOnglets() {
    onglets.innerHTML = st.liste.map((c) => {
      const n = st.nonLus[c.canal] || 0;
      return `<button type="button" role="tab" class="lg-chat-onglet" data-canal="${c.canal}" aria-selected="${c.canal === st.actif}">
        ${c.ecrire ? '' : icone('cadenas', 13)}${esc(c.label || CANAUX[c.canal] || c.canal)}${n ? `<span class="lg-chat-nonlu" aria-label="${n} non lus">${n}</span>` : ''}</button>`;
    }).join('');
    onglets.hidden = st.liste.length < 2;
    const c = st.liste.find((x) => x.canal === st.actif);
    const ok = !!c?.ecrire;
    input.disabled = !ok; form.querySelector('button').disabled = !ok;
    raison.hidden = ok || !c?.raison;
    raison.textContent = c?.raison || '';
    input.placeholder = ok ? 'Écrire un message…' : (c?.raison || 'Lecture seule');
  }
  async function charger(canal) {
    if (st.charges.has(canal)) return;
    st.charges.add(canal);
    try {
      const msgs = await s.messages(canal, 0);
      st.msgs[canal] = msgs;
      st.dernier[canal] = msgs.at(-1)?.id || 0;
      if (canal === st.actif) peindreFil();
    } catch (e) { st.charges.delete(canal); console.warn('[chat]', e); }
  }

  onglets.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-canal]');
    if (!b) return;
    st.actif = b.dataset.canal; st.nonLus[st.actif] = 0;
    peindreOnglets(); peindreFil(); charger(st.actif);
  });
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const texte = input.value.trim();
    if (!texte || st.envoi) return;
    st.envoi = true;
    try {
      await s.lg.message(s.code, st.actif, texte);
      input.value = '';
      // le message arrivera par le temps réel ; relecture de secours
      setTimeout(async () => {
        try {
          const nv = await s.messages(st.actif, st.dernier[st.actif] || 0);
          nv.forEach((m) => api.message(m));
        } catch { /* sans effet */ }
      }, 1500);
    } catch (e) { notifier(erreurTexte(e), 'error'); }
    finally { st.envoi = false; input.focus(); }
  });

  // Invité : pas de temps réel, on relit les nouveaux messages de chaque salon visible.
  let releveEnCours = false;
  const releve = estInvite() ? setInterval(async () => {
    if (releveEnCours || document.hidden) return;
    releveEnCours = true;
    try {
      for (const c of st.liste) {
        if (!st.charges.has(c.canal)) continue;
        const nv = await s.messages(c.canal, st.dernier[c.canal] || 0);
        (nv || []).forEach((m) => api.message(m));
      }
    } catch { /* réseau : on réessaiera */ } finally { releveEnCours = false; }
  }, 4000) : null;

  const api = {
    maj(etat) {
      const liste = canaux(etat) || [];
      const avant = st.liste.map((c) => c.canal).join();
      st.liste = liste;
      if (!liste.find((c) => c.canal === st.actif)) st.actif = (liste.find((c) => c.ecrire) || liste[0])?.canal || null;
      if (avant !== liste.map((c) => c.canal).join()) liste.forEach((c) => charger(c.canal));
      peindreOnglets();
      if (st.actif) peindreFil();
    },
    message(m) {
      if (!m || !st.liste.find((c) => c.canal === m.canal)) return;
      const arr = st.msgs[m.canal] || (st.msgs[m.canal] = []);
      if (arr.some((x) => x.id === m.id)) return;
      arr.push(m);
      st.dernier[m.canal] = Math.max(st.dernier[m.canal] || 0, m.id);
      if (m.canal === st.actif) {
        const vide = fil.querySelector('.lg-chat-vide'); if (vide) vide.remove();
        fil.insertAdjacentHTML('beforeend', ligne(m)); fil.scrollTop = fil.scrollHeight;
      } else { st.nonLus[m.canal] = (st.nonLus[m.canal] || 0) + 1; peindreOnglets(); }
    },
    detruire() { clearInterval(releve); el.innerHTML = ''; },
  };
  return api;
}
