// Convierte un .uasset/.uexp de UE4.27 cocinado (propiedades con tags) a JSON.
// Uso: node uprops.js <archivo.uasset> [salida.json]
const fs = require('fs');
const { readAsset, R } = require('./uasset');

const NATIVE = {
  Vector: r => ({ x: r.f32(), y: r.f32(), z: r.f32() }),
  Vector2D: r => ({ x: r.f32(), y: r.f32() }),
  Rotator: r => ({ p: r.f32(), y: r.f32(), r: r.f32() }),
  Quat: r => ({ x: r.f32(), y: r.f32(), z: r.f32(), w: r.f32() }),
  LinearColor: r => ({ r: r.f32(), g: r.f32(), b: r.f32(), a: r.f32() }),
  Color: r => ({ b: r.u8(), g: r.u8(), r: r.u8(), a: r.u8() }),
  Guid: r => r.guid(),
  IntPoint: r => ({ x: r.i32(), y: r.i32() }),
  FrameNumber: r => r.i32(),
  // TRange<FFrameNumber>: tipo de límite (0 exclusivo, 1 inclusivo, 2 abierto) + valor
  MovieSceneFrameRange: r => { const lt = r.u8(), lv = r.i32(), ut = r.u8(), uv = r.i32(); return [lt === 2 ? null : lv, ut === 2 ? null : uv]; },
  FrameNumberRange: r => { const lt = r.u8(), lv = r.i32(), ut = r.u8(), uv = r.i32(); return [lt === 2 ? null : lv, ut === 2 ? null : uv]; },
  DateTime: r => r.i64(),
  Timespan: r => r.i64(),
  SoftObjectPath: r => ({ path: r.fname(), sub: r.str() }),
  SoftClassPath: r => ({ path: r.fname(), sub: r.str() }),
  // modos de interpolación y tangente (u8) + tiempo, valor y tangentes
  RichCurveKey: r => ({ interp: r.u8(), tangentMode: r.u8(), weightMode: r.u8(), t: r.f32(), v: r.f32(), arrive: r.f32(), arriveW: r.f32(), leave: r.f32(), leaveW: r.f32() }),
  GameplayTag: r => r.fname(),
  GameplayTagContainer: r => { const n = r.i32(); const a = []; for (let i = 0; i < n; i++) a.push(r.fname()); return a; },
};

R.prototype.f32 = function () { const v = this.b.readFloatLE(this.p); this.p += 4; return +v.toFixed(5); };
R.prototype.f64 = function () { const v = this.b.readDoubleLE(this.p); this.p += 8; return v; };

