-- Appliqué en production le 22/10/2026.
-- 053_corrige : a appliquer APRES 053_reglages_badges_cartes.sql.
-- 1. Plafond de quantite de drop : la table hg_card_drops impose CHECK (quantity between 1 and 50).
--    Un reglage cards.drops.quantite_max > 50 donnait une erreur brute de contrainte ; on plafonne a 50
--    et le message reste propre. Comportement par defaut inchange.
-- 2. Quetes : un reglage negatif ferait echouer « LIMIT » ; on borne a 0.

create or replace function public.hg_drop_create(p_card uuid, p_shiny boolean default false, p_quantity integer default 1, p_minutes integer default 30, p_announce boolean default true)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k hg_cards; did uuid; ann boolean := coalesce(p_announce, true); sh boolean := coalesce(p_shiny, false);
  v_qmax int := least(coalesce((hg_card_cfg()#>>'{drops,quantite_max}')::int, 50), 50);  -- plafond physique de la table : 50
  v_dmax int := coalesce((hg_card_cfg()#>>'{drops,duree_max_min}')::int, 1440);
begin
  if not public.hg_has_perm('cartes') then raise exception 'Réservé à l''admin'; end if;
  select * into k from hg_cards where id = p_card;
  if not found or not k.active then raise exception 'Carte introuvable ou inactive'; end if;
  if coalesce(p_quantity, 0) < 1 or p_quantity > v_qmax then raise exception 'La quantité doit être entre 1 et %.', v_qmax; end if;
  if coalesce(p_minutes, 0) < 1 or p_minutes > v_dmax then raise exception 'La durée doit être entre 1 et % minutes.', v_dmax; end if;
  if sh and not k.can_shiny then raise exception 'Cette carte ne peut pas être brillante.'; end if;
  insert into hg_card_drops(card_id, shiny, quantity, starts_at, ends_at, created_by, announce)
    values (p_card, sh, p_quantity, now(), now() + make_interval(mins => p_minutes), auth.uid(), ann)
    returning id into did;
  if ann then
    insert into hg_activity(user_id, kind, text) values (null, 'cartes', 'Une carte sauvage est apparue !');
  end if;
  perform public.hg_admin_audit('drop_lance', null, did::text,
    jsonb_build_object('carte', k.name, 'brillante', sh, 'exemplaires', p_quantity, 'minutes', p_minutes, 'annonce', ann));
  return did;
end $function$;

create or replace function public.hg_card_quests_pick(p_week date)
 returns setof hg_card_quests_templates
 language sql
 stable
 set search_path to 'public'
as $function$
  select t.* from hg_card_quests_templates t
  where t.active
  order by md5(p_week::text || t.code), t.code
  limit greatest(0, coalesce((hg_card_cfg()->>'quetes_par_semaine')::int, 3))
$function$;
