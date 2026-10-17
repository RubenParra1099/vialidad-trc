// Inicio de sesión del módulo de captura.
//   GET  /api/auth                                  -> { usuario, nombre, rol, cambiar } o 401
//   POST /api/auth { accion: 'entrar', usuario, contrasena }
//   POST /api/auth { accion: 'cambiar', actual, nueva }   (cambia la contraseña del usuario en sesión)
//   POST /api/auth { accion: 'salir' }
import pg from 'pg';
import { TABLA_USUARIOS } from '../lib/incidencias.js';
import { firmar, sesionDe, cookieSesion, cookieSalir } from '../lib/sesion.js';
import { cifrar, comprobar, validarNueva } from '../lib/contrasenas.js';

let pool;
const db = () => (pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 3 }));
const json = (data, status = 200, cookie) => {
  const headers = { 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  return Response.json(data, { status, headers });
};
const MAX_INTENTOS = 5, BLOQUEO_MIN = 15;
const perfil = (u) => ({ usuario: u.usuario, nombre: u.nombre, rol: u.rol, cambiar: u.debe_cambiar });
const token = (u) => firmar({ id: String(u.id), u: u.usuario, n: u.nombre, r: u.rol, c: u.debe_cambiar });

export async function GET(request) {
  const s = await sesionDe(request);
  if (!s) return json({ error: 'Sin sesión' }, 401);
  return json({ usuario: s.u, nombre: s.n, rol: s.r, cambiar: !!s.c });
}

export async function POST(request) {
  try {
    const b = await request.json().catch(() => ({}));
    if (b.accion === 'salir') return json({ ok: true }, 200, cookieSalir());

    if (b.accion === 'entrar') {
      const usuario = String(b.usuario || '').trim().toLowerCase();
      const { rows } = await db().query(`SELECT * FROM ${TABLA_USUARIOS} WHERE usuario = $1`, [usuario]);
      const u = rows[0];
      const fallo = () => new Promise((r) => setTimeout(() => r(json({ error: 'Usuario o contraseña incorrectos' }, 401)), 600));
      if (!u) return fallo();
      if (u.bloqueado_hasta && new Date(u.bloqueado_hasta) > new Date()) {
        const min = Math.ceil((new Date(u.bloqueado_hasta) - new Date()) / 60000);
        return json({ error: `Usuario bloqueado por intentos fallidos. Intenta en ${min} min o pide al administrador que lo desbloquee.` }, 423);
      }
      if (!(await comprobar(b.contrasena, u.contrasena))) {
        const n = u.intentos_fallidos + 1;
        await db().query(`UPDATE ${TABLA_USUARIOS} SET intentos_fallidos = $2, bloqueado_hasta = $3 WHERE id = $1`,
          [u.id, n >= MAX_INTENTOS ? 0 : n, n >= MAX_INTENTOS ? new Date(Date.now() + BLOQUEO_MIN * 60000) : null]);
        return fallo();
      }
      if (!u.activo) return json({ error: 'Tu usuario está desactivado. Pide al administrador que lo active.' }, 403);
      await db().query(`UPDATE ${TABLA_USUARIOS} SET intentos_fallidos = 0, bloqueado_hasta = NULL, ultimo_acceso = now() WHERE id = $1`, [u.id]);
      return json(perfil(u), 200, cookieSesion(await token(u)));
    }

    if (b.accion === 'cambiar') {
      const s = await sesionDe(request);
      if (!s) return json({ error: 'Sesión vencida: vuelve a iniciar sesión' }, 401);
      const { rows } = await db().query(`SELECT * FROM ${TABLA_USUARIOS} WHERE id = $1 AND activo`, [s.id]);
      const u = rows[0];
      if (!u || !(await comprobar(b.actual, u.contrasena))) return json({ error: 'La contraseña actual no es correcta' }, 400);
      const err = validarNueva(b.nueva);
      if (err) return json({ error: err }, 400);
      if (b.nueva === b.actual) return json({ error: 'La nueva contraseña debe ser distinta de la actual' }, 400);
      const r = await db().query(`UPDATE ${TABLA_USUARIOS} SET contrasena = $2, debe_cambiar = false, actualizado_en = now() WHERE id = $1 RETURNING *`, [u.id, await cifrar(b.nueva)]);
      return json(perfil(r.rows[0]), 200, cookieSesion(await token(r.rows[0])));
    }
    return json({ error: 'Acción no válida' }, 400);
  } catch (e) {
    console.error(e);
    return json({ error: e.message }, 500);
  }
}
