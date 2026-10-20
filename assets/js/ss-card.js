// ===== Human Gang — générateur de carte Secret Santa (canvas 1000x1400, ratio 5:7) =====
// Fonctions pures de rendu : aucune dépendance à Supabase, testables isolément.

export const CARD_W = 1000;
export const CARD_H = 1400;

const C = {
  bgTop: '#3A2228',
  bgBottom: '#140C0F',
  rose: '#E0909A',
  sand: '#E2C77E',
  text: '#F2EFEA',
  muted: '#C9B9B4',
  rainbow: ['#FE3104', '#FCA301', '#FBD32D', '#159946', '#2B5AE2', '#4E2398'],
};
const DISPLAY = '"Archivo Black", system-ui, sans-serif';
const BODY = 'Inter, system-ui, sans-serif';

/** Charge une image ; résout null en cas d'échec (jamais de rejet). */
export function loadImage(src, { cors = false, timeout = 12000 } = {}) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    if (cors) img.crossOrigin = 'anonymous';
    const t = setTimeout(() => resolve(null), timeout);
    img.onload = () => { clearTimeout(t); resolve(img); };
    img.onerror = () => { clearTimeout(t); resolve(null); };
    img.src = src;
  });
}

/** Attend les polices utilisées par la carte (sans bloquer plus de quelques secondes). */
export async function waitFonts() {
  if (!document.fonts?.load) return;
  const all = Promise.all([
    document.fonts.load(`400 120px ${DISPLAY}`, 'Aa'),
    document.fonts.load(`500 40px ${BODY}`, 'Aa'),
    document.fonts.load(`700 26px ${BODY}`, 'Aa'),
  ]).catch(() => {});
  await Promise.race([all, new Promise((r) => setTimeout(r, 4000))]);
}

function setup(canvas) {
  canvas.width = CARD_W;
  canvas.height = CARD_H;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, CARD_W, CARD_H);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  return ctx;
}

function spaced(ctx, px) { if ('letterSpacing' in ctx) ctx.letterSpacing = `${px}px`; }

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBackground(ctx, strength = 1) {
  const g = ctx.createLinearGradient(0, 0, CARD_W * 0.4, CARD_H);
  g.addColorStop(0, C.bgTop);
  g.addColorStop(1, C.bgBottom);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // halo doux au centre haut
  const h = ctx.createRadialGradient(CARD_W / 2, 360, 20, CARD_W / 2, 360, 620);
  h.addColorStop(0, 'rgba(224,144,154,0.16)');
  h.addColorStop(1, 'rgba(224,144,154,0)');
  ctx.fillStyle = h;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  // motif discret : treillis de losanges + petites étoiles à 4 branches
  ctx.save();
  ctx.strokeStyle = `rgba(242,239,234,${0.035 * strength})`;
  ctx.lineWidth = 2;
  const step = 90;
  for (let d = -CARD_H; d < CARD_W + CARD_H; d += step) {
    ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d + CARD_H, CARD_H); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(d, 0); ctx.lineTo(d - CARD_H, CARD_H); ctx.stroke();
  }
  ctx.fillStyle = `rgba(226,199,126,${0.09 * strength})`;
  for (let y = step / 2; y < CARD_H; y += step) {
    for (let x = (Math.round(y / step) % 2 ? 0 : step / 2); x <= CARD_W; x += step) {
      sparkle(ctx, x, y, 7);
    }
  }
  ctx.restore();
}

function sparkle(ctx, x, y, r) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.quadraticCurveTo(x, y, x, y + r);
  ctx.quadraticCurveTo(x, y, x - r, y);
  ctx.quadraticCurveTo(x, y, x, y - r);
  ctx.fill();
}

function drawRainbow(ctx, y, h) {
  const w = CARD_W / C.rainbow.length;
  C.rainbow.forEach((c, i) => { ctx.fillStyle = c; ctx.fillRect(Math.floor(i * w), y, Math.ceil(w) + 1, h); });
}

function drawFrame(ctx) {
  ctx.save();
  ctx.strokeStyle = 'rgba(224,144,154,0.28)';
  ctx.lineWidth = 2;
  roundRect(ctx, 44, 66, CARD_W - 88, CARD_H - 132, 28);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(224,144,154,0.12)';
  roundRect(ctx, 58, 80, CARD_W - 116, CARD_H - 160, 20);
  ctx.stroke();
  ctx.restore();
}

