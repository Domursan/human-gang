// ===== Humane Gang — sons des jeux (WebAudio, aucun fichier) =====
/*
 * Rôle : les sons validés sur les maquettes des jeux (oct. 2026), joués par les tables de jeu.
 * Usage : import { jouerSonJeu } from '…/commun/sons-jeux.js' ; jouerSonJeu('echecs', 3) (jeu, numéro du son sur la maquette).
 * Suit la préférence « Sons des jeux » (sonTour, active par défaut) et le volume des préférences ; jamais avant un geste
 * de l'utilisateur (le navigateur l'exige) ; silencieux si WebAudio manque. Anti-rafale : un même son 60 ms au plus.
 * Dépendances : aucune (lit localStorage « hg_prefs »).
 * Exporte : jouerSonJeu, SONS_JEUX (liste par jeu : numéro → nom).
 */
let A = null; let M = null; const dernier = {};
function prefs() {
  try { const p = JSON.parse(localStorage.getItem('hg_prefs') || 'null') || {}; const v = Number(p.volume);
    return { on: p.sonTour !== false, volume: Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.6 }; }
  catch { return { on: true, volume: 0.6 }; }
}
function ctx() {
  if (!A) { const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return null; A = new AC(); M = A.createGain(); M.connect(A.destination); }
  if (A.state === 'suspended') A.resume().catch(() => {});
  return A;
}
const note = (f, t, d, o = {}) => { const { type = 'sine', vol = .3, att = .005, f2 = null } = o; const a = A, os = a.createOscillator(), g = a.createGain();
  os.type = type; os.frequency.setValueAtTime(f, a.currentTime + t); if (f2) os.frequency.exponentialRampToValueAtTime(f2, a.currentTime + t + d);
  g.gain.setValueAtTime(0.0001, a.currentTime + t); g.gain.linearRampToValueAtTime(vol, a.currentTime + t + att); g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + t + d);
  os.connect(g).connect(M); os.start(a.currentTime + t); os.stop(a.currentTime + t + d + .05); };
const bruit = (t, d, freq, vol = .4, q = 1, type = 'bandpass') => { const a = A, n = Math.max(1, Math.floor(a.sampleRate * d)), buf = a.createBuffer(1, n, a.sampleRate), x = buf.getChannelData(0);
  for (let i = 0; i < n; i++) x[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, 2); const s = a.createBufferSource(), fl = a.createBiquadFilter(), g = a.createGain();
  s.buffer = buf; fl.type = type; fl.frequency.value = freq; fl.Q.value = q; g.gain.value = vol; s.connect(fl).connect(g).connect(M); s.start(a.currentTime + t); };
const cloche = (f, t, d, vol = .22) => { const a = A, c = a.createOscillator(), m = a.createOscillator(), mg = a.createGain(), g = a.createGain();
  c.frequency.value = f; m.frequency.value = f * 3.5; mg.gain.setValueAtTime(f * 2, a.currentTime + t); mg.gain.exponentialRampToValueAtTime(1, a.currentTime + t + d);
  m.connect(mg).connect(c.frequency); g.gain.setValueAtTime(0, a.currentTime + t); g.gain.linearRampToValueAtTime(vol, a.currentTime + t + .004);
  g.gain.exponentialRampToValueAtTime(.0001, a.currentTime + t + d); c.connect(g).connect(M); [c, m].forEach((o) => { o.start(a.currentTime + t); o.stop(a.currentTime + t + d + .05); }); };

