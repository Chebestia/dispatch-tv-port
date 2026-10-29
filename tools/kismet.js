// Decompilador de bytecode Kismet (Blueprints) de UE4.27 cocinado.
// Ubica el script de cada export Function, decodifica las expresiones y las imprime como pseudocódigo.
// Uso: node kismet.js <archivo.uasset> [salida.txt]   |   node kismet.js --json <archivo.uasset>
const fs = require('fs');
const { readAsset } = require('./uasset');

// --- ubicar el script dentro del export ---
// UFunction se serializa como: propiedades | ... UStruct ... | BytecodeBufferSize, SerializedScriptSize, script |
// FunctionFlags [, RPCId, RPCResponseId] | EventGraphFunction | EventGraphCallOffset.
// Se busca hacia atrás la pareja de tamaños que cierra justo antes de ese final y cuyo script termina en EX_EndOfScript.
// Puede haber coincidencias falsas: se devuelven todas las candidatas y se usa la primera que decodifica entera.
function findScripts(b, start, end) {
  const found = [];
  for (const trailer of [12, 16]) {
    for (let p = end - trailer - 8; p >= start; p--) {
      const size = b.readInt32LE(p + 4), memSize = b.readInt32LE(p);
      if (size > 0 && p + 8 + size === end - trailer && b[p + 8 + size - 1] === 0x53 && memSize > 0) {
        found.push({ memSize, start: p + 8, end: p + 8 + size, flags: b.readUInt32LE(end - trailer) });
      }
    }
  }
  return found;
}

// --- cabecera de UStruct: superclase y propiedades (variables de la clase, parámetros y locales de funciones) ---
// Export = propiedades con tags | UObject: bool (int32) + GUID | UStruct: SuperStruct, Children[], ChildProperties[] | script...
function structHeader(asset, b, start, end, isCDO) {
  let p = start;
  const fname = () => { const i = b.readInt32LE(p), n = b.readInt32LE(p + 4); p += 8; const s = asset.names[i]; return n ? `${s}_${n - 1}` : s; };
  const i32 = () => { const v = b.readInt32LE(p); p += 4; return v; };
  const ref = (i) => (i < 0 ? asset.imports[-i - 1]?.name : i > 0 ? asset.exports[i - 1]?.name : null) || null;

  // saltear propiedades con tags
  for (;;) {
    const name = fname();
    if (name === 'None') break;
    const type = fname();
    const size = i32();
    i32(); // índice de array
    if (type === 'StructProperty') { fname(); p += 16; }
    else if (type === 'BoolProperty') p += 1;
    else if (type === 'ByteProperty' || type === 'EnumProperty' || type === 'ArrayProperty' || type === 'SetProperty') fname();
    else if (type === 'MapProperty') { fname(); fname(); }
    if (b[p++]) p += 16;
    p += size;
    if (p > end) throw new Error('propiedades fuera del export');
  }
  if (!isCDO && i32()) p += 16;

  const superStruct = ref(i32());
  const nChildren = i32();
  const children = [];
  for (let i = 0; i < nChildren; i++) children.push(ref(i32()));

  function field(type) {
    const f = { type, name: fname(), flags: b.readUInt32LE(p) };
    p += 4;
    f.arrayDim = i32();
    p += 4; // ElementSize
    f.propFlags = b.readBigUInt64LE(p); p += 8;
    p += 2; // RepIndex
    fname(); // RepNotifyFunc
    p += 1; // BlueprintReplicationCondition
    switch (type) {
      case 'BoolProperty': p += 6; break;
      case 'ObjectProperty': case 'WeakObjectProperty': case 'LazyObjectProperty': case 'SoftObjectProperty':
        f.cls = ref(i32()); break;
      case 'ClassProperty': case 'SoftClassProperty': f.cls = ref(i32()); f.meta = ref(i32()); break;
      case 'InterfaceProperty': f.cls = ref(i32()); break;
      case 'StructProperty': f.struct = ref(i32()); break;
      case 'ByteProperty': f.enum = ref(i32()); break;
      case 'EnumProperty': f.enum = ref(i32()); f.inner = single(); break;
      case 'ArrayProperty': f.inner = single(); break;
      case 'SetProperty': f.inner = single(); break;
      case 'MapProperty': f.key = single(); f.value = single(); break;
      case 'DelegateProperty': case 'MulticastDelegateProperty': case 'MulticastInlineDelegateProperty': case 'MulticastSparseDelegateProperty':
        f.signature = ref(i32()); break;
      case 'FieldPathProperty': f.fieldClass = fname(); break;
      case 'IntProperty': case 'Int8Property': case 'Int16Property': case 'Int64Property': case 'UInt16Property': case 'UInt32Property': case 'UInt64Property':
      case 'FloatProperty': case 'DoubleProperty': case 'StrProperty': case 'NameProperty': case 'TextProperty':
        break;
      default: throw new Error('FField desconocido ' + type);
    }
    return f;
  }
  function single() { const t = fname(); return t === 'None' ? null : field(t); }

  const nProps = i32();
  const props = [];
  for (let i = 0; i < nProps; i++) props.push(field(fname()));
  if (p > end) throw new Error('ChildProperties fuera del export');
  return { superStruct, children, props, end: p };
}

