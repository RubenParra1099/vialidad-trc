# Argos·Vialidad · Vialidad y Movilidad Urbana

Plataforma directiva de indicadores de la Dirección de Vialidad de Torreón (datos 2023): panel general y módulos de accidentes viales, eventos y apoyos, bitácora, vehículos al corralón, mal estacionados y detenidos.

> **Contiene datos personales** (nombres, domicilios, teléfonos, placas, series). El repositorio debe ser **privado** y el sitio queda protegido con usuario y contraseña.

## Estructura

```
public/
  index.html          Aplicación (HTML + CSS + JS)
  data/omega.json     Datos procesados del Excel
  data/red-vial.txt   Red vial de Torreón (© colaboradores de OpenStreetMap, ODbL)
middleware.js         Protección con usuario y contraseña
vercel.json           Configuración de Vercel
scripts/generar_datos.py   Regenera data/omega.json desde el Excel
```

## Publicar en Vercel

1. Crea un repositorio **privado** en GitHub y sube esta carpeta:
   ```bash
   git init
   git add .
   git commit -m "Plataforma Vialidad TRC"
   git branch -M main
   git remote add origin https://github.com/TU-ORG/omega-vialidad-trc.git
   git push -u origin main
   ```
2. En Vercel: **Add New → Project → Import** el repositorio. Framework Preset: **Other**. No cambies Build ni Output (lo toma de `vercel.json`).
3. Antes de desplegar, en **Environment Variables** agrega:
   - `BASIC_AUTH_USER` → el usuario de acceso
   - `BASIC_AUTH_PASSWORD` → una contraseña segura
4. **Deploy**. Al abrir el sitio, el navegador pedirá usuario y contraseña.

Cada `git push` a `main` vuelve a publicar automáticamente.

## Actualizar los datos

Con un Excel nuevo con las mismas hojas y columnas:

```bash
pip install pandas openpyxl numpy
python scripts/generar_datos.py "ruta/omega 2024.xlsx"
git add public/data/omega.json && git commit -m "Actualiza datos" && git push
```

El Excel no se sube al repositorio (`.gitignore` lo excluye).

## Base de datos (PostgreSQL / Neon)

Los CSV exportados del Excel (`omega 2023.csv` … `omega 2023 6.csv`, una hoja por archivo) se cargan en el esquema `vialidad`:

| Tabla | Hoja |
|---|---|
| `vialidad.accidentes_viales` | accidentes viales |
| `vialidad.eventos_apoyos` | eventos y apoyos |
| `vialidad.bitacora` | bitácora |
| `vialidad.vehiculos_corralon` | vehículos al corralón |
| `vialidad.mal_estacionados` | vehículos mal estacionados |
| `vialidad.detenidos` | detenidos |

Las columnas conservan el texto del CSV; `fecha` y `hora` se guardan como `date`/`time`, los conteos y edades como números, y la georreferenciación se separa además en `latitud`/`longitud`. Si alguna celda no se pudo convertir, el valor original queda en `<columna>_texto`. Cada columna lleva como comentario su encabezado original.

```bash
npm install
cp .env.example .env        # pega la cadena de conexión de Neon en DATABASE_URL
npm run db:revisar -- "ruta/a/la/carpeta/con/los/csv"   # solo revisa, no escribe
npm run db:migrar -- "ruta/a/la/carpeta/con/los/csv"    # borra y vuelve a crear las tablas
```

Para verlas en TablePlus: **Create a new connection → PostgreSQL → Import from URL** con la misma cadena de `DATABASE_URL`, y elige el esquema `vialidad`. En Neon Console están en **Tables** (selecciona el esquema `vialidad`).

La plataforma sigue leyendo `public/data/omega.json`; la base de datos es, por ahora, una copia consultable de los datos originales.

## Probar localmente

```bash
cd public && python -m http.server 8000
```
Abre http://localhost:8000 (en local no se pide contraseña).

## Notas

- Las ubicaciones de *eventos y apoyos* y *bitácora* se estiman a partir del domicilio; la ficha indica cuándo es aproximada.
- Librerías cargadas desde CDN: ECharts 5.5.1 (jsDelivr), Leaflet 1.9.4, Leaflet.markercluster 1.5.3 y Leaflet.heat 0.2.0 (cdnjs).

## Módulo de captura de incidencias

