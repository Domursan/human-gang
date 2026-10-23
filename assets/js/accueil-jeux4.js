// ===== Humane Gang — accueil : soirée complète (J19) et rang de saison (J16) =====
/*
 * Rôle : deux encarts de l'accueil, insérés juste après le bloc « Défi du gang » :
 *   - « Soirée complète » (tuile compacte de la maquette J19) : pendant une soirée prévue par le Staff, « 6 / 8 », avatars
 *     des présents (jamais d'absents) et bouton « J’y suis » ; avant la soirée, l'heure de début. Mise à jour en temps
 *     réel. Le détail est dans l'onglet Soirée complète de la page Jeux.
 *   - « Ton rang de saison » : rang, points, lien vers l'onglet Saison de la page Jeux.
 * Données : RPC hg_night_current, hg_night_here, hg_season_board (migration 086).
 * Dépendances : core.js (sb, esc, toast, avatarHtml, canAccess) ; jeux/soiree.js (chargeSoiree, jYSuis, abonne).
 * Exporte : mountAccueilJeux(me) (appelée par accueil.js).
 */
import { sb, esc, toast, avatarHtml, canAccess } from './core.js';
import { chargeSoiree, jYSuis, abonne } from './jeux/soiree.js';

const nf = new Intl.NumberFormat('fr-CH');
const quand = new Intl.DateTimeFormat('fr-CH', { timeZone: 'Europe/Zurich', weekday: 'long', hour: '2-digit', minute: '2-digit' });
let canal = null;

/** Charge la feuille de style des encarts une seule fois. */
function css() {
  if (document.querySelector('link[data-accueil-jeux]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../css/accueil-jeux4.css', import.meta.url).href;
  l.dataset.accueilJeux = '1';
  document.head.append(l);
}

/** Place un encart juste après le bloc du défi du gang (ou avant les rubriques). */
function placer(el) {
  const ref = document.getElementById('defi');
  if (ref) ref.after(el); else document.getElementById('app')?.append(el);
}

/* ---------- Soirée complète (J19) ---------- */

/**
 * Peint la tuile compacte de la soirée.
 * @param {HTMLElement} box tuile
 * @param {object} n soirée (hg_night_current)
 */
function peintSoiree(box, n) {
  const presents = Array.isArray(n.presents) ? n.presents : [];
  const cnt = presents.length, cible = Math.max(1, Number(n.threshold) || 1);
  const complete = !!n.completed_at;
  const lien = canAccess('jeux') ? 'jeux.html#soiree' : null;
  const sous = !n.live ? `Commence ${quand.format(new Date(n.starts_at))}` : complete ? 'Soirée complète ! Bravo le gang.' : `${esc(n.title)} · ${nf.format(n.reward)} ✦ pour chaque présent`;
  const g = `<span class="home-soiree-ic" aria-hidden="true">🎉</span>
      <span>
        <span class="home-soiree-t" id="soiree-h">Soirée complète · ${esc(String(cnt))} / ${esc(String(cible))}</span>
        <span class="small muted home-soiree-s">${esc(sous)}</span>
        ${cnt ? `<ul class="home-soiree-avs" aria-label="Présents">${presents.slice(0, 10).map((p) => `<li title="${esc(p.pseudo)}">${avatarHtml(p, 22)}<span class="visually-hidden">${esc(p.pseudo)}</span></li>`).join('')}</ul>` : ''}
      </span>`;
  box.innerHTML = `${lien ? `<a class="home-soiree-g" href="${lien}">${g}</a>` : `<div class="home-soiree-g">${g}</div>`}
    ${!n.live ? '' : n.here ? '<p class="small home-soiree-ok" tabindex="-1">Tu es présent</p>' : '<button class="btn btn-sand" type="button" data-ici>J’y suis</button>'}`;
  box.hidden = false;
  box.querySelector('[data-ici]')?.addEventListener('click', async (e) => {
    e.currentTarget.disabled = true;
    if (await jYSuis(sb, toast, n)) { await recharge(box, true); } else e.currentTarget.disabled = false;
  });
}

/** Recharge la soirée et repeint la tuile (masquée sans soirée). */
async function recharge(box, focus = false) {
  const n = await chargeSoiree(sb);
  if (!n) { box.hidden = true; return null; }
  peintSoiree(box, n);
  if (focus) box.querySelector('.home-soiree-ok')?.focus();
  return n;
}

/** Tuile de la soirée avec abonnement temps réel aux présences. */
async function soiree() {
  const box = document.createElement('section');
  box.className = 'card home-soiree';
  box.id = 'soiree';
  box.setAttribute('aria-labelledby', 'soiree-h');
  box.hidden = true;
  placer(box);
  const n = await recharge(box);
  if (n) canal = abonne(sb, n, () => { if (!box.contains(document.activeElement)) recharge(box).catch(() => {}); });
}

/* ---------- Rang de saison (J16) ---------- */

/** Encart « Ton rang de saison », si la page Jeux est accessible. */
async function saison() {
  if (!canAccess('jeux')) return;
  const { data, error } = await sb.rpc('hg_season_board');
  if (error) throw error;
  if (!data?.season) return;
  const m = data.me;
  const rang = m ? (m.rank === 1 ? '1er' : `${m.rank}e`) : '–';
  const jours = Math.max(0, Math.ceil((new Date(data.season.ends_at) - Date.now()) / 864e5));
  const box = document.createElement('a');
  box.className = 'card home-saison';
  box.href = 'jeux.html#saison';
  box.innerHTML = `
    <span class="home-saison-rang" aria-hidden="true">${esc(rang)}</span>
    <span class="home-saison-txt">
      <strong>${m ? `Ton rang de saison : ${esc(rang)}` : 'Saison en cours'}</strong>
      <span class="small muted">${m ? `${esc(nf.format(m.points))} pts · ` : 'Pas encore de point · '}${esc(data.season.label)} · encore ${esc(String(jours))} jours</span>
    </span>
    <span class="home-saison-voir small">Voir</span>`;
  const ref = document.getElementById('soiree');
  if (ref) ref.after(box); else placer(box);
}

/**
 * Monte les deux encarts de l'accueil (membre connecté). Chaque encart échoue en silence (console) sans gêner la page.
 * @param {object} me profil du membre connecté
 */
export async function mountAccueilJeux(me) {
  if (!me) return;
  css();
  await soiree().catch((e) => console.warn('[soirée]', e));
  await saison().catch((e) => console.warn('[saison]', e));
}

/** Coupe l'abonnement temps réel (changement de page). */
addEventListener('pagehide', () => { if (canal) sb.removeChannel(canal); canal = null; });
