// ===== Humane Gang : fil de discussion d'une demande (zone principale) =====
// createThread(el, { messages, me, onSend, onNote, placeholder?, hint?, label?, noteLabel? }) → { update(messages), destroy() }
//   messages : [{ id, type: 'message' | 'event', author { id, pseudo, color, avatar_url }, body, at, internal?, mine?, text? }]
//              type 'event' : séparateur centré, ex. { type:'event', text:'Domu a pris en charge', at } → « Domu a pris en charge · 14:18 ».
//              mine : force le côté admin (sinon, author.id === me).
//   me       : identifiant de l'admin connecté (affiché à droite, en accent).
//   onSend(texte) / onNote(texte) : appelés à l'envoi ; une promesse rejetée affiche une erreur et garde le texte.
//   Bascule « Note interne » : le message part en note (visible seulement dans le panel, teinte différente).
//   Ctrl+Entrée (ou ⌘+Entrée) envoie ; Entrée seule saute une ligne.
import { esc, avatarHtml } from '../../core/util.js';
import { toast } from '../../core/ui.js';
import { clock } from './time.js';
import { ICON } from './common.js';

let seq = 0;

export function createThread(el, opts = {}) {
  const uid = `ui-thread-${++seq}`;
  const state = { messages: opts.messages || [], me: opts.me ?? null, busy: false };
  const label = opts.label || 'Fil de discussion';
  const noteLabel = opts.noteLabel || 'Note interne';

  el.classList.add('ui-thread');
  el.innerHTML = `
    <div class="ui-thread-log" role="log" aria-label="${esc(label)}" aria-live="polite"></div>
    <form class="ui-composer" autocomplete="off">
      <div class="ui-box" data-internal="false">
        <label class="ui-sr" for="${uid}-ta">Votre réponse</label>
        <textarea id="${uid}-ta" class="ui-textarea" rows="2" placeholder="${esc(opts.placeholder || 'Votre réponse…')}"></textarea>
        <div class="ui-box-tools">
          <button type="button" class="ui-chip ui-note-toggle" aria-pressed="false">${ICON.note()}<span>${esc(noteLabel)}</span></button>
          <span class="ui-sp"></span>
          <button type="submit" class="ui-send"><span class="ui-send-txt">Envoyer</span>${ICON.send()}</button>
        </div>
      </div>
      ${opts.hint ? `<p class="ui-hint">${esc(opts.hint)}</p>` : ''}
    </form>`;

  const $log = el.querySelector('.ui-thread-log');
  const $form = el.querySelector('.ui-composer');
  const $box = el.querySelector('.ui-box');
  const $ta = el.querySelector('textarea');
  const $note = el.querySelector('.ui-note-toggle');
  const $send = el.querySelector('.ui-send');
  const $sendTxt = el.querySelector('.ui-send-txt');

  function isMine(m) {
    if (typeof m.mine === 'boolean') return m.mine;
    return state.me != null && m.author?.id === state.me;
  }

  function paintLog() {
    let prev = null;
    $log.innerHTML = state.messages.map((m) => {
      if (m.type === 'event') {
        prev = null;
        const txt = `${m.text || ''}${m.at ? ` · ${clock(m.at)}` : ''}`;
        return `<div class="ui-evt">${esc(txt)}</div>`;
      }
      const mine = isMine(m);
      const cont = !!prev && prev.author?.id === m.author?.id && prev.mine === mine && !!prev.internal === !!m.internal;
      prev = { ...m, mine };
      const cls = ['ui-msg', mine && 'is-admin', cont && 'is-cont', m.internal && 'is-note'].filter(Boolean).join(' ');
      const who = m.author?.pseudo || '';
      const meta = [who, mine ? 'admin' : '', clock(m.at), m.internal ? noteLabel : ''].filter(Boolean);
      return `<div class="${cls}" data-id="${esc(m.id ?? '')}">
        <div class="ui-av-wrap">${avatarHtml(m.author || {}, 34)}</div>
        <div class="ui-stack">
          <div class="ui-meta">${esc(meta[0])}${meta.slice(1).map((x) => ` · ${esc(x)}`).join('')}</div>
          <div class="ui-bubble">${esc(m.body)}</div>
        </div>
      </div>`;
    }).join('');
    $log.scrollTop = $log.scrollHeight;
  }

  $note.addEventListener('click', () => {
    const on = $note.getAttribute('aria-pressed') !== 'true';
    $note.setAttribute('aria-pressed', String(on));
    $box.dataset.internal = String(on);
    $ta.placeholder = on ? 'Note visible seulement par l’équipe admin…' : (opts.placeholder || 'Votre réponse…');
    $sendTxt.textContent = on ? 'Ajouter la note' : 'Envoyer';
  });

  $ta.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      $form.requestSubmit();
    }
  });

  $form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = $ta.value.trim();
    if (!text || state.busy) return;
    const internal = $note.getAttribute('aria-pressed') === 'true';
    const fn = internal ? opts.onNote : opts.onSend;
    if (!fn) return;
    state.busy = true;
    $send.disabled = true;
    $ta.readOnly = true;
    try {
      await fn(text, { internal });
      $ta.value = '';
    } catch (err) {
      toast(err?.message || 'Envoi impossible', 'error');
    } finally {
      state.busy = false;
      $send.disabled = false;
      $ta.readOnly = false;
      $ta.focus();
    }
  });

  paintLog();

  return {
    update(messages) {
      state.messages = messages || [];
      paintLog();
    },
    destroy() {
      el.innerHTML = '';
      el.classList.remove('ui-thread');
    },
  };
}
