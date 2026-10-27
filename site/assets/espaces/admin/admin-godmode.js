// ===== Humane Gang — administration : confirmation « Refaire le tirage » (le mode sans limite se règle dans la coquille, core/godmode.js) =====
// Ce module ne fait qu'une chose : demander confirmation avant de supprimer les attributions d'une édition Secret Santa
// et de refaire le tirage. Le choix « prévenir les participants par le bot » est renvoyé à l'appelant.
// Utilisé par admin/ss-events.js. Dépendances : core.js (esc, $). Export : confirmRedo.
import { esc, $ } from '../../commun/core.js';

/* ---------- Confirmation « Refaire le tirage » (dialog dédié, avec choix de prévenir les participants) ---------- */
// Dialogue créé une seule fois, puis réutilisé à chaque demande.
let _dlg = null;
/** Construit le dialogue au premier appel (ajouté au body), puis renvoie toujours le même élément. */
function shell() {
  if (_dlg) return _dlg;
  const d = document.createElement('dialog');
  d.className = 'hg-dialog god-redo-dlg';
  d.setAttribute('aria-labelledby', 'redo-title');
  d.setAttribute('aria-describedby', 'redo-body');
  d.innerHTML = `
    <form method="dialog" class="stack">
      <h2 id="redo-title" class="dialog-title"></h2>
      <div id="redo-body" class="stack small"></div>
      <label class="check"><input type="checkbox" name="notify"><span>Prévenir les participants par le bot (nouveau tirage)</span></label>
      <div class="btn-row dialog-actions">
        <button class="btn btn-ghost" value="cancel" type="submit">Annuler</button>
        <button class="btn god-go" value="ok" type="submit" id="redo-ok"></button>
      </div>
    </form>`;
  document.body.append(d);
  _dlg = d;
  return d;
}
/**
 * Demande confirmation avant de supprimer les attributions d'une édition et de refaire le tirage.
 * Résout { ok, notify }.
 */
export function confirmRedo({ year, participants, assignments = null, manual = false }) {
  const d = shell();
  $('#redo-title', d).textContent = `Refaire le tirage ${manual ? 'manuel' : 'au hasard'} · ${year}`;
  $('#redo-body', d).innerHTML = `
    <p>${assignments == null ? 'Toutes les attributions actuelles' : `Les ${esc(assignments)} attributions actuelles`} de l'édition ${esc(year)} seront <strong>supprimées</strong>, puis un nouveau tirage ${manual ? 'avec tes paires' : `au hasard pour ${esc(participants)} participants`} sera enregistré.</p>
    <p class="god-note"><strong>Attention :</strong> les cartes déjà vues par les participants vont changer. Les messages secrets déjà échangés restent liés à l'ancien tirage.</p>
    ${manual ? '' : '<p class="muted">En mode sans limite, le tirage au hasard ignore les exclusions et la cible de l\'an dernier.</p>'}
    <p class="muted">Si le nouveau tirage échoue, l'édition repasse en « tirage non effectué » et tu pourras le relancer.</p>`;
  $('#redo-ok', d).textContent = manual ? 'Supprimer et enregistrer mes paires' : 'Supprimer et refaire le tirage';
  d.querySelector('input[name="notify"]').checked = false;
  d.returnValue = '';
  const opener = document.activeElement;
  d.showModal();
  // Le dialogue se résout à sa fermeture : « ok » si le bouton principal a été cliqué, et la case « prévenir » est lue à ce moment.
  return new Promise((resolve) => d.addEventListener('close', () => {
    resolve({ ok: d.returnValue === 'ok', notify: d.querySelector('input[name="notify"]').checked });
    if (opener?.isConnected) opener.focus?.();
  }, { once: true }));
}
