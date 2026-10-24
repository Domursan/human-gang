// ===== Humane Gang — administration : Sutom du gang (J8, route jeux/sutom) =====
// Rôle : le Staff « souvenirs » gère la banque de mots (5 à 9 lettres, définition « à la sauce du gang »), programme le
// mot d'un jour à venir, et voit les mots déjà fixés. Sans programmation, le mot du jour est tiré dans la banque
// (jamais servi d'abord). Attention : cette page montre le mot du jour (ne pas l'ouvrir avant d'avoir joué).
// RPC : hg_sutom_admin, hg_sutom_bank_save, hg_sutom_program (migration 084). Actions journalisées côté serveur.
// Dépendances : core.js (sb, toast, esc, errMsg).
// Exporte : mountSutomSection(container).
import { sb, toast, esc, errMsg } from './core.js';

const JOUR = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/**
 * Monte la section.
 * @param {HTMLElement} root Conteneur.
 */
export async function mountSutomSection(root) {
  if (!root) return;
  const S = { d: null, voir: false };

  async function charge() {
    const { data, error } = await sb.rpc('hg_sutom_admin');
    if (error) throw error;
    S.d = data || { bank: [], planned: [] };
  }

  function dessine() {
    const d = S.d;
    const actifs = d.bank.filter((b) => b.active).length;
    const prog = S.voir
      ? (d.planned.length ? `<ul class="ads-list">${d.planned.map((p) => `<li><strong>${esc(JOUR.format(new Date(`${p.day}T12:00:00Z`)))}</strong> : ${esc(p.word)}${p.definition ? ` — <span class="muted">${esc(p.definition)}</span>` : ''}${p.day > d.today ? ` <button type="button" class="btn btn-ghost btn-sm" data-unplan="${esc(p.day)}">Retirer</button>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Aucun mot fixé à l’avance : tirage automatique dans la banque.</p>')
      : '<p class="small muted">Masqué pour ne pas te gâcher la grille du jour.</p>';
    root.innerHTML = `<div class="ads stack">
      <section class="card stack">
        <div><h3 class="card-title">Mots à venir</h3>
          <p class="small muted">${esc(String(actifs))} mot${actifs > 1 ? 's' : ''} actif${actifs > 1 ? 's' : ''} dans la banque · dictionnaire : ${esc(String(d.dict ?? 0))} mots autorisés. Mélange les mots du gang et des mots courants pour tenir dans la durée.</p></div>
        <div class="btn-row"><button type="button" class="btn btn-ghost btn-sm" data-voir aria-expanded="${S.voir}">${S.voir ? 'Masquer les mots' : 'Afficher les mots (spoiler)'}</button></div>
        ${prog}
        <form class="ads-form" data-form="plan" novalidate>
          <div class="field"><label for="ads-day">Programmer un mot pour le</label><input class="input" type="date" id="ads-day" name="day" required></div>
          <div class="field"><label for="ads-pword">Mot</label><input class="input" id="ads-pword" name="word" maxlength="9" autocomplete="off" required></div>
          <div class="field"><label for="ads-pdef">Définition (facultative : celle de la banque sinon)</label><input class="input" id="ads-pdef" name="def" maxlength="300"></div>
          <div class="btn-row"><button type="submit" class="btn btn-primary">Programmer</button></div>
        </form>
      </section>
      <section class="card stack">
        <h3 class="card-title">Banque de mots</h3>
        <form class="ads-form" data-form="bank" novalidate>
          <div class="field"><label for="ads-word">Mot (5 à 9 lettres)</label><input class="input" id="ads-word" name="word" maxlength="9" autocomplete="off" required></div>
          <div class="field"><label for="ads-def">Définition à la sauce du gang</label><input class="input" id="ads-def" name="def" maxlength="300"></div>
          <div class="btn-row"><button type="submit" class="btn btn-primary">Ajouter ou modifier</button></div>
        </form>
        ${S.voir ? `<ul class="ads-list">${d.bank.map((b) => `<li class="${b.active ? '' : 'is-off'}"><strong>${esc(b.word)}</strong>${b.definition ? ` — ${esc(b.definition)}` : ''}${b.last_day ? ` <span class="small muted">(servi le ${esc(b.last_day)})</span>` : ''}
          <button type="button" class="btn btn-ghost btn-sm" data-toggle="${esc(b.word)}">${b.active ? 'Mettre de côté' : 'Réactiver'}</button></li>`).join('')}</ul>` : ''}
      </section></div>`;
  }

  async function action(b, fn, ok) {
    if (b) b.disabled = true;
    try { await fn(); toast(ok, 'ok'); await charge(); dessine(); }
    catch (x) { toast(errMsg(x), 'error'); if (b) b.disabled = false; }
  }
  const rpc = async (f, a) => { const { error } = await sb.rpc(f, a); if (error) throw error; };

  root.addEventListener('click', (e) => {
    if (e.target.closest('[data-voir]')) { S.voir = !S.voir; dessine(); root.querySelector('[data-voir]')?.focus(); return; }
    const t = e.target.closest('[data-toggle]');
    if (t) { const w = S.d.bank.find((x) => x.word === t.dataset.toggle); action(t, () => rpc('hg_sutom_bank_save', { p_word: w.word, p_definition: w.definition, p_active: !w.active }), w.active ? 'Mot mis de côté' : 'Mot réactivé'); return; }
    const u = e.target.closest('[data-unplan]');
    if (u) action(u, () => rpc('hg_sutom_program', { p_day: u.dataset.unplan, p_word: null, p_definition: null }), 'Mot retiré : tirage automatique ce jour-là');
  });
  root.addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target, b = f.querySelector('[type="submit"]'), el = f.elements;
    if (f.dataset.form === 'bank') action(b, () => rpc('hg_sutom_bank_save', { p_word: el.word.value, p_definition: el.def.value, p_active: true }), 'Mot enregistré');
    if (f.dataset.form === 'plan') action(b, () => rpc('hg_sutom_program', { p_day: el.day.value, p_word: el.word.value, p_definition: el.def.value || null }), 'Mot programmé');
  });

  root.innerHTML = '<div class="empty">Chargement des mots…</div>';
  try { await charge(); dessine(); }
  catch (x) { root.innerHTML = `<div class="empty">Sutom indisponible : ${esc(errMsg(x))}</div>`; }
}
