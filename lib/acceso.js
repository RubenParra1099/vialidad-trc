// Reglas de acceso del módulo de captura (las usa middleware.js en Vercel y scripts/dev.mjs en local).
//   'libre'   -> pasa (página de inicio de sesión, /api/auth, o sesión válida)
//   Response  -> se devuelve tal cual (redirige al inicio de sesión o 401)
//   null      -> no es del módulo de captura (lo protege la autenticación básica del panel)
import { sesionDe } from './sesion.js';

const PUBLICAS = ['/captura/login.html', '/api/auth'];
const CAPTURA = /^\/captura(\/|$)|^\/api\/(incidencias|colonias|geo|usuarios)(\/|$|\?)/;
// archivos que la página de inicio de sesión necesita
const RECURSOS_LOGIN = /^\/(argos_logo\.svg|favicon\.ico)$/;

export async function reglaCaptura(request) {
  const url = new URL(request.url);
  const p = url.pathname;
  if (PUBLICAS.includes(p) || RECURSOS_LOGIN.test(p)) return 'libre';
  if (!CAPTURA.test(p)) return null;
  const s = await sesionDe(request).catch(() => null);
  if (s) return 'libre';
  if (p.startsWith('/api/')) {
    return Response.json({ error: 'Sesión vencida: vuelve a iniciar sesión' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });
  }
  // páginas y archivos de /captura: al inicio de sesión, regresando después a donde iba
  const destino = p.endsWith('.json') ? '/captura/' : p + url.search;
  return Response.redirect(new URL(`/captura/login.html?next=${encodeURIComponent(destino)}`, url), 302);
}
