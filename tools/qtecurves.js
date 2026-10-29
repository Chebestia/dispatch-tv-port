// Curvas de los QTESection de la historia (ScalarParameterNamesAndCurves / Vector2DParameterNamesAndCurves: RenderOpacity,
// Scale, Position, …) → web/data/qte-curves.json { "<secuencia>": [{ r: [desde, hasta] (ticks), c: { Nombre: canal | {x, y} } }] }.
// Las lee CUE4Parse (tools/meshx … json); los tiempos de los canales están en ticks de la secuencia.
// Uso: node tools/qtecurves.js
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { ROOT } = require('./env');
const JSONDIR = path.join(ROOT, 'work', 'qtejson');
const list = [];
for (const n of [101, 102, 103, 104, 105, 106, 107, 108]) {
  const j = JSON.parse(fs.readFileSync(path.join(ROOT, 'work', `story${n}.json`)));
  for (const [key, objs] of Object.entries(j)) {
    if (!Object.values(objs || {}).some((e) => e?.class === 'QTESection' && (e.props.ScalarParameterNamesAndCurves || e.props.Vector2DParameterNamesAndCurves))) continue;
    const name = key.split('/').pop();
    list.push(`/DispatchEp${n}/Story/${key}.${name}`);
  }
}
fs.writeFileSync(path.join(ROOT, 'work', 'qte-list.txt'), list.join('\n'));
execFileSync(require('./env').MESHX,
  [path.join(ROOT, 'work', 'extract'), JSONDIR, path.join(ROOT, 'work', 'qte-list.txt'), 'json'], { stdio: 'inherit' });

const channel = (c) => c && c.Times ? {
  t: c.Times.map((t) => t.Value), v: (c.Values || []).map((v) => v.Value), i: (c.Values || []).map((v) => v.InterpMode ?? 2),
  a: (c.Values || []).map((v) => v.Tangent?.ArriveTangent || 0), l: (c.Values || []).map((v) => v.Tangent?.LeaveTangent || 0),
  d: c.bHasDefaultValue ? c.DefaultValue : undefined,
} : null;
const out = {};
let n = 0;
for (const p of list) {
  const name = p.split('.').pop();
  const f = path.join(JSONDIR, `${name}.json`);
  if (!fs.existsSync(f)) continue;
  for (const e of JSON.parse(fs.readFileSync(f))) {
    if (e.Type !== 'QTESection') continue;
    const P = e.Properties, R = P.SectionRange?.Value;
    const c = {};
    for (const s of P.ScalarParameterNamesAndCurves || []) c[s.ParameterName] = channel(s.ParameterCurve);
    for (const s of P.Vector2DParameterNamesAndCurves || []) c[s.ParameterName] = { x: channel(s.XCurve), y: channel(s.YCurve) };
    if (!Object.keys(c).length) continue;
    (out[name] ||= []).push({ r: [R?.LowerBound?.Value?.Value ?? 0, R?.UpperBound?.Value?.Value ?? 0], c });
    n++;
  }
}
fs.writeFileSync(path.join(ROOT, 'web', 'data', 'qte-curves.json'), JSON.stringify(out));
console.log(`${list.length} secuencias, ${n} QTE con curvas`);
