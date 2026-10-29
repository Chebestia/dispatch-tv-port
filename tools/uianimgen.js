// Animaciones de los Widget Blueprints (UWidgetAnimation) → web/data/ui-anims/<WBP>.json para el reproductor de shift.js.
// Lee los JSON de CUE4Parse (tools/meshx … json) de work/uianimjson (lista en work/uianim-list.txt).
// Salida por WBP: { <animación>: { len (s), tracks: [{ w (widget), slot (true si anima el slot), p (propiedad),
//   k (tipo: float, tr2d, color, margin, byte, mat), ch: { canal: {t (s), v, i, a, l} } }], events: [s…] } }
// Las tangentes de UE van por tick; se pasan a por segundo (×resolución) para evaluar con tiempos en segundos.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { ROOT } = require('./env');
const JSONDIR = path.join(ROOT, 'work', 'uianimjson');
const OUT = path.join(ROOT, 'web', 'data', 'ui-anims');
const LIST = path.join(ROOT, 'work', 'uianim-list.txt');

if (process.argv.includes('--extract')) {
  execFileSync(require('./env').MESHX, [path.join(ROOT, 'work', 'extract'), JSONDIR, LIST, 'json'], { stdio: 'inherit' });
}

const inner = (s) => { const m = String(s || '').match(/^[^']*'(.*)'$/); return m ? m[1] : String(s || ''); };
const round = (x) => +(+x).toFixed(5);

function channel(c, res) {
  if (!c || !c.Times) return null;
  if (!c.Times.length) return c.bHasDefaultValue ? { t: [], v: [], d: round(c.DefaultValue) } : null;
  const vals = c.Values || [];
  const o = {
    t: c.Times.map((t) => round(t.Value / res)),
    v: vals.map((v) => round(typeof v === 'object' ? v.Value : v)),
  };
  const i = vals.map((v) => (typeof v === 'object' ? v.InterpMode ?? 2 : 1));
  if (i.some((x) => x !== 2)) o.i = i;
  const a = vals.map((v) => round((v?.Tangent?.ArriveTangent || 0) * res));
  const l = vals.map((v) => round((v?.Tangent?.LeaveTangent || 0) * res));
  if (a.some((x) => x) || l.some((x) => x)) { o.a = a; o.l = l; }
  return o;
}

const KIND = {
  MovieSceneFloatTrack: ['float', { FloatCurve: 'v' }],
  MovieScene2DTransformTrack: ['tr2d', { Translation: 'tx', 'Translation[1]': 'ty', Rotation: 'rot', Scale: 'sx', 'Scale[1]': 'sy', Shear: 'hx', 'Shear[1]': 'hy' }],
  MovieSceneColorTrack: ['color', { RedCurve: 'r', GreenCurve: 'g', BlueCurve: 'b', AlphaCurve: 'a' }],
  MovieSceneMarginTrack: ['margin', { LeftCurve: 'l', TopCurve: 't', RightCurve: 'r', BottomCurve: 'b' }],
  MovieSceneByteTrack: ['byte', { ByteCurve: 'v' }],
  MovieSceneIntegerTrack: ['byte', { IntegerCurve: 'v' }],
  MovieSceneBoolTrack: ['byte', { BoolCurve: 'v' }],
};

function convert(file) {
  const ex = JSON.parse(fs.readFileSync(file));
  const byFull = new Map();
  for (const e of ex) byFull.set(inner(e.Outer?.ObjectName) + '.' + e.Name, e);
  const get = (ref) => (ref ? byFull.get(inner(ref.ObjectName)) : null);
  const out = {};
  for (const wa of ex.filter((e) => e.Type === 'WidgetAnimation')) {
    const ms = get(wa.Properties.MovieScene);
    if (!ms) continue;
    const res = ms.Properties.TickResolution?.Numerator || 60000;
    const pr = ms.Properties.PlaybackRange?.Value;
    const start = pr?.LowerBound?.Value?.Value || 0;
    const len = round(((pr?.UpperBound?.Value?.Value || 0) - start) / res);
    // GUID → { widget, slot }
    const poss = {};
    for (const p of ms.Properties.Possessables || []) poss[p.Guid] = p;
    const who = (g) => {
      const p = poss[g];
      if (!p) return null;
      if (/Slot'?$/.test(p.PossessedObjectClass?.ObjectName || '') && p.ParentGuid && poss[p.ParentGuid]) return { w: poss[p.ParentGuid].Name, slot: true };
      return { w: p.Name };
    };
    const tracks = [];
    const events = [];
    const addSections = (tr, target) => {
      const kind = KIND[tr.Type];
      for (const sref of tr.Properties?.Sections || []) {
        const s = get(sref);
        if (!s) continue;
        if (/Event/.test(s.Type)) {
          for (const t of s.Properties?.EventChannel?.KeyTimes || s.Properties?.KeyTimes || []) events.push(round(((t.Value ?? t) - start) / res));
          continue;
        }
        if (tr.Type === 'MovieSceneWidgetMaterialTrack') {
          const ch = {};
          for (const sp of s.Properties?.ScalarParameterNamesAndCurves || []) { const c = channel(sp.ParameterCurve, res); if (c) ch[sp.ParameterName] = c; }
          for (const cp of s.Properties?.ColorParameterNamesAndCurves || []) {
            for (const [k, n] of [['RedCurve', 'r'], ['GreenCurve', 'g'], ['BlueCurve', 'b'], ['AlphaCurve', 'a']]) { const c = channel(cp[k], res); if (c) ch[cp.ParameterName + '.' + n] = c; }
          }
          if (Object.keys(ch).length) tracks.push({ ...target, p: [].concat(tr.Properties.BrushPropertyNamePath || 'Brush').join('.'), k: 'mat', ch });
          continue;
        }
        if (!kind) continue;
        const ch = {};
        for (const [src, dst] of Object.entries(kind[1])) { const c = channel(s.Properties?.[src], res); if (c) ch[dst] = c; }
        // tiempos relativos al inicio de la reproducción
        for (const c of Object.values(ch)) c.t = c.t.map((t) => round(t - start / res));
        if (Object.keys(ch).length) tracks.push({ ...target, p: tr.Properties?.PropertyBinding?.PropertyPath || tr.Properties?.PropertyBinding?.PropertyName || '', k: kind[0], ch });
      }
    };
    for (const b of ms.Properties.ObjectBindings || []) {
      const target = who(b.ObjectGuid);
      if (!target) continue;
      for (const tref of b.Tracks || []) { const tr = get(tref); if (tr) addSections(tr, target); }
    }
    for (const tref of ms.Properties.MasterTracks || []) { const tr = get(tref); if (tr) addSections(tr, { w: null }); }
    out[wa.Properties.DisplayLabel || wa.Name.replace(/_INST$/, '')] = { len, tracks, ...(events.length ? { events } : {}) };
  }
  return out;
}

fs.mkdirSync(OUT, { recursive: true });
let n = 0, a = 0;
for (const f of fs.readdirSync(JSONDIR).filter((f) => /^WBP_.*\.json$/.test(f))) {
  const r = convert(path.join(JSONDIR, f));
  if (!Object.keys(r).length) continue;
  fs.writeFileSync(path.join(OUT, f), JSON.stringify(r));
  n++; a += Object.keys(r).length;
}
console.log(`${n} widgets, ${a} animaciones → ${path.relative(ROOT, OUT)}`);
