// ===== Humane Gang — Jeux de plateau : fin de partie (statut « terminee » ou « annulee ») =====
/*
 * Rôle : titre (« Partie terminée » / « Partie arrêtée »), gagnant(s) mis en avant, classement (rang puis place),
 * Paillettes gagnées et badges débloqués (membres seulement), revanche ou retour à l'accueil du jeu.
 * Au milieu, un encart propre au jeu : ../jeux/<jeu>/fin.js, export recap(etat, contenus) → HTML (facultatif).
 * Chat en bas.
 * Dépendances : core.js (esc, toast), plateaux/api.js (plat, erreurTexte, estInvite, jeu), vues/commun.js, vues/chat.js.
 * Exporte : creer.
 */
import { esc, toast } from '../../../commun/core.js';
import { plat, erreurTexte, estInvite, jeu } from '../api.js';
import { avatarHtml, pseudoHtml } from './commun.js';
import { creerChat } from './chat.js';

/** Clé de rendu : on ne réécrit une zone que si ses données ont changé. */
function zone(el, cle, html) {
  if (!el || el.dataset.cle === cle) return;
  el.dataset.cle = cle;
  el.innerHTML = html;
}

/** Joueurs classés : rang croissant, puis place ; les sans rang à la fin. */
const classes = (joueurs) => [...joueurs].sort((a, b) => (a.rang ?? 99) - (b.rang ?? 99) || (a.place ?? 99) - (b.place ?? 99));

/**
 * Monte l'écran de fin dans root.
 * @param {HTMLElement} root conteneur de l'écran.
 * @param {{ code: string, naviguer: Function, moi: object, suivi: object, contenus: object }} ctx contexte (partie.js).
 * @returns {{ maj(etat: object): void, message(msg: object): void, detruire(): void }}
 */
