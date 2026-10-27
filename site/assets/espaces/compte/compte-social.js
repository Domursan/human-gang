// ===== Humane Gang — carte « Entraide et liens » du compte (idées P6, P7, P8 ; /pages/compte/compte.html) =====
// Une carte de la page Mon compte : compétences (P7, skills.js), « Je veux bien parrainer » (P8) et
// « Ne pas afficher nos souvenirs communs » (P6). Les deux cases s'enregistrent dès qu'on les coche.
// Colonnes : hg_profiles.mentor_volunteer et hg_profiles.hide_friendship (migration 091), table hg_member_skills.
// Exporte : mountSocialCard(el, me).
import { sb, toast, errMsg } from '../../commun/core.js';
import { mountSkillEditor } from './skills.js';

/**
 * Monte la carte dans el (masqué au départ).
 * @param {HTMLElement} el conteneur
 * @param {object} me profil du membre connecté (hg_profiles)
 */
export function mountSocialCard(el, me) {
  if (!el || !me) return;
  el.innerHTML = `
    <section class="card stack acc-social" id="entraide" aria-labelledby="entraide-title">
      <h2 class="card-title" id="entraide-title">Entraide et liens</h2>
      <div class="stack">
        <h3 class="acc-social-sub">Je peux aider pour…</h3>
        <p class="small muted">Visible par le gang sur ta fiche et dans l’annuaire. C’est volontaire : personne ne te doit rien, tu ne dois rien à personne.</p>
        <div id="sk-editor"><p class="small muted">Chargement…</p></div>
      </div>
      <div class="stack acc-social-opts">
        <label class="check"><input type="checkbox" id="pf-mentor"${me.mentor_volunteer ? ' checked' : ''}> <span>Je veux bien parrainer un nouveau pendant sa première semaine (le Staff te le proposera)</span></label>
        <label class="check"><input type="checkbox" id="pf-hide-friend"${me.hide_friendship ? ' checked' : ''}> <span>Ne pas afficher nos souvenirs communs (« Toi et … ») sur ma fiche ni sur celle des autres</span></label>
      </div>
    </section>`;
  el.hidden = false;
  mountSkillEditor(el.querySelector('#sk-editor'), me);
  for (const [id, col] of [['pf-mentor', 'mentor_volunteer'], ['pf-hide-friend', 'hide_friendship']]) {
    const box = el.querySelector(`#${id}`);
    box.addEventListener('change', async () => {
      box.disabled = true;
      const { error } = await sb.from('hg_profiles').update({ [col]: box.checked }).eq('id', me.id);
      box.disabled = false;
      if (error) { box.checked = !box.checked; toast(`Enregistrement impossible : ${errMsg(error)}`, 'error'); return; }
      me[col] = box.checked;
      toast('Préférence enregistrée.', 'ok');
    });
  }
}
