// ===== Humane Gang — outils communs du thème « Social et profils » (migration 090) =====
/*
 * Rôle : réglages effectifs (hg_social_settings : plateformes et jeux du profil gaming, plafonds), copie dans le
 * presse-papiers avec message, et petite boîte de dialogue accessible réutilisée par les mercis, les sondages et les groupes.
 * Pages : membre.html, compte.html, accueil.html, messages.html.
 * Dépendances : core.js (sb, toast, esc, errMsg), icons.js.
 * Exporte : socialSettings, copyText, openDialog, DEFAULT_SOCIAL.
 */
import { sb, toast, esc } from './core.js';
import { svg } from './icons.js';

/** Réglages de repli si la RPC est indisponible (mêmes valeurs que hg_social_defaults côté serveur). */
export const DEFAULT_SOCIAL = Object.freeze({
  gaming: {
    plateformes: [
      { key: 'riot', label: 'Riot ID', color: '#CF7055', placeholder: 'Pseudo#TAG' },
      { key: 'steam', label: 'Steam', color: '#7E93C9' },
      { key: 'minecraft_java', label: 'Minecraft Java', color: '#6FA37F' },
      { key: 'minecraft_bedrock', label: 'Minecraft Bedrock', color: '#8FC39F' },
      { key: 'geoguessr', label: 'GeoGuessr', color: '#5FA88F' },
      { key: 'aoe2', label: 'Age of Empires 2', color: '#D8A75E' },
      { key: 'switch', label: 'Code ami Switch', color: '#E0909A', placeholder: 'SW-0000-0000-0000' },
      { key: 'battlenet', label: 'Battle.net', color: '#5B8FD0', placeholder: 'Pseudo#1234' },
      { key: 'epic', label: 'Epic Games', color: '#ABA7A0' },
      { key: 'psn', label: 'PlayStation Network', color: '#2B5AE2' },
      { key: 'xbox', label: 'Xbox', color: '#159946' },
    ],
    jeux: [
      { nom: 'LoL', plateforme: 'riot' }, { nom: 'GeoGuessr', plateforme: 'geoguessr' }, { nom: 'Minecraft', plateforme: 'minecraft_java' },
      { nom: 'AoE2', plateforme: 'aoe2' }, { nom: 'CK3', plateforme: 'steam' }, { nom: 'Satisfactory', plateforme: 'steam' },
      { nom: 'Sea of Thieves', plateforme: 'steam' }, { nom: 'Valorant', plateforme: 'riot' }, { nom: 'Pokémon', plateforme: 'switch' },
      { nom: 'Among Us', plateforme: null }, { nom: 'Codenames', plateforme: null }, { nom: 'Gartic Phone', plateforme: null },
    ],
  },
  plafonds: { mercis_jour: 3, groupe_membres_max: 30, groupes_semaine: 5, sondages_jour: 3, sondages_accueil: 5 },
});

let _settings = null;
/**
 * Réglages effectifs du thème social (une seule lecture par page). Repli sur DEFAULT_SOCIAL en cas d'échec.
 * @returns {Promise<typeof DEFAULT_SOCIAL>}
 */
export function socialSettings() {
  if (!_settings) {
    _settings = sb.rpc('hg_social_settings').then(({ data, error }) => {
      if (error || !data || typeof data !== 'object') throw error || new Error('vide');
      return {
        gaming: {
          plateformes: Array.isArray(data.gaming?.plateformes) ? data.gaming.plateformes : DEFAULT_SOCIAL.gaming.plateformes,
          jeux: Array.isArray(data.gaming?.jeux) ? data.gaming.jeux : DEFAULT_SOCIAL.gaming.jeux,
        },
        plafonds: { ...DEFAULT_SOCIAL.plafonds, ...(data.plafonds || {}) },
      };
    }).catch((e) => { console.warn('[social] réglages par défaut :', e?.message || e); return DEFAULT_SOCIAL; });
  }
  return _settings;
}

/**
 * Copie un texte dans le presse-papiers et l'annonce par un message (toast).
 * @param {string} text texte à copier
 * @param {string} [label='Copié'] message affiché en cas de succès
 * @returns {Promise<boolean>}
 */
export async function copyText(text, label = 'Copié') {
  try {
    await navigator.clipboard.writeText(String(text));
    toast(label, 'ok');
    return true;
  } catch {
    toast('Copie impossible : sélectionne le texte à la main.', 'error');
    return false;
  }
}

const CLOSE = svg('close', { size: 18, stroke: 2 });
/**
 * Ouvre une boîte de dialogue modale (élément <dialog>, fermée par Échap ou le bouton ×). Elle est retirée du DOM à la fermeture.
 * @param {{title: string, body: string, id?: string, wide?: boolean}} opts titre (texte brut), contenu HTML déjà échappé
 * @returns {HTMLDialogElement} la boîte ouverte ; écouter l'événement « close » pour la suite
 */
export function openDialog({ title, body, id = 'soc-dlg', wide = false }) {
  document.getElementById(id)?.remove();
  const dlg = document.createElement('dialog');
  dlg.className = `soc-dialog${wide ? ' is-wide' : ''}`;
  dlg.id = id;
  dlg.setAttribute('aria-labelledby', `${id}-title`);
  dlg.innerHTML = `<div class="soc-dialog-head"><h2 class="soc-dialog-title" id="${id}-title">${esc(title)}</h2>
      <button class="btn btn-ghost soc-icon-btn" type="button" data-soc-close aria-label="Fermer">${CLOSE}</button></div>
    <div class="soc-dialog-body">${body}</div>`;
  document.body.append(dlg);
  dlg.querySelector('[data-soc-close]').addEventListener('click', () => dlg.close());
  dlg.addEventListener('close', () => setTimeout(() => dlg.remove(), 0));
  dlg.showModal();
  return dlg;
}
