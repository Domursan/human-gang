"""Mini mots croisés pour « Mots croisés du jour » : grilles générées depuis le dictionnaire (outils/nj/reserves/dico.json).
Usage : python3 outils/nj/mots_croises.py <dico.json> <sortie.json> [nombre=120]
Chaque grille (au plus 9×9) croise 7 à 10 mots ; aucune lettre ne touche une autre lettre sans former un mot placé.
Format de sortie (une grille) : { w, h, motif: [lignes : '#' case à remplir, '.' case noire], numeros: [[r, c, n]],
defs: { h: [{ n, r, c, len, def }], v: [...] }, solution: [w*h lettres, '.' pour les cases noires] }.
La solution est retirée par le serveur avant l'envoi au joueur."""
import json, random, sys

def placer(grille, mot, r, c, dr, dc):
    for k, l in enumerate(mot): grille[(r + dr * k, c + dc * k)] = l

def possible(grille, mot, r, c, dr, dc):
    croise = 0
    if (r - dr, c - dc) in grille or (r + dr * len(mot), c + dc * len(mot)) in grille: return -1
    for k, l in enumerate(mot):
        p = (r + dr * k, c + dc * k)
        if p in grille:
            if grille[p] != l: return -1
            croise += 1
        else:
            # pas de voisin sur les côtés (sinon un mot parasite se formerait)
            for s in (1, -1):
                if (p[0] + dc * s, p[1] + dr * s) in grille: return -1
    return croise if croise < len(mot) else -1

def genere(dico, rng, taille=9, cible=9):
    mots = [d for d in dico if 3 <= len(d['mot']) <= taille]
    depart = rng.choice([d for d in mots if 6 <= len(d['mot']) <= taille])
    grille = {}; places = []
    placer(grille, depart['mot'], 0, 0, 0, 1); places.append((depart, 0, 0, 0, 1))
    utilises = {depart['mot']}
    for _ in range(4000):
        if len(places) >= cible: break
        d = rng.choice(mots)
        if d['mot'] in utilises: continue
        m = d['mot']; options = []
        for (p, l) in list(grille.items()):
            for k, x in enumerate(m):
                if x != l: continue
                for dr, dc in ((0, 1), (1, 0)):
                    r, c = p[0] - dr * k, p[1] - dc * k
                    if possible(grille, m, r, c, dr, dc) > 0:
                        cells = [(r + dr * i, c + dc * i) for i in range(len(m))] + list(grille)
                        rs = [q[0] for q in cells]; cs = [q[1] for q in cells]
                        if max(rs) - min(rs) < taille and max(cs) - min(cs) < taille: options.append((r, c, dr, dc))
        if options:
            r, c, dr, dc = rng.choice(options)
            placer(grille, m, r, c, dr, dc); places.append((d, r, c, dr, dc)); utilises.add(m)
    if len(places) < 7: return None
    r0 = min(p[0] for p in grille); c0 = min(p[1] for p in grille)
    h = max(p[0] for p in grille) - r0 + 1; w = max(p[1] for p in grille) - c0 + 1
    sol = ['.'] * (w * h)
    for (r, c), l in grille.items(): sol[(r - r0) * w + c - c0] = l
    # numérotation : de haut en bas, de gauche à droite
    debuts = sorted({(r - r0, c - c0) for (_, r, c, _, _) in places})
    num = {p: i + 1 for i, p in enumerate(debuts)}
    defs = {'h': [], 'v': []}
    for d, r, c, dr, dc in places:
        e = {'n': num[(r - r0, c - c0)], 'r': r - r0, 'c': c - c0, 'len': len(d['mot']), 'def': d['def']}
        defs['h' if dc else 'v'].append(e)
    for k in defs: defs[k].sort(key=lambda e: e['n'])
    motif = [''.join('#' if sol[r * w + c] != '.' else '.' for c in range(w)) for r in range(h)]
    return {'w': w, 'h': h, 'motif': motif, 'numeros': [[p[0], p[1], n] for p, n in num.items()], 'defs': defs, 'solution': sol}

if __name__ == '__main__':
    dico = json.load(open(sys.argv[1])); n = int(sys.argv[3]) if len(sys.argv) > 3 else 120
    rng = random.Random(2026); out = []
    while len(out) < n:
        g = genere(dico, rng)
        if g: out.append(g)
    json.dump(out, open(sys.argv[2], 'w'), ensure_ascii=False)
    print(len(out), 'grilles ; mots par grille :', sum(len(g['defs']['h']) + len(g['defs']['v']) for g in out) / len(out))
