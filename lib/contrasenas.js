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
// contraseña temporal fácil de dictar (sin 0/O, 1/l)
export function temporal() {
  const A = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  return Array.from(crypto.randomBytes(10), (b) => A[b % A.length]).join('');
}
export function validarNueva(p) {
  if (String(p || '').length < 8) return 'La contraseña debe tener al menos 8 caracteres';
  if (!/[A-Za-z]/.test(p) || !/\d/.test(p)) return 'La contraseña debe tener letras y números';
  return null;
}
