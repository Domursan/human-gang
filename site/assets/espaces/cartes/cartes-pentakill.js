// ===== Humane Gang — succès « Pentakill » (boosters de 5 cartes) =====
/*
 * Rôle : après l'ouverture d'un booster de 5 cartes, demande au serveur si l'ouverture est un Pentakill
 *   (5 cartes de même rareté rare ou mieux, ou 5 cartes jamais possédées). Si oui, une bannière « PENTAKILL » traverse
 *   l'écran d'ouverture (2 s ; 1,5 s fixe si le mouvement est réduit), puis le badge est annoncé comme les autres
 *   (checkNewBadges) lorsqu'il monte de niveau. Sans réponse du serveur, rien ne s'affiche : l'ouverture n'est jamais bloquée.
 * Appelé par cartes.js : pentakillCheck() dès que le booster est reçu ; showPentakill(res) au moment voulu.
 * Données : RPC hg_pentakill_check (aucun paramètre) → { pentakill, kind: 'rarete'|'nouvelles', level, new_level, total }.
 * Dépendances : core.js (sb, motionAllowed, checkNewBadges, toast), cartes-pentakill.css (chargée par /pages/cartes/cartes.html).
 * Exporte : pentakillCheck, showPentakill.
 */
import { sb, motionAllowed, checkNewBadges, toast } from '../../commun/core.js';

/** Durée d'affichage de la bannière (ms) : animée, ou fixe si le mouvement est réduit. */
const DUREE_ANIMEE = 2000;
const DUREE_FIXE = 1500;

/**
 * Interroge le serveur sur la dernière ouverture. Ne rejette jamais : une erreur donne null.
 * @returns {Promise<{pentakill: boolean, kind?: string, level?: number, new_level?: boolean, total?: number}|null>}
 */
export async function pentakillCheck() {
  try {
    const { data, error } = await sb.rpc('hg_pentakill_check');
    if (error || !data?.pentakill) return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Affiche la bannière « PENTAKILL » sur l'écran d'ouverture, puis annonce le badge si son niveau monte.
 * @param {{kind?: string, level?: number, new_level?: boolean}} res réponse de pentakillCheck (non nulle)
 * @returns {Promise<void>} résolue à la fin de la bannière (et de l'annonce éventuelle)
 */
export function showPentakill(res) {
  return new Promise((resolve) => {
    const anime = motionAllowed();
    const b = document.createElement('div');
    b.className = `penta${anime ? ' is-anim' : ' is-static'}`;
    b.setAttribute('role', 'status');
    const lettres = 'PENTAKILL'.split('').map((l, i) => `<span style="--k:${i}">${l}</span>`).join('');
    const sous = res.kind === 'nouvelles' ? 'Cinq nouvelles cartes' : 'Cinq cartes de même rareté';
    b.innerHTML = `<div class="penta-band">
        <p class="penta-word"><span class="visually-hidden">Pentakill</span><span aria-hidden="true">${lettres}</span></p>
        <p class="penta-sub">${sous}</p>
      </div>`;
    document.body.append(b);
    setTimeout(async () => {
      b.remove();
      // Badge : annonce habituelle du site quand le niveau monte ; sinon un simple toast
      if (res.new_level) {
        const liste = await checkNewBadges({ force: true }).catch(() => []);
        if (!liste?.length) toast(`Badge Pentakill niveau ${res.level || 1}`, 'success');
      }
      resolve();
    }, anime ? DUREE_ANIMEE : DUREE_FIXE);
  });
}
