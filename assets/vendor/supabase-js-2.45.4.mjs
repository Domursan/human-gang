// Wrapper ESM de supabase-js 2.45.4 (MIT). Voir assets/vendor/README.md.
// Le build UMD voisin (supabase-js-2.45.4.js) est chargé comme script classique : son runtime webpack a besoin de
// document.currentScript pour trouver son chemin, ce qui n'existe pas dans un module. Il pose window.supabase.
if (!globalThis.supabase) {
  await new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = new URL('./supabase-js-2.45.4.js', import.meta.url).href;
    s.onload = resolve;
    s.onerror = () => reject(new Error('supabase-js introuvable : ' + s.src));
    document.head.appendChild(s);
  });
}

const sb = globalThis.supabase;
export const createClient = sb.createClient;
export default sb;
