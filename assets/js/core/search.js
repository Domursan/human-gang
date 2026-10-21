// Recherche globale (membres connectés) : bouton loupe dans l'en-tête, raccourci Ctrl/Cmd+K, dialogue accessible
// (role="dialog", focus piégé, Échap). Cherche dans les sorties (hg_events : titre, lieu), les souvenirs
// (hg_moments : titre, texte) et les membres (rpc hg_members), avec des résultats groupés et des liens vers les pages.
// Les listes sont chargées une fois, à la première ouverture de la page, et au plus 300 éléments par type ;
// la recherche se fait ensuite dans la page, sans aller-retour, insensible à la casse et aux accents.
import { sb } from './supabase.js';
import { canAccess } from './pages-access.js';
import { esc, errMsg, fmtDate, avatarHtml } from './util.js';
import { ICON_SEARCH, ICON_CLOSE } from './icons.js';

const LIMIT = 300;        // éléments chargés au plus par type
const MIN_CHARS = 2;      // longueur minimale de la requête
const SHOW_PER_GROUP = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const GROUPS = {
  events: { title: 'Sorties', slug: 'irl' },
  moments: { title: 'Souvenirs', slug: 'historique' },
  members: { title: 'Membres', slug: 'membre' },
};

/** Texte normalisé pour la recherche : minuscules, sans accents. */
export const foldText = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- Données (une fois par type, mises en cache si le chargement a réussi) ---------- */
const cache = {};   // clé -> { items } ; absent tant que non chargé ou en erreur
const pending = {}; // clé -> promesse en cours

const okId = (id) => (UUID_RE.test(String(id ?? '')) ? String(id) : null);

async function fetchGroup(key) {
  try {
    if (key === 'events') {
      const { data, error } = await sb.from('hg_events').select('id,title,location,starts_at')
        .order('starts_at', { ascending: false, nullsFirst: false }).limit(LIMIT);
      if (error) throw error;
      const items = (data ?? []).flatMap((e) => {
        const id = okId(e.id);
        if (!id) return [];
        const sub = [e.location, fmtDate(e.starts_at)].filter(Boolean).join(' · ');
        return [{ title: e.title || 'Sans titre', sub, href: `irl.html#event-${id}`, hay: foldText(`${e.title ?? ''}\n${e.location ?? ''}`) }];
      });
      return { items };
    }
    if (key === 'moments') {
      const { data, error } = await sb.from('hg_moments').select('id,title,body,happened_on')
        .order('happened_on', { ascending: false }).limit(LIMIT);
      if (error) throw error;
      const items = (data ?? []).flatMap((m) => {
        if (!okId(m.id)) return [];
        return [{ title: m.title || 'Sans titre', sub: fmtDate(m.happened_on), href: 'historique.html', hay: foldText(`${m.title ?? ''}\n${m.body ?? ''}`) }];
      });
      return { items };
    }
    // membres : les plus récents d'abord, 300 au plus, puis affichés par pseudo
    const { data, error } = await sb.rpc('hg_members');
    if (error) throw error;
    const items = (Array.isArray(data) ? data : [])
      .slice().sort((a, b) => String(b.member_since ?? '').localeCompare(String(a.member_since ?? '')))
      .slice(0, LIMIT)
      .sort((a, b) => String(a.pseudo ?? '').localeCompare(String(b.pseudo ?? ''), 'fr'))
      .flatMap((p) => {
        const id = okId(p.id);
        if (!id) return [];
        return [{ title: p.pseudo || 'Membre', avatar: p, href: `membre.html?id=${id}`, hay: foldText(p.pseudo ?? '') }];
      });
    return { items };
  } catch (e) {
    console.warn('[recherche]', key, errMsg(e));
    return { error: errMsg(e), items: [] };
  }
}

