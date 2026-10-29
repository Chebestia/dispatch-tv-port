// Convierte todos los .uasset de una carpeta a un único JSON { rutaRelativa: exports }.
// Uso: node dumpdir.js <carpeta> <salida.json>
const fs = require('fs');
const path = require('path');
const { parse } = require('./uprops');

const [dir, outPath] = process.argv.slice(2);
const out = {};
let errors = 0;
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.uasset')) {
      const key = path.relative(dir, p).replace(/\\/g, '/').replace(/\.uasset$/, '');
      try { out[key] = parse(p); } catch (e) { out[key] = { error: e.message }; errors++; }
    }
  }
})(dir);
fs.writeFileSync(outPath, JSON.stringify(out, null, 1));
console.log(Object.keys(out).length, 'assets,', errors, 'errores');
