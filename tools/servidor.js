// Servidor de Dispatch TV en la PC, para la red local:
//   /app.apk          la app, para instalarla desde el televisor (con la app Downloader, por ejemplo)
//   /__pack           lista de archivos del paquete [[ruta, tamaño], …]; la app la usa para copiarse el paquete
//   /<ruta>           archivos del paquete (con Range), así también se puede jugar directo desde la PC
//   /__saves          partidas cuando se juega desde la PC (<carpeta>\saves)
// Uso: node servidor.js <carpetaDelPaquete> <app.apk> [puerto]
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PACK = path.resolve(process.argv[2] || '.');
const APK = process.argv[3] && path.resolve(process.argv[3]);
const PORT = +process.argv[4] || 8093;
const SAVES = path.join(PACK, '..', 'saves');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.ttf': 'font/ttf', '.mp4': 'video/mp4', '.apk': 'application/vnd.android.package-archive' };

let list = null;
function packList() {
  if (list) return list;
  list = [];
  (function walk(d) {
    for (const f of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, f.name);
      if (f.isDirectory()) walk(p);
      else if (!/\.tmp\.mp4$/.test(f.name)) list.push([path.relative(PACK, p).replace(/\\/g, '/'), fs.statSync(p).size]);
    }
  })(PACK);
  return list;
}

// partidas en la PC: saves.js copia acá cada clave dispatch-web-* del localStorage
const SAVE_KEY = /^dispatch-web[\w-]*$/;
function saves(req, res, url) {
  const key = url.slice('/__saves/'.length);
  if (req.method === 'GET' && url === '/__saves') {
    const all = {};
    if (fs.existsSync(SAVES)) for (const f of fs.readdirSync(SAVES)) if (f.endsWith('.json')) all[f.slice(0, -5)] = fs.readFileSync(path.join(SAVES, f), 'utf8');
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(all));
    return;
  }
  if (!SAVE_KEY.test(key)) { res.writeHead(400).end('clave'); return; }
  const file = path.join(SAVES, `${key}.json`);
  if (req.method === 'DELETE') { fs.rmSync(file, { force: true }); res.writeHead(200).end('ok'); return; }
  if (req.method !== 'PUT') { res.writeHead(405).end(); return; }
  const chunks = [];
  let size = 0;
  req.on('data', (c) => { size += c.length; if (size > 50e6) req.destroy(); else chunks.push(c); });
  req.on('end', () => {
    fs.mkdirSync(SAVES, { recursive: true });
    fs.writeFileSync(`${file}.tmp`, Buffer.concat(chunks));
    fs.renameSync(`${file}.tmp`, file);
    res.writeHead(200).end('ok');
  });
}

http.createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === '/__saves' || url.startsWith('/__saves/')) { saves(req, res, url); return; }
  if (url === '/__pack') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }).end(JSON.stringify(packList())); return; }
  const file = url === '/app.apk' ? APK : path.join(PACK, url === '/' ? 'index.html' : url);
  if (!file || (file !== APK && !file.startsWith(PACK + path.sep))) { res.writeHead(404).end('no existe'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('no existe'); return; }
    const type = TYPES[path.extname(file)] || 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
    if (range) {
      const start = range[1] ? +range[1] : 0;
      const end = range[2] ? +range[2] : st.size - 1;
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${st.size}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
      fs.createReadStream(file, { start, end }).pipe(res);
    } else {
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' });
      fs.createReadStream(file).pipe(res);
    }
  });
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(os.networkInterfaces()).flat().filter((a) => a.family === 'IPv4' && !a.internal).map((a) => a.address);
  console.log('\nDispatch TV: keep this window open while the TV copies the package.\n');
  for (const ip of ips) {
    console.log(`  App for the TV:            http://${ip}:${PORT}/app.apk`);
    console.log(`  Address for the app:       ${ip}:${PORT}\n`);
  }
});
