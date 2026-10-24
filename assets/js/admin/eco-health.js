// Admin : bloc « Santé de l'économie » de la vue d'ensemble (idée A7). Staff « cartes » et administrateur.
// Quatre indicateurs avec un feu vert / orange / rouge (Paillettes en jeu, taux de recyclage, booster le plus rentable,
// gains concentrés), les alertes expliquées avec un lien vers le bon réglage, et le rendement de chaque booster.
// Données : RPC hg_eco_health() (lecture seule, migration 093) ; « Ignorer cette semaine » : hg_eco_alerts_ignore.
// Le détail des gains concentrés (qui, d'où) n'est renvoyé par la base qu'à l'administrateur, sans jugement.
// Utilisé par overview.js (loadEco, ecoTodo, ecoTile, renderEco). Dépend de core.js (sb, esc, toast, errMsg) et perms.js.
import { sb, esc, toast, errMsg } from '../core.js';
import { canSection } from './perms.js';

// Dernière réponse de hg_eco_health (null : pas encore chargée ou pas de droit), et erreur éventuelle.
const H = { data: null, error: null };
const nf = new Intl.NumberFormat('fr-CH');
const nf1 = new Intl.NumberFormat('fr-CH', { maximumFractionDigits: 1 });
/** Libellé et couleur de chaque niveau. */
const LEVEL = { ok: ['Normal', 'ok'], warn: ['À surveiller', 'warn'], bad: ['Alerte', 'bad'] };
/** Libellés des raisons du journal des Paillettes (détail des gains concentrés). */
const REASON = { quete: 'quêtes', defi: 'défis', booster: 'boosters', quotidien: 'passage du jour', recyclage: 'recyclage', fabrication: 'fabrication',
  echange: 'échanges', photo: 'photos', moment: 'moments', badge: 'badges', capture: 'captures', admin: 'ajustements admin', serie_complete: 'séries complètes' };

/** Charge la santé de l'économie (si la personne a le droit « cartes »). Une erreur est gardée pour l'affichage. */
export async function loadEco() {
  if (!canSection('cartes')) return;
  try {
    const { data, error } = await sb.rpc('hg_eco_health');
    if (error) throw error;
    H.data = data || null;
    H.error = null;
  } catch (e) { H.error = errMsg(e); }
}

/** Les alertes sont-elles suspendues (« Ignorer cette semaine ») ? */
const ignored = () => !!H.data?.ignore_until && new Date(H.data.ignore_until) > new Date();

/**
 * Alertes rouges, expliquées, avec le lien vers le réglage concerné.
 * @returns {Array<{key: string, title: string, text: string, href: string, act: string}>}
 */
function alerts() {
  const d = H.data;
  if (!d) return [];
  const s = d.seuils || {};
  const out = [];
  const w = d.booster_max;
  if (w && (d.boosters || []).some((b) => b.id === w.id && b.level === 'bad')) {
    out.push({ key: 'booster', title: `Le booster ${w.name} rapporte ${nf.format(w.ratio)} % de son prix au recyclage.`,
      text: `Valeur attendue ${nf.format(w.ev)} Paillettes pour un prix de ${nf.format(w.price)} : ouvrir puis tout recycler fait gagner des Paillettes (seuil ${nf.format(s.booster_pct)} %).`,
      href: '#cartes/boosters', act: 'Ouvrir Boosters' });
  }
  if (d.paillettes?.level === 'bad') {
    out.push({ key: 'paillettes', title: `Les Paillettes en jeu ont augmenté de ${nf1.format(d.paillettes.pct)} % en 7 jours.`,
      text: `Seuil ${nf.format(s.paillettes_pct)} %. Un événement (Noël, drop) peut l’expliquer ; sinon, une récompense est peut-être trop généreuse.`,
      href: '#cartes/economie', act: 'Ouvrir Paillettes et dons' });
  }
  if (d.recyclage?.level === 'bad') {
    out.push({ key: 'recyclage', title: `${nf1.format(d.recyclage.pct)} % des cartes obtenues cette semaine ont été recyclées.`,
      text: `Seuil ${nf.format(s.recyclage_pct)} % : les cartes ne valent peut-être plus grand-chose aux yeux du gang.`,
      href: '#cartes/recyclage', act: 'Ouvrir Recyclage' });
  }
  const c = d.concentration;
  if (c?.level === 'bad') {
    const top = c.top;
    const src = top ? Object.entries(top.sources || {}).sort((a, b) => b[1] - a[1]).map(([k, n]) => `${REASON[k] || k} ${nf.format(n)}`).join(', ') : '';
    out.push({ key: 'concentration', title: `Un membre a gagné ${nf1.format(c.ratio)} fois la médiane des gains de la semaine.`,
      text: top ? `${top.pseudo} : ${nf.format(top.gains)} Paillettes (${src}). Souvent un bug ou un réglage trop généreux.` : 'Souvent un bug ou un réglage trop généreux.',
      href: top ? `#cartes/joueurs/${encodeURIComponent(top.user_id)}` : '#cartes/recyclage', act: top ? 'Voir le joueur' : 'Ouvrir les seuils' });
  }
  return out;
}