Formulario por etapas en `public/captura/` para registrar incidencias nuevas de los seis módulos (accidente, evento/apoyo, bitácora, mal estacionado, corralón, detenido). Guarda en Neon:

| Objeto | Contenido |
|---|---|
| `vialidad.incidencias` | un registro por incidencia (folio `VT-AA-000001`) |
| `vialidad.incidencias_participantes` | personas y vehículos involucrados (accidentes) |
| `vialidad.v_incidencias` | vista resumen para revisar en Neon Console |

```bash
npm install
npm run db:incidencias      # crea/actualiza las tablas (no borra datos)
npm run captura:catalogos   # regenera public/captura/catalogos.json desde los datos históricos
npm run dev                 # http://localhost:8000/captura/
```

Los campos se definen en `lib/incidencias.js` (columnas de la tabla) y en `STEPS` dentro de `public/captura/index.html` (formulario). La API es `api/incidencias.js` (Vercel Function; requiere `DATABASE_URL` en las variables de entorno de Vercel).

Al marcar un punto en el mapa, `api/geo.js` obtiene la calle y el número (Nominatim) y calcula las entre calles con las vías de OpenStreetMap alrededor del punto (las calles que cruzan la calle principal más cercanas a cada lado). Llena Ubicación, Referencias y Colonia si están vacíos; lo escrito a mano no se sobrescribe.

**Colonias.** `vialidad.colonias` es el catálogo vivo: las 302 colonias históricas (variantes de escritura unificadas, `npm run captura:catalogos`) más las que se agregan solas al guardar un registro con una colonia que no estaba (`fuente = 'captura'`). En el mapa, la colonia se toma de OpenStreetMap si coincide con el catálogo; si no, por votación de los registros cercanos (históricos y capturados). Se llena sola con confianza ≥ 60 % (≈ 81 % de acierto); si no, se ofrecen las opciones más probables.

**Catálogo oficial de colonias.** `node scripts/importar-colonias-oficiales.mjs "Colonias Torreon.xlsx" "codigos_postales_torreon.txt"` convierte las fuentes oficiales (Excel de colonias por sección electoral, pestaña TORREON, y la lista de códigos postales) a `scripts/datos/colonias_oficiales.json`. `npm run captura:catalogos` une esas colonias con las escritas en el histórico (`scripts/colonias-unificar.mjs`): cada escritura histórica queda como alias de su colonia oficial, y las que no tienen equivalente seguro se listan en `scripts/datos/colonias_revision.csv`. Las decisiones manuales se anotan en `scripts/datos/colonias_equivalencias.json` y se aplican al volver a correr `npm run captura:catalogos`.

## Usuarios de la captura

La captura (`/captura/`) pide **usuario y contraseña propios** de cada capturista; el panel de indicadores sigue con la contraseña general (`BASIC_AUTH_*`).

- Los usuarios viven en Neon, tabla **`vialidad.usuarios`** (la contraseña se guarda cifrada con scrypt: no se puede escribir a mano en Neon Console).
- **Dar de alta, activar, desactivar o restablecer contraseñas:** entra a `/captura/` con un usuario administrador → pestaña **Usuarios**. Al dar de alta se muestra una contraseña temporal; la persona la cambia en su primer acceso.
- Roles: **capturista** (captura y consulta; solo edita lo que capturó) y **admin** (además administra usuarios y edita cualquier registro).
- Cada incidencia guarda quién la capturó (`capturista`, `creado_por`) y quién la modificó (`actualizado_por`).
- Tras 10 contraseñas incorrectas el usuario se bloquea 5 minutos (o hasta que un admin le restablezca la contraseña). Las contraseñas temporales son minúsculas y números en grupos (`k7mq-4tzp-9wnr`).
- Desde la terminal (primer administrador o emergencias):
  ```bash
  npm run usuarios -- listar
  npm run usuarios -- crear jperez "Juan Pérez" capturista     # o admin
  npm run usuarios -- restablecer jperez
  npm run usuarios -- desactivar jperez
  ```
- Variables necesarias en Vercel: `DATABASE_URL`, `SESSION_SECRET` (llave para firmar la sesión, 32+ caracteres), `BASIC_AUTH_USER`, `BASIC_AUTH_PASSWORD`. En local, `SESSION_SECRET` va en `.env`.
