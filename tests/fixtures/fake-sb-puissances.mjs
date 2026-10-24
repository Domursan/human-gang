// Faux client Supabase du panel Arène, bloc « Puissance des cartes » (assets/js/admin/puissances.js).
// Enveloppe le faux de l'Arène v2 (fake-sb-arene2.mjs, donc l'Arène actuelle et le fake de base) et ajoute :
// - des cartes (hg_cards) : mythiques, uniques, série « Les OG » (gang-membres), « Hors série » (hors-serie), et des
//   cartes qui ne doivent pas apparaître dans la liste ;
// - le réglage hg_settings.cards avec des sous-clés qui ne sont pas celles du bloc (merge à vérifier) ;
// - la RPC hg_card_power_set (Staff « cartes », bornes 0 à 20, journal des appels dans window.__LOG).
// Scénario (window.__SCN) : uid (membre connecté ; par défaut l'administrateur Ethan), staff (Staff « cartes » sans être admin).
// Les données sont posées à la création du client (window.__DB existe alors). Exporte createClient().
const S = window.__SCN || {};
const prefix = location.pathname.replace(/\/[^/]*$/, '');
const base = await import(`${location.origin}${prefix}/tests/fixtures/fake-sb-arene2.mjs`);

const ME = '11111111-1111-4111-8111-111111111111';
const uid = () => S.uid || ME;
const isAdmin = () => uid() === ME;
const ok = (data) => ({ data, error: null });
const err = (message) => ({ data: null, error: { message } });
const DEF = { commune: 1, peu_commune: 2, rare: 3, epique: 4, legendaire: 5, mythique: 6, identite: 6, unique: 6 };

/** Cartes de test : id, nom, rareté, série (set_id), puissance propre (null = catégorie). */
const CARTES = [
  { id: 'M1', name: 'Serge', rarity: 'mythique', family: 'moment', set_id: 'SET-PR', number: 1, power: null, image_url: null, max_copies: 10, active: true },
  { id: 'M2', name: 'Ethan', rarity: 'mythique', family: 'membre', set_id: 'SET-OG', number: 2, power: 7, image_url: null, max_copies: 10, active: true },
  { id: 'U1', name: 'La Domu-mobile', rarity: 'unique', family: 'unique', set_id: 'SET-HS', number: 3, power: null, image_url: null, max_copies: 1, active: true },
  { id: 'U2', name: 'Le Tzatzikistan', rarity: 'unique', family: 'unique', set_id: 'SET-HS', number: 4, power: 9, image_url: null, max_copies: 1, active: true },
  { id: 'O1', name: 'Alice', rarity: 'commune', family: 'membre', set_id: 'SET-OG', number: 5, power: null, image_url: null, max_copies: 10, active: true },
  { id: 'O2', name: 'Bruno', rarity: 'rare', family: 'membre', set_id: 'SET-OG', number: 6, power: null, image_url: null, max_copies: 10, active: true },
  { id: 'H1', name: 'Le gobelet', rarity: 'peu_commune', family: 'objet', set_id: 'SET-HS', number: 7, power: null, image_url: null, max_copies: 10, active: true },
  // Hors liste : ni mythique, ni unique, ni OG, ni Hors série.
  { id: 'X1', name: 'Lyon 2026', rarity: 'commune', family: 'lieu', set_id: 'SET-PR', number: 8, power: null, image_url: null, max_copies: 10, active: true },
  { id: 'X2', name: 'Raclette', rarity: 'legendaire', family: 'moment', set_id: 'SET-HA', number: 9, power: null, image_url: null, max_copies: 10, active: true },
];

/** Puissance effective d'une carte selon les réglages courants (défaut quand la catégorie n'est pas réglée). */
function effectif(card) {
  const pu = DBX().hg_settings.find((r) => r.key === 'cards')?.value?.puissances || {};
  if (card.power != null) return card.power;
  return Number.isInteger(pu[card.rarity]) ? pu[card.rarity] : (DEF[card.rarity] ?? 1);
}
const DBX = () => window.__DB;

/** Pose les données une seule fois : cartes, série « Hors série », réglage « cards » avec des sous-clés étrangères au bloc. */
function semer() {
  const db = DBX();
  db.hg_cards ||= [];
  if (db.hg_cards.some((c) => c.id === 'M1')) return;
  if (!db.hg_card_sets.some((s) => s.code === 'hors-serie')) db.hg_card_sets.push({ id: 'SET-HS', code: 'hors-serie', name: 'Hors série', description: null, active: true, sort: 9999 });
  db.hg_cards.push(...CARTES.map((c) => ({ ...c })));
  db.hg_settings = db.hg_settings.filter((r) => r.key !== 'cards');
  db.hg_settings.push({ key: 'cards', value: S.cardsValue || {
    quetes_preuve_par_semaine: 3,
    tag_labels: { hiver: 'Hiver' },
    puissances: { commune: 0, legendaire: 4, futur_reglage: 2 },
  } });
}

/** Réponse de la RPC hg_card_power_set : Staff « cartes » (ou administrateur), bornes 0 à 20, carte connue. */
function powerSet(a) {
  if (!(isAdmin() || S.staff)) return err('Réservé au Staff « cartes »');
  const card = DBX().hg_cards.find((c) => c.id === a.p_card);
  if (!card) return err('Carte introuvable');
  const p = a.p_power ?? null;
  if (p != null && (!Number.isInteger(p) || p < 0 || p > 20)) return err('Puissance : de 0 à 20');
  card.power = p;
  return ok({ id: card.id, power: card.power, effective: effectif(card) });
}

/** Client : celui du faux de l'Arène v2, avec les cartes semées et la RPC hg_card_power_set. */
export function createClient(...args) {
  semer();
  const c = base.createClient(...args);
  const rpc0 = c.rpc.bind(c);
  c.rpc = async (fn, a = {}) => {
    if (fn === 'hg_card_power_set') { window.__LOG.push(['rpc', fn, a]); return powerSet(a); }
    return rpc0(fn, a);
  };
  return c;
}
