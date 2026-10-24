// ===== Humane Gang — administration : Arène (idée J15, Arène v2 : cotes, ligues, saisons) =====
/*
 * Rôle : Jeux et cartes › Arène. Deux blocs.
 *  - Arène actuelle (membres) : activation, gains et plafonds de l'Arène de cartes (hg_settings.cards), inchangés.
 *  - Arène v2 (aperçu admin) : réglages (hg_settings.arena, bornés par le serveur), ouverture aux membres (administrateur
 *    seulement), aperçu du classement, saisons passées, clôture de la saison en cours (récompenses, journalisée).
 *    Règles et chiffres par défaut : docs/ARENE.md.
 * Droits : Staff « cartes » et administrateur. Route : #cartes/arene. Section : <section id="bataille">, #bataille-root.
 * RPC : hg_battle_me, hg_battle_settings_save (Arène actuelle) ; hg_arena_admin, hg_arena_settings_save,
 * hg_arena_season_close (Arène v2). Exporte : mountBatailleSection.
 */
import { sb, toast, errMsg, esc } from './core.js';
import { confirmBox } from './ui-confirm.js';

/* Arène actuelle (membres) */
const CHAMPS = [
  ['bataille_gain', 'gain', 'Paillettes par victoire en attaque', 0, 100],
  ['batailles_jour', 'cap_jour', 'Victoires payées par jour', 0, 20],
  ['defense_gain', 'defense_gain', 'Paillettes quand la défense tient', 0, 100],
  ['defenses_jour', 'cap_defense', 'Défenses payées par jour', 0, 20],
  ['bataille_meme_adversaire', 'meme_adversaire', 'Attaques par jour contre un même membre', 1, 10],
  ['batailles_max_jour', 'max_jour', 'Batailles par jour au plus (toutes)', 1, 100],
];

/* Arène v2 : groupes de réglages. [clé enregistrée, libellé, minimum, maximum] ; seuils_, recompenses_, boosters_, podium_ sont des sous-objets. */
const V2_GROUPES = [
  ['Points et ligues', [
    ['depart', 'Cote de départ', 100, 3000], ['plancher', 'Cote plancher', 0, 2000], ['k', 'Facteur K (gain maximal par combat)', 4, 64],
    ['reset_pct', 'Part de l’écart gardée en début de saison (%)', 0, 100], ['min_combats', 'Combats pour être classé', 0, 50],
    ['seuils_argent', 'Seuil Argent', 0, 5000], ['seuils_or', 'Seuil Or', 0, 5000], ['seuils_diamant', 'Seuil Diamant', 0, 5000], ['seuils_legende', 'Seuil Légende', 0, 5000]]],
  ['Combats', [
    ['attaques_jour', 'Attaques par jour', 1, 10], ['meme_adversaire', 'Attaques par jour contre un même membre', 1, 3],
    ['defenses_recues_jour', 'Attaques reçues par jour (par deck)', 1, 20]]],
  ['Paillettes du jour', [
    ['gain_jour', 'Victoire du jour (la 1re)', 0, 100], ['gain_defense', 'Défense tenue', 0, 100],
    ['defenses_jour', 'Défenses payées par jour', 0, 20], ['plafond_jour', 'Plafond Arène par jour', 0, 500]]],
  ['Saisons et fin de saison', [
    ['duree_jours', 'Durée d’une saison (jours)', 7, 120], ['recompenses_argent', 'Paillettes fin de saison : Argent', 0, 1000],
    ['recompenses_or', 'Paillettes fin de saison : Or', 0, 1000], ['recompenses_diamant', 'Paillettes fin de saison : Diamant', 0, 1000],
    ['recompenses_legende', 'Paillettes fin de saison : Légende', 0, 1000], ['boosters_diamant', 'Boosters Classique : Diamant', 0, 10],
    ['boosters_legende', 'Boosters Classique : Légende', 0, 10], ['podium_1', 'Podium : 1er', 0, 1000], ['podium_2', 'Podium : 2e', 0, 1000],
    ['podium_3', 'Podium : 3e', 0, 1000], ['plafond_saison', 'Plafond de Paillettes par membre et par saison', 0, 2000]]],
];
const LIGUES = { bronze: 'Bronze', argent: 'Argent', or: 'Or', diamant: 'Diamant', legende: 'Légende' };

