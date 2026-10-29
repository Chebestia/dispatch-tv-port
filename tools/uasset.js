// Lector mínimo de .uasset de UE4.27 cocinado: resumen, nombres, imports y exports.
const fs = require('fs');

class R {
  constructor(b, p = 0) { this.b = b; this.p = p; }
  i32() { const v = this.b.readInt32LE(this.p); this.p += 4; return v; }
  u32() { const v = this.b.readUInt32LE(this.p); this.p += 4; return v; }
  i64() { const v = Number(this.b.readBigInt64LE(this.p)); this.p += 8; return v; }
  u8() { return this.b[this.p++]; }
  skip(n) { this.p += n; }
  guid() { const g = this.b.toString('hex', this.p, this.p + 16); this.p += 16; return g; }
  str() {
    const len = this.i32();
    if (len === 0) return '';
    if (len < 0) { const s = this.b.toString('utf16le', this.p, this.p - len * 2 - 2); this.p += -len * 2; return s; }
    const s = this.b.toString('latin1', this.p, this.p + len - 1); this.p += len; return s;
  }
}

function readAsset(path) {
  const b = fs.readFileSync(path);
  const r = new R(b);
  const s = {};
  if (r.u32() !== 0x9e2a83c1) throw new Error('no es un uasset');
  s.legacyVersion = r.i32();
  if (s.legacyVersion !== -4) r.i32(); // UE3 version
  s.fileVersionUE4 = r.i32();
  s.fileVersionLicensee = r.i32();
  const ncv = r.i32();
  r.skip(ncv * 20); // custom versions
  s.totalHeaderSize = r.i32();
  s.folderName = r.str();
  s.packageFlags = r.u32();
  s.unversioned = (s.packageFlags & 0x2000) !== 0;
  const nameCount = r.i32(), nameOffset = r.i32();
  if (!(s.packageFlags & 0x80000000)) r.str(); // localization id, sólo sin FilterEditorOnly
  r.i32(); r.i32(); // gatherable text
  const exportCount = r.i32(), exportOffset = r.i32();
  const importCount = r.i32(), importOffset = r.i32();

  r.p = nameOffset;
  const names = [];
  for (let i = 0; i < nameCount; i++) { names.push(r.str()); r.skip(4); }
  const fname = () => { const i = r.i32(), n = r.i32(); const s = names[i]; return n ? `${s}_${n - 1}` : s; };

  r.p = importOffset;
  const imports = [];
  for (let i = 0; i < importCount; i++) {
    imports.push({ classPackage: fname(), className: fname(), outer: r.i32(), name: fname() });
  }

  r.p = exportOffset;
  const exports = [];
  for (let i = 0; i < exportCount; i++) {
    const e = { classIndex: r.i32(), superIndex: r.i32(), templateIndex: r.i32(), outer: r.i32(), name: fname() };
    e.objectFlags = r.u32();
    e.serialSize = r.i64();
    e.serialOffset = r.i64();
    r.skip(4 * 3); // forced export, not for client, not for server
    r.guid();
    r.skip(4); // package flags
    r.skip(4 * 2); // not always loaded for editor game, is asset
    r.skip(4 * 5); // dependency info
    exports.push(e);
  }
  const ref = (i) => i < 0 ? imports[-i - 1].name : i > 0 ? exports[i - 1].name : null;
  for (const e of exports) e.className = ref(e.classIndex);
  return { summary: s, names, imports, exports, ref };
}

module.exports = { readAsset, R };

if (require.main === module) {
  const a = readAsset(process.argv[2]);
  console.log(JSON.stringify(a.summary));
  console.log('nombres', a.names.length, 'imports', a.imports.length, 'exports', a.exports.length);
  for (const e of a.exports.slice(0, 20)) console.log(' ', e.className, e.name, e.serialSize);
}