// tipo legible de una propiedad
function typeName(f) {
  if (!f) return '?';
  const strip = (s) => String(s).replace(/^Default__/, '');
  switch (f.type) {
    case 'BoolProperty': return 'bool';
    case 'IntProperty': return 'int';
    case 'Int64Property': return 'int64';
    case 'FloatProperty': return 'float';
    case 'DoubleProperty': return 'double';
    case 'StrProperty': return 'string';
    case 'NameProperty': return 'name';
    case 'TextProperty': return 'text';
    case 'ByteProperty': return f.enum ? strip(f.enum) : 'byte';
    case 'EnumProperty': return strip(f.enum);
    case 'ObjectProperty': return strip(f.cls);
    case 'WeakObjectProperty': return `weak<${strip(f.cls)}>`;
    case 'SoftObjectProperty': return `soft<${strip(f.cls)}>`;
    case 'ClassProperty': return `class<${strip(f.meta)}>`;
    case 'SoftClassProperty': return `softclass<${strip(f.meta)}>`;
    case 'InterfaceProperty': return `interface<${strip(f.cls)}>`;
    case 'StructProperty': return strip(f.struct);
    case 'ArrayProperty': return `${typeName(f.inner)}[]`;
    case 'SetProperty': return `set<${typeName(f.inner)}>`;
    case 'MapProperty': return `map<${typeName(f.key)}, ${typeName(f.value)}>`;
    default: return f.type.replace(/Property$/, '');
  }
}

// CPF_*
const CPF_Parm = 0x80n, CPF_OutParm = 0x100n, CPF_ReturnParm = 0x400n, CPF_ReferenceParm = 0x8000000n, CPF_Edit = 0x1n, CPF_BlueprintVisible = 0x4n, CPF_ExposeOnSpawn = 0x1000000000000n;