/** Charge un type (une seule fois). Renvoie { items } ou { error, items: [] }. */
function loadGroup(key) {
  if (cache[key]) return Promise.resolve(cache[key]);
  pending[key] ||= fetchGroup(key).then((res) => {
    if (!res.error) cache[key] = res;
    pending[key] = null;
    return res;
  });
  return pending[key];
}

/* ---------- Recherche et rendu ---------- */
const terms = (q) => foldText(q).trim().split(/\s+/).filter(Boolean);
const visibleGroups = () => Object.keys(GROUPS).filter((k) => canAccess(GROUPS[k].slug));

function itemHtml(key, it) {
  const lead = key === 'members' ? `<span class="sr-ico">${avatarHtml(it.avatar, 32)}</span>` : '';
  // L'espace entre titre et sous-titre est un nœud texte : invisible à l'écran (flex), lu par les lecteurs d'écran
  return `<li><a class="sr-item" href="${esc(it.href)}">${lead}<span class="sr-title">${esc(it.title)}</span>${it.sub ? ` <span class="sr-sub">${esc(it.sub)}</span>` : ''}</a></li>`;
}

function renderResults(d, q) {
  const box = d.querySelector('.search-results');
  const status = d.querySelector('.sr-status');
  const t = terms(q);
  const groups = visibleGroups();
  if (t.join(' ').length < MIN_CHARS) {
    box.innerHTML = '';
    status.textContent = `Tape au moins ${MIN_CHARS} caractères.`;
    return;
  }
  const pendingNow = groups.some((k) => !cache[k] && pending[k]);
  let total = 0;
  const sections = groups.map((key) => {
    const g = GROUPS[key];
    if (!cache[key] && pending[key]) return `<section class="sr-group" aria-labelledby="sr-${key}"><h3 class="sr-group-title" id="sr-${key}">${g.title}</h3><p class="sr-empty muted small">Chargement…</p></section>`;
    if (!cache[key]) return `<section class="sr-group" aria-labelledby="sr-${key}"><h3 class="sr-group-title" id="sr-${key}">${g.title}</h3><p class="sr-empty muted small">Indisponible pour le moment.</p></section>`;
    const hits = cache[key].items.filter((it) => t.every((x) => it.hay.includes(x)));
    total += hits.length;
    const shown = hits.slice(0, SHOW_PER_GROUP);
    return `<section class="sr-group" aria-labelledby="sr-${key}">
      <h3 class="sr-group-title" id="sr-${key}">${g.title} <span class="sr-count">${hits.length}</span></h3>
      ${hits.length ? `<ul class="sr-list">${shown.map((it) => itemHtml(key, it)).join('')}</ul>` : '<p class="sr-empty muted small">Aucun résultat.</p>'}
      ${hits.length > shown.length ? `<p class="sr-more muted small">${hits.length - shown.length} de plus : affine ta recherche.</p>` : ''}
    </section>`;
  });
  box.innerHTML = sections.join('');
  if (pendingNow) status.textContent = 'Chargement des résultats…';
  else status.textContent = total ? `${total} résultat${total > 1 ? 's' : ''}` : `Aucun résultat pour « ${q.trim()} ».`;
}

/* ---------- Dialogue ---------- */
let dlg = null;
let opener = null;

