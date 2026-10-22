// =====================================================================
// Comptes admin : onglet « Secret Santa » d'une fiche (inscription, dates, attributions, liste de souhaits).
// L'admin peut inscrire ou désinscrire un membre, saisir ses dates, et modifier sa cible et son Santa.
// Dépendances : core.js (sb, toast, esc, fmtDateTime, isGodMode), ui-confirm.js (confirmBox),
// common.js (IC, check, tabError, toLocalInput), state.js (A, SS_STATUS, pseudoOf, dropFicheCache).
// Tables : hg_ss_participants, hg_ss_assignments (giver_id -> receiver_id), hg_ss_wishes.
// Exporte : ssHtml, curEdition, ssJoin, ssLeave, setPair, clearPair.
// =====================================================================
import { sb, toast, esc, fmtDateTime, isGodMode } from '../core.js';
import { confirmBox } from '../ui-confirm.js';
import { IC, check, tabError, toLocalInput } from './common.js';
import { A, SS_STATUS, pseudoOf, dropFicheCache } from './state.js';

/* ---------- Secret Santa ---------- */
/** HTML de l'onglet Secret Santa : choix de l'édition, inscription, dates, cible / Santa et souhaits. */
export function ssHtml() {
  const d = A.d;
  if (d.editions.error) return tabError(d.editions);
  const eds = d.editions.data ?? [];
  if (!eds.length) return '<div class="empty">Aucune édition de Secret Santa pour l\'instant.</div>';
  const ed = eds.find((e) => e.id === A.ssEdition) || eds[0];
  /* Participants de l'édition affichée. */
  const parts = (d.parts.data ?? []).filter((p) => p.edition_id === ed.id);
  const mine = parts.find((p) => p.user_id === A.uid);
  /* Souhaits de l'édition affichée. */
  const wishes = (d.wishes.data ?? []).filter((w) => w.edition_id === ed.id);
  /* Attributions de l'édition affichée. */
  const assigns = (d.assigns.data ?? []).filter((a) => a.edition_id === ed.id);
  // Cible (à qui il offre) et Santa (qui lui offre), retrouvés dans les attributions.
  const target = assigns.find((a) => a.giver_id === A.uid)?.receiver_id ?? '';
  const santa = assigns.find((a) => a.receiver_id === A.uid)?.giver_id ?? '';
  // Autres participants (hors le membre), triés par pseudo pour les menus de choix.
  const others = parts.filter((p) => p.user_id !== A.uid).map((p) => ({ id: p.user_id, pseudo: pseudoOf(p.user_id) }))
    .sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  /* Options du menu « cible » ou « Santa » : « Aucun·e » puis les autres participants, la valeur sel étant présélectionnée. */
  const opts = (sel) => `<option value="">Aucun·e</option>${others.map((o) => `<option value="${esc(o.id)}"${o.id === sel ? ' selected' : ''}>${esc(o.pseudo)}</option>`).join('')}`;
  const drawn = !!ed.drawn_at || assigns.length > 0;
  const pseudo = d.profile.pseudo;

  return `
    <div class="acc-ss-head">
      ${eds.length > 1 ? `<div class="field"><label for="acc-ss-ed">Édition</label>
        <select id="acc-ss-ed" data-ss-edition>${eds.map((e) => `<option value="${esc(e.id)}"${e.id === ed.id ? ' selected' : ''}>${esc(e.year)} · ${esc(SS_STATUS[e.status] ?? e.status)}</option>`).join('')}</select></div>`
        : `<p class="small muted">Édition ${esc(ed.year)} · ${esc(SS_STATUS[ed.status] ?? ed.status)}</p>`}
    </div>

    <div class="acc-ss-grid">
      <div class="acc-box stack">
        <h4 class="sub-title">Participation</h4>
        <p class="small muted">${mine ? `Inscrit·e le ${esc(fmtDateTime(mine.joined_at))}.` : `${esc(pseudo)} ne participe pas à cette édition.`}</p>
        <div class="btn-row">${mine
          ? `<button class="btn btn-danger btn-sm" type="button" data-act="ss-leave">Désinscrire</button>`
          : `<button class="btn btn-primary btn-sm" type="button" data-act="ss-join">Inscrire à l'édition ${esc(ed.year)}</button>`}</div>
        ${mine ? `
        <form class="stack" data-form="ss-dates">
          <div class="grid-2">
            <div class="field"><label for="as-sent">Cadeau envoyé le</label><input id="as-sent" name="sent_at" type="datetime-local" value="${esc(toLocalInput(mine.sent_at))}"></div>
            <div class="field"><label for="as-rec">Cadeau reçu le</label><input id="as-rec" name="received_at" type="datetime-local" value="${esc(toLocalInput(mine.received_at))}"></div>
          </div>
          <p class="small muted">Laisse un champ vide pour remettre « pas encore ». Aucune notification n'est envoyée.</p>
          <div class="btn-row"><button class="btn btn-primary btn-sm" type="submit">Enregistrer les dates</button></div>
        </form>` : ''}
      </div>

      <div class="acc-box stack">
        <h4 class="sub-title">Attribution</h4>
        ${!drawn ? '<p class="small muted">Le tirage n\'a pas encore été fait pour cette édition.</p>' : !A.showPair ? `
          <p class="small muted">Masqué pour éviter de te gâcher la surprise si tu participes.</p>
          <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-act="show-pair">${IC.eye} Afficher sa cible et son Santa</button></div>` : `
          <form class="acc-pair-form" data-form="pair-target">
            <div class="field"><label for="as-target">${esc(pseudo)} offre à</label><select id="as-target" name="who"${mine ? '' : ' disabled'}>${opts(target)}</select></div>
            <button class="btn btn-primary btn-sm" type="submit"${mine ? '' : ' disabled'}>Enregistrer</button>
          </form>
          <form class="acc-pair-form" data-form="pair-santa">
            <div class="field"><label for="as-santa">${esc(pseudo)} reçoit de (son Santa)</label><select id="as-santa" name="who"${mine ? '' : ' disabled'}>${opts(santa)}</select></div>
            <button class="btn btn-primary btn-sm" type="submit"${mine ? '' : ' disabled'}>Enregistrer</button>
          </form>
          <p class="small muted">Si la personne choisie est déjà prise, tu pourras échanger les deux attributions : une personne n'a jamais deux Santas.</p>
          <div class="btn-row"><button class="btn btn-ghost btn-sm" type="button" data-act="hide-pair">${IC.eyeOff} Masquer</button></div>`}
      </div>
    </div>

    <div class="acc-box stack">
      <h4 class="sub-title">Liste de souhaits (${wishes.length})</h4>
      ${d.wishes.error ? tabError(d.wishes) : wishes.length ? `<ul class="acc-wishes">${wishes.map((w) => `
        <li><form class="acc-wish" data-form="wish-edit" data-id="${esc(w.id)}">
          <div class="field"><label for="aw-l-${esc(w.id)}" class="visually-hidden">Souhait</label><input id="aw-l-${esc(w.id)}" name="label" maxlength="200" required value="${esc(w.label)}"></div>
          <div class="field"><label for="aw-u-${esc(w.id)}" class="visually-hidden">Lien</label><input id="aw-u-${esc(w.id)}" name="url" type="url" inputmode="url" maxlength="2000" placeholder="Lien (facultatif)" value="${esc(w.url ?? '')}"></div>
          <div class="acc-wish-actions">
            <button class="btn btn-ghost btn-sm" type="submit">Enregistrer</button>
            <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-wish="${esc(w.id)}" aria-label="Supprimer « ${esc(w.label)} »">${IC.trash}</button>
          </div>
        </form></li>`).join('')}</ul>` : '<p class="small muted">Liste vide.</p>'}
      <form class="acc-wish acc-wish-new" data-form="wish-add">
        <div class="field"><label for="aw-new-l">Nouveau souhait</label><input id="aw-new-l" name="label" maxlength="200" required autocomplete="off"></div>
        <div class="field"><label for="aw-new-u">Lien (facultatif)</label><input id="aw-new-u" name="url" type="url" inputmode="url" maxlength="2000" autocomplete="off" placeholder="https://…"></div>
        <div class="acc-wish-actions"><button class="btn btn-primary btn-sm" type="submit">Ajouter</button></div>
      </form>
    </div>`;
}
/** Édition affichée dans l'onglet (celle choisie, sinon la première). */
export const curEdition = () => (A.d.editions.data ?? []).find((e) => e.id === A.ssEdition) || A.d.editions.data?.[0];

/** Inscrit le membre à l'édition affichée. Prévient si le tirage est déjà fait (il faudra lui attribuer une cible). */
export async function ssJoin() {
  const ed = curEdition();
  check(await sb.from('hg_ss_participants').insert({ edition_id: ed.id, user_id: A.uid }));
  dropFicheCache();
  toast(`${A.d.profile.pseudo} est inscrit·e à l'édition ${ed.year}`, 'ok');
  if (ed.drawn_at) toast('Le tirage est déjà fait : pense à lui attribuer une cible et un Santa.', 'error');
}
/**
 * Désinscrit le membre de l'édition affichée après confirmation.
 * Si le tirage est fait, ses attributions sont supprimées aussi (la base les retire avec lui).
 * @returns {Promise<boolean>} true si la désinscription a eu lieu, false si annulée.
 */
