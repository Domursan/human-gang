// ===== Cartes — boosters de saison et du soir (migration 080, idées C1, C2 et C3) =====
// Lit les champs renvoyés par hg_booster_types_me : on_shelf (dans sa fenêtre de vente), open_now (dans sa plage horaire),
// available_until (fin de la saison), opens_at / closes_at (plage horaire), per_window_limit / remaining_window (limite par soirée).
// Toutes les heures sont affichées en heure de Zurich ; le serveur fait foi pour l'achat (hg_booster_buy).
// Exporte : onShelf, openNow, saleBadgeHtml, saleLimitHtml, closedBoxHtml, closedRowHtml, discountHtml, windowLeft, nextOpenLabel.
import { esc } from './core.js';

const TZ = 'Europe/Zurich';
const nf = new Intl.NumberFormat('fr-CH');
/** Jour (aaaa-mm-jj) et heure d'une date en heure de Zurich. */
const zParts = (d) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-CH', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'long', hourCycle: 'h23' })
    .formatToParts(d).map((x) => [x.type, x.value]));
  return { day: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
};
/** Heure lisible : « 20 h », « 20 h 30 ». */
const hourLabel = (z) => `${z.hour} h${z.minute ? ' ' + String(z.minute).padStart(2, '0') : ''}`;

/** Vrai si le type est en vente dans sa fenêtre (sinon il ne reste que dans l'inventaire, pour le stock). */
export const onShelf = (t) => t.active !== false && t.on_shelf !== false;
/** Vrai si le type peut s'acheter maintenant (fenêtre de vente et plage horaire). */
export const openNow = (t) => onShelf(t) && t.open_now !== false;

/**
 * « Revient vendredi à 20 h » / « ce soir » / « demain » pour la prochaine ouverture d'une plage horaire.
 * @param {string} iso prochaine ouverture (opens_at)
 * @param {number} [now] maintenant (ms)
 */
export function nextOpenLabel(iso, now = Date.now()) {
  if (!iso) return 'Revient bientôt';
  const z = zParts(new Date(iso));
  const today = zParts(new Date(now)).day;
  const tomorrow = zParts(new Date(now + 864e5)).day;
  const when = z.day === today ? (z.hour >= 17 ? 'ce soir' : 'aujourd’hui') : z.day === tomorrow ? 'demain' : z.weekday;
  return `Revient ${when} à ${hourLabel(z)}`;
}

/** Durée restante avant la fin de la vente : { d, h, ms }, ou null sans date de fin. */
export function windowLeft(t, now = Date.now()) {
  if (!t.available_until) return null;
  const ms = new Date(t.available_until).getTime() - now;
  if (!(ms > 0)) return { d: 0, h: 0, ms: 0 };
  return { d: Math.floor(ms / 864e5), h: Math.floor((ms % 864e5) / 36e5), ms };
}

const CLOCK = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/></svg>';

/**
 * Pastille d'état au-dessus du nom dans la Boutique : compte à rebours de la saison (« Encore 12 j 04 h »,
 * « Dernière fournée · 2 j » les 3 derniers jours) ou plage horaire (« Jusqu’à 2 h », « Revient vendredi à 20 h »).
 * @param {object} t type de booster
 * @param {number} [now] maintenant (ms)
 * @returns {string} HTML (vide pour un type sans saison ni plage)
 */
export function saleBadgeHtml(t, now = Date.now()) {
  let txt = '', cls = '';
  if (t.schedule) {
    if (t.open_now !== false) { txt = t.closes_at ? `Ce soir · jusqu’à ${hourLabel(zParts(new Date(t.closes_at)))}` : 'Ce soir'; cls = 'is-open'; }
    else { txt = nextOpenLabel(t.opens_at, now); cls = 'is-closed'; }
  } else {
    const left = windowLeft(t, now);
    if (!left) return '';
    if (left.ms <= 3 * 864e5) { txt = `Dernière fournée · ${left.d ? nf.format(left.d) + ' j' : nf.format(Math.max(1, left.h)) + ' h'}`; cls = 'is-last'; }
    else { txt = `Encore ${nf.format(left.d)} j ${String(left.h).padStart(2, '0')} h`; cls = 'is-season'; }
  }
  return `<p class="shop-badge ${cls}">${CLOCK}<span>${esc(txt)}</span></p>`;
}

/** Ligne « Limite : 2 par soirée · il t’en reste 1 » (vide sans limite par soirée). */
export function saleLimitHtml(t) {
  if (t.per_window_limit == null) return '';
  const rest = t.remaining_window == null ? '' : ` · il t’en reste ${nf.format(Math.max(0, Number(t.remaining_window) || 0))}`;
  return `<p class="cartes-small shop-limit">Limite : ${nf.format(t.per_window_limit)} par soirée${rest}</p>`;
}

/**
 * Bloc d'achat d'un type fermé (hors plage horaire) : bouton désactivé et prochaine ouverture, reliés par aria-describedby.
 * @param {object} t type de booster
 * @returns {string}
 */
export function closedBoxHtml(t) {
  const id = `shop-closed-${esc(t.id)}`;
  return `<div class="shop-stock">
            <button type="button" class="btn btn-primary cart-btn" disabled aria-describedby="${id}">Acheter</button>
            <p class="muted small shop-stock-miss" id="${id}">${esc(nextOpenLabel(t.opens_at))}. En vente seulement le soir de la soirée jeux.</p>
          </div>`;
}

/**
 * Prix de référence barré et réduction (« 100 ✦ −20 % ») d'un booster du soir moins cher que le Classique.
 * @param {object} t type de booster
 * @param {object[]} types tous les types (pour le prix du Classique)
 * @returns {string} HTML (vide sans réduction)
 */
export function discountHtml(t, types) {
  if (!t.schedule) return '';
  const ref = Number(types.find((x) => x.id === 'classique')?.price) || 0;
  const p = Number(t.price) || 0;
  if (!(ref > p)) return '';
  return ` <s class="shop-ref">${nf.format(ref)} ✦</s> <span class="shop-off">−${nf.format(Math.round((1 - p / ref) * 100))} %</span>`;
}

/**
 * Ligne compacte d'un booster du soir hors de sa plage horaire (cadenas, nom, prochaine ouverture, prix).
 * @param {object} t type de booster
 * @returns {string}
 */
export function closedRowHtml(t) {
  return `<article class="card shop-closed" data-type="${esc(t.id)}" aria-label="${esc(t.name)} : ${esc(nextOpenLabel(t.opens_at))}">
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true" focusable="false"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
      <span class="shop-closed-t"><strong>${esc(t.name)}</strong><span class="muted small">${esc(nextOpenLabel(t.opens_at))}</span></span>
      <span class="muted small">${nf.format(Number(t.price) || 0)} ✦</span>
    </article>`;
}
