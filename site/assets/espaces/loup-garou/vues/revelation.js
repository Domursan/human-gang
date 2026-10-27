// ===== Humane Gang — Loup-Garou : révélation du rôle (statut « revelation ») =====
/*
 * Rôle : chacun découvre son rôle en secret. Grande carte façon carte à jouer (camp, vignette, nom,
 * description, comment gagner), alliés (meute, amoureux, famille), rappel de garder l'écran secret,
 * bouton « J'ai compris », progression des joueurs et minuteur de l'étape.
 * Ambiance nuit posée sur le corps de la page, retirée à la sortie.
 * Dépendances : core.js (esc), api.js (lg, erreurTexte), ui.js, roles.js.
 * Exporte : monter.
 */
import { esc } from '../../core.js';
import { erreurTexte, estInvite } from '../api.js';
import { icone, avatar, pseudo, vignetteRole, pastilleCamp, chrono, notifier } from '../ui.js';
import { roleById, CAMPS } from '../roles.js';

const LIBELLE_CAMP = { village: 'Camp du village', loups: 'Camp des loups', solo: 'Solitaire' };

/** Comment gagner, pour les rôles solitaires dont la victoire est particulière. */
const GAGNER_SOLO = {
  ange: 'être éliminé·e dans les 2 premiers jours.',
  'joueur-de-flute': 'envoûter tous les survivants.',
  'loup-blanc': 'être le dernier survivant.',
};

const GROUPES_ALLIES = [
  { lien: 'loup', titre: 'Ta meute', sous: 'Les autres loups de la partie' },
  { lien: 'amoureux', titre: 'Ton amoureux', sous: 'La personne dont tu es amoureux·se' },
  { lien: 'famille', titre: 'Ta famille', sous: 'Les membres de ta famille' },
];

function commentGagner(role, camp) {
  if (GAGNER_SOLO[role]) return GAGNER_SOLO[role];
  if (camp === 'village') return 'éliminer tous les loups-garous.';
  if (camp === 'loups') return 'dévorer le village.';
  return 'atteindre seul·e l\'objectif de ton rôle.';
}

