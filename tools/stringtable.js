// Lee un StringTable cocinado de UE4.27: tras las propiedades (None + bandera de GUID) vienen
// FString TableNamespace, int32 n, n × (FString clave, FString texto) y luego los metadatos.
// Uso: node stringtable.js <ST.uasset>
const fs = require('fs');

function readStr(b, p) {
  const n = b.readInt32LE(p); p += 4;
  if (n === 0) return ['', p];
  if (n < 0) { const s = b.toString('utf16le', p, p + -n * 2 - 2); return [s, p + -n * 2]; }
  return [b.toString('utf8', p, p + n - 1), p + n];
}

function readStringTable(uasset) {
  const b = fs.readFileSync(uasset.replace(/\.uasset$/, '.uexp'));
  let p = 12; // FName None (8) + bSerializeGuid (4)
  let ns;
  [ns, p] = readStr(b, p);
  const n = b.readInt32LE(p); p += 4;
  const entries = {};
  for (let i = 0; i < n; i++) {
    let k, v;
    [k, p] = readStr(b, p);
    [v, p] = readStr(b, p);
    entries[k] = v;
  }
  return { namespace: ns, entries };
}

if (require.main === module) console.log(JSON.stringify(readStringTable(process.argv[2]), null, 1));
module.exports = { readStringTable };
