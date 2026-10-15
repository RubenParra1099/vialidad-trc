// Regenera public/data/red-vial.txt (red vial de la Comarca Lagunera) desde OpenStreetMap vía Overpass.
// Cubre Torreón, Gómez Palacio, Lerdo y Matamoros para que el mapa se vea completo aunque no haya registros.
//
//   node scripts/generar-red-vial.mjs
//
// Formato del archivo:
//   1a línea: JSON con la lista de nombres de vialidades
//   resto:    clase|nombre|x0,y0,dx1,dy1,…   (x = longitud·1e5, y = latitud·1e5; el primer par es absoluto y
//             los siguientes son diferencias; nombre = índice 1-based en la lista, 0 = sin nombre)
//   clase 0 autopistas/troncales · 1 primarias · 2 secundarias · 3 terciarias · 4 calles locales (sin nombre)
import fs from 'node:fs';
import path from 'node:path';

const BBOX = [25.39, -103.67, 25.83, -103.13]; // sur, oeste, norte, este
const OUT = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1')), '..', 'public', 'data', 'red-vial.txt');
const CLASE = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3, unclassified: 4, residential: 4, living_street: 4 };
const TOL = 1.5; // simplificación Douglas–Peucker en unidades de 1e-5° (~1.5 m)

const q = `[out:json][timeout:300];way["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$|^(unclassified|residential|living_street)$"](${BBOX.join(',')});out tags geom;`;
console.log('Consultando Overpass…');
const r = await fetch('https://overpass-api.de/api/interpreter', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'argos-vialidad/1.0' },
  body: 'data=' + encodeURIComponent(q),
});
if (!r.ok) throw new Error('Overpass respondió ' + r.status);
const { elements } = await r.json();
console.log(elements.length, 'vías recibidas');

function simplify(pts) {
  if (pts.length < 3) return pts;
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i } }
    if (md > TOL) { keep[mi] = 1; st.push([a, mi], [mi, b]) }
  }
  return pts.filter((_, i) => keep[i]);
}

const names = [], nameIdx = new Map(), lines = [];
for (const w of elements) {
  if (!w.geometry || w.geometry.length < 2) continue;
  const c = CLASE[w.tags.highway.replace(/_link$/, '')];
  if (c === undefined) continue;
  const nm = c < 4 ? (w.tags.name || '').trim() : '';
  let ni = 0;
  if (nm) { if (!nameIdx.has(nm)) { names.push(nm); nameIdx.set(nm, names.length) } ni = nameIdx.get(nm) }
  const pts = simplify(w.geometry.map((g) => [Math.round(g.lon * 1e5), Math.round(g.lat * 1e5)]));
  const enc = []; let px = 0, py = 0;
  for (const [x, y] of pts) { enc.push(x - px, y - py); px = x; py = y }
  lines.push(`${c}|${ni}|${enc.join(',')}`);
}
// clases menores primero para que las principales se dibujen encima al leer en orden
lines.sort((a, b) => b[0] - a[0]);
fs.writeFileSync(OUT, JSON.stringify(names) + '\n' + lines.join('\n') + '\n');
console.log(`Listo: ${lines.length} tramos, ${names.length} nombres → ${OUT} (${(fs.statSync(OUT).size / 1024).toFixed(0)} KB)`);