/** Sons par jeu et numéro (numéros des maquettes validées). */
const SONS = {
  'loup-garou': {
    1: () => { bruit(0,1.6,500,.25,.6,'lowpass');note(392,0,1.6,{vol:.18,f2:196});note(587,.3,1.4,{type:'triangle',vol:.06,f2:294}); }, // La nuit tombe
    2: () => { [523,659,784,1047].forEach((f,i)=>note(f,i*.16,.9,{type:'triangle',vol:.14})); }, // Le jour se lève
    3: () => { bruit(0,.35,120,.9,.8,'lowpass');note(110,0,.8,{vol:.3,f2:70});note(233,.25,1.2,{type:'sawtooth',vol:.05});note(247,.25,1.2,{type:'sawtooth',vol:.05}); }, // Mort à l’aube
    4: () => { [0,.65,1.3,1.95].forEach((t)=>{bruit(t,.06,2200,.6,1.2);note(660,t,.12,{type:'triangle',vol:.1});}); }, // Vote (jeton posé)
    5: () => { bruit(0,.12,3000,.35,.8,'highpass');cloche(880,.15,1.2,.16); }, // Carte retournée
    6: () => { note(300,0,1.8,{type:'sawtooth',vol:.05,f2:520});note(520,1.2,1.2,{type:'sawtooth',vol:.04,f2:260});bruit(0,1.8,400,.12,.5,'lowpass'); }, // Hurlement lointain
  },
  'morpion': {
    1: () => { bruit(0,.12,3500,.35,1.5,'highpass');note(740,.02,.1,{type:'triangle',vol:.08}); }, // Marque posée (craie)
    2: () => { [659,784,1047].forEach((f,i)=>note(f,i*.12,.5,{type:'triangle',vol:.16})); }, // Victoire
    3: () => { note(440,0,.3,{type:'triangle',vol:.14});note(330,.25,.6,{type:'triangle',vol:.14}); }, // Défaite
    4: () => { note(600,0,.12,{type:'square',vol:.07});note(600,.18,.12,{type:'square',vol:.07}); }, // Égalité
    5: () => { bruit(0,.06,900,.8,2);note(320,0,.12,{vol:.25,f2:180}); }, // Marque posée (bois)
  },
  'nom-de-code': {
    1: () => { note(784,0,.12,{type:'triangle',vol:.16});note(1046,.1,.35,{type:'triangle',vol:.14}); }, // Indice donné
    2: () => { cloche(660,0,1,.16);cloche(990,.12,.9,.09); }, // Carte de l’équipe
    3: () => { bruit(0,.09,1200,.5,1.2,'lowpass');note(260,0,.25,{type:'sine',vol:.12,f2:200}); }, // Carte passante
    4: () => { bruit(0,1.4,80,.9,.8,'lowpass');note(110,0,1.5,{type:'sawtooth',vol:.22,f2:41});note(116,0,1.5,{type:'sawtooth',vol:.12,f2:45}); }, // Assassin
    5: () => { [523,659,784,1047,1319].forEach((f,i)=>note(f,i*.1,.6,{type:'triangle',vol:.14})); }, // Victoire
  },
  'blackjack': {
    1: () => { [0,.22,.44,.66].forEach((t)=>bruit(t,.08,3000,.35,.9,'highpass')); }, // Cartes distribuées
    2: () => { bruit(0,.12,3000,.35,.8,'highpass');cloche(880,.15,1.2,.16); }, // Carte retournée
    3: () => { [0,.12,.24].forEach((t)=>{bruit(t,.05,2500,.5,1.4);note(1200,t,.06,{type:'triangle',vol:.06});}); }, // Jetons
    4: () => { [659,784,1047].forEach((f,i)=>note(f,i*.12,.5,{type:'triangle',vol:.16})); }, // Gain
    5: () => { note(523,0,.3,{type:'triangle',vol:.14});note(392,.25,.6,{type:'triangle',vol:.14}); }, // Banque saute
  },
  'poker': {
    1: () => { bruit(0,.07,2600,.5,1.6);note(520,0,.08,{type:'triangle',vol:.1}); }, // Carte posée sur le tapis
    2: () => { [0,.1,.2,.3].forEach((t)=>{bruit(t,.05,2500,.5,1.4);note(1200,t,.06,{type:'triangle',vol:.06});}); }, // Jetons vers le pot
    3: () => { note(440,0,.1,{type:'triangle',vol:.12}); }, // Parole (check)
    4: () => { [523,659,784,1047].forEach((f,i)=>note(f,i*.1,.6,{type:'triangle',vol:.15})); }, // Pot gagné
    5: () => { cloche(196,.1,1.6,.22);bruit(.3,.6,1500,.25,.7); }, // Tapis (all-in)
  },
  'catan': {
    1: () => { [0,.14,.31].forEach((t)=>{bruit(t,.05,1800,.7,2.5);}); }, // Dés qui roulent
    2: () => { [0,.1,.2,.3].forEach((t)=>{note(880+Math.random()*300,t,.07,{type:'triangle',vol:.08});}); }, // Ressources reçues
    3: () => { bruit(0,.06,900,.8,2);note(320,0,.12,{vol:.25,f2:180}); }, // Route ou colonie posée
    4: () => { note(784,0,.25,{type:'triangle',vol:.14});note(1047,.18,.4,{type:'triangle',vol:.14}); }, // Point gagné
    5: () => { note(330,0,.5,{type:'sawtooth',vol:.07,f2:165}); }, // Voleur
  },
  'pictionary': {
    1: () => { bruit(0,.18,4000,.2,.8,'highpass'); }, // Trait de crayon
    2: () => { note(1046,0,.09,{type:'triangle',vol:.12}); }, // Lettre dévoilée
    3: () => { [659,784,1047].forEach((f,i)=>note(f,i*.1,.45,{type:'triangle',vol:.16})); }, // Trouvé !
    4: () => { note(494,0,.25,{type:'triangle',vol:.14});note(392,.22,.5,{type:'triangle',vol:.14}); }, // Temps écoulé
    5: () => { cloche(988,0,.9,.18); }, // Mot choisi
  },
  'puissance-4': {
    1: () => { bruit(0,.04,900,.6,1,'lowpass');note(200,0,.14,{type:'sine',vol:.28,f2:110});bruit(.5,.035,1100,.3,1,'lowpass');note(240,.5,.08,{type:'sine',vol:.12,f2:150}); }, // Jeton qui tombe
    2: () => { note(660,0,.05,{type:'square',vol:.08});note(990,.05,.05,{type:'square',vol:.05}); }, // Colonne choisie
    3: () => { [523,659,784,1047].forEach((f,i)=>note(f,i*.1,.6,{type:'triangle',vol:.16})); }, // Victoire
    4: () => { [1319,1568,2093,2637].forEach((f,i)=>note(f,i*.06,.3,{type:'sine',vol:.07}));bruit(.05,.3,6000,.08,2,'highpass'); }, // Ligne alignée
    5: () => { cloche(659,0,1.8,.2);cloche(988,.12,1.6,.12); }, // Fin de duel
  },
  'othello': {
    1: () => { bruit(0,.05,2500,.5,1.5,'highpass');note(520,0,.08,{type:'triangle',vol:.14}); }, // Pion posé
    2: () => { bruit(0,.04,3000,.4,2,'highpass');note(880,.02,.06,{type:'sine',vol:.06}); }, // Pion retourné
    3: () => { note(1046,0,.07,{type:'sine',vol:.08}); }, // Compte qui change
    4: () => { cloche(659,0,1.8,.2);cloche(988,.12,1.6,.12); }, // Fin de partie
  },
  'dames': {
    1: () => { bruit(0,.05,1800,.6,1.2,'bandpass');note(260,0,.1,{type:'triangle',vol:.2,f2:140}); }, // Pièce prise
    2: () => { bruit(0,.35,700,.25,.7,'lowpass');note(330,0,.35,{type:'sine',vol:.08,f2:260}); }, // Glissement
    3: () => { note(740,0,.05,{type:'square',vol:.08}); }, // Sélection
    4: () => { cloche(523,0,1.6,.18);cloche(784,.15,1.4,.12); }, // Fin de partie
  },
  'echecs': {
    1: () => { bruit(0,.04,1200,.5,1,'lowpass');note(300,0,.12,{type:'sine',vol:.25,f2:120}); }, // Pièce prise
    2: () => { bruit(0,.03,1500,.5,3);note(330,0,.09,{type:'triangle',vol:.22,f2:180}); }, // Pièce posée (bois)
    3: () => { note(110,0,1.8,{type:'sine',vol:.25,f2:98});cloche(220,.05,1.6,.1); }, // Échec (gong grave)
    4: () => { [392,523,659,784].forEach((f,i)=>note(f,i*.14,.5,{type:'square',vol:.09})); }, // Échec et mat
    5: () => { note(600,0,.12,{type:'square',vol:.07});note(600,.18,.12,{type:'square',vol:.07}); }, // Nulle
  },
  'bataille-navale': {
    1: () => { bruit(0,.3,700,.5,1,'lowpass');note(330,0,.35,{type:'sine',vol:.22,f2:110}); }, // Plouf (à l’eau)
    2: () => { bruit(0,.9,900,.9,.6,'lowpass');note(120,0,.8,{vol:.35,f2:40}); }, // Touché (explosion)
    3: () => { bruit(0,1.4,500,1,.5,'lowpass');note(110,0,1.4,{vol:.3,f2:35});[330,277,220].forEach((f,i)=>note(f,.5+i*.22,.4,{type:'triangle',vol:.1})); }, // Coulé (fond de mer)
    4: () => { cloche(1320,0,1.2,.16);cloche(1320,.7,1.0,.1); }, // Tir reçu (sonar)
    5: () => { [523,659,784,1047].forEach((f,i)=>note(f,i*.1,.5,{type:'triangle',vol:.14})); }, // Victoire
  },
  'mastermind': {
    1: () => { note(880,0,.12,{type:'triangle',vol:.12}); }, // Indice bien placé
    2: () => { note(560,0,.14,{type:'sine',vol:.1}); }, // Indice mal placé
    3: () => { bruit(0,.05,2600,.5,1.5);note(700,0,.06,{type:'square',vol:.05}); }, // Pion posé
    4: () => { [523,659,784,988,1319].forEach((f,i)=>note(f,i*.09,.45,{type:'triangle',vol:.13})); }, // Code percé
    5: () => { [392,349,311].forEach((f,i)=>note(f,i*.22,.45,{type:'triangle',vol:.12})); }, // Le robot perce ton code
  },
  'qui-est-ce': {
    1: () => { bruit(0,.08,1800,.4,1.2,'highpass');note(520,.02,.1,{type:'triangle',vol:.08}); }, // Portrait baissé
    2: () => { note(660,0,.15,{type:'triangle',vol:.14});note(990,.12,.3,{type:'triangle',vol:.14}); }, // Réponse « oui »
    3: () => { note(220,0,.35,{type:'square',vol:.07,f2:160}); }, // Réponse « non »
    4: () => { cloche(1046,0,.6,.12); }, // Question posée
    5: () => { [523,659,784,1047].forEach((f,i)=>note(f,i*.1,.5,{type:'triangle',vol:.14})); }, // Personnage trouvé
  },
  'pierre-feuille-ciseaux': {
    1: () => { [0,.45,.9].forEach((t)=>bruit(t,.06,2000,.6,1.4));note(988,1.25,.3,{type:'square',vol:.1}); }, // Compte à trois
    2: () => { bruit(0,.25,900,.6,.8,'bandpass');note(440,.05,.3,{type:'triangle',vol:.12});note(660,.18,.35,{type:'triangle',vol:.12}); }, // Révélation des mains
    3: () => { [523,659,784].forEach((f,i)=>note(f,i*.09,.4,{type:'triangle',vol:.14})); }, // Lancer gagné
    4: () => { note(600,0,.12,{type:'square',vol:.07});note(600,.18,.12,{type:'square',vol:.07}); }, // Égalité, on relance
    5: () => { [659,784,988,1319].forEach((f,i)=>note(f,i*.11,.55,{type:'triangle',vol:.14})); }, // Duel gagné
  },
  'cluedo': {
    1: () => { bruit(0,.05,900,.7,2);note(260,0,.08,{type:'triangle',vol:.12}); }, // Pas sur le plateau
    2: () => { bruit(0,.25,2500,.25,.9,'highpass');bruit(.22,.08,1800,.2,1.2); }, // Carte montrée
    3: () => { cloche(523,0,1.4,.2);cloche(784,.15,1.2,.12); }, // Hypothèse posée
    4: () => { [523,659,784,1047].forEach((f,i)=>note(f,i*.12,.7,{type:'triangle',vol:.14})); }, // Solution révélée
    5: () => { note(392,0,.4,{type:'triangle',vol:.14});note(294,.3,.4,{type:'triangle',vol:.14});note(220,.6,.8,{type:'sawtooth',vol:.05}); }, // Éliminé
  },
  'destins': {
    1: () => { bruit(0,.05,1800,.5,2);note(660,0,.05,{type:'triangle',vol:.08}); }, // Pas sur la case
    2: () => { [0,.09,.18,.28,.39,.52,.66,.82,1.0,1.2,1.42,1.66].forEach((t)=>bruit(t,.03,2600,.35,3,'highpass')); }, // Roulette
    3: () => { cloche(1047,0,1.2,.18);note(1319,.05,.6,{type:'triangle',vol:.08}); }, // Résultat de la roue
    4: () => { bruit(0,.2,1200,.3,.8);cloche(659,.15,1.4,.14);cloche(988,.3,1.2,.08); }, // Carte Événement
    5: () => { [523,659,784,1047].forEach((f,i)=>note(f,i*.14,.5,{type:'triangle',vol:.16}));note(1047,.6,1,{type:'triangle',vol:.1}); }, // Victoire
  },
  'monopoly': {
    1: () => { [0,.07,.15,.22,.31,.4].forEach((t)=>bruit(t,.04,3000,.5,2,'highpass'));bruit(.45,.08,400,.6,1,'lowpass'); }, // Dés qui roulent
    2: () => { bruit(0,.04,2200,.5,2);note(780,0,.05,{type:'triangle',vol:.08}); }, // Pion posé
    3: () => { note(1568,0,.08,{type:'square',vol:.1});note(2093,.07,.25,{type:'square',vol:.1});bruit(0,.05,4000,.3,3,'highpass'); }, // Billets
    4: () => { note(180,0,.6,{type:'sawtooth',vol:.1,f2:120});bruit(.3,.06,900,.8,4);bruit(.65,.06,900,.8,4); }, // Prison
    5: () => { [392,523,659,784].forEach((f,i)=>note(f,i*.12,.5,{type:'triangle',vol:.16}));note(784,.5,1.2,{type:'triangle',vol:.12}); }, // Victoire
  },
  'risk': {
    1: () => { bruit(0,.06,1200,.6,2);note(330,0,.1,{type:'triangle',vol:.14}); }, // Troupe posée
    2: () => { [0,.05,.11,.19,.28,.38,.5].forEach((t)=>bruit(t,.035,2000,.5,3,'bandpass'));bruit(.56,.1,400,.7,1,'lowpass'); }, // Dés qui roulent
    3: () => { bruit(0,.12,300,.9,1,'lowpass');note(146,0,.25,{type:'sawtooth',vol:.12,f2:70}); }, // Choc de bataille
    4: () => { [262,330,392,523].forEach((f,i)=>note(f,i*.1,.35,{type:'triangle',vol:.16})); }, // Territoire conquis
    5: () => { [262,330,392,523,659].forEach((f,i)=>note(f,i*.08,1.4,{type:'triangle',vol:.1}));cloche(523,.4,1.8,.18); }, // Victoire du monde
  },
  'shadow-hunters': {
    1: () => { [0,.06,.13,.21,.3].forEach((t)=>bruit(t,.035,2400,.5,2.5,'highpass'));bruit(.4,.08,500,.6,1,'lowpass');note(440,.5,.1,{type:'triangle',vol:.1}); }, // Dés (d6 + d4)
    2: () => { cloche(392,0,1.6,.14);cloche(587,.5,1.4,.1); }, // Vision révélée
    3: () => { bruit(0,.14,260,.9,1,'lowpass');note(120,0,.35,{type:'sawtooth',vol:.12,f2:60}); }, // Blessure
    4: () => { note(900,0,.35,{type:'sine',vol:.08,f2:300});bruit(.25,.12,2000,.25,1,'highpass'); }, // Attaque ratée
    5: () => { [330,415,494,659].forEach((f,i)=>note(f,i*.12,.6,{type:'triangle',vol:.14}));note(659,.5,1.2,{type:'triangle',vol:.1}); }, // Victoire
  },
};
/** Noms des sons (pour les réglages et la documentation). */
export const SONS_JEUX = {
 "loup-garou": {
  "1": "La nuit tombe",
  "2": "Le jour se lève",
  "3": "Mort à l’aube",
  "4": "Vote (jeton posé)",
  "5": "Carte retournée",
  "6": "Hurlement lointain"
 },
 "morpion": {
  "1": "Marque posée (craie)",
  "2": "Victoire",
  "3": "Défaite",
  "4": "Égalité",
  "5": "Marque posée (bois)"
 },
 "nom-de-code": {
  "1": "Indice donné",
  "2": "Carte de l’équipe",
  "3": "Carte passante",
  "4": "Assassin",
  "5": "Victoire"
 },
 "blackjack": {
  "1": "Cartes distribuées",
  "2": "Carte retournée",
  "3": "Jetons",
  "4": "Gain",
  "5": "Banque saute"
 },
 "poker": {
  "1": "Carte posée sur le tapis",
  "2": "Jetons vers le pot",
  "3": "Parole (check)",
  "4": "Pot gagné",
  "5": "Tapis (all-in)"
 },
 "catan": {
  "1": "Dés qui roulent",
  "2": "Ressources reçues",
  "3": "Route ou colonie posée",
  "4": "Point gagné",
  "5": "Voleur"
 },
 "pictionary": {
  "1": "Trait de crayon",
  "2": "Lettre dévoilée",
  "3": "Trouvé !",
  "4": "Temps écoulé",
  "5": "Mot choisi"
 },
 "puissance-4": {
  "1": "Jeton qui tombe",
  "2": "Colonne choisie",
  "3": "Victoire",
  "4": "Ligne alignée",
  "5": "Fin de duel"
 },
 "othello": {
  "1": "Pion posé",
  "2": "Pion retourné",
  "3": "Compte qui change",
  "4": "Fin de partie"
 },
 "dames": {
  "1": "Pièce prise",
  "2": "Glissement",
  "3": "Sélection",
  "4": "Fin de partie"
 },
 "echecs": {
  "1": "Pièce prise",
  "2": "Pièce posée (bois)",
  "3": "Échec (gong grave)",
  "4": "Échec et mat",
  "5": "Nulle"
 },
 "bataille-navale": {
  "1": "Plouf (à l’eau)",
  "2": "Touché (explosion)",
  "3": "Coulé (fond de mer)",
  "4": "Tir reçu (sonar)",
  "5": "Victoire"
 },
 "mastermind": {
  "1": "Indice bien placé",
  "2": "Indice mal placé",
  "3": "Pion posé",
  "4": "Code percé",
  "5": "Le robot perce ton code"
 },
 "qui-est-ce": {
  "1": "Portrait baissé",
  "2": "Réponse « oui »",
  "3": "Réponse « non »",
  "4": "Question posée",
  "5": "Personnage trouvé"
 },
 "pierre-feuille-ciseaux": {
  "1": "Compte à trois",
  "2": "Révélation des mains",
  "3": "Lancer gagné",
  "4": "Égalité, on relance",
  "5": "Duel gagné"
 },
 "cluedo": {
  "1": "Pas sur le plateau",
  "2": "Carte montrée",
  "3": "Hypothèse posée",
  "4": "Solution révélée",
  "5": "Éliminé"
 },
 "destins": {
  "1": "Pas sur la case",
  "2": "Roulette",
  "3": "Résultat de la roue",
  "4": "Carte Événement",
  "5": "Victoire"
 },
 "monopoly": {
  "1": "Dés qui roulent",
  "2": "Pion posé",
  "3": "Billets",
  "4": "Prison",
  "5": "Victoire"
 },
 "risk": {
  "1": "Troupe posée",
  "2": "Dés qui roulent",
  "3": "Choc de bataille",
  "4": "Territoire conquis",
  "5": "Victoire du monde"
 },
 "shadow-hunters": {
  "1": "Dés (d6 + d4)",
  "2": "Vision révélée",
  "3": "Blessure",
  "4": "Attaque ratée",
  "5": "Victoire"
 }
};

/**
 * Joue un son de jeu. Ne lève jamais d'erreur.
 * @param {string} jeu identifiant du jeu (clé de SONS_JEUX)
 * @param {number} n numéro du son
 */
export function jouerSonJeu(jeu, n) {
  const f = SONS[jeu]?.[n]; const p = prefs();
  if (!f || !p.on || p.volume <= 0) return;
  const k = jeu + n; const t = performance.now(); if (t - (dernier[k] || 0) < 60) return; dernier[k] = t;
  try { if (!ctx()) return; M.gain.setValueAtTime(p.volume * p.volume, A.currentTime); f(); } catch (e) { console.warn('[son]', e); }
}