// --- decodificador ---
// Los saltos usan offsets del bytecode en memoria, donde los punteros ocupan 8 bytes y los FName 12;
// en disco son 4 y 8. Por eso se lleva la cuenta de las dos posiciones.
function decode(asset, uexp, script) {
  const b = uexp;
  let p = script.start, mem = 0;
  const names = asset.names;

  const u8 = () => { mem += 1; return b[p++]; };
  const u16 = () => { const v = b.readUInt16LE(p); p += 2; mem += 2; return v; };
  const i32 = () => { const v = b.readInt32LE(p); p += 4; mem += 4; return v; };
  const u32 = () => { const v = b.readUInt32LE(p); p += 4; mem += 4; return v; };
  const f32 = () => { const v = b.readFloatLE(p); p += 4; mem += 4; return +v.toFixed(5); };
  const i64 = () => { const v = b.readBigInt64LE(p); p += 8; mem += 8; return v.toString(); };
  const u64 = () => { const v = b.readBigUInt64LE(p); p += 8; mem += 8; return v.toString(); };
  const rawName = () => { const i = b.readInt32LE(p), n = b.readInt32LE(p + 4); p += 8; const s = names[i]; return n ? `${s}_${n - 1}` : s; };
  const fname = () => { mem += 12; return rawName(); };
  const objRef = () => { const i = b.readInt32LE(p); p += 4; mem += 8; return ref(i); };
  const prop = () => {
    // FFieldPath: lista de nombres + dueño
    const n = b.readInt32LE(p); p += 4;
    const path = [];
    for (let i = 0; i < n; i++) path.push(rawName());
    p += 4; // dueño (FPackageIndex)
    mem += 8;
    return path.join('.');
  };
  const ansi = () => { const s0 = p; while (b[p]) p++; const s = b.toString('latin1', s0, p); p++; mem += p - s0; return s; };
  const utf16 = () => { const s0 = p; while (b[p] || b[p + 1]) p += 2; const s = b.toString('utf16le', s0, p); p += 2; mem += p - s0; return s; };

  function ref(i) {
    if (i < 0) { const im = asset.imports[-i - 1]; return im ? im.name : `import${i}`; }
    if (i > 0) { const ex = asset.exports[i - 1]; return ex ? ex.name : `export${i}`; }
    return null;
  }

  function until(endToken) {
    const list = [];
    while (b[p] !== endToken) list.push(expr());
    u8();
    return list;
  }

  function expr() {
    const at = mem;
    const op = u8();
    const e = { at, op };
    switch (op) {
      case 0x00: e.k = 'local'; e.prop = prop(); break;
      case 0x01: e.k = 'member'; e.prop = prop(); break;
      case 0x02: e.k = 'default'; e.prop = prop(); break;
      case 0x04: e.k = 'return'; e.v = expr(); break;
      case 0x06: e.k = 'jump'; e.to = u32(); break;
      case 0x07: e.k = 'jumpIfNot'; e.to = u32(); e.cond = expr(); break;
      case 0x09: e.k = 'assert'; e.line = u16(); e.debug = u8(); e.v = expr(); break;
      case 0x0B: e.k = 'nothing'; break;
      case 0x0F: e.k = 'let'; e.prop = prop(); e.dst = expr(); e.v = expr(); break;
      case 0x12: case 0x19: case 0x1A:
        e.k = op === 0x12 ? 'classContext' : op === 0x19 ? 'context' : 'contextFailSilent';
        e.obj = expr(); e.skip = u32(); e.rprop = prop(); e.v = expr(); break;
      case 0x13: e.k = 'metaCast'; e.cls = objRef(); e.v = expr(); break;
      case 0x14: e.k = 'letBool'; e.dst = expr(); e.v = expr(); break;
      case 0x15: e.k = 'endParmValue'; break;
      case 0x16: e.k = 'endParms'; break;
      case 0x17: e.k = 'self'; break;
      case 0x18: e.k = 'skip'; e.skip = u32(); e.v = expr(); break;
      case 0x1B: e.k = 'call'; e.fn = fname(); e.args = until(0x16); e.virtual = true; break;
      case 0x1C: e.k = 'call'; e.fn = objRef(); e.args = until(0x16); break;
      case 0x1D: e.k = 'const'; e.v = i32(); break;
      case 0x1E: e.k = 'const'; e.v = f32(); break;
      case 0x1F: e.k = 'const'; e.v = JSON.stringify(ansi()); break;
      case 0x20: e.k = 'const'; e.v = `obj(${objRef()})`; break;
      case 0x21: e.k = 'const'; e.v = `name(${JSON.stringify(fname())})`; break;
      case 0x22: e.k = 'const'; e.v = `rot(${f32()}, ${f32()}, ${f32()})`; break;
      case 0x23: e.k = 'const'; e.v = `vec(${f32()}, ${f32()}, ${f32()})`; break;
      case 0x24: e.k = 'const'; e.v = u8(); break;
      case 0x25: e.k = 'const'; e.v = 0; break;
      case 0x26: e.k = 'const'; e.v = 1; break;
      case 0x27: e.k = 'const'; e.v = true; break;
      case 0x28: e.k = 'const'; e.v = false; break;
      case 0x29: {
        e.k = 'text';
        const t = u8();
        if (t === 1) { e.src = expr(); e.key = expr(); e.ns = expr(); }
        else if (t === 2 || t === 3) e.src = expr();
        else if (t === 4) { e.table = objRef(); e.tableId = expr(); e.key = expr(); }
        break;
      }
      case 0x2A: e.k = 'const'; e.v = null; break;
      case 0x2B: e.k = 'const'; e.v = `transform(rot(${f32()}, ${f32()}, ${f32()}, ${f32()}), pos(${f32()}, ${f32()}, ${f32()}), scale(${f32()}, ${f32()}, ${f32()}))`; break;
      case 0x2C: e.k = 'const'; e.v = u8(); break;
      case 0x2D: e.k = 'const'; e.v = 'noInterface'; break;
      case 0x2E: e.k = 'cast'; e.cls = objRef(); e.v = expr(); break;
      case 0x2F: e.k = 'struct'; e.struct = objRef(); i32(); e.items = until(0x30); break;
      case 0x31: e.k = 'setArray'; e.dst = expr(); e.items = until(0x32); break;
      case 0x33: e.k = 'const'; e.v = `prop(${prop()})`; break;
      case 0x34: e.k = 'const'; e.v = JSON.stringify(utf16()); break;
      case 0x35: e.k = 'const'; e.v = i64(); break;
      case 0x36: e.k = 'const'; e.v = u64(); break;
      case 0x38: e.k = 'primCast'; e.type = u8(); e.v = expr(); break;
      case 0x39: e.k = 'setSet'; e.dst = expr(); i32(); e.items = until(0x3A); break;
      case 0x3B: e.k = 'setMap'; e.dst = expr(); i32(); e.items = until(0x3C); break;
      case 0x3D: e.k = 'setConst'; e.inner = prop(); i32(); e.items = until(0x3E); break;
      case 0x3F: e.k = 'mapConst'; e.key = prop(); e.val = prop(); i32(); e.items = until(0x40); break;
      case 0x42: e.k = 'structMember'; e.prop = prop(); e.v = expr(); break;
      case 0x43: e.k = 'letMulticastDelegate'; e.dst = expr(); e.v = expr(); break;
      case 0x44: e.k = 'letDelegate'; e.dst = expr(); e.v = expr(); break;
      case 0x45: e.k = 'call'; e.fn = fname(); e.args = until(0x16); e.virtual = true; e.local = true; break;
      case 0x46: e.k = 'call'; e.fn = objRef(); e.args = until(0x16); e.local = true; break;
      case 0x48: e.k = 'localOut'; e.prop = prop(); break;
      case 0x4A: e.k = 'nothing'; break;
      case 0x4B: e.k = 'instanceDelegate'; e.fn = fname(); break;
      case 0x4C: e.k = 'pushFlow'; e.to = u32(); break;
      case 0x4D: e.k = 'popFlow'; break;
      case 0x4E: e.k = 'computedJump'; e.v = expr(); break;
      case 0x4F: e.k = 'popFlowIfNot'; e.cond = expr(); break;
      case 0x50: e.k = 'nothing'; break;
      case 0x51: e.k = 'interfaceContext'; e.v = expr(); break;
      case 0x52: e.k = 'cast'; e.cls = objRef(); e.v = expr(); e.iface = true; break;
      case 0x53: e.k = 'end'; break;
      case 0x54: e.k = 'cast'; e.cls = objRef(); e.v = expr(); e.iface = true; break;
      case 0x55: e.k = 'cast'; e.cls = objRef(); e.v = expr(); break;
      case 0x5A: case 0x5E: e.k = 'nothing'; break;
      case 0x5B: e.k = 'const'; e.v = `offset(${u32()})`; break;
      case 0x5C: e.k = 'addDelegate'; e.dst = expr(); e.v = expr(); break;
      case 0x5D: e.k = 'clearDelegate'; e.dst = expr(); break;
      case 0x5F: e.k = 'letObj'; e.dst = expr(); e.v = expr(); break;
      case 0x60: e.k = 'letWeak'; e.dst = expr(); e.v = expr(); break;
      case 0x61: e.k = 'bindDelegate'; e.fn = fname(); e.dst = expr(); e.obj = expr(); break;
      case 0x62: e.k = 'removeDelegate'; e.dst = expr(); e.v = expr(); break;
      case 0x63: e.k = 'callDelegate'; e.fn = objRef(); e.args = until(0x16); break;
      case 0x64: e.k = 'letPersistent'; e.prop = prop(); e.v = expr(); break;
      case 0x65: e.k = 'arrayConst'; e.inner = prop(); i32(); e.items = until(0x66); break;
      case 0x67: e.k = 'softObj'; e.v = expr(); break;
      case 0x68: e.k = 'call'; e.fn = objRef(); e.args = until(0x16); e.math = true; break;
      case 0x69: {
        e.k = 'switch';
        const n = u16();
        e.end = u32();
        e.index = expr();
        e.cases = [];
        for (let i = 0; i < n; i++) { const value = expr(); u32(); e.cases.push([value, expr()]); }
        e.def = expr();
        break;
      }
      case 0x6A: { e.k = 'nothing'; const t = u8(); if (t === 4) fname(); break; }
      case 0x6B: e.k = 'arrayGetByRef'; e.arr = expr(); e.index = expr(); break;
      case 0x6C: e.k = 'sparse'; e.prop = prop(); break;
      case 0x6D: e.k = 'fieldPath'; e.v = expr(); break;
      default: throw new Error(`opcode desconocido 0x${op.toString(16)} en ${p - 1 - script.start} (mem ${at})`);
    }
    return e;
  }

  const statements = [];
  while (p < script.end) statements.push(expr());
  if (p !== script.end) throw new Error(`se pasó del final del script (${p - script.end} bytes)`);
  statements.mem = mem;
  return statements;
}
const memEnd = (statements) => statements.mem;

