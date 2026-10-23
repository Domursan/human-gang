// ===== Humane Gang — Jeux du gang (ludotheque.html) =====
/*
 * Rôle : grille de la ludothèque (jeux au long cours, jeux de soirée) : icône dessinée pour le gang, nombre de joueurs,
 *   prochaine session, et « Tu y joues » quand la personne s'est déclarée. Chaque carte ouvre fiche-jeu.html?slug=….
 * Page : ludotheque.html (session membre requise).
 * Dépendances : core.js (sb, initPage, esc, $, errMsg, fmtDateTime), ludotheque-icons.js.
 * Données : hg_ludo_games, hg_ludo_players, hg_ludo_sessions (migration 088), lus sous la RLS (membres).
 */
import { sb, initPage, esc, $, errMsg } from './core.js';
import { gameIcon, gameColor } from './ludotheque-icons.js';

const me = await initPage();
const root = $('#ludo-root');
/** Date d'une session à l'heure de Zurich : « sam. 25 oct. · 20:30 ». */
const sessFmt = new Intl.DateTimeFormat('fr-CH', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Zurich' });
const KINDS = [['long', 'Au long cours'], ['soiree', 'Soirées jeux']];

try {
  const nowIso = new Date().toISOString();
  const [g, p, s] = await Promise.all([
    sb.from('hg_ludo_games').select('slug,name,kind,color,icon,sort,active').eq('active', true).order('sort'),
    sb.from('hg_ludo_players').select('game_slug,user_id'),
    sb.from('hg_ludo_sessions').select('game_slug,starts_at,cancelled_at').gte('starts_at', nowIso).is('cancelled_at', null).order('starts_at'),
  ]);
  if (g.error) throw g.error;
  const players = p.data || [], sessions = (s.data || []).filter((x) => !x.cancelled_at && new Date(x.starts_at) >= new Date(nowIso));
  const games = (g.data || []).filter((x) => x.active !== false).sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0));
  if (!games.length) root.innerHTML = '<p class="card ludo-empty">Aucune fiche pour l’instant : le Staff les ajoute dans l’admin.</p>';
  else {
    root.innerHTML = KINDS.map(([k, label]) => {
      const list = games.filter((x) => x.kind === k);
      if (!list.length) return '';
      return `<section class="ludo-sec" aria-labelledby="ludo-h-${k}">
        <h2 id="ludo-h-${k}" class="ludo-sec-h">${label}</h2>
        <ul class="ludo-grid">${list.map((x) => {
          const n = players.filter((pl) => pl.game_slug === x.slug).length;
          const mine = players.some((pl) => pl.game_slug === x.slug && pl.user_id === me.id);
          const next = sessions.find((ss) => ss.game_slug === x.slug);
          return `<li><a class="ludo-card" href="fiche-jeu.html?slug=${encodeURIComponent(x.slug)}" style="--g:${gameColor(x.color)}">
            <span class="ludo-ico">${gameIcon(x.icon)}</span>
            <span class="ludo-card-body">
              <span class="ludo-name">${esc(x.name)}</span>
              <span class="small muted">${n} joueur${n > 1 ? 's' : ''}${mine ? ' · <strong class="ludo-mine">Tu y joues</strong>' : ''}</span>
              <span class="small ${next ? 'ludo-next' : 'muted'}">${next ? `Prochaine session : ${esc(sessFmt.format(new Date(next.starts_at)))}` : 'Pas de session prévue'}</span>
            </span>
          </a></li>`;
        }).join('')}</ul>
      </section>`;
    }).join('');
  }
} catch (e) {
  root.innerHTML = `<p class="card ludo-empty">Impossible de charger les jeux (${esc(errMsg(e))}).</p>`;
}
$('#app').removeAttribute('aria-busy');
