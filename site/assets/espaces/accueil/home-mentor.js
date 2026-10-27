// ===== Humane Gang — carte « Semaine d'accueil » du parrainage (idée P8, /pages/compte/accueil.html) =====
// Pendant 7 jours, le parrain et son filleul voient sur l'accueil la quête commune : profil complété (avatar),
// premier message du parrain, un échange ou un don de carte entre eux, une réponse « oui » à une sortie.
// Quand les 4 étapes sont faites, chacun réclame sa récompense (RPC hg_mentor_claim : Paillettes plafonnées et
// idempotentes, carte « Parrain » ou « Filleul » si le Staff l'a choisie, badge Parrain). Sans parrainage en cours,
// le bloc reste masqué. Si la semaine passe sans tout finir, la carte disparaît sans reproche.
// RPC : hg_mentor_progress, hg_mentor_claim (migration 091). Exporte : loadMentorBlock(box, ctx), STEP_TEXT.
import { sb, esc, errMsg, toast, avatarHtml } from '../../commun/core.js';

/** Libellé de chaque étape, selon le rôle de la personne qui regarde. */
export const STEP_TEXT = {
  profil: { filleul: 'Ajoute un avatar à ton profil', parrain: (n) => `${n} ajoute un avatar à son profil` },
  message: { filleul: (n) => `${n} t’envoie un premier message`, parrain: (n) => `Envoie un premier message à ${n}` },
  echange: { filleul: (n) => `Fais un échange ou un don de carte avec ${n}`, parrain: (n) => `Fais un échange ou un don de carte avec ${n}` },
  sortie: { filleul: 'Réponds « oui » à une sortie IRL', parrain: (n) => `${n} répond « oui » à une sortie IRL` },
};

/** Qui fait chaque étape (affiché à droite de l'étape). */
const STEP_WHO = { profil: 'mentee', message: 'mentor', echange: 'duo', sortie: 'mentee' };

/** Texte d'une étape. */
function stepText(code, role, other) {
  const t = STEP_TEXT[code]?.[role];
  return typeof t === 'function' ? t(other) : (t || code);
}

/** Jours restants avant la fin de la semaine (au moins 0). */
const daysLeft = (end) => Math.max(0, Math.ceil((new Date(end) - Date.now()) / 864e5));

/**
 * HTML d'un duo (une semaine d'accueil), sur le modèle de la maquette P8.
 * @param {object} d duo renvoyé par hg_mentor_progress
 * @param {number} reward Paillettes de la récompense
 */
