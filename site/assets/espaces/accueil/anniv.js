// ===== Humane Gang — anniversaire du serveur (T4, migration 096) =====
/*
 * Rôle : pendant la fenêtre de l'anniversaire du gang (par défaut du 7 au 9 janvier, réglable), remplace la bannière
 * « Joyeux anniversaire » par un encart « Le gang a N ans » sur l'accueil et la page Cartes : un gros chiffre, le cadeau
 * à réclamer une fois (booster « Anniversaire » dans le stock + carte datée de l'année) et un aperçu de la rétrospective
 * (/pages/irl/recap.html?retro=1). Le jour même, la part de gâteau (secret « anniversaire ») reste à prendre.
 * RPC : hg_anniv_me, hg_anniv_claim, hg_gang_retro. Le serveur vérifie la fenêtre (heure de Zurich) et ne donne qu'une fois.
 * Dépendances : core.js (sb, esc, toast, errMsg), cartes-ui.js (cardHtml), eggs/api.js (eggFound), saisons-css.js.
 * Exporte : mountAnniv({ today }).
 */
import { sb, esc, toast, errMsg } from '../../commun/core.js';
import { cardHtml } from '../cartes/cartes-ui.js';
import { eggFound } from '../arcade/api.js';
import { svg } from '../../commun/icons.js';
import { loadSeasonCss } from './saisons-css.js';

const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nf = new Intl.NumberFormat('fr-CH');
/** « 9 janvier » à partir de « 2027-01-09 ». */
const dm = (s) => { const p = String(s || '').split('-').map(Number); return p.length === 3 ? `${p[2]} ${MOIS[p[1] - 1]}` : ''; };

/** Encart du cadeau (après réclamation, ou pour montrer ce qui attend). */
function giftHtml(st) {
  const card = st.card ? cardHtml({ ...st.card }, { size: 'sm' }) : '';
  const b = st.booster;
  return `<section class="sz-card" aria-labelledby="an-g-t"><h3 class="sz-h3" id="an-g-t">Ton cadeau d’anniversaire</h3>
    <div class="an-gift" style="margin-top:12px">${card}
      ${b ? `<div class="an-pack" aria-hidden="true"><b>Booster</b>${esc(b.name)}<span>${Number(b.size) || 5} cartes</span></div>` : ''}
      <div class="sz-stack" style="gap:6px;margin:0;flex:1;min-width:150px">
        ${st.claimed ? `<span class="pill pill-ok">${svg('check', { size: 14 })} Reçu</span>` : ''}
        ${st.card ? '<p class="sz-small sz-muted">Carte Légendaire datée, introuvable dans les boosters.</p>' : ''}
        ${b ? `<p class="sz-small sz-muted">${st.claimed ? 'Booster ajouté à ton stock.' : 'Un booster à ouvrir quand tu veux.'}</p>` : ''}
        ${st.claimed ? '<p style="margin:0"><a class="btn btn-ghost" href="/pages/cartes/cartes.html#ouverture">Ouvrir le booster</a></p>' : ''}
      </div></div></section>`;
}

/** Aperçu de la rétrospective : une ligne par année (premier moment retenu), puis les chiffres cumulés. */
function retroHtml(r, age) {
  if (!r?.years?.length) return '';
  const lines = r.years.map((y) => {
    const m = (y.moments || [])[0];
    const txt = m ? m.title : `${nf.format(y.sorties || 0)} sorties · ${nf.format(y.photos || 0)} photos`;
    return `<li><b>${esc(y.year)}</b><span>${esc(txt)}</span></li>`;
  }).join('');
  const t = r.totals || {};
  const chips = [[t.sorties, 'sorties'], [t.photos, 'photos'], [t.secret_santa, 'Secret Santa'], [t.souvenirs, 'souvenirs']]
    .filter(([n]) => Number(n) > 0).map(([n, l]) => `<span class="pill">${nf.format(Number(n))} ${l}</span>`).join('');
  return `<section class="sz-card an-retro" aria-labelledby="an-r-t"><div class="sz-between"><h3 class="sz-h3" id="an-r-t">Rétrospective · ${esc(age)} ans</h3>
    <a class="sz-small" href="/pages/irl/recap.html?retro=1">Voir la story</a></div>
    <ul class="an-years">${lines}</ul><div class="an-chips">${chips}</div></section>`;
}

/**
 * Monte l'encart d'anniversaire en haut de la page (accueil ou cartes). Ne fait rien hors fenêtre.
 * @param {{today?: boolean}} opts today : c'est le jour J (la part de gâteau est à prendre).
 * @returns {Promise<boolean>} vrai si l'encart est affiché.
 */
export async function mountAnniv(opts = {}) {
  const { data: st, error } = await sb.rpc('hg_anniv_me');
  if (error || !st?.dans_fenetre || !(Number(st.age) > 0)) return false;
  loadSeasonCss({ cards: true });
  const app = document.querySelector('#app') || document.querySelector('main');
  if (!app) return false;
  const wrap = document.createElement('div');
  wrap.className = 'sz-stack an-wrap';
  const anchor = app.querySelector('.home-head') || app.querySelector('.page-head');
  if (anchor) anchor.after(wrap); else app.prepend(wrap);
  const S = { st, retro: null };
  const y0 = Number(st.annee) || 2022, y1 = Number(String(st.date).slice(0, 4)) || (y0 + Number(st.age));

  const draw = () => {
    const s = S.st;
    wrap.innerHTML = `
      <section class="an-hero" aria-labelledby="an-title">
        <div class="an-hero-txt">
          <p class="sz-eyebrow">${esc(dm(s.date))} · ${esc(y0)} → ${esc(y1)}</p>
          <h2 class="sz-title" id="an-title">Le gang a ${esc(s.age)} ans</h2>
          <p class="sz-small sz-muted">Merci d’être là. Ton cadeau t’attend jusqu’au ${esc(dm(s.fin))}.</p>
          <div class="btn-row">
            <button class="btn btn-sand" type="button" data-an="claim" ${s.claimed ? 'disabled' : ''}>${svg('gift', { size: 16 })} ${s.claimed ? 'Cadeau ouvert' : 'Ouvrir mon cadeau'}</button>
            <a class="btn btn-ghost" href="/pages/irl/recap.html?retro=1">Revoir les ${esc(s.age)} ans</a>
            ${opts.today ? `<button class="btn btn-ghost" type="button" data-an="cake">${svg('cake', { size: 16 })} Ta part de gâteau</button>` : ''}
          </div>
        </div>
        <span class="an-age" aria-hidden="true">${esc(s.age)}</span>
      </section>
      ${s.claimed ? giftHtml(s) : ''}
      ${retroHtml(S.retro, s.age)}`;
  };
  draw();
  sb.rpc('hg_gang_retro').then(({ data }) => { if (data) { S.retro = data; draw(); } }, () => {});

  wrap.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-an]');
    if (!b) return;
    if (b.dataset.an === 'cake') { b.disabled = true; await eggFound('anniversaire'); b.remove(); return; }
    b.disabled = true;
    try {
      const { data, error: err } = await sb.rpc('hg_anniv_claim');
      if (err) throw err;
      toast(data?.already ? 'Tu as déjà ouvert ton cadeau.' : 'Joyeux anniversaire ! Ton cadeau est dans ta collection.', 'success');
      const { data: st2 } = await sb.rpc('hg_anniv_me');
      if (st2) S.st = st2; else S.st = { ...S.st, claimed: true };
      draw();
      wrap.querySelector('#an-g-t')?.focus?.();
    } catch (err) {
      b.disabled = false;
      toast(errMsg(err), 'error');
    }
  });
  return true;
}
