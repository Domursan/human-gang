// ===== Humane Gang — administration : réglages de la Bataille de cartes (idée J15) =====
/*
 * Rôle : Jeux et cartes › Bataille. Activation du jeu, gains, montants et plafonds
 * (hg_settings.cards.bataille et cards.plafonds), bornés par le serveur et journalisés.
 * Droits : Staff « cartes » et administrateur. Route : #cartes/arene. Section : <section id="bataille">, #bataille-root.
 * RPC : hg_battle_me (lecture des réglages), hg_battle_settings_save. Exporte : mountBatailleSection.
 */
import { sb, toast, errMsg, esc } from './core.js';

const CHAMPS = [
  ['bataille_gain', 'gain', 'Paillettes par victoire en attaque', 0, 100],
  ['batailles_jour', 'cap_jour', 'Victoires payées par jour', 0, 20],
  ['defense_gain', 'defense_gain', 'Paillettes quand la défense tient', 0, 100],
  ['defenses_jour', 'cap_defense', 'Défenses payées par jour', 0, 20],
  ['bataille_meme_adversaire', 'meme_adversaire', 'Attaques par jour contre un même membre', 1, 10],
  ['batailles_max_jour', 'max_jour', 'Batailles par jour au plus (toutes)', 1, 100],
];

/**
 * Monte la section.
 * @param {HTMLElement} root Conteneur #bataille-root.
 */
export async function mountBatailleSection(root) {
  const { data, error } = await sb.rpc('hg_battle_me');
  if (error || !data?.cfg) { root.innerHTML = `<div class="empty">${esc(error ? errMsg(error) : 'Réglages indisponibles')}</div>`; return; }
  const c = data.cfg;
  root.innerHTML = `<form class="card jm-form" id="bt-form">
    <p class="small muted">Puissance d’une carte = rareté (1 à 6) + 1 si brillante + 2 si sa famille a l’avantage. Les gains se coupent ici si l’équilibre pose problème.</p>
    <label class="check"><input type="checkbox" id="bt-actif" ${c.actif ? 'checked' : ''}> Bataille ouverte aux membres</label>
    <label class="check"><input type="checkbox" id="bt-gains" ${c.gains ? 'checked' : ''}> Gains en Paillettes activés</label>
    <div class="jm-grid">${CHAMPS.map(([k, cur, l, min, max]) => `<div class="field"><label for="bt-${k}">${esc(l)}</label>
      <input id="bt-${k}" class="input" type="number" min="${min}" max="${max}" required value="${esc(c[cur])}"><span class="small muted">de ${min} à ${max}</span></div>`).join('')}</div>
    <div class="jm-actions"><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`;
  root.querySelector('#bt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = { actif: root.querySelector('#bt-actif').checked, gains: root.querySelector('#bt-gains').checked };
    for (const [k] of CHAMPS) p[k] = String(root.querySelector(`#bt-${k}`).value);
    const r = await sb.rpc('hg_battle_settings_save', { p });
    if (r.error) toast(errMsg(r.error), 'error'); else toast('Réglages de la Bataille enregistrés.', 'ok');
  });
}
