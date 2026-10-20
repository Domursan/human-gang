// ===== Humane Gang — administration : carte « Mode sans limite » + confirmation « Refaire le tirage » =====
import { esc, $, getGodMode, openGodDialog, disableGodMode, GOD_LIFTS } from './core.js';

const ICON_BOLT = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13 2 4 14h7l-1 8 9-12h-7z"/></svg>';

function left(until) {
  const s = Math.max(0, Math.ceil((until.getTime() - Date.now()) / 1000));
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

/** Carte en haut de la page admin : état, explication de ce qui est levé, bouton Activer… / Désactiver. */
export function mountGodCard(root) {
  if (!root) return;
  const render = () => {
    const { on, until } = getGodMode();
    const end = until ? new Intl.DateTimeFormat('fr-CH', { hour: '2-digit', minute: '2-digit' }).format(until) : '';
    root.innerHTML = `
      <section class="card god-card${on ? ' is-on' : ''}" aria-labelledby="god-card-t">
        <div class="god-card-head">
          <span class="god-card-ico">${ICON_BOLT}</span>
          <div class="god-card-txt">
            <h2 id="god-card-t" class="god-card-title">Mode sans limite</h2>
            <p class="god-card-state">${on
              ? `<strong>Actif</strong>${until ? ` · expire dans <time data-god-left datetime="${esc(until.toISOString())}">${esc(left(until))}</time> (à ${esc(end)})` : ''}. Les garde-fous ci-dessous sont levés pour toi.`
              : 'Désactivé : tous les garde-fous sont en place. Pour tester ou corriger une situation bloquée, active-le pour une durée limitée.'}</p>
          </div>
          <div class="god-card-act">${on
            ? '<button class="btn btn-danger" type="button" data-god-off>Désactiver</button>'
            : '<button class="btn god-card-on" type="button" data-god-on aria-haspopup="dialog">Activer…</button>'}</div>
        </div>
        <details class="god-card-more"${on ? ' open' : ''}>
          <summary>Ce que le mode lève</summary>
          <ul class="god-lifts">${GOD_LIFTS.map(([k, v]) => `<li><strong>${esc(k)} :</strong> ${esc(v)}</li>`).join('')}</ul>
          <p class="small muted">Restent actifs : sécurité et confidentialité, longueurs maximales, doublons, personne ne s'offre un cadeau à soi-même. Le mode se coupe tout seul à la fin de la durée choisie.</p>
        </details>
      </section>`;
  };
  root.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-god-on')) openGodDialog(e);
    if (b.hasAttribute('data-god-off')) disableGodMode(b);
  });
  window.addEventListener('hg:godmode', () => {
    const hadFocus = root.contains(document.activeElement);
    render();
    if (hadFocus) $('button', root)?.focus();
  });
  render();
}

/* ---------- Confirmation « Refaire le tirage » (dialog dédié, avec choix de prévenir les participants) ---------- */
let _dlg = null;
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
  return new Promise((resolve) => d.addEventListener('close', () => {
    resolve({ ok: d.returnValue === 'ok', notify: d.querySelector('input[name="notify"]').checked });
    if (opener?.isConnected) opener.focus?.();
  }, { once: true }));
}
