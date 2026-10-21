// ===== Humane Gang — aide et tutos =====
// Liste des tutos par groupe, recherche (titre, résumé, mots-clés), tuto ouvert par l'adresse aide.html#<slug>.
// Accessible sans compte : seuls les groupes PUBLIC_GROUP_IDS (« premiers pas ») sont visibles aux visiteurs.
import { initPage, esc, $ } from './core.js';
import { loadTutoGroups, PUBLIC_GROUP_IDS } from './tutos/index.js';

const me = await initPage({ auth: 'optional' });

const BASE_TITLE = 'Aide et tutos · Humane Gang';
const SAFE_PAGE = /^[a-z0-9-]+\.html(#[\w-]*)?$/i; // lien « Y aller » : une page du site, rien d'autre
const SAFE_IMG = /^assets\/tutos\/[\w.-]+$/;        // capture : un fichier du dépôt, rien d'autre
const fold = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const listView = $('#aide-list-view');
const tutoView = $('#aide-tuto-view');
const groupsBox = $('#aide-groups');
const emptyBox = $('#aide-empty');
const countBox = $('#aide-count');
const guestNote = $('#aide-guest');
const qInput = $('#aide-q');

/* ---------- Données : groupes valides, avec au moins un tuto ---------- */
const loaded = await loadTutoGroups();
const groups = loaded.map((g) => ({
  id: String(g.id ?? ''),
  title: String(g.title ?? ''),
  icon: String(g.icon ?? ''),
  tutos: (Array.isArray(g.tutos) ? g.tutos : []).filter((t) => t && /^[a-z0-9-]+$/.test(t.slug ?? '') && t.title),
})).filter((g) => g.id && g.tutos.length);
const canSee = (g) => !!me || PUBLIC_GROUP_IDS.includes(g.id);
const visibleGroups = groups.filter(canSee);
const bySlug = new Map();
groups.forEach((g) => g.tutos.forEach((t) => bySlug.set(t.slug, { t, g })));

if (!me) guestNote.hidden = false;

/* ---------- Liste et recherche ---------- */
const haystack = (t) => fold([t.title, t.summary, ...(Array.isArray(t.keywords) ? t.keywords : [])].join(' '));

function renderList(query = '') {
  const q = query.trim();
  const needle = fold(q);
  let total = 0;
  groupsBox.innerHTML = visibleGroups.map((g) => {
    const items = g.tutos.filter((t) => !needle || haystack(t).includes(needle));
    if (!items.length) return '';
    total += items.length;
    return `<section class="card aide-group" aria-labelledby="g-${esc(g.id)}">
      <h2 class="aide-group-title" id="g-${esc(g.id)}"><span class="aide-group-icon" aria-hidden="true">${esc(g.icon)}</span>${esc(g.title)}</h2>
      <ul class="aide-tuto-list">
        ${items.map((t) => `<li><a class="aide-tuto-link" href="aide.html#${esc(t.slug)}">
          <span class="aide-tuto-title">${esc(t.title)}</span>
          ${t.summary ? `<span class="aide-tuto-sum">${esc(t.summary)}</span>` : ''}</a></li>`).join('')}
      </ul>
    </section>`;
  }).join('');
  if (!visibleGroups.length) {
    emptyBox.textContent = 'Les tutos arrivent bientôt.';
    emptyBox.hidden = false;
  } else if (total === 0) {
    emptyBox.textContent = `Aucun tuto ne correspond à « ${q} ». Essaie un autre mot, ou écris à l'assistance plus bas.`;
    emptyBox.hidden = false;
  } else {
    emptyBox.hidden = true;
  }
  countBox.textContent = !visibleGroups.length ? '' : needle ? (total === 1 ? '1 tuto trouvé' : `${total} tutos trouvés`) : '';
}

qInput.addEventListener('input', () => renderList(qInput.value));

/* ---------- Un tuto (adresse aide.html#<slug>) ---------- */
function tutoHtml(t, g) {
  const steps = (Array.isArray(t.steps) ? t.steps : []).filter((s) => s && s.title);
  const tips = (Array.isArray(t.tips) ? t.tips : []).filter(Boolean);
  const page = typeof t.page === 'string' && SAFE_PAGE.test(t.page) ? t.page : '';
  return `<article class="card aide-tuto">
    <p class="aide-crumb"><a href="aide.html">Tous les tutos</a> <span aria-hidden="true">›</span> ${esc(g.icon)} ${esc(g.title)}</p>
    <h2 class="aide-tuto-heading display" id="aide-tuto-heading" tabindex="-1">${esc(t.title)}</h2>
    ${t.summary ? `<p class="aide-summary">${esc(t.summary)}</p>` : ''}
    <ol class="aide-steps">
      ${steps.map((s, i) => `<li class="aide-step">
        <span class="aide-step-num" aria-hidden="true">${i + 1}</span>
        <div class="aide-step-body">
          <h3>${esc(s.title)}</h3>
          ${s.text ? `<p>${esc(s.text)}</p>` : ''}
          ${typeof s.img === 'string' && SAFE_IMG.test(s.img) ? `<img class="aide-shot" src="${esc(s.img)}" alt="Capture de l'étape ${i + 1}" loading="lazy" data-on-error="remove">` : ''}
        </div>
      </li>`).join('')}
    </ol>
    ${tips.length ? `<div class="aide-tips"><h3>Astuces</h3><ul>${tips.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : ''}
    <div class="btn-row aide-actions">
      ${page ? `<a class="btn btn-primary" href="${esc(page)}">Y aller</a>` : ''}
      <a class="btn btn-ghost" href="aide.html">← Tous les tutos</a>
    </div>
  </article>`;
}

function showMessage(html) {
  tutoView.innerHTML = `<div class="card aide-tuto aide-missing">${html}
    <div class="btn-row"><a class="btn btn-ghost" href="aide.html">← Tous les tutos</a></div></div>`;
}

function showTuto(slug) {
  const hit = bySlug.get(slug);
  listView.hidden = true;
  tutoView.hidden = false;
  if (!hit) {
    showMessage(`<h2 class="display" tabindex="-1">Ce tuto n'existe pas</h2><p>Il a peut-être changé de nom. Choisis-en un dans la liste.</p>`);
  } else if (!canSee(hit.g)) {
    showMessage(`<h2 class="display" tabindex="-1">Tuto réservé aux membres</h2><p>Connecte-toi pour voir ce tuto.</p>
      <div class="btn-row"><a class="btn btn-primary" href="compte.html">Me connecter</a></div>`);
  } else {
    tutoView.innerHTML = tutoHtml(hit.t, hit.g);
    document.title = `${hit.t.title} · ${BASE_TITLE}`;
    tutoView.querySelector('#aide-tuto-heading')?.focus({ preventScroll: false });
    window.scrollTo({ top: 0 });
    return;
  }
  document.title = BASE_TITLE;
  tutoView.querySelector('h2')?.focus();
}

function showList() {
  tutoView.hidden = true;
  tutoView.innerHTML = '';
  listView.hidden = false;
  document.title = BASE_TITLE;
  renderList(qInput.value);
}

function route() {
  let slug = '';
  try { slug = decodeURIComponent(location.hash.slice(1)); } catch { slug = ''; }
  if (slug) showTuto(slug);
  else showList();
}
window.addEventListener('hashchange', route);
route();