/** Valeur d'un réglage v2 dans la configuration renvoyée par le serveur (sous-objets pour seuils, recompenses, boosters, podium). */
function lireV2(cfg, key) {
  const m = key.match(/^(seuils|recompenses|boosters|podium)_(.+)$/);
  return m ? cfg[m[1]]?.[m[2]] : cfg[key];
}

/**
 * Monte la section.
 * @param {HTMLElement} root Conteneur #bataille-root.
 */
export async function mountBatailleSection(root) {
  root.innerHTML = '<div class="empty">Chargement des réglages…</div>';
  const [actuelle, v2] = await Promise.all([sb.rpc('hg_battle_me'), sb.rpc('hg_arena_admin')]);
  root.innerHTML = '';
  root.append(blocActuelle(actuelle), await blocV2(v2, root));
}

/* ---------- Arène actuelle (membres) ---------- */
function blocActuelle({ data, error }) {
  const bloc = document.createElement('section');
  bloc.className = 'card jm-form';
  bloc.setAttribute('aria-labelledby', 'bt-h');
  if (error || !data?.cfg) { bloc.innerHTML = `<h3 id="bt-h">Arène actuelle (membres)</h3><div class="empty">${esc(error ? errMsg(error) : 'Réglages indisponibles')}</div>`; return bloc; }
  const c = data.cfg;
  bloc.innerHTML = `<h3 id="bt-h">Arène actuelle (membres)</h3>
    <form class="jm-form" id="bt-form">
    <p class="small muted">Puissance d’une carte = rareté (1 à 6) + 1 si brillante + 2 si sa famille a l’avantage. Les gains se coupent ici si l’équilibre pose problème.</p>
    <label class="check"><input type="checkbox" id="bt-actif" ${c.actif ? 'checked' : ''}> Arène ouverte aux membres</label>
    <label class="check"><input type="checkbox" id="bt-gains" ${c.gains ? 'checked' : ''}> Gains en Paillettes activés</label>
    <div class="jm-grid">${CHAMPS.map(([k, cur, l, min, max]) => `<div class="field"><label for="bt-${k}">${esc(l)}</label>
      <input id="bt-${k}" class="input" type="number" min="${min}" max="${max}" required value="${esc(c[cur])}"><span class="small muted">de ${min} à ${max}</span></div>`).join('')}</div>
    <div class="jm-actions"><button type="submit" class="btn btn-primary">Enregistrer</button></div></form>`;
  bloc.querySelector('#bt-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = { actif: bloc.querySelector('#bt-actif').checked, gains: bloc.querySelector('#bt-gains').checked };
    for (const [k] of CHAMPS) p[k] = String(bloc.querySelector(`#bt-${k}`).value);
    const r = await sb.rpc('hg_battle_settings_save', { p });
    if (r.error) toast(errMsg(r.error), 'error'); else toast('Réglages de l’Arène actuelle enregistrés.', 'ok');
  });
  return bloc;
}