export function creer(root, ctx) {
  const { code, naviguer, moi, suivi, contenus } = ctx;
  const invite = estInvite();
  const J = jeu();
  let fini = false;
  let busy = false;

  root.innerHTML = `
    <div class="plat-fin">
      <nav class="plat-fil" aria-label="Fil d'Ariane" ${invite ? 'hidden' : ''}><a href="${esc(J.page)}">${esc(J.nom)}</a> › <span>Fin de partie</span></nav>
      <div data-zone="entete"></div>
      <div class="plat-fin-grille">
        <section class="card plat-carte" aria-labelledby="plat-fin-classement-titre">
          <h2 id="plat-fin-classement-titre">Classement</h2>
          <div data-zone="classement"></div>
        </section>
        <div class="plat-fin-cote">
          <div data-zone="recompense"></div>
          <div data-zone="recap" class="plat-recap"></div>
        </div>
      </div>
      <div class="plat-fin-chat" data-zone="chat"></div>
      <div class="plat-fin-actions" data-zone="actions"></div>
    </div>`;

  const q = (sel) => root.querySelector(sel);
  const zEntete = q('[data-zone="entete"]');
  const zClassement = q('[data-zone="classement"]');
  const zRecompense = q('[data-zone="recompense"]');
  const zRecap = q('[data-zone="recap"]');
  const zActions = q('[data-zone="actions"]');

  const chat = creerChat(q('[data-zone="chat"]'), { code, moi });

  // ----- Actions -----
  async function rejouer(btn) {
    if (busy) return;
    busy = true;
    btn.disabled = true;
    try {
      const nouveau = await plat.rejouer(code);
      if (nouveau) naviguer(`#partie/${encodeURIComponent(nouveau)}`);
      else toast('La revanche n\'a pas pu être créée.', 'error');
    } catch (e) {
      toast(erreurTexte(e), 'error');
    } finally {
      busy = false;
      btn.disabled = false;
    }
  }
  zActions.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-rejouer]');
    if (b) rejouer(b);
  });

  // ----- Rendus -----
  function rendreEntete(e) {
    const p = e.partie;
    const joueurs = classes(e.joueurs || []);
    const gagnants = joueurs.filter((j) => j.gagne === true || j.rang === 1);
    const annulee = p.statut === 'annulee';
    const titre = annulee ? 'Partie arrêtée' : 'Partie terminée';
    let sous;
    if (annulee) sous = 'La partie a été arrêtée avant la fin.';
    else if (gagnants.length) sous = `${gagnants.map((j) => j.pseudo).join(', ')} ${gagnants.length > 1 ? 'gagnent' : 'gagne'} la partie.`;
    else sous = 'Pas de gagnant désigné.';
    const html = `
      <h1 class="plat-titre display">${esc(titre)}</h1>
      <p class="plat-fin-sous">${esc(sous)}</p>
      <div class="plat-gagnants">${gagnants.map((j) => `<div class="plat-gagnant">${avatarHtml(j, 56)}<span>${pseudoHtml(j)}</span></div>`).join('')}</div>
      <p class="small muted">${esc(p.nom_jeu || J.nom)} · <span class="plat-code">${esc(code)}</span> · ${esc(joueurs.length)} joueurs</p>`;
    zone(zEntete, JSON.stringify([titre, sous, gagnants.map((j) => j.user_id), code]), html);
  }

  function rendreClassement(e) {
    const p = e.partie;
    if (p.statut === 'annulee') { zone(zClassement, 'annulee', '<p class="small muted">Pas de classement : la partie a été arrêtée.</p>'); return; }
    const joueurs = classes(e.joueurs || []);
    if (!joueurs.length) { zone(zClassement, 'vide', '<p class="small muted">Pas encore de classement.</p>'); return; }
    const lignes = joueurs.map((j) => `<tr>
        <th scope="row">${j.rang != null ? esc(j.rang) : '–'}</th>
        <td>${pseudoHtml(j)}</td>
        ${invite ? '' : `<td class="num">${j.invite ? '–' : `+${esc(j.paillettes || 0)}`}</td>`}
      </tr>`).join('');
    const html = `<table class="plat-classement">
        <caption class="visually-hidden">Classement de la partie</caption>
        <thead><tr><th scope="col">Rang</th><th scope="col">Joueur</th>${invite ? '' : '<th scope="col" class="num">Paillettes</th>'}</tr></thead>
        <tbody>${lignes}</tbody>
      </table>`;
    zone(zClassement, JSON.stringify([joueurs.map((j) => [j.user_id, j.rang, j.place, j.pseudo, j.paillettes])]), html);
  }

  function rendreRecompense(e) {
    // Membres seulement : pas de Paillettes ni de badges pour les invités.
    if (invite) { zone(zRecompense, 'invite', ''); return; }
    const mon = (e.joueurs || []).find((j) => j.user_id === e.moi?.user_id);
    if (!mon) { zone(zRecompense, 'spectateur', ''); return; }
    const pailles = Number(mon.paillettes || 0);
    const badges = e.badges || [];
    const lignesBadges = badges.length
      ? `<p>${badges.length > 1 ? 'Badges débloqués' : 'Badge débloqué'} : <strong class="plat-or">${badges.map((b) => esc(b.nom)).join(', ')}</strong></p>`
      : '';
    const html = `
      <section class="card plat-recompense" aria-labelledby="plat-fin-gain-titre">
        <h2 id="plat-fin-gain-titre">Tu gagnes</h2>
        <p>${pailles > 0 ? `${esc(pailles)} Paillette${pailles > 1 ? 's' : ''} gagnée${pailles > 1 ? 's' : ''}.` : 'Aucune Paillette cette fois.'}</p>
        ${lignesBadges}
      </section>`;
    zone(zRecompense, JSON.stringify([pailles, badges.map((b) => b.code)]), html);
  }

  /** Encart propre au jeu (facultatif) : ../jeux/<jeu>/fin.js, export recap(etat, contenus). */
  async function chargerRecap(e) {
    let mod = null;
    try {
      mod = await import(`../jeux/${J.id}/fin.js`);
    } catch {
      return; // pas de fichier de fin pour ce jeu : rien à afficher
    }
    if (fini || typeof mod?.recap !== 'function') return;
    try {
      const html = mod.recap(e, contenus || {});
      zone(zRecap, `recap:${JSON.stringify(e.partie?.version ?? '')}`, html || '');
    } catch (err) {
      console.warn('[plateaux] recap', err);
    }
  }

  function rendreActions(e) {
    const p = e.partie;
    const moiE = e.moi || {};
    const suite = p.suite || null;
    let rejouerHtml = '';
    if (!invite) {
      if (suite) {
        rejouerHtml = `<a class="btn btn-primary" href="#partie/${encodeURIComponent(suite)}">Rejoindre la revanche</a>`;
      } else if (moiE.joue) {
        rejouerHtml = '<button type="button" class="btn btn-primary" data-rejouer>Revanche</button>';
      }
    }
    const accueil = invite ? '' : `<a class="btn btn-ghost" href="${esc(J.page)}">Retour à l'accueil de ${esc(J.nom)}</a>`;
    // Le bouton peut être désactivé pendant une requête : on le reconstruit seulement si la clé change.
    zone(zActions, JSON.stringify([suite, invite, !!moiE.joue]), `${rejouerHtml}${accueil}`);
  }

  function maj(e) {
    if (fini || !e?.partie) return;
    rendreEntete(e);
    rendreClassement(e);
    rendreRecompense(e);
    rendreActions(e);
    chat.maj(e);
    chargerRecap(e);
  }

  maj(suivi.etat());

  return {
    maj,
    message(msg) { if (!fini) chat.message(msg); },
    detruire() {
      fini = true;
      try { chat.detruire(); } catch { /* sans effet */ }
      root.innerHTML = '';
    },
  };
}
