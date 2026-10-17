// Convierte las fuentes oficiales de colonias a scripts/datos/colonias_oficiales.json, que usa
// scripts/generar-catalogos.mjs para armar el catálogo unificado (vialidad.colonias).
//
//   node scripts/importar-colonias-oficiales.mjs "ruta/Colonias Torreon.xlsx" "ruta/codigos_postales_torreon.txt"
//
// · Excel "Colonias y comunidades 2024", pestaña TORREON: sección electoral -> colonias ("COL X / FRACC Y / …").
//   La columna SECTOR del Excel es el responsable político de la sección; no se importa.
// · txt de códigos postales: "CP | TIPO | ASENTAMIENTO".
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const [XLSX, TXT] = process.argv.slice(2);
if (!XLSX || !TXT) { console.error('Uso: node scripts/importar-colonias-oficiales.mjs "Colonias Torreon.xlsx" "codigos_postales_torreon.txt"'); process.exit(1); }
const SALIDA = path.join(path.dirname(fileURLToPath(import.meta.url)), 'datos', 'colonias_oficiales.json');

// --- lector mínimo de .xlsx (zip + XML), sin dependencias
function leerZip(ruta) {
  const b = fs.readFileSync(ruta);
  let e = b.length - 22;
  while (e >= 0 && b.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('No es un archivo .xlsx válido');
  const n = b.readUInt16LE(e + 10);
  let p = b.readUInt32LE(e + 16);
  const archivos = {};
  for (let i = 0; i < n; i++) {
    const metodo = b.readUInt16LE(p + 10), tam = b.readUInt32LE(p + 20), ln = b.readUInt16LE(p + 28), lx = b.readUInt16LE(p + 30), lc = b.readUInt16LE(p + 32), off = b.readUInt32LE(p + 42);
    const nombre = b.toString('utf8', p + 46, p + 46 + ln);
    const ini = off + 30 + b.readUInt16LE(off + 26) + b.readUInt16LE(off + 28);
    const datos = b.subarray(ini, ini + tam);
    archivos[nombre] = () => (metodo === 8 ? zlib.inflateRawSync(datos) : datos).toString('utf8');
    p += 46 + ln + lx + lc;
  }
  return archivos;
}
const dec = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
function leerHoja(ruta, hoja) {
  const z = leerZip(ruta);
  const ss = z['xl/sharedStrings.xml'] ? [...z['xl/sharedStrings.xml']().matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => dec([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''))) : [];
  const wb = z['xl/workbook.xml']();
  const rid = [...wb.matchAll(/<sheet [^>]*name="([^"]+)"[^>]*r:id="([^"]+)"/g)].find((m) => m[1].toUpperCase() === hoja.toUpperCase())?.[2];
  if (!rid) throw new Error(`No existe la pestaña ${hoja}`);
  const destino = z['xl/_rels/workbook.xml.rels']().match(new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid}"`));
  const x = z['xl/' + (destino[1] || destino[2]).replace(/^\/?xl\//, '')]();
  return [...x.matchAll(/<row [^>]*>([\s\S]*?)<\/row>/g)].map((r) => {
    const fila = {};
    for (const c of r[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const t = (c[2].match(/t="(\w+)"/) || [])[1], v = (c[3] || '').match(/<v>([\s\S]*?)<\/v>/), is = (c[3] || '').match(/<t[^>]*>([\s\S]*?)<\/t>/);
      fila[c[1]] = t === 's' ? ss[+v[1]] : t === 'inlineStr' ? dec(is ? is[1] : '') : v ? dec(v[1]) : '';
    }
    return fila;
  });
}

// --- Excel: COL / FRACC / EJ / Z IND / P IND / RDCIAL …
const TIPOS = { COL: 'COLONIA', FRACC: 'FRACCIONAMIENTO', EJ: 'EJIDO', 'Z IND': 'ZONA INDUSTRIAL', 'P IND': 'PARQUE INDUSTRIAL', RDCIAL: 'RESIDENCIAL', SEC: 'SECCION', PRIV: 'PRIVADA', CONJ: 'CONJUNTO', COND: 'CONDOMINIO', BARR: 'BARRIO', UHAB: 'UNIDAD HABITACIONAL', RANCH: 'RANCHERIA', RCHO: 'RANCHO', GRANJA: 'GRANJA', PBLO: 'PUEBLO', ZONA: 'ZONA' };
const PREF = new RegExp(`^(${Object.keys(TIPOS).sort((a, b) => b.length - a.length).join('|')})\\s+`);
const filas = leerHoja(XLSX, 'TORREON');
const enc = filas.findIndex((f) => Object.values(f).some((v) => /COLONIAS Y COMUNIDADES/i.test(v)) && Object.values(f).some((v) => /SECCI/i.test(v)));
const cols = Object.fromEntries(Object.entries(filas[enc]).map(([k, v]) => [v.toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, ''), k]));
const cSec = cols['SECCION'], cCol = cols['COLONIAS Y COMUNIDADES'];
const oficiales = new Map();
for (const f of filas.slice(enc + 1)) {
  const sec = String(f[cSec] || '').trim();
  for (let t of String(f[cCol] || '').split('/')) {
    t = t.replace(/\s+/g, ' ').trim().toUpperCase();
    if (!t) continue;
    const m = t.match(PREF);
    const tipo = m ? TIPOS[m[1]] : '';
    const nombre = m ? t.slice(m[0].length).trim() : t;
    const k = `${tipo}|${nombre}`;
    const o = oficiales.get(k) || { nombre, tipo, escrito: t, secciones: new Set(), cp: new Set(), fuentes: new Set(['excel']) };
    if (sec) o.secciones.add(sec);
    oficiales.set(k, o);
  }
}
// --- txt de códigos postales
let nTxt = 0;
for (const l of fs.readFileSync(TXT, 'utf8').split(/\r?\n/)) {
  const m = l.match(/^(\d{5})\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*$/);
  if (!m) continue;
  nTxt++;
  const tipo = m[2].trim().toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const nombre = m[3].trim().toUpperCase();
  const k = `${tipo}|${nombre}`;
  const o = oficiales.get(k) || { nombre, tipo, escrito: m[3].trim(), secciones: new Set(), cp: new Set(), fuentes: new Set() };
  o.cp.add(m[1]); o.fuentes.add('cp');
  oficiales.set(k, o);
}
const lista = [...oficiales.values()].map((o) => ({ nombre: o.nombre, tipo: o.tipo, escrito: o.escrito, cp: [...o.cp].sort(), secciones: [...o.secciones].sort((a, b) => a - b), fuentes: [...o.fuentes] }))
  .sort((a, b) => a.nombre.localeCompare(b.nombre, 'es'));
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify({ generado: new Date().toISOString().slice(0, 10), fuentes: { excel: path.basename(XLSX), cp: path.basename(TXT) }, colonias: lista }, null, 1));
console.log(`✓ ${path.relative(process.cwd(), SALIDA)}: ${lista.length} asentamientos (Excel ${filas.length - enc - 1} secciones, txt ${nTxt} renglones)`);
