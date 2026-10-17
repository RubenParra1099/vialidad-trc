// Crea (o actualiza) las tablas de captura de incidencias en Neon:
//   vialidad.incidencias                 un registro por incidencia capturada
//   vialidad.incidencias_participantes   personas y vehículos involucrados (accidentes)
//   vialidad.usuarios                    usuarios de captura (alta y baja desde la pestaña Usuarios, rol admin)
//   vialidad.colonias                    catálogo de colonias (se llena con npm run captura:catalogos y al capturar)
//   vialidad.v_incidencias               vista para revisar en Neon Console con los involucrados resumidos
//
//   npm run db:incidencias
//
// No borra datos: crea lo que falte y agrega las columnas nuevas definidas en lib/incidencias.js.
import pg from 'pg';
import { SCHEMA, TABLA, TABLA_PART, TIPOS, ESTADOS, COLUMNAS, COLUMNAS_PART, DDL_COLONIAS, DDL_USUARIOS, TABLA_USUARIOS } from '../lib/incidencias.js';

if (!process.env.DATABASE_URL) throw new Error('Falta DATABASE_URL en el .env');
const lit = pg.escapeLiteral;
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
try {
  await db.query('BEGIN');
  await db.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA}`);
  await db.query(`CREATE SEQUENCE IF NOT EXISTS ${SCHEMA}.incidencias_folio_seq`);
  await db.query(`CREATE TABLE IF NOT EXISTS ${TABLA} (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    folio text NOT NULL UNIQUE DEFAULT ('VT-' || to_char(now() AT TIME ZONE 'America/Monterrey', 'YY') || '-' || lpad(nextval('${SCHEMA}.incidencias_folio_seq')::text, 6, '0')),
    creado_en timestamptz NOT NULL DEFAULT now(),
    actualizado_en timestamptz NOT NULL DEFAULT now())`);
  for (const [c, t, d] of COLUMNAS) {
    await db.query(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS ${c} ${t}`);
    await db.query(`COMMENT ON COLUMN ${TABLA}.${c} IS ${lit(d)}`);
  }
  await db.query(`ALTER TABLE ${TABLA} ALTER COLUMN tipo SET NOT NULL, ALTER COLUMN estado SET DEFAULT 'capturado'`);
  await db.query(`ALTER TABLE ${TABLA} DROP CONSTRAINT IF EXISTS incidencias_tipo_check, DROP CONSTRAINT IF EXISTS incidencias_estado_check`);
  await db.query(`ALTER TABLE ${TABLA} ADD CONSTRAINT incidencias_tipo_check CHECK (tipo IN (${Object.keys(TIPOS).map(lit).join(', ')})),
    ADD CONSTRAINT incidencias_estado_check CHECK (estado IN (${ESTADOS.map(lit).join(', ')}))`);
  await db.query(`COMMENT ON TABLE ${TABLA} IS 'Incidencias de vialidad capturadas en el módulo de captura (public/captura)'`);
  await db.query(`COMMENT ON COLUMN ${TABLA}.folio IS 'Folio de captura (VT-AA-000001)'`);
  await db.query(`CREATE INDEX IF NOT EXISTS incidencias_fecha_idx ON ${TABLA} (fecha)`);
  await db.query(`CREATE INDEX IF NOT EXISTS incidencias_tipo_idx ON ${TABLA} (tipo)`);
  // antes las entre calles se guardaban en referencia: se pasan a entre_calles (solo las que tienen ese formato)
  await db.query(`UPDATE ${TABLA} SET entre_calles = referencia, referencia = NULL WHERE entre_calles IS NULL AND referencia ~ '^(ENTRE|ESQ\.|CERCA DE) '`);

  await db.query(`CREATE TABLE IF NOT EXISTS ${TABLA_PART} (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    incidencia_id bigint NOT NULL REFERENCES ${TABLA} (id) ON DELETE CASCADE)`);
  for (const [c, t, d] of COLUMNAS_PART) {
    await db.query(`ALTER TABLE ${TABLA_PART} ADD COLUMN IF NOT EXISTS ${c} ${t}`);
    await db.query(`COMMENT ON COLUMN ${TABLA_PART}.${c} IS ${lit(d)}`);
  }
  await db.query(`COMMENT ON TABLE ${TABLA_PART} IS 'Personas y vehículos involucrados en cada incidencia'`);
  await db.query(`CREATE INDEX IF NOT EXISTS incidencias_part_inc_idx ON ${TABLA_PART} (incidencia_id)`);

  await db.query(DDL_COLONIAS);
  // usuarios de captura y quién creó / modificó cada incidencia (lo pone el servidor con la sesión)
  await db.query(DDL_USUARIOS);
  await db.query(`COMMENT ON TABLE ${TABLA_USUARIOS} IS 'Usuarios del módulo de captura. Alta, baja y contraseñas desde la pestaña Usuarios (rol admin); la contraseña se guarda cifrada (scrypt)'`);
  for (const [c, d] of [['usuario', 'Usuario para iniciar sesión (minúsculas, sin espacios)'], ['rol', 'capturista: captura y consulta · admin: además administra usuarios y edita cualquier registro'], ['contrasena', 'Contraseña cifrada (scrypt). No se puede escribir a mano'], ['activo', 'false = no puede iniciar sesión'], ['debe_cambiar', 'true = debe cambiar la contraseña temporal al entrar'], ['bloqueado_hasta', 'Bloqueo temporal tras 5 intentos fallidos']])
    await db.query(`COMMENT ON COLUMN ${TABLA_USUARIOS}.${c} IS ${lit(d)}`);
  await db.query(`ALTER TABLE ${TABLA} ADD COLUMN IF NOT EXISTS creado_por text, ADD COLUMN IF NOT EXISTS actualizado_por text`);
  await db.query(`COMMENT ON COLUMN ${TABLA}.creado_por IS 'Usuario que capturó el registro (sesión)'`);
  await db.query(`COMMENT ON COLUMN ${TABLA}.actualizado_por IS 'Último usuario que modificó el registro (sesión)'`);
  await db.query(`DROP VIEW IF EXISTS ${SCHEMA}.v_incidencias`);
  await db.query(`CREATE VIEW ${SCHEMA}.v_incidencias AS
    SELECT i.folio, i.tipo, i.estado, i.fecha, i.hora, i.ubicacion, i.colonia, i.sector, i.seccion, i.sector_mapa,
      coalesce(i.lesionado_masculino, 0) + coalesce(i.lesionado_femenino, 0) AS total_lesionados,
      coalesce(i.fallecido_masculino, 0) + coalesce(i.fallecido_femenino, 0) AS total_fallecidos,
      (SELECT count(*) FROM ${TABLA_PART} p WHERE p.incidencia_id = i.id) AS n_involucrados,
      (SELECT string_agg(concat_ws(' · ', p.nombre_completo, p.placas), ' / ' ORDER BY p.num) FROM ${TABLA_PART} p WHERE p.incidencia_id = i.id) AS involucrados,
      i.capturista, i.creado_en, i.id
    FROM ${TABLA} i ORDER BY i.creado_en DESC`);
  await db.query(`COMMENT ON VIEW ${SCHEMA}.v_incidencias IS 'Resumen de incidencias capturadas (para revisar en Neon Console)'`);
  await db.query('COMMIT');
  const { rows } = await db.query(`SELECT count(*)::int n FROM ${TABLA}`);
  console.log(`✓ ${TABLA} (${COLUMNAS.length + 4} columnas, ${rows[0].n} registros), ${TABLA_PART} y ${SCHEMA}.v_incidencias listos.`);
} catch (err) {
  await db.query('ROLLBACK').catch(() => {});
  console.error('Error:', err.message || err);
  process.exitCode = 1;
} finally {
  await db.end();
}
