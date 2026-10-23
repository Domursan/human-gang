// ===== Humane Gang — fonction edge « hg-archive » : logique pure (sans réseau) =====
// Rôle : découper l'archive en parties (par sorties entières, sous le plafond de taille), nommer les fichiers du ZIP,
// et produire la page index.html (lisible hors ligne) et le LISEZ-MOI.txt. Testé avec Node (tests/hg-archive-lib.mjs).
// Aucune dépendance. Exporte : slug, esc, partition, photoName, momentImageName, indexHtml, readme.

/** Données renvoyées par hg_archive_year (migration 093), déjà filtrées en base. */
export type Photo = { id: string; path: string; caption?: string | null; created_at?: string; author?: string; reactions?: Record<string, number> };
export type Sortie = { id: string; title: string; location?: string | null; starts_at: string; description?: string | null; participants?: number; photos?: Photo[] };
export type Moment = { id: string; title: string; body?: string | null; happened_on: string; image_path?: string | null; author?: string; reactions?: Record<string, number> };
export type Archive = {
  year: number; parts: string[]; generated_at?: string;
  moments?: Moment[]; sorties?: Sortie[];
  secret_santa?: { year: number; status: string; budget?: string | null; exchange_date?: string | null; participants: number; pairs: { giver: string; receiver: string }[] } | null;
  cartes?: { name: string; number: number; family?: string; rarity?: string; set?: string | null; flavor?: string | null }[];
  recap?: Record<string, unknown>;
};

/** Nom de fichier sûr : sans accents ni espaces, minuscules, 50 caractères au plus. */
export const slug = (s: string, fallback = 'element') =>
  String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').toLowerCase().slice(0, 50) || fallback;

/** Échappement HTML. */
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

/** Dossier d'une sortie dans le ZIP : « sorties/2026-03-14-rdv-de-lyon/ ». */
export const sortieDir = (s: Sortie) => `sorties/${String(s.starts_at).slice(0, 10)}-${slug(s.title, 'sortie')}`;
/** Nom d'une photo dans le dossier de sa sortie (numéro d'ordre + nom d'origine). */
export const photoName = (s: Sortie, i: number, p: Photo) => `${sortieDir(s)}/${String(i + 1).padStart(3, '0')}-${slug(p.path.split('/').pop()!.replace(/\.[^.]+$/, ''), 'photo')}${ext(p.path)}`;
/** Image d'un moment : « moments/2026-01-05-titre.jpg ». */
export const momentImageName = (m: Moment) => `moments/${m.happened_on}-${slug(m.title, 'moment')}${ext(m.image_path || '')}`;
function ext(path: string) { const m = /\.[A-Za-z0-9]{2,5}$/.exec(path); return m ? m[0].toLowerCase() : '.jpg'; }

/**
 * Découpe les sorties en parties dont les photos tiennent sous maxBytes (sorties entières ; une sortie plus lourde
 * que le plafond forme sa propre partie). La partie 1 contient aussi index.html, les données et les moments.
 * @param sorties Sorties dans l'ordre chronologique.
 * @param sizeOf Taille d'une photo (octets), 0 si inconnue.
 * @param maxBytes Plafond par partie.
 * @param firstExtra Octets déjà pris dans la partie 1 (images des moments).
 * @returns Liste des parties, chacune = identifiants des sorties.
 */
export function partition(sorties: Sortie[], sizeOf: (p: Photo) => number, maxBytes: number, firstExtra = 0): string[][] {
  const parts: string[][] = [[]];
  let used = firstExtra;
  for (const s of sorties) {
    const w = (s.photos || []).reduce((n, p) => n + (sizeOf(p) || 0), 0);
    const cur = parts[parts.length - 1];
    if (used + w > maxBytes && (cur.length || used > 0)) { parts.push([s.id]); used = w; }
    else { cur.push(s.id); used += w; }
  }
  return parts;
}

const dFmt = (iso: string) => new Date(iso).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Europe/Zurich' });
const reacts = (r?: Record<string, number>) => Object.entries(r || {}).map(([e, n]) => `${esc(e)} ${n}`).join(' · ');

/**
 * Page index.html de l'archive : frise de l'année, moments avec leurs images, sorties (dates, lieux, participants,
 * photos), Secret Santa, cartes, récap. Tout en local (aucune ressource externe).
 * @param a Données de l'année.
 * @param partOf Sortie → numéro de partie (pour dire où sont ses photos).
 */
