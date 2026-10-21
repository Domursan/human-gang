// ===== Humane Gang — notifications push sur cet appareil (F9) =====
// Bloc « Notifications sur cet appareil » de la page Mon compte. Abonnement Web Push du navigateur (clé VAPID
// publique lue dans hg_settings), enregistré dans hg_push_subscriptions. Masqué si le navigateur ne gère pas le push.
import { sb, toast, errMsg } from './core.js';

const READY_TIMEOUT_MS = 4000;

const supported = () => window.isSecureContext && 'serviceWorker' in navigator
  && 'PushManager' in window && 'Notification' in window;

/** Clé publique VAPID (hg_settings, valeur JSON chaîne). Null si absente ou illisible. */
async function loadPublicKey() {
  try {
    const { data, error } = await sb.from('hg_settings').select('value').eq('key', 'push_vapid_public').maybeSingle();
    if (error || typeof data?.value !== 'string' || !data.value) return null;
    return data.value;
  } catch { return null; }
}

/** Base64url → Uint8Array (format attendu par pushManager.subscribe). */
function keyBytes(b64url) {
  const pad = '='.repeat((4 - (b64url.length % 4)) % 4);
  const raw = atob((b64url + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

/** Service worker prêt, ou null si l'enregistrement ne répond pas dans le délai. */
async function readyRegistration() {
  try {
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), READY_TIMEOUT_MS)),
    ]);
  } catch { return null; }
}

/**
 * Affiche le bloc dans `container` (élément déjà présent dans la page) pour le membre `me`.
 * Sans prise en charge du navigateur, le conteneur reste masqué.
 */
export async function mountPushBlock(container, me) {
  if (!container) return;
  if (!supported()) { container.hidden = true; return; }
  container.hidden = false;
  container.innerHTML = `
    <div class="card stack" id="push-card">
      <h2 class="card-title">Notifications sur cet appareil</h2>
      <p class="small muted">Reçois une alerte quand un message arrive, même lorsque le site est fermé. Le réglage concerne ce navigateur et cet appareil uniquement.</p>
      <p class="small muted" id="push-state" role="status">Vérification…</p>
      <div class="btn-row"><button class="btn btn-ghost" type="button" id="push-toggle" disabled>Chargement…</button></div>
    </div>`;

  const btn = container.querySelector('#push-toggle');
  const stateEl = container.querySelector('#push-state');
  const vapid = await loadPublicKey();
  const reg = await readyRegistration();

  function setState(text, { disabled = false, label = null } = {}) {
    stateEl.textContent = text;
    btn.disabled = disabled;
    if (label !== null) btn.textContent = label;
  }

  async function refresh() {
    if (!vapid || !reg) {
      setState('Notifications indisponibles pour le moment.', { disabled: true, label: 'Activer' });
      return;
    }
    if (Notification.permission === 'denied') {
      setState('Les notifications sont bloquées pour ce site. Réactive-les dans les réglages du navigateur.', { disabled: true, label: 'Activer' });
      return;
    }
    const sub = await reg.pushManager.getSubscription();
    if (sub) setState('Activées sur cet appareil.', { label: 'Désactiver' });
    else setState('Désactivées sur cet appareil.', { label: 'Activer' });
  }

  async function enable() {
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') { toast('Notifications non autorisées.', 'error'); return; }
    const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(vapid) });
    const json = sub.toJSON();
    const { error } = await sb.from('hg_push_subscriptions').upsert(
      { user_id: me.id, endpoint: json.endpoint, p256dh: json.keys.p256dh, auth: json.keys.auth },
      { onConflict: 'endpoint' },
    );
    if (error) { await sub.unsubscribe().catch(() => {}); throw error; }
    toast('Notifications activées sur cet appareil.', 'ok');
  }

  async function disable() {
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const { error } = await sb.from('hg_push_subscriptions').delete().eq('endpoint', sub.endpoint);
    if (error) throw error;
    await sub.unsubscribe().catch(() => {});
    toast('Notifications désactivées sur cet appareil.', 'ok');
  }

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) await disable(); else await enable();
    } catch (e) {
      toast(`Notifications : ${errMsg(e)}`, 'error');
    } finally {
      await refresh();
    }
  });

  await refresh();
}
