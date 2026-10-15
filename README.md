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
