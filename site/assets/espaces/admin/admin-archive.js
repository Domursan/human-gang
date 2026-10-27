// =====================================================================
// Admin : Site › Fonctionnement › Archives (idée A8). Réservé à l'administrateur.
// Télécharge une année complète du gang en ZIP (fonction edge hg-archive) : page /index.html lisible hors ligne,
// un dossier par sortie avec ses photos, les données en JSON et un LISEZ-MOI.txt. Au-delà de 300 Mo de photos,
// l'archive arrive en plusieurs parties (« partie 1 / 3 ») : on les télécharge l'une après l'autre.
// Exclusions (faites en base, hg_archive_year) : messages privés, souhaits et messages du Secret Santa, e-mails,
// anniversaires, RSVP détaillés, contenus masqués. Chaque export est journalisé (hg_admin_log « archive_annuelle »).
// Dépendances : core.js (sb, toast, errMsg, esc), config.js (adresse et clé publique). Exporte : mountArchiveSection.
// =====================================================================
import { sb, toast, errMsg, esc } from '../../commun/core.js';
import { SUPABASE_URL, SUPABASE_KEY } from '../../commun/config.js';

// Première année proposée, et les parties de l'archive (clé envoyée à la fonction, libellé).
const FIRST_YEAR = 2022;
const PARTS = [
  ['moments', 'Moments et réactions'],
  ['sorties', 'Sorties IRL et leurs albums photo'],
  ['secret_santa', 'Secret Santa (paires révélées seulement)'],
  ['cartes', 'Cartes créées cette année-là'],
  ['recap', 'Récap annuel'],
];

/**
 * Demande une partie de l'archive à la fonction edge. Renvoie le fichier et le nombre total de parties.
 * @param {number} year Année.
 * @param {string[]} parts Parties choisies.
 * @param {number} part Numéro de la partie (1 = la première, avec /index.html et les données).
 * @returns {Promise<{blob: Blob, total: number, name: string}>}
 */
async function fetchPart(year, parts, part) {
  const { data: { session } } = await sb.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error('session expirée, reconnecte-toi');
  const res = await fetch(`${SUPABASE_URL}/functions/v1/hg-archive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, apikey: SUPABASE_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ year, parts, part }),
  });
  if (!res.ok) {
    let msg = `erreur ${res.status}`;
    try { msg = (await res.json()).error || msg; } catch { /* réponse non JSON */ }
    throw new Error(msg);
  }
  const total = Math.max(1, Number(res.headers.get('X-Archive-Parts')) || 1);
  const name = total > 1 ? `Humane Gang - ${year} (partie ${part} sur ${total}).zip` : `Humane Gang - ${year}.zip`;
  return { blob: await res.blob(), total, name };
}

/** Propose le fichier au navigateur (lien temporaire). */
function save(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

/**
 * Télécharge toute l'archive, partie après partie. `say` affiche l'avancement.
 * @returns {Promise<number>} Nombre de parties téléchargées.
 */
async function download(year, parts, say) {
  say(`Préparation de l’archive ${year}…`);
  const first = await fetchPart(year, parts, 1);
  save(first.blob, first.name);
  for (let i = 2; i <= first.total; i++) {
    say(`Partie ${i} sur ${first.total}…`);
    const p = await fetchPart(year, parts, i);
    save(p.blob, p.name);
  }
  return first.total;
}

/** Point d'entrée (admin.js, première visite de Site › Archives). */
export function mountArchiveSection(root) {
  if (!root) return;
  const now = new Date().getFullYear();
  const years = [];
  for (let y = now; y >= FIRST_YEAR; y--) years.push(y);
  root.innerHTML = `<form class="card ar-card" id="ar-form" novalidate>
      <h3 class="card-title">Archives</h3>
      <p class="small muted">Télécharge une année complète du gang en un ZIP à ranger hors du site (disque, cloud personnel) :
        une page <span class="code">/index.html</span> lisible hors ligne, un dossier par sortie avec ses photos, les données en JSON et un LISEZ-MOI.
        Au-delà de 300 Mo de photos, l’archive arrive en plusieurs parties.</p>
      <div class="ar-row">
        <div class="field"><label for="ar-year">Année</label>
          <select id="ar-year" name="year">${years.map((y) => `<option value="${y}">${y}</option>`).join('')}</select></div>
      </div>
      <fieldset class="ar-parts"><legend>Contenu</legend>
        ${PARTS.map(([k, l]) => `<label class="check"><input type="checkbox" name="parts" value="${k}" checked><span>${esc(l)}</span></label>`).join('')}
      </fieldset>
      <p class="small muted">Jamais dans l’archive : messages privés, souhaits et messages anonymes du Secret Santa, e-mails, anniversaires,
        réponses détaillées aux sorties, contenus masqués par le Staff. Le ZIP contient des photos de membres : garde-le privé.</p>
      <p class="form-error" role="alert" hidden></p>
      <div class="btn-row"><button type="submit" class="btn btn-primary">Télécharger l’archive</button></div>
      <p class="small ar-progress" aria-live="polite"></p>
    </form>`;
  const form = root.querySelector('#ar-form');
  const err = form.querySelector('.form-error');
  const prog = form.querySelector('.ar-progress');
  const btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const parts = [...form.querySelectorAll('input[name="parts"]:checked')].map((i) => i.value);
    err.hidden = true;
    if (!parts.length) { err.textContent = 'Choisis au moins une partie.'; err.hidden = false; return; }
    const year = Number(form.elements.year.value);
    btn.disabled = true;
    try {
      const n = await download(year, parts, (t) => { prog.textContent = t; });
      prog.textContent = n > 1 ? `Archive ${year} téléchargée en ${n} parties.` : `Archive ${year} téléchargée.`;
      toast('Archive téléchargée', 'ok');
    } catch (ex) {
      prog.textContent = '';
      err.textContent = `Téléchargement impossible : ${errMsg(ex)}`;
      err.hidden = false;
    } finally { btn.disabled = false; }
  });
}