export async function ssLeave() {
  const ed = curEdition();
  /* Attributions de l'édition affichée. */
  const assigns = (A.d.assigns.data ?? []).filter((a) => a.edition_id === ed.id && (a.giver_id === A.uid || a.receiver_id === A.uid));
  const ok = await confirmBox(`Désinscrire ${A.d.profile.pseudo} ?`,
    assigns.length ? 'Le tirage est fait : ses attributions (sa cible et son Santa) seront aussi supprimées. Pense à réattribuer les personnes concernées.' : 'Sa liste de souhaits est conservée.',
    { ok: 'Désinscrire', danger: true });
  if (!ok) return false;
  if (assigns.length) check(await sb.from('hg_ss_assignments').delete().eq('edition_id', ed.id).or(`giver_id.eq.${A.uid},receiver_id.eq.${A.uid}`));
  check(await sb.from('hg_ss_participants').delete().eq('edition_id', ed.id).eq('user_id', A.uid));
  dropFicheCache();
  toast('Désinscription enregistrée', 'ok');
  return true;
}

/**
 * Fixe « giver offre à receiver » pour une édition, sans jamais créer de doublon de receveur
 * (contrainte unique edition_id + receiver_id). Si receiver a déjà un Santa et giver une cible, propose d'échanger.
 * Renvoie false si annulé.
 */
