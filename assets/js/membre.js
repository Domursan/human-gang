// ===== Humane Gang — carte d'identité d'un membre + annuaire « Le gang » =====
import { sb, initPage, esc, $, $$, errMsg, toast, fmtDate, avatarHtml, initials, currentLogo, canAccess } from './core.js';
import { loadImage, downloadCanvas } from './ss-card.js';
import { hasLevels, levelImage, levelLabel, levelPipsHtml, roman } from './badge-levels.js';
import { mountShowcase } from './cartes-showcase.js';
import { svg } from './icons.js';

const app = $('#app');
const me = await initPage({ auth: 'member' });

const params = new URLSearchParams(location.search);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const rawId = params.get('id');
const targetId = rawId && UUID_RE.test(rawId) ? rawId : me.id;
const isMe = targetId === me.id;

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const RAINBOW = ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398'];
const PIXEL = '"Silkscreen", ui-monospace, monospace';
const DISPLAY = '"Archivo Black", system-ui, sans-serif';
const BODY = 'Inter, system-ui, sans-serif';
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; } };

const ICON = {
  msg: svg('msg', { size: 20, stroke: 1.8 }),
  download: svg('download', { size: 20, stroke: 1.8 }),
  users: svg('users2', { size: 20, stroke: 1.8 }),
  badge: svg('badge', { size: 20, stroke: 1.8 }),
};

const STATS = [
  ['secret_santa', 'Secret Santa', 'Secret Santa'],
  ['sorties', 'Sortie', 'Sorties'],
  ['organisees', 'Organisée', 'Organisées'],
  ['photos', 'Photo', 'Photos'],
  ['moments', 'Moment', 'Moments'],
];

