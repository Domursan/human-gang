-- Outils de test (superutilisateur) : identités, assertions, accès aux rôles secrets, minuteur.
create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$
begin if c is not true then raise exception 'ÉCHEC : %', msg; end if; raise notice 'ok : %', msg; end $$;
create or replace function t_uid(n int) returns uuid language sql immutable as $$ select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;
create or replace function t_as(n int) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', t_uid(n), 'role', 'authenticated')::text, false); end $$;
create or replace function t_pid(p_code text) returns uuid language sql as $$ select id from hg_lg_parties where code = p_code order by created_at desc limit 1 $$;
create or replace function t_role(p_code text, p_role text, p_rang int default 1) returns uuid language sql as $$
  select user_id from hg_lg_cartes where partie = t_pid(p_code) and role = p_role order by user_id offset p_rang - 1 limit 1 $$;
create or replace function t_n(p_code text, p_user uuid) returns int language sql as $$ select (right(p_user::text, 2))::int $$;
create or replace function t_phase(p_code text) returns text language sql as $$ select statut || '/' || coalesce(phase, '-') || '/' || manche from hg_lg_parties where id = t_pid(p_code) $$;
create or replace function t_expirer(p_code text) returns void language sql as $$ update hg_lg_parties set phase_fin = now() - interval '1 second' where id = t_pid(p_code) $$;
create or replace function t_vivant(p_code text, p_user uuid) returns boolean language sql as $$ select vivant from hg_lg_joueurs where partie = t_pid(p_code) and user_id = p_user $$;
create or replace function t_vivants(p_code text) returns int language sql as $$ select count(*)::int from hg_lg_joueurs where partie = t_pid(p_code) and vivant $$;

-- Joue un appel en tant que joueur n (fonction publique), en rôle authenticated.
create or replace function t_call(n int, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform t_as(n);
  execute 'set local role authenticated';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  execute 'reset role';
  return r;
exception when others then
  execute 'reset role';
  raise;
end $$;
-- Même chose mais renvoie le message d'erreur (ou null si pas d'erreur).
create or replace function t_err(n int, p_sql text) returns text language plpgsql as $$
begin
  perform t_call(n, p_sql);
  return null;
exception when others then
  return sqlerrm;
end $$;

-- Données : 12 membres (1 = admin), 1 inconnu (13) sans droit, testeurs 2..12.
insert into hg_profiles(id, pseudo, color, is_admin) select t_uid(i), 'Joueur' || i, '#ABCDEF', i = 1 from generate_series(1, 13) i on conflict do nothing;
update hg_settings set value = jsonb_set(value, '{testeurs}', (select jsonb_agg(t_uid(i)::text) from generate_series(2, 12) i)) where key = 'loup_garou';
