// Catálogo unificado de colonias: une las oficiales (scripts/datos/colonias_oficiales.json: Excel por sección
// electoral + códigos postales) con las escritas en los registros históricos de vialidad (omega.json).
// Cada escritura histórica queda como alias de su colonia oficial. Las que no tienen equivalente seguro
// se conservan como colonia propia (fuente "historico") y se listan en scripts/datos/colonias_revision.csv.
// Las decisiones manuales van en scripts/datos/colonias_equivalencias.json:
//   { "VILLA CALIFORNIA": "NUEVA VILLAS CALIFORNIA",   <- la histórica es esa oficial
//     "MONTERREAL": "" }                              <- es una colonia propia (no está en las oficiales)

// Clave para comparar escrituras. ¡Mantener igual que claveColonia() en public/captura/index.html!
export function claveColonia(s) {
  let t = String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase()
    .replace(/\(.*?\)/g, ' ').replace(/[^A-Z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  t = t.replace(/\bAMPL?\b/g, 'AMPLIACION').replace(/\bCD\b/g, 'CIUDAD').replace(/\bGRAL\b/g, 'GENERAL').replace(/\bPROF\b/g, 'PROFESOR')
    .replace(/\bRES\b/g, 'RESIDENCIAL').replace(/\bOTE\b/g, 'ORIENTE').replace(/\bPTE\b/g, 'PONIENTE').replace(/\bNTE\b/g, 'NORTE')
    .replace(/\bEX ?HDA\b|\bEXHACIENDA\b/g, 'EX HACIENDA').replace(/\bHDA\b/g, 'HACIENDA').replace(/\b2DA\b/g, 'SEGUNDA').replace(/\b1RA\b/g, 'PRIMERA')
    .replace(/\bFOVISSTE\b/g, 'FOVISSSTE').replace(/\b(IV|V|III|II|I)$/, (r) => ({ I: '1', II: '2', III: '3', IV: '4', V: '5' })[r])
    .replace(/\bZ IND\b/g, 'ZONA INDUSTRIAL').replace(/\bP IND\b/g, 'PARQUE INDUSTRIAL').replace(/\bRDCIAL\b/g, 'RESIDENCIAL').replace(/\bSECC?\b/g, 'SECCION');
  const ejido = /^(EJ|EJIDO)\s/.test(t);
  t = t.replace(/^(EJ|EJIDO|COL|COLONIA|FRACC|FRACCIONAMIENTO)\s+/, '').replace(/\bRESIDENCIAL\b/g, ' ')
    .replace(/\b(LA|LAS|LOS|EL|DE|DEL|Y)\b/g, ' ').replace(/\s+/g, ' ').trim();
  return t ? (ejido ? 'EJ:' : '') + t : '';
}

// Colonias oficiales que son la misma con otro nombre: [nombre a mostrar, ...escrituras]
const MISMAS = [
  ['CENTRO', 'ZONA CENTRO', 'TORREON CENTRO', 'TORREÓN CENTRO', 'CENTRO'],
];
const PREFIJO = { EJIDO: 'EJIDO ', 'ZONA INDUSTRIAL': 'ZONA INDUSTRIAL ', 'PARQUE INDUSTRIAL': 'PARQUE INDUSTRIAL ', RESIDENCIAL: 'RESIDENCIAL ', SECCION: 'SECCION ' };
const tieneAcento = (s) => /[ÁÉÍÓÚÑÜ]/.test(s);

export function unificar({ oficiales, equivalencias = {}, historico }) {
  // 1) colonias oficiales agrupadas por clave (Excel y CP de la misma colonia se juntan)
  const porClave = new Map();
  const manual = new Map();
  for (const [mostrar, ...esc] of MISMAS) for (const e of esc) manual.set(claveColonia(e), mostrar);
  for (const o of oficiales) {
    const ej = o.tipo === 'EJIDO';
    const base = (PREFIJO[o.tipo] && !o.nombre.startsWith(PREFIJO[o.tipo].trim()) && !(o.tipo !== 'EJIDO' && /INDUSTRIAL/.test(o.nombre)) ? PREFIJO[o.tipo] : '') + o.nombre;
    let k = claveColonia(ej ? 'EJ ' + o.nombre : base);
    if (manual.has(k)) k = claveColonia(manual.get(k));
    const g = porClave.get(k) || { clave: k, nombres: [], tipos: new Set(), cp: new Set(), secciones: new Set(), fuentes: new Set(), alias: new Set() };
    g.nombres.push(manual.get(k) || base);
    g.tipos.add(o.tipo || 'COLONIA');
    o.cp.forEach((c) => g.cp.add(c)); o.secciones.forEach((s) => g.secciones.add(s)); o.fuentes.forEach((f) => g.fuentes.add(f));
    g.alias.add(o.escrito.toUpperCase()); g.alias.add(base.toUpperCase());
    porClave.set(k, g);
  }
  for (const g of porClave.values()) {
    // nombre a mostrar: el manual, o el que trae acentos (CP), o el del Excel
    g.nombre = (manual.get(g.clave) || g.nombres.find(tieneAcento) || g.nombres[0]).toUpperCase();
  }
  const oficialPorNombre = new Map([...porClave.values()].map((g) => [g.nombre, g]));

  // 2) escrituras históricas -> colonia oficial (por clave o por equivalencia manual)
  const asignacion = new Map(); // escritura histórica -> nombre final
  const propias = new Map();    // claves históricas sin oficial -> nombre propio
  const revision = [];
  for (const [esc, n] of historico) {
    let destino = null;
    if (esc in equivalencias) destino = equivalencias[esc] ? equivalencias[esc].toUpperCase() : null;
    else {
      const k = claveColonia(esc);
      // sin prefijo y solo existe como ejido oficial ("EL TAJITO" -> "EJIDO EL TAJITO")
      destino = (porClave.get(k) || (!k.startsWith('EJ:') && porClave.get('EJ:' + k)))?.nombre || null;
    }
    if (destino && oficialPorNombre.has(destino)) { asignacion.set(esc, destino); oficialPorNombre.get(destino).alias.add(esc); continue; }
    // sin oficial: se agrupan variantes históricas entre sí y se conserva la escritura más frecuente;
    // una equivalencia a un nombre no oficial ("MONTEREAL" -> "MONTERREAL") une ambas en esa colonia propia
    const k = 'H:' + claveColonia(destino || esc);
    const p = propias.get(k) || { escrituras: [], fijo: destino || null };
    if (destino) p.fijo = destino;
    p.escrituras.push([esc, n]);
    propias.set(k, p);
    if (!(esc in equivalencias)) revision.push({ esc, n, sugerencias: parecidas(esc, porClave) });
  }
  for (const p of propias.values()) {
    p.escrituras.sort((a, b) => b[1] - a[1]);
    p.nombre = p.fijo || p.escrituras[0][0];
    for (const [e] of p.escrituras) asignacion.set(e, p.nombre);
  }
  return { porClave, oficialPorNombre, propias, asignacion, revision: revision.sort((a, b) => b.n - a.n) };
}

// colonias oficiales con nombre parecido (para la revisión manual)
function parecidas(esc, porClave) {
  const tok = (s) => new Set(claveColonia(s).replace(/^EJ:/, '').split(' ').filter((w) => w.length > 2));
  const a = tok(esc);
  if (!a.size) return [];
  const r = [];
  for (const g of porClave.values()) {
    const b = tok(g.nombre);
    let c = 0; for (const w of a) if (b.has(w)) c++;
    if (!c) continue;
    const score = c / (a.size + b.size - c) + (c === a.size || c === b.size ? 0.25 : 0);
    if (score >= 0.45) r.push([g.nombre, +score.toFixed(2)]);
  }
  return r.sort((x, y) => y[1] - x[1]).slice(0, 3);
}
