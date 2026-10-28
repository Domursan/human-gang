-- Outils du banc « économie des cartes » (superutilisateur) : identités, assertions, appels en tant qu'un membre.
-- Les assertions ne stoppent pas le banc : chaque résultat est noté dans t_bilan, et t_bilan_fin() fait le total.

create table if not exists t_bilan (id bigserial primary key, ok boolean not null, msg text not null);

create or replace function t_ok(c boolean, msg text) returns void language plpgsql as $$
begin
  insert into t_bilan(ok, msg) values (c is true, msg);
  if c is true then raise notice 'ok : %', msg; else raise notice 'ÉCHEC : %', msg; end if;
end $$;

-- Bilan d'un fichier de test : nombre d'assertions réussies et échouées (depuis le dernier bilan).
create or replace function t_bilan_fin() returns void language plpgsql as $$
declare n_ok int; n_ko int;
begin
  select count(*) filter (where ok), count(*) filter (where not ok) into n_ok, n_ko from t_bilan;
  raise notice 'BILAN : % ok, % ÉCHEC', n_ok, n_ko;
  delete from t_bilan;
end $$;

-- Identifiant de test n (membres 2 à 5 ; 1 n'est pas utilisé : aucun administrateur dans ce banc).
create or replace function t_uid(n int) returns uuid language sql immutable as $$
  select ('00000000-0000-0000-0000-0000000000' || lpad(n::text, 2, '0'))::uuid $$;

-- Passe au rôle « authenticated » sous l'identité u (comme le ferait le site).
create or replace function t_asu(u uuid) returns void language plpgsql as $$
begin perform set_config('request.jwt.claims', json_build_object('sub', u, 'role', 'authenticated')::text, false); end $$;

-- Appelle une fonction ou une requête (p_sql, sans « select ») en tant que u. Renvoie le résultat en jsonb.
create or replace function t_call(u uuid, p_sql text) returns jsonb language plpgsql as $$
declare r jsonb;
begin
  perform t_asu(u); execute 'set local role authenticated';
  execute 'select to_jsonb((' || p_sql || '))' into r;
  execute 'reset role'; return r;
exception when others then execute 'reset role'; raise;
end $$;

-- Appelle sans résultat (fonctions void). Erreur propagée.
create or replace function t_do(u uuid, p_sql text) returns void language plpgsql as $$
begin
  perform t_asu(u); execute 'set local role authenticated';
  execute 'select ' || p_sql;
  execute 'reset role';
exception when others then execute 'reset role'; raise;
end $$;

-- Message d'erreur de l'appel (null si l'appel a réussi). La transaction de l'appel est annulée en cas d'erreur.
create or replace function t_err(u uuid, p_sql text) returns text language plpgsql as $$
begin perform t_do(u, p_sql); return null; exception when others then return sqlerrm; end $$;

-- Requête de lecture en tant que u (p_sql : « select … »). Renvoie le premier nombre lu.
create or replace function t_count(u uuid, p_sql text) returns bigint language plpgsql as $$
declare n bigint;
begin
  perform t_asu(u); execute 'set local role authenticated';
  execute p_sql into n;
  execute 'reset role'; return coalesce(n, 0);
exception when others then execute 'reset role'; raise;
end $$;

-- Écriture directe en tant que u (p_sql : insert, update ou delete). Renvoie « n lignes » ou « ERR : message ».
create or replace function t_exec(u uuid, p_sql text) returns text language plpgsql as $$
declare n bigint;
begin
  perform t_asu(u); execute 'set local role authenticated';
  execute p_sql; get diagnostics n = row_count;
  execute 'reset role'; return n::text || ' ligne(s)';
exception when others then execute 'reset role'; return 'ERR : ' || sqlerrm; end $$;

-- Paillettes d'un membre (lecture superutilisateur).
create or replace function t_pl(u uuid) returns int language sql stable as $$
  select coalesce((select paillettes from hg_wallets where user_id = u), 0) $$;

-- Exemplaire vivant (non recyclé) numéro n de u, disponible à l'échange (ordre par id). Null s'il n'y en a pas.
create or replace function t_copie(u uuid, n int) returns bigint language sql stable as $$
  select x.id from (
    select c.id, row_number() over (order by c.id) rn from hg_card_copies c join hg_cards k on k.id = c.card_id
     where c.owner_id = u and c.recycled_at is null and c.locked_trade is null and k.tradeable) x
   where x.rn = n $$;

-- Exemplaires vivants (non recyclés) de tout le banc, et exemplaires sans propriétaire ou bloqués sur une offre close.
create or replace function t_vivants() returns bigint language sql stable as $$
  select count(*) from hg_card_copies where recycled_at is null $$;
create or replace function t_orphelins() returns bigint language sql stable as $$
  select count(*) from hg_card_copies c where c.recycled_at is null and (c.owner_id is null
     or exists (select 1 from hg_card_trades t where t.id = c.locked_trade and t.status <> 'proposee')) $$;

-- Tableau SQL d'un tableau bigint pour les appels : t_arr(array[1,2]) -> '{1,2}'::bigint[]
create or replace function t_arr(a bigint[]) returns text language sql immutable as $$
  select format('%L::bigint[]', a) $$;
