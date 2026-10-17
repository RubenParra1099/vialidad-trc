// Genera public/captura/catalogos.json: las listas de opciones del formulario de captura,
// a partir de los datos históricos (public/data/omega.json ya depurado + valores frecuentes en Neon).
//   npm run captura:catalogos
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { unificar, claveColonia } from './colonias-unificar.mjs';
import { DDL_COLONIAS } from '../lib/incidencias.js';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OMEGA = JSON.parse(fs.readFileSync(path.join(RAIZ, 'public/data/omega.json'), 'utf8'));
const SALIDA = path.join(RAIZ, 'public/captura/catalogos.json');
const FUERA = new Set(['SIN DATO', '', 'NAN', 'N/A', 'NA', 'S/D', 'SD', 'OTROS']);

// opciones de una dimensión de omega.json ordenadas por frecuencia
function dim(mod, k, { otros = false } = {}) {
  const d = OMEGA[mod].dims[k];
  const n = new Array(d.dict.length).fill(0);
  for (const c of d.c) n[c]++;
  return d.dict.map((v, i) => [v, n[i]]).filter(([v]) => !FUERA.has(v) || (otros && v === 'OTROS')).sort((a, b) => b[1] - a[1]).map(([v]) => v);
}
const une = (...ls) => [...new Set(ls.flat())];

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
// valores frecuentes de una o varias columnas (separando listas "A, B Y C" si se pide)
async function frecuentes(consultas, { min = 2, max = 400, separar = false, limpiar = (s) => s } = {}) {
  const cuenta = new Map();
  for (const [tabla, col] of consultas) {
    const { rows } = await db.query(`SELECT ${col} v, count(*)::int n FROM vialidad.${tabla} WHERE ${col} IS NOT NULL GROUP BY 1`);
    for (const { v, n } of rows) {
      const partes = separar ? String(v).split(/\s*(?:,|\/| Y )\s*/) : [v];
      for (let p of partes) {
        p = limpiar(String(p).toUpperCase().replace(/\s+/g, ' ').trim());
        if (!p || FUERA.has(p) || p.length < 2) continue;
        cuenta.set(p, (cuenta.get(p) || 0) + n);
      }
    }
  }
  return [...cuenta].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, max).map(([v]) => v);
}
const placasAcc = (campo) => Array.from({ length: 16 }, (_, i) => ['accidentes_viales', `${campo}_${i + 1}`]);

// ---- Colonias: catálogo unificado (oficiales + escrituras históricas como alias), ver scripts/colonias-unificar.mjs
const DATOS = path.join(RAIZ, 'scripts/datos');
const OFICIALES = JSON.parse(fs.readFileSync(path.join(DATOS, 'colonias_oficiales.json'), 'utf8')).colonias;
const EQUIV_F = path.join(DATOS, 'colonias_equivalencias.json');
const EQUIV = fs.existsSync(EQUIV_F) ? Object.fromEntries(Object.entries(JSON.parse(fs.readFileSync(EQUIV_F, 'utf8'))).filter(([k]) => !k.startsWith('_'))) : {};
const FUERA_COL = new Set([...FUERA, 'SIN COLONIA']);
const escrituras = {};
for (const mod of ['acc', 'mal']) {
  const col = OMEGA[mod].dims.colonia;
  col.c.forEach((ci) => { const n = col.dict[ci]; if (!FUERA_COL.has(n)) escrituras[n] = (escrituras[n] || 0) + 1; });
}
const U = unificar({ oficiales: OFICIALES, equivalencias: EQUIV, historico: Object.entries(escrituras) });

// colonia final -> sector más frecuente y centro; puntos históricos con colonia (detección por vecinos cercanos)
const colonias = {};
const puntos = [];
for (const mod of ['acc', 'mal']) {
  const ds = OMEGA[mod], col = ds.dims.colonia, sec = ds.dims.sector;
  col.c.forEach((ci, i) => {
    const nombre = U.asignacion.get(col.dict[ci]);
    if (!nombre) return;
    const o = (colonias[nombre] ??= { s: {}, lat: [], lng: [], n: 0 });
    o.n++;
    const s = sec.dict[sec.c[i]];
    if (!FUERA.has(s)) o.s[s] = (o.s[s] || 0) + 1;
    const la = ds.vals.lat[i], lo = ds.vals.lng[i];
    if (la != null && la > 25.3 && la < 25.8 && lo > -103.65 && lo < -103.1) { o.lat.push(la); o.lng.push(lo); puntos.push([la, lo, nombre, FUERA.has(s) ? null : s]); }
  });
}
const mediana = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[Math.floor(s.length / 2)].toFixed(5) : null; };
const nombresFinales = [...new Set([...U.oficialPorNombre.keys(), ...[...U.propias.values()].map((p) => p.nombre)])]
  .sort((a, b) => (colonias[b]?.n || 0) - (colonias[a]?.n || 0) || a.localeCompare(b, 'es'));
