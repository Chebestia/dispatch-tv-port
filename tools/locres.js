// Lector de .locres de UE4 (versiones 0 a 3) -> { "Namespace/Key": "texto traducido" }.
// Uso: node locres.js <archivo.locres> [filtro]
const fs = require('fs');

const MAGIC = '0e14747567 4a03fc4a15909dc3377f1b'.replace(/ /g, '');

function readLocres(path) {
  const b = fs.readFileSync(path);
  let p = 0;
  const u32 = () => { const v = b.readUInt32LE(p); p += 4; return v; };
  const i32 = () => { const v = b.readInt32LE(p); p += 4; return v; };
  const str = () => {
    const len = i32();
    if (len === 0) return '';
    if (len < 0) { const s = b.toString('utf16le', p, p - len * 2 - 2); p += -len * 2; return s; }
    const s = b.toString('latin1', p, p + len - 1); p += len; return s;
  };
  let version = 0;
  if (b.toString('hex', 0, 16) === MAGIC) { p = 16; version = b[p++]; }
  let strings = null;
  if (version >= 1) {
    const offset = Number(b.readBigInt64LE(p)); p += 8;
    const save = p;
    p = offset;
    const n = i32();
    strings = [];
    for (let i = 0; i < n; i++) { strings.push(str()); if (version >= 3) i32(); /* refcount */ }
    p = save;
  }
  if (version >= 2) u32(); // cantidad total de entradas
  const out = {};
  const nsCount = u32();
  for (let i = 0; i < nsCount; i++) {
    if (version >= 2) u32(); // hash
    const ns = str();
    const keys = u32();
    for (let k = 0; k < keys; k++) {
      if (version >= 2) u32();
      const key = str();
      u32(); // hash del texto fuente
      out[`${ns}/${key}`] = version >= 1 ? strings[i32()] : str();
    }
  }
  return out;
}

module.exports = { readLocres };

if (require.main === module) {
  const t = readLocres(process.argv[2]);
  const filter = process.argv[3];
  const entries = Object.entries(t).filter(([k]) => !filter || k.includes(filter));
  console.log(Object.keys(t).length, 'textos');
  for (const [k, v] of entries.slice(0, 10)) console.log(k, '=>', v);
}