/**
 * Alertes rouges du moment (après loadEco) pour la section Gestion globale : liste expliquée, et suspension en cours.
 * @returns {{liste: Array<{key: string, title: string, text: string, href: string, act: string}>, suspendues: boolean, erreur: string, donnees: object|null}}
 *   donnees : la réponse de hg_eco_health (null si pas encore chargée).
 */
export function alertesEco() {
  return { liste: alerts(), suspendues: ignored(), erreur: H.error || '', donnees: H.data };
}

/** Ligne « À traiter » de la vue d'ensemble : seulement en cas d'alerte rouge non suspendue. */
export function ecoTodo() {
  const list = ignored() ? [] : alerts();
  const n = list.length;
  return n ? { label: `${n} ${n > 1 ? 'alertes' : 'alerte'} économie`, meta: 'Le jeu de cartes · Économie', href: list[0].href, act: 'Examiner' } : null;
}
/** Tuile de la vue d'ensemble (nombre d'alertes rouges), ou null sans droit / sans données. */
export function ecoTile() {
  if (!canSection('cartes') || !H.data) return null;
  const list = ignored() ? [] : alerts();
  const n = list.length;
  return { value: n, label: n > 1 ? 'alertes économie' : 'alerte économie', warn: n > 0, href: list[0]?.href || '#cartes/recyclage' };
}

/** Petite courbe (SVG) d'une série de 7 valeurs. */
function spark(values, tone) {
  const v = (values || []).map((x) => Number(x) || 0);
  if (v.length < 2) return '';
  const min = Math.min(...v), max = Math.max(...v), span = max - min || 1;
  const pts = v.map((x, i) => `${Math.round((i / (v.length - 1)) * 100)},${Math.round(26 - ((x - min) / span) * 22)}`).join(' ');
  return `<svg class="eco-spark" data-tone="${tone}" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true" focusable="false"><polyline points="${pts}"/></svg>`;
}
/** Indicateur : feu, titre, grand chiffre, sous-titre, courbe. */
function ind(level, title, big, sub, values) {
  const [label, tone] = LEVEL[level] || LEVEL.ok;
  return `<div class="eco-ind"><span class="eco-dot" data-tone="${tone}"><i aria-hidden="true"></i>${esc(label)}</span>
    <span class="small muted">${esc(title)}</span><strong class="eco-big">${esc(big)}</strong>
    <span class="small eco-sub" data-tone="${tone}">${esc(sub)}</span>${spark(values, tone)}</div>`;
}

