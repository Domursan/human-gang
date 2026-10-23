// ===== Humane Gang — page Jeux, onglet « Soirée complète » (idée J19) =====
/*
 * Rôle : défi « soirée complète » de la semaine. Pendant la soirée prévue par le Staff, bouton « J’y suis » ; jauge en
 * direct (« 6 / 8 ») avec les avatars des présents (jamais d'absents) ; au seuil, chaque présent reçoit les Paillettes
 * (serveur) et le fil affiche « Soirée complète ! ». Explication du seuil, compteur des soirées complètes de l'année.
 * Maquette : idees-design/project/J19.dc.html. La tuile compacte de l'accueil (accueil-jeux4.js) réutilise
 * chargeSoiree, jYSuis et abonne.
 * Données : RPC hg_night_current, hg_night_here (migration 086) ; temps réel sur hg_night_presence.
 * Dépendances : ctx = { sb, me, toast, esc } (jeux.js) ; core/util.js (avatarHtml).
 * Exporte : mount(panel, ctx), unmount(), chargeSoiree(sb), jYSuis(sb, toast, soiree), abonne(sb, soiree, rappel).
 */
import { avatarHtml } from '../core/util.js';

const nf = new Intl.NumberFormat('fr-CH');
const jourFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', day: 'numeric', month: 'short' });
const heureFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const moisFmt = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', month: 'long' });
let canal = null, sbRef = null;

/** Heure courte « 20 h » ou « 20 h 30 » (heure de Zurich). */
const heure = (d) => {
  const p = Object.fromEntries(heureFmt.formatToParts(new Date(d)).map((x) => [x.type, x.value]));
  return p.minute === '00' ? `${Number(p.hour)} h` : `${Number(p.hour)} h ${p.minute}`;
};
/** Jour avec majuscule : « Samedi 25 oct. ». */
const jour = (d) => { const t = jourFmt.format(new Date(d)); return t.charAt(0).toUpperCase() + t.slice(1); };

/**
 * Soirée en cours ou prochaine (7 jours), ou null.
 * @param {object} sb client Supabase
 * @returns {Promise<object|null>}
 */
export async function chargeSoiree(sb) {
  const { data, error } = await sb.rpc('hg_night_current');
  if (error) throw error;
  return data || null;
}

/**
 * « J’y suis » : présence notée par le serveur, message selon le résultat.
 * @param {object} sb client Supabase
 * @param {Function} toast notification du site
 * @param {object} n soirée
 * @returns {Promise<boolean>} true si la présence est notée
 */
export async function jYSuis(sb, toast, n) {
  try {
    const { data: r, error } = await sb.rpc('hg_night_here', { p_night: n.id });
    if (error) throw error;
    if (r?.just_completed) toast(`🎉 Soirée complète ! +${r.reward} ✦ pour chaque présent.`, 'success');
    else if (r?.paid && r?.complete) toast(`🎉 Soirée complète : +${r.reward} ✦`, 'success');
    else { const k = Math.max(0, (r?.threshold || 0) - (r?.count || 0)); toast(`Présence notée. Encore ${k} présent${k > 1 ? 's' : ''} pour la soirée complète !`); }
    return true;
  } catch (e) {
    toast(e?.message || String(e), 'error');
    return false;
  }
}

/**
 * Abonnement temps réel aux nouvelles présences d'une soirée (rappel regroupé sur 300 ms).
 * @param {object} sb client Supabase
 * @param {object} n soirée
 * @param {Function} rappel appelé après une nouvelle présence
 * @returns {object} canal (à retirer avec sb.removeChannel)
 */
