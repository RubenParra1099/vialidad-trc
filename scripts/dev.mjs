// Servidor local: sirve public/ y las funciones de api/ (como en Vercel).
//   npm run dev        ->  http://localhost:8000  (panel)  ·  http://localhost:8000/captura/  (captura)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(RAIZ, 'public');
const PORT = +process.env.PORT || 8000;
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.ico': 'image/x-icon' };

http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  try {
    if (url.pathname.startsWith('/api/')) {
      const archivo = path.join(RAIZ, 'api', path.basename(url.pathname) + '.js');
      if (!fs.existsSync(archivo)) { res.writeHead(404).end('No existe'); return; }
      const mod = await import(pathToFileURL(archivo).href);
      const fn = mod[req.method];
      if (!fn) { res.writeHead(405).end('Método no permitido'); return; }
      const partes = [];
      for await (const p of req) partes.push(p);
      const body = ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(partes);
      const r = await fn(new Request(url, { method: req.method, headers: req.headers, body }));
      res.writeHead(r.status, Object.fromEntries(r.headers));
      res.end(Buffer.from(await r.arrayBuffer()));
      console.log(req.method, url.pathname + url.search, r.status);
      return;
    }
    let ruta = path.join(PUBLIC, decodeURIComponent(url.pathname));
    if (!ruta.startsWith(PUBLIC)) { res.writeHead(403).end(); return; }
    if (fs.existsSync(ruta) && fs.statSync(ruta).isDirectory()) ruta = path.join(ruta, 'index.html');
    if (!fs.existsSync(ruta)) { res.writeHead(404).end('No encontrado'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(ruta)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    fs.createReadStream(ruta).pipe(res);
  } catch (e) {
    console.error(e);
    res.writeHead(500).end(String(e.message || e));
  }
}).listen(PORT, () => console.log(`Argos Vialidad en http://localhost:${PORT}  ·  captura: http://localhost:${PORT}/captura/`));
