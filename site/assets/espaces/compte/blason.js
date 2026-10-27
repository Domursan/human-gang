// ===== Générateur de blason pixel (idée C6, migration 080) =====
// Un blason = trois couleurs (champ, bordure et partition, figure), une partition et une figure parmi une douzaine.
// La liste des figures et des partitions est la même que la liste blanche de la base (hg_blason_ok, migration 080).
// Le dessin est fait pour le gang : aucune armoirie ni élément graphique de jeu.
// Exporte : FIGURES, PARTITIONS, PALETTE, DEFAULT_BLASON, blasonSvg, blasonDataUrl, blasonPng.

/** Couleurs proposées (nom lisible, valeur #rrggbb). */
export const PALETTE = [
  ['Gueules (rouge)', '#9E3543'], ['Or', '#E2C77E'], ['Argent', '#F2EFEA'], ['Azur', '#2B5AE2'],
  ['Sinople (vert)', '#159946'], ['Sable (noir)', '#15131C'], ['Pourpre', '#4E2398'], ['Orangé', '#FCA301'],
];

/** Partitions de l'écu : plein, parti (vertical), coupé (horizontal), bande (diagonale). */
export const PARTITIONS = [['plein', 'Plein'], ['parti', 'Parti (deux moitiés verticales)'], ['coupe', 'Coupé (haut et bas)'], ['bande', 'En bande (diagonale)']];

