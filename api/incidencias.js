// API de captura de incidencias (Vercel Function; en local la sirve scripts/dev.mjs).
//   GET  /api/incidencias?tipo=&q=&limit=   lista
//   GET  /api/incidencias?id=N              registro con sus participantes
//   POST /api/incidencias                   crea  { ...campos, participantes: [...] } -> { id, folio }
//   PUT  /api/incidencias?id=N              actualiza (reemplaza participantes)
// Si la colonia no está en vialidad.colonias, se agrega al guardar.
// Requiere sesión. Capturó / creado_por / actualizado_por los pone el servidor; un capturista solo edita sus registros.
import pg from 'pg';
import { exigirSesion } from '../lib/sesion.js';
import { TABLA, TABLA_PART, TIPOS, ESTADOS, COLUMNAS, COLUMNAS_PART, convertir, agregarColonia } from '../lib/incidencias.js';

let pool;
const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (err) => { console.error(err); return json({ error: err.message || String(err) }, err.status || 500); };
const bad = (msg) => Object.assign(new Error(msg), { status: 400 });

function filaDe(body) {
  const fila = {};
  for (const [c, t] of COLUMNAS) if (c in body) fila[c] = convertir(t, body[c]);
  if (fila.tipo !== undefined && !TIPOS[fila.tipo]) throw bad('Tipo de incidencia no válido');
  if (fila.estado != null && !ESTADOS.includes(fila.estado)) throw bad('Estado no válido');
  return fila;
}
function participantesDe(body) {
  return (Array.isArray(body.participantes) ? body.participantes : []).map((p, i) => {
    const f = { num: i + 1 };
    for (const [c, t] of COLUMNAS_PART) if (c !== 'num') f[c] = convertir(t, p[c]);
    return f;
  }).filter((f) => COLUMNAS_PART.some(([c]) => c !== 'num' && f[c] != null));
}
async function guardarParticipantes(cx, id, lista) {
  await cx.query(`DELETE FROM ${TABLA_PART} WHERE incidencia_id = $1`, [id]);
  for (const p of lista) {
    const cols = Object.keys(p);
    await cx.query(`INSERT INTO ${TABLA_PART} (incidencia_id, ${cols.join(', ')}) VALUES ($1, ${cols.map((_, i) => `$${i + 2}`).join(', ')})`, [id, ...cols.map((c) => p[c])]);
  }
}
async function enTransaccion(fn) {
  const cx = await db().connect();
  try { await cx.query('BEGIN'); const r = await fn(cx); await cx.query('COMMIT'); return r; }
  catch (e) { await cx.query('ROLLBACK').catch(() => {}); throw e; }
  finally { cx.release(); }
}
// fecha/hora como texto para que el formulario los reciba tal cual (sin zona horaria)
const SELECT = `SELECT *, to_char(fecha, 'YYYY-MM-DD') AS fecha, to_char(hora, 'HH24:MI') AS hora, to_char(hora_remision, 'HH24:MI') AS hora_remision FROM ${TABLA}`;