// opts.byIndex: devuelve un array alineado con los exports y las referencias como "export#N" (1-based),
// para assets donde los nombres se repiten (niveles: cada actor tiene su propio DefaultSceneRoot).
function parse(path, opts = {}) {
  const a = readAsset(path);
  const uexp = fs.readFileSync(path.replace(/\.(uasset|umap)$/, '.uexp'));
  const hdr = a.summary.totalHeaderSize;
  const objRef = (i) => {
    if (i < 0) {
      const im = a.imports[-i - 1];
      const outer = im.outer ? objRef(im.outer) : '';
      return outer ? `${outer}.${im.name}` : im.name;
    }
    if (i > 0 && opts.byIndex) return `export#${i}`;
    return i > 0 ? `export:${a.exports[i - 1].name}` : null;
  };

  function reader(p) {
    const r = new R(uexp, p);
    r.fname = () => { const i = r.i32(), n = r.i32(); const s = a.names[i]; return n ? `${s}_${n - 1}` : s; };
    return r;
  }

  function text(r) {
    const flags = r.u32();
    const type = r.b.readInt8(r.p); r.p++;
    if (type === -1) { return r.i32() ? r.str() : ''; }
    if (type === 0) { const ns = r.str(), key = r.str(), src = r.str(); return { ns, key, src }; }
    if (type === 11) { return { table: r.fname(), key: r.str() }; }
    return { textHistory: type, flags };
  }

  function value(r, type, tag, size) {
    switch (type) {
      case 'IntProperty': return r.i32();
      case 'UInt32Property': return r.u32();
      case 'Int64Property': case 'UInt64Property': return r.i64();
      case 'Int8Property': return r.b.readInt8(r.p++);
      case 'Int16Property': { const v = r.b.readInt16LE(r.p); r.p += 2; return v; }
      case 'UInt16Property': { const v = r.b.readUInt16LE(r.p); r.p += 2; return v; }
      case 'FloatProperty': return r.f32();
      case 'DoubleProperty': return r.f64();
      case 'BoolProperty': return tag ? tag.bool : !!r.u8();
      case 'StrProperty': return r.str();
      case 'NameProperty': return r.fname();
      case 'TextProperty': return text(r);
      case 'ObjectProperty': case 'ClassProperty': case 'WeakObjectProperty':
      case 'LazyObjectProperty': case 'InterfaceProperty': return objRef(r.i32());
      case 'SoftObjectProperty': case 'SoftClassProperty': { const p = r.fname(), s = r.str(); return s ? `${p}:${s}` : p; }
      case 'ByteProperty': return (tag ? tag.enumName !== 'None' : size === 8) ? r.fname() : r.u8();
      case 'EnumProperty': return r.fname();
      case 'StructProperty': return struct(r, tag.structName, size);
      default: throw new Error('tipo ' + type);
    }
  }

  function struct(r, name, size) {
    if (NATIVE[name]) return NATIVE[name](r);
    return props(r, size == null ? Infinity : r.p + size);
  }

  function props(r, end) {
    const o = {};
    while (r.p < end) {
      const name = r.fname();
      if (name === 'None') break;
      const type = r.fname();
      const size = r.i32();
      const idx = r.i32();
      const tag = {};
      if (type === 'StructProperty') { tag.structName = r.fname(); r.skip(16); }
      else if (type === 'BoolProperty') tag.bool = !!r.u8();
      else if (type === 'ByteProperty' || type === 'EnumProperty') tag.enumName = r.fname();
      else if (type === 'ArrayProperty' || type === 'SetProperty') tag.inner = r.fname();
      else if (type === 'MapProperty') { tag.key = r.fname(); tag.value = r.fname(); }
      if (r.u8()) r.skip(16);
      const start = r.p;
      let v;
      try {
        if (type === 'ArrayProperty' || type === 'SetProperty') {
          if (type === 'SetProperty') r.i32(); // elementos a borrar
          const n = r.i32();
          v = [];
          if (tag.inner === 'StructProperty') {
            // tag interno con el nombre del struct
            r.fname(); r.fname(); const isz = r.i32(); r.i32(); const sname = r.fname(); r.skip(16); if (r.u8()) r.skip(16);
            const each = n ? isz / n : 0;
            for (let i = 0; i < n; i++) v.push(struct(r, sname, NATIVE[sname] ? undefined : each));
          } else {
            for (let i = 0; i < n; i++) v.push(value(r, tag.inner, null, tag.inner === 'ByteProperty' ? (size - 4) / Math.max(n, 1) : 0));
          }
        } else if (type === 'MapProperty') {
          r.i32(); // a borrar
          const n = r.i32();
          v = [];
          // claves enum: EnumProperty siempre es FName; ByteProperty también cuando cada par ocupa 8 + valor
          const VSIZE = { FloatProperty: 4, IntProperty: 4, BoolProperty: 1, ObjectProperty: 4 };
          const enumKey = tag.key === 'EnumProperty' || (tag.key === 'ByteProperty' && n && VSIZE[tag.value] && (size - 8) / n === 8 + VSIZE[tag.value]);
          // claves struct: los mapas por GUID (BindingIdToReferences y similares) guardan la clave nativa de 16 bytes
          const guidKey = tag.key === 'StructProperty' && /Guid|Id(To|$)/.test(name);
          for (let i = 0; i < n; i++) {
            const k = enumKey ? r.fname() : guidKey ? r.guid() : tag.key === 'StructProperty' ? props(r, Infinity) : value(r, tag.key, null, 0);
            const val = tag.value === 'StructProperty' ? props(r, Infinity) : value(r, tag.value, null, 0);
            v.push([k, val]);
          }
        } else {
          v = value(r, type, tag, size);
        }
      } catch (e) {
        v = { raw: uexp.toString('hex', start, start + Math.min(size, 64)), error: e.message };
      }
      r.p = start + size; // siempre confiar en el tamaño del tag
      if (idx) o[`${name}[${idx}]`] = v;
      else o[name] = v;
    }
    return o;
  }

  const out = opts.byIndex ? [] : {};
  for (const e of a.exports) {
    const r = reader(e.serialOffset - hdr);
    // los exports de código de Blueprint (Function, BlueprintGeneratedClass: el SequenceDirector que la actualización
    // del 23/10 agregó a las secuencias) no son propiedades con tag: se marcan y se sigue con el resto del asset
    let o;
    try { o = { class: e.className, props: props(r, e.serialOffset - hdr + e.serialSize) }; }
    catch (err) { o = { class: e.className, props: {}, error: err.message }; }
    if (opts.byIndex) out.push({ name: e.name, outer: e.outer, ...o });
    // nombres repetidos en pistas distintas (desde el 23/10 cada secuencia tiene dos MovieSceneObjectPropertySection_0:
    // la del comentario y la del ambiente): no pisar el anterior
    else if (out[e.name]) { let i = 2; while (out[`${e.name}#${i}`]) i++; out[`${e.name}#${i}`] = o; }
    else out[e.name] = o;
  }
  return out;
}

module.exports = { parse };

if (require.main === module) {
  const j = JSON.stringify(parse(process.argv[2]), null, 1);
  if (process.argv[3]) fs.writeFileSync(process.argv[3], j); else console.log(j);
}
