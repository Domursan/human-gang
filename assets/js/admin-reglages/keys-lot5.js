// Réglages, lot 5 (bot Discord, planning, assistance) : libellés et aides des clés de hg_settings ajoutées par ce lot.
// Le bot (`bot`) est déjà décrit dans keys.js. Les clés ci-dessous s'éditent dans la section Bot Discord (#poste/bot) :
//   - support : sujets proposés et limites de l'assistance (lu aussi sans compte) ;
//   - planning : heure suisse fixe d'envoi des anniversaires (porte hg_cron_gate, migration 054).
// Les rappels, délais et limites du bot vivent dans la clé `bot` (bot.rappels, bot.dyn, bot.envoi) et sont édités dans la même section.
export const KEYS_LOT5 = {
  support: {
    label: 'Assistance',
    help: 'Sujets proposés dans le formulaire, limites anti-abus et longueurs des messages. Lisible sans compte.',
    managed: '#poste/bot',
    managedLabel: 'Bot Discord',
  },
  planning: {
    label: 'Planning des tâches automatiques',
    help: 'Heure suisse fixe d\'envoi des anniversaires (été comme hiver).',
    managed: '#poste/bot',
    managedLabel: 'Bot Discord',
  },
};
