// Recherche globale (membres connectés) : bouton loupe dans l'en-tête, raccourci Ctrl/Cmd+K, dialogue accessible
// (role="dialog", focus piégé, Échap). Cherche dans les sorties (hg_events : titre, lieu), les souvenirs
// (hg_moments : titre, texte) et les membres (rpc hg_members), avec des résultats groupés et des liens vers les pages.
// Les listes sont chargées une fois, à la première ouverture de la page, et au plus 300 éléments par type ;
// la recherche se fait ensuite dans la page, sans aller-retour, insensible à la casse et aux accents.
/*
 * Rôle : la loupe de l'en-tête ouvre un dialogue de recherche qui parcourt les sorties, les souvenirs
 * et les membres. Chaque résultat est un lien vers la page concernée. Un mot secret tapé exactement (ex. « serge »)
 * lance son effet à la place (eggs/core.js, chargé à la demande).
 * Page : toutes les pages pour un membre connecté (header.js ajoute la loupe et bindSearch).
 * Dépendances : supabase.js (requêtes), pages-access.js (groupes visibles selon mes pages),
 * util.js (esc, errMsg, fmtDate, avatarHtml), icons.js (loupe, fermer).
 * Tables / RPC : hg_events, hg_moments, rpc hg_members.
 * Exporte : foldText, openSearch, searchButtonHtml, bindSearch.
 */
import { sb } from './supabase.js';
import { canAccess } from './pages-access.js';
import { esc, errMsg, fmtDate, avatarHtml } from './util.js';
import { ICON_SEARCH, ICON_CLOSE } from './icons.js';

/* ---------- Constantes ---------- */

const LIMIT = 300;        // éléments chargés au plus par type
const MIN_CHARS = 2;      // longueur minimale de la requête
const SHOW_PER_GROUP = 10; // résultats affichés par groupe (le reste est signalé)
/** Forme d'un identifiant UUID : seuls les ids qui la respectent sont utilisés dans les liens. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/**
 * Groupes de résultats : titre affiché, et page à laquelle le groupe appartient
 * (le groupe n'apparaît que si le membre a accès à cette page).
 */
const GROUPS = {
  events: { title: 'Sorties', slug: 'irl' },
  moments: { title: 'Souvenirs', slug: 'historique' },
  members: { title: 'Membres', slug: 'membre' },
};

/* ---------- Normalisation ---------- */

/**
 * Texte normalisé pour la recherche : minuscules, sans accents.
 * Le NFD sépare la lettre de son accent, puis on retire les marques d'accent (plage U+0300 à U+036F).
 * @param {string|null|undefined} s Texte source.
 * @returns {string} Texte prêt à comparer.
 */
export const foldText = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/* ---------- Données (une fois par type, mises en cache si le chargement a réussi) ---------- */
const cache = {};   // clé -> { items } ; absent tant que non chargé ou en erreur
const pending = {}; // clé -> promesse en cours

/**
 * Renvoie l'identifiant s'il a la forme d'un UUID, sinon null (évite des liens cassés).
 * @param {*} id Identifiant brut.
 * @returns {string|null}
 */
const okId = (id) => (UUID_RE.test(String(id ?? '')) ? String(id) : null);

/**
 * Charge la liste d'un type (sorties, souvenirs ou membres) et la transforme en éléments de recherche.
 * Chaque élément porte un titre, un sous-titre, un lien et un champ `hay` (texte normalisé où chercher).
 * Ne jette jamais : en cas d'erreur, renvoie { error, items: [] }.
 * @param {'events'|'moments'|'members'} key Type à charger.
 * @returns {Promise<{items: Array<object>, error?: string}>}
 */
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

/**
 * Charge un type (une seule fois). Renvoie { items } ou { error, items: [] }.
 * Une erreur n'est pas gardée en cache : la prochaine ouverture réessaie.
 * @param {string} key Type à charger.
 * @returns {Promise<{items: Array<object>, error?: string}>}
 */
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

/**
 * Découpe la requête en mots normalisés. Chaque mot doit apparaître dans le résultat (ordre libre).
 * @param {string} q Requête saisie.
 * @returns {string[]}
 */
const terms = (q) => foldText(q).trim().split(/\s+/).filter(Boolean);
/**
 * Clés des groupes que le membre a le droit de voir.
 * @returns {string[]} Par exemple ['events', 'members'].
 */
