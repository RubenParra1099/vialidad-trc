// Sesión de los usuarios de captura: cookie firmada con HMAC-SHA256 (SESSION_SECRET), sin estado en servidor.
// Usa Web Crypto, así funciona igual en el middleware (Edge) y en las funciones de api/ (Node).
//   contenido: { id, u: usuario, n: nombre, r: rol, c: debe cambiar contraseña, exp: vencimiento (ms) }
export const COOKIE = 'argos_sesion';
export const DURACION_H = 12; // un turno

const enc = new TextEncoder();
const b64u = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const deB64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

function secreto() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('Falta SESSION_SECRET (mínimo 32 caracteres)');
  return s;
}
const llave = (s) => crypto.subtle.importKey('raw', enc.encode(s), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

export async function firmar(datos) {
  const cuerpo = b64u(enc.encode(JSON.stringify({ ...datos, exp: Date.now() + DURACION_H * 3600e3 })));
  const firma = new Uint8Array(await crypto.subtle.sign('HMAC', await llave(secreto()), enc.encode(cuerpo)));
  return `${cuerpo}.${b64u(firma)}`;
}

export async function verificar(token) {
  try {
    const [cuerpo, firma] = String(token || '').split('.');
    if (!cuerpo || !firma) return null;
    const ok = await crypto.subtle.verify('HMAC', await llave(secreto()), deB64u(firma), enc.encode(cuerpo));
    if (!ok) return null;
    const d = JSON.parse(new TextDecoder().decode(deB64u(cuerpo)));
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}

export function leerCookie(request, nombre = COOKIE) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${nombre}=([^;]+)`));
  return m ? decodeURIComponent(m[1]) : null;
}
export const sesionDe = (request) => verificar(leerCookie(request));

export const cookieSesion = (token) => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${DURACION_H * 3600}`;
export const cookieSalir = () => `${COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;

// Para las funciones de api/: la sesión o una respuesta 401/403 lista para devolver
export async function exigirSesion(request, { rol } = {}) {
  const s = await sesionDe(request);
  if (!s) return { error: Response.json({ error: 'Sesión vencida: vuelve a iniciar sesión' }, { status: 401 }) };
  if (s.c) return { error: Response.json({ error: 'Debes cambiar tu contraseña antes de continuar' }, { status: 403 }) };
  if (rol && s.r !== rol) return { error: Response.json({ error: 'No tienes permiso para esta acción' }, { status: 403 }) };
  return { sesion: s };
}
