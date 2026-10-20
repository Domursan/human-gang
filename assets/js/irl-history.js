// ===== Humane Gang — IRL : historique des rencontres, rencontres passées, « Qui était là ? », carte =====
import { sb, toast, errMsg, esc, $, $$, fmtDate, avatarHtml } from './core.js';
import { compressImage, uploadImage, removeObjects, uuid } from './photos.js';

const LEAFLET = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist';
const GEO_KEY = 'hg_geo_v1';
const GEO_RETRY_MS = 30 * 86400000;   // un lieu introuvable est retenté après 30 jours
const GEO_GAP_MS = 1100;              // Nominatim : 1 requête par seconde au plus
const PEOPLE_MAX = 8;                 // avatars affichés par carte avant « +n »
const MONTH = new Intl.DateTimeFormat('fr-CH', { month: 'long', year: 'numeric' });
const MONTH_SHORT = new Intl.DateTimeFormat('fr-CH', { month: 'short' });

/** Normalise un texte pour comparer (casse, accents, espaces). */
export const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const monthKey = (d) => d.getFullYear() * 12 + d.getMonth();

/**
 * ctx : { me, isAdmin, S, classify, member, pseudo, canEdit, plural, tint, I, refresh }
 */
export function mountHistory(ctx) {
  const { me, S, I } = ctx;
  const F = { year: '', place: '', person: '', q: '' };
  const presents = (id) => S.rsvps.filter((r) => r.event_id === id && r.status === 'oui').map((r) => r.user_id);
  const photosOf = (id) => S.photos.filter((p) => p.event_id === id);
  const yearOf = (ev) => new Date(ev.starts_at).getFullYear();

  /* ============ Sélecteur de participants (réutilisé par les deux dialogs) ============ */
  function createPicker(host, idp) {
    host.innerHTML = `<div class="picker">
      <div class="picker-top">
        <input type="search" class="input picker-q" id="${idp}-q" placeholder="Chercher un membre…" aria-label="Chercher un membre" autocomplete="off">
        <span class="small muted picker-count" aria-live="polite"></span>
      </div>
      <ul class="picker-list"></ul>
      <p class="small muted picker-none" hidden>Aucun membre ne correspond.</p>
    </div>`;
    const q = $('.picker-q', host), list = $('.picker-list', host), count = $('.picker-count', host), none = $('.picker-none', host);
    let sel = new Set();
    const updCount = () => { count.textContent = sel.size ? ctx.plural(sel.size, 'personne cochée', 'personnes cochées') : 'Personne de coché'; };
    const filter = () => {
      const t = norm(q.value);
      let shown = 0;
      $$('li', list).forEach((li) => { const ok = !t || li.dataset.name.includes(t); li.hidden = !ok; shown += ok; });
      none.hidden = shown > 0;
    };
    q.addEventListener('input', filter);
    q.addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    list.addEventListener('change', (e) => {
      const cb = e.target.closest('input[type="checkbox"]');
      if (!cb) return;
      if (cb.checked) sel.add(cb.value); else sel.delete(cb.value);
      updCount();
    });
    return {
      set(ids) {
        sel = new Set(ids);
        const people = [...S.members.values()].map((m) => ({ ...m }));
        for (const id of sel) if (!S.members.has(id)) people.push({ id, pseudo: 'Ancien membre' });
        people.sort((a, b) => (b.id === me.id) - (a.id === me.id) || String(a.pseudo).localeCompare(String(b.pseudo), 'fr'));
        list.innerHTML = people.map((m) => `<li data-name="${esc(norm(m.pseudo))}"><label class="pick">
            <input type="checkbox" value="${esc(m.id)}"${sel.has(m.id) ? ' checked' : ''}>
            ${avatarHtml(m, 28)}<span>${esc(m.pseudo)}${m.id === me.id ? ' <span class="muted">(toi)</span>' : ''}</span>
          </label></li>`).join('');
        q.value = '';
        filter(); updCount();
      },
      get: () => new Set(sel),
    };
  }

  /** Aligne les présents (« oui ») d'une sortie sur la sélection. Autorisé à l'organisateur / l'admin (policy hg_rsvps_creator). */
  async function syncPresence(eventId, selected) {
    const current = new Set(presents(eventId));
    const add = [...selected].filter((id) => !current.has(id));
    const drop = [...current].filter((id) => !selected.has(id));
    const now = new Date().toISOString();
    if (add.length) {
      const { error } = await sb.from('hg_event_rsvps').upsert(
        add.map((user_id) => ({ event_id: eventId, user_id, status: 'oui', updated_at: now })), { onConflict: 'event_id,user_id' });
      if (error) throw error;
    }
    if (drop.length) {
      const { error } = await sb.from('hg_event_rsvps').delete().eq('event_id', eventId).in('user_id', drop);
      if (error) throw error;
    }
  }

  /* ============ Dialog « rencontre passée » (création + modification) ============ */
  const rDlg = $('#retro-dialog'), rForm = $('#retro-form');
  const rPicker = createPicker($('#rt-picker'), 'rt');
  let rEditing = null;
  $$('[data-close]', rDlg).forEach((b) => b.addEventListener('click', () => rDlg.close()));

  function openRetro(ev = null) {
    rEditing = ev;
    rForm.reset();
    $('#rt-status').textContent = '';
    $('#rt-dlg-title').textContent = ev ? 'Modifier la rencontre' : 'Ajouter une rencontre passée';
    $('#rt-submit').textContent = ev ? 'Enregistrer' : 'Ajouter la rencontre';
    $('#rt-intro').hidden = !!ev;
    $('#rt-photos-field').hidden = !!ev;   // en modification, les photos s'ajoutent depuis l'album
    rForm.elements.date.max = ymd(new Date());
    // Lieux déjà utilisés en suggestion
    const places = new Map();
    for (const e of S.events) if (e.location) places.set(norm(e.location), e.location.trim());
    $('#rt-places').innerHTML = [...places.values()].sort((a, b) => a.localeCompare(b, 'fr')).map((p) => `<option value="${esc(p)}"></option>`).join('');
    const cur = $('#rt-cover-current');
    cur.hidden = !ev?.cover_path;
    cur.innerHTML = ev?.cover_path ? '<label class="check"><input type="checkbox" name="remove_cover"><span>Retirer l\'image de couverture actuelle</span></label>' : '';
    if (ev) {
      const d = new Date(ev.starts_at);
      rForm.elements.title.value = ev.title || '';
      rForm.elements.date.value = ymd(d);
      const hm = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
      rForm.elements.time.value = hm === '12:00' ? '' : hm;
      rForm.elements.location.value = ev.location || '';
      rForm.elements.description.value = ev.description || '';
    }
    rPicker.set(ev ? presents(ev.id) : [me.id]);
    rDlg.showModal();
    rForm.elements.title.focus();
  }

  rForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = rForm.elements;
    const title = f.title.value.trim();
    if (!title) { toast('Donne un titre à la rencontre.', 'error'); f.title.focus(); return; }
    if (!f.date.value) { toast('Indique la date de la rencontre.', 'error'); f.date.focus(); return; }
    const today = ymd(new Date());
    if (f.date.value > today) { toast('La date doit être dans le passé.', 'error'); f.date.focus(); return; }
    let start = new Date(`${f.date.value}T${f.time.value || '12:00'}`);
    if (Number.isNaN(start.getTime())) { toast('Date invalide.', 'error'); f.date.focus(); return; }
    if (start > new Date()) {
      if (f.time.value) { toast('Cette heure est dans le futur : une rencontre passée doit déjà avoir eu lieu.', 'error'); f.time.focus(); return; }
      start = new Date(Date.now() - 60000);   // aujourd'hui sans heure, avant midi
    }
    const who = rPicker.get();
    if (!who.size) { toast('Coche au moins une personne présente.', 'error'); $('#rt-q')?.focus(); return; }
    const payload = { title, starts_at: start.toISOString(), location: f.location.value.trim() || null, description: f.description.value.trim() || null };
    const photos = rEditing ? [] : [...f.photos.files];
    const coverFile = f.cover.files[0];
    const removeCover = !!f.remove_cover?.checked;
    const status = $('#rt-status');
    const btn = $('#rt-submit');
    btn.disabled = true;
    try {
      let id = rEditing?.id;
      if (rEditing) {
        const { error } = await sb.from('hg_events').update(payload).eq('id', id);
        if (error) throw error;
        await syncPresence(id, who);
      } else {
        status.textContent = 'Enregistrement…';
        const { data, error } = await sb.from('hg_events').insert({ ...payload, created_by: me.id, retro: true }).select().single();
        if (error) throw error;
        id = data.id;
        const now = new Date().toISOString();
        const { error: e2 } = await sb.from('hg_event_rsvps').upsert(
          [...who].map((user_id) => ({ event_id: id, user_id, status: 'oui', updated_at: now })), { onConflict: 'event_id,user_id' });
        if (e2) toast(`Rencontre ajoutée, mais présents non enregistrés : ${errMsg(e2)}`, 'error');
      }

      // Couverture
      const old = rEditing?.cover_path || null;
      try {
        if (coverFile) {
          status.textContent = 'Envoi de la couverture…';
          const blob = await compressImage(coverFile);
          const path = `${me.id}/${id}/cover-${uuid().slice(0, 8)}.jpg`;
          await uploadImage(path, blob);
          const { error } = await sb.from('hg_events').update({ cover_path: path }).eq('id', id);
          if (error) throw error;
          if (old) removeObjects([old]).catch(() => {});
        } else if (removeCover && old) {
          const { error } = await sb.from('hg_events').update({ cover_path: null }).eq('id', id);
          if (error) throw error;
          removeObjects([old]).catch(() => {});
        }
      } catch (err) { toast(`Rencontre enregistrée, mais couverture non envoyée : ${errMsg(err)}`, 'error'); }

      // Photos de l'album
      let ok = 0;
      for (const [i, file] of photos.entries()) {
        status.textContent = `Compression et envoi des photos ${i + 1} / ${photos.length}…`;
        let path = null;
        try {
          const blob = await compressImage(file);
          path = `${me.id}/${id}/${uuid()}.jpg`;
          await uploadImage(path, blob);
          const { error } = await sb.from('hg_photos').insert({ event_id: id, user_id: me.id, path });
          if (error) throw error;
          ok++;
        } catch (err) {
          if (path) removeObjects([path]).catch(() => {});
          toast(`${file.name} : ${errMsg(err)}`, 'error');
        }
      }
      // Pas de notify('irl_new') : une rencontre passée ne doit pas prévenir le gang comme une nouvelle sortie.
      toast(rEditing ? 'Rencontre mise à jour.' : `Rencontre ajoutée à l'historique${ok ? ` avec ${ctx.plural(ok, 'photo', 'photos')}` : ''}.`, 'ok');
      rDlg.close();
      await ctx.refresh();
      if (!rEditing) { setTab('historique'); resetFilters(); focusCard(id); }
    } catch (err) {
      toast(`Enregistrement impossible : ${errMsg(err)}`, 'error');
    } finally { btn.disabled = false; status.textContent = ''; }
  });

  /* ============ Dialog « Qui était là ? » ============ */
  const wDlg = $('#who-dialog'), wForm = $('#who-form');
  const wPicker = createPicker($('#who-picker'), 'who');
  let wEvent = null;
  $$('[data-close]', wDlg).forEach((b) => b.addEventListener('click', () => wDlg.close()));
  function openWho(ev) {
    if (!ev) return;
    wEvent = ev;
    $('#who-sub').textContent = `${ev.title} · ${fmtDate(ev.starts_at)}`;
    wPicker.set(presents(ev.id));
    wDlg.showModal();
    $('#who-q').focus();
  }
  wForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!wEvent) return;
    const btn = $('#who-submit');
    btn.disabled = true;
    try {
      await syncPresence(wEvent.id, wPicker.get());
      toast('Liste des présents mise à jour.', 'ok');
      const id = wEvent.id;
      wDlg.close();
      await ctx.refresh();
      focusCard(id, { quiet: true });
    } catch (err) { toast(`Présents non enregistrés : ${errMsg(err)}`, 'error'); } finally { btn.disabled = false; }
  });

  /* ============ Onglets ============ */
  const tabs = $$('.irl-tab');
  function setTab(name, { focus = false } = {}) {
    for (const t of tabs) {
      const on = t.id === `tab-${name}`;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      $(`#${t.getAttribute('aria-controls')}`).hidden = !on;
      if (on && focus) t.focus();
    }
    const want = name === 'historique' ? '#historique' : (location.hash === '#historique' ? '' : location.hash);
    if (location.hash !== want) history.replaceState(null, '', `${location.pathname}${location.search}${want}`);
    if (name === 'historique') render();
  }
  tabs.forEach((t, i) => {
    t.addEventListener('click', () => setTab(t.id.slice(4)));
    t.addEventListener('keydown', (e) => {
      const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
      if (!k) return;
      e.preventDefault();
      setTab(tabs[(i + k + tabs.length) % tabs.length].id.slice(4), { focus: true });
    });
  });
  const isOpen = () => !$('#view-historique').hidden;

  /* ============ Filtres ============ */
  const qInput = $('#hx-q'), placeSel = $('#hx-place'), personSel = $('#hx-person');
  let qTimer;
  qInput.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => { F.q = norm(qInput.value); render(); }, 150); });
  placeSel.addEventListener('change', () => { F.place = placeSel.value; render(); });
  personSel.addEventListener('change', () => { F.person = personSel.value; render(); });
  $('#hx-years').addEventListener('click', (e) => {
    const b = e.target.closest('[data-year]');
    if (!b) return;
    F.year = b.dataset.year;
    render();
    $(`#hx-years [data-year="${CSS.escape(F.year)}"]`)?.focus();
  });
  $('#hx-reset').addEventListener('click', () => { resetFilters(); render(); qInput.focus(); });
  function resetFilters() { F.year = ''; F.place = ''; F.person = ''; F.q = ''; qInput.value = ''; }

  function haystack(ev) {
    return norm([ev.title, ev.location, ev.description, ...presents(ev.id).map(ctx.pseudo)].join(' '));
  }
  const match = (ev, skip = '') => (skip === 'year' || !F.year || String(yearOf(ev)) === F.year)
    && (!F.place || norm(ev.location) === F.place)
    && (!F.person || presents(ev.id).includes(F.person))
    && (!F.q || haystack(ev).includes(F.q));

  function renderFilters(all) {
    // Années (avec le nombre de rencontres correspondant aux autres filtres)
    const years = [...new Set(all.map(yearOf))].sort((a, b) => b - a);
    if (F.year && !years.includes(Number(F.year))) F.year = '';
    const pool = all.filter((ev) => match(ev, 'year'));
    const cnt = (y) => pool.filter((ev) => yearOf(ev) === y).length;
    $('#hx-years').innerHTML = [`<button type="button" class="hx-chip" data-year="" aria-pressed="${!F.year}">Toutes <span>${pool.length}</span></button>`,
      ...years.map((y) => `<button type="button" class="hx-chip" data-year="${y}" aria-pressed="${F.year === String(y)}">${y} <span>${cnt(y)}</span></button>`)].join('');
    // Lieux
    const places = new Map();
    for (const ev of all) {
      if (!ev.location) continue;
      const k = norm(ev.location);
      const p = places.get(k) || { label: ev.location.trim(), n: 0 };
      p.n++; places.set(k, p);
    }
    if (F.place && !places.has(F.place)) F.place = '';
    placeSel.innerHTML = '<option value="">Tous les lieux</option>' + [...places.entries()]
      .sort((a, b) => a[1].label.localeCompare(b[1].label, 'fr'))
      .map(([k, p]) => `<option value="${esc(k)}"${k === F.place ? ' selected' : ''}>${esc(p.label)} (${p.n})</option>`).join('');
    // Personnes ayant participé à au moins une rencontre
    const people = new Map();
    for (const ev of all) for (const id of presents(ev.id)) people.set(id, (people.get(id) || 0) + 1);
    if (F.person && !people.has(F.person)) F.person = '';
    personSel.innerHTML = '<option value="">Tout le monde</option>' + [...people.entries()]
      .map(([id, n]) => ({ id, n, name: id === me.id ? `Toi (${ctx.pseudo(id)})` : ctx.pseudo(id) }))
      .sort((a, b) => (b.id === me.id) - (a.id === me.id) || a.name.localeCompare(b.name, 'fr'))
      .map((p) => `<option value="${esc(p.id)}"${p.id === F.person ? ' selected' : ''}>${esc(p.name)} (${p.n})</option>`).join('');
    $('#hx-reset').hidden = !(F.year || F.place || F.person || F.q);
  }

  /* ============ Statistiques ============ */
  function stats(list) {
    const n = list.length;
    const places = new Map();
    const people = new Map();
    const months = new Map();
    let mine = 0, first = null;
    for (const ev of list) {
      if (ev.location) {
        const k = norm(ev.location);
        const p = places.get(k) || { label: ev.location.trim(), n: 0 };
        p.n++; places.set(k, p);
      }
      const who = presents(ev.id);
      if (who.includes(me.id)) mine++;
      for (const id of who) people.set(id, (people.get(id) || 0) + 1);
      const d = new Date(ev.starts_at);
      months.set(monthKey(d), (months.get(monthKey(d)) || 0) + 1);
      if (!first || d < first) first = d;
    }
    let best = null;
    for (const [k, c] of months) if (!best || c > best.c || (c === best.c && k > best.k)) best = { k, c };
    const keys = [...months.keys()].sort((a, b) => a - b);
    let streak = { len: 0, end: null }, run = 0;
    keys.forEach((k, i) => {
      run = i && k === keys[i - 1] + 1 ? run + 1 : 1;
      if (run > streak.len) streak = { len: run, end: k };
    });
    const top = (m) => [...m.entries()].sort((a, b) => b[1].n - a[1].n || a[1].label.localeCompare(b[1].label, 'fr')).slice(0, 3).map(([, v]) => v);
    const topPeople = [...people.entries()].map(([id, c]) => ({ id, n: c, label: ctx.pseudo(id) }))
      .sort((a, b) => b.n - a.n || a.label.localeCompare(b.label, 'fr')).slice(0, 3);
    return { n, places: places.size, topPlaces: top(places), topPeople, first, best, streak, mine };
  }
  const monthLabel = (k) => MONTH.format(new Date(Math.floor(k / 12), k % 12, 1));

  function renderStats(list) {
    const s = stats(list);
    if (!s.n) { $('#hx-stats').innerHTML = ''; return; }
    const pct = Math.round((s.mine / s.n) * 100);
    const tile = (big, label, extra = '', txt = false) => `<div class="hx-stat${txt ? ' hx-stat-txt' : ''}"><strong class="hx-big">${big}</strong><span class="hx-lbl">${label}</span>${extra}</div>`;
    const tiles = [
      tile(s.n, s.n > 1 ? 'rencontres' : 'rencontre'),
      tile(s.places, s.places > 1 ? 'lieux différents' : 'lieu différent'),
      `<div class="hx-stat hx-stat-me"><strong class="hx-big">${s.mine}<span class="hx-of"> / ${s.n}</span></strong>
        <span class="hx-lbl">Tu étais à ${ctx.plural(s.mine, 'rencontre', 'rencontres')} sur ${s.n}</span>
        <span class="hx-bar" aria-hidden="true"><span style="width:${pct}%"></span></span></div>`,
      tile(esc(fmtDate(s.first)), 'première rencontre', '', true),
    ];
    if (s.best && s.n > 1) tiles.push(tile(esc(monthLabel(s.best.k)), `mois le plus actif · ${ctx.plural(s.best.c, 'rencontre', 'rencontres')}`, '', true));
    if (s.streak.len >= 2) tiles.push(tile(`${s.streak.len} mois`, `plus longue série d'affilée (jusqu'en ${esc(monthLabel(s.streak.end))})`));
    const maxP = Math.max(1, ...s.topPlaces.map((p) => p.n));
    const maxU = Math.max(1, ...s.topPeople.map((p) => p.n));
    const rank = (items, maxN, row) => items.length
      ? `<ol class="hx-rank">${items.map((it, i) => `<li><span class="hx-rk">${i + 1}</span>${row(it)}<span class="hx-rn">${it.n}</span>
          <span class="hx-rbar" aria-hidden="true"><span style="width:${Math.round((it.n / maxN) * 100)}%"></span></span></li>`).join('')}</ol>`
      : '<p class="small muted">Rien à classer.</p>';
    $('#hx-stats').innerHTML = `<div class="hx-stats">
      <div class="hx-tiles">${tiles.join('')}</div>
      <div class="hx-tops">
        <div class="hx-top-card"><h3 class="hx-h3">${I.pin} Top des lieux</h3>${rank(s.topPlaces, maxP, (p) => `<span class="hx-rname">${esc(p.label)}</span>`)}</div>
        <div class="hx-top-card"><h3 class="hx-h3">${I.people} Les plus présents</h3>${rank(s.topPeople, maxU, (p) => `${avatarHtml(ctx.member(p.id), 26)}<span class="hx-rname">${esc(p.label)}${p.id === me.id ? ' <span class="muted">(toi)</span>' : ''}</span>`)}</div>
      </div>
    </div>`;
  }

  /* ============ Frise ============ */
  function card(ev) {
    const d = new Date(ev.starts_at);
    const who = presents(ev.id);
    const pics = photosOf(ev.id);
    const thumbUrl = (pics[0] && S.urls.get(pics[0].path)) || (ev.cover_path && S.urls.get(ev.cover_path)) || null;
    const thumb = thumbUrl
      ? `<img src="${esc(thumbUrl)}" alt="" loading="lazy" decoding="async">`
      : `<span class="hx-thumb-date" style="--tint:${ctx.tint(ev.id)}"><strong>${d.getDate()}</strong><span>${esc(MONTH_SHORT.format(d))}</span></span>`;
    const faces = who.slice(0, PEOPLE_MAX).map((id) => `<li title="${esc(ctx.pseudo(id))}">${avatarHtml(ctx.member(id), 30)}</li>`).join('');
    const more = who.length > PEOPLE_MAX ? `<li class="hx-more" aria-hidden="true">+${who.length - PEOPLE_MAX}</li>` : '';
    const names = who.map((id) => ctx.pseudo(id)).join(', ');
    return `<li class="hx-card" id="hx-ev-${esc(ev.id)}">
      <a class="hx-thumb" href="#event-${esc(ev.id)}" tabindex="-1" aria-hidden="true">${thumb}${pics.length ? `<span class="hx-pcount">${pics.length}</span>` : ''}</a>
      <div class="hx-body">
        <div class="hx-line">
          <time datetime="${esc(ev.starts_at)}">${esc(fmtDate(ev.starts_at))}</time>
          ${ev.retro ? '<span class="hx-retro" title="Rencontre ajoutée après coup dans l\'historique">ajoutée après coup</span>' : ''}
        </div>
        <h4 class="hx-title">${esc(ev.title)}</h4>
        ${ev.location ? `<p class="hx-place">${I.pin}<span>${esc(ev.location)}</span></p>` : ''}
        <div class="hx-people">
          ${who.length ? `<ul class="hx-faces" aria-label="Présents : ${esc(names)}">${faces}${more}</ul>` : ''}
          <span class="small muted">${who.length ? ctx.plural(who.length, 'présent', 'présents') : 'Présents non renseignés'}</span>
        </div>
        <div class="hx-actions">
          <a class="hx-link" href="#event-${esc(ev.id)}">${pics.length ? `Voir l'album · ${ctx.plural(pics.length, 'photo', 'photos')}` : "Ouvrir l'album"}<span aria-hidden="true"> →</span></a>
          ${ctx.canEdit(ev) ? `<button type="button" class="btn btn-ghost btn-sm" data-act="who" data-id="${esc(ev.id)}" data-key="hxwho:${esc(ev.id)}">${I.people}<span>Qui était là ?</span></button>` : ''}
        </div>
      </div>
    </li>`;
  }

  function renderTimeline(list, total) {
    $('#hx-count').textContent = list.length === total ? ctx.plural(total, 'rencontre', 'rencontres') : `${list.length} sur ${total}`;
    if (!total) {
      $('#hx-timeline').innerHTML = `<div class="empty hx-empty"><p>Aucune rencontre passée pour l'instant.</p>
        <button type="button" class="btn btn-sand" data-hx="retro">+ Ajouter une rencontre passée</button></div>`;
      return;
    }
    if (!list.length) {
      $('#hx-timeline').innerHTML = '<div class="empty hx-empty"><p>Aucune rencontre ne correspond à ces filtres.</p><button type="button" class="btn btn-ghost" data-hx="reset">Réinitialiser les filtres</button></div>';
      return;
    }
    const byYear = new Map();
    for (const ev of list) { const y = yearOf(ev); (byYear.get(y) || byYear.set(y, []).get(y)).push(ev); }
    $('#hx-timeline').innerHTML = [...byYear.entries()].sort((a, b) => b[0] - a[0]).map(([y, evs]) => `
      <section class="hx-year" aria-labelledby="hx-y-${y}">
        <h3 class="hx-year-title" id="hx-y-${y}">${y}<span class="small muted"> · ${ctx.plural(evs.length, 'rencontre', 'rencontres')}</span></h3>
        <ol class="hx-list">${evs.map(card).join('')}</ol>
      </section>`).join('');
  }
  $('#hx-timeline').addEventListener('click', (e) => {
    const b = e.target.closest('[data-hx]');
    if (b?.dataset.hx === 'retro') openRetro();
    else if (b?.dataset.hx === 'reset') { resetFilters(); render(); qInput.focus(); }
    const a = e.target.closest('a[href^="#event-"]');
    if (a) { e.preventDefault(); setTab('sorties'); location.hash = a.getAttribute('href').slice(1); }
  });

  function focusCard(id, { quiet = false } = {}) {
    const el = document.getElementById(`hx-ev-${id}`);
    if (!el || !isOpen()) return;
    if (!quiet) el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash');
    const btn = el.querySelector('[data-act="who"]');
    if (quiet && btn) btn.focus();
  }

  /* ============ Carte (Leaflet + Nominatim, chargés seulement à l'ouverture) ============ */
  const M = { open: false, map: null, layer: null, loading: null, gen: 0, failed: new Set(), last: 0 };
  const mapBtn = $('#hx-map-btn'), mapWrap = $('#hx-map-wrap'), mapStatus = $('#hx-map-status');
  mapBtn.addEventListener('click', async () => {
    M.open = !M.open;
    mapBtn.setAttribute('aria-expanded', String(M.open));
    mapBtn.textContent = M.open ? 'Masquer la carte' : 'Voir la carte';
    mapWrap.hidden = !M.open;
    if (M.open) updateMap();
  });

  function loadLeaflet() {
    if (window.L?.map) return Promise.resolve(window.L);
    if (M.loading) return M.loading;
    M.loading = new Promise((res, rej) => {
      if (!$('link[data-leaflet]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet'; css.href = `${LEAFLET}/leaflet.css`; css.dataset.leaflet = '';
        document.head.append(css);
      }
      const s = document.createElement('script');
      s.src = `${LEAFLET}/leaflet.js`; s.async = true;
      s.onload = () => (window.L?.map ? res(window.L) : rej(new Error('bibliothèque de carte indisponible')));
      s.onerror = () => rej(new Error('bibliothèque de carte injoignable'));
      document.head.append(s);
    }).catch((e) => { M.loading = null; $$('script[src^="https://cdn.jsdelivr.net/npm/leaflet"]').forEach((x) => x.remove()); throw e; });
    return M.loading;
  }
  function geoCache() { try { return JSON.parse(localStorage.getItem(GEO_KEY) || '{}') || {}; } catch { return {}; } }
  function geoPut(k, v) { try { const c = geoCache(); c[k] = v; localStorage.setItem(GEO_KEY, JSON.stringify(c)); } catch { /* stockage indisponible : cache mémoire seulement */ } M.mem[k] = v; }
  M.mem = {};
  const geoGet = (k) => M.mem[k] ?? geoCache()[k];
  const usable = (g) => g && typeof g.lat === 'number' && typeof g.lon === 'number';
  const stale = (g) => !g || (!usable(g) && Date.now() - (g.miss || 0) > GEO_RETRY_MS);

  async function geocode(key, label) {
    const wait = M.last + GEO_GAP_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    M.last = Date.now();
    try {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&accept-language=fr&q=${encodeURIComponent(label)}`, { headers: { Accept: 'application/json' } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const hit = Array.isArray(j) && j[0];
      const g = hit ? { lat: Number(hit.lat), lon: Number(hit.lon) } : { miss: Date.now() };
      if (hit && (!Number.isFinite(g.lat) || !Number.isFinite(g.lon))) return null;
      geoPut(key, g);
      return g;
    } catch (e) {
      M.failed.add(key);           // erreur réseau : on ne retente pas pendant cette visite
      console.warn('[irl] géocodage impossible', label, e?.message || e);
      return null;
    }
  }

  async function updateMap() {
    if (!M.open) return;
    const gen = ++M.gen;
    let L;
    try {
      mapStatus.textContent = 'Chargement de la carte…';
      L = await loadLeaflet();
    } catch (e) {
      if (gen === M.gen) { mapStatus.textContent = `Carte indisponible pour le moment (${e.message}).`; $('#hx-map').classList.add('hx-map-off'); }
      return;
    }
    if (gen !== M.gen) return;
    $('#hx-map').classList.remove('hx-map-off');
    if (!M.map) {
      M.map = L.map('hx-map', { scrollWheelZoom: false }).setView([46.8, 8.2], 7);
      L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(M.map);
      M.layer = L.layerGroup().addTo(M.map);
    }
    M.map.invalidateSize();
    // Lieux des rencontres filtrées
    const groups = new Map();
    for (const ev of filtered()) {
      if (!ev.location) continue;
      const k = norm(ev.location);
      const g = groups.get(k) || { label: ev.location.trim(), evs: [] };
      g.evs.push(ev); groups.set(k, g);
    }
    M.layer.clearLayers();
    const pts = [];
    const add = (k, geo) => {
      const g = groups.get(k);
      const n = g.evs.length;
      const icon = L.divIcon({ className: 'hx-pin', html: `<span>${n}</span>`, iconSize: [34, 34], iconAnchor: [17, 17], popupAnchor: [0, -14] });
      const list = g.evs.slice(0, 8).map((ev) => `<li>${esc(fmtDate(ev.starts_at))} · ${esc(ev.title)}</li>`).join('');
      L.marker([geo.lat, geo.lon], { icon, title: `${g.label} : ${n} rencontre${n > 1 ? 's' : ''}`, alt: g.label })
        .bindPopup(`<strong>${esc(g.label)}</strong><br>${n} rencontre${n > 1 ? 's' : ''}<ul class="hx-pop">${list}</ul>${n > 8 ? '<span>…</span>' : ''}`)
        .addTo(M.layer);
      pts.push([geo.lat, geo.lon]);
    };
    const fit = () => { if (pts.length) M.map.fitBounds(pts, { padding: [40, 40], maxZoom: 12 }); };
    const todo = [];
    for (const [k, g] of groups) {
      const c = geoGet(k);
      if (usable(c)) add(k, c);
      else if (stale(c) && !M.failed.has(k)) todo.push([k, g.label]);
    }
    fit();
    const say = () => {
      const missing = groups.size - pts.length;
      mapStatus.textContent = !groups.size ? 'Aucun lieu renseigné pour ces rencontres.'
        : `${ctx.plural(pts.length, 'lieu sur la carte', 'lieux sur la carte')}${missing ? ` (${missing} introuvable${missing > 1 ? 's' : ''})` : ''}.`;
    };
    say();
    for (const [i, [k, label]] of todo.entries()) {
      if (gen !== M.gen || !M.open) return;
      mapStatus.textContent = `Localisation des lieux… ${i + 1} / ${todo.length}`;
      const geo = await geocode(k, label);
      if (gen !== M.gen) return;
      if (usable(geo)) { add(k, geo); fit(); }
    }
    if (gen === M.gen) say();
  }

  /* ============ Rendu ============ */
  let lastList = [];
  function filtered() { return lastList.filter((ev) => match(ev)); }
  function render() {
    lastList = ctx.classify().past;
    if (!isOpen()) return;
    renderFilters(lastList);
    const list = filtered();
    renderStats(list);
    renderTimeline(list, lastList.length);
    if (M.open) updateMap();
  }

  return { render, openRetro, openWho, setTab, isOpen };
}
