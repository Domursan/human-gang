// Comptes admin : liste des comptes (colonne 2 du panel : recherche, puces Tous / Staff / Fantômes, lignes compactes).
import { sb, errMsg } from '../core.js';
import { fetchAdminGhosts } from '../admin-ghosts.js';
import { createList } from '../admin/ui/list.js';
import { isAdminView } from '../admin/perms.js';
import { check } from './common.js';
import { A } from './state.js';

/* =========================================================
   Données de la liste
   ========================================================= */
export async function loadAccounts() {
  const [acc, mem, gh, staff] = await Promise.all([
    sb.rpc('hg_admin_accounts'), sb.rpc('hg_members'),
    fetchAdminGhosts().catch((e) => { console.warn('[fantômes]', e); return []; }), // admin seulement : les membres ne les voient jamais
    isAdminView() ? sb.rpc('hg_staff_list') : Promise.resolve({ data: [] }), // Staff : visible de l'administrateur seulement
  ]);
  const real = check(acc) ?? [];
  const ids = new Set(real.map((a) => a.id));
  const staffIds = new Set((staff?.data ?? []).filter((s) => s.active).map((s) => s.user_id));
  const ghosts = gh.filter((g) => !ids.has(g.id)).map((g) => ({
    id: g.id, pseudo: g.pseudo, email: null, is_admin: false, created_at: null, last_sign_in_at: null,
    is_ghost: true, avatar_url: g.avatar_url, joined_on: g.joined_on,
  }));
  A.accounts = [...real, ...ghosts].sort((a, b) => (!a.pseudo - !b.pseudo) || String(a.pseudo ?? a.email ?? '').localeCompare(String(b.pseudo ?? b.email ?? ''), 'fr'));
  for (const a of A.accounts) a.is_staff = staffIds.has(a.id);
  A.avatars = new Map((mem.data ?? []).map((m) => [m.id, m]));
  for (const g of ghosts) A.avatars.set(g.id, { id: g.id, pseudo: g.pseudo, avatar_url: g.avatar_url });
  // Date d'arrivée réelle dans le gang (saisie par l'admin) : absente de hg_admin_accounts
  const jo = await sb.from('hg_profiles').select('id, joined_on');
  if (!jo.error) { const m = new Map((jo.data ?? []).map((r) => [r.id, r.joined_on])); for (const a of A.accounts) a.joined_on = m.get(a.id) ?? null; }
}

/** Rôle affiché dans la liste et le résumé : Admin, Staff, Membre ou Fantôme. */
export function roleOf(a) {
  if (a.is_ghost) return { id: 'ghost', label: 'Fantôme', tone: 'muted' };
  if (a.is_admin) return { id: 'admin', label: 'Admin', tone: 'done' };
  if (a.is_staff) return { id: 'staff', label: 'Staff', tone: 'prog' };
  return { id: 'member', label: 'Membre', tone: 'muted' };
}

/** Lignes de la liste (une par compte ; les comptes sans profil restent visibles sans être ouvrables). */
export function accountItems() {
  return A.accounts.map((a) => {
    const m = A.avatars.get(a.id) || {};
    return {
      id: a.id,
      name: a.pseudo || a.email || 'Sans profil',
      pseudo: a.pseudo || null,
      email: a.email || '',
      is_ghost: !!a.is_ghost,
      is_staff: !!a.is_staff || !!a.is_admin,
      member: { pseudo: a.pseudo || '?', avatar_url: m.avatar_url, color: m.color },
      at: a.last_sign_in_at || null,
      excerpt: a.email || (a.is_ghost ? 'Fantôme : pas encore inscrit' : (a.pseudo ? '' : 'Compte sans profil Humane Gang')),
      status: roleOf(a),
    };
  });
}

/* =========================================================
   Liste (colonne 2)
   ========================================================= */
let accList = null;

/** Monte la liste des comptes dans la colonne 2 (appelé par le fournisseur `list` de la sous-section). */
export function mountAccountsList(el) {
  accList = createList(el, {
    items: accountItems(),
    key: 'id',
    label: 'Comptes des membres',
    search: { placeholder: 'Pseudo ou e-mail', label: 'Rechercher un compte', fields: (it) => `${it.pseudo || ''} ${it.email || ''}` },
    filters: [
      { id: 'staff', label: 'Staff', test: (it) => it.is_staff },
      { id: 'ghost', label: 'Fantômes', test: (it) => it.is_ghost },
    ],
    selectedId: A.uid,
    empty: A.listError ? `Impossible de charger les comptes : ${errMsg(A.listError)}` : 'Aucun compte ne correspond.',
    onSelect: (it) => {
      if (!it.pseudo || it.id === A.uid) return; // compte sans profil : rien à ouvrir
      location.hash = `#membres/comptes/${it.id}`;
    },
  });
  accList.select(A.uid);
}

/** Recharge la liste des comptes (ex. après un changement fait ailleurs dans l'admin). */
export async function refreshAccounts() {
  try { await loadAccounts(); A.listError = null; } catch (e) { A.listError = e; }
  accList?.update(accountItems());
  accList?.select(A.uid);
}

/** Après le premier chargement : alimente la liste déjà montée. */
export function paintAccountsList() {
  accList?.update(accountItems());
  accList?.select(A.uid);
}

/** Sélection visuelle dans la liste (sans recharger la fiche). */
export function selectInList(uid) { accList?.select(uid); }
