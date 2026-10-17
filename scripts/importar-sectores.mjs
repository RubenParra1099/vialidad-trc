// Convierte el mapa de sectores (KML o KMZ exportado de Google My Maps: polígonos 7, 8A … 11B) a
// public/captura/sectores-mapa.json. El formulario de captura guarda en vialidad.incidencias.sector_mapa
// el sector donde cae el punto. Es independiente del Sector de vialidad (C-1, O-1, S-2…).
//
//   npm run captura:sectores -- "MapaSectores Rubén.kmz"
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'public/captura/sectores-mapa.json');
const fuente = process.argv[2];
if (!fuente) { console.error('Indica el KML/KMZ: npm run captura:sectores -- "MapaSectores.kmz"'); process.exit(1); }

function kmlDeZip(b) {
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  let p = b.readUInt32LE(e + 16);
  for (let i = 0, n = b.readUInt16LE(e + 10); i < n; i++) {
    const metodo = b.readUInt16LE(p + 10), tam = b.readUInt32LE(p + 20), ln = b.readUInt16LE(p + 28), off = b.readUInt32LE(p + 42);
    if (/\.kml$/i.test(b.toString('utf8', p + 46, p + 46 + ln))) {
      const ini = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
      const d = b.subarray(ini, ini + tam);
      return (metodo === 8 ? zlib.inflateRawSync(d) : d).toString('utf8');
    }
    p += 46 + ln + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  throw new Error('El KMZ no trae ningún .kml');
}
const b = fs.readFileSync(fuente);
const kml = b[0] === 0x50 && b[1] === 0x4b ? kmlDeZip(b) : b.toString('utf8');
const r5 = (v) => Math.round(v * 1e5) / 1e5;
const sectores = [...kml.matchAll(/<Placemark>([\s\S]*?)<\/Placemark>/g)].map((m) => ({
  n: ((m[1].match(/<name>(?:<!\[CDATA\[)?\s*([^<\]]*?)\s*(?:\]\]>)?<\/name>/) || [])[1] || '').trim().toUpperCase(),
  p: [...m[1].matchAll(/<outerBoundaryIs>[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/g)]
    .map((c) => c[1].trim().split(/\s+/).map((t) => t.split(',').slice(0, 2).map(Number)).filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y)).map(([x, y]) => [r5(x), r5(y)]))
    .filter((a) => a.length >= 4),
})).filter((s) => s.n && s.p.length);
if (!sectores.length) throw new Error('El mapa no trae polígonos con nombre');
fs.writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toISOString().slice(0, 10), fuente: path.basename(fuente), sectores }));
console.log(`✓ ${path.relative(RAIZ, SALIDA)}: ${sectores.length} sectores (${sectores.map((s) => s.n).join(', ')}) · ${(fs.statSync(SALIDA).size / 1024).toFixed(0)} KB`);