// --- pseudocódigo ---
const short = (s) => String(s).replace(/^K2Node_|^CallFunc_|^Temp_/, '');
function show(e) {
  if (!e) return '?';
  switch (e.k) {
    case 'local': case 'localOut': return short(e.prop);
    case 'member': return 'this.' + e.prop;
    case 'default': return 'default.' + e.prop;
    case 'sparse': return 'sparse.' + e.prop;
    case 'self': return 'this';
    case 'const': return String(e.v);
    case 'text': return e.src ? `text(${show(e.src)})` : 'text()';
    case 'call': {
      const args = (e.args || []).map(show).join(', ');
      return `${e.fn}(${args})`;
    }
    case 'callDelegate': return `${e.fn}.broadcast(${e.args.map(show).join(', ')})`;
    case 'context': case 'contextFailSilent': case 'classContext': {
      const v = show(e.v);
      return `${show(e.obj)}${e.k === 'contextFailSilent' ? '?.' : '.'}${v.startsWith('this.') ? v.slice(5) : v}`;
    }
    case 'interfaceContext': return show(e.v);
    case 'structMember': return `${show(e.v)}.${e.prop.replace(/_\d+_[0-9A-F]{32}$/, '')}`;
    case 'cast': return `cast<${e.cls}>(${show(e.v)})`;
    case 'metaCast': return `classCast<${e.cls}>(${show(e.v)})`;
    case 'primCast': return show(e.v);
    case 'struct': return `${e.struct}{${e.items.map(show).join(', ')}}`;
    case 'arrayConst': case 'setConst': return `[${e.items.map(show).join(', ')}]`;
    case 'mapConst': return `{${e.items.map(show).join(', ')}}`;
    case 'arrayGetByRef': return `${show(e.arr)}[${show(e.index)}]`;
    case 'softObj': return `soft(${show(e.v)})`;
    case 'fieldPath': return show(e.v);
    case 'instanceDelegate': return `delegate(${e.fn})`;
    case 'switch': return `switch(${show(e.index)}){${e.cases.map(([c, r]) => `${show(c)}: ${show(r)}`).join('; ')}; default: ${show(e.def)}}`;
    case 'skip': return show(e.v);
    default: return `<${e.k}>`;
  }
}

