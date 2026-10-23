// =====================================================================
// Admin : sorties IRL — section « Carte de la sortie » (idée C4, migration 080).
// Créer ou modifier la carte « J’y étais » (titre, rareté suggérée selon le nombre d'inscrits « Je viens », image =
// couverture de la sortie copiée dans hg-assets, texte d'ambiance, échangeable ou non), voir qui l'a reçue et ajouter
// un présent qui n'avait pas répondu. RPC : hg_event_card_set (distribue tout de suite si la sortie est passée),
// hg_event_card_add (journalisée). Lecture : hg_cards, hg_event_card_claims.
// Exporte : mountCarte.
// =====================================================================
import { sb, toast, errMsg, esc } from '../core.js';
import { cardHtml, rarityLabel } from '../cartes-ui.js';
import { signedUrls } from '../photos.js';
import { uploadCardImage } from '../admin-cards/helpers.js';
import { pluralCount } from '../utils.js';

const RARS = ['commune', 'peu_commune', 'rare', 'epique', 'legendaire'];
/** Rareté suggérée selon la taille de la sortie (inscrits « Je viens »). */
export const suggestRarity = (n) => (n >= 12 ? 'epique' : n >= 7 ? 'rare' : n >= 4 ? 'peu_commune' : 'commune');

/**
 * Monte la section dans host (elle se charge et se dessine seule).
 * @param {HTMLElement|null} host conteneur
 * @param {object} ev sortie
 * @param {{ members: Map, rsvps: object[] }} S état de la section Sorties
 * @param {() => Promise<void>} reload recharge la section après une écriture
 */
export async function mountCarte(host, ev, S, reload) {
  if (!host) return;
  let card = null, claims = [];
  if (ev.card_id) {
    const [k, c] = await Promise.all([
      sb.from('hg_cards').select('*').eq('id', ev.card_id).maybeSingle(),
      sb.from('hg_event_card_claims').select('user_id, added_by, created_at').eq('event_id', ev.id),
    ]);
    card = k.data || null;
    claims = c.data || [];
  }
  if (!host.isConnected) return;
  const going = S.rsvps.filter((r) => r.event_id === ev.id && r.status === 'oui').length;
  const sugg = card?.rarity || suggestRarity(going);
  const pseudo = (id) => S.members.get(id)?.pseudo || 'Ancien membre';
  const got = new Set(claims.map((c) => c.user_id));
  const addable = [...S.members.values()].filter((m) => !m.is_ghost && !got.has(m.id)).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  const past = ev.starts_at && new Date(ev.starts_at).getTime() <= Date.now();
  const locked = claims.length > 0;
  host.innerHTML = `<h3 class="ass-h" id="ass-d-carte-h">Carte de la sortie <span class="muted">· « J’y étais »</span></h3>
    <p class="small muted">Reçue le lendemain de la sortie par chaque membre qui avait répondu « Je viens » lui-même. Jamais dans un booster, jamais fabriquée.</p>
    <div class="ass-jy">
      <div class="ass-jy-prev" id="ass-jy-prev">${cardHtml(card || { name: ev.title, family: 'lieu', rarity: sugg }, { size: 'sm', stamp: true })}</div>
      <form class="stack ass-jy-form" data-jy-form novalidate>
        <div class="field"><label for="ass-jy-name">Nom de la carte</label><input id="ass-jy-name" name="name" maxlength="60" value="${esc(card?.name || String(ev.title || '').slice(0, 60))}"></div>
        <div class="field"><label for="ass-jy-rar">Rareté <span class="muted small">(suggérée : ${esc(rarityLabel(suggestRarity(going)))}, ${esc(pluralCount(going, 'inscrit', 'inscrits'))})</span></label>
          <select id="ass-jy-rar" name="rarity"${locked ? ' disabled aria-describedby="ass-jy-rar-h"' : ''}>${RARS.map((r) => `<option value="${r}"${r === sugg ? ' selected' : ''}>${esc(rarityLabel(r))}</option>`).join('')}</select>
          ${locked ? '<span class="small muted" id="ass-jy-rar-h">Déjà distribuée : la rareté ne change plus.</span>' : ''}</div>
        <div class="field"><label for="ass-jy-flavor">Texte d’ambiance (facultatif)</label><input id="ass-jy-flavor" name="flavor" maxlength="120" value="${esc(card?.flavor || '')}"></div>
        ${ev.cover_path ? `<label class="check"><input type="checkbox" name="cover"${card?.image_url ? '' : ' checked'}><span>${card?.image_url ? 'Remplacer l’image par la couverture de la sortie' : 'Image : la couverture de la sortie'}</span></label>` : '<p class="small muted">Sans couverture, la carte porte le logo du gang.</p>'}
        <label class="check"><input type="checkbox" name="tradeable"${card?.tradeable ? ' checked' : ''}><span>Échangeable (par défaut non : c’est un souvenir)</span></label>
        <div class="btn-row"><button class="btn btn-primary btn-sm" type="submit" data-key="jy-save">${card ? 'Enregistrer la carte' : 'Créer la carte'}</button></div>
      </form>
    </div>
    ${card ? `<div class="ass-jy-who">
      <h4 class="ass-h-sm">Reçue par <span class="muted">(${claims.length})</span></h4>
      ${claims.length ? `<p class="small">${claims.map((c) => esc(pseudo(c.user_id)) + (c.added_by ? ' <span class="muted">(ajouté)</span>' : '')).join(', ')}</p>` : `<p class="small muted">${past ? 'Personne pour l’instant.' : 'Distribution le lendemain de la sortie.'}</p>`}
      ${past && addable.length ? `<form class="ass-inline" data-jy-add>
        <div class="field"><label for="ass-jy-add">Il était là aussi</label><select id="ass-jy-add" name="user">${addable.map((m) => `<option value="${esc(m.id)}">${esc(m.pseudo)}</option>`).join('')}</select></div>
        <button class="btn btn-ghost btn-sm" type="submit" data-key="jy-add">Ajouter</button>
      </form>` : ''}
    </div>` : ''}`;

  host.querySelector('[data-jy-form]').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = e.target, E = f.elements;
    const btn = f.querySelector('[type=submit]');
    btn.disabled = true;
    try {
      const p = { name: E.name.value.trim(), flavor: E.flavor.value.trim(), tradeable: E.tradeable.checked };
      if (!E.rarity.disabled) p.rarity = E.rarity.value;
      if (E.cover?.checked && ev.cover_path) {
        const url = (await signedUrls([ev.cover_path])).get(ev.cover_path);
        if (url) {
          const blob = await (await fetch(url)).blob();
          p.image_url = await uploadCardImage(new File([blob], 'sortie.jpg', { type: blob.type || 'image/jpeg' }));
        }
      }
      const { data, error } = await sb.rpc('hg_event_card_set', { p_event: ev.id, p });
      if (error) throw error;
      toast(data?.given ? `Carte enregistrée et donnée à ${pluralCount(data.given, 'membre', 'membres')}` : 'Carte enregistrée', 'ok');
      await reload();
    } catch (err) {
      toast(`Action impossible : ${errMsg(err)}`, 'error');
      btn.disabled = false;
    }
  });
  host.querySelector('[data-jy-add]')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector('[type=submit]');
    btn.disabled = true;
    const { error } = await sb.rpc('hg_event_card_add', { p_event: ev.id, p_user: e.target.elements.user.value });
    if (error) { toast(`Action impossible : ${errMsg(error)}`, 'error'); btn.disabled = false; return; }
    toast('Carte « J’y étais » ajoutée', 'ok');
    await reload();
  });
}
