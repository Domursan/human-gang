"""Silhouettes des pays pour « Pays du jour » : tracé SVG simplifié depuis world-atlas (countries-50m.json).
Usage : python3 outils/nj/silhouettes.py <countries-50m.json> <pays.json> — complète media.svg et media.vb de chaque pays
(clé d'identification : media.forme = {"id": "152"} ou {"par_nom": "Kosovo"}), et retire la silhouette des micro-États
dont le tracé à cette échelle n'est qu'un carré."""
import json, math, sys

def charger(chemin):
    t = json.load(open(chemin))
    sc, tr = t['transform']['scale'], t['transform']['translate']
    arcs = []
    for a in t['arcs']:
        x = y = 0; pts = []
        for dx, dy in a:
            x += dx; y += dy; pts.append((x * sc[0] + tr[0], y * sc[1] + tr[1]))
        arcs.append(pts)
    geoms = {}
    taille = lambda g: len(json.dumps(g['arcs']))
    for g in t['objects']['countries']['geometries']:
        k = g.get('id') or 'NOM:' + g['properties']['name']
        if k not in geoms or taille(g) > taille(geoms[k]): geoms[k] = g  # même id (ex. Australie / îles Ashmore) : la plus grande
    return arcs, geoms

def anneaux(arcs, g):
    arc = lambda i: arcs[i] if i >= 0 else arcs[~i][::-1]
    polys = g['arcs'] if g['type'] == 'MultiPolygon' else [g['arcs']]
    out = []
    for p in polys:
        ring = []
        for i in p[0]: ring += arc(i)
        out.append(ring)
    return out

def aire(r):
    return abs(sum(r[i][0] * r[i - 1][1] - r[i - 1][0] * r[i][1] for i in range(len(r)))) / 2

def simplifie(pts, eps):
    """Douglas-Peucker itératif (pas de récursion profonde)."""
    if len(pts) < 3: return pts
    garde = [False] * len(pts); garde[0] = garde[-1] = True
    pile = [(0, len(pts) - 1)]
    while pile:
        i0, i1 = pile.pop()
        a, b = pts[i0], pts[i1]
        dx, dy = b[0] - a[0], b[1] - a[1]; L = math.hypot(dx, dy)
        dmax, idx = 0, None
        for i in range(i0 + 1, i1):
            p = pts[i]
            d = abs(dy * p[0] - dx * p[1] + b[0] * a[1] - b[1] * a[0]) / L if L > 1e-9 else math.hypot(p[0] - a[0], p[1] - a[1])
            if d > dmax: dmax, idx = d, i
        if idx is not None and dmax > eps:
            garde[idx] = True; pile += [(i0, idx), (idx, i1)]
    return [p for p, k in zip(pts, garde) if k]

def silhouette(arcs, g):
    rings = anneaux(arcs, g)
    xs = [p[0] for r in rings for p in r]
    if max(xs) - min(xs) > 180:  # pays à cheval sur l'antiméridien
        rings = [[(x + 360 if x < 0 else x, y) for x, y in r] for r in rings]
    rings.sort(key=aire, reverse=True)
    main = rings[0]
    mx = sum(p[0] for p in main) / len(main); my = sum(p[1] for p in main) / len(main); A0 = aire(main)
    keep = []
    for r in rings:
        cx = sum(p[0] for p in r) / len(r); cy = sum(p[1] for p in r) / len(r)
        if math.hypot(cx - mx, cy - my) > 25: continue           # territoires lointains (outre-mer)
        if keep and A0 > 2 and aire(r) < A0 * 0.002: continue      # îlots minuscules
        keep.append(r)
    lat0 = sum(p[1] for r in keep for p in r) / sum(len(r) for r in keep)
    k = math.cos(math.radians(lat0))
    P = [[(x * k, -y) for x, y in r] for r in keep]
    xs = [p[0] for r in P for p in r]; ys = [p[1] for r in P for p in r]
    w = max(xs) - min(xs) or 1; h = max(ys) - min(ys) or 1; s = 400 / max(w, h)
    P = [[((x - min(xs)) * s, (y - min(ys)) * s) for x, y in r] for r in P]
    d = ''
    for r in P:
        r2 = simplifie(r, 0.6)
        if len(r2) < 4: continue
        d += 'M' + ' '.join(f'{x:.1f},{y:.1f}' for x, y in r2) + 'Z'
    return d, f'-8 -8 {w * s + 16:.0f} {h * s + 16:.0f}'

if __name__ == '__main__':
    arcs, geoms = charger(sys.argv[1])
    items = json.load(open(sys.argv[2])); sans = []
    for it in items:
        f = it['media'].get('forme', {})
        g = geoms.get('NOM:' + f['par_nom']) if f.get('par_nom') else geoms.get(f.get('id'))
        it['media'].pop('svg', None); it['media'].pop('vb', None)
        if g:
            d, vb = silhouette(arcs, g)
            if len(d) >= 150: it['media']['svg'], it['media']['vb'] = d, vb
        if 'svg' not in it['media']: sans.append(it['reponse'])
    json.dump(items, open(sys.argv[2], 'w'), ensure_ascii=False)
    print(len(items), 'pays ; sans silhouette :', ', '.join(sans))