function statement(e) {
  switch (e.k) {
    case 'let': case 'letBool': case 'letObj': case 'letWeak': case 'letDelegate': case 'letMulticastDelegate':
      return `${show(e.dst)} = ${show(e.v)}`;
    case 'letPersistent': return `persistent.${e.prop} = ${show(e.v)}`;
    case 'setArray': return `${show(e.dst)} = [${e.items.map(show).join(', ')}]`;
    case 'setSet': case 'setMap': return `${show(e.dst)} = {${e.items.map(show).join(', ')}}`;
    case 'jump': return `goto L${e.to}`;
    case 'jumpIfNot': return `if (!(${show(e.cond)})) goto L${e.to}`;
    case 'pushFlow': return `push L${e.to}`;
    case 'popFlow': return 'pop  // continúa en el último push';
    case 'popFlowIfNot': return `if (!(${show(e.cond)})) pop`;
    case 'computedJump': return `goto ${show(e.v)}`;
    case 'return': return e.v && e.v.k !== 'nothing' ? `return ${show(e.v)}` : 'return';
    case 'addDelegate': return `${show(e.dst)} += ${show(e.v)}`;
    case 'removeDelegate': return `${show(e.dst)} -= ${show(e.v)}`;
    case 'clearDelegate': return `${show(e.dst)}.clear()`;
    case 'bindDelegate': return `${show(e.dst)} = bind(${show(e.obj)}, ${e.fn})`;
    case 'assert': return `assert(${show(e.v)})`;
    case 'nothing': case 'end': return null;
    default: return show(e);
  }
}

