-- ===== Humane Gang : messagerie — publication Realtime de hg_messages =====
-- Prérequis des abonnements postgres_changes de messages.js. Ajoute seulement la table à la publication
-- supabase_realtime (idempotent). Aucune policy modifiée : Realtime ne transmet un événement qu'aux lignes que
-- l'abonné peut lire ; la lecture directe de hg_messages reste réservée à l'admin (sender_id ne doit pas fuir
-- vers la cible d'un Secret Santa). Les membres reçoivent donc les événements seulement si une policy de lecture
-- dédiée est ajoutée, ou via un canal broadcast (à concevoir).

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'hg_messages'
  ) then
    alter publication supabase_realtime add table public.hg_messages;
  end if;
end $$;
