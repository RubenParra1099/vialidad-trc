// Definición de la tabla vialidad.incidencias (captura de incidencias de vialidad).
// La usan scripts/crear-tabla-incidencias.mjs (crea/actualiza la tabla) y api/incidencias.js (lee/escribe).
// Para agregar un campo: agrégalo aquí, corre `npm run db:incidencias` y agrégalo al formulario (public/captura).

export const SCHEMA = 'vialidad';
export const TABLA = `${SCHEMA}.incidencias`;
export const TABLA_PART = `${SCHEMA}.incidencias_participantes`;

export const TIPOS = {
  accidente: 'Accidente vial',
  evento_apoyo: 'Evento o apoyo',
  bitacora: 'Bitácora de unidad',
  mal_estacionado: 'Vehículo mal estacionado',
  corralon: 'Vehículo al corralón',
  detenido: 'Detenido',
};
export const ESTADOS = ['borrador', 'capturado', 'validado', 'cancelado'];

// [columna, tipo SQL, comentario]
export const COLUMNAS = [
  ['tipo', 'text', 'Tipo de incidencia: ' + Object.keys(TIPOS).join(', ')],
  ['estado', 'text', 'Estado del registro: ' + ESTADOS.join(', ')],
  // Reporte
  ['fecha', 'date', 'Fecha del hecho'],
  ['hora', 'time', 'Hora del hecho / reporte'],
  ['operador_en_turno', 'text', 'Operador en turno'],
  ['origen', 'text', 'Origen del reporte (911, TRANSITO, DSPM, SOBREVIGILANCIA)'],
  ['folio_911', 'text', 'Folio de llamada 911'],
  // Ubicación
  ['ubicacion', 'text', 'Ubicación / domicilio del hecho'],
  ['colonia', 'text', 'Colonia'],
  ['sector', 'text', 'Sector'],
  ['jurisdiccion', 'text', 'Jurisdicción'],
  ['entre_calles', 'text', 'Entre calles o esquina (detectadas en el mapa o escritas por el capturista)'],
  ['referencia', 'text', 'Referencias de la ubicación: texto libre del capturista (frente a, a un costado de, señas del lugar)'],
  ['latitud', 'double precision', 'Latitud (georreferenciación)'],
  ['longitud', 'double precision', 'Longitud (georreferenciación)'],
  ['seccion', 'text', 'Sección electoral donde cae el punto (polígonos del INE)'],
  // Hecho · accidente
  ['tipo_accidente', 'text', 'Tipo de accidente'],
  ['causa', 'text', 'Causa del accidente'],
  ['danos', 'text', 'Daños'],
  ['lesionado_masculino', 'integer', 'Lesionados hombres'],
  ['lesionado_femenino', 'integer', 'Lesionados mujeres'],
  ['fallecido_masculino', 'integer', 'Fallecidos hombres'],
  ['fallecido_femenino', 'integer', 'Fallecidos mujeres'],
  ['cantidad_vehiculos', 'integer', 'Cantidad de vehículos participantes'],
  // Hecho · evento y apoyo
  ['dependencia', 'text', 'Dependencia apoyada'],
  ['accion', 'text', 'Acción / servicio'],
  // Hecho · bitácora
  ['clave', 'text', 'Clave reportada por la unidad'],
  // Hecho · mal estacionado
  ['evento', 'text', 'Evento (vehículo mal estacionado)'],
  // Hecho · corralón y detenidos
  ['infraccion', 'text', 'Folio de infracción'],
  ['numerales', 'text', 'Numeral(es) del reglamento'],
  ['inventario', 'text', 'Folio de inventario'],
  ['grua', 'text', 'Grúa'],
  ['observaciones', 'text', 'Observaciones'],
  // Detenido
  ['conductor_nombre', 'text', 'Nombre del conductor detenido'],
  ['conductor_direccion', 'text', 'Dirección del conductor'],
  ['conductor_edad', 'integer', 'Edad del conductor'],
  ['tipo_ingreso', 'text', 'Tipo de ingreso'],
  ['grado_etilico', 'numeric', 'Grado etílico'],
  ['n_remision', 'text', 'Número de remisión'],
  ['hora_remision', 'time', 'Hora de remisión'],
  ['autoridad', 'text', 'Autoridad a la que se remite'],
  ['rnd', 'text', 'Registro Nacional de Detenidos'],
  // Vehículo (corralón y detenidos)
  ['veh_tipo', 'text', 'Vehículo: tipo / clasificación'],
  ['veh_marca', 'text', 'Vehículo: marca'],
  ['veh_submarca', 'text', 'Vehículo: submarca / línea'],
  ['veh_anio', 'integer', 'Vehículo: año / modelo'],
  ['veh_color', 'text', 'Vehículo: color'],
  ['veh_placas', 'text', 'Vehículo: placas'],
  ['veh_serie', 'text', 'Vehículo: número de serie (NIV)'],
  // Atención
  ['grupo', 'text', 'Grupo operativo'],
  ['unidades', 'text', 'Unidad(es)'],
  ['agentes', 'text', 'Agente(s)'],
  ['estatus', 'text', 'Estatus de atención (ATENDIDO / NO ATENDIDO)'],
  ['motivo_no_atendido', 'text', 'Motivo de no atención'],
  // Narrativa
  ['razonamiento', 'text', 'Razonamiento / narrativa de los hechos'],
  ['capturista', 'text', 'Persona que capturó'],
];