const num4 = (n) => String(Math.max(0, Number(n) || 0)).padStart(4, '0');
function birthdayLabel(dm) {
  const m = /^(\d{2})\.(\d{2})$/.exec(String(dm || ''));
  if (!m) return '';
  const d = Number(m[1]), mo = Number(m[2]);
  return mo >= 1 && mo <= 12 ? `${d === 1 ? '1er' : d} ${MONTHS[mo - 1]}` : '';
}
/** « mars 2019 », ou la date complète « 12 mars 2019 » si l'admin a saisi la date d'arrivée réelle (joined_on). */
function sinceLabel(d, joined) {
  const j = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(joined || ''));
  if (j) { const day = Number(j[3]); return `${day === 1 ? '1er' : day} ${MONTHS[Number(j[2]) - 1]} ${j[1]}`; }
  if (!d) return '—';
  const x = new Date(d);
  return `${MONTHS[x.getMonth()]} ${x.getFullYear()}`;
}
/** Identifiant lisible dérivé de l'uuid : HG-1A2B-3C4D */
const shortId = (id) => { const h = String(id || '').replace(/-/g, '').toUpperCase(); return `HG-${h.slice(0, 4)}-${h.slice(-4)}`; };
/** Code-barres décoratif déterministe (largeurs 1–3) à partir de l'uuid. */
function barcode(id) {
  const h = String(id || '0').replace(/-/g, '');
  return [...h].slice(0, 28).map((c) => (parseInt(c, 16) % 3) + 1);
}
const safeColor = (c) => (/^#[0-9a-f]{6}$/i.test(String(c || '')) ? c : '#9E3543');

/* =========================================================
   Rendu de la page
   ========================================================= */
function shell() {
  app.innerHTML = `
    <section class="page-head mb-head">
      <div>
        <p class="eyebrow">Carte d'identité HG</p>
        <h1 class="page-title" id="mb-title">${isMe ? 'Ma carte' : 'Carte de membre'}</h1>
      </div>
    </section>
    <section class="mb-layout" id="mb-main" aria-live="polite">
      <div class="mb-card-col"><div class="idc-wrap"><div class="idc idc-skeleton" aria-hidden="true"></div></div></div>
      <div class="card mb-badges"><span class="skeleton-line"></span><span class="skeleton-line short"></span></div>
    </section>
    ${canAccess('cartes') ? '<section class="mb-showcase" id="mb-showcase" hidden></section>' : ''}
    <section class="mb-gang" aria-labelledby="gang-title">
      <h2 class="mb-section-title" id="gang-title">${ICON.users} Le gang</h2>
      <ul class="gang-grid" id="gang"><li class="gang-skel"></li><li class="gang-skel"></li><li class="gang-skel"></li></ul>
    </section>`;
}

/** Nombre maximum de badges affichés sur la carte ; au-delà, une pastille « +n ». */
const IDC_BADGES_MAX = 8;

/**
 * Rangée des badges obtenus sur la carte (images déjà résolues par addBadgeLevels : niveau atteint pour
 * les badges à niveaux). Chaîne vide si aucun badge. Les images cassées retombent sur les initiales.
 */
function idcBadgesHtml(c) {
  const list = Array.isArray(c.badges) ? c.badges : [];
  if (!list.length) return '';
  const shown = list.length <= IDC_BADGES_MAX ? list : list.slice(0, IDC_BADGES_MAX - 1);
  const rest = list.length - shown.length;
  const items = shown.map((b) => {
    const name = b.name || b.code || '';
    const label = b.lv ? `${name} · ${levelLabel(b.lv, b.level)}` : name;
    return `<li class="idc-bdg" title="${esc(label)}">${b.lv ? `<span class="idc-bdg-lvl" aria-hidden="true">${roman(b.level)}</span>` : ''}${b.image_url
      ? `<img src="${esc(b.image_url)}" alt="${esc(label)}" loading="lazy" data-on-error="initials" data-fallback-class="idc-bdg-init" data-fallback="${esc(initials(name))}">`
      : `<span class="idc-bdg-init" role="img" aria-label="${esc(label)}">${esc(initials(name))}</span>`}</li>`;
  }).join('');
  const more = rest > 0 ? `<li class="idc-bdg idc-bdg-more" title="${rest} autre${rest > 1 ? 's' : ''} badge${rest > 1 ? 's' : ''}">+${rest}</li>` : '';
  return `<ul class="idc-badges" aria-label="Badges obtenus (${list.length})">${items}${more}</ul>`;
}

function cardHtml(c) {
  const bday = birthdayLabel(c.birthday_dm);
  const stats = c.stats || {};
  const bars = barcode(c.id).map((w, i) => `<i style="flex-grow:${w}" class="${i % 2 ? 'gap' : ''}"></i>`).join('');
  const bdg = idcBadgesHtml(c);
  return `
    <div class="idc-wrap" id="idc-wrap">
      <article class="idc" id="idc" style="--member:${esc(safeColor(c.color))}" aria-label="Carte de membre de ${esc(c.pseudo)}">
        <div class="idc-face">
          <header class="idc-top">
            <img class="idc-logo" src="${esc(currentLogo())}" alt="" data-on-error="hide">
            <div class="idc-brand">
              <span class="idc-brand-name">HUMANE GANG</span>
              <span class="idc-brand-sub">Carte de membre</span>
            </div>
            <div class="idc-no">
              <span class="idc-k">N° de membre</span>
              <strong class="idc-no-val">${esc(num4(c.member_number))}</strong>
            </div>
          </header>
          <div class="idc-rainbow" aria-hidden="true">${RAINBOW.map((r) => `<span style="background:${r}"></span>`).join('')}</div>
          <div class="idc-body">
            <div class="idc-photo">${c.avatar_url
              ? `<img src="${esc(c.avatar_url)}" alt="" crossorigin="anonymous" data-on-error="initials" data-fallback-class="idc-initials" data-fallback="${esc(initials(c.pseudo))}">`
              : `<span class="idc-initials">${esc(initials(c.pseudo))}</span>`}</div>
            <dl class="idc-fields">
              <div class="idc-field idc-field-pseudo"><dt class="idc-k">Pseudo</dt><dd class="idc-pseudo">${esc(c.pseudo)}</dd></div>
              <div class="idc-field"><dt class="idc-k">Membre depuis</dt><dd>${esc(sinceLabel(c.member_since, c.joined_on))}</dd></div>
              ${bday ? `<div class="idc-field"><dt class="idc-k">Anniversaire</dt><dd>${esc(bday)}</dd></div>` : ''}
            </dl>
            ${bdg ? `<div class="idc-badges-zone"><span class="idc-k">Badges</span>${bdg}</div>` : ''}
          </div>
          <ul class="idc-stats" aria-label="Statistiques">
            ${STATS.map(([k, one, many]) => { const n = Number(stats[k]) || 0; return `<li><strong>${n}</strong><span>${n > 1 ? many : one}</span></li>`; }).join('')}
          </ul>
          <footer class="idc-foot" aria-hidden="true">
            <span class="idc-chip"><i></i><i></i><i></i><i></i></span>
            <span class="idc-barcode">${bars}</span>
            <span class="idc-serial">${esc(shortId(c.id))}</span>
          </footer>
        </div>
        <div class="idc-holo" aria-hidden="true"></div>
        <div class="idc-glare" aria-hidden="true"></div>
      </article>
    </div>
    <div class="btn-row mb-actions">
      ${isMe ? '' : `<a class="btn btn-primary" href="messages.html?to=${encodeURIComponent(c.id)}">${ICON.msg} Envoyer un message</a>`}
      <button class="btn ${isMe ? 'btn-primary' : 'btn-ghost'}" type="button" id="dl-card">${ICON.download} Télécharger la carte</button>
      ${isMe ? '<a class="btn btn-ghost" href="compte.html">Modifier mon profil</a>' : ''}
    </div>`;
}

function badgesHtml(c) {
  const list = Array.isArray(c.badges) ? c.badges : [];
  return `
    <h2 class="mb-section-title">${ICON.badge} Badges <span class="mb-count">${list.length}</span></h2>
    ${list.length ? `<ul class="badge-grid">
      ${list.map((b) => `
        <li class="badge-item" title="${esc(b.description || b.name)}">
          <span class="badge-img">${b.lv ? `<span class="badge-lvl" aria-hidden="true">${roman(b.level)}</span>` : ''}${b.image_url ? `<img src="${esc(b.image_url)}" alt="" loading="lazy" data-on-error="text" data-fallback="${esc(initials(b.name))}">` : esc(initials(b.name))}</span>
          <span class="badge-name">${esc(b.name)}</span>
          ${b.lv ? `${levelPipsHtml(b.lv, b.level, { max: 5 })}<span class="lvl-name">${esc(levelLabel(b.lv, b.level))}</span>` : ''}
          ${b.description ? `<span class="badge-desc">${esc(b.description)}</span>` : ''}
          ${b.awarded_at ? `<span class="badge-date">${esc(fmtDate(b.awarded_at))}</span>` : ''}
        </li>`).join('')}
    </ul>` : `<p class="empty">${isMe ? 'Pas encore de badge. Participe au Secret Santa, viens aux sorties, poste des photos…' : 'Pas encore de badge pour ce membre.'}</p>`}`;
}

/* ---------- Effet holographique (tilt 3D + reflet) ---------- */
function bindHolo() {
  const wrap = $('#idc-wrap'), card = $('#idc');
  if (!wrap || !card || reduced()) return;
  let raf = 0, last = null;
  const apply = () => {
    raf = 0;
    if (!last) return;
    const r = wrap.getBoundingClientRect();
    const px = Math.min(1, Math.max(0, (last.x - r.left) / r.width));
    const py = Math.min(1, Math.max(0, (last.y - r.top) / r.height));
    card.style.setProperty('--ry', `${((px - 0.5) * 16).toFixed(2)}deg`);
    card.style.setProperty('--rx', `${(-(py - 0.5) * 12).toFixed(2)}deg`);
    card.style.setProperty('--mx', `${(px * 100).toFixed(1)}%`);
    card.style.setProperty('--my', `${(py * 100).toFixed(1)}%`);
  };
  wrap.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch') return;
    card.classList.add('is-active');
    last = { x: e.clientX, y: e.clientY };
    if (!raf) raf = requestAnimationFrame(apply);
  });
  wrap.addEventListener('pointerleave', () => {
    last = null;
    card.classList.remove('is-active');
    ['--rx', '--ry'].forEach((k) => card.style.setProperty(k, '0deg'));
  });
}

