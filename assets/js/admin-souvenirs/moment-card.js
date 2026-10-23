// =====================================================================
// Admin : transformer un souvenir (moment de l'historique) en carte (idée C5, migration 080).
// Fenêtre préremplie : nom = titre, famille « Moment », texte d'ambiance = première phrase (80 caractères),
// légende = date, image = photo du souvenir copiée dans hg-assets (pour qu'une suppression du souvenir ne casse pas
// la carte). Rareté suggérée selon le nombre de réactions. La carte garde le lien hg_cards.moment_id (un moment = une carte).
// Droits : permission « cartes » (RLS hg_cards et stockage hg-assets) ; « souvenirs » seule ne suffit pas.
// Exporte : momentCardsMap, openMomentCard, suggestRarity.
// =====================================================================
import { sb, esc, toast, errMsg } from '../core.js';
import { cardHtml, rarityLabel } from '../cartes-ui.js';
import { uploadCardImage } from '../admin-cards/helpers.js';
import { dayLabel } from './helpers.js';

const RARS = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire'];

/** Carte liée à chaque souvenir : Map(moment_id → { id, name, active }). Vide si la colonne n'existe pas encore. */
export async function momentCardsMap() {
  const { data, error } = await sb.from('hg_cards').select('id, name, active, moment_id').not('moment_id', 'is', null);
  return new Map(error ? [] : (data || []).filter((k) => k.moment_id).map((k) => [k.moment_id, k]));
}

/** Rareté suggérée selon les réactions : 0–4 commune, 5–9 peu commune, 10–24 rare, 25–49 épique, 50+ légendaire. */
export const suggestRarity = (n) => (n >= 50 ? 'legendaire' : n >= 25 ? 'epique' : n >= 10 ? 'rare' : n >= 5 ? 'peu_commune' : 'commune');

/** Première phrase du texte, coupée à 80 caractères. */
function firstSentence(body) {
  const t = String(body || '').replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const m = /^(.+?[.!?…])(\s|$)/.exec(t);
  const s = (m ? m[1] : t);
  return s.length > 80 ? s.slice(0, 79).trimEnd() + '…' : s;
}

/** Nombre de réactions actives d'un souvenir (0 si la lecture échoue). */
async function reactionsOf(id) {
  const { count, error } = await sb.from('hg_reactions').select('target_id', { count: 'exact', head: true }).eq('target_kind', 'moment').eq('target_id', id).eq('active', true);
  return error ? 0 : (count || 0);
}

/**
 * Ouvre la fenêtre « Nouvelle carte » depuis un souvenir.
 * @param {object} m souvenir (hg_moments)
 * @param {string|null} imageUrl URL signée de son image (aperçu et copie)
 * @param {(cardId: string) => void} onDone appelé après la création
 */
