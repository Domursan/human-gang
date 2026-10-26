-- Heardle : quand la vidéo du jour ne se lit pas dans le site (YouTube refuse la lecture intégrée : codes 100, 101,
-- 150, 153), le navigateur du joueur le signale. Le serveur retire le morceau (statut « retire », il ne sera plus
-- proposé) puis remplace le morceau du jour par un autre morceau validé jamais programmé, tant que personne n'a encore
-- joué aujourd'hui ; sinon la manche est annulée (personne n'est pénalisé). Trois remplacements par jour au plus.
alter table public.hg_heardle_rounds add column if not exists remplacements int not null default 0;

create or replace function public.hg_heardle_signaler(p_code int)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare d date := hg_jeux_today(); r hg_heardle_rounds; v_new uuid;
begin
  if not hg_is_member() then raise exception 'Réservé aux membres'; end if;
  if p_code is null or p_code not in (100, 101, 150, 153) then return jsonb_build_object('ok', false, 'raison', 'code'); end if;
  select * into r from hg_heardle_rounds where day = d and not cancelled for update;
  if not found then return jsonb_build_object('ok', false, 'raison', 'pas de manche'); end if;
  if r.remplacements >= 3 then return jsonb_build_object('ok', false, 'raison', 'limite'); end if;
  update hg_heardle_tracks set status = 'retire', updated_at = now() where id = r.track_id;
  if exists (select 1 from hg_daily_games where game = 'heardle' and day = d) then
    update hg_heardle_rounds set cancelled = true, remplacements = remplacements + 1 where day = d;
    return jsonb_build_object('ok', true, 'action', 'annulee');
  end if;
  select t.id into v_new from hg_heardle_tracks t
    where t.status = 'valide' and not exists (select 1 from hg_heardle_rounds x where x.track_id = t.id)
    order by random() limit 1;
  if v_new is null then
    update hg_heardle_rounds set cancelled = true, remplacements = remplacements + 1 where day = d;
    return jsonb_build_object('ok', true, 'action', 'annulee');
  end if;
  update hg_heardle_rounds set track_id = v_new, remplacements = remplacements + 1 where day = d;
  return jsonb_build_object('ok', true, 'action', 'remplacee');
end $$;
revoke all on function public.hg_heardle_signaler(int) from public, anon;
grant execute on function public.hg_heardle_signaler(int) to authenticated;