export function abonne(sb, n, rappel) {
  let attente = 0;
  return sb.channel(`soiree:${n.id}:${Math.random().toString(36).slice(2, 7)}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'hg_night_presence', filter: `night_id=eq.${n.id}` }, () => {
      clearTimeout(attente);
      attente = setTimeout(rappel, 300);
    })
    .subscribe();
}

/** Charge la feuille de style de l'onglet une seule fois. */
function css() {
  if (document.querySelector('link[data-jeux-css="soiree"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/jeux-soiree.css', import.meta.url).href;
  l.dataset.jeuxCss = 'soiree';
  document.head.append(l);
}

/** Lundi de la semaine ISO → numéro de semaine. */
function semaine(d = new Date()) {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const j = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - j + 3);
  const p = new Date(Date.UTC(x.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((x - p) / 864e5 - 3 + ((p.getUTCDay() + 6) % 7)) / 7);
}

/**
 * HTML de l'onglet pour une soirée.
 * @param {object} n soirée (hg_night_current)
 * @param {Function} esc échappement HTML
 */
function soireeHtml(n, esc) {
  const presents = Array.isArray(n.presents) ? n.presents : [];
  const cnt = presents.length, cible = Math.max(1, Number(n.threshold) || 1), shown = Math.min(cnt, cible);
  const complete = !!n.completed_at, reste = Math.max(0, cible - cnt);
  const etat = complete ? ['Complète', 'sr-ok'] : n.live ? ['En cours', 'sr-live'] : ['À venir', 'sr-next'];
  const places = Math.max(0, Math.min(cible, 16) - cnt);
  const bouton = !n.live ? `<p class="small muted sr-centre">Le bouton « J’y suis » apparaîtra ${esc(jour(n.starts_at).toLowerCase())} à ${esc(heure(n.starts_at))}.</p>`
    : n.here ? '<p class="sr-ici" tabindex="-1">Tu es noté présent. Bonne soirée !</p>'
      : '<button type="button" class="btn btn-sand sr-btn" data-ici>J’y suis</button>';
  const annee = Number(n.completes_annee) || 0;
  return `
    <section class="card sr-carte" aria-labelledby="sr-titre">
      <div class="sr-entre sr-haut">
        <div><h3 class="sr-titre" id="sr-titre">${esc(n.title)}</h3><p class="small muted">${esc(jour(n.starts_at))} · ${esc(heure(n.starts_at))} – ${esc(heure(n.ends_at))}</p></div>
        <span class="pill sr-pill ${etat[1]}"><span class="sr-point" aria-hidden="true"></span>${esc(etat[0])}</span>
      </div>
      <div class="sr-entre sr-bas">
        <p aria-live="polite"><span class="sr-gros">${esc(String(cnt))}</span><span class="sr-moyen muted"> / ${esc(String(cible))}</span><span class="visually-hidden"> présents</span></p>
        <p class="small muted sr-droite">${complete ? 'Défi réussi !' : `encore ${esc(String(reste))} présent${reste > 1 ? 's' : ''}<br>pour réussir le défi`}</p>
      </div>
      <div class="progress sr-jauge${complete ? ' is-done' : ''}" role="progressbar" aria-label="Présents à la soirée" aria-valuemin="0" aria-valuemax="${cible}" aria-valuenow="${shown}" aria-valuetext="${shown} présents sur ${cible}"><span style="width:${Math.round((shown / cible) * 100)}%"></span></div>
      <ul class="sr-presents" aria-label="Présents">
        ${presents.map((p) => `<li>${avatarHtml(p, 40)}<span class="small">${esc(p.pseudo)}</span></li>`).join('')}
        ${'<li class="sr-vide" aria-hidden="true"><span></span><span class="small">&nbsp;</span></li>'.repeat(places)}
      </ul>
      ${bouton}
      <p class="small muted sr-centre">À ${esc(String(cible))} présents : <strong class="sr-sand">${esc(nf.format(n.reward))} ✦</strong> pour chaque présent, et « Soirée complète ! » dans le fil.</p>
    </section>
    <div class="sr-boite">
      <p class="small"><strong>Seuil de la semaine : ${esc(String(cible))}</strong></p>
      <p class="small muted">${n.seuil_pct != null && n.actifs != null ? `Par défaut, ${esc(String(n.seuil_pct))} % des ${esc(String(n.actifs))} membres actifs de ${esc(moisFmt.format(new Date()))}, arrondi. ` : ''}Seuls les présents sont affichés.</p>
    </div>
    <section class="card sr-annee" aria-labelledby="sr-annee-h">
      <div class="sr-entre"><h3 class="sr-h" id="sr-annee-h">Soirées complètes en ${new Date().getFullYear()}</h3><span class="sr-chiffre">${esc(String(annee))}</span></div>
      <p class="small muted">Comptées dans le récap annuel.</p>
    </section>`;
}

/**
 * Monte l'onglet dans son panneau.
 * @param {HTMLElement} panel section role="tabpanel" vide
 * @param {{sb: object, toast: Function, esc: Function}} ctx contexte de la page Jeux
 */
export async function mount(panel, ctx) {
  const { sb, toast, esc } = ctx;
  sbRef = sb;
  css();
  panel.innerHTML = '<p class="card">Chargement de la soirée…</p>';
  const tete = `<div><p class="eyebrow">Défi du gang · semaine ${semaine()}</p><h2 class="sr-grand">Soirée complète</h2></div>`;
  /** Charge et peint ; garde le focus sur le bouton ou le message de présence. */
  const peint = async (focus = false) => {
    let n;
    try { n = await chargeSoiree(sb); } catch (e) { panel.innerHTML = `${tete}<p class="card">Impossible de charger la soirée (${esc(e?.message || String(e))}).</p>`; return null; }
    panel.innerHTML = `<div class="sr">${tete}${n ? soireeHtml(n, esc) : `<section class="card"><p>Pas de soirée prévue cette semaine.</p><p class="small muted">Quand le Staff programme une soirée, le défi « soirée complète » apparaît ici et sur l’accueil.</p></section>`}</div>`;
    panel.querySelector('[data-ici]')?.addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      if (await jYSuis(sb, toast, n)) await peint(true); else e.currentTarget.disabled = false;
    });
    if (focus) panel.querySelector('.sr-ici')?.focus();
    return n;
  };
  const n = await peint();
  if (n && !canal) canal = abonne(sb, n, () => { if (!panel.contains(document.activeElement) || !panel.querySelector('[data-ici]:focus')) peint(); });
}

/** Quitte l'onglet : l'abonnement temps réel est coupé. */
export function unmount() { if (canal && sbRef) sbRef.removeChannel(canal); canal = null; }