export async function openMomentCard(m, imageUrl, onDone) {
  const [setsRes, nReact] = await Promise.all([
    sb.from('hg_card_sets').select('id, code, name, booster_scope').order('sort'),
    reactionsOf(m.id),
  ]);
  const sets = (setsRes.data || []).filter((s) => s.booster_scope !== 'hors_boosters');
  const def = sets.find((s) => s.code === 'hors-serie') || sets[0];
  if (!def) { toast('Crée d’abord une série dans Jeu de cartes.', 'error'); return; }
  const sugg = suggestRarity(nReact);
  const dlg = document.createElement('dialog');
  dlg.className = 'hg-dialog sv-dialog sv-card-dlg';
  dlg.setAttribute('aria-labelledby', 'sv-kc-title');
  dlg.innerHTML = `<form class="sv-kc" novalidate>
    <div class="sv-kc-fields stack">
      <p class="sv-kc-kicker">Depuis le moment du ${esc(dayLabel(m.happened_on))}</p>
      <h2 id="sv-kc-title" class="dialog-title">Nouvelle carte</h2>
      <p class="form-error" role="alert" hidden></p>
      <div class="field"><label for="sv-kc-name">Nom</label><input id="sv-kc-name" name="name" maxlength="60" required value="${esc(String(m.title || '').slice(0, 60))}"></div>
      <div class="sv-form-row">
        <div class="field"><label for="sv-kc-fam">Famille</label><input id="sv-kc-fam" value="Moment" readonly></div>
        <div class="field"><label for="sv-kc-set">Série</label><select id="sv-kc-set" name="set_id">${sets.map((s) => `<option value="${esc(s.id)}"${s.id === def.id ? ' selected' : ''}>${esc(s.name)}</option>`).join('')}</select></div>
      </div>
      <fieldset class="sv-kc-rar"><legend>Rareté · suggérée : ${esc(rarityLabel(sugg))} (${nReact} réaction${nReact > 1 ? 's' : ''})</legend>
        ${RARS.map((r) => `<label class="sv-kc-chip"><input type="radio" name="rarity" value="${r}"${r === sugg ? ' checked' : ''}><span>${esc(rarityLabel(r))}</span></label>`).join('')}
      </fieldset>
      <div class="field"><label for="sv-kc-flavor">Texte d’ambiance (80 caractères)</label><textarea id="sv-kc-flavor" name="flavor" rows="2" maxlength="80">${esc(firstSentence(m.body))}</textarea></div>
      <div class="field"><label for="sv-kc-cap">Légende</label><input id="sv-kc-cap" name="caption" maxlength="80" value="${esc(dayLabel(m.happened_on))}"></div>
      <p class="small muted" id="sv-kc-img">${imageUrl ? 'Image copiée depuis le souvenir.' : 'Ce souvenir n’a pas d’image : la carte portera le logo du gang.'}</p>
      <label class="check"><input type="checkbox" name="tradeable" checked><span>Échangeable (décoche si le moment montre un membre qui préfère la garder pour lui)</span></label>
      <div class="btn-row dialog-actions">
        <button type="submit" class="btn btn-primary">Créer la carte</button>
        <button type="button" class="btn btn-ghost" data-kc-cancel>Annuler</button>
      </div>
    </div>
    <div class="sv-kc-prev"><p class="sv-kc-prev-h">Aperçu</p><div id="sv-kc-card"></div>
      <p class="small muted">Le moment affichera « En carte » dans l’historique.</p></div>
  </form>`;
  document.body.append(dlg);
  const form = dlg.querySelector('form');
  const E = form.elements;
  const setName = () => sets.find((s) => s.id === E.set_id.value)?.name || '';
  const paint = () => {
    dlg.querySelector('#sv-kc-card').innerHTML = cardHtml({ name: E.name.value.trim() || 'Nom de la carte', family: 'moment',
      rarity: form.querySelector('input[name=rarity]:checked')?.value || sugg, image_url: imageUrl, flavor: E.flavor.value.trim(),
      caption: E.caption.value.trim(), set_name: setName() }, { size: 'md' });
  };
  // Image trop petite : avertissement (les photos de l'historique sont parfois en basse définition).
  if (imageUrl) {
    const probe = new Image();
    probe.onload = () => { if (probe.naturalWidth && probe.naturalWidth < 600) dlg.querySelector('#sv-kc-img').textContent = `Image copiée depuis le souvenir (${probe.naturalWidth} px de large : un peu petite, elle peut paraître floue).`; };
    probe.src = imageUrl;
  }
  form.addEventListener('input', paint);
  dlg.querySelector('[data-kc-cancel]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => dlg.remove(), { once: true });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error');
    const show = (msg) => { err.textContent = msg; err.hidden = !msg; };
    const name = E.name.value.trim();
    if (name.length < 2) { show('Donne un nom à la carte (2 caractères minimum).'); E.name.focus(); return; }
    const btn = form.querySelector('[type=submit]');
    btn.disabled = true; show('');
    try {
      let image_url = null;
      if (imageUrl) {
        const blob = await (await fetch(imageUrl)).blob();
        image_url = await uploadCardImage(new File([blob], 'moment.' + ((blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg')), { type: blob.type || 'image/jpeg' }));
      }
      const { data: last } = await sb.from('hg_cards').select('number').eq('set_id', E.set_id.value).order('number', { ascending: false }).limit(1);
      const number = (Number(last?.[0]?.number) || 0) + 1;
      const row = { set_id: E.set_id.value, number, name, family: 'moment', rarity: form.querySelector('input[name=rarity]:checked').value,
        flavor: E.flavor.value.trim() || null, caption: E.caption.value.trim() || null, image_url, moment_id: m.id,
        tradeable: E.tradeable.checked, active: true };
      const { data, error } = await sb.from('hg_cards').insert(row).select('id').maybeSingle();
      if (error) throw error;
      toast(`Carte « ${name} » créée`, 'ok');
      dlg.close();
      onDone?.(data?.id || null);
    } catch (e2) {
      const dup = /hg_cards_moment_unique|23505/.test(String(e2?.code || '') + String(e2?.message || ''));
      show(dup ? 'Ce moment a déjà sa carte.' : errMsg(e2));
      btn.disabled = false;
    }
  });
  paint();
  dlg.showModal();
  E.name.focus();
}