// info: [sector, latitud, longitud, tipo, códigos postales]
const coloniaInfo = Object.fromEntries(nombresFinales.map((n) => {
  const o = colonias[n], g = U.oficialPorNombre.get(n);
  const sector = o ? Object.entries(o.s).sort((a, b) => b[1] - a[1])[0]?.[0] || null : null;
  return [n, [sector, o ? mediana(o.lat) : null, o ? mediana(o.lng) : null, g ? [...g.tipos].join(' / ') : null, g && g.cp.size ? [...g.cp].join(', ') : null]];
}));
// alias: clave de cada escritura conocida -> nombre del catálogo (el formulario convierte lo escrito al nombre oficial)
const coloniaAlias = {};
const ponAlias = (esc, n) => { const k = claveColonia(esc); if (k && !(k in coloniaAlias)) coloniaAlias[k] = n; };
// prioridad si dos escrituras comparten clave: colonias oficiales y sus alias, después las solo históricas
for (const n of U.oficialPorNombre.keys()) ponAlias(n, n);
for (const [esc, n] of U.asignacion) if (U.oficialPorNombre.has(n)) ponAlias(esc, n);
for (const g of U.porClave.values()) for (const a of g.alias) ponAlias(a, g.nombre);
for (const n of nombresFinales) ponAlias(n, n);
for (const [esc, n] of U.asignacion) ponAlias(esc, n);

// ---- Colonias del INE (public/captura/geo-ine.json, npm run captura:ine): cada polígono del INE se liga a su
// colonia del catálogo; las que no estaban se agregan como colonias oficiales nuevas (fuente "ine").
const GEO_INE = path.join(RAIZ, 'public/captura/geo-ine.json');
const coloniaIne = {};   // nombre en el INE -> nombre del catálogo
const nuevasIne = new Set();
if (fs.existsSync(GEO_INE)) {
  const G = JSON.parse(fs.readFileSync(GEO_INE, 'utf8'));
  const resolver = (n) => { const k = claveColonia(n); return coloniaAlias[k] || (!k.startsWith('EJ:') && coloniaAlias['EJ:' + k]) || null; };
  const dentro = ([x, y], r) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
  for (const c of G.colonias) {
    if (c.n in coloniaIne) continue;
    let destino = resolver(c.n);
    if (!destino) { destino = c.n; nuevasIne.add(destino); nombresFinales.push(destino); ponAlias(destino, destino); }
    coloniaIne[c.n] = destino;
  }
  // sector y centro de las nuevas: los registros históricos que caen en su polígono
  for (const n of nuevasIne) {
    const piezas = G.colonias.filter((c) => c.n === n).flatMap((c) => c.p);
    const f = piezas.flat(), bb = [Math.min(...f.map((p) => p[0])), Math.min(...f.map((p) => p[1])), Math.max(...f.map((p) => p[0])), Math.max(...f.map((p) => p[1]))];
    const votos = {};
    for (const [la, lo, , s] of puntos) if (s && lo >= bb[0] && lo <= bb[2] && la >= bb[1] && la <= bb[3] && piezas.some((r) => dentro([lo, la], r))) votos[s] = (votos[s] || 0) + 1;
    const sector = Object.entries(votos).sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    const cx = f.reduce((s, p) => s + p[0], 0) / f.length, cy = f.reduce((s, p) => s + p[1], 0) / f.length;
    coloniaInfo[n] = [sector, +cy.toFixed(5), +cx.toFixed(5), null, null];
  }
  console.log(`INE: ${Object.keys(coloniaIne).length} colonias con polígono · ${nuevasIne.size} nuevas en el catálogo`);
}
const idxCol = new Map(nombresFinales.map((n, i) => [n, i]));
// puntos sin repetir (misma coordenada y colonia), como enteros: lat·1e5, lng·1e5, índice de colonia
const vistos = new Set();
const coloniaPts = [];
for (const [la, lo, n] of puntos) {
  const k = `${Math.round(la * 1e5)},${Math.round(lo * 1e5)},${idxCol.get(n)}`;
  if (vistos.has(k)) continue;
  vistos.add(k); coloniaPts.push(Math.round(la * 1e5), Math.round(lo * 1e5), idxCol.get(n));
}
// revisión manual: escrituras históricas sin colonia oficial equivalente
const csv = ['escritura_historica,registros,sugerencia_1,sugerencia_2,sugerencia_3', ...U.revision.map((r) => [r.esc, r.n, ...r.sugerencias.map((s) => s[0]), '', '', ''].slice(0, 5).map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))];
fs.writeFileSync(path.join(DATOS, 'colonias_revision.csv'), '﻿' + csv.join('\r\n') + '\r\n');
if (!fs.existsSync(EQUIV_F)) fs.writeFileSync(EQUIV_F, JSON.stringify({ _instrucciones: 'escritura histórica -> nombre oficial del catálogo, o "" si es una colonia propia que no está en las oficiales. Después: npm run captura:catalogos' }, null, 1));
const totReg = Object.values(escrituras).reduce((a, b) => a + b, 0);
const conOficial = [...U.asignacion].filter(([, n]) => U.oficialPorNombre.has(n)).reduce((s, [e]) => s + escrituras[e], 0);
console.log(`Colonias: ${U.oficialPorNombre.size} oficiales + ${U.propias.size} solo históricas · ${(conOficial / totReg * 100).toFixed(1)} % de los registros con colonia oficial · ${U.revision.length} escrituras en scripts/datos/colonias_revision.csv`);

