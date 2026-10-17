// Descarga del INE (cartografía electoral, servicio WMS público https://cartografia.ine.mx/wms/index) los
// polígonos de COLONIAS y SECCIONES electorales del municipio de Torreón y los guarda en
// public/captura/geo-ine.json. El formulario de captura ubica el punto del mapa dentro de esos polígonos
// para obtener la colonia exacta y la sección.
//
//   npm run captura:ine          (después: npm run captura:catalogos)
//
// El WMS no ofrece WFS ni consultas por punto, pero entrega los mapas en KML con la geometría vectorial
// y el nombre de cada polígono. Devuelve como máximo 1000 elementos por consulta, así que se pide por
// cuadros (que se subdividen si llegan al límite); una colonia partida entre cuadros queda en varias piezas,
// lo que no afecta ubicar un punto dentro de ella.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'public/captura/geo-ine.json');
const WMS = 'https://cartografia.ine.mx/wms/index';
const MUNICIPIO = 'TORREON';
const TOL = 0.00001; // simplificación Douglas–Peucker (~1 m)

async function kml(capa, bbox) {
  const u = new URL(WMS);
  Object.entries({ SERVICE: 'WMS', VERSION: '1.1.1', REQUEST: 'GetMap', LAYERS: capa, STYLES: '', SRS: 'EPSG:4326',
    BBOX: bbox.join(','), WIDTH: 4096, HEIGHT: 4096, FORMAT: 'application/vnd.google-earth.kml+xml' }).forEach(([k, v]) => u.searchParams.set(k, v));
  const r = await fetch(u, { headers: { 'User-Agent': 'argos-vialidad-trc/1.0' } });
  if (!r.ok) throw new Error(`INE respondió ${r.status} (${capa})`);
  const x = await r.text();
  const lista = [...x.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].map((m) => ({
    nombre: ((m[1].match(/<name>([^<]*)<\/name>/) || [])[1] || '').trim(),
    anillos: [...m[1].matchAll(/<coordinates>([\s\S]*?)<\/coordinates>/g)]
      .map((c) => c[1].trim().split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number)))
      .filter((a) => a.length >= 4),
  })).filter((p) => p.nombre && p.anillos.length);
  // algunas capas (p. ej. MUNICIPIO) salen en píxeles de la imagen pedida: se pasan a grados
  const [x0, y0, x1, y1] = bbox, W = 4096, H = 4096;
  const enPixeles = lista.some((p) => p.anillos.some((a) => a.some(([lx, ly]) => lx > 0 || ly > 90)));
  if (enPixeles) for (const p of lista) p.anillos = p.anillos.map((a) => a.map(([px, py]) => [x0 + (px / W) * (x1 - x0), y0 + (py / H) * (y1 - y0)]));
  return lista;
}
function dentro([x, y], anillo) {
  let c = false;
  for (let i = 0, j = anillo.length - 1; i < anillo.length; j = i++) {
    const [xi, yi] = anillo[i], [xj, yj] = anillo[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}
const area = (a) => Math.abs(a.reduce((s, [x, y], i) => { const [x2, y2] = a[(i + 1) % a.length]; return s + x * y2 - x2 * y; }, 0) / 2);
// punto interior aproximado: centroide del anillo mayor (si cae fuera, un vértice desplazado al centro)
function puntoInterior(anillos) {
  const a = anillos.reduce((m, r) => (area(r) > area(m) ? r : m));
  const c = a.reduce(([sx, sy], [x, y]) => [sx + x / a.length, sy + y / a.length], [0, 0]);
  return dentro(c, a) ? c : [(a[0][0] + c[0]) / 2, (a[0][1] + c[1]) / 2];
}
function simplificar(pts) {
  if (pts.length < 5) return pts;
  // anillo cerrado (primer punto = último): se parte en el vértice más lejano y se simplifica cada mitad
  const [fx, fy] = pts[0], [lx, ly] = pts[pts.length - 1];
  if (Math.abs(fx - lx) < 1e-9 && Math.abs(fy - ly) < 1e-9) {
    let k = 1, dk = 0;
    pts.forEach(([x, y], i) => { const d = Math.hypot(x - fx, y - fy); if (d > dk) { dk = d; k = i; } });
    const a = simplificar(pts.slice(0, k + 1)), b = simplificar(pts.slice(k));
    return a.concat(b.slice(1));
  }
  const keep = new Uint8Array(pts.length); keep[0] = keep[pts.length - 1] = 1;
  const st = [[0, pts.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); const [ax, ay] = pts[a], [bx, by] = pts[b]; const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1e-12;
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs((pts[i][0] - ax) * dy - (pts[i][1] - ay) * dx) / L; if (d > md) { md = d; mi = i; } }
    if (md > TOL) { keep[mi] = 1; st.push([a, mi], [mi, b]); }
  }
  return pts.filter((_, i) => keep[i]).map(([x, y]) => [Math.round(x * 1e5) / 1e5, Math.round(y * 1e5) / 1e5]);
}

// 1) límite del municipio (región de La Laguna)
const muns = await kml('MUNICIPIO', [-104.5, 24.3, -102.3, 26.5]);
const mun = muns.filter((m) => m.nombre.toUpperCase() === MUNICIPIO);
if (!mun.length) throw new Error(`No se encontró el municipio ${MUNICIPIO} en el WMS del INE`);
// el límite municipal llega en tramos de línea sueltos: solo se usa para el recuadro de descarga
const limite = mun.flatMap((m) => m.anillos);
// secciones de Torreón: las del catálogo oficial (Excel por sección) y las nuevas que se indiquen aquí
const OFICIALES = JSON.parse(fs.readFileSync(path.join(RAIZ, 'scripts/datos/colonias_oficiales.json'), 'utf8')).colonias;
const SECCIONES_TRC = new Set([...OFICIALES.flatMap((o) => o.secciones), ...Array.from({ length: 8 }, (_, i) => String(1860 + i))].map((s) => String(+s)));
const xs = limite.flat().map((p) => p[0]), ys = limite.flat().map((p) => p[1]);
const bbox = [Math.min(...xs) - 0.01, Math.min(...ys) - 0.01, Math.max(...xs) + 0.01, Math.max(...ys) + 0.01];
console.log(`Municipio ${MUNICIPIO}: recuadro ${bbox.map((v) => v.toFixed(3)).join(', ')}`);

// cuadros que cubren el recuadro; se subdivide el que llegue al límite de 1000 elementos
async function porCuadros(capa, [x0, y0, x1, y1], paso = 0.1) {
  const piezas = [];
  async function cuadro(b, nivel = 0) {
    const r = await kml(capa, b);
    if (r.length >= 1000 && nivel < 4) {
      const [a, c, d, e] = b, mx = (a + d) / 2, my = (c + e) / 2;
      for (const s of [[a, c, mx, my], [mx, c, d, my], [a, my, mx, e], [mx, my, d, e]]) await cuadro(s, nivel + 1);
    } else piezas.push(...r);
  }
  for (let x = x0; x < x1; x += paso) for (let y = y0; y < y1; y += paso) await cuadro([x, y, Math.min(x + paso, x1), Math.min(y + paso, y1)]);
  // sin piezas repetidas (mismo nombre y mismo primer vértice)
  const vistas = new Set();
  return piezas.filter((p) => { const k = p.nombre + '|' + p.anillos[0][0].join(','); if (vistas.has(k)) return false; vistas.add(k); return true; });
}

// 2) colonias y secciones dentro del municipio
const salida = { generado: new Date().toISOString().slice(0, 10), fuente: `INE · cartografía electoral (${WMS})`, colonias: [], secciones: [] };
// secciones: por número; colonias: las que caen dentro de alguna sección de Torreón
const secs = (await porCuadros('SECCION', bbox)).filter((p) => SECCIONES_TRC.has(String(+p.nombre)));
salida.secciones = secs.map((p) => ({ n: String(+p.nombre), p: p.anillos.map(simplificar).filter((r) => r.length >= 4) })).filter((p) => p.p.length);
const enTorreon = (p) => { const c = puntoInterior(p.anillos); return secs.some((s) => s.anillos.some((r) => dentro(c, r))); };
const cols = (await porCuadros('COLONIA', bbox)).filter(enTorreon);
salida.colonias = cols.map((p) => ({ n: p.nombre.toUpperCase(), p: p.anillos.map(simplificar).filter((r) => r.length >= 4) })).filter((p) => p.p.length);
const nSec = new Set(salida.secciones.map((s) => s.n));
console.log(`  SECCION: ${nSec.size} de ${SECCIONES_TRC.size} secciones de Torreón (${salida.secciones.length} piezas)${[...SECCIONES_TRC].filter((s) => !nSec.has(s)).length ? ' · faltan: ' + [...SECCIONES_TRC].filter((s) => !nSec.has(s)).join(', ') : ''}`);
console.log(`  COLONIA: ${new Set(salida.colonias.map((c) => c.n)).size} colonias (${salida.colonias.length} piezas)`);
salida.secciones.forEach((s) => { s.n = String(+s.n || s.n); });
fs.writeFileSync(SALIDA, JSON.stringify(salida));
console.log(`✓ ${path.relative(RAIZ, SALIDA)} (${(fs.statSync(SALIDA).size / 1024).toFixed(0)} KB). Después: npm run captura:catalogos`);
