-- 115 : puissances des cartes réglables depuis le panel (Arène et bataille).
-- • Par catégorie : hg_settings.cards.puissances = { commune, peu_commune, rare, epique, legendaire, mythique, identite,
--   unique, brillante } (défauts : 1, 2, 3, 4, 5, 6, 6, 6, et +1 pour une brillante).
-- • Par carte : hg_cards.power (null = valeur de sa catégorie), réglée par hg_card_power_set (Staff « cartes »),
--   prévue pour les mythiques, les uniques, la série « Les OG » et le « Hors série ».
-- La règle « une seule carte mythique, identité ou unique par main » reste fondée sur la rareté (hg_battle_rank).
alter table public.hg_cards add column if not exists power smallint check (power between 0 and 20);

create or replace function public.hg_card_power(p_rarity text, p_power smallint default null)
returns int language sql stable security definer set search_path = public as $$
  select coalesce(p_power::int,
    case when (hg_card_cfg()#>>array['puissances', p_rarity]) ~ '^[0-9]{1,2}$' then (hg_card_cfg()#>>array['puissances', p_rarity])::int end,
    hg_battle_rank(p_rarity))
$$;
create or replace function public.hg_card_shiny_bonus()
returns int language sql stable security definer set search_path = public as $$
  select case when (hg_card_cfg()#>>'{puissances,brillante}') ~ '^[0-9]{1,2}$' then (hg_card_cfg()#>>'{puissances,brillante}')::int else 1 end
$$;

create or replace function public.hg_card_power_set(p_card uuid, p_power smallint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare k hg_cards;
begin
  if not hg_has_perm('cartes') then raise exception 'Réservé au Staff « cartes »'; end if;
  if p_power is not null and (p_power < 0 or p_power > 20) then raise exception 'Puissance : de 0 à 20'; end if;
  update hg_cards set power = p_power where id = p_card returning * into k;
  if not found then raise exception 'Carte introuvable'; end if;
  insert into hg_admin_log (admin_id, action, target_ref, details)
    values (auth.uid(), 'carte_puissance', k.id::text, jsonb_build_object('carte', k.name, 'puissance', p_power));
  return jsonb_build_object('id', k.id, 'power', k.power, 'effective', hg_card_power(k.rarity, k.power));
end $$;
revoke all on function public.hg_card_power_set(uuid, smallint) from public, anon;
grant execute on function public.hg_card_power_set(uuid, smallint) to authenticated;
grant execute on function public.hg_card_power(text, smallint) to authenticated;
grant execute on function public.hg_card_shiny_bonus() to authenticated;

-- Les mains, le deck et l'Arène utilisent la puissance réglée (catégorie ou carte) et le bonus de brillance réglé.
do $d$
declare f text; src text;
begin
  foreach f in array array['public.hg_battle_hand(uuid, bigint[])', 'public.hg_battle_me()', 'public.hg_arena_me()'] loop
    src := pg_get_functiondef(f::regprocedure);
    src := replace(src, 'hg_battle_rank(k.rarity) + case when x.shiny then 1 else 0 end',
                        'hg_card_power(k.rarity, k.power) + case when x.shiny then hg_card_shiny_bonus() else 0 end');
    if position('hg_card_power(k.rarity, k.power)' in src) = 0 then raise exception 'Puissance introuvable dans %', f; end if;
    execute src;
  end loop;
end $d$;