function drawLogo(ctx, logo, cx, cy, size) {
  if (!logo) return;
  const r = Math.min(size / logo.width, size / logo.height);
  const w = logo.width * r, h = logo.height * r;
  ctx.drawImage(logo, cx - w / 2, cy - h / 2, w, h);
}

function divider(ctx, y, color = 'rgba(226,199,126,0.55)') {
  ctx.save();
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(CARD_W / 2 - 170, y); ctx.lineTo(CARD_W / 2 - 22, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CARD_W / 2 + 22, y); ctx.lineTo(CARD_W / 2 + 170, y); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(CARD_W / 2, y - 10); ctx.lineTo(CARD_W / 2 + 10, y); ctx.lineTo(CARD_W / 2, y + 10); ctx.lineTo(CARD_W / 2 - 10, y); ctx.closePath(); ctx.fill();
  ctx.restore();
}

/** Écrit le pseudo le plus gros possible dans maxW (réduction puis retour à la ligne si nécessaire). */
function drawPseudo(ctx, text, cx, cy, maxW, { max = 168, min = 64, color = C.text } = {}) {
  const t = String(text || '?').trim().toUpperCase();
  ctx.save();
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  spaced(ctx, 1);
  let size = max;
  const fits = (s) => { ctx.font = `400 ${s}px ${DISPLAY}`; return ctx.measureText(t).width <= maxW; };
  while (size > min && !fits(size)) size -= 4;
  let lines = [t];
  if (!fits(size)) {
    // trop long même au minimum : découpe en lignes (par mots, sinon par caractères)
    ctx.font = `400 ${size}px ${DISPLAY}`;
    lines = [];
    const words = t.split(/\s+/);
    let cur = '';
    const pushChars = (w) => { let part = ''; for (const ch of w) { if (ctx.measureText(part + ch).width > maxW && part) { lines.push(part); part = ch; } else part += ch; } return part; };
    for (const w of words) {
      const next = cur ? `${cur} ${w}` : w;
      if (ctx.measureText(next).width <= maxW) cur = next;
      else { if (cur) lines.push(cur); cur = ctx.measureText(w).width > maxW ? pushChars(w) : w; }
    }
    if (cur) lines.push(cur);
  }
  ctx.font = `400 ${size}px ${DISPLAY}`;
  ctx.shadowColor = 'rgba(0,0,0,0.45)';
  ctx.shadowBlur = 24;
  ctx.shadowOffsetY = 6;
  const lh = size * 1.05;
  const top = cy - ((lines.length - 1) * lh) / 2;
  lines.forEach((l, i) => ctx.fillText(l, cx, top + i * lh));
  ctx.restore();
  return { size, lines: lines.length, height: lines.length * lh };
}

function drawCover(ctx, img) {
  const r = Math.max(CARD_W / img.width, CARD_H / img.height);
  const w = img.width * r, h = img.height * r;
  ctx.drawImage(img, (CARD_W - w) / 2, (CARD_H - h) / 2, w, h);
}

/**
 * Recto : « Tu offres à <pseudo> ».
 * opts : { pseudo, year, baseUrl, logoSrc, budget, exchangeDate (texte) }
 * Renvoie { usedBase: boolean } (false si l'image de base est absente ou n'a pas pu être chargée).
 */