function duoHtml(d, reward) {
  const isMentor = d.role === 'parrain';
  const otherId = isMentor ? d.mentee_id : d.mentor_id;
  const other = isMentor ? d.mentee : d.mentor;
  const steps = Array.isArray(d.steps) ? d.steps : [];
  const done = steps.filter((s) => s.done).length;
  const left = steps.length - done;
  const all = steps.length && !left;
  const dl = daysLeft(d.ends_at);
  const mentee = { id: d.mentee_id, pseudo: d.mentee, avatar_url: d.mentee_avatar, color: d.mentee_color };
  const mentor = { id: d.mentor_id, pseudo: d.mentor, avatar_url: d.mentor_avatar, color: d.mentor_color };
  const who = (c) => (STEP_WHO[c] === 'duo' ? 'à deux' : STEP_WHO[c] === 'mentor' ? d.mentor : d.mentee);
  const prize = [d.carte ? `carte « ${isMentor ? 'Parrain' : 'Filleul'} »` : '', reward ? `${reward} Paillettes` : ''].filter(Boolean).join(' + ');
  const exchangeTodo = steps.some((s) => s.code === 'echange' && !s.done);
  return `
    <div class="mt-duo" data-mentee="${esc(d.mentee_id)}">
      <div class="mt-top">
        <span class="mt-kicker">Semaine d’accueil</span>
        <span class="pill pill-todo">${d.claimed ? 'terminée' : dl > 1 ? `encore ${dl} jours` : dl === 1 ? 'dernier jour' : 'dernières heures'}</span>
      </div>
      <div class="mt-duo-head">
        <span class="mt-avs" aria-hidden="true">${avatarHtml(mentee, 36)}${avatarHtml(mentor, 36)}</span>
        <p><strong>${esc(d.mentee)}</strong> et ${isMentor ? 'toi, son parrain' : `ton parrain <strong>${esc(d.mentor)}</strong>`}</p>
      </div>
      <div class="progress mt-bar" role="progressbar" aria-label="Semaine d’accueil" aria-valuemin="0" aria-valuemax="${steps.length}" aria-valuenow="${done}"><span style="width:${Math.round((done / Math.max(1, steps.length)) * 100)}%"></span></div>
      <ul class="mt-steps">${steps.map((s) => `
        <li class="mt-step${s.done ? ' is-done' : ''}">
          <span class="mt-check" aria-hidden="true">${s.done ? '✓' : ''}</span>
          <span class="mt-step-txt">${esc(stepText(s.code, d.role, other))}<span class="visually-hidden">${s.done ? ' : fait' : ' : à faire'}</span></span>
          <span class="small muted mt-who">${esc(who(s.code))}</span>
        </li>`).join('')}</ul>
      <div class="mt-foot">
        ${prize ? `<p class="small">Récompense pour chacun : ${esc(prize)}</p>` : ''}
        ${d.claimed ? '<span class="pill pill-ok">Récompense reçue, merci !</span>'
          : all ? `<button class="btn btn-sand" type="button" data-claim="${esc(d.mentee_id)}">Réclamer ma récompense</button>`
            : `<span class="small muted">${left} étape${left > 1 ? 's' : ''} restante${left > 1 ? 's' : ''}</span>`}
      </div>
      ${!d.claimed && exchangeTodo ? `<a class="btn btn-sand mt-cta" href="/pages/cartes/cartes.html#collection/${encodeURIComponent(otherId)}">Proposer un échange à ${esc(other)}</a>` : ''}
      <p class="small muted mt-note">Si la semaine passe sans tout finir, la carte disparaît sans reproche.</p>
    </div>`;
}

/**
 * Charge et affiche les semaines d'accueil en cours. Le bloc (ctx.el) reste masqué s'il n'y en a pas.
 * @param {HTMLElement} box corps du bloc
 * @param {{el: HTMLElement}} ctx bloc complet (pour l'afficher)
 */
export async function loadMentorBlock(box, { el }) {
  try {
    const { data, error } = await sb.rpc('hg_mentor_progress');
    if (error) throw error;
    const duos = Array.isArray(data?.duos) ? data.duos.filter((d) => !d.expired || d.claimed) : [];
    if (!data?.actif || !duos.length) { el.hidden = true; return; }
    box.innerHTML = duos.map((d) => duoHtml(d, Number(data.paillettes) || 0)).join('');
    el.hidden = false;
    box.querySelectorAll('[data-claim]').forEach((b) => b.addEventListener('click', async () => {
      b.disabled = true;
      const { data: r, error: err } = await sb.rpc('hg_mentor_claim', { p_mentee: b.dataset.claim });
      if (err) { toast(errMsg(err), 'error'); b.disabled = false; return; }
      const parts = [];
      if (Number(r?.paillettes)) parts.push(`+${r.paillettes} Paillettes`);
      if (r?.carte) parts.push(`une carte « ${r.role === 'parrain' ? 'Parrain' : 'Filleul'} »`);
      toast(parts.length ? `Semaine d’accueil réussie : ${parts.join(' et ')} !` : 'Semaine d’accueil réussie !', 'ok');
      loadMentorBlock(box, { el });
    }));
  } catch (e) { console.warn('[parrainage]', e?.message || e); el.hidden = true; }
}