function decompile(path) {
  const asset = readAsset(path);
  const uexp = fs.readFileSync(path.replace(/\.(uasset|umap)$/, '.uexp'));
  const hdr = asset.summary.totalHeaderSize;
  const out = [];
  out.classes = [];
  for (const ex of asset.exports) {
    const start = ex.serialOffset - hdr, end = start + ex.serialSize;
    const isCDO = (ex.objectFlags & 0x10) !== 0;
    if (/GeneratedClass$|^UserDefinedStruct$|^ScriptStruct$/.test(ex.className) && !isCDO) {
      try {
        const h = structHeader(asset, uexp, start, end, false);
        out.classes.push({ name: ex.name, kind: ex.className, super: h.superStruct, vars: h.props });
      } catch (err) {
        out.classes.push({ name: ex.name, kind: ex.className, error: err.message });
      }
      continue;
    }
    if (ex.className !== 'Function') continue;
    let header = null, headerError = null;
    try { header = structHeader(asset, uexp, start, end, false); } catch (err) { headerError = err.message; }
    // con la cabecera bien leída el script empieza justo después; si no, se busca
    const exact = header && uexp.readInt32LE(header.end + 4) > 0 && header.end + 8 + uexp.readInt32LE(header.end + 4) <= end
      ? [{ memSize: uexp.readInt32LE(header.end), start: header.end + 8, end: header.end + 8 + uexp.readInt32LE(header.end + 4) }] : [];
    const scripts = [...exact, ...findScripts(uexp, start, end)];
    const props = header ? header.props : [];
    if (!scripts.length) { out.push({ name: ex.name, props, error: 'sin script' }); continue; }
    let result = null, firstError = null;
    for (const script of scripts) {
      try {
        const statements = decode(asset, uexp, script);
        if (memEnd(statements) !== script.memSize) throw new Error(`tamaño en memoria ${memEnd(statements)} != ${script.memSize}`);
        result = { name: ex.name, flags: uexp.readUInt32LE(script.end), props, statements };
        if (!exact.length || script !== exact[0]) result.headerError = headerError || 'la cabecera no coincide con el script';
        break;
      } catch (err) {
        firstError = firstError || err.message;
      }
    }
    out.push(result || { name: ex.name, props, error: firstError });
  }
  return out;
}

// FUNC_*: los que sirven para leer
const FLAGS = { 0x1: 'final', 0x400: 'native', 0x800: 'event', 0x2000: 'static', 0x20000: 'public', 0x40000: 'private', 0x80000: 'protected', 0x400000: 'hasOutParms', 0x4000000: 'callable', 0x8000000: 'overridable', 0x10000000: 'pure', 0x40000000: 'const' };
// recorre todas las subexpresiones
function walk(list, fn) {
  for (const s of list) {
    if (!s || typeof s !== 'object') continue;
    if (Array.isArray(s)) { walk(s, fn); continue; }
    if (s.k) fn(s);
    for (const v of Object.values(s)) if (v && typeof v === 'object') walk([v], fn);
  }
}