// Figures en pixels (grille 12 × 12, « # » = plein).
const F = {
  lion: ['....##......', '...####.....', '...#.###....', '..######....', '...#####....', '....######..', '...########.', '..#########.', '..##.###.##.', '..#..##...#.', '.##..##..##.', '............'],
  tour: ['.#.#.##.#.#.', '.##########.', '..########..', '..########..', '..###..###..', '..###..###..', '..########..', '..########..', '..###..###..', '..###..###..', '.##########.', '............'],
  etoile: ['.....##.....', '.....##.....', '....####....', '############', '.##########.', '..########..', '...######...', '...######...', '..###..###..', '..##....##..', '.##......##.', '............'],
  chevron: ['............', '............', '.....##.....', '....####....', '...######...', '..###..###..', '.###....###.', '###......###', '##........##', '#..........#', '............', '............'],
  aigle: ['.....##.....', '....####....', '#...#.##...#', '##..####..##', '############', '.##########.', '...######...', '....####....', '...######...', '..##.##.##..', '..#..##..#..', '............'],
  croix: ['....####....', '....####....', '....####....', '############', '############', '############', '....####....', '....####....', '....####....', '....####....', '....####....', '............'],
  couronne: ['............', '#....##....#', '##..####..##', '###.####.###', '############', '############', '##.##.##.###', '############', '############', '............', '............', '............'],
  epee: ['.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '.....##.....', '..########..', '..########..', '.....##.....', '....####....', '.....##.....'],
  fleur: ['.....##.....', '....####....', '....####....', '.##.####.##.', '############', '.##########.', '....####....', '..########..', '.....##.....', '....####....', '...##..##...', '............'],
  lune: ['....####....', '..####......', '.###........', '.##.........', '###.........', '###.........', '###.........', '.##.........', '.###........', '..####......', '....####....', '............'],
  cle: ['...####.....', '..##..##....', '..##..##....', '...####.....', '....##......', '....##......', '....####....', '....##......', '....###.....', '....##......', '....####....', '............'],
  poisson: ['............', '............', '....####....', '..########.#', '.###.######.', '###########.', '.##########.', '..########.#', '....####....', '............', '............', '............'],
};
/** Figures proposées (identifiant, libellé). */
export const FIGURES = [['lion', 'Lion'], ['tour', 'Tour'], ['etoile', 'Étoile'], ['chevron', 'Chevron'], ['aigle', 'Aigle'], ['croix', 'Croix'],
  ['couronne', 'Couronne'], ['epee', 'Épée'], ['fleur', 'Fleur'], ['lune', 'Croissant de lune'], ['cle', 'Clé'], ['poisson', 'Poisson']];

/** Blason par défaut du formulaire. */
export const DEFAULT_BLASON = { colors: ['#2B5AE2', '#E2C77E', '#FCA301'], figure: 'tour', partition: 'plein' };

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Blason nettoyé (couleurs et figure valides, sinon les valeurs par défaut). */
function clean(b) {
  const c = Array.isArray(b?.colors) ? b.colors : [];
  return {
    colors: [0, 1, 2].map((i) => (HEX.test(c[i] || '') ? c[i] : DEFAULT_BLASON.colors[i])),
    figure: F[b?.figure] ? b.figure : DEFAULT_BLASON.figure,
    partition: PARTITIONS.some(([id]) => id === b?.partition) ? b.partition : 'plein',
  };
}

/**
 * Dessin SVG (192 × 128, pixels nets) : fond sombre, écu au centre avec sa partition et sa figure.
 * @param {{colors: string[], figure: string, partition?: string}} b blason
 * @returns {string} code SVG
 */
export function blasonSvg(b) {
  const { colors: [c0, c1, c2], figure, partition } = clean(b);
  // Écu : 12 × 14 « gros pixels » de 7 px, centré (84 × 98 px).
  const S = 7, X = 54, Y = 14, W = 12, H = 14;
  const shield = (x, y) => y < H - 4 || (y === H - 4 && x >= 0) || (y === H - 3 && x >= 1 && x <= W - 2) || (y === H - 2 && x >= 3 && x <= W - 4) || (y === H - 1 && x >= 5 && x <= W - 6);
  const part = (x, y) => (partition === 'parti' ? x >= W / 2 : partition === 'coupe' ? y >= H / 2 : partition === 'bande' ? x - y > -2 && x - y < 3 : false);
  let r = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!shield(x, y)) continue;
      // Bordure : case de l'écu touchant l'extérieur (couleur c1, comme la partition).
      const edge = x === 0 || x === W - 1 || y === 0 || !shield(x - 1, y) || !shield(x + 1, y) || !shield(x, y + 1);
      r += `<rect x="${X + x * S}" y="${Y + y * S}" width="${S}" height="${S}" fill="${edge || part(x, y) ? c1 : c0}"/>`;
    }
  }
  // Figure : 12 × 12 petits pixels de 4 px, centrée sur l'écu, avec une ombre noire décalée.
  const g = F[figure], P = 4, FX = X + (W * S - 12 * P) / 2, FY = Y + 14;
  let fig = '', sh = '';
  g.forEach((row, y) => [...row].forEach((ch, x) => {
    if (ch !== '#') return;
    sh += `<rect x="${FX + x * P + 2}" y="${FY + y * P + 2}" width="${P}" height="${P}"/>`;
    fig += `<rect x="${FX + x * P}" y="${FY + y * P}" width="${P}" height="${P}"/>`;
  }));
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 192 128" width="192" height="128" shape-rendering="crispEdges">'
    + '<rect width="192" height="128" fill="#14122a"/>'
    + `<rect x="${X - 4}" y="${Y - 4}" width="${W * S + 8}" height="${H * S - 8}" fill="#0b0a10"/>`
    + r + `<g fill="#000" opacity=".35">${sh}</g><g fill="${c2}">${fig}</g></svg>`;
}

/** Adresse data: du dessin (aperçu seulement : la carte finale reçoit une image PNG envoyée par le Staff). */
export const blasonDataUrl = (b) => 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(blasonSvg(b));

/**
 * Image PNG du blason (192 × 128), pour l'envoyer comme image de carte (hg-assets, Staff « cartes »).
 * @param {object} b blason
 * @returns {Promise<Blob>}
 */
export function blasonPng(b) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const cv = document.createElement('canvas');
      cv.width = 192; cv.height = 128;
      const ctx = cv.getContext('2d');
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(img, 0, 0, 192, 128);
      cv.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Image du blason impossible à créer'))), 'image/png');
    };
    img.onerror = () => reject(new Error('Image du blason impossible à créer'));
    img.src = blasonDataUrl(b);
  });
}
