// ===== Humane Gang — statistiques d'amitié (idée P6, membre.html) =====
// Sur la fiche d'un autre membre : encart « Toi et <pseudo> » (sorties ensemble, échanges et dons, Secret Santa des éditions
// terminées, mercis si l'idée P4 est en place, année commune), une phrase de conclusion et l'action suivante.
// Sur sa propre fiche : bouton « Avec qui j'ai le plus de souvenirs » (liste visible de soi seul).
// Rien n'est stocké ni récompensé : tout vient des RPC hg_friendship(p_other) et hg_friendship_top() (migration 091).
// Dépendances : core.js (sb, esc, $, avatarHtml, errMsg, canAccess, fmtDate), icons.js.
// Exporte : mountFriendship(el, { card, isMe }), friendshipVerdict(f), friendshipRows(f).
import { sb, esc, avatarHtml, errMsg, canAccess } from './core.js';
import { svg } from './icons.js';

/* Icônes propres à l'encart (le jeu d'icônes du site n'a ni cœur ni cartes) */
const I = {
  pin: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-7-6-7-12a7 7 0 0 1 14 0c0 6-7 12-7 12z"/><circle cx="12" cy="9" r="2.5"/></svg>',
  cards: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="12" height="16" rx="2"/><path d="M9 3h10a2 2 0 0 1 2 2v14"/></svg>',
  gift: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="8" width="18" height="13" rx="2"/><path d="M12 8v13M3 12h18M12 8c-2-4-6-4-6-1s6 1 6 1c0 0 6 2 6-1s-4-3-6 1z"/></svg>',
  heart: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z"/></svg>',
};

/** « 1 sortie » / « 3 sorties » */
const plural = (n, one, many) => (n > 1 ? many : one);
/** Nombre entier sûr (0 si absent). */
const num = (v) => Math.max(0, Number(v) || 0);

/**
 * Lignes de l'encart (les lignes à zéro sont masquées : pas de « 0 sortie ensemble », trop froid).
 * @param {object} f réponse de hg_friendship
 * @returns {{icon: string, tint: string, big: string, text: string, sub: string}[]}
 */
export function friendshipRows(f) {
  const rows = [];
  const pseudo = String(f.pseudo || '');
  const sorties = num(f.sorties);
  if (sorties) {
    const first = f.premiere_sortie?.title;
    rows.push({ icon: I.pin, tint: 'sand', big: String(sorties), text: `${plural(sorties, 'sortie', 'sorties')} ensemble`,
      sub: first ? `${sorties > 1 ? 'depuis' : 'lors de'} « ${first} »` : '' });
  }
  const ech = num(f.echanges), dons = num(f.dons);
  if (ech || dons) {
    // « 3 échanges et 1 don », « 2 échanges de cartes » ou « 1 don de carte » (le grand chiffre est le premier nombre)
    const text = ech && dons ? `${plural(ech, 'échange', 'échanges')} et ${dons} ${plural(dons, 'don', 'dons')}`
      : ech ? plural(ech, 'échange de cartes', 'échanges de cartes') : plural(dons, 'don de carte', 'dons de cartes');
    const d = f.dernier_echange;
    let sub = '';
    if (d?.carte_donnee && d?.carte_recue) sub = `dernier : « ${d.de_moi ? d.carte_donnee : d.carte_recue} » contre « ${d.de_moi ? d.carte_recue : d.carte_donnee} »`;
    else if (d?.carte_donnee) sub = d.de_moi ? `dernier : tu lui as offert « ${d.carte_donnee} »` : `dernier : ${pseudo} t’a offert « ${d.carte_donnee} »`;
    rows.push({ icon: I.cards, tint: 'slate', big: String(ech || dons), text, sub });
  }
  for (const s of Array.isArray(f.secret_santa) ? f.secret_santa : []) {
    rows.push({ icon: I.gift, tint: 'rose', big: String(s.year),
      text: s.sens === 'donne' ? 'tu lui as offert son cadeau' : `${pseudo} t’a offert ton cadeau`,
      sub: 'Secret Santa · édition terminée' });
  }
  const mercis = f.mercis == null ? 0 : num(f.mercis);
  if (mercis) rows.push({ icon: I.heart, tint: 'rust', big: String(mercis), text: `${plural(mercis, 'merci échangé', 'mercis échangés')}`, sub: '' });
  return rows;
}

/**
 * Phrase de conclusion selon les chiffres (jamais de classement ni de comparaison avec d'autres membres).
 * @param {object} f réponse de hg_friendship
 * @returns {{label: string, tone: 'ok'|'todo'}}
 */
export function friendshipVerdict(f) {
  const sorties = num(f.sorties), cartes = num(f.echanges) + num(f.dons), ss = (f.secret_santa || []).length, mercis = num(f.mercis);
  if (sorties >= 3) return { label: 'Duo de sorties', tone: 'ok' };
  if (cartes >= 3) return { label: 'Partenaires d’échange', tone: 'ok' };
  if (ss && sorties) return { label: 'Complices', tone: 'ok' };
  if (ss) return { label: 'Lien Secret Santa', tone: 'ok' };
  if (sorties || cartes || mercis) return { label: 'Souvenirs en commun', tone: 'ok' };
  return { label: 'À découvrir', tone: 'todo' };
}