export async function setPair(editionId, giver, receiver) {
  if (giver === receiver && !isGodMode()) throw new Error('Une personne ne peut pas s\'offrir un cadeau à elle-même.');
  /* Attributions de l'édition concernée. */
  const rows = (A.d.assigns.data ?? []).filter((a) => a.edition_id === editionId);
  const mineRow = rows.find((a) => a.giver_id === giver);
  const taken = rows.find((a) => a.receiver_id === receiver);
  if (mineRow && mineRow.receiver_id === receiver) { toast('Rien à changer', 'ok'); return false; }
  const inserts = [{ edition_id: editionId, giver_id: giver, receiver_id: receiver }];
  const deletes = new Set([giver]);
  if (taken) {
    const g0 = taken.giver_id;
    deletes.add(g0);
    if (mineRow) {
      if (g0 === mineRow.receiver_id) throw new Error(`Échange impossible : ${pseudoOf(g0)} se retrouverait à s'offrir son propre cadeau.`);
      const ok = await confirmBox('Échanger les attributions ?',
        `${pseudoOf(receiver)} est déjà la cible de ${pseudoOf(g0)}.\nAprès l'échange :\n· ${pseudoOf(giver)} offre à ${pseudoOf(receiver)}\n· ${pseudoOf(g0)} offre à ${pseudoOf(mineRow.receiver_id)}`,
        { ok: 'Échanger' });
      if (!ok) return false;
      inserts.push({ edition_id: editionId, giver_id: g0, receiver_id: mineRow.receiver_id });
    } else {
      const ok = await confirmBox('Réattribuer ?',
        `${pseudoOf(receiver)} est déjà la cible de ${pseudoOf(g0)}. ${pseudoOf(g0)} n'aura plus de cible et il faudra lui en attribuer une.`,
        { ok: 'Réattribuer', danger: true });
      if (!ok) return false;
    }
  }
  // Attributions touchées par la modification : on les garde pour pouvoir les remettre si l'insertion échoue.
  const before = rows.filter((a) => deletes.has(a.giver_id));
  check(await sb.from('hg_ss_assignments').delete().eq('edition_id', editionId).in('giver_id', [...deletes]));
  const res = await sb.from('hg_ss_assignments').insert(inserts);
  if (res.error) {
    if (before.length) await sb.from('hg_ss_assignments').insert(before); // remise en l'état
    throw res.error;
  }
  dropFicheCache();
  return true;
}
/**
 * Supprime l'attribution où le membre est donneur (col = 'giver_id') ou receveur (col = 'receiver_id').
 * @param {string} editionId identifiant de l'édition.
 * @param {'giver_id'|'receiver_id'} col colonne où se trouve le membre.
 * @returns {Promise<boolean>} true si supprimée, false si annulé ou aucune attribution.
 */
export async function clearPair(editionId, col) {
  /* Attribution où le membre apparaît dans la colonne demandée. */
  const row = (A.d.assigns.data ?? []).find((a) => a.edition_id === editionId && a[col] === A.uid);
  if (!row) { toast('Rien à changer', 'ok'); return false; }
  const other = col === 'giver_id' ? row.receiver_id : row.giver_id;
  const ok = await confirmBox('Supprimer cette attribution ?',
    col === 'giver_id' ? `${A.d.profile.pseudo} n'offrira plus à ${pseudoOf(other)}.` : `${pseudoOf(other)} ne sera plus le Santa de ${A.d.profile.pseudo}.`,
    { ok: 'Supprimer', danger: true });
  if (!ok) return false;
  check(await sb.from('hg_ss_assignments').delete().eq('edition_id', editionId).eq('giver_id', row.giver_id));
  dropFicheCache();
  return true;
}
