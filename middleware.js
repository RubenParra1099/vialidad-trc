// Protege todo el sitio con usuario y contraseña (autenticación básica HTTP).
// Configura BASIC_AUTH_USER y BASIC_AUTH_PASSWORD en Vercel → Settings → Environment Variables.
import { next } from '@vercel/functions';

export const config = { matcher: '/:path*' };

export default function middleware(request) {
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
    headers: { 'WWW-Authenticate': 'Basic realm="Omega TRC", charset="UTF-8"', 'Cache-Control': 'no-store' },
  });
}