export function monter(root, s) {
  document.body.dataset.lgAmbiance = 'nuit';
  let fini = false;
  let busy = false;
  let vuLocal = false;     // « J'ai compris » vient d'être envoyé (avant la mise à jour de l'état)

  root.innerHTML = `
    <div class="lg-revel">
      <div class="lg-revel-corps">
        <div class="lg-revel-carte" data-zone="carte"></div>
        <div class="lg-revel-texte">
          <p class="eyebrow">Distribution terminée</p>
          <h1 class="lg-revel-titre display">Ton rôle</h1>
          <div data-zone="allies"></div>
          <p class="lg-rappel">
            <span class="lg-rappel-ico">${icone('oeilBarre', 20)}</span>
            <span><strong>Ne montre pas ton écran.</strong> Ton rôle reste secret jusqu'à ta mort.</span>
          </p>
        </div>
      </div>

      <footer class="lg-revel-pied">
        <div class="lg-revel-progres">
          <p class="small" data-zone="progres"></p>
          <div class="lg-progres" role="progressbar" aria-label="Joueurs ayant vu leur rôle" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
            <span style="width:0%"></span>
          </div>
        </div>
        <p class="lg-revel-minuteur small muted">Temps restant <strong class="lg-chrono" data-chrono>--:--</strong></p>
        <div class="lg-revel-actions">
          ${estInvite() ? '' : '<a class="btn btn-ghost" href="#roles">Revoir les règles de mon rôle</a>'}
          <button type="button" class="btn btn-sand" data-vu>J'ai compris</button>
          <p class="lg-revel-attente" data-attente tabindex="-1" hidden>En attente des autres…</p>
        </div>
      </footer>
    </div>`;

  const q = (sel) => root.querySelector(sel);
  const zCarte = q('[data-zone="carte"]');
  const zAllies = q('[data-zone="allies"]');
  const zProgres = q('[data-zone="progres"]');
  const barre = q('.lg-progres');
  const barreTrait = barre.querySelector('span');
  const btnVu = q('[data-vu]');
  const attente = q('[data-attente]');
  const zChrono = q('[data-chrono]');

  /** Rendu de la carte de rôle (ne change pas pendant l'étape). */
  function rendreCarte(moi) {
    const role = moi.role || moi.role_initial;
    const r = roleById(role);
    const camp = moi.camp || r.camp;
    const c = CAMPS[camp] || CAMPS.village;
    zCarte.innerHTML = `
      <article class="lg-carte-role" style="--lg-camp-bord:${c.texte};--lg-camp-fond:${c.fond}" aria-labelledby="lg-role-nom">
        <span class="lg-carte-camp">${pastilleCamp(camp, LIBELLE_CAMP[camp] || c.label)}</span>
        <div class="lg-carte-vignette">${vignetteRole(role, 160, { rond: true })}</div>
        <div class="lg-carte-texte">
          <h2 id="lg-role-nom" class="lg-carte-nom display">${esc(r.nom)}</h2>
          <p class="lg-carte-desc">${esc(r.description || '')}</p>
        </div>
        <p class="lg-carte-gagner"><strong>Comment gagner :</strong> ${esc(commentGagner(role, camp))}</p>
      </article>`;
  }

  /** Alliés : meute, amoureux, famille. Rien si je n'en ai pas. */
  function rendreAllies(e) {
    const allies = e.moi?.allies || [];
    if (!allies.length) { zAllies.innerHTML = ''; return; }
    const joueurs = e.joueurs || [];
    const blocs = GROUPES_ALLIES.map((g) => {
      const liste = allies.filter((a) => a.lien === g.lien);
      if (!liste.length) return '';
      const items = liste.map((a) => {
        const j = joueurs.find((x) => x.user_id === a.user_id) || a;
        return `<li class="lg-allie">
          ${avatar(j, 36)}
          <div class="lg-allie-infos"><span>${pseudo(j)}</span>${a.role ? `<span class="small muted">${esc(roleById(a.role).nom)}</span>` : ''}</div>
        </li>`;
      }).join('');
      return `<section class="lg-allies-bloc" aria-labelledby="lg-allies-${g.lien}">
        <div><h2 id="lg-allies-${g.lien}">${esc(g.titre)}</h2><p class="small muted">${esc(g.sous)}</p></div>
        <ul class="lg-allies">${items}</ul>
      </section>`;
    }).join('');
    const cle = JSON.stringify(allies);
    if (zAllies.dataset.cle !== cle) {
      zAllies.dataset.cle = cle;
      zAllies.innerHTML = blocs;
    }
  }

  /** Progression : combien ont vu leur rôle. */
  function rendreProgres(e) {
    const joueurs = e.joueurs || [];
    const total = joueurs.length;
    const vus = joueurs.filter((j) => j.vu_role).length;
    const pct = total ? Math.round((vus / total) * 100) : 0;
    zProgres.textContent = `${vus} joueur${vus > 1 ? 's' : ''} sur ${total} ${vus > 1 ? 'ont' : 'a'} vu leur rôle`;
    barre.setAttribute('aria-valuemax', String(total));
    barre.setAttribute('aria-valuenow', String(vus));
    barre.setAttribute('aria-valuetext', `${vus} joueurs sur ${total} ont vu leur rôle`);
    barreTrait.style.width = `${pct}%`;
  }

  /** Bouton « J'ai compris » ou message d'attente. */
  function rendreVu(e) {
    const monVu = !!e.joueurs?.find((j) => j.user_id === e.moi?.user_id)?.vu_role || vuLocal;
    const estJoueur = !!e.moi?.joueur;
    btnVu.hidden = monVu || !estJoueur;
    attente.hidden = !monVu;
    btnVu.disabled = busy;
  }

  btnVu.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    btnVu.disabled = true;
    try {
      await s.lg.vu(s.code);
      vuLocal = true;
      busy = false;
      rendreVu(s.etat() || {});
      // Le focus ne doit pas se perdre quand le bouton disparaît.
      attente.focus();
      s.rafraichir?.();
    } catch (err) {
      notifier(erreurTexte(err), 'error');
      busy = false;
      btnVu.disabled = false;
    }
  });

  const tick = () => { zChrono.textContent = chrono(s.secondesRestantes()); };
  const minuteur = setInterval(tick, 1000);
  tick();

  function maj(e) {
    if (fini || !e) return;
    const moi = e.moi || {};
    if (moi.role || moi.role_initial) {
      const cle = `${moi.role || moi.role_initial}|${moi.camp || ''}`;
      if (zCarte.dataset.cle !== cle) {
        zCarte.dataset.cle = cle;
        rendreCarte(moi);
      }
    }
    rendreAllies(e);
    rendreProgres(e);
    rendreVu(e);
    tick();
  }

  maj(s.etat());

  return {
    maj,
    message() { /* pas de chat pendant la révélation */ },
    detruire() {
      fini = true;
      clearInterval(minuteur);
      delete document.body.dataset.lgAmbiance;
      root.innerHTML = '';
    },
  };
}