export const COLUMNAS_PART = [
  ['num', 'smallint', 'Número de participante'],
  ['rol', 'text', 'Rol: CONDUCTOR, PASAJERO, PEATON, CICLISTA'],
  ['condicion', 'text', 'Condición: ILESO, LESIONADO, FALLECIDO'],
  ['nombre_completo', 'text', 'Nombre completo'],
  ['domicilio', 'text', 'Domicilio'],
  ['telefono', 'text', 'Teléfono'],
  ['sexo', 'text', 'Sexo'],
  ['edad', 'integer', 'Edad'],
  ['servicio', 'text', 'Servicio (PARTICULAR / PUBLICO)'],
  ['tipo_servicio', 'text', 'Tipo de servicio público (TAXI, AUTOBUSES, ...)'],
  ['clasificacion', 'text', 'Clasificación del vehículo (SEDAN, MOTO, ...)'],
  ['marca', 'text', 'Marca'],
  ['linea', 'text', 'Tipo / línea del vehículo (VERSA, JETTA, ...)'],
  ['placas', 'text', 'Placas'],
  ['color', 'text', 'Color'],
];

// Convierte el valor recibido del formulario al tipo de la columna (null si viene vacío o no es válido)
export function convertir(tipo, v) {
  if (v == null || String(v).trim() === '') return null;
  const s = String(v).trim();
  switch (tipo) {
    case 'integer': case 'smallint': return /^-?\d{1,9}$/.test(s) ? parseInt(s, 10) : null;
    case 'numeric': case 'double precision': return Number.isFinite(+s) ? +s : null;
    case 'date': return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
    case 'time': return /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : null;
    default: return s;
  }
}

// Tabla vialidad.colonias: catálogo vivo de colonias (oficiales + solo históricas + agregadas al capturar)
export const TABLA_COLONIAS = `${SCHEMA}.colonias`;
export const DDL_COLONIAS = `CREATE TABLE IF NOT EXISTS ${TABLA_COLONIAS} (nombre text PRIMARY KEY, sector text,
  latitud double precision, longitud double precision, fuente text NOT NULL DEFAULT 'captura', registros integer,
  tipo text, cp text, secciones text, alias text, creado_en timestamptz NOT NULL DEFAULT now())`;
export const normalizaColonia = (s) => String(s || '').toUpperCase().replace(/\s+/g, ' ').trim();

// Agrega la colonia al catálogo si no existe (no cambia las que ya están). cx: cliente o pool de pg.
export async function agregarColonia(cx, { nombre, sector, latitud, longitud, fuente = 'captura' }) {
  const n = normalizaColonia(nombre);
  if (!n) return null;
  const { rows } = await cx.query(`INSERT INTO ${TABLA_COLONIAS} (nombre, sector, latitud, longitud, fuente) VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (nombre) DO NOTHING RETURNING nombre`, [n, convertir('text', sector), convertir('double precision', latitud), convertir('double precision', longitud), fuente === 'osm' ? 'osm' : 'captura']);
  return { nombre: n, nueva: rows.length > 0 };
}

// Usuarios de captura (tabla vialidad.usuarios). Las contraseñas se guardan cifradas con scrypt.
export const TABLA_USUARIOS = `${SCHEMA}.usuarios`;
export const ROLES = ['capturista', 'admin'];
export const DDL_USUARIOS = `CREATE TABLE IF NOT EXISTS ${TABLA_USUARIOS} (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  usuario text NOT NULL UNIQUE CHECK (usuario ~ '^[a-z0-9._-]{3,40}$'),
  nombre text NOT NULL,
  rol text NOT NULL DEFAULT 'capturista' CHECK (rol IN ('capturista', 'admin')),
  contrasena text NOT NULL,
  activo boolean NOT NULL DEFAULT true,
  debe_cambiar boolean NOT NULL DEFAULT true,
  intentos_fallidos integer NOT NULL DEFAULT 0,
  bloqueado_hasta timestamptz,
  ultimo_acceso timestamptz,
  creado_por text,
  creado_en timestamptz NOT NULL DEFAULT now(),
  actualizado_en timestamptz NOT NULL DEFAULT now())`;