function buildDialog() {
  const d = document.createElement('dialog');
  d.className = 'search-dialog';
  d.setAttribute('role', 'dialog');
  d.setAttribute('aria-modal', 'true');
  d.setAttribute('aria-labelledby', 'search-title');
  d.innerHTML = `<form class="search-form" role="search">
      <div class="search-head">
        <h2 id="search-title" class="display">Rechercher</h2>
        <button class="search-close" type="button" aria-label="Fermer la recherche">${ICON_CLOSE}</button>
      </div>
      <div class="search-box">${ICON_SEARCH}
        <label for="search-q" class="visually-hidden">Rechercher une sortie, un souvenir ou un membre</label>
        <input id="search-q" class="search-input" type="search" autocomplete="off" spellcheck="false" placeholder="Sortie, lieu, souvenir, membre…" aria-describedby="search-hint sr-status-line">
      </div>
      <p id="search-hint" class="muted small">Sorties (titre, lieu), souvenirs (titre, texte), membres. Insensible aux accents et à la casse.</p>
      <p id="sr-status-line" class="sr-status" role="status" aria-live="polite"></p>
      <div class="search-results"></div>
    </form>`;
  const form = d.querySelector('form');
  const input = d.querySelector('#search-q');

  d.querySelector('.search-close').addEventListener('click', () => d.close());
  d.addEventListener('click', (e) => {
    if (e.target === d) d.close(); // clic sur le fond
    else if (e.target.closest('a.sr-item')) d.close();
  });
  d.addEventListener('close', () => {
    const back = opener?.isConnected ? opener : document.querySelector('.site-header .nav-search-open');
    back?.focus?.();
    opener = null;
  });
  // Focus piégé : Tab et Maj+Tab restent dans le dialogue (en plus de l'inertie du reste de la page)
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Tab') return;
    const f = [...d.querySelectorAll('button:not([disabled]), input, a[href]')];
    if (!f.length) return;
    const first = f[0], last = f[f.length - 1];
    const inside = d.contains(document.activeElement);
    if (e.shiftKey && (!inside || document.activeElement === first)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (!inside || document.activeElement === last)) { e.preventDefault(); first.focus(); }
  });
  // Entrée : ouvre le premier résultat
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const first = d.querySelector('.sr-item');
    if (first) { d.close(); location.href = first.getAttribute('href'); }
  });
  input.addEventListener('input', () => renderResults(d, input.value));

  document.body.append(d);
  return d;
}

/** Charge les types visibles qui ne le sont pas encore, puis rafraîchit les résultats. */
function ensureLoaded(d) {
  const todo = visibleGroups().filter((k) => !cache[k]);
  if (!todo.length) return;
  renderResults(d, d.querySelector('#search-q').value); // affiche « Chargement… »
  Promise.all(todo.map((k) => loadGroup(k))).then(() => {
    if (d.open) renderResults(d, d.querySelector('#search-q').value);
  });
}

/** Ouvre la recherche (ou donne le focus au champ si elle est déjà ouverte). */
export function openSearch(e) {
  if (document.querySelector('dialog[open]') && !dlg?.open) return; // un autre dialogue est déjà ouvert
  dlg ||= buildDialog();
  if (!dlg.open) {
    // Retour du focus à la fermeture : le bouton qui a ouvert, sinon l'élément actif de la page, sinon la loupe
    const active = document.activeElement;
    opener = e?.currentTarget instanceof Element ? e.currentTarget
      : (active && active !== document.body ? active : document.querySelector('.site-header .nav-search-open'));
    dlg.showModal();
  }
  const input = dlg.querySelector('#search-q');
  input.focus();
  input.select();
  ensureLoaded(dlg);
  renderResults(dlg, input.value);
}

/** Markup du bouton loupe de l'en-tête (membres connectés seulement). */
export function searchButtonHtml() {
  return '<button class="nav-icon nav-search-open" type="button" aria-label="Rechercher (Ctrl ou Cmd + K)" aria-haspopup="dialog" title="Rechercher (Ctrl ou Cmd + K)">' + ICON_SEARCH + '</button>';
}

let keyBound = false;
/** Branche le bouton loupe de l'en-tête et le raccourci Ctrl/Cmd+K (une seule fois pour la page). */
export function bindSearch(header) {
  header.querySelector('.nav-search-open')?.addEventListener('click', openSearch);
  if (keyBound) return;
  keyBound = true;
  document.addEventListener('keydown', (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key || '').toLowerCase() !== 'k') return;
    if (!document.querySelector('.site-header .nav-search-open')) return; // membres connectés seulement
    e.preventDefault();
    openSearch();
  });
}
