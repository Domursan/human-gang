// ===== Humane Gang — Loup-Garou : thème visuel de chaque rôle (écran de partie) =====
/*
 * Rôle : couleurs, devise et dessins propres à chaque rôle, affichés sur le plateau pendant la partie (version « Horizon »).
 * Dessins : assets/img/loup-garou/themes/<id>-embleme.svg (emblème), -motif.svg (motif répété), -scene.svg (paysage du bas de page).
 * a = couleur d'accent, rgb = la même en « r,g,b », bg / bg2 = fonds sombres teintés, sous = sous-titre de nuit, devise = phrase du rôle.
 * Exporte : THEMES, themeDe(id), imagesTheme(id).
 */
export const THEMES = {
  "villageois": {
    "a": "#E8CC84",
    "rgb": "232,204,132",
    "bg": "#15120B",
    "bg2": "#231E12",
    "sous": "Le village dort",
    "devise": "Ta voix est ton arme."
  },
  "chasseur": {
    "a": "#E0A15A",
    "rgb": "224,161,90",
    "bg": "#16100A",
    "bg2": "#241A0F",
    "sous": "Tu dors, le fusil à portée de main",
    "devise": "Si tu tombes, tu ne tomberas pas seul."
  },
  "cupidon": {
    "a": "#EE8DB4",
    "rgb": "238,141,180",
    "bg": "#1A0C14",
    "bg2": "#2A1422",
    "sous": "Tes flèches attendent leur cible",
    "devise": "Deux cœurs, un seul destin."
  },
  "petite-fille": {
    "a": "#7FD3F0",
    "rgb": "127,211,240",
    "bg": "#071419",
    "bg2": "#0E202A",
    "sous": "Tu suis la meute à distance",
    "devise": "Petite, mais je vois tout."
  },
  "sorciere": {
    "a": "#7DCB82",
    "rgb": "125,203,130",
    "bg": "#0A160E",
    "bg2": "#122318",
    "sous": "Tes potions frémissent",
    "devise": "Une vie, une mort. À toi de choisir."
  },
  "voleur": {
    "a": "#C2C9D8",
    "rgb": "194,201,216",
    "bg": "#0D1014",
    "bg2": "#171B23",
    "sous": "Une carte peut en cacher une autre",
    "devise": "Ce qui est au centre peut devenir à toi."
  },
  "voyante": {
    "a": "#B79BEA",
    "rgb": "183,155,234",
    "bg": "#110C1E",
    "bg2": "#1D1630",
    "sous": "Ton regard perce la nuit",
    "devise": "Rien n'échappe à ton œil."
  },
  "loup-garou": {
    "a": "#D9544F",
    "rgb": "217,84,79",
    "bg": "#1A0A0C",
    "bg2": "#2A1012",
    "sous": "La meute chasse cette nuit",
    "devise": "Le village dort. Pas toi."
  },
  "capitaine": {
    "a": "#5B8DEF",
    "rgb": "91,141,239",
    "bg": "#060C1B",
    "bg2": "#0D1830",
    "sous": "Le village te suit à la barre",
    "devise": "Le cap est tenu. Suivez-moi."
  },
  "ancien": {
    "a": "#A6B85A",
    "rgb": "166,184,90",
    "bg": "#0E1205",
    "bg2": "#18200B",
    "sous": "Tu as déjà encaissé une morsure",
    "devise": "Les loups ont mordu. Tu tiens debout."
  },
  "bouc-emissaire": {
    "a": "#D9825B",
    "rgb": "217,130,91",
    "bg": "#170C08",
    "bg2": "#24140D",
    "sous": "Le village cherche un coupable",
    "devise": "À égalité, c'est toujours moi qu'on regarde."
  },
  "idiot-du-village": {
    "a": "#E9E25A",
    "rgb": "233,226,90",
    "bg": "#121109",
    "bg2": "#1F1E10",
    "sous": "On te prend pour un fou. Tant mieux.",
    "devise": "Je ne suis pas fou, je suis imprévisible."
  },
  "joueur-de-flute": {
    "a": "#4FD1C5",
    "rgb": "79,209,197",
    "bg": "#061615",
    "bg2": "#0B2423",
    "sous": "Ta musique attire tout le village",
    "devise": "Suis la mélodie. Tous finiront par te suivre."
  },
  "salvateur": {
    "a": "#7FB3FF",
    "rgb": "127,179,255",
    "bg": "#080E1B",
    "bg2": "#0F1B30",
    "sous": "Une lumière veille sur le village",
    "devise": "Personne ne tombe ce soir."
  },
  "corbeau": {
    "a": "#C4CBD6",
    "rgb": "196,203,214",
    "bg": "#0C0E12",
    "bg2": "#161A21",
    "sous": "Les corbeaux votent avant le village",
    "devise": "Un murmure suffit à faire tomber un nom."
  },
  "pyromane": {
    "a": "#FF8A3D",
    "rgb": "255,138,61",
    "bg": "#1C0C05",
    "bg2": "#2B1409",
    "sous": "Le village brûle cette nuit",
    "devise": "Une étincelle suffit. Le reste, c’est moi."
  },
  "loup-blanc": {
    "a": "#E9ECF5",
    "rgb": "233,236,245",
    "bg": "#0D0E14",
    "bg2": "#171A24",
    "sous": "Seul contre la meute",
    "devise": "Un loup parmi les loups, et seul au bout de la nuit."
  },
  "abominable-sectaire": {
    "a": "#C5E04A",
    "rgb": "197,224,74",
    "bg": "#0E1205",
    "bg2": "#18200A",
    "sous": "Ton culte veille au-dessus du village",
    "devise": "Qui te sonde se perd en chemin."
  },
  "ange": {
    "a": "#BDF3EE",
    "rgb": "189,243,238",
    "bg": "#071414",
    "bg2": "#0E2322",
    "sous": "Tu veilles sur le village depuis le ciel",
    "devise": "Le ciel t’a choisi. Les hommes en décideront."
  },
  "chevalier-epee-rouillee": {
    "a": "#B4BEC8",
    "rgb": "180,190,200",
    "bg": "#0B0F13",
    "bg2": "#151B22",
    "sous": "Ta lame attend encore son heure",
    "devise": "Rouillée, mais jamais émoussée."
  },
  "chien-loup": {
    "a": "#C9D66B",
    "rgb": "201,214,107",
    "bg": "#11130A",
    "bg2": "#1B1F0F",
    "sous": "Un pied dans chaque camp",
    "devise": "Ni tout à fait chien, ni tout à fait loup."
  },
  "comedien": {
    "a": "#8FA0F5",
    "rgb": "143,160,245",
    "bg": "#0C0E1C",
    "bg2": "#161A30",
    "sous": "Ce soir, tu joues un autre rôle",
    "devise": "Le village est ta scène. Choisis ton rôle."
  },
  "deux-soeurs": {
    "a": "#D88BE6",
    "rgb": "216,139,230",
    "bg": "#140A17",
    "bg2": "#211328",
    "sous": "Deux visages, un même secret",
    "devise": "Jamais seules, toujours ensemble."
  },
  "enfant-sauvage": {
    "a": "#C9A07A",
    "rgb": "201,160,122",
    "bg": "#15100C",
    "bg2": "#22190F",
    "sous": "Tu cherches encore ton modèle",
    "devise": "Ce qu’on t’a appris, la forêt peut te le reprendre."
  },
  "grand-mechant-loup": {
    "a": "#8FB8E8",
    "rgb": "143,184,232",
    "bg": "#08101A",
    "bg2": "#0F1A2A",
    "sous": "Le plus grand de la meute chasse",
    "devise": "Un seul festin ne te suffit pas."
  },
  "gitane": {
    "a": "#5FD0C4",
    "rgb": "95,208,196",
    "bg": "#061614",
    "bg2": "#0C2421",
    "sous": "Les esprits répondent à ton appel",
    "devise": "Les morts ont toujours quelque chose à dire."
  },
  "infect-pere-des-loups": {
    "a": "#C4D15A",
    "rgb": "196,209,90",
    "bg": "#111307",
    "bg2": "#1B1E0C",
    "sous": "Sa morsure ne tue pas, elle transforme",
    "devise": "Mourir, c’est trop simple."
  },
  "juge-begue": {
    "a": "#B8C0D0",
    "rgb": "184,192,208",
    "bg": "#0D0F14",
    "bg2": "#171A23",
    "sous": "Le tribunal dort, pas toi",
    "devise": "La justice bégaie, mais elle frappe."
  },
  "montreur-ours": {
    "a": "#C9825B",
    "rgb": "201,130,91",
    "bg": "#170D08",
    "bg2": "#24150D",
    "sous": "Ton ours veille, muselé mais attentif",
    "devise": "Il sent le loup avant tout le monde."
  },
  "renard": {
    "a": "#5FD0C4",
    "rgb": "95,208,196",
    "bg": "#08161A",
    "bg2": "#0F2328",
    "sous": "La colline dort, le renard veille",
    "devise": "Trois ombres se suivent. Une seule est loup."
  },
  "servante-devouee": {
    "a": "#7FA7E6",
    "rgb": "127,167,230",
    "bg": "#0A0E18",
    "bg2": "#131B2B",
    "sous": "Tu n’agis pas la nuit, tu veilles",
    "devise": "Je prends sa place, s’il le faut."
  },
  "trois-freres": {
    "a": "#C2D66B",
    "rgb": "194,214,107",
    "bg": "#0E120A",
    "bg2": "#171E10",
    "sous": "Trois frères, un seul serment",
    "devise": "Le sang parle plus fort que la peur."
  },
  "villageois-villageois": {
    "a": "#C9C2B4",
    "rgb": "201,194,180",
    "bg": "#121110",
    "bg2": "#1D1B19",
    "sous": "Un nom sans rival, une place sans échange",
    "devise": "Personne ne prendra ta place."
  },
  "necromancien": {
    "a": "#DD72D6",
    "rgb": "221,114,214",
    "bg": "#140A18",
    "bg2": "#211029",
    "sous": "Les morts ont encore à dire",
    "devise": "Écoute ceux qui ne parlent plus."
  },
  "marionnettiste": {
    "a": "#5FC7C2",
    "rgb": "95,199,194",
    "bg": "#07161A",
    "bg2": "#0E2428",
    "sous": "Tes fils attendent la fin du jour",
    "devise": "Tu tires les fils. Le village danse."
  },
  "lapin-blanc": {
    "a": "#E9F1FF",
    "rgb": "233,241,255",
    "bg": "#0A1020",
    "bg2": "#131C33",
    "sous": "Le terrier ne s'ouvre qu'une fois",
    "devise": "Tu es en retard. Mais la pioche attend."
  },
  "ankou": {
    "a": "#B5ADA0",
    "rgb": "181,173,160",
    "bg": "#120F0D",
    "bg2": "#1E1A16",
    "sous": "Le glas sonne pour quelqu'un",
    "devise": "La mort n’oublie personne."
  },
  "noctambule": {
    "a": "#7F8CFF",
    "rgb": "127,140,255",
    "bg": "#0A0B1A",
    "bg2": "#13152B",
    "sous": "Les cartes mortes murmurent",
    "devise": "Rien ne reste caché pour qui veille."
  },
  "loup-garou-voyant": {
    "a": "#D9588C",
    "rgb": "217,88,140",
    "bg": "#180812",
    "bg2": "#27101E",
    "sous": "La meute a un œil de plus",
    "devise": "Le loup qui voit ne chasse pas à l'aveugle."
  }
};

/** Thème d'un rôle (ou null si inconnu). */
export function themeDe(id) { return THEMES[id] || null; }

/** Chemins des trois dessins du thème d'un rôle. */
export function imagesTheme(id) {
  const base = `assets/img/loup-garou/themes/${id}`;
  return { embleme: `${base}-embleme.svg`, motif: `${base}-motif.svg`, scene: `${base}-scene.svg` };
}