/* =========================================================
   Export PNG haute définition (2000 × 1260, ratio carte bancaire)
   ========================================================= */
const CW = 2000, CH = 1260;

async function waitCardFonts() {
  if (!document.fonts?.load) return;
  const all = Promise.all([
    document.fonts.load(`400 100px ${DISPLAY}`, 'HG'),
    document.fonts.load(`400 60px ${PIXEL}`, '0123'),
    document.fonts.load(`700 60px ${PIXEL}`, '0123'),
    document.fonts.load(`500 40px ${BODY}`, 'Aa'),
    document.fonts.load(`700 40px ${BODY}`, 'Aa'),
  ]).catch(() => {});
  await Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
}
function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
/** Cadre « pixel » : rectangle aux coins en escalier. */
function pixelRect(ctx, x, y, w, h, s) {
  ctx.beginPath();
  ctx.moveTo(x + 2 * s, y); ctx.lineTo(x + w - 2 * s, y); ctx.lineTo(x + w - 2 * s, y + s); ctx.lineTo(x + w - s, y + s);
  ctx.lineTo(x + w - s, y + 2 * s); ctx.lineTo(x + w, y + 2 * s); ctx.lineTo(x + w, y + h - 2 * s); ctx.lineTo(x + w - s, y + h - 2 * s);
  ctx.lineTo(x + w - s, y + h - s); ctx.lineTo(x + w - 2 * s, y + h - s); ctx.lineTo(x + w - 2 * s, y + h); ctx.lineTo(x + 2 * s, y + h);
  ctx.lineTo(x + 2 * s, y + h - s); ctx.lineTo(x + s, y + h - s); ctx.lineTo(x + s, y + h - 2 * s); ctx.lineTo(x, y + h - 2 * s);
  ctx.lineTo(x, y + 2 * s); ctx.lineTo(x + s, y + 2 * s); ctx.lineTo(x + s, y + s); ctx.lineTo(x + 2 * s, y + s); ctx.closePath();
}
const spacing = (ctx, px) => { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; };
function fitText(ctx, text, maxW, font, start, min) {
  let s = start;
  for (; s > min; s -= 4) { ctx.font = font(s); if (ctx.measureText(text).width <= maxW) return s; }
  ctx.font = font(min);
  let t = text;
  while (t.length > 1 && ctx.measureText(`${t}…`).width > maxW) t = t.slice(0, -1);
  return { size: min, text: t === text ? t : `${t}…` };
}
function coverDraw(ctx, img, x, y, w, h) {
  const r = Math.max(w / img.width, h / img.height);
  const iw = img.width * r, ih = img.height * r;
  ctx.drawImage(img, x + (w - iw) / 2, y + (h - ih) / 2, iw, ih);
}

