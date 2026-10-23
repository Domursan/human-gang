// ===== Humane Gang — page Jeux, onglet « Qui main ? » (idée J17 : « Qui main ce champion ? ») =====
/*
 * Rôle : catégorie du quiz « Questions du gang » jouée avec des avatars : « Qui joue Xayah en main ? », quatre membres
 * au choix, puis le contexte (« Xayah, main de Carzy depuis 2022 »). Les questions sont des questions à choix unique
 * du quiz existant (hg_quiz_questions) de catégorie « Qui main ? » (ou « Qui main ? · <jeu> », le jeu s'affiche en
 * pastille) ; chaque choix est le pseudo d'un membre. Gains et tentative unique : hg_quiz_answer (inchangé).
 * PARTIEL : la génération automatique depuis les profils gaming (idée P1, case « utilisable dans le quiz ») n'existe
 * pas encore ; en attendant, le Staff crée ces questions dans Admin › Questions du gang avec cette catégorie.
 * Maquette : idees-design/project/J17.dc.html.
 * Dépendances : ctx = { sb, toast, esc } (jeux.js) ; core/util.js (avatarHtml).
 * Exporte : mount(panel, ctx), CATEGORIE_RE.
 */
import { avatarHtml } from '../core/util.js';

/** Catégorie reconnue : « Qui main ? » éventuellement suivie de « · <jeu> ». */
export const CATEGORIE_RE = /^\s*qui main\s*\?\s*(?:[·:-]\s*(.+))?$/i;

