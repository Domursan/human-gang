// Cartes admin : chargement des données et rafraîchissement de la section.
import { sb, toast, errMsg, esc } from '../core.js';
import { C, H } from './state.js';
import { check, group, fetchAll } from './helpers.js';

/* ---------- Chargement ---------- */
async function load() {
  const [sets, cards, copies, wallets, trades, profiles, st] = await Promise.all([
    fetchAll(() => sb.from('hg_card_sets').select('*').order('id')),
    fetchAll(() => sb.from('hg_cards').select('*').order('id')),
    fetchAll(() => sb.from('hg_card_copies').select('id, card_id, owner_id, shiny, serial, source, obtained_at, locked_trade, recycled_at').order('id')),
    fetchAll(() => sb.from('hg_wallets').select('user_id, paillettes, boosters_opened, pity_epique').order('user_id')),
    fetchAll(() => sb.from('hg_card_trades').select('id, from_user, to_user, status, from_paillettes, to_paillettes, message, created_at').order('id')),
    sb.rpc('hg_staff_directory'),
    sb.from('hg_settings').select('value').eq('key', 'cards').maybeSingle(),
  ]);
  const stv = check(st);
  C.sets = sets.sort((a, b) => (a.sort - b.sort) || a.code.localeCompare(b.code));
  C.cards = cards;
  C.copies = copies;
  C.wallets = wallets;
  C.trades = trades;
  C.profiles = (check(profiles) ?? []).sort((a, b) => a.pseudo.localeCompare(b.pseudo, 'fr'));
  C.cfgRaw = stv?.value && typeof stv.value === 'object' && !Array.isArray(stv.value) ? structuredClone(stv.value) : {};
  C.setById = new Map(C.sets.map((s) => [s.id, s]));
  C.cardById = new Map(cards.map((k) => [k.id, k]));
  C.copiesByCard = group(copies, (x) => x.card_id);
  C.copiesByOwner = group(copies.filter((x) => x.owner_id && !x.recycled_at), (x) => x.owner_id);
  C.walletById = new Map(wallets.map((w) => [w.user_id, w]));
  C.byId = new Map(C.profiles.map((p) => [p.id, p]));
  const openIds = trades.filter((t) => t.status === 'proposee').map((t) => t.id);
  C.items = openIds.length ? (check(await sb.from('hg_card_trade_items').select('trade_id, side').in('trade_id', openIds)) ?? []) : [];
  if (!C.sets.some((s) => s.id === C.identSet)) C.identSet = C.sets[0]?.id || '';
}
export async function refresh() {
  try { await load(); H.render(); } catch (e) { toast(errMsg(e), 'error'); }
}
export async function boot() {
  C.panel.innerHTML = '<div class="empty">Chargement…</div>';
  try { await load(); H.render(); } catch (e) {
    C.panel.innerHTML = `<div class="empty">Impossible de charger les cartes : ${esc(errMsg(e))}
      <div class="btn-row acd-center"><button class="btn btn-ghost btn-sm" type="button" data-act="retry">Réessayer</button></div></div>`;
  }
}