/** Dessine le bloc dans #ov-eco (masqué sans droit « cartes »). */
export function renderEco() {
  const card = document.getElementById('ov-eco-card');
  const el = document.getElementById('ov-eco');
  if (!card || !el) return;
  card.hidden = !canSection('cartes');
  if (card.hidden) return;
  if (H.error) { el.innerHTML = `<p class="form-error" role="alert">Santé de l’économie indisponible : ${esc(H.error)}</p>`; return; }
  const d = H.data;
  if (!d) { el.innerHTML = '<div class="empty">Chargement…</div>'; return; }
  const p = d.paillettes || {}, r = d.recyclage || {}, w = d.booster_max, c = d.concentration || {};
  const wLevel = (d.boosters || []).find((b) => b.id === w?.id)?.level || 'ok';
  const pctTxt = p.pct == null ? 'pas de référence' : `${p.pct >= 0 ? '+' : ''}${nf1.format(p.pct)} % en 7 jours`;
  const list = alerts();
  const off = ignored();
  const boosters = [...(d.boosters || [])].filter((b) => b.ratio != null).sort((a, b) => b.ratio - a.ratio);
  const row = (b) => `<tr><th scope="row">${esc(b.name)}</th><td>${nf.format(b.price)}</td><td>${nf.format(b.ev)}</td>
      <td><span class="eco-yield" data-tone="${LEVEL[b.level]?.[1] || 'ok'}"><span class="eco-bar" aria-hidden="true"><span style="width:${Math.min(100, Math.round(b.ratio / 1.2))}%"></span></span><strong>${nf.format(b.ratio)} %</strong></span></td></tr>`;
  const thead = '<thead><tr><th scope="col">Booster</th><th scope="col">Prix</th><th scope="col">Valeur au recyclage</th><th scope="col">Rendement</th></tr></thead>';
  el.innerHTML = `<p class="xs muted eco-note">7 derniers jours · seuils réglables dans <a href="#cartes/recyclage">Économie › Recyclage et fabrication</a></p>
    <div class="eco-inds">
      ${ind(p.level, 'Paillettes en jeu', nf.format(p.total ?? 0), pctTxt, p.days)}
      ${ind(r.level, 'Taux de recyclage', r.pct == null ? '–' : `${nf1.format(r.pct)} %`, `${nf.format(r.recycled ?? 0)} recyclées / ${nf.format(r.obtained ?? 0)} obtenues`, r.days)}
      ${ind(wLevel, 'Booster le plus rentable', w ? `${nf.format(w.ratio)} %` : '–', w ? w.name : 'aucun booster payant', null)}
      ${ind(c.level, 'Gains concentrés', c.ratio == null ? '–' : `${nf1.format(c.ratio)} ×`, c.ratio == null ? 'trop peu de gains cette semaine' : 'max / médiane', null)}
    </div>
    ${off ? `<div class="eco-alert" data-tone="off"><div class="eco-alert-txt"><strong>Alertes suspendues jusqu’au ${esc(new Date(d.ignore_until).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long' }))}.</strong>
        <span class="small">${list.length ? `${list.length} ${list.length > 1 ? 'alertes restent' : 'alerte reste'} visible${list.length > 1 ? 's' : ''} ci-dessous, sans « À traiter ».` : 'Rien d’anormal pour l’instant.'}</span></div>
        <div class="eco-alert-act"><button type="button" class="btn btn-ghost btn-sm" data-eco-ignore="0">Reprendre les alertes</button></div></div>` : ''}
    ${list.map((a, i) => `<div class="eco-alert" data-tone="${off ? 'off' : 'bad'}"><div class="eco-alert-txt"><strong>${esc(a.title)}</strong><span class="small">${esc(a.text)}</span></div>
        <div class="eco-alert-act"><a class="btn btn-sand btn-sm" href="${esc(a.href)}">${esc(a.act)}</a>${!off && i === 0 ? '<button type="button" class="btn btn-ghost btn-sm" data-eco-ignore="7">Ignorer cette semaine</button>' : ''}</div></div>`).join('')}
    ${boosters.length ? `<table class="eco-tbl">${thead}<tbody>${boosters.slice(0, 3).map(row).join('')}</tbody></table>
      ${boosters.length > 3 ? `<details class="eco-more"><summary>Tous les boosters (${boosters.length})</summary><table class="eco-tbl">${thead}<tbody>${boosters.slice(3).map(row).join('')}</tbody></table></details>` : ''}` : ''}`;
}

// « Ignorer cette semaine » / « Reprendre les alertes » (délégation sur le document : le bloc est redessiné souvent)
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-eco-ignore]');
  if (!b || !document.getElementById('ov-eco')?.contains(b)) return;
  b.disabled = true;
  try {
    const days = Number(b.dataset.ecoIgnore) || 0;
    const { error } = await sb.rpc('hg_eco_alerts_ignore', { p_days: days });
    if (error) throw error;
    toast(days ? 'Alertes économie suspendues pour 7 jours' : 'Alertes économie reprises', 'ok');
    await loadEco();
    document.dispatchEvent(new CustomEvent('hg:eco-changed'));
  } catch (ex) { toast(errMsg(ex), 'error'); b.disabled = false; }
});