export async function GET(request) {
  const { sesion, error } = await exigirSesion(request);
  if (error) return error;
  try {
    const u = new URL(request.url);
    const id = u.searchParams.get('id');
    if (id) {
      const { rows } = await db().query(`${SELECT} WHERE id = $1`, [id]);
      if (!rows.length) return json({ error: 'No existe el registro' }, 404);
      const part = await db().query(`SELECT * FROM ${TABLA_PART} WHERE incidencia_id = $1 ORDER BY num`, [id]);
      return json({ ...rows[0], participantes: part.rows, editable: sesion.r === 'admin' || rows[0].creado_por === sesion.u });
    }
    const where = [], params = [];
    const tipo = u.searchParams.get('tipo');
    if (tipo) { params.push(tipo); where.push(`tipo = $${params.length}`); }
    const q = (u.searchParams.get('q') || '').trim();
    if (q) {
      params.push(`%${q}%`);
      const n = params.length;
      where.push(`(folio ILIKE $${n} OR ubicacion ILIKE $${n} OR entre_calles ILIKE $${n} OR referencia ILIKE $${n} OR colonia ILIKE $${n} OR agentes ILIKE $${n} OR unidades ILIKE $${n} OR veh_placas ILIKE $${n} OR conductor_nombre ILIKE $${n} OR razonamiento ILIKE $${n}
        OR EXISTS (SELECT 1 FROM ${TABLA_PART} p WHERE p.incidencia_id = i.id AND (p.nombre_completo ILIKE $${n} OR p.placas ILIKE $${n} OR p.telefono ILIKE $${n})))`);
    }
    const limit = Math.min(Math.max(parseInt(u.searchParams.get('limit'), 10) || 200, 1), 1000);
    const { rows } = await db().query(`SELECT i.id, i.folio, i.tipo, i.estado, to_char(i.fecha, 'YYYY-MM-DD') AS fecha, to_char(i.hora, 'HH24:MI') AS hora,
        i.ubicacion, i.colonia, i.sector, i.agentes, i.unidades, i.capturista, i.creado_por, i.creado_en, i.actualizado_en,
        coalesce(i.lesionado_masculino,0)+coalesce(i.lesionado_femenino,0) AS lesionados, coalesce(i.fallecido_masculino,0)+coalesce(i.fallecido_femenino,0) AS fallecidos,
        (SELECT count(*)::int FROM ${TABLA_PART} p WHERE p.incidencia_id = i.id) AS n_participantes
      FROM ${TABLA} i ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY i.creado_en DESC LIMIT ${limit}`, params);
    return json(rows);
  } catch (e) { return fail(e); }
}

export async function POST(request) {
  const { sesion, error } = await exigirSesion(request);
  if (error) return error;
  try {
    const body = await request.json();
    const fila = filaDe(body);
    fila.capturista = sesion.n;
    fila.creado_por = sesion.u;
    if (!fila.tipo) throw bad('Falta el tipo de incidencia');
    fila.estado ??= 'capturado';
    const part = participantesDe(body);
    const r = await enTransaccion(async (cx) => {
      const cols = Object.keys(fila);
      const { rows } = await cx.query(`INSERT INTO ${TABLA} (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id, folio`, cols.map((c) => fila[c]));
      await guardarParticipantes(cx, rows[0].id, part);
      if (fila.colonia) await agregarColonia(cx, { nombre: fila.colonia, sector: fila.sector, latitud: fila.latitud, longitud: fila.longitud });
      return rows[0];
    });
    return json(r, 201);
  } catch (e) { return fail(e); }
}

export async function PUT(request) {
  const { sesion, error } = await exigirSesion(request);
  if (error) return error;
  try {
    const id = new URL(request.url).searchParams.get('id');
    if (!id) throw bad('Falta id');
    const body = await request.json();
    const fila = filaDe(body);
    delete fila.capturista;
    fila.actualizado_por = sesion.u;
    const part = participantesDe(body);
    const r = await enTransaccion(async (cx) => {
      const { rows: [actual] } = await cx.query(`SELECT creado_por FROM ${TABLA} WHERE id = $1 FOR UPDATE`, [id]);
      if (!actual) throw Object.assign(new Error('No existe el registro'), { status: 404 });
      if (sesion.r !== 'admin' && actual.creado_por !== sesion.u) throw Object.assign(new Error('Solo puedes editar los registros que tú capturaste'), { status: 403 });
      const cols = Object.keys(fila);
      const { rows } = await cx.query(`UPDATE ${TABLA} SET ${cols.map((c, i) => `${c} = $${i + 2}`).concat('actualizado_en = now()').join(', ')} WHERE id = $1 RETURNING id, folio`, [id, ...cols.map((c) => fila[c])]);
      if (!rows.length) throw Object.assign(new Error('No existe el registro'), { status: 404 });
      if ('participantes' in body) await guardarParticipantes(cx, id, part);
      if (fila.colonia) await agregarColonia(cx, { nombre: fila.colonia, sector: fila.sector, latitud: fila.latitud, longitud: fila.longitud });
      return rows[0];
    });
    return json(r);
  } catch (e) { return fail(e); }
}