const cat = {
  generado: new Date().toISOString().slice(0, 10),
  sector: dim('acc', 'sector').sort(),
  jurisdiccion: dim('acc', 'jurisdiccion'),
  origen: dim('acc', 'origen'),
  grupo: une(dim('acc', 'grupo'), dim('eve', 'grupo'), dim('bit', 'grupo')),
  tipo_accidente: dim('acc', 'tipo'),
  danos: dim('acc', 'danos'),
  causa: dim('acc', 'causa'),
  estatus: ['ATENDIDO', 'NO ATENDIDO'],
  motivo_no_atendido: une(dim('acc', 'motivo'), dim('mal', 'motivo')),
  colonia: nombresFinales,
  colonia_info: coloniaInfo,
  colonia_alias: coloniaAlias,
  colonia_ine: coloniaIne,
  colonia_pts: coloniaPts,
  dependencia: dim('eve', 'dependencia'),
  accion: dim('eve', 'accion'),
  clave: une(['OPERATIVO CARRUSEL', '74', '75', '75/55', '75/56', '75/57', '75/60', '75/83', 'WC'], await frecuentes([['bitacora', 'razonamiento']], { min: 5, max: 60, limpiar: (s) => s.replace(/^(\d{2})[\s-](\d{2})$/, '$1/$2') })),
  evento: dim('mal', 'evento'),
  clasificacion: dim('acc', 'vehiculo'),
  servicio: ['PARTICULAR', 'PUBLICO'],
  tipo_servicio: ['TAXI', 'TRANSPORTE CARGA PESADA', 'AUTOBUSES'],
  sexo: ['MASCULINO', 'FEMENINO'],
  rol: ['CONDUCTOR', 'PASAJERO', 'PEATON', 'CICLISTA'],
  condicion: ['ILESO', 'LESIONADO', 'FALLECIDO'],
  marca: await frecuentes([...placasAcc('marca'), ['vehiculos_corralon', 'marca'], ['detenidos', 'marca']], { min: 3, max: 250, limpiar: (s) => (s === 'VW' ? 'VOLKSWAGEN' : s) }),
  linea: await frecuentes([...placasAcc('tipo'), ['vehiculos_corralon', 'sub_marca'], ['detenidos', 'sub_marca']], { min: 3, max: 500 }),
  color: await frecuentes([...placasAcc('color'), ['vehiculos_corralon', 'color'], ['detenidos', 'color']], { min: 4, max: 120 }),
  operador: await frecuentes([['accidentes_viales', 'operador_en_turno'], ['eventos_apoyos', 'operador'], ['bitacora', 'operador'], ['mal_estacionados', 'operador_en_turno'], ['detenidos', 'operador_en_turno']], { min: 3, max: 60, limpiar: (s) => (s === 'OPERADOR EN TURNO' ? '' : s) }),
  unidad: await frecuentes([['accidentes_viales', 'unidad_es'], ['bitacora', 'unidad'], ['mal_estacionados', 'unidad_es'], ['vehiculos_corralon', 'unidad'], ['detenidos', 'unidad']], { min: 3, max: 400, separar: true }),
  agente: await frecuentes([['accidentes_viales', 'agente_s'], ['eventos_apoyos', 'agente_s'], ['mal_estacionados', 'agente_s'], ['vehiculos_corralon', 'agente_s'], ['detenidos', 'agente']], { min: 3, max: 1500, separar: true, limpiar: (s) => (/\d/.test(s) || s.split(' ').length < 2 ? '' : s) }),
  grua: await frecuentes([['vehiculos_corralon', 'grua'], ['detenidos', 'gruas']], { min: 3, max: 60, separar: true }),
  numerales: await frecuentes([['vehiculos_corralon', 'numeral'], ['detenidos', 'numerales']], { min: 3, max: 80, separar: true, limpiar: (s) => (/^\d+$/.test(s) ? String(+s) : '') }),
  tipo_ingreso: await frecuentes([['detenidos', 'tipo_de_ingreso']], { min: 1 }),
  autoridad: ['JUEZ CALIFICADOR', 'MINISTERIO PUBLICO'],
};
// Tabla vialidad.colonias: catálogo vivo (oficiales + solo históricas + las que se agreguen al capturar)
await db.query(DDL_COLONIAS);
for (const [c, t] of [['tipo', 'text'], ['cp', 'text'], ['secciones', 'text'], ['alias', 'text']]) await db.query(`ALTER TABLE vialidad.colonias ADD COLUMN IF NOT EXISTS ${c} ${t}`);
await db.query("COMMENT ON TABLE vialidad.colonias IS 'Catálogo de colonias del formulario de captura: oficiales (Excel por sección electoral + códigos postales), solo históricas (omega 2023) y agregadas al capturar'");
await db.query("COMMENT ON COLUMN vialidad.colonias.fuente IS 'oficial (Excel / CP), ine (polígono del INE que no estaba en el Excel), historico (escrita en omega 2023 sin equivalente oficial), captura (agregada por un capturista) u osm'");
await db.query("COMMENT ON COLUMN vialidad.colonias.registros IS 'Registros históricos de vialidad con esa colonia'");
await db.query("COMMENT ON COLUMN vialidad.colonias.tipo IS 'COLONIA, FRACCIONAMIENTO, EJIDO, ZONA INDUSTRIAL…'");
await db.query("COMMENT ON COLUMN vialidad.colonias.cp IS 'Código(s) postal(es)'");
await db.query("COMMENT ON COLUMN vialidad.colonias.secciones IS 'Secciones electorales donde aparece (Excel)'");
await db.query("COMMENT ON COLUMN vialidad.colonias.alias IS 'Otras escrituras de la colonia (Excel, CP y registros históricos)'");
await db.query("DELETE FROM vialidad.colonias WHERE fuente IN ('historico', 'oficial', 'ine')");
const filas = nombresFinales.map((n) => {
  const [s, la, lo, tipo, cp] = coloniaInfo[n], g = U.oficialPorNombre.get(n);
  const alias = [...new Set([...(g ? g.alias : []), ...[...U.asignacion].filter(([, d]) => d === n).map(([e]) => e)])].filter((a) => a !== n).sort();
  return [n, s, la, lo, colonias[n]?.n || null, g ? 'oficial' : nuevasIne.has(n) ? 'ine' : 'historico', tipo, cp, g && g.secciones.size ? [...g.secciones].sort((a, b) => a - b).join(', ') : null, alias.join(' / ') || null];
});
for (let i = 0; i < filas.length; i += 150) {
  const p = [];
  const vals = filas.slice(i, i + 150).map((r) => `(${r.map((v) => { p.push(v); return `$${p.length}`; }).join(', ')})`).join(', ');
  await db.query(`INSERT INTO vialidad.colonias (nombre, sector, latitud, longitud, registros, fuente, tipo, cp, secciones, alias) VALUES ${vals}
    ON CONFLICT (nombre) DO UPDATE SET sector = EXCLUDED.sector, latitud = EXCLUDED.latitud, longitud = EXCLUDED.longitud, registros = EXCLUDED.registros,
      fuente = EXCLUDED.fuente, tipo = EXCLUDED.tipo, cp = EXCLUDED.cp, secciones = EXCLUDED.secciones, alias = EXCLUDED.alias`, p);
}
console.log('✓ vialidad.colonias:', filas.filter((f) => f[5] === 'oficial').length, 'oficiales +', filas.filter((f) => f[5] === 'ine').length, 'del INE +', filas.filter((f) => f[5] === 'historico').length, 'solo históricas');
await db.end();
fs.mkdirSync(path.dirname(SALIDA), { recursive: true });
fs.writeFileSync(SALIDA, JSON.stringify(cat));
for (const [k, v] of Object.entries(cat)) if (Array.isArray(v)) console.log(k.padEnd(20), v.length, v.slice(0, 6).join(' | '));
console.log('✓', path.relative(RAIZ, SALIDA), (fs.statSync(SALIDA).size / 1024).toFixed(0), 'KB');
