-- ===== Humane Gang — migration 147 : import automatique des images des jeux du jour (toutes les heures) =====
-- Appelle la fonction edge hg-nj-images (action 'images') : elle illustre les éléments des réserves qui n'ont pas encore
-- d'image (3 essais au plus par élément). Sans travail, l'appel ne fait rien. Même secret que hg-cron (hg_private.cron_secret).
select cron.schedule('hg-nj-images', '7 * * * *', $c$select net.http_post(url := 'https://zqbdzokyhgavgmqgiwuw.supabase.co/functions/v1/hg-nj-images',
  headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', (select value from public.hg_private where key = 'cron_secret')),
  body := '{"action":"images","limite":20}'::jsonb, timeout_milliseconds := 150000)$c$);