/** Charge la feuille de style de l'onglet une seule fois. */
function css() {
  if (document.querySelector('link[data-jeux-css="qui-main"]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet';
  l.href = new URL('../../css/jeux-qui-main.css', import.meta.url).href;
  l.dataset.jeuxCss = 'qui-main';
  document.head.append(l);
}

/**
 * Énoncé en trois lignes quand il suit le modèle « Qui joue <X> en main ? », sinon tel quel.
 * @param {string} p énoncé
 * @param {Function} esc échappement HTML
 */
function enonce(p, esc) {
  const m = /^qui joue\s+(.+?)\s+en main\s*\?$/i.exec(String(p || '').trim());
  if (!m) return `<p class="qm-prompt">${esc(p)}</p>`;
  return `<p class="small muted">Qui joue</p><p class="qm-champion">${esc(m[1].toUpperCase())}</p><p class="small muted">en main ?</p>`;
}

/**
 * Monte l'onglet dans son panneau.
 * @param {HTMLElement} panel section role="tabpanel" vide
 * @param {{sb: object, toast: Function, esc: Function}} ctx contexte de la page Jeux
 */
export async function mount(panel, ctx) {
  const { sb, toast, esc } = ctx;
  css();
  panel.innerHTML = '<p class="card">Chargement des questions…</p>';
  let liste = [], membres = [];
  try {
    const [{ data, error }, mem] = await Promise.all([sb.rpc('hg_quiz_list'), sb.rpc('hg_members')]);
    if (error) throw error;
    liste = (Array.isArray(data) ? data : []).filter((q) => CATEGORIE_RE.test(q.category || '') && (q.type === 'choix_unique' || !q.type));
    membres = Array.isArray(mem?.data) ? mem.data : [];
  } catch (e) {
    panel.innerHTML = `<p class="card">Impossible de charger les questions (${esc(e?.message || String(e))}).</p>`;
    return;
  }
  /** Membre (pour l'avatar) à partir du texte d'un choix : le pseudo, sans tenir compte de la casse. */
  const membre = (txt) => membres.find((m) => String(m.pseudo).toLowerCase() === String(txt).trim().toLowerCase()) || { pseudo: txt };
  const ouvertes = () => liste.filter((q) => !q.answered);
  let courante = ouvertes()[0] || null;
  let resultat = null; // { q, choix, correct, solution, explanation, earned }

  const tete = '<div><p class="small muted">Questions du gang · profils gaming</p><h2 class="qm-titre">Qui main ce champion ?</h2></div>';
  const pied = '<a class="btn btn-ghost qm-profil" href="compte.html">Renseigner mes mains dans mon profil</a>';

  /** Dessine la question courante (ou le résultat de la dernière réponse). */
  const dessine = () => {
    const q = resultat?.q || courante;
    if (!q) {
      const faites = liste.filter((x) => x.answered).length;
      panel.innerHTML = `<div class="qm">${tete}<section class="card qm-carte"><p>${faites ? 'Tu as répondu à toutes les questions « Qui main ? » du moment. Bravo !' : 'Pas encore de question « Qui main ? » ouverte.'}</p>
        <p class="small muted">Les questions viennent des profils gaming des membres qui ont coché « utilisable dans le quiz », publiées par lots par le Staff.</p></section>${pied}</div>`;
      return;
    }
    const jeu = CATEGORIE_RE.exec(q.category || '')?.[1] || '';
    const tous = liste.length, rang = liste.indexOf(q) + 1;
    const opts = (q.options || []).map((o) => {
      const m = membre(o.text);
      let cls = '', note = '&nbsp;';
      if (resultat) {
        const bon = String(o.id) === String(resultat.solution), mien = String(o.id) === String(resultat.choix);
        if (bon) { cls = ' is-bon'; note = mien ? 'Bonne réponse · ton choix' : 'Bonne réponse'; } else if (mien) { cls = ' is-faux'; note = 'Ton choix'; }
      }
      return `<button type="button" class="qm-opt${cls}" data-opt="${esc(o.id)}"${resultat ? ' disabled' : ''}>
        ${avatarHtml(m, 46)}<span class="qm-pseudo">${esc(o.text)}</span><span class="small qm-note">${note}</span></button>`;
    }).join('');
    const suivante = resultat ? ouvertes()[0] : null;
    const bon = resultat && resultat.correct;
    const auteur = resultat ? membre((q.options || []).find((o) => String(o.id) === String(resultat.solution))?.text || '') : null;
    panel.innerHTML = `<div class="qm">${tete}
      <section class="card qm-carte" aria-labelledby="qm-q">
        <div class="qm-ligne">${jeu ? `<span class="pill qm-jeu">${esc(jeu)}</span>` : ''}<span class="pill">Question ${esc(String(rang))} / ${esc(String(tous))}</span><span class="qm-gain">+${esc(String(q.reward ?? 0))}</span></div>
        <div class="qm-enonce" id="qm-q">${enonce(q.prompt, esc)}</div>
        <div class="qm-opts" role="group" aria-label="Choisis le membre">${opts}</div>
        ${resultat ? `<div role="status" class="qm-res ${bon ? 'is-bon' : 'is-faux'}" tabindex="-1">${avatarHtml(auteur || {}, 36)}<div>
            <p class="qm-res-t">${bon ? 'Bien vu !' : 'Raté…'} ${esc(resultat.explanation || '')}</p>
            <p class="small muted">${bon && resultat.earned ? `+${esc(String(resultat.earned))} ✦ · ` : ''}D’après son profil gaming (case « utilisable dans le quiz » cochée).</p></div></div>
          <div class="qm-ligne qm-fin">${suivante ? '<button type="button" class="btn btn-ghost" data-suivante>Question suivante</button>' : '<span class="small muted">C’était la dernière question du lot.</span>'}</div>` : ''}
      </section>
      ${suivante ? `<div class="qm-boite"><p class="small muted qm-lbl">Question suivante</p><p class="qm-next">${esc(suivante.prompt)}</p><p class="small muted">Lot généré par le Staff à partir des profils, relu avant publication.</p></div>` : ''}
      ${pied}</div>`;
    panel.querySelectorAll('[data-opt]:not([disabled])').forEach((b) => b.addEventListener('click', () => repond(q, b.dataset.opt)));
    panel.querySelector('[data-suivante]')?.addEventListener('click', () => {
      resultat = null; courante = ouvertes()[0] || null; dessine();
      panel.querySelector('.qm-opt')?.focus();
    });
    if (resultat) panel.querySelector('.qm-res')?.focus();
  };

  /** Envoie la réponse (une seule tentative) puis affiche le résultat. */
  const repond = async (q, choix) => {
    panel.querySelectorAll('.qm-opt').forEach((b) => { b.disabled = true; });
    try {
      const { data, error } = await sb.rpc('hg_quiz_answer', { p_question: q.id, p_response: choix });
      if (error) throw error;
      Object.assign(q, { answered: true, my_response: choix, correct: data?.correct ?? null, earned: data?.reward ?? 0 });
      resultat = { q, choix, correct: !!data?.correct, solution: data?.solution ?? null, explanation: data?.explanation ?? '', earned: data?.reward ?? 0 };
      if (resultat.correct && resultat.earned) toast(`Bien vu ! +${resultat.earned} ✦`, 'success');
      dessine();
    } catch (e) {
      toast(e?.message || String(e), 'error');
      panel.querySelectorAll('.qm-opt').forEach((b) => { b.disabled = false; });
    }
  };

  dessine();
}