export function indexHtml(a: Archive, partOf: Map<string, number>, total: number): string {
  const ms = a.moments || [], ss = a.sorties || [];
  const frise = [
    ...ms.map((m) => ({ d: m.happened_on, t: `Moment · ${m.title}` })),
    ...ss.map((s) => ({ d: String(s.starts_at).slice(0, 10), t: `Sortie · ${s.title}${s.location ? ` (${s.location})` : ''}` })),
  ].sort((x, y) => x.d.localeCompare(y.d));
  const santa = a.secret_santa;
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Humane Gang – ${a.year}</title>
<style>
body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#0E0E10;color:#F2EFEA}main{max-width:900px;margin:0 auto;padding:24px 16px}
h1{font-size:32px;margin:0 0 4px}h2{margin:32px 0 8px;border-bottom:1px solid #2A2A2F;padding-bottom:4px}h3{margin:16px 0 4px}
.muted{color:#ABA7A0}ol.frise{padding-left:20px}img{max-width:100%;border-radius:10px}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px}
.card{background:#17171A;border:1px solid #2A2A2F;border-radius:14px;padding:12px 14px;margin:10px 0}a{color:#E2C77E}
</style></head><body><main>
<h1>Humane Gang – ${a.year}</h1>
<p class="muted">Archive générée le ${esc(dFmt(a.generated_at || new Date().toISOString()))}${total > 1 ? ` · en ${total} parties : les photos de certaines sorties sont dans les autres ZIP` : ''}.</p>
${frise.length ? `<h2>Frise de l’année</h2><ol class="frise">${frise.map((f) => `<li><span class="muted">${esc(dFmt(f.d))}</span> · ${esc(f.t)}</li>`).join('')}</ol>` : ''}
${a.parts.includes('moments') ? `<h2>Moments</h2>${ms.length ? ms.map((m) => `<div class="card"><h3>${esc(m.title)}</h3>
  <p class="muted">${esc(dFmt(m.happened_on))}${m.author ? ` · raconté par ${esc(m.author)}` : ''}</p>
  ${m.image_path ? `<img src="${esc(momentImageName(m))}" alt="" loading="lazy">` : ''}${m.body ? `<p>${esc(m.body)}</p>` : ''}
  ${reacts(m.reactions) ? `<p class="muted">${reacts(m.reactions)}</p>` : ''}</div>`).join('') : '<p class="muted">Aucun moment cette année.</p>'}` : ''}
${a.parts.includes('sorties') ? `<h2>Sorties IRL</h2>${ss.length ? ss.map((s) => {
    const part = partOf.get(s.id) || 1;
    const ph = s.photos || [];
    return `<div class="card"><h3>${esc(s.title)}</h3><p class="muted">${esc(dFmt(s.starts_at))}${s.location ? ` · ${esc(s.location)}` : ''} · ${s.participants ?? 0} participant${(s.participants ?? 0) > 1 ? 's' : ''} · ${ph.length} photo${ph.length > 1 ? 's' : ''}</p>
    ${s.description ? `<p>${esc(s.description)}</p>` : ''}
    ${ph.length ? (part === 1 ? `<div class="grid">${ph.map((p, i) => `<a href="${esc(photoName(s, i, p))}"><img src="${esc(photoName(s, i, p))}" alt="${esc(p.caption || '')}" loading="lazy"></a>`).join('')}</div>`
      : `<p class="muted">Photos dans la partie ${part} (dossier ${esc(sortieDir(s))}).</p>`) : ''}</div>`;
  }).join('') : '<p class="muted">Aucune sortie cette année.</p>'}` : ''}
${a.parts.includes('secret_santa') ? `<h2>Secret Santa</h2>${santa ? `<p>${santa.participants} participant${santa.participants > 1 ? 's' : ''}${santa.budget ? ` · budget ${esc(santa.budget)}` : ''}</p>
  ${santa.pairs.length ? `<ul>${santa.pairs.map((p) => `<li>${esc(p.giver)} → ${esc(p.receiver)}</li>`).join('')}</ul>` : '<p class="muted">Paires pas encore révélées.</p>'}` : '<p class="muted">Pas d’édition cette année.</p>'}` : ''}
${a.parts.includes('cartes') ? `<h2>Cartes créées</h2>${(a.cartes || []).length ? `<ul>${(a.cartes || []).map((c) => `<li>${esc(c.set || '')} n° ${c.number} · ${esc(c.name)}${c.rarity ? ` <span class="muted">(${esc(c.rarity)})</span>` : ''}</li>`).join('')}</ul>` : '<p class="muted">Aucune carte créée cette année.</p>'}` : ''}
${a.parts.includes('recap') ? `<h2>Récap</h2><p class="muted">Les chiffres de l’année sont dans <a href="donnees/recap.json">donnees/recap.json</a>.</p>` : ''}
</main></body></html>`;
}

/** LISEZ-MOI.txt de chaque partie. */
export function readme(year: number, part: number, total: number): string {
  return [
    `Humane Gang – archive ${year}${total > 1 ? ` (partie ${part} sur ${total})` : ''}`,
    '',
    part === 1 ? 'Ouvre index.html dans un navigateur : tout fonctionne hors ligne.' : 'Cette partie contient des photos de sorties ; la page index.html est dans la partie 1.',
    'Les données brutes sont dans le dossier « donnees » (JSON), pour pouvoir tout recharger un jour.',
    '',
    'Ce ZIP contient des photos des membres du gang : garde-le privé, ne le publie pas.',
    'Jamais dans l’archive : messages privés, souhaits et messages anonymes du Secret Santa, e-mails, anniversaires,',
    'réponses détaillées aux sorties, contenus masqués par le Staff.',
    '',
  ].join('\r\n');
}