const visibleGroups = () => Object.keys(GROUPS).filter((k) => canAccess(GROUPS[k].slug));

/**
 * Markup d'un résultat (lien). Pour un membre, on affiche aussi son avatar.
 * @param {string} key Type du résultat.
 * @param {object} it Élément de recherche (title, sub, href, avatar).
 * @returns {string} Élément <li> en HTML.
 */
function itemHtml(key, it) {
  const lead = key === 'members' ? `<span class="sr-ico">${avatarHtml(it.avatar, 32)}</span>` : '';
  // L'espace entre titre et sous-titre est un nœud texte : invisible à l'écran (flex), lu par les lecteurs d'écran
  return `<li><a class="sr-item" href="${esc(it.href)}">${lead}<span class="sr-title">${esc(it.title)}</span>${it.sub ? ` <span class="sr-sub">${esc(it.sub)}</span>` : ''}</a></li>`;
}

/**
 * Affiche les résultats pour la requête donnée : un bloc par groupe visible, avec compteur,
 * « Chargement… » ou « Indisponible » selon l'état des données. Met aussi à jour le message d'état (aria-live).
 * @param {HTMLDialogElement} d Dialogue de recherche.
 * @param {string} q Texte saisi.
 */
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

/**
 * Saisie d'un mot secret (mots tapés hors champ, voir eggs/core.js) : si la saisie vaut exactement un de ces mots
 * (sans casse ni espaces), l'effet se lance et la recherche se ferme, au lieu d'afficher « Aucun résultat ».
 * Le module des secrets n'est chargé que pour une saisie de lettres seules (rien à charger pour une sortie).
 * @param {HTMLDialogElement} d Dialogue de recherche.
 * @param {string} valeur Texte saisi.
 */
function essaieMotSecret(d, valeur) {
  if (!/^[a-z]{2,12}$/i.test(valeur.trim())) { renderResults(d, valeur); return; }
  import('../eggs/core.js')
    .then((m) => {
      if (d.querySelector('#search-q')?.value !== valeur) return; // la saisie a changé entre-temps
      if (m.tryWordSecret(valeur)) d.close();
      else renderResults(d, valeur);
    })
    .catch(() => renderResults(d, valeur));
}

/** Dialogue de recherche, créé à la première ouverture. */
let dlg = null;
/** Élément à qui rendre le focus à la fermeture. */
let opener = null;

/**
 * Construit le dialogue : champ de recherche, zone de résultats, focus piégé, Entrée pour ouvrir le premier résultat.
 * @returns {HTMLDialogElement} Le dialogue, déjà ajouté au document.
 */
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
    else if (e.target.closest('a.sr-item')) d.close(); // un résultat : on ferme, le lien fait le reste
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
  input.addEventListener('input', () => essaieMotSecret(d, input.value));

  document.body.append(d);
  return d;
}

/**
 * Charge les types visibles qui ne le sont pas encore, puis rafraîchit les résultats.
 * Affiche « Chargement… » pendant l'attente.
 * @param {HTMLDialogElement} d Dialogue de recherche.
 */
function ensureLoaded(d) {
  const todo = visibleGroups().filter((k) => !cache[k]);
  if (!todo.length) return;
  renderResults(d, d.querySelector('#search-q').value); // affiche « Chargement… »
  Promise.all(todo.map((k) => loadGroup(k))).then(() => {
    if (d.open) renderResults(d, d.querySelector('#search-q').value);
  });
}

/**
 * Ouvre la recherche (ou donne le focus au champ si elle est déjà ouverte).
 * @param {Event|null} [e] Événement du clic : son bouton reçoit le focus à la fermeture.
 */
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

/**
 * Markup du bouton loupe de l'en-tête (membres connectés seulement).
 * @returns {string} HTML du bouton.
 */
export function searchButtonHtml() {
  return '<button class="nav-icon nav-search-open" type="button" aria-label="Rechercher (Ctrl ou Cmd + K)" aria-haspopup="dialog" title="Rechercher (Ctrl ou Cmd + K)">' + ICON_SEARCH + '</button>';
}

/** true une fois le raccourci clavier branché : on ne l'ajoute pas deux fois. */
let keyBound = false;
/**
 * Branche le bouton loupe de l'en-tête et le raccourci Ctrl/Cmd+K (une seule fois pour la page).
 * @param {HTMLElement} header En-tête dans lequel se trouve le bouton loupe.
 */
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
