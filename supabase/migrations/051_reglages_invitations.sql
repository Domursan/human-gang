-- 051 : réglages « Comptes et invitations » (lot 2 des réglages admin).
-- Rétrocompatible : sans la clé hg_settings.invites, le comportement est strictement identique
-- (48 h, 30 codes par heure et par lien, « HG- », 60 jours pour un compte fantôme).
-- Les définitions reprennent EXACTEMENT les fonctions lues en base le 22/10/2026 (pg_proc.prosrc),
-- seules les constantes sont remplacées par une lecture de hg_settings.invites avec repli.
--
-- Clé hg_settings.invites (tout est facultatif) :
--   { "validite_heures": 48, "max_codes_heure_lien": 30, "fantome_jours": 60, "prefixe": "HG-" }
--
-- Lecture côté site (visiteurs et membres) : la politique ci-dessous laisse lire les clés
-- « invites » et « site_textes » (textes de l'accueil, déjà publics sur le site), et « profile_fields »
-- aux seuls comptes connectés. Les fonctions SECURITY DEFINER lisent hg_settings sans RLS.

-- ---------- Politiques de lecture (ajouts seulement) ----------
drop policy if exists hg_settings_read_invites_textes on hg_settings;
create policy hg_settings_read_invites_textes on hg_settings
  for select to anon, authenticated
  using (key in ('invites', 'site_textes'));

drop policy if exists hg_settings_read_profile_fields on hg_settings;
create policy hg_settings_read_profile_fields on hg_settings
  for select to authenticated
  using (key = 'profile_fields');

-- ---------- hg_claim_invite_link (lien d'invitation public) ----------
create or replace function public.hg_claim_invite_link(p_token text)
 returns text
 language plpgsql
 security definer
 set search_path to 'public', 'extensions'
as $function$
declare l hg_invite_links; v_code text; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int; v_recent int;
  v_cfg jsonb := (select value from hg_settings where key = 'invites');
  v_hours int := coalesce(case when (v_cfg->>'validite_heures') ~ '^[0-9]{1,4}$' then (v_cfg->>'validite_heures')::int end, 48);
  v_max int := coalesce(case when (v_cfg->>'max_codes_heure_lien') ~ '^[0-9]{1,4}$' then (v_cfg->>'max_codes_heure_lien')::int end, 30);
  v_prefix text := coalesce(case when (v_cfg->>'prefixe') ~ '^[A-Z0-9]{1,8}-$' then (v_cfg->>'prefixe') end, 'HG-');
begin
  select * into l from hg_invite_links where token = p_token for update;
  if l.id is null or not l.active or (l.expires_at is not null and l.expires_at < now())
     or (l.max_codes is not null and l.codes_generated >= l.max_codes) then
    raise exception 'Lien d''invitation invalide ou expiré';
  end if;
  -- garde-fou anti-abus : codes non utilisés max par heure et par lien (30 par défaut)
  select count(*) into v_recent from hg_invites where link_id = l.id and used_by is null and created_at > now() - interval '1 hour';
  if v_recent >= v_max then raise exception 'Trop de demandes, réessaie plus tard'; end if;
  loop
    v_code := v_prefix;
    for i in 1..6 loop v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1); end loop;
    exit when not exists(select 1 from hg_invites where code = v_code);
  end loop;
  insert into hg_invites(code, created_by, link_id, expires_at) values (v_code, l.created_by, l.id, now() + make_interval(hours => v_hours));
  update hg_invite_links set codes_generated = codes_generated + 1 where id = l.id;
  return v_code;
end $function$;

-- ---------- hg_ghost_invite (code pour un compte fantôme, admin) ----------
create or replace function public.hg_ghost_invite(p_ghost uuid)
 returns text
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_code text; v_alpha text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; i int;
  v_cfg jsonb := (select value from hg_settings where key = 'invites');
  v_days int := coalesce(case when (v_cfg->>'fantome_jours') ~ '^[0-9]{1,4}$' then (v_cfg->>'fantome_jours')::int end, 60);
  v_prefix text := coalesce(case when (v_cfg->>'prefixe') ~ '^[A-Z0-9]{1,8}-$' then (v_cfg->>'prefixe') end, 'HG-');
begin
  if not public.hg_has_perm('membres') then raise exception 'Réservé à l''admin'; end if;
  if not exists(select 1 from hg_profiles where id = p_ghost and is_ghost) then raise exception 'Compte fantôme introuvable'; end if;
  update hg_invites set expires_at = now() where ghost_id = p_ghost and used_by is null and (expires_at is null or expires_at > now());
  loop
    v_code := v_prefix;
    for i in 1..6 loop v_code := v_code || substr(v_alpha, 1 + floor(random() * length(v_alpha))::int, 1); end loop;
    exit when not exists(select 1 from hg_invites where code = v_code);
  end loop;
  insert into hg_invites(code, created_by, ghost_id, expires_at) values (v_code, auth.uid(), p_ghost, now() + make_interval(days => v_days));
  return v_code;
end $function$;
