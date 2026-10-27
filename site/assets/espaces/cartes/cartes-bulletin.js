// ===== Cartes à collectionner — « Le Cours de la Paillette », bulletin économique hebdomadaire (idée C15) =====
// En tête de l'onglet Classement (cartes.html) : une carte d'appel (numéro, titre, Paillettes en circulation) ; « Lire le bulletin »
// ouvre le bulletin complet à la place du classement : grand chiffre avec la courbe des 8 dernières semaines (SVG en ligne),
// rubriques courtes (carte la plus échangée, booster le plus vendu, carte la plus cherchée, plus gros recycleur, brillantes tirées,
// série la plus complétée, cagnotte), archives (12 derniers numéros) et la case « Apparaître dans le bulletin ».
// RPC (migration 082) : hg_eco_bulletins_me() (dernier bulletin, construit à la première lecture du lundi, + archives + mon accord),
// hg_eco_bulletin_get(p_week), hg_eco_public_set(p_on). Aucun solde de membre n'est affiché ; pseudos seulement avec accord.
// Sans la fonction (migration pas déployée) ou sans bulletin : rien n'est affiché. Tout texte venant de la base passe par esc().
// Exporte : mountBulletin(panel) — ajoute l'encart en tête du panneau Classement (appelé après chaque rendu du classement).
import { sb, toast, errMsg, esc } from './core.js';
import { fmtPaillettes } from './paillettes.js';

const nf = new Intl.NumberFormat('fr-CH');
const nf1 = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 1, signDisplay: 'always' });
const dayFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', timeZone: 'UTC' });
const dayMonthFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
/** État : réponse de hg_eco_bulletins_me, bulletin affiché, vue complète ouverte, panneau. */
const B = { data: null, shown: null, full: false, panel: null, loading: null };

/** « Semaine du 19 au 25 octobre 2026 » (week = lundi, AAAA-MM-JJ). */
function weekLabel(week) {
  const a = new Date(`${week}T00:00:00Z`), b = new Date(a.getTime() + 6 * 864e5);
  return `Semaine du ${dayFmt.format(a)} au ${dayMonthFmt.format(b)}`;
}

/** Courbe des 8 semaines en SVG (sans bibliothèque) ; dernier point marqué. */
function sparkHtml(series) {
  const v = (series || []).map(Number).filter((x) => Number.isFinite(x));
  if (v.length < 2) return '';
  const W = 320, H = 64, min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((y, i) => [Math.round(i * (W - 8) / (v.length - 1)) + 4, Math.round(H - 6 - (y - min) / span * (H - 12))]);
  const last = pts.at(-1);
  return `<svg class="bul-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Paillettes en circulation sur les ${v.length} dernières semaines, de ${nf.format(v[0])} à ${nf.format(v.at(-1))}">
    <polyline points="${pts.map((p) => p.join(',')).join(' ')}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
    <circle cx="${last[0]}" cy="${last[1]}" r="4" fill="currentColor"/></svg>`;
}

/** Une rubrique : titre, valeur, détail. */
const tile = (title, value, sub) => `<div class="bul-tile"><p class="bul-tile-t">${esc(title)}</p><p class="bul-tile-v">${value}</p><p class="bul-tile-s">${sub}</p></div>`;

