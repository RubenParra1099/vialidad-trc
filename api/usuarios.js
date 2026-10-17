// Administración de usuarios de captura (solo rol admin).
//   GET  /api/usuarios                              lista
//   POST /api/usuarios { usuario, nombre, rol }     alta -> { ..., temporal } (contraseña temporal, se cambia al entrar)
//   PUT  /api/usuarios?id=N { nombre, rol, activo, restablecer: true }
//        restablecer: genera otra contraseña temporal y desbloquea al usuario
import pg from 'pg';
import { TABLA_USUARIOS, ROLES } from '../lib/incidencias.js';
import { exigirSesion } from '../lib/sesion.js';
import { cifrar, temporal } from '../lib/contrasenas.js';

let pool;
const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
const CAMPOS = `id, usuario, nombre, rol, activo, debe_cambiar, ultimo_acceso, creado_por, creado_en,
  (bloqueado_hasta IS NOT NULL AND bloqueado_hasta > now()) AS bloqueado`;

export async function GET(request) {
  const { error } = await exigirSesion(request, { rol: 'admin' });
  if (error) return error;
  const { rows } = await db().query(`SELECT ${CAMPOS} FROM ${TABLA_USUARIOS} ORDER BY activo DESC, nombre`);
  return json(rows);
}

export async function POST(request) {
  const { sesion, error } = await exigirSesion(request, { rol: 'admin' });
  if (error) return error;
  try {
    const b = await request.json();
    const usuario = String(b.usuario || '').trim().toLowerCase();
    const nombre = String(b.nombre || '').trim().replace(/\s+/g, ' ').toUpperCase();
    const rol = ROLES.includes(b.rol) ? b.rol : 'capturista';
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) return json({ error: 'El usuario debe tener de 3 a 40 caracteres: letras minúsculas, números, punto, guion' }, 400);
    if (nombre.length < 3) return json({ error: 'Escribe el nombre completo' }, 400);
    const tmp = temporal();
    const { rows } = await db().query(`INSERT INTO ${TABLA_USUARIOS} (usuario, nombre, rol, contrasena, creado_por) VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (usuario) DO NOTHING RETURNING ${CAMPOS}`, [usuario, nombre, rol, await cifrar(tmp), sesion.u]);
    if (!rows.length) return json({ error: `Ya existe el usuario ${usuario}` }, 409);
    return json({ ...rows[0], temporal: tmp }, 201);
  } catch (e) { return json({ error: e.message }, 500); }
}

export async function PUT(request) {
  const { sesion, error } = await exigirSesion(request, { rol: 'admin' });
  if (error) return error;
  try {
    const id = new URL(request.url).searchParams.get('id');
    const b = await request.json();
    const { rows: [u] } = await db().query(`SELECT * FROM ${TABLA_USUARIOS} WHERE id = $1`, [id]);
    if (!u) return json({ error: 'No existe el usuario' }, 404);
    if (String(u.id) === String(sesion.id) && (b.activo === false || (b.rol && b.rol !== 'admin')))
      return json({ error: 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo' }, 400);
    const set = [], p = [id];
    const add = (sql, v) => { p.push(v); set.push(`${sql} = $${p.length}`); };
    if (b.nombre != null) add('nombre', String(b.nombre).trim().replace(/\s+/g, ' ').toUpperCase());
    if (b.rol != null && ROLES.includes(b.rol)) add('rol', b.rol);
    if (typeof b.activo === 'boolean') add('activo', b.activo);
    let tmp = null;
    if (b.restablecer) {
      tmp = temporal();
      add('contrasena', await cifrar(tmp)); add('debe_cambiar', true); add('intentos_fallidos', 0);
      set.push('bloqueado_hasta = NULL');
    }
    if (!set.length) return json({ error: 'Sin cambios' }, 400);
    const { rows } = await db().query(`UPDATE ${TABLA_USUARIOS} SET ${set.join(', ')}, actualizado_en = now() WHERE id = $1 RETURNING ${CAMPOS}`, p);
    return json({ ...rows[0], ...(tmp ? { temporal: tmp } : {}) });
  } catch (e) { return json({ error: e.message }, 500); }
}
