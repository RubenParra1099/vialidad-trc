// Catálogo vivo de colonias (tabla vialidad.colonias) para el formulario de captura.
//   GET  /api/colonias   -> { colonias: [{ nombre, sector, latitud, longitud, fuente }], puntos: [[lat, lng, colonia], ...] }
//                           colonias agregadas al capturar + puntos de las incidencias capturadas (mejoran la detección)
//   POST /api/colonias   { nombre, sector, latitud, longitud, fuente } -> agrega la colonia si no existe
import pg from 'pg';
import { agregarColonia } from '../lib/incidencias.js';
import { exigirSesion } from '../lib/sesion.js';

let pool;
const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });

export async function GET(request) {
  const { error } = await exigirSesion(request);
  if (error) return error;
  try {
    const [c, p] = await Promise.all([
      db().query(`SELECT nombre, sector, latitud, longitud, fuente FROM vialidad.colonias WHERE fuente IN ('captura', 'osm') ORDER BY nombre`),
      db().query(`SELECT latitud, longitud, colonia FROM vialidad.incidencias
        WHERE colonia IS NOT NULL AND latitud IS NOT NULL AND estado <> 'cancelado' ORDER BY creado_en DESC LIMIT 20000`),
    ]);
    return json({ colonias: c.rows, puntos: p.rows.map((r) => [r.latitud, r.longitud, r.colonia]) });
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}

export async function POST(request) {
  const { error } = await exigirSesion(request);
  if (error) return error;
  try {
    const b = await request.json();
    const r = await agregarColonia(db(), b);
    return json(r || { error: 'Falta el nombre' }, r ? 201 : 400);
  } catch (e) {
    return json({ error: e.message }, 500);
  }
}
