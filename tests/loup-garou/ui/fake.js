// Faux Supabase pour les tests d'interface : intercepte les appels du site et les rejoue sur la base locale « lg » via psql.
const { execFileSync } = require('child_process');
const SB = 'https://zqbdzokyhgavgmqgiwuw.supabase.co';
const uid = (n) => '00000000-0000-0000-0000-0000000000' + String(n).padStart(2, '0');
const lit = (v) => v === null || v === undefined ? 'null' : "'" + (typeof v === 'object' ? JSON.stringify(v) : String(v)).replace(/'/g, "''") + "'";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (n) => `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: uid(n), role: 'authenticated', exp: 4102444800 })}.x`;

function psql(user, sql) {
  const claims = JSON.stringify(user ? { sub: user, role: 'authenticated' } : { role: 'anon' });
  const full = `begin;\nselect set_config('request.jwt.claims', ${lit(claims)}, true) \\g /dev/null\nset local role ${user ? 'authenticated' : 'anon'};\n${sql};\ncommit;`;
  try {
    const out = execFileSync('psql', ['-h', '/tmp', '-p', '54329', '-U', 'postgres', '-d', process.env.FAKE_DB || 'lg', '-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], { input: full, encoding: 'utf8' });
    const lines = out.split('\n').filter((l) => l.length && l !== 'BEGIN' && l !== 'COMMIT' && l !== 'SET');
    return { ok: true, text: lines.length ? lines[lines.length - 1] : '' };
  } catch (e) {
    const m = /ERROR:\s+(.*)/.exec(String(e.stderr || e.message));
    return { ok: false, message: m ? m[1] : String(e.stderr || e.message) };
  }
}
const procs = new Map();
function procInfo(name) {
  if (!procs.has(name)) {
    const r = psql(null, `reset role; select coalesce((select json_build_object('set', proretset, 'type', prorettype::regtype::text) from pg_proc where proname = ${lit(name)} and pronamespace = 'public'::regnamespace limit 1), 'null')`);
    procs.set(name, r.ok ? JSON.parse(r.text || 'null') : null);
  }
  return procs.get(name);
}
const OPS = { eq: '=', neq: '<>', gt: '>', gte: '>=', lt: '<', lte: '<=', is: 'is' };
const ident = (s) => '"' + s.replace(/"/g, '') + '"';
function tableSql(table, params) {
  const sel = params.get('select') || '*';
  const cols = sel === '*' ? '*' : sel.split(',').map((c) => c.trim()).filter((c) => /^[a-z_0-9]+$/.test(c)).map(ident).join(', ') || '*';
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
    const m = /^(not\.)?([a-z]+)\.(.*)$/s.exec(v); if (!m) continue;
    const [, neg, op, val] = m; let cond;
    if (op === 'in') cond = `${ident(k)}::text in (${val.replace(/^\(|\)$/g, '').split(',').map((x) => lit(x.replace(/^"|"$/g, ''))).join(',')})`;
    else if (op === 'is') cond = `${ident(k)} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`;
    else if (OPS[op]) cond = `${ident(k)}::text ${OPS[op]} ${lit(val)}`;
    else continue;
    if (['gt', 'gte', 'lt', 'lte'].includes(op)) cond = `${ident(k)} ${OPS[op]} ${lit(val)}`;
    where.push(neg ? `not (${cond})` : cond);
  }
  let q = `select ${cols} from public.${ident(table)}` + (where.length ? ' where ' + where.join(' and ') : '');
  const ord = params.get('order');
  if (ord) q += ' order by ' + ord.split(',').map((o) => { const [c, d] = o.split('.'); return ident(c) + (d === 'desc' ? ' desc' : ''); }).join(', ');
  if (params.get('limit')) q += ' limit ' + parseInt(params.get('limit'), 10);
  if (params.get('offset')) q += ' offset ' + parseInt(params.get('offset'), 10);
  return `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from (${q}) t`;
}
const exists = new Map();
function tableExists(t) {
  if (!exists.has(t)) { const r = psql(null, `reset role; select to_regclass(${lit('public.' + t)}) is not null`); exists.set(t, r.ok && r.text === 't'); }
  return exists.get(t);
}
const log = [];
async function handle(route, n) {
  const req = route.request(); const url = new URL(req.url()); const user = n ? uid(n) : null;
  const json = (status, body) => route.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: JSON.stringify(body) });
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  if (url.pathname.startsWith('/auth/v1/user')) return n ? json(200, { id: user, aud: 'authenticated', role: 'authenticated', email: `j${n}@test` }) : json(401, { message: 'no session' });
  if (url.pathname.startsWith('/auth/v1/')) return json(200, {});
  if (url.pathname.startsWith('/storage/') || url.pathname.startsWith('/functions/')) return json(200, {});
  const rpc = /^\/rest\/v1\/rpc\/([a-z_0-9]+)$/.exec(url.pathname);
  const single = (req.headers()['accept'] || '').includes('vnd.pgrst.object');
  if (rpc) {
    const name = rpc[1]; const info = procInfo(name);
    if (!info) { log.push(`rpc inconnue ${name}`); return json(200, null); }
    const body = req.postData() ? JSON.parse(req.postData()) : {};
    const args = Object.entries(body).map(([k, v]) => `${ident(k)} => ${lit(v)}`).join(', ');
    const sql = info.set ? `select coalesce(jsonb_agg(to_jsonb(r)), '[]'::jsonb) from public.${name}(${args}) r`
      : info.type === 'void' ? `select public.${name}(${args})::text, 'null'` : `select coalesce(to_jsonb(public.${name}(${args})), 'null'::jsonb)`;
    const r = psql(user, sql);
    if (!r.ok) { log.push(`rpc ${name} : ${r.message}`); return json(400, { code: 'P0001', message: r.message, details: null, hint: null }); }
    let out = info.type === 'void' ? null : JSON.parse(r.text || 'null');
    if (info.type === 'void') out = null;
    return json(200, out);
  }
  const tab = /^\/rest\/v1\/([a-z_0-9]+)$/.exec(url.pathname);
  if (tab) {
    if (req.method() !== 'GET' || !tableExists(tab[1])) return json(200, single ? null : []);
    const r = psql(user, tableSql(tab[1], url.searchParams));
    if (!r.ok) { log.push(`table ${tab[1]} : ${r.message}`); return json(400, { message: r.message }); }
    const rows = JSON.parse(r.text);
    return json(200, single ? (rows[0] ?? null) : rows);
  }
  return json(200, null);
}
async function attach(context, n) {
  if (!n) {   // visiteur sans compte
    await context.addInitScript(() => { try { localStorage.setItem('hg_cookie_ok', '1'); } catch {} });
  } else await context.addInitScript(([key, val]) => { try { localStorage.setItem(key, val); localStorage.setItem('hg_cookie_ok', '1'); } catch {} }, ['sb-zqbdzokyhgavgmqgiwuw-auth-token', JSON.stringify({
    access_token: jwt(n), refresh_token: 'r' + n, token_type: 'bearer', expires_in: 3600 * 24 * 365, expires_at: 4102444800,
    user: { id: uid(n), aud: 'authenticated', role: 'authenticated', email: `j${n}@test` } })]);
  await context.route((u) => !/^http:\/\/localhost:8080\//.test(u.toString()) && !u.toString().startsWith(SB), (r) => r.abort());
  await context.route(SB + '/**', (r) => handle(r, n));
  if (context.routeWebSocket) await context.routeWebSocket(/supabase\.co/, () => {});
}
module.exports = { attach, uid, psql, log };
