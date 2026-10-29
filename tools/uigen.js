// Genera web/data/ui/<WBP>.json para los widgets de menú y todos los widgets de usuario que usan (recursivo),
// más work/ui-assets.txt (texturas y materiales de los pinceles) y work/ui-tables.txt (String Tables usadas).
// Uso: node tools/uigen.js [raíz /Game/... ...]
const fs = require('fs');
const path = require('path');
const { tree } = require('./umg');

const { ROOT } = require('./env');
const CONTENT = path.join(ROOT, 'work', 'extract', 'Dispatch', 'Content');
const OUT = path.join(ROOT, 'web', 'data', 'ui');
const file = (pkg) => path.join(CONTENT, pkg.replace(/^\/Game\//, '').replace(/\//g, path.sep) + '.uasset');

const roots = process.argv.slice(2);
if (!roots.length) {
  // todos los WBP de Shared/Menu (menú principal, pausa, opciones, guardado, episodios, estadísticas, créditos)
  const walk = (d) => fs.readdirSync(d).forEach((f) => {
    const p = path.join(d, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (/^WBP_.*\.uasset$/.test(f)) roots.push('/Game/' + path.relative(CONTENT, p).replace(/\\/g, '/').replace(/\.uasset$/, ''));
  });
  walk(path.join(CONTENT, 'Shared', 'Menu'));
}

fs.mkdirSync(OUT, { recursive: true });
const done = new Set(), queue = [...roots], assets = new Set(), tables = new Set(), missing = new Set();
const scan = (o) => {
  if (!o || typeof o !== 'object') return;
  if (Array.isArray(o)) return o.forEach(scan);
  for (const [k, v] of Object.entries(o)) {
    if (typeof v === 'string' && /^\/Game\/.*\.(T_|MI_|M_|Mat|TX_)/.test(v) && /Brush|ResourceObject|Image|Texture|Material/.test(k)) assets.add(v.replace(/\.[^/]*$/, ''));
    else if (k === 'ResourceObject' && typeof v === 'string' && v.startsWith('/Game/')) assets.add(v.replace(/\.[^/]*$/, ''));
    else if (k === 'table' && typeof v === 'string') tables.add(v.replace(/\.[^/]*$/, ''));
    else if (k === 'widget' && typeof v === 'string' && !done.has(v)) queue.push(v);
    else scan(v);
  }
};
while (queue.length) {
  const pkg = queue.shift();
  if (done.has(pkg)) continue;
  done.add(pkg);
  const f = file(pkg);
  if (!fs.existsSync(f)) { missing.add(pkg); continue; }
  try {
    const t = tree(f);
    t.path = pkg;
    scan(t);
    fs.writeFileSync(path.join(OUT, path.basename(pkg) + '.json'), JSON.stringify(t));
  } catch (e) { console.error(pkg, e.message); }
}
fs.writeFileSync(path.join(ROOT, 'work', 'ui-assets.txt'), [...assets].sort().join('\n'));
fs.writeFileSync(path.join(ROOT, 'work', 'ui-tables.txt'), [...tables].sort().join('\n'));
console.log(`${done.size} widgets, ${assets.size} texturas/materiales, ${tables.size} String Tables, ${missing.size} sin extraer`);
if (missing.size) console.log('faltan:\n' + [...missing].join('\n'));