export async function renderIdCard(canvas, c) {
  const color = safeColor(c.color);
  const badges = (Array.isArray(c.badges) ? c.badges : []).slice(0, 6);
  const [, logo, avatar, ...bImgs] = await Promise.all([
    waitCardFonts(),
    loadImage(currentLogo(), { cors: true }),
    c.avatar_url ? loadImage(c.avatar_url, { cors: true }) : Promise.resolve(null),
    ...badges.map((b) => (b.image_url ? loadImage(b.image_url, { cors: true }) : Promise.resolve(null))),
  ]);
  canvas.width = CW; canvas.height = CH;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CW, CH);

  // Fond + découpe arrondie
  ctx.save();
  rr(ctx, 0, 0, CW, CH, 64); ctx.clip();
  const g = ctx.createLinearGradient(0, 0, CW, CH);
  g.addColorStop(0, '#221A1D'); g.addColorStop(0.55, '#141316'); g.addColorStop(1, '#0C0C0F');
  ctx.fillStyle = g; ctx.fillRect(0, 0, CW, CH);
  const halo = ctx.createRadialGradient(CW * 0.78, CH * 0.2, 10, CW * 0.78, CH * 0.2, 900);
  halo.addColorStop(0, `${color}33`); halo.addColorStop(1, `${color}00`);
  ctx.fillStyle = halo; ctx.fillRect(0, 0, CW, CH);
  // trame pixel discrète
  ctx.fillStyle = 'rgba(242,239,234,0.025)';
  for (let y = 0; y < CH; y += 20) for (let x = (y / 20) % 2 ? 0 : 10; x < CW; x += 20) ctx.fillRect(x, y, 6, 6);
  // reflet holographique figé
  const holo = ctx.createLinearGradient(0, 0, CW, CH);
  RAINBOW.forEach((r, i) => holo.addColorStop(i / (RAINBOW.length - 1), `${r}14`));
  ctx.fillStyle = holo; ctx.fillRect(0, 0, CW, CH);

  // En-tête
  ctx.imageSmoothingEnabled = false;
  if (logo) { const s = 170, r = Math.min(s / logo.width, s / logo.height); ctx.drawImage(logo, 90, 70 + (s - logo.height * r) / 2, logo.width * r, logo.height * r); }
  ctx.imageSmoothingEnabled = true;
  ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
  ctx.fillStyle = '#F2EFEA'; ctx.font = `400 74px ${DISPLAY}`; spacing(ctx, 2);
  ctx.fillText('HUMANE GANG', 300, 150);
  ctx.fillStyle = '#E2C77E'; ctx.font = `700 38px ${PIXEL}`; spacing(ctx, 6);
  ctx.fillText('CARTE DE MEMBRE', 302, 214);
  ctx.textAlign = 'right';
  ctx.fillStyle = '#ABA7A0'; ctx.font = `400 30px ${PIXEL}`; spacing(ctx, 4);
  ctx.fillText('N° DE MEMBRE', CW - 90, 120);
  ctx.fillStyle = '#F2EFEA'; ctx.font = `700 108px ${PIXEL}`; spacing(ctx, 6);
  ctx.fillText(num4(c.member_number), CW - 86, 226);
  spacing(ctx, 0);

  // Bande arc-en-ciel
  const bw = CW / RAINBOW.length;
  RAINBOW.forEach((r, i) => { ctx.fillStyle = r; ctx.fillRect(Math.floor(i * bw), 286, Math.ceil(bw) + 1, 26); });

  // Photo
  const ax = 90, ay = 380, as = 420;
  ctx.fillStyle = color; pixelRect(ctx, ax - 18, ay - 18, as + 36, as + 36, 14); ctx.fill();
  ctx.fillStyle = '#0E0E10'; pixelRect(ctx, ax - 6, ay - 6, as + 12, as + 12, 10); ctx.fill();
  ctx.save(); ctx.beginPath(); ctx.rect(ax, ay, as, as); ctx.clip();
  if (avatar) coverDraw(ctx, avatar, ax, ay, as, as);
  else {
    ctx.fillStyle = color; ctx.fillRect(ax, ay, as, as);
    ctx.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = ay; y < ay + as; y += 28) ctx.fillRect(ax, y, as, 14);
    ctx.fillStyle = '#F2EFEA'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `400 170px ${DISPLAY}`;
    ctx.fillText(initials(c.pseudo), ax + as / 2, ay + as / 2 + 6);
  }
  ctx.restore();

  // Champs
  const fx = 610, fw = 760;
  const label = (t, y) => { ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic'; ctx.fillStyle = '#ABA7A0'; ctx.font = `400 28px ${PIXEL}`; spacing(ctx, 4); ctx.fillText(t.toUpperCase(), fx, y); spacing(ctx, 0); };
  label('Pseudo', 420);
  ctx.fillStyle = '#F2EFEA';
  const pseudo = String(c.pseudo || '?');
  const fit = fitText(ctx, pseudo, fw, (s) => `400 ${s}px ${DISPLAY}`, 120, 56);
  ctx.fillText(typeof fit === 'object' ? fit.text : pseudo, fx, 540);
  ctx.fillStyle = color; ctx.fillRect(fx, 570, 120, 10);
  label('Membre depuis', 650);
  ctx.fillStyle = '#F2EFEA'; ctx.font = `700 52px ${BODY}`; ctx.fillText(sinceLabel(c.member_since, c.joined_on), fx, 715);
  const bday = birthdayLabel(c.birthday_dm);
  if (bday) { label('Anniversaire', 795); ctx.fillStyle = '#F2EFEA'; ctx.font = `700 52px ${BODY}`; ctx.fillText(bday, fx, 860); }

  // Badges (jusqu'à 6)
  const bx = 1440, by = 380;
  ctx.textAlign = 'left'; ctx.fillStyle = '#ABA7A0'; ctx.font = `400 28px ${PIXEL}`; spacing(ctx, 4);
  ctx.fillText(`BADGES · ${(c.badges || []).length}`, bx, 420); spacing(ctx, 0);
  if (!badges.length) { ctx.fillStyle = 'rgba(242,239,234,0.4)'; ctx.font = `500 34px ${BODY}`; ctx.fillText('À débloquer…', bx, 500); }
  badges.forEach((b, i) => {
    const cx = bx + 75 + (i % 3) * 160, cy = by + 150 + Math.floor(i / 3) * 170, r = 66;
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, r + 6, 0, Math.PI * 2); ctx.fillStyle = 'rgba(226,199,126,0.5)'; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fillStyle = '#1F1F23'; ctx.fill(); ctx.clip();
    const im = bImgs[i];
    if (im) coverDraw(ctx, im, cx - r, cy - r, r * 2, r * 2);
    else { ctx.fillStyle = '#E2C77E'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 46px ${BODY}`; ctx.fillText(initials(b.name), cx, cy + 2); }
    ctx.restore();
    if (b.lv) { // pastille de niveau (I, II, III…) en bas à droite du badge
      const t = roman(b.level);
      ctx.font = `700 30px ${PIXEL}`;
      const w = Math.max(48, ctx.measureText(t).width + 24), h = 40, x = cx + r - w + 14, y = cy + r - h + 10;
      ctx.fillStyle = '#141316'; pixelRect(ctx, x - 4, y - 4, w + 8, h + 8, 4); ctx.fill();
      ctx.fillStyle = '#E2C77E'; pixelRect(ctx, x, y, w, h, 4); ctx.fill();
      ctx.fillStyle = '#121212'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(t, x + w / 2, y + h / 2 + 2);
    }
  });

  // Statistiques
  const sy = 905, sh = 150, gap = 20, sw = (CW - 180 - gap * 4) / 5;
  STATS.forEach(([k, one, many], i) => {
    const x = 90 + i * (sw + gap), n = Number(c.stats?.[k]) || 0;
    ctx.fillStyle = 'rgba(242,239,234,0.05)'; pixelRect(ctx, x, sy, sw, sh, 8); ctx.fill();
    ctx.fillStyle = RAINBOW[i]; ctx.fillRect(x + 16, sy + 16, 30, 8);
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#F2EFEA'; ctx.font = `700 64px ${PIXEL}`; ctx.fillText(String(n), x + 16, sy + 98);
    ctx.fillStyle = '#ABA7A0'; ctx.font = `500 28px ${BODY}`; ctx.fillText(n > 1 ? many : one, x + 18, sy + 134);
  });

  // Pied : puce, code-barres, numéro de série
  const fy = 1110;
  ctx.fillStyle = '#C9A962'; pixelRect(ctx, 90, fy, 130, 96, 8); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 4;
  ctx.beginPath(); ctx.moveTo(90, fy + 48); ctx.lineTo(220, fy + 48); ctx.moveTo(155, fy); ctx.lineTo(155, fy + 96); ctx.stroke();
  let x = 280;
  const bars = barcode(c.id), unit = 640 / bars.reduce((a, b) => a + b, 0);
  ctx.fillStyle = 'rgba(242,239,234,0.75)';
  bars.forEach((w, i) => { if (i % 2 === 0) ctx.fillRect(x, fy + 8, w * unit, 80); x += w * unit; });
  ctx.textAlign = 'right'; ctx.fillStyle = '#ABA7A0'; ctx.font = `400 34px ${PIXEL}`; spacing(ctx, 4);
  ctx.fillText(shortId(c.id), CW - 90, fy + 64); spacing(ctx, 0);
  ctx.restore();

  // Liseré
  ctx.strokeStyle = 'rgba(242,239,234,0.14)'; ctx.lineWidth = 4;
  rr(ctx, 2, 2, CW - 4, CH - 4, 62); ctx.stroke();
}

async function onDownload(btn, card) {
  btn.disabled = true;
  const label = btn.innerHTML;
  btn.textContent = 'Préparation…';
  try {
    const canvas = document.createElement('canvas');
    await renderIdCard(canvas, card);
    const slug = String(card.pseudo || 'membre').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '').toLowerCase() || 'membre';
    await downloadCanvas(canvas, `carte-hg-${slug}-${num4(card.member_number)}.png`);
    toast('Carte téléchargée', 'ok');
    import('./sound.js').then((m) => m.playSound?.('success')).catch(() => {});
  } catch (e) {
    toast(`Téléchargement impossible : ${errMsg(e)}`, 'error');
  } finally {
    btn.disabled = false; btn.innerHTML = label;
  }
}

/* ---------- Annuaire ---------- */
async function loadGang() {
  const ul = $('#gang');
  try {
    const { data, error } = await sb.rpc('hg_members');
    if (error) throw error;
    const list = (data || []).slice().sort((a, b) => String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
    if (!list.length) { ul.innerHTML = '<li class="empty">Personne pour l\'instant.</li>'; return; }
    ul.innerHTML = list.map((m) => `
      <li><a class="gang-item${m.id === targetId ? ' is-current' : ''}" href="membre.html?id=${encodeURIComponent(m.id)}"${m.id === targetId ? ' aria-current="page"' : ''}>
        ${avatarHtml(m, 44)}
        <span class="gang-txt"><strong>${esc(m.pseudo)}${m.id === me.id ? ' <span class="gang-me">toi</span>' : ''}</strong>
          <span class="small muted">depuis ${esc(sinceLabel(m.member_since))}</span></span>
      </a></li>`).join('');
  } catch (e) {
    ul.innerHTML = `<li class="empty">Impossible de charger le gang (${esc(errMsg(e))}).</li>`;
  }
}

/* ---------- Niveaux des badges (hg_user_badges.level + hg_badges.levels) ---------- */
async function addBadgeLevels(card) {
  if (!Array.isArray(card.badges) || !card.badges.length) return;
  try {
    const [ub, bd] = await Promise.all([
      sb.from('hg_user_badges').select('badge_code, level').eq('user_id', card.id),
      sb.from('hg_badges').select('code, image_url, levels_enabled, levels'),
    ]);
    if (ub.error || bd.error) throw ub.error || bd.error;
    const lvl = new Map((ub.data || []).map((r) => [r.badge_code, Number(r.level) || 1]));
    const defs = new Map((bd.data || []).map((r) => [r.code, r]));
    card.badges = card.badges.map((b) => {
      const def = defs.get(b.code);
      if (!hasLevels(def)) return b;
      const level = lvl.get(b.code) || 1;
      return { ...b, level, lv: def, image_url: levelImage(def, level) || b.image_url };
    });
  } catch (e) { console.warn('[niveaux]', e?.message || e); }
}

/* ---------- Lancement ---------- */
shell();
const gangP = loadGang();
try {
  const { data, error } = await sb.rpc('hg_member_card', { p_user: targetId });
  if (error) throw error;
  const card = data && typeof data === 'object' ? data : null;
  if (card?.id) await addBadgeLevels(card);
  if (!card || !card.id) {
    $('#mb-main').innerHTML = `<div class="card mb-missing"><p class="empty">Ce membre est introuvable : le compte a peut-être été supprimé.</p>
      <div class="btn-row"><a class="btn btn-ghost" href="membre.html">Voir ma carte</a></div></div>`;
  } else {
    document.title = `${card.pseudo} · Carte de membre · Humane Gang`;
    $('#mb-title').textContent = isMe ? 'Ma carte' : card.pseudo;
    $('#mb-main').innerHTML = `<div class="mb-card-col">${cardHtml(card)}</div><div class="card mb-badges">${badgesHtml(card)}</div>`;
    bindHolo();
    $('#dl-card').addEventListener('click', (e) => onDownload(e.currentTarget, card));
    if (canAccess('cartes')) mountShowcase($('#mb-showcase'), { userId: card.id, isMe });
  }
} catch (e) {
  $('#mb-main').innerHTML = `<div class="card mb-missing"><p class="empty">Impossible de charger la carte (${esc(errMsg(e))}).</p></div>`;
}
await gangP;
$$('.idc-skeleton').forEach((n) => n.remove());
app.removeAttribute('aria-busy');
