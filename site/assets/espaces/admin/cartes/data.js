// =====================================================================
// Cartes admin : chargement des données et rafraîchissement de la section.
// Lit les tables des cartes en pages de 1000 lignes (fetchAll), puis construit les index utilisés partout.
// Dépendances : core.js (sb, toast, errMsg, esc), state.js (C, H), helpers.js (check, group, fetchAll).
// Lit : hg_card_sets, hg_cards, hg_card_copies, hg_wallets, hg_card_trades, hg_card_trade_items (offres ouvertes),
// RPC hg_staff_directory (profils des membres), hg_settings (clé « cards », réglages de l'économie).
// Exporte : refresh (relire et redessiner), boot (premier affichage).
// =====================================================================
import { sb, toast, errMsg, esc } from '../../../commun/core.js';
import { C, H } from './state.js';
import { check, group, fetchAll } from './helpers.js';

/* ---------- Chargement ---------- */
/**
 * Lit toutes les données de la section et construit les index (par identifiant, par carte, par propriétaire).
 * Les exemplaires recyclés restent dans la liste générale mais sortent de l'index par propriétaire.
 * Lève une erreur si une lecture échoue ; l'appelant décide quoi afficher.
 */
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
/** Relit toutes les données puis redessine la section. Une erreur s'affiche en toast. */
export async function refresh() {
  try { await load(); H.render(); } catch (e) { toast(errMsg(e), 'error'); }
}
/** Premier affichage : message de chargement, puis données. En cas d'échec, propose de réessayer. */
export async function boot() {
  C.panel.innerHTML = '<div class="empty">Chargement…</div>';
  try { await load(); H.render(); } catch (e) {
    C.panel.innerHTML = `<div class="empty">Impossible de charger les cartes : ${esc(errMsg(e))}
      <div class="btn-row acd-center"><button class="btn btn-ghost btn-sm" type="button" data-act="retry">Réessayer</button></div></div>`;
  }
}
