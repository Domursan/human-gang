// ===== Humane Gang — accueil : tuile « Ce jour-là » (S1) =====
/*
 * Rôle : la tuile « Ce jour-là » montre un souvenir dont la date tombe aujourd'hui, 1, 2, 3 ou 4 ans plus tôt
 *   (moment culte, sortie passée avec ses photos, soirée d'échange du Secret Santa), ou à 3 jours près. Le choix est fait
 *   par le serveur (même souvenir pour tout le monde ce jour-là, heure de Zurich). « Un autre » fait défiler (5 au plus).
 *   Sans souvenir, la tuile reste masquée.
 * Page : accueil.html (vue membre), appelé par accueil.js.
 * Dépendances : core.js (sb, esc, errMsg), photos.js (URL signées, visionneuse), reactions.js (barre de réactions), icons.js.
 * RPC : hg_on_this_day.
 * Exporte : loadOnThisDay, dayHeadline.
 */
import { sb, esc } from './core.js';
import { signedUrls, openLightbox } from './photos.js';
import { loadReactions, reactionBarHtml } from './reactions.js';
import { svg } from './icons.js';

/** Libellé du genre de souvenir, sous la date. */
const KIND_LABEL = { sortie: 'sortie IRL', moment: 'moment culte', secret_santa: 'Secret Santa' };
/** Lien et libellé du bouton principal, selon le genre. */
const KIND_LINK = {
  sortie: (it) => [`irl.html#event-${encodeURIComponent(it.id)}`, it.photos ? 'Voir l’album' : 'Voir la sortie'],
  moment: () => ['historique.html', 'Voir l’historique'],
  secret_santa: () => ['historique.html', 'Voir l’historique'],
};
/** Date « 23 octobre 2024 » (date SQL lue sans décalage de fuseau). */
const dayFmt = new Intl.DateTimeFormat('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
const fmtDay = (d) => dayFmt.format(new Date(`${String(d).slice(0, 10)}T12:00:00Z`));
const PIN = svg('pin', { size: 14, stroke: 2 });
const ARROW = svg('arrow', { size: 16, stroke: 2 });

/**
 * Titre en grand : « Il y a 2 ans » (« Il y a 1 an »).
 * @param {number} n années écoulées
 * @returns {string}
 */
export function dayHeadline(n) {
  const y = Math.max(1, Number(n) || 1);
  return `Il y a ${y} an${y > 1 ? 's' : ''}`;
}

/** Nombre suivi du nom au singulier ou au pluriel. */
const count = (n, s, p) => `${n} ${n > 1 ? p : s}`;

/**
 * Tuile « Ce jour-là ». Masquée tant qu'elle n'a rien à montrer ; masquée aussi en cas d'erreur (jamais de tuile vide).
 * @param {HTMLElement|null} box section #tile-day
 * @param {{id: string}} me membre connecté
 */
export async function loadOnThisDay(box, me) {
  if (!box) return;
  try {
    const { data, error } = await sb.rpc('hg_on_this_day');
    if (error) throw error;
    const items = (Array.isArray(data) ? data : []).slice(0, 5);
    if (!items.length) { box.hidden = true; return; }
    const urls = await signedUrls(items.flatMap((it) => it.thumbs || []));
    // Réactions : une requête par genre (photos des sorties, moments)
    const byKind = {};
    for (const it of items) if (it.react_kind && it.react_id) (byKind[it.react_kind] ||= []).push(it.react_id);
    await Promise.all(Object.entries(byKind).map(([k, ids]) => loadReactions(k, ids, me?.id)));
    let i = 0;
    box.innerHTML = `<div class="day-head">
        <h2 class="day-eyebrow" id="day-title">${items[0].exact ? 'Ce jour-là' : 'Cette semaine-là'}</h2>
        ${items.length > 1 ? `<div class="day-dots" aria-hidden="true">${items.map((_, k) => `<span data-dot="${k}"></span>`).join('')}</div>` : ''}
      </div>
      <div class="day-body" aria-live="polite"></div>
      <div class="day-actions">
        ${items.length > 1 ? '<button type="button" class="btn btn-ghost day-next">Un autre</button>' : ''}
        <a class="btn btn-sand day-go" href="historique.html"><span>Voir</span>${ARROW}</a>
      </div>`;
    const body = box.querySelector('.day-body');
    /** Affiche le souvenir n° i. */
    const paint = () => {
      const it = items[i];
      const thumbs = (it.thumbs || []).map((p) => urls.get(p)).filter(Boolean).slice(0, 3);
      const meta = [it.place ? `${PIN}<span>${esc(it.place)}</span>` : '',
        it.present ? esc(count(it.present, 'présent', 'présents')) : '',
        it.photos ? esc(count(it.photos, 'photo', 'photos')) : ''].filter(Boolean);
      body.innerHTML = `<p class="day-big">${esc(dayHeadline(it.years_ago))}</p>
        <p class="small muted day-date">${esc(fmtDay(it.date))} · ${esc(KIND_LABEL[it.kind] || '')}${items.length > 1 ? ` <span class="visually-hidden">(souvenir ${i + 1} sur ${items.length})</span>` : ''}</p>
        ${thumbs.length ? `<button type="button" class="day-thumbs n${thumbs.length}" aria-label="Voir ${thumbs.length > 1 ? `les ${thumbs.length} photos` : 'la photo'} en grand">
          ${thumbs.map((u) => `<img src="${esc(u)}" alt="" loading="lazy" decoding="async">`).join('')}</button>` : ''}
        <p class="day-title">${esc(it.title)}</p>
        ${meta.length ? `<p class="small muted day-meta">${meta.join(' · ')}</p>` : ''}
        ${it.react_kind && it.react_id ? reactionBarHtml(it.react_kind, it.react_id) : ''}`;
      body.querySelector('.day-thumbs')?.addEventListener('click', () => openLightbox(thumbs.map((url) => ({ url, alt: it.title, caption: it.title })), 0));
      for (const d of box.querySelectorAll('[data-dot]')) d.classList.toggle('on', Number(d.dataset.dot) === i);
      const [href, label] = (KIND_LINK[it.kind] || KIND_LINK.moment)(it);
      const go = box.querySelector('.day-go');
      go.href = href;
      go.querySelector('span').textContent = label;
    };
    box.querySelector('.day-next')?.addEventListener('click', () => { i = (i + 1) % items.length; paint(); });
    paint();
    box.hidden = false;
  } catch (e) {
    box.hidden = true;
    console.warn('[ce jour-là]', e?.message || e);
  }
}
