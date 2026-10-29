// Inventario de paks UE4.27 (v11, índice cifrado). Uso: node pakinv.js <dirPaks> <keyHex> <out.json>
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const [dir, keyHex, outPath] = process.argv.slice(2);
const key = Buffer.from(keyHex.replace(/^0x/, ''), 'hex');

function readDecrypted(fd, off, size) {
  const n = Math.ceil(size / 16) * 16;
  const b = Buffer.alloc(n);
  fs.readSync(fd, b, 0, n, off);
  const d = crypto.createDecipheriv('aes-256-ecb', key, null);
  d.setAutoPadding(false);
  return Buffer.concat([d.update(b), d.final()]);
}

class R {
  constructor(b) { this.b = b; this.p = 0; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  i64() { const v = Number(this.b.readBigInt64LE(this.p)); this.p += 8; return v; }
  skip(n) { this.p += n; }
  str() {
    const len = this.i32();
    if (len === 0) return '';
    if (len < 0) { const s = this.b.toString('utf16le', this.p, this.p - len * 2 - 2); this.p += -len * 2; return s; }
    const s = this.b.toString('latin1', this.p, this.p + len - 1); this.p += len; return s;
  }
}

// FPakEntry codificado (4.27)
function decodeEntry(b, off) {
  const flags = b.readUInt32LE(off); off += 4;
  if ((flags & 0x3f) === 0x3f) off += 4; // tamaño de bloque explícito
  const offset32 = (flags >>> 31) & 1, usize32 = (flags >>> 30) & 1, size32 = (flags >>> 29) & 1;
  const comp = (flags >>> 23) & 0x3f;
  const rd = (is32) => { const v = is32 ? b.readUInt32LE(off) : Number(b.readBigUInt64LE(off)); off += is32 ? 4 : 8; return v; };
  const offset = rd(offset32);
  const usize = rd(usize32);
  const size = comp ? rd(size32) : usize;
  return { offset, usize, size, comp };
}

const result = { paks: {}, byExt: {}, files: [] };
for (const name of fs.readdirSync(dir).filter(f => f.endsWith('.pak')).sort()) {
  const p = path.join(dir, name);
  const fd = fs.openSync(p, 'r');
  const sz = fs.fstatSync(fd).size;
  const foot = Buffer.alloc(221);
  fs.readSync(fd, foot, 0, 221, sz - 221);
  const encIndex = foot[16] === 1;
  const idxOff = Number(foot.readBigUInt64LE(25)), idxSize = Number(foot.readBigUInt64LE(33));
  if (idxSize === 0) { result.paks[name] = { files: 0 }; continue; }
  const read = (o, s) => encIndex ? readDecrypted(fd, o, s) : (() => { const b = Buffer.alloc(s); fs.readSync(fd, b, 0, s, o); return b; })();
  const r = new R(read(idxOff, idxSize));
  const mount = r.str();
  const num = r.i32();
  r.skip(8); // seed
  if (r.u32()) r.skip(8 + 8 + 20); // path hash index
  let fdiOff = 0, fdiSize = 0;
  if (r.u32()) { fdiOff = r.i64(); fdiSize = r.i64(); r.skip(20); }
  const encSize = r.i32();
  const enc = r.b.subarray(r.p, r.p + encSize);
  const d = new R(read(fdiOff, fdiSize));
  const ndirs = d.i32();
  let total = 0, count = 0;
  for (let i = 0; i < ndirs; i++) {
    const dname = d.str();
    const nf = d.i32();
    for (let j = 0; j < nf; j++) {
      const fname = d.str();
      const ei = d.i32();
      const e = ei >= 0 ? decodeEntry(enc, ei) : { usize: 0, size: 0, comp: 0 };
      const full = (mount + dname + fname).replace(/^(\.\.\/)+/, '');
      const ext = path.extname(fname).toLowerCase() || '(none)';
      const x = result.byExt[ext] || (result.byExt[ext] = { n: 0, size: 0, usize: 0 });
      x.n++; x.size += e.size; x.usize += e.usize;
      result.files.push([name, full, e.size, e.usize, e.offset]);
      total += e.size; count++;
    }
  }
  result.paks[name] = { mount, entries: num, files: count, sizeMB: Math.round(total / 1048576) };
  fs.closeSync(fd);
}
fs.writeFileSync(outPath, JSON.stringify(result));
const mb = v => (v / 1048576).toFixed(0).padStart(7);
console.log('ext            n   compMB  rawMB');
for (const [k, v] of Object.entries(result.byExt).sort((a, b) => b[1].size - a[1].size).slice(0, 15))
  console.log(k.padEnd(10), String(v.n).padStart(6), mb(v.size), mb(v.usize));
console.log('archivos:', result.files.length);