/* ---------- Arène v2 (aperçu admin) ---------- */
async function blocV2({ data, error }, root) {
  const bloc = document.createElement('section');
  bloc.className = 'card jm-form';
  bloc.setAttribute('aria-labelledby', 'ar-h');
  if (error || !data?.cfg) { bloc.innerHTML = `<h3 id="ar-h">Arène v2 (aperçu admin)</h3><div class="empty">${esc(error ? errMsg(error) : 'Réglages indisponibles')}</div>`; return bloc; }
  const c = data.cfg, s = data.board?.season, admin = !!data.admin;
  const ouverte = !!c.v2_public;
  bloc.innerHTML = `<h3 id="ar-h">Arène v2 (aperçu admin)</h3>
    <p class="small muted">Règles et chiffres par défaut : docs/ARENE.md. Les membres ne voient l’Arène v2 que lorsqu’elle est ouverte ici (administrateur seulement).</p>
    <p class="ar-adm-etat"><span class="pill ${ouverte ? 'pill-current' : ''}">${ouverte ? 'Ouverte aux membres' : 'Invisible des membres (aperçu admin)'}</span>
      ${s ? ` · ${esc(s.label)} jusqu’au ${esc(new Date(s.ends_at).toLocaleDateString('fr-CH'))} · ${esc(data.board.participants)} classé${data.board.participants > 1 ? 's' : ''} · ${esc(data.fights_today)} combat${data.fights_today > 1 ? 's' : ''} aujourd’hui` : ''}</p>
    <form class="jm-form" id="ar-form">
      <label class="check"><input type="checkbox" id="ar-actif" ${c.actif ? 'checked' : ''}> Arène v2 active (combats possibles)</label>
      <label class="check"><input type="checkbox" id="ar-gains" ${c.gains ? 'checked' : ''}> Gains en Paillettes activés</label>
      <label class="check"><input type="checkbox" id="ar-v2_public" ${ouverte ? 'checked' : ''} ${admin ? '' : 'disabled'}> Ouvrir l’Arène v2 aux membres ${admin ? '' : '<span class="small muted">(administrateur seulement)</span>'}</label>
      ${V2_GROUPES.map(([titre, champs]) => `<fieldset class="ar-adm-g"><legend class="ar-adm-legend">${esc(titre)}</legend><div class="jm-grid">${champs.map(([k, l, min, max]) => {
        const v = lireV2(c, k);
        return `<div class="field"><label for="ar-${k}">${esc(l)}</label><input id="ar-${k}" class="input" type="number" min="${min}" max="${max}" required value="${esc(v ?? '')}"><span class="small muted">de ${min} à ${max}</span></div>`;
      }).join('')}</div></fieldset>`).join('')}
      <div class="jm-actions"><button type="submit" class="btn btn-primary">Enregistrer l’Arène v2</button></div>
    </form>
    <div class="ar-adm-saison"><h4>Saison en cours</h4>
      <p class="small muted">Clôturer verse les récompenses (ligue et podium), remet les cotes à niveau et ouvre la saison suivante. Action journalisée.</p>
      <div class="jm-actions"><button type="button" class="btn btn-danger" id="ar-cloture">Clôturer la saison</button></div></div>
    <div class="ar-adm-top"><h4>Aperçu du classement (top 10)</h4>
      ${data.board?.top?.length ? `<ol class="ar-adm-liste">${data.board.top.slice(0, 10).map((x) => `<li><span class="ar-adm-rk">${esc(x.rank)}</span> ${esc(x.pseudo)} <span class="small muted">· ${esc(LIGUES[x.league] || x.league)} · ${esc(x.rating)} pts · ${esc(x.wins)} victoire${x.wins > 1 ? 's' : ''}</span></li>`).join('')}</ol>` : '<p class="small muted">Personne n’est encore classé.</p>'}</div>
    <div class="ar-adm-past"><h4>Saisons</h4>
      ${data.seasons?.length ? `<ul class="ar-adm-liste">${data.seasons.map((x) => `<li>${esc(x.label)} · ${x.status === 'close' ? 'close' : 'en cours'} · ${esc(x.participants)} classé${x.participants > 1 ? 's' : ''} · ${esc(x.paid)} ✦ versés</li>`).join('')}</ul>` : '<p class="small muted">Aucune saison.</p>'}</div>`;

  bloc.querySelector('#ar-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const p = { actif: bloc.querySelector('#ar-actif').checked, gains: bloc.querySelector('#ar-gains').checked };
    if (admin) p.v2_public = bloc.querySelector('#ar-v2_public').checked;
    for (const [, champs] of V2_GROUPES) for (const [k] of champs) p[k] = String(bloc.querySelector(`#ar-${k}`).value);
    const r = await sb.rpc('hg_arena_settings_save', { p });
    if (r.error) toast(errMsg(r.error), 'error'); else { toast('Réglages de l’Arène v2 enregistrés.', 'ok'); mountBatailleSection(root); }
  });
  bloc.querySelector('#ar-cloture').addEventListener('click', async () => {
    const ok = await confirmBox('Clôturer la saison en cours ?', 'Les récompenses sont versées, les cotes sont remises à niveau et la saison suivante commence. Action journalisée.', { ok: 'Clôturer', danger: true });
    if (!ok) return;
    const r = await sb.rpc('hg_arena_season_close');
    if (r.error) { toast(errMsg(r.error), 'error'); return; }
    toast(`Saison clôturée : ${r.data?.classes ?? 0} classé${(r.data?.classes ?? 0) > 1 ? 's' : ''}, ${r.data?.paillettes ?? 0} ✦ versés.`, 'ok');
    mountBatailleSection(root);
  });
  return bloc;
}
