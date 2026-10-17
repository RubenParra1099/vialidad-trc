// Usuarios de captura desde la terminal (para crear el primer administrador o si nadie puede entrar).
// Lo normal es administrarlos en la página: /captura/ → pestaña Usuarios (rol admin).
//
//   npm run usuarios -- listar
//   npm run usuarios -- crear <usuario> "<Nombre completo>" [capturista|admin]
//   npm run usuarios -- restablecer <usuario>     (nueva contraseña temporal y desbloqueo)
//   npm run usuarios -- activar <usuario> | desactivar <usuario>
import pg from 'pg';
import { TABLA_USUARIOS, ROLES, DDL_USUARIOS } from '../lib/incidencias.js';
import { cifrar, temporal } from '../lib/contrasenas.js';

const [accion, usuario, nombre, rol = 'capturista'] = process.argv.slice(2);
if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el .env');
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
await db.query(DDL_USUARIOS);
const u = String(usuario || '').trim().toLowerCase();
const aviso = (tmp) => console.log(`  Contraseña temporal: ${tmp}\n  (se pide cambiarla al iniciar sesión; compártela solo con esa persona)`);
try {
  if (accion === 'listar' || !accion) {
    const { rows } = await db.query(`SELECT usuario, nombre, rol, activo, debe_cambiar, ultimo_acceso FROM ${TABLA_USUARIOS} ORDER BY nombre`);
    if (!rows.length) console.log('No hay usuarios. Crea el primero con: npm run usuarios -- crear admin "Nombre" admin');
    for (const r of rows) console.log(`${r.usuario.padEnd(18)} ${r.rol.padEnd(11)} ${r.activo ? 'activo   ' : 'inactivo '} ${r.nombre}${r.debe_cambiar ? '  (contraseña temporal)' : ''}`);
  } else if (accion === 'crear') {
    if (!/^[a-z0-9._-]{3,40}$/.test(u) || !nombre) throw new Error('Uso: npm run usuarios -- crear <usuario> "<Nombre completo>" [capturista|admin]');
    if (!ROLES.includes(rol)) throw new Error(`Rol no válido: ${rol} (${ROLES.join(' o ')})`);
    const tmp = temporal();
    const { rows } = await db.query(`INSERT INTO ${TABLA_USUARIOS} (usuario, nombre, rol, contrasena, creado_por) VALUES ($1, $2, $3, $4, 'terminal')
      ON CONFLICT (usuario) DO NOTHING RETURNING usuario`, [u, nombre.trim().toUpperCase(), rol, await cifrar(tmp)]);
    if (!rows.length) throw new Error(`Ya existe el usuario ${u} (usa "restablecer" para darle otra contraseña)`);
    console.log(`✓ Usuario ${u} (${rol}) creado.`); aviso(tmp);
  } else if (accion === 'restablecer') {
    const tmp = temporal();
    const { rowCount } = await db.query(`UPDATE ${TABLA_USUARIOS} SET contrasena = $2, debe_cambiar = true, intentos_fallidos = 0, bloqueado_hasta = NULL, actualizado_en = now() WHERE usuario = $1`, [u, await cifrar(tmp)]);
    if (!rowCount) throw new Error(`No existe el usuario ${u}`);
    console.log(`✓ Contraseña de ${u} restablecida.`); aviso(tmp);
  } else if (accion === 'activar' || accion === 'desactivar') {
    const { rowCount } = await db.query(`UPDATE ${TABLA_USUARIOS} SET activo = $2, actualizado_en = now() WHERE usuario = $1`, [u, accion === 'activar']);
    if (!rowCount) throw new Error(`No existe el usuario ${u}`);
    console.log(`✓ ${u} ${accion === 'activar' ? 'activado' : 'desactivado'}.`);
  } else throw new Error('Acción no válida: listar, crear, restablecer, activar, desactivar');
} catch (e) {
  console.error('Error:', e.message);
  process.exitCode = 1;
} finally {
  await db.end();
}