export async function renderCardFront(canvas, opts = {}) {
  const { pseudo, year, baseUrl, logoSrc, budget, exchangeLabel } = opts;
  const [, base, logo] = await Promise.all([
    waitFonts(),
    baseUrl ? loadImage(baseUrl, { cors: true }) : Promise.resolve(null),
    loadImage(logoSrc),
  ]);
  const ctx = setup(canvas);

  if (base) {
    drawCover(ctx, base);
    // voile en bas pour garantir la lisibilité du pseudo
    const g = ctx.createLinearGradient(0, CARD_H * 0.5, 0, CARD_H);
    g.addColorStop(0, 'rgba(14,9,11,0)');
    g.addColorStop(0.35, 'rgba(14,9,11,0.72)');
    g.addColorStop(1, 'rgba(14,9,11,0.92)');
    ctx.fillStyle = g;
    ctx.fillRect(0, CARD_H * 0.5, CARD_W, CARD_H * 0.5);
    ctx.fillStyle = C.rose;
    ctx.font = `500 46px ${BODY}`;
    spaced(ctx, 1);
    ctx.fillText('Tu offres à', CARD_W / 2, CARD_H - 330);
    drawPseudo(ctx, pseudo, CARD_W / 2, CARD_H - 205, CARD_W - 160, { max: 150 });
    return { usedBase: true };
  }

  drawBackground(ctx);
  drawRainbow(ctx, 0, 22);
  drawRainbow(ctx, CARD_H - 10, 10);
  drawFrame(ctx);

  drawLogo(ctx, logo, CARD_W / 2, 290, 250);

  ctx.fillStyle = C.sand;
  ctx.font = `700 26px ${BODY}`;
  spaced(ctx, 9);
  ctx.fillText(`SECRET SANTA${year ? ` · ${year}` : ''}`, CARD_W / 2, logo ? 480 : 400);
  spaced(ctx, 0);

  divider(ctx, 560);

  ctx.fillStyle = C.rose;
  ctx.font = `500 50px ${BODY}`;
  spaced(ctx, 1);
  ctx.fillText('Tu offres à', CARD_W / 2, 690);
  spaced(ctx, 0);

  drawPseudo(ctx, pseudo, CARD_W / 2, 860, CARD_W - 200);

  divider(ctx, 1040, 'rgba(224,144,154,0.4)');

  ctx.fillStyle = C.muted;
  ctx.font = `500 30px ${BODY}`;
  const facts = [budget ? `Budget ${budget}` : '', exchangeLabel ? `Échange le ${exchangeLabel}` : ''].filter(Boolean).join('   ·   ');
  if (facts) ctx.fillText(facts, CARD_W / 2, 1120);

  ctx.fillStyle = 'rgba(242,239,234,0.55)';
  ctx.font = `700 22px ${BODY}`;
  spaced(ctx, 7);
  ctx.fillText('GARDE LE SECRET', CARD_W / 2, 1240);
  spaced(ctx, 0);
  return { usedBase: false };
}

/** Verso (face cachée) : logo + motif. */
export async function renderCardBack(canvas, { logoSrc, year } = {}) {
  const [, logo] = await Promise.all([waitFonts(), loadImage(logoSrc)]);
  const ctx = setup(canvas);
  drawBackground(ctx, 2.2);
  drawRainbow(ctx, 0, 22);
  drawRainbow(ctx, CARD_H - 22, 22);
  drawFrame(ctx);

  // médaillon central
  ctx.save();
  ctx.fillStyle = 'rgba(20,12,15,0.55)';
  ctx.strokeStyle = 'rgba(226,199,126,0.45)';
  ctx.lineWidth = 3;
  ctx.beginPath(); ctx.arc(CARD_W / 2, CARD_H / 2 - 40, 250, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = 'rgba(226,199,126,0.18)';
  ctx.beginPath(); ctx.arc(CARD_W / 2, CARD_H / 2 - 40, 272, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  if (logo) drawLogo(ctx, logo, CARD_W / 2, CARD_H / 2 - 40, 330);
  else {
    ctx.fillStyle = C.text; ctx.font = `400 90px ${DISPLAY}`; ctx.textBaseline = 'middle';
    ctx.fillText('HG', CARD_W / 2, CARD_H / 2 - 40); ctx.textBaseline = 'alphabetic';
  }

  ctx.fillStyle = C.sand;
  ctx.font = `700 26px ${BODY}`;
  spaced(ctx, 9);
  ctx.fillText(`SECRET SANTA${year ? ` · ${year}` : ''}`, CARD_W / 2, CARD_H / 2 + 330);
  ctx.fillStyle = 'rgba(242,239,234,0.5)';
  ctx.font = `700 20px ${BODY}`;
  spaced(ctx, 6);
  ctx.fillText('HUMAN GANG', CARD_W / 2, CARD_H / 2 + 380);
  spaced(ctx, 0);
}

/** Exporte le canvas en PNG et déclenche le téléchargement. Rejette si le canvas est « contaminé » (CORS). */
export function downloadCanvas(canvas, filename) {
  return new Promise((resolve, reject) => {
    try {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Export de l’image impossible'));
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = filename;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
        resolve();
      }, 'image/png');
    } catch (e) { reject(e); }
  });
}
