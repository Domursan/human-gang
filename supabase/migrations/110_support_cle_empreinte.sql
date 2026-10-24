-- 110 : clé dédiée à l'empreinte des adresses des visiteurs (assistance), rangée dans le coffre chiffré (Vault).
-- Générée ici au hasard : elle ne transite par personne. Lisible seulement par la fonction serveur (service_role).
do $d$ begin
  if not exists (select 1 from vault.secrets where name = 'hg_support_hash') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(48), 'base64'), 'hg_support_hash', 'Clé HMAC des empreintes d''adresse (hg-support)');
  end if;
end $d$;
create or replace function public.hg_support_hash_key()
returns text language sql stable security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'hg_support_hash' limit 1
$$;
revoke all on function public.hg_support_hash_key() from public, anon, authenticated;
grant execute on function public.hg_support_hash_key() to service_role;
