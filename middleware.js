// Protección del sitio:
//  · Módulo de captura (/captura y sus APIs): usuario y contraseña propios de cada capturista (vialidad.usuarios),
//    con sesión en cookie firmada (lib/sesion.js). La página de inicio de sesión y /api/auth son públicas.
//  · Todo lo demás (panel de indicadores): autenticación básica HTTP con BASIC_AUTH_USER / BASIC_AUTH_PASSWORD.
// Variables en Vercel → Settings → Environment Variables: BASIC_AUTH_USER, BASIC_AUTH_PASSWORD, SESSION_SECRET, DATABASE_URL.
import { next } from '@vercel/functions';
import { reglaCaptura } from './lib/acceso.js';

export const config = { matcher: '/:path*' };

export default async function middleware(request) {
  const regla = await reglaCaptura(request);
  if (regla === 'libre') return next({ headers: { 'Cache-Control': 'private, no-store' } });
  if (regla instanceof Response) return regla;

  const user = process.env.BASIC_AUTH_USER;
  const pass = process.env.BASIC_AUTH_PASSWORD;
  if (!user || !pass) {
    return new Response('Falta configurar BASIC_AUTH_USER y BASIC_AUTH_PASSWORD en Vercel.', { status: 503 });
  }
  const header = request.headers.get('authorization') || '';
  const [scheme, encoded] = header.split(' ');
  if (scheme === 'Basic' && encoded) {
    try {
      const decoded = atob(encoded);
      const i = decoded.indexOf(':');
      if (i > -1 && decoded.slice(0, i) === user && decoded.slice(i + 1) === pass) {
        return next({ headers: { 'Cache-Control': 'private, no-store' } });
      }
    } catch (e) { /* encabezado inválido */ }
  }
  return new Response('Acceso restringido a personal autorizado.', {
    status: 401,
    headers: { 'WWW-Authenticate': 'Basic realm="Argos Vialidad", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
