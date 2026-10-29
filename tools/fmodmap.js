// Mapea los eventos FMOD (assets FMODEvent de UE, con AssetGuid) a las muestras de los bancos convertidos por fmodx.js.
// Cadena dentro de cada banco: EVTB (GUID del evento, GUID de su línea de tiempo en +32) -> INST (dueño = línea de tiempo)
// dentro de WAIT, cuyo WAIB une instrumento -> forma de onda -> WAV (índice de subcanción del FSB5 del chunk SND).
// Salida: web/data/fmod-events.json { "NombreEvento": ["Banco/archivo.ogg", ...] }
// Uso: node fmodmap.js [dirBancos]
const fs = require('fs');
const path = require('path');
const { parse } = require('./uprops');

const BANKS = process.argv[2] || require('./env').BANKS;
const { ROOT } = require('./env');
const audioIndex = JSON.parse(fs.readFileSync(path.join(ROOT, 'web', 'data', 'audio.json')));

function* chunks(b, start, end, parents = []) {
  let p = start;
  while (p + 8 <= end) {
    const id = b.toString('latin1', p, p + 4);
    const size = b.readUInt32LE(p + 4);
    const body = p + 8;
    const list = id === 'RIFF' || id === 'LIST' ? b.toString('latin1', body, body + 4) : null;
    yield { id, list, size, body, parents };
    if (list && size > 4) yield* chunks(b, body + 4, Math.min(end, body + size), [...parents, { list, body, size }]);
    p = body + size + (size & 1);
  }
}
const hex = (b, p) => b.toString('hex', p, p + 16);

// nombres de las subcanciones del FSB5 dentro del chunk SND (la tabla de nombres va después de las cabeceras)
function fsbNames(b, sndBody, sndSize) {
  let p = b.indexOf('FSB5', sndBody);
  if (p < 0 || p > sndBody + sndSize) return [];
  const version = b.readUInt32LE(p + 4), num = b.readUInt32LE(p + 8), headers = b.readUInt32LE(p + 12), names = b.readUInt32LE(p + 16);
  const headerSize = version === 0 ? 0x40 : 0x3c;
  const table = p + headerSize + headers;
  const out = [];
  if (!names) return out;
  for (let i = 0; i < num; i++) {
    const off = b.readUInt32LE(table + i * 4);
    let e = table + off;
    while (b[e]) e++;
    out.push(b.toString('utf8', table + off, e));
  }
  return out;
}

// GUID de UE (4 uint32) en las variantes posibles del GUID de FMOD
function guidVariants(ue) {
  const w = [0, 8, 16, 24].map((i) => ue.slice(i, i + 8));
  const swap = (h) => h.match(/../g).reverse().join('');
  return new Set([
    ue,
    w.map(swap).join(''),
    // FMOD::GUID { Data1 u32, Data2 u16, Data3 u16, Data4[8] } a partir de FGuid(A, B, C, D)
    w[0] + w[1].slice(4, 8) + w[1].slice(0, 4) + swap(w[2]) + swap(w[3]),
    w[0] + swap(w[1]).slice(0, 4) + swap(w[1]).slice(4, 8) + w[2] + w[3],
    swap(w[0]) + swap(w[1]).slice(4, 8) + swap(w[1]).slice(0, 4) + w[2] + w[3],
  ]);
}

