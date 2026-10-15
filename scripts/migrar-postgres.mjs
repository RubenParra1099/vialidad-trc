// Migra los CSV de "omega 2023" (una hoja del Excel por archivo) a PostgreSQL / Neon.
// Crea el esquema `vialidad` con una tabla por hoja. Es una recarga completa: cada corrida
// borra y vuelve a crear las tablas, así que se puede repetir cuando haya datos nuevos.
//
//   npm run db:migrar -- "C:/ruta/a/la/carpeta/Vialidad"        (usa DATABASE_URL del .env)
//   npm run db:revisar -- "C:/ruta/a/la/carpeta/Vialidad"       (solo revisa, no se conecta)
//
// Columnas: todo se guarda como texto tal cual viene en el CSV, excepto
//   fecha / hora                -> DATE / TIME (si todas las celdas se pueden leer)
//   georreferenciación          -> además se agregan latitud y longitud (double precision)
//   conteos, edad, año, grado   -> INTEGER / NUMERIC (si todas las celdas son números)
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { parse } from 'csv-parse/sync';

const SCHEMA = 'vialidad';
const ANIO = 2023; // año de los datos, para fechas capturadas sin año
const TABLAS = [
  { archivo: 'omega 2023.csv', tabla: 'accidentes_viales', hoja: 'accidentes viales' },
  { archivo: 'omega 2023 2.csv', tabla: 'eventos_apoyos', hoja: 'eventos y apoyos' },
  { archivo: 'omega 2023 3.csv', tabla: 'bitacora', hoja: 'bitacora' },
  { archivo: 'omega 2023 4.csv', tabla: 'vehiculos_corralon', hoja: 'vehiculos al corralon' },
  { archivo: 'omega 2023 5.csv', tabla: 'mal_estacionados', hoja: 'vehiculos mal estacionados' },
  { archivo: 'omega 2023 6.csv', tabla: 'detenidos', hoja: 'detenidos' },
];
const NUMERICAS = /^(total_|lesionado_|fallecido_|cantidad_|edad|ano(_\d+)?$|grado_etilico)/;

const args = process.argv.slice(2);
const soloRevisar = args.includes('--revisar');
const carpeta = args.find((a) => !a.startsWith('--'));
if (!carpeta) {
  console.error('Indica la carpeta con los CSV, p. ej.: npm run db:migrar -- "C:/.../Vialidad"');
  process.exit(1);
}

// "GEORREFERENCIACIÓN" -> "georreferenciacion", "AGENTE(S)" -> "agente_s", "N° DE REMISION" -> "n_de_remision"
function nombreColumna(h) {
  const s = h.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/ñ/gi, 'n').toLowerCase()
    .replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  return /^\d/.test(s) ? 'c_' + s : s || 'columna';
}
const vacio = (v) => v == null || String(v).trim() === '';
// D/M/AAAA; "23/3" (sin año) se toma como 2023
function aFecha(v) {
  const m = String(v).trim().match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{4}))?$/);
  if (!m) return undefined;
  const [d, mo, y] = [+m[1], +m[2], +(m[3] || ANIO)];
  const f = new Date(Date.UTC(y, mo - 1, d));
  if (f.getUTCMonth() !== mo - 1 || f.getUTCDate() !== d) return undefined;
  return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}
