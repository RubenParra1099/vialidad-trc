# Omega.TRC · Vialidad y Movilidad Urbana

Plataforma directiva de indicadores de la Dirección de Vialidad de Torreón (datos 2023): panel general, mapa georreferenciado y módulos de accidentes viales, eventos y apoyos, bitácora, vehículos al corralón, mal estacionados y detenidos.

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
   git commit -m "Plataforma Omega TRC"
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

## Probar localmente

```bash
cd public && python -m http.server 8000
```
Abre http://localhost:8000 (en local no se pide contraseña).

## Notas

- Las ubicaciones de *eventos y apoyos* y *bitácora* se estiman a partir del domicilio; la ficha indica cuándo es aproximada.
- Librerías cargadas desde CDN: ECharts 5.5.1 (jsDelivr), Leaflet 1.9.4, Leaflet.markercluster 1.5.3 y Leaflet.heat 0.2.0 (cdnjs).