/** Rubriques du bulletin (seulement celles qui ont des données). */
function tilesHtml(d) {
  const out = [];
  if (d.top_traded) out.push(tile('Carte la plus échangée', esc(d.top_traded.name), `${nf.format(d.top_traded.count)} échange${d.top_traded.count > 1 ? 's' : ''}`));
  if (d.boosters_sold) out.push(tile('Booster le plus vendu', esc(d.boosters_sold.name), `${nf.format(d.boosters_sold.qty)} acheté${d.boosters_sold.qty > 1 ? 's' : ''}`));
  if (d.top_wished) out.push(tile('La plus cherchée', esc(d.top_wished.name), `${nf.format(d.top_wished.count)} liste${d.top_wished.count > 1 ? 's' : ''} de souhaits`));
  if (d.top_recycler) out.push(tile('Plus gros recycleur', d.top_recycler.pseudo ? esc(d.top_recycler.pseudo) : 'Un membre discret', `${nf.format(d.top_recycler.count)} carte${d.top_recycler.count > 1 ? 's' : ''}`));
  const sh = d.shinies || {};
  out.push(tile('Brillantes tirées', nf.format(Number(sh.count) || 0), Number(sh.legendary_plus) ? `dont ${nf.format(sh.legendary_plus)} légendaire${sh.legendary_plus > 1 ? 's' : ''} ou mieux` : `${nf.format(Number(d.opens) || 0)} boosters ouverts`));
  if (d.top_set) out.push(tile('Série la plus complétée', esc(d.top_set.name), `${nf.format(d.top_set.count)} nouveau${d.top_set.count > 1 ? 'x' : ''} complet${d.top_set.count > 1 ? 's' : ''}`));
  return out.join('');
}

/** Ligne de la cagnotte (C13) si une cagnotte a vécu cette semaine. */
function potLine(p) {
  if (!p) return '';
  const st = p.status === 'atteinte' ? 'atteinte' : p.status === 'echouee' ? 'pas atteinte' : 'en cours';
  return `<p class="bul-line">Cagnotte « ${esc(p.title)} » : ${fmtPaillettes(Number(p.total))} sur ${fmtPaillettes(Number(p.goal))} · ${st}</p>`;
}

/** Carte d'appel en tête du classement. */
function teaserHtml(d) {
  return `<section class="card bul-teaser" aria-labelledby="bul-teaser-h">
    <p class="eyebrow">N° ${nf.format(d.num)} · ${esc(weekLabel(d.week))}</p>
    <h2 class="bul-teaser-h" id="bul-teaser-h">Le Cours de la Paillette</h2>
    <p class="bul-headline">« ${esc(d.headline)} »</p>
    <div class="bul-teaser-row"><span>${fmtPaillettes(Number(d.circulation))} en circulation${d.delta_pct != null ? ` <span class="bul-delta ${Number(d.delta_pct) < 0 ? 'is-down' : ''}">${esc(nf1.format(Number(d.delta_pct)))} %</span>` : ''}</span>
      <button type="button" class="btn btn-sand" data-bul="open">Lire le bulletin</button></div>
  </section>`;
}

/** Bulletin complet (vue qui remplace le classement). */
function fullHtml(d) {
  const archive = (B.data?.archive || []).filter((a) => a.week !== d.week);
  return `<article class="bul" aria-labelledby="bul-title">
    <button type="button" class="btn btn-ghost bul-back" data-bul="back">← Classement</button>
    <header class="bul-head">
      <p class="bul-kicker">N° ${nf.format(d.num)} · ${esc(weekLabel(d.week))}</p>
      <h2 class="bul-title" id="bul-title" tabindex="-1">Le Cours de la Paillette</h2>
    </header>
    <p class="bul-lead">« ${esc(d.headline)} »</p>
    <section class="card bul-big" aria-label="Paillettes en circulation">
      <p class="bul-tile-t">Paillettes en circulation</p>
      <p class="bul-big-n">${fmtPaillettes(Number(d.circulation))}${d.delta_pct != null ? ` <span class="bul-delta ${Number(d.delta_pct) < 0 ? 'is-down' : ''}">${esc(nf1.format(Number(d.delta_pct)))} %</span>` : ''}</p>
      ${sparkHtml(d.series)}
      <p class="small muted">${(d.series || []).length} dernières semaines</p>
    </section>
    <div class="bul-tiles">${tilesHtml(d)}</div>
    ${potLine(d.pot)}
    <p class="small muted">Aucun solde n’est publié. Les pseudos n’apparaissent que pour les membres qui l’acceptent.</p>
    <label class="bul-consent"><input type="checkbox" data-bul="consent" ${B.data?.eco_public ? 'checked' : ''}> Apparaître par mon pseudo dans le bulletin</label>
    ${archive.length ? `<section class="bul-archive" aria-labelledby="bul-arch-h"><h3 id="bul-arch-h" class="bul-arch-h">Numéros précédents</h3>
      <ul class="bul-arch-list">${archive.map((a) => `<li><button type="button" class="bul-arch" data-bul="week" data-week="${esc(a.week)}">N° ${nf.format(a.num)} · ${esc(a.headline || '')}</button></li>`).join('')}</ul></section>` : ''}
  </article>`;
}

