// Cifrado de contraseñas con scrypt (Node). Formato guardado: scrypt$N$sal$hash (base64).
import crypto from 'node:crypto';

const N = 16384, LARGO = 64;
const scrypt = (p, sal) => new Promise((ok, mal) => crypto.scrypt(p, sal, LARGO, { N, r: 8, p: 1 }, (e, k) => (e ? mal(e) : ok(k))));

export async function cifrar(contrasena) {
  const sal = crypto.randomBytes(16);
  return `scrypt$${N}$${sal.toString('base64')}$${(await scrypt(contrasena, sal)).toString('base64')}`;
}
export async function comprobar(contrasena, guardada) {
  const [alg, n, sal, hash] = String(guardada || '').split('$');
  if (alg !== 'scrypt' || +n !== N || !sal || !hash) return false;
  const k = await scrypt(String(contrasena), Buffer.from(sal, 'base64'));
  const h = Buffer.from(hash, 'base64');
  return h.length === k.length && crypto.timingSafeEqual(h, k);
}
// contraseña temporal fácil de dictar y teclear: minúsculas y números sin 0/o, 1/l/i, en grupos (k7mq-4tzp-9wnr)
export function temporal() {
  const A = 'abcdefghjkmnpqrstuvwxyz23456789';
  const c = Array.from(crypto.randomBytes(12), (b) => A[b % A.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}
// variantes aceptadas de lo que escribió la persona: tal cual, sin espacios ni comillas al inicio/final
// (al copiar y pegar), y en minúsculas si es una contraseña temporal (las temporales solo tienen minúsculas)
export function variantes(p, esTemporal) {
  const s = String(p ?? '');
  const limpia = s.trim().replace(/^[`'"“”‘’«»]+|[`'"“”‘’«»]+$/g, '').trim();
  const v = [s, limpia];
  if (esTemporal) v.push(limpia.toLowerCase(), limpia.toLowerCase().replace(/\s+/g, ''));
  return [...new Set(v)].filter(Boolean);
}
export function validarNueva(p) {
  if (String(p || '').length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'La contraseña debe tener letras y números';
  return null;
}