/**
 * HTML de l'encart « Toi et <pseudo> ».
 * @param {object} f réponse de hg_friendship
 * @param {object} card carte du membre regardé (hg_member_card)
 * @param {object} me profil connecté
 */
function encartHtml(f, card, me) {
  const rows = friendshipRows(f);
  const v = friendshipVerdict(f);
  const pseudo = card.pseudo;
  const body = rows.length
    ? rows.map((r) => `
        <li class="fr-row">
          <span class="fr-ic fr-ic-${r.tint}">${r.icon}</span>
          <span class="fr-txt"><span><strong class="fr-big">${esc(r.big)}</strong> ${esc(r.text)}</span>${r.sub ? `<span class="small muted">${esc(r.sub)}</span>` : ''}</span>
        </li>`).join('')
    : `<li class="fr-row fr-empty"><span class="fr-txt"><span>Aucune sortie ensemble pour l’instant.</span><span class="small muted">La prochaine sortie IRL est une bonne occasion !</span></span></li>`;
  const since = Number(f.ensemble_depuis) || null;
  // Action suivante : écrire (toujours), et proposer un échange quand il n'y en a pas encore eu
  const canCards = canAccess('cartes');
  const actions = [];
  if (!num(f.echanges) && !num(f.dons) && canCards) actions.push(`<a class="btn btn-sand" href="cartes.html#collection/${encodeURIComponent(card.id)}">${I.cards} Proposer un échange</a>`);
  actions.push(`<a class="btn ${actions.length ? 'btn-ghost' : 'btn-sand'}" href="messages.html?to=${encodeURIComponent(card.id)}">${svg('msg', { size: 16 })} Lui écrire</a>`);
  return `
    <section class="card fr-card" aria-labelledby="fr-title">
      <div class="fr-head">
        <h2 class="fr-title" id="fr-title"><span class="fr-avs" aria-hidden="true">${avatarHtml(me, 28)}${avatarHtml(card, 28)}</span>Toi et ${esc(pseudo)}</h2>
        <span class="pill fr-verdict fr-verdict-${v.tone}">${esc(v.label)}</span>
      </div>
      <ul class="fr-rows">${body}</ul>
      <p class="small muted">${since ? `Membres ensemble depuis ${esc(String(since))}. ` : ''}Visible par toi seul.</p>
    </section>
    <div class="btn-row fr-actions">${actions.join('')}</div>`;
}

/**
 * Liste privée « Avec qui j'ai le plus de souvenirs » (sur sa propre fiche), dépliée à la demande.
 * @param {HTMLElement} el conteneur
 */
function mountTop(el) {
  el.innerHTML = `
    <div class="fr-top">
      <button class="btn btn-ghost fr-top-btn" type="button" aria-expanded="false" aria-controls="fr-top-list">${svg('users2', { size: 18 })} Avec qui j’ai le plus de souvenirs</button>
      <div id="fr-top-list" class="card fr-top-list" hidden></div>
    </div>`;
  el.hidden = false;
  const btn = el.querySelector('.fr-top-btn'), box = el.querySelector('#fr-top-list');
  let loaded = false;
  btn.addEventListener('click', async () => {
    const open = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', String(open));
    box.hidden = !open;
    if (!open || loaded) return;
    box.innerHTML = '<p class="small muted">Chargement…</p>';
    try {
      const { data, error } = await sb.rpc('hg_friendship_top');
      if (error) throw error;
      const list = Array.isArray(data) ? data : [];
      loaded = true;
      box.innerHTML = list.length
        ? `<p class="small muted">Sorties partagées. Visible par toi seul.</p>
           <ol class="fr-top-ol">${list.map((m) => `
             <li><a class="fr-top-item" href="membre.html?id=${encodeURIComponent(m.user_id)}">${avatarHtml({ ...m, id: m.user_id }, 32)}
               <span class="fr-top-name">${esc(m.pseudo)}</span><span class="small muted">${esc(String(m.sorties))} ${plural(m.sorties, 'sortie', 'sorties')}</span></a></li>`).join('')}</ol>`
        : '<p class="small muted">Pas encore de sortie partagée. Les souvenirs arrivent avec la prochaine sortie IRL !</p>';
    } catch (e) { box.innerHTML = `<p class="small muted">Impossible de charger la liste (${esc(errMsg(e))}).</p>`; }
  });
}

/**
 * Monte l'encart (fiche d'un autre membre) ou le bouton de liste privée (sa propre fiche).
 * Réglage coupé, membre qui masque ses souvenirs, ou erreur : rien n'est affiché (l'encart est facultatif).
 * @param {HTMLElement} el conteneur (masqué au départ)
 * @param {{card: object, isMe: boolean, me: object}} o
 */
export async function mountFriendship(el, { card, isMe, me }) {
  if (!el || !card?.id) return;
  if (isMe) { mountTop(el); return; }
  try {
    const { data, error } = await sb.rpc('hg_friendship', { p_other: card.id });
    if (error) throw error;
    const f = data && typeof data === 'object' ? data : null;
    if (!f || f.active === false || f.hidden) return;
    el.innerHTML = encartHtml({ pseudo: card.pseudo, ...f }, card, me);
    el.hidden = false;
  } catch (e) { console.warn('[amitié]', e?.message || e); }
}