function format(funcs) {
  const lines = [];
  // los eventos entran al ubergraph con ExecuteUbergraph_X(offset): esos offsets son etiquetas del ubergraph
  const entries = {};
  for (const f of funcs) {
    if (f.error) continue;
    walk(f.statements, (e) => {
      if (e.k === 'call' && /^ExecuteUbergraph_/.test(e.fn) && e.args[0] && e.args[0].k === 'const') {
        (entries[e.fn] = entries[e.fn] || {})[e.args[0].v] = f.name;
      }
    });
  }
  for (const c of funcs.classes || []) {
    lines.push(`${c.kind === 'UserDefinedStruct' || c.kind === 'ScriptStruct' ? 'struct' : 'class'} ${c.name}${c.super ? ' extends ' + c.super : ''} {`);
    if (c.error) lines.push(`  // ERROR: ${c.error}`);
    for (const v of c.vars || []) {
      const tags = [];
      if (v.propFlags & CPF_Edit) tags.push('editable');
      if (v.propFlags & CPF_ExposeOnSpawn) tags.push('exposeOnSpawn');
      lines.push(`  ${v.name.replace(/_\d+_[0-9A-F]{32}$/, '')}: ${typeName(v)}${v.arrayDim > 1 ? `[${v.arrayDim}]` : ''}${tags.length ? '  // ' + tags.join(' ') : ''}`);
    }
    lines.push('}', '');
  }
  for (const f of funcs) {
    const flags = Object.entries(FLAGS).filter(([bit]) => f.flags & +bit).map(([, n]) => n).join(' ');
    const params = (f.props || []).filter((v) => v.propFlags & CPF_Parm && !(v.propFlags & CPF_ReturnParm))
      .map((v) => `${v.propFlags & CPF_OutParm && !(v.propFlags & CPF_ReferenceParm) ? 'out ' : v.propFlags & CPF_ReferenceParm ? 'ref ' : ''}${v.name}: ${typeName(v)}`);
    const ret = (f.props || []).find((v) => v.propFlags & CPF_ReturnParm);
    lines.push(`function ${f.name}(${params.join(', ')})${ret ? ': ' + typeName(ret) : ''}${flags ? '  // ' + flags : ''}`);
    const locals = (f.props || []).filter((v) => !(v.propFlags & CPF_Parm));
    if (locals.length && !/^ExecuteUbergraph_/.test(f.name)) lines.push(`  // locales: ${locals.map((v) => `${v.name}: ${typeName(v)}`).join(', ')}`);
    if (f.headerError) lines.push(`  // aviso: ${f.headerError}`);
    if (f.error) { lines.push(`  // ERROR: ${f.error}`, ''); continue; }
    const targets = new Set();
    walk(f.statements, (e) => {
      if (e.to != null) targets.add(e.to);
      if (e.k === 'const' && /^offset\(/.test(e.v)) targets.add(+e.v.slice(7, -1));
    });
    const entry = entries[f.name] || {};
    for (const s of f.statements) {
      if (entry[s.at]) lines.push(`L${s.at}:  // entrada de ${entry[s.at]}`);
      else if (targets.has(s.at)) lines.push(`L${s.at}:`);
      const t = statement(s);
      if (t) lines.push('  ' + t);
    }
    lines.push('');
  }
  return lines.join('\n');
}

module.exports = { decompile, format };

if (require.main === module) {
  const json = process.argv[2] === '--json';
  const [file, outPath] = process.argv.slice(json ? 3 : 2);
  const funcs = decompile(file);
  const text = json ? JSON.stringify({ classes: funcs.classes, funcs }, (k, v) => (typeof v === 'bigint' ? v.toString() : v), 1) : format(funcs);
  if (outPath) fs.writeFileSync(outPath, text); else console.log(text);
}
