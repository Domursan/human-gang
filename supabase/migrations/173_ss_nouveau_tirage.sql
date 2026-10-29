-- ===== Humane Gang — migration 173 : Secret Santa, nouveau tirage en mode sans limite =====
-- Refaire le tirage ne supprimait que les attributions : les envois et réceptions notés, les réservations des MP
-- (gift_notified_at, received_notified_at) et le rappel d'envoi restaient ceux de l'ancien tirage. Le nouveau Santa
-- voyait donc « cadeau envoyé » déjà coché et le bot ne prévenait plus personne.
-- hg_ss_remise_envois remet ces colonnes à zéro pour toute l'édition (admin ou Staff « secret_santa »), avant le
-- nouveau tirage (site/assets/espaces/admin/ss-events.js). Rejouable.

create or replace function public.hg_ss_remise_envois(p_edition uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if not (public.hg_is_admin() or public.hg_has_perm('secret_santa')) then raise exception 'Réservé à l''admin'; end if;
  update hg_ss_participants set sent_at = null, received_at = null, gift_notified_at = null, received_notified_at = null,
    send_reminder_at = null
  where edition_id = p_edition;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.hg_ss_remise_envois(uuid) from public, anon;
grant execute on function public.hg_ss_remise_envois(uuid) to authenticated;