// "18:22", "18.22", "01;05", "7.3" (7:30, Excel quitó el cero) o fracción de día de Excel (0.1229…)
function aHora(v) {
  const s = String(v).trim();
  if (/^0\.\d{3,}$/.test(s)) { const m = Math.round(parseFloat(s) * 1440); return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}:00`; }
  const m = s.match(/^(\d{1,2})[:.;](\d{1,2})(?::(\d{2}))?$/);
  if (!m) return undefined;
  const min = m[2].length === 1 ? (s.includes(':') ? '0' + m[2] : m[2] + '0') : m[2];
  if (+m[1] > 23 || +min > 59) return undefined;
  return `${m[1].padStart(2, '0')}:${min}:${m[3] || '00'}`;
}
function aGeo(v) {
  const p = String(v).split(',').map((t) => parseFloat(t.trim()));
  return p.length >= 2 && p.every(Number.isFinite) ? p.slice(0, 2) : [null, null];
}
// "50 AÑOS" -> 50
const limpiaNum = (v) => String(v).trim().replace(/\s*A[ÑN]OS?$/i, '');
const aEntero = (v) => (/^(0|[1-9]\d{0,8})$/.test(limpiaNum(v)) ? parseInt(limpiaNum(v), 10) : undefined);
const aNumero = (v) => (/^(0|[1-9]\d*)(\.\d+)?$|^0?\.\d+$/.test(limpiaNum(v)) ? limpiaNum(v) : undefined);

function leerCsv(ruta) {
  const filas = parse(fs.readFileSync(ruta), { bom: true, relax_column_count: true, skip_empty_lines: true });
  const enc = filas.shift();
  // columnas sin encabezado (las comas sobrantes del Excel) se descartan si no traen datos
  const usar = enc.map((h, i) => (h.trim() ? true : filas.some((f) => !vacio(f[i]))));
  const vistos = {};
  const cols = [];
  enc.forEach((h, i) => {
    if (!usar[i]) return;
    let n = nombreColumna(h.trim() || `columna_${i + 1}`);
    if (vistos[n]) n = `${n}_${++vistos[n]}`; else vistos[n] = 1;
    cols.push({ i, original: h.trim(), nombre: n, tipo: 'text' });
  });
  const datos = filas.filter((f) => cols.some((c) => !vacio(f[c.i])));
  return { cols, datos };
}

// Decide el tipo de cada columna: se tipa si al menos el 90 % de las celdas se puede leer.
// Si alguna celda no se pudo leer, se agrega <columna>_texto con el valor original de todas las filas.
function tipar(cols, datos) {
  const extra = [];
  for (const c of cols) {
    const vals = datos.map((f) => f[c.i]).filter((v) => !vacio(v));
    if (!vals.length) continue;
    const prueba = (conv) => vals.filter((v) => conv(v) !== undefined).length;
    const opciones = c.nombre === 'fecha' ? [['date', aFecha]]
      : /^hora/.test(c.nombre) ? [['time', aHora]]
      : NUMERICAS.test(c.nombre) ? [['integer', aEntero], ['numeric', aNumero]] : [];
    for (const [tipo, conv] of opciones) {
      const ok = prueba(conv);
      if (ok < vals.length * 0.9) continue;
      c.tipo = tipo; c.conv = (v) => conv(v) ?? null;
      c.fallas = vals.length - ok;
      if (c.fallas) extra.push({ nombre: `${c.nombre}_texto`, tipo: 'text', texto: c });
      break;
    }
    if (/^geo/.test(c.nombre)) {
      extra.push({ nombre: 'latitud', tipo: 'double precision', de: c, k: 0 }, { nombre: 'longitud', tipo: 'double precision', de: c, k: 1 });
    }
  }
  return extra;
}

function valor(c, f) {
  const v = f[c.i];
  if (vacio(v)) return null;
  return c.conv ? c.conv(v) : String(v).trim();
}

async function main() {
  const plan = TABLAS.map((t) => {
    const ruta = path.join(carpeta, t.archivo);
    if (!fs.existsSync(ruta)) throw new Error(`No se encontró ${ruta}`);
    const { cols, datos } = leerCsv(ruta);
    const extra = tipar(cols, datos);
    return { ...t, cols, datos, extra };
  });

  for (const t of plan) {
    const tipos = t.cols.filter((c) => c.tipo !== 'text').map((c) => `${c.nombre}:${c.tipo}${c.fallas ? ` (${c.fallas} sin leer)` : ''}`);
    console.log(`${SCHEMA}.${t.tabla.padEnd(20)} ${String(t.datos.length).padStart(6)} filas · ${t.cols.length} columnas` +
      (tipos.length ? ` · ${tipos.join(', ')}` : '') + (t.extra.some((e) => e.de) ? ' · +latitud/longitud' : ''));
  }
  if (soloRevisar) return;

  if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el .env');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  try {
    await db.query('BEGIN');
    await db.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
    for (const t of plan) {
      const todas = [...t.cols, ...t.extra];
      await db.query(`DROP TABLE IF EXISTS ${SCHEMA}.${t.tabla}`);
      await db.query(`CREATE TABLE ${SCHEMA}.${t.tabla} (id integer PRIMARY KEY, ${todas.map((c) => `${c.nombre} ${c.tipo}`).join(', ')})`);
      await db.query(`COMMENT ON TABLE ${SCHEMA}.${t.tabla} IS ${pg.escapeLiteral(`Hoja "${t.hoja}" de omega 2023 (${t.archivo})`)}`);
      for (const e of t.extra.filter((x) => x.texto)) {
        await db.query(`COMMENT ON COLUMN ${SCHEMA}.${t.tabla}.${e.nombre} IS ${pg.escapeLiteral(`${e.texto.original} (texto original)`)}`);
      }
      for (const c of t.cols) {
        if (c.original) await db.query(`COMMENT ON COLUMN ${SCHEMA}.${t.tabla}.${c.nombre} IS ${pg.escapeLiteral(c.original)}`);
      }
      const nombres = ['id', ...todas.map((c) => c.nombre)];
      const lote = Math.max(1, Math.floor(60000 / nombres.length));
      for (let s = 0; s < t.datos.length; s += lote) {
        const parte = t.datos.slice(s, s + lote);
        const params = [];
        const filas = parte.map((f, j) => {
          const geo = {};
          const fila = [s + j + 1, ...t.cols.map((c) => valor(c, f)), ...t.extra.map((e) => (e.texto ? (vacio(f[e.texto.i]) ? null : String(f[e.texto.i]).trim()) : (geo[e.de.nombre] ??= aGeo(f[e.de.i]))[e.k]))];
          return `(${fila.map((v) => { params.push(v); return `$${params.length}`; }).join(', ')})`;
        });
        await db.query(`INSERT INTO ${SCHEMA}.${t.tabla} (${nombres.join(', ')}) VALUES ${filas.join(', ')}`, params);
      }
      if (t.cols.some((c) => c.nombre === 'fecha' && c.tipo === 'date')) {
        await db.query(`CREATE INDEX ON ${SCHEMA}.${t.tabla} (fecha)`);
      }
      console.log(`✓ ${SCHEMA}.${t.tabla}: ${t.datos.length} filas`);
    }
    await db.query('COMMIT');
    console.log('Migración completa.');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error('Error en la migración:', err.message || err);
  process.exit(1);
});