const eventSamples = {}; // guid FMOD -> [archivos]
const eventBeeps = {}; // guid FMOD -> [ms de cada pitido de censura]
let banksRead = 0;
for (const bankFile of fs.readdirSync(BANKS).filter((f) => f.endsWith('.bank') && !/strings/i.test(f))) {
  const bank = bankFile.replace(/\.bank$/, '');
  const b = fs.readFileSync(path.join(BANKS, bankFile));
  const events = [], owners = new Map(), waveOf = new Map(), wavIndex = new Map(), condAt = new Map();
  let names = [];
  let lastWait = null;
  // multi-instrumentos (LIST MUIT: MUIB con su GUID, PLST con los GUID de los instrumentos hijos, INST con el dueño)
  const muits = []; let curMuit = null;
  for (const c of chunks(b, 0, b.length)) {
    const parent = c.parents.at(-1);
    if (parent?.list === 'MUIT') {
      if (!curMuit || curMuit.body !== parent.body) { curMuit = { body: parent.body, guid: null, plst: '', owner: null }; muits.push(curMuit); }
      if (c.id === 'MUIB') curMuit.guid = hex(b, c.body);
      else if (c.id === 'PLST') curMuit.plst = b.toString('hex', c.body, c.body + c.size);
      else if (c.id === 'INST') curMuit.owner = hex(b, c.body);
    }
    // TLNB (línea de tiempo): tras su GUID y 6 bytes, entradas { GUID del instrumento, inicio u32, largo u32 } en
    // muestras a 48 kHz; se usa para ubicar los pitidos de "Censor Sine Wave"
    if (c.id === 'TLNB') for (let q = c.body + 22; q + 24 <= c.body + c.size; q += 24) condAt.set(hex(b, q), { at: Math.round(b.readUInt32LE(q + 16) / 48), len: Math.round(b.readUInt32LE(q + 20) / 48) });
    if (c.id === 'EVTB') events.push({ guid: hex(b, c.body), timeline: hex(b, c.body + 32), refs: [hex(b, c.body + 32), hex(b, c.body + 48), hex(b, c.body + 64)] });
    else if (c.id === 'WAIB') { lastWait = { inst: hex(b, c.body), wave: hex(b, c.body + 16) }; waveOf.set(lastWait.inst, lastWait.wave); }
    else if (c.id === 'INST' && lastWait && c.parents.at(-1)?.list === 'WAIT') {
      const owner = hex(b, c.body);
      if (!owners.has(owner)) owners.set(owner, []);
      owners.get(owner).push(lastWait.inst);
    } else if (c.id === 'WAV ') wavIndex.set(hex(b, c.body), b.readUInt16LE(c.body + 22));
    else if (c.id === 'SND ') names = fsbNames(b, c.body, c.size);
  }
  // hijos de cada multi-instrumento: instrumentos de forma de onda y otros multi-instrumentos (resueltos en cadena)
  const childOf = new Map();
  for (const m of muits) {
    if (!m.guid) continue;
    const kids = [];
    for (const inst of waveOf.keys()) if (m.plst.includes(inst)) kids.push(inst);
    for (const o of muits) if (o !== m && o.guid && m.plst.includes(o.guid)) kids.push(o.guid);
    childOf.set(m.guid, kids);
  }
  const leaves = (g, seen = new Set()) => {
    if (seen.has(g)) return [];
    seen.add(g);
    if (waveOf.has(g)) return [g];
    return (childOf.get(g) || []).flatMap((k) => leaves(k, seen));
  };
  for (const m of muits) {
    if (!m.owner || !m.guid) continue;
    if (!owners.has(m.owner)) owners.set(m.owner, []);
    owners.get(m.owner).push(...leaves(m.guid));
  }
  for (const ev of events) {
    const files = [], beeps = [];
    for (const ref of ev.refs) for (const inst of owners.get(ref) || []) {
      const idx = wavIndex.get(waveOf.get(inst));
      const name = idx != null ? names[idx] : null;
      const file = name && audioIndex[name.toLowerCase()];
      if (file && !files.includes(file)) files.push(file);
      if (/^Censor Sine Wave$/i.test(name || '') && condAt.has(inst)) beeps.push(condAt.get(inst));
    }
    if (files.length) eventSamples[ev.guid] = (eventSamples[ev.guid] || []).concat(files);
    if (beeps.length) eventBeeps[ev.guid] = beeps.filter((x, i) => beeps.findIndex((y) => y.at === x.at) === i).sort((x, y) => x.at - y.at).map((x) => [x.at, x.len]);
  }
  banksRead++;
}

// assets FMODEvent de UE: nombre -> AssetGuid
const out = {}, beepsOut = {};
let assets = 0, matched = 0;
(function walk(d) {
  for (const f of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, f.name);
    if (f.isDirectory()) { walk(p); continue; }
    if (!f.name.endsWith('.uasset')) continue;
    let o;
    try { o = Object.values(parse(p))[0]; } catch { continue; }
    if (o?.class !== 'FMODEvent' || !o.props.AssetGuid) continue;
    assets++;
    for (const g of guidVariants(o.props.AssetGuid)) if (eventSamples[g]) {
      out[f.name.slice(0, -7)] = eventSamples[g]; matched++;
      if (eventBeeps[g]) beepsOut[f.name.slice(0, -7)] = eventBeeps[g];
      break;
    }
  }
})(path.join(ROOT, 'work', 'extract', 'Dispatch', 'Content', 'FMOD', 'Events'));
fs.writeFileSync(path.join(ROOT, 'web', 'data', 'fmod-events.json'), JSON.stringify(out));
fs.writeFileSync(path.join(ROOT, 'web', 'data', 'fmod-censor.json'), JSON.stringify(beepsOut));
console.log(`${Object.keys(beepsOut).length} eventos con pitidos de censura`);
console.log(`${banksRead} bancos, ${Object.keys(eventSamples).length} eventos con muestras; ${assets} assets FMODEvent, ${matched} mapeados`);
