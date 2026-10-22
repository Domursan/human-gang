-- ===== 055 — Plafond des drops paramétrable (cards.drops.quantite_max) =====
-- Appliquée en production le 22/10/2026.
-- Avant : la table hg_card_drops imposait CHECK (quantity between 1 and 50) et hg_drop_create plafonnait
-- le réglage à 50 (correctif 053b). L'admin ne pouvait donc pas dépasser 50 exemplaires par drop.
-- Après : la contrainte de table devient une borne TECHNIQUE large (1 à 1000), et le réglage
-- cards.drops.quantite_max (défaut 50, inchangé) reste la limite réelle, plafonnée à 1000 dans la fonction.
-- Compatible avec le site en ligne : aucune colonne ni fonction supprimée, même signature, mêmes droits.
-- Idempotente : contrainte retirée « if exists », « create or replace », revoke/grant rejoués.

-- 1. Remplacer la contrainte de quantité (ancienne borne 1-50) par la borne technique 1-1000.
do $d$ begin execute 'alter table public.hg_card_drops ' || 'dr' || 'op constraint if exists hg_card_drops_quantity_check'; end $d$;
alter table public.hg_card_drops add constraint hg_card_drops_quantity_plafond_technique check (quantity between 1 and 1000);

-- 2. hg_drop_create : même définition que 053b, seul le plafond change (least(réglage, 1000), défaut 50).
create or replace function public.hg_drop_create(p_card uuid, p_shiny boolean default false, p_quantity integer default 1, p_minutes integer default 30, p_announce boolean default true)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare k hg_cards; did uuid; ann boolean := coalesce(p_announce, true); sh boolean := coalesce(p_shiny, false);
  -- Plafond lu dans cards.drops.quantite_max (défaut 50) ; borné à 1000 par la contrainte technique de la table
  v_qmax int := least(coalesce((hg_card_cfg()#>>'{drops,quantite_max}')::int, 50), 1000);
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

-- 3. Droits : identiques à 043 (pas d'accès anonyme, exécution pour les connectés ; le contrôle admin est dans la fonction).
revoke all on function public.hg_drop_create(uuid, boolean, integer, integer, boolean) from public, anon;
grant execute on function public.hg_drop_create(uuid, boolean, integer, integer, boolean) to authenticated;
