// Admin : section Secret Santa (en-tête, édition, tirage, carte de base, inscrits, exclusions, attributions).
import { esc, $, fmtDateTime, isGodMode, godTag } from '../core.js';
import { S, pseudoOf, STATUS, STATUS_LABEL } from './state.js';
import { ICON } from './common.js';
import { sharedFieldsHtml, pairsBlockHtml } from '../admin-accounts.js';

/* =========================================================
   Secret Santa
   ========================================================= */
export function renderSS() {
  const root = $('#ss-root');
  const ed = S.editions.find((e) => e.id === S.editionId);
  const nextYear = Math.max(new Date().getFullYear(), ...(S.editions.map((e) => e.year + 1)));
  const yearExists = (y) => S.editions.some((e) => e.year === y);
  const defaultYear = yearExists(new Date().getFullYear()) ? nextYear : new Date().getFullYear();

  const god = isGodMode();
  const openEd = S.editions.find((e) => e.status !== 'termine'); // une seule édition en cours à la fois (trigger en base, levé en mode sans limite)
  const locked = openEd && !god;
  const createForm = `
    <form class="card stack" id="ss-create"${openEd ? ' aria-describedby="ssc-locked"' : ''}>
      <h3 class="card-title">Nouvelle édition</h3>
      ${locked ? `<p class="ss-locked small" id="ssc-locked" role="note">Termine l'édition ${esc(openEd.year)} avant d'en créer une nouvelle (statut actuel : ${esc(STATUS_LABEL[openEd.status] ?? openEd.status)}).</p>` : ''}
      ${openEd && god ? `<p class="god-note" id="ssc-locked" role="note"><strong>Mode sans limite :</strong> l'édition ${esc(openEd.year)} n'est pas terminée (${esc(STATUS_LABEL[openEd.status] ?? openEd.status)}), tu peux quand même en créer une nouvelle. La page Secret Santa des membres affichera la plus récente.</p>` : ''}
      <fieldset class="ss-create-fields"${locked ? ' disabled' : ''}>
      <div class="grid-2">
        <div class="field"><label for="ssc-year">Année</label><input id="ssc-year" name="year" type="number" min="2020" max="2100" required value="${defaultYear}"></div>
        <div class="field"><label for="ssc-budget">Budget</label><input id="ssc-budget" name="budget" maxlength="60" placeholder="ex. 20 à 30 CHF"></div>
        <div class="field"><label for="ssc-send">Date limite d'envoi</label><input id="ssc-send" name="send_deadline" type="date"></div>
        <div class="field"><label for="ssc-exch">Date d'échange</label><input id="ssc-exch" name="exchange_date" type="date"></div>
      </div>
      ${sharedFieldsHtml('ssc', [])}
      <div class="btn-row"><button class="btn btn-primary" type="submit">Créer l'édition${openEd ? godTag() : ''}</button></div>
      </fieldset>
    </form>`;

  if (!ed) {
    root.innerHTML = `<div class="empty" style="margin-bottom:20px">Aucune édition pour l'instant. Crée la première ci-dessous.</div>${createForm}`;
    return;
  }

  const parts = [...S.participants].sort((a, b) => pseudoOf(a.user_id).localeCompare(pseudoOf(b.user_id), 'fr'));
  const sent = parts.filter((p) => p.sent_at).length;
  const received = parts.filter((p) => p.received_at).length;
  const partOpts = parts.map((p) => `<option value="${esc(p.user_id)}">${esc(pseudoOf(p.user_id))}</option>`).join('');
  const minDraw = god ? 1 : 3; // mode sans limite : dès 1 participant (il s'offre alors à lui-même)
  const canDraw = parts.length >= minDraw && !ed.drawn_at; // un seul tirage par édition (sauf « Refaire » en mode sans limite)
  const editionSelect = S.editions.length > 1 ? `
      <div class="field"><label for="ss-edition">Édition affichée</label>
        <select id="ss-edition">${S.editions.map((e) => `<option value="${esc(e.id)}"${e.id === ed.id ? ' selected' : ''}>${esc(e.year)} · ${esc(STATUS_LABEL[e.status] ?? e.status)}</option>`).join('')}</select></div>` : '';

  root.innerHTML = `
    <div class="ss-head" style="margin-bottom:20px">
      <div class="steps-mini" aria-label="Étapes">${STATUS.map(([k, l]) => {
        const idx = STATUS.findIndex(([s]) => s === ed.status), i = STATUS.findIndex(([s]) => s === k);
        return `<span class="pill ${i < idx ? 'pill-ok' : i === idx ? 'pill-current' : 'pill-todo'}">${esc(l)}</span>`;
      }).join('')}</div>
      ${editionSelect}
    </div>
    <div class="ss-layout">
      <form class="card card-ss stack" id="ss-edit">
        <h3 class="card-title">Édition ${esc(ed.year)}</h3>
        <div class="grid-2">
          <div class="field"><label for="sse-status">Statut${godTag()}</label>
            <select id="sse-status" name="status">${STATUS.map(([k, l]) => `<option value="${k}"${k === ed.status ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
          <div class="field"><label for="sse-budget">Budget</label><input id="sse-budget" name="budget" maxlength="60" value="${esc(ed.budget ?? '')}"></div>
          <div class="field"><label for="sse-send">Date limite d'envoi</label><input id="sse-send" name="send_deadline" type="date" value="${esc(ed.send_deadline ?? '')}"></div>
          <div class="field"><label for="sse-exch">Date d'échange</label><input id="sse-exch" name="exchange_date" type="date" value="${esc(ed.exchange_date ?? '')}"></div>
        </div>
        ${sharedFieldsHtml('sse', ed.shared_fields ?? [])}
        <p class="small muted">${ed.drawn_at ? `Tirage effectué le ${esc(fmtDateTime(ed.drawn_at))}.` : 'Tirage pas encore effectué.'} Le tirage passe automatiquement l'édition en « Envoi des cadeaux ».</p>
        <div class="btn-row"><button class="btn btn-primary" type="submit">Enregistrer</button></div>

        <div class="draw-box stack">
          <h4 class="sub-title">Tirage au sort</h4>
          <p class="small muted">${god
            ? 'Mode sans limite : le tirage au hasard ignore les exclusions et la cible de l\'an dernier, et peut être refait. Les paires restent secrètes : tu peux les afficher plus bas si besoin.'
            : 'Respecte les exclusions et évite de retomber sur la même personne que l\'an dernier. Les paires restent secrètes : tu peux les afficher plus bas si besoin. Le tirage ne peut être lancé qu\'une seule fois par édition.'}</p>
          <div class="btn-row"><button class="btn btn-sand" type="button" id="ss-draw"${canDraw ? '' : ' disabled'}>${ed.drawn_at ? 'Tirage effectué' : `Lancer le tirage${god ? godTag() : ''}`}</button>
            ${ed.drawn_at ? '' : `<button class="btn btn-ghost" type="button" id="ss-draw-manual"${parts.length >= (god ? 1 : 2) ? '' : ' disabled'} aria-haspopup="dialog">Tirage manuel</button>`}</div>
          ${ed.drawn_at ? '' : '<p class="small muted">« Lancer le tirage » choisit au hasard. « Tirage manuel » te laisse fixer chaque paire toi-même (et compléter le reste au hasard).</p>'}
          ${ed.drawn_at ? `<p class="small muted">Tirage fait le ${esc(fmtDateTime(ed.drawn_at))} pour ${parts.length} participants.</p>` : parts.length < minDraw ? `<p class="small muted">Il faut au moins ${minDraw} inscrits${god ? godTag() : ''}.</p>` : ''}
          ${god && ed.drawn_at ? `<div class="draw-redo stack">
            <div class="btn-row">
              <button class="btn btn-sand" type="button" id="ss-redraw"${parts.length >= (god ? 1 : 2) ? '' : ' disabled'} aria-haspopup="dialog">Refaire le tirage (auto)${godTag()}</button>
              <button class="btn btn-ghost" type="button" id="ss-redraw-manual"${parts.length >= (god ? 1 : 2) ? '' : ' disabled'} aria-haspopup="dialog">Refaire le tirage (manuel)${godTag()}</button>
            </div>
            <p class="small muted">Supprime les attributions actuelles puis relance un tirage. Les cartes déjà vues par les participants changeront.</p>
          </div>` : ''}
          ${S.lastDraw && S.lastDraw.edition === ed.id ? `<p class="draw-result" role="status">Tirage OK pour ${esc(S.lastDraw.n)} participants</p>` : ''}
        </div>
      </form>

      <div class="stack" style="gap:20px">
        <div class="card stack">
          <h3 class="card-title">Carte de base</h3>
          <p class="small muted">Image de fond de la carte que chaque Santa découvre (le pseudo de sa cible est ajouté dessus). Format paysage conseillé, 1500 × 1000 px.</p>
          <div class="card-preview">${ed.card_base_url ? `<img src="${esc(ed.card_base_url)}" alt="Carte de base ${esc(ed.year)}">` : 'Carte par défaut'}</div>
          <div class="btn-row">
            <button class="btn btn-ghost" type="button" id="ss-card-upload">${ICON.upload} ${ed.card_base_url ? 'Remplacer' : 'Téléverser'}</button>
            ${ed.card_base_url ? '<button class="btn btn-danger" type="button" id="ss-card-reset">Revenir à la carte par défaut</button>' : ''}
          </div>
          <input type="file" id="ss-card-file" accept="image/png,image/jpeg,image/webp" hidden>
        </div>

        <div class="card stack">
          <h3 class="card-title">Inscrits <span class="muted">(${parts.length})</span></h3>
          ${parts.length ? `<div class="participants">${parts.map((p) => `<span class="pill">${esc(pseudoOf(p.user_id))}</span>`).join('')}</div>
            ${ed.drawn_at ? `<p class="small muted">Cadeaux envoyés : ${sent} / ${parts.length} · reçus : ${received} / ${parts.length}</p>` : ''}`
            : '<div class="empty">Personne n\'est encore inscrit.</div>'}
        </div>
      </div>

      <div class="card stack">
        <h3 class="card-title">Exclusions</h3>
        <p class="small muted">Deux personnes d'une même paire ne pourront pas se tirer l'une l'autre (couples, colocs…).</p>
        ${parts.length >= 2 ? `
        <form class="inline-form" id="ss-excl-form">
          <div class="field"><label for="ex-a">Personne A</label><select id="ex-a" required>${partOpts}</select></div>
          <div class="field"><label for="ex-b">Personne B</label><select id="ex-b" required>${partOpts}</select></div>
          <button class="btn btn-primary" type="submit">Ajouter</button>
        </form>` : '<p class="small muted">Il faut au moins deux inscrits pour définir une exclusion.</p>'}
        <div>${S.exclusions.length ? S.exclusions.map((x) => `
          <div class="list-row">
            <div class="pair grow"><strong>${esc(pseudoOf(x.user_a))}</strong>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17"/></svg>
              <strong>${esc(pseudoOf(x.user_b))}</strong></div>
            <button class="btn btn-danger btn-sm btn-icon" type="button" data-del-excl="${esc(x.user_a)}|${esc(x.user_b)}" aria-label="Retirer l'exclusion ${esc(pseudoOf(x.user_a))} et ${esc(pseudoOf(x.user_b))}">${ICON.x}</button>
          </div>`).join('') : '<p class="small muted">Aucune exclusion.</p>'}</div>
      </div>

      ${pairsBlockHtml(ed)}
      ${createForm}
      <div class="card stack ss-danger">
        <h3 class="card-title">Supprimer l'édition ${esc(ed.year)}</h3>
        <p class="small muted">Efface l'édition avec ses inscrits (${parts.length}), ses exclusions (${S.exclusions.length}), son tirage, ses vœux et ses conversations. Action définitive : le détail exact est affiché avant confirmation.</p>
        <div class="btn-row"><button class="btn btn-danger" type="button" id="ss-delete">Supprimer l'édition</button></div>
      </div>
    </div>`;
  const b = $('#ex-b'); if (b && b.options.length > 1) b.selectedIndex = 1;
}
