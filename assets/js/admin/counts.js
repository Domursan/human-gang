// Admin : compteurs « à traiter » du plateau. Calcule les nombres à partir des données chargées et les pose sur les
// sous-sections (setCount de shell.js) : pastilles des tuiles, des lieux (plateau, barre du bas), de la palette ;
// enregistre aussi les éléments « À faire » de La Poste et de La Fabrique (registerTodo).
// refreshCounts() redessine les compteurs à partir des données déjà là (sans requête) ; loadCounts() charge d'abord les
// données qui les alimentent (échanges de cartes, alertes économie, demandes, idées) puis redessine.
// Utilisé par admin.js (plateau), live.js (après chaque changement temps réel), invites.js, ideas.js, support.js,
// ss-events.js (après chaque modification). Dépend de core.js (sb), state.js, perms.js, shell.js (setCount),
// eco-health.js (alertes économie) et loaders.js (demandes, idées).
import { sb } from '../core.js';
import { S } from './state.js';
import { canSection } from './perms.js';
import { setCount } from './shell.js';
import { loadEco, ecoTile, ecoTodoItems } from './eco-health.js';
import { ensureSupport, ensureIdeas } from './loaders.js';
import { registerTodo } from './lieux.js';

// « À faire » des lieux (page de lieu, admin/lieux.js) : alertes économie de La Fabrique, demandes ouvertes de La Poste.
registerTodo('fabrique', async () => ecoTodoItems());
registerTodo('poste', async () => {
  if (!canSection('assistance')) return [];
  return S.support.filter((s) => s.status === 'ouverte').slice(0, 10).map((s) => ({
    title: s.subject || 'Demande sans titre',
    meta: 'Demande à traiter dans l’assistance',
    actions: [{ label: 'Répondre', href: `#poste/assistance/${s.id}` }],
  }));
});

// Donnée hors coquille, chargée par loadCounts : nombre d'échanges de cartes proposés et en attente.
const OV = { trades: 0 };

/**
 * Tables à relire quand elles changent, selon les droits (temps réel du plateau). Les demandes et idées passent par live.js.
 * @returns {string[]} Noms de tables.
 */
export function countTables() {
  return canSection('cartes') ? ['hg_card_trades'] : [];
}

/**
 * Pose les compteurs « à traiter » à partir des données chargées (S, OV). Ne charge rien.
 * Une sous-section dont la section n'est pas permise n'est jamais comptée.
 */
export function refreshCounts() {
  const ed = S.editions[0];
  const newIdeas = S.ideas.filter((i) => i.status === 'nouvelle').length;
  const open = S.support.filter((s) => s.status === 'ouverte').length;
  const eco = ecoTile(); // A7 : alertes économie (droit « cartes »)
  if (canSection('idees')) setCount('idees', newIdeas);
  if (canSection('assistance')) setCount('assistance', open);
  if (canSection('cartes')) { setCount('echanges', OV.trades); setCount('economie', eco?.warn ? eco.value : 0); }
  if (canSection('secret-santa')) setCount('secret-santa', ed?.status === 'tirage' ? 1 : 0);
}

/**
 * Charge les données des compteurs (échanges en attente, alertes économie, demandes et idées si permises), puis
 * redessine. Une requête qui échoue est signalée dans la console ; le plateau s'affiche quand même.
 */
export async function loadCounts() {
  const jobs = [];
  if (canSection('cartes')) {
    jobs.push(sb.from('hg_card_trades').select('id').eq('status', 'proposee')
      .then((r) => { if (r.error) throw r.error; OV.trades = r.data?.length ?? 0; }));
    jobs.push(loadEco());
  }
  if (canSection('assistance')) jobs.push(ensureSupport());
  if (canSection('idees')) jobs.push(ensureIdeas());
  await Promise.all(jobs.map((p) => p.catch((e) => console.warn('[plateau]', e))));
  refreshCounts();
}

// Alertes économie : « Ignorer cette semaine » a changé leur état, on redessine les compteurs.
document.addEventListener('hg:eco-changed', () => refreshCounts());
