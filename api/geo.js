// Geocodificación inversa para el formulario de captura (Vercel Function; en local la sirve scripts/dev.mjs).
//   GET /api/geo?lat=25.54&lng=-103.41
//   -> { calle, numero, ubicacion, entreCalles, esquina, colonia, cruces: [...] }
// La calle y el número vienen de Nominatim; las entre calles se calculan con las vías de OpenStreetMap
// alrededor del punto: se toman las calles que cruzan la calle principal (comparten un nodo con ella)
// y se eligen las intersecciones más cercanas a cada lado del punto.
const UA = 'argos-vialidad-trc/1.0 (captura de incidencias)';
const VIAS = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street)(_link)?$/;
const json = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'private, max-age=86400' } });

async function traer(url, ms = 7000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' }, signal: ctl.signal });
    if (!r.ok) throw new Error(`${new URL(url).host} respondió ${r.status}`);
    return r;
  } finally { clearTimeout(t); }
}
const base = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/^(avenida|av\.?|calle|c\.|boulevard|blvd\.?|bulevar|calzada|calz\.?|prolongacion|prol\.?|privada|priv\.?|cerrada|andador|callejon|paseo|periferico|carretera)\s+/, '')
  .replace(/\s+/g, ' ').trim();
const misma = (a, b) => { const x = base(a), y = base(b); return !!x && !!y && (x === y || (x.length > 4 && y.length > 4 && (x.includes(y) || y.includes(x)))); };

// Vías con nombre alrededor del punto (API de OpenStreetMap, ~250 m a cada lado)
async function vias(lat, lng) {
  const d = 0.0024;
  const r = await traer(`https://api.openstreetmap.org/api/0.6/map?bbox=${(lng - d).toFixed(6)},${(lat - d).toFixed(6)},${(lng + d).toFixed(6)},${(lat + d).toFixed(6)}`, 9000);
  const xml = await r.text();
  const nodos = new Map();
  for (const m of xml.matchAll(/<node id="(\d+)"[^>]*?lat="([-\d.]+)"[^>]*?lon="([-\d.]+)"/g)) nodos.set(m[1], [+m[2], +m[3]]);
  const out = [];
  for (const m of xml.matchAll(/<way id="\d+"[^>]*>([\s\S]*?)<\/way>/g)) {
    const hw = m[1].match(/<tag k="highway" v="([^"]+)"/);
    const nm = m[1].match(/<tag k="name" v="([^"]+)"/);
    if (!hw || !nm || !VIAS.test(hw[1])) continue;
    const refs = [...m[1].matchAll(/<nd ref="(\d+)"/g)].map((x) => x[1]).filter((id) => nodos.has(id));
    if (refs.length > 1) out.push({ nombre: nm[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#39;/g, "'").trim(), refs });
  }
  return { nodos, vias: out };
}

export async function GET(request) {
  const u = new URL(request.url);
  const lat = parseFloat(u.searchParams.get('lat')), lng = parseFloat(u.searchParams.get('lng'));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return json({ error: 'Parámetros lat y lng inválidos' }, 400);

  const [rev, osm] = await Promise.allSettled([
    traer(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`).then((r) => r.json()),
    vias(lat, lng),
  ]);
  const ad = rev.status === 'fulfilled' ? rev.value.address || {} : {};
  let calle = ad.road || ad.pedestrian || '';
  const numero = ad.house_number || '';
  const colonia = ad.neighbourhood || ad.suburb || ad.quarter || '';
  const res = { calle, numero, colonia, entreCalles: '', esquina: false, cruces: [] };
  if (osm.status !== 'fulfilled') { res.aviso = 'No se pudieron consultar las calles cercanas'; return fin(res); }

  // coordenadas locales en metros alrededor del punto
  const kx = 111320 * Math.cos((lat * Math.PI) / 180), ky = 110540;
  const xy = ([la, lo]) => [(lo - lng) * kx, (la - lat) * ky];
  const { nodos, vias: vs } = osm.value;
  const distSeg = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1; const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L)); return [Math.hypot(a[0] + t * dx - p[0], a[1] + t * dy - p[1]), [dx, dy]]; };

  // calle principal: la de Nominatim si existe en OSM; si no, la vía con nombre más cercana
  let mejor = null;
  for (const v of vs) for (let i = 1; i < v.refs.length; i++) {
    const [d, dir] = distSeg([0, 0], xy(nodos.get(v.refs[i - 1])), xy(nodos.get(v.refs[i])));
    const pref = calle && misma(v.nombre, calle) ? -1000 : 0; // preferir la calle de Nominatim
    if (!mejor || d + pref < mejor.score) mejor = { score: d + pref, d, dir, nombre: v.nombre };
  }
  if (!mejor) return fin(res);
  if ((calle && misma(mejor.nombre, calle)) || !calle || mejor.d < 40) calle = mejor.nombre;
  res.calle = calle;

  // nodos de la calle principal y dirección local de la calle en el punto
  const principal = vs.filter((v) => misma(v.nombre, calle));
  const nodosP = new Set(principal.flatMap((v) => v.refs));
  const L = Math.hypot(...mejor.dir) || 1, dir = [mejor.dir[0] / L, mejor.dir[1] / L];

  // intersecciones: vías con otro nombre que comparten nodo con la calle principal
  const cruces = new Map();
  for (const v of vs) {
    if (misma(v.nombre, calle)) continue;
    for (const id of v.refs) {
      if (!nodosP.has(id)) continue;
      const p = xy(nodos.get(id));
      const t = p[0] * dir[0] + p[1] * dir[1];   // posición a lo largo de la calle principal
      const off = Math.abs(p[0] * dir[1] - p[1] * dir[0]); // separación lateral (curvas)
      if (off > 80) continue;
      const prev = cruces.get(v.nombre);
      if (!prev || Math.abs(t) < Math.abs(prev.t)) cruces.set(v.nombre, { nombre: v.nombre, t: Math.round(t), d: Math.round(Math.hypot(...p)) });
    }
  }
  const lista = [...cruces.values()].sort((a, b) => Math.abs(a.t) - Math.abs(b.t));
  res.cruces = lista.slice(0, 6);
  const cerca = lista[0];
  if (cerca && cerca.d <= 22) { res.esquina = true; res.entreCalles = `ESQ. CON ${cerca.nombre}`; return fin(res); }
  const antes = lista.filter((c) => c.t < 0).sort((a, b) => b.t - a.t)[0];
  const despues = lista.filter((c) => c.t > 0).sort((a, b) => a.t - b.t)[0];
  if (antes && despues) res.entreCalles = `ENTRE ${antes.nombre} Y ${despues.nombre}`;
  else if (antes || despues) res.entreCalles = `CERCA DE ${(antes || despues).nombre}`;
  return fin(res);
}
function fin(r) {
  r.ubicacion = [r.calle, r.numero].filter(Boolean).join(' ');
  return json(r);
}