/** Affiche ou cache le classement (les autres enfants du panneau) pendant la lecture du bulletin. */
function setFull(on) {
  B.full = on;
  const slot = B.panel?.querySelector('#cartes-bulletin-slot');
  if (!slot) return;
  for (const el of B.panel.children) if (el !== slot) el.hidden = on;
  paint(on ? '#bul-title' : '[data-bul="open"]');
}

/** Dessine l'encart (carte d'appel ou bulletin complet). */
function paint(focus = null) {
  const slot = B.panel?.querySelector('#cartes-bulletin-slot');
  if (!slot) return;
  const d = B.shown || B.data?.latest;
  slot.innerHTML = !d ? '' : B.full ? fullHtml(d) : teaserHtml(d);
  if (focus) slot.querySelector(focus)?.focus({ preventScroll: !B.full });
  if (B.full) slot.scrollIntoView?.({ block: 'start' });
}

/** Clics et changements de l'encart. */
async function onClick(e) {
  const t = e.target.closest('[data-bul]');
  if (!t || t.disabled || t.dataset.bul === 'consent') return;
  if (t.dataset.bul === 'open') setFull(true);
  else if (t.dataset.bul === 'back') { B.shown = null; setFull(false); }
  else if (t.dataset.bul === 'week') {
    t.disabled = true;
    try {
      const { data, error } = await sb.rpc('hg_eco_bulletin_get', { p_week: t.dataset.week });
      if (error) throw error;
      if (data) { B.shown = data; paint('#bul-title'); }
    } catch (err) { toast(errMsg(err), 'error'); t.disabled = false; }
  }
}
async function onChange(e) {
  const t = e.target;
  if (t.dataset?.bul !== 'consent') return;
  t.disabled = true;
  try {
    const { error } = await sb.rpc('hg_eco_public_set', { p_on: t.checked });
    if (error) throw error;
    if (B.data) B.data.eco_public = t.checked;
    toast(t.checked ? 'Ton pseudo pourra apparaître dans les prochains bulletins' : 'Tu restes « un membre discret »', 'ok');
  } catch (err) {
    t.checked = !t.checked;
    toast(errMsg(err), 'error');
  } finally { t.disabled = false; }
}

/** Charge les bulletins une fois par page (la ligne est figée pour la semaine). */
async function load() {
  if (B.data) return;
  if (!B.loading) {
    B.loading = sb.rpc('hg_eco_bulletins_me').then(({ data, error }) => {
      if (error) throw error;
      B.data = data && typeof data === 'object' ? data : null;
    }).catch((e) => { console.warn('[bulletin]', e); B.data = { latest: null, archive: [] }; });
  }
  await B.loading;
}

/**
 * Ajoute le bulletin en tête du panneau Classement (après chaque rendu du classement).
 * @param {HTMLElement} panel panneau #cartes-p-classement, déjà rempli par le classement
 * @returns {Promise<void>}
 */
export async function mountBulletin(panel) {
  if (!panel) return;
  if (B.panel !== panel) {
    B.panel = panel;
    panel.addEventListener('click', onClick);
    panel.addEventListener('change', onChange);
  }
  let slot = panel.querySelector('#cartes-bulletin-slot');
  if (!slot) { slot = document.createElement('div'); slot.id = 'cartes-bulletin-slot'; panel.prepend(slot); }
  B.full = false; B.shown = null;
  await load();
  paint();
}
