// ===== Humane Gang — quêtes à preuve (idée J11) : envoi d'une preuve par le membre =====
/*
 * Rôle : fenêtre « Envoyer une preuve » ouverte depuis les quêtes de la semaine (cartes.js) : 1 à 3 captures
 * (compressées par image-compress.js), un mot facultatif (300 caractères), « Partager dans le fil » si validée.
 * Les captures vont dans le bucket privé hg-proofs, dossier du membre (lisible par lui et par le Staff « preuves »),
 * puis la RPC hg_proof_submit enregistre la preuve (quête de la semaine, 2 tentatives au plus).
 * Exporte : openProof(quest, { uid, sb, toast, esc, onDone }), proofCss().
 */
import { paillSym } from '../../commun/paillettes.js';
import { prepareImage } from '../../commun/image-compress.js';

const BUCKET = 'hg-proofs';
const MAX = 3;

/** Ajoute la feuille de style une seule fois (aussi appelée par cartes.js pour les états des quêtes). */
export function proofCss() {
  if (document.querySelector('link[data-qp-css]')) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = new URL('./quest-proofs.css', import.meta.url).href; l.dataset.qpCss = '1';
  document.head.append(l);
}

/** Identifiant de fichier aléatoire (lettres et chiffres). */
const rid = () => Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 16);

/**
 * Ouvre la fenêtre d'envoi d'une preuve.
 * @param {object} q Quête (code, label, proof_game, proof_status, proof_reason, proof_attempts, reward).
 * @param {{uid: string, sb: object, toast: Function, esc: Function, onDone: Function}} o
 */
export function openProof(q, o) {
  proofCss();
  const esc = o.esc;
  const again = q.proof_status === 'refusee';
  const dlg = document.createElement('dialog');
  dlg.className = 'qp-dialog';
  dlg.setAttribute('aria-labelledby', 'qp-title');
  dlg.innerHTML = `<form method="dialog" class="qp-form" id="qp-form" novalidate>
      <h2 id="qp-title" class="qp-title">${again ? 'Renvoyer une preuve' : 'Envoyer une preuve'}</h2>
      <p class="qp-quest"><strong>${esc(q.label)}</strong>${q.proof_game ? ` <span class="muted">· ${esc(q.proof_game)}</span>` : ''}</p>
      ${again ? `<p class="qp-refus" role="note">Refusée : « ${esc(q.proof_reason || '')} ». Dernière tentative possible.</p>` : ''}
      <p class="muted small">Un membre du Staff regarde ta capture puis valide : la récompense (${esc(q.reward)} ${paillSym()}) arrive à ce moment-là. Recadre ta capture : pas de conversation, de pseudo d’inconnu ni de bureau perso.</p>
      <div class="field"><label for="qp-files">Captures (1 à ${MAX})</label>
        <input id="qp-files" type="file" accept="image/png,image/jpeg,image/webp" multiple required></div>
      <ul class="qp-thumbs" id="qp-thumbs" aria-label="Captures choisies"></ul>
      <div class="field"><label for="qp-note">Un mot pour le Staff (facultatif)</label>
        <textarea id="qp-note" class="input" maxlength="300" rows="3" placeholder="12 fours en ligne, alimentés par la mine du nord."></textarea></div>
      <label class="check qp-share"><input type="checkbox" id="qp-share"> Partager dans le fil d’activité si elle est validée</label>
      <p class="qp-err" id="qp-err" role="alert"></p>
      <div class="qp-actions"><button type="button" class="btn btn-ghost" data-qp="cancel">Annuler</button>
        <button type="submit" class="btn btn-primary" id="qp-send">Envoyer</button></div>
    </form>`;
  document.body.append(dlg);
  const $ = (s) => dlg.querySelector(s);
  let files = [];
  const thumbs = () => {
    $('#qp-thumbs').innerHTML = files.map((f, i) => `<li class="qp-thumb"><img src="${esc(URL.createObjectURL(f))}" alt="Capture ${i + 1}" decoding="async"><span class="small">${esc(f.name)}</span></li>`).join('');
  };
  $('#qp-files').addEventListener('change', (e) => {
    files = [...e.target.files].slice(0, MAX);
    $('#qp-err').textContent = e.target.files.length > MAX ? `${MAX} captures au plus : les premières sont gardées.` : '';
    thumbs();
  });
  const close = () => { dlg.close(); dlg.remove(); };
  dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(); });
  $('[data-qp="cancel"]').addEventListener('click', close);
  $('#qp-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!files.length) { $('#qp-err').textContent = 'Choisis au moins une capture.'; $('#qp-files').focus(); return; }
    const btn = $('#qp-send');
    btn.disabled = true; btn.textContent = 'Envoi…';
    try {
      const paths = [];
      for (const f of files) {
        const img = await prepareImage(f);
        const ext = ['webp', 'jpg', 'png'].includes(img.ext) ? img.ext : 'webp';
        const path = `${o.uid}/${rid()}.${ext}`;
        const { error } = await o.sb.storage.from(BUCKET).upload(path, img.blob, { contentType: img.contentType, upsert: false });
        if (error) throw error;
        paths.push(path);
      }
      const { error } = await o.sb.rpc('hg_proof_submit', { p_quest: q.code, p_paths: paths, p_note: $('#qp-note').value.trim() || null, p_share: $('#qp-share').checked });
      if (error) throw error;
      o.toast('Preuve envoyée : le Staff va la regarder.', 'ok');
      close();
      o.onDone?.();
    } catch (err) {
      $('#qp-err').textContent = err?.message || String(err);
      btn.disabled = false; btn.textContent = 'Envoyer';
    }
  });
  dlg.showModal();
  $('#qp-files').focus();
}
