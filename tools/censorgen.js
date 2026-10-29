// Censura de los videos (AdHocMediaCensor MC_<video>): pistas con estilos permitidos (BlackBar / Mosaic / Chaotic),
// imagen (etiqueta â†’ textura de BlackBarTextures o ChaoticCensorTextures), intensidad (On.Partial / On.Full), cuadros de
// inicio y fin (30 fps) y curvas de posición (0–1 del cuadro), escala, rotación (radianes), ancla y margen del mosaico.
// Salida: web/data/censors.json { "<video>": [pistas] } y las texturas en web/assets/censor/textures.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { ROOT } = require('./env');
const EX = path.join(ROOT, 'work', 'extract', 'Dispatch');
const { MESHX } = require('./env');
const JSONDIR = path.join(ROOT, 'work', 'censorjson');
fs.mkdirSync(JSONDIR, { recursive: true });

const assets = [];
for (const p of fs.readdirSync(path.join(EX, 'Plugins'))) {
  const dir = path.join(EX, 'Plugins', p, 'Content', 'Story', 'Censors');
  if (!fs.existsSync(dir)) continue;
  for (const f of fs.readdirSync(dir).filter((f) => /^MC_.*\.uasset$/.test(f))) assets.push(`/${p}/Story/Censors/${f.slice(0, -7)}.${f.slice(0, -7)}`);
}
const todo = assets.filter((a) => !fs.existsSync(path.join(JSONDIR, a.split('.').pop() + '.json')));
if (todo.length) {
  fs.writeFileSync(path.join(ROOT, 'work', 'censor-list.txt'), todo.join('\n'));
  execFileSync(MESHX, [path.join(ROOT, 'work', 'extract'), JSONDIR, path.join(ROOT, 'work', 'censor-list.txt'), 'json'], { stdio: 'inherit' });
}
const r5 = (x) => +(+x).toFixed(5);
// curva (FRichCurve): claves [cuadro, valor, modo]; sin claves, el valor por defecto
const curve = (c, def) => {
  const keys = (c?.Keys || []).map((k) => [r5(k.Time), r5(k.Value), /Constant/.test(k.InterpMode) ? 1 : 0]);
  return keys.length ? keys : [[0, r5(def ?? 0), 1]];
};
const tag = (t) => String(t?.TagName || t || '').replace(/^AdHocMedia\.Censor\./, '');
const out = {};
const images = new Set();
for (const a of assets) {
  const name = a.split('.').pop();
  const j = JSON.parse(fs.readFileSync(path.join(JSONDIR, name + '.json')))[0]?.Properties;
  if (!j) continue;
  out[name.replace(/^MC_/, '')] = (j.Tracks || []).map((t) => {
    const img = tag(t.ImageTag);
    images.add(img);
    return {
      styles: (t.CensorStyle || []).map((s) => String(s).replace(/^AdHocMedia\.Censor\.Style\./, '')),
      image: img, strength: tag(t.CensorStrength).replace(/^Strength\.On\./, ''),
      start: t.TrackStart, end: t.TrackEnd,
      x: curve(t.Position?.CurveX, t.Position?.DefaultValue?.X), y: curve(t.Position?.CurveY, t.Position?.DefaultValue?.Y),
      scale: curve(t.Scale?.Curve, t.Scale?.DefaultValue), rot: curve(t.Rotation?.Curve, t.Rotation?.DefaultValue),
      anchor: [r5(t.Anchor?.DefaultValue?.X ?? 0.5), r5(t.Anchor?.DefaultValue?.Y ?? 0.5)],
      pad: [r5(t.MosaicPadding?.X ?? 0.5), r5(t.MosaicPadding?.Y ?? 0.5)],
      channel: t.ImageChannel?.Hex || null,
    };
  });
}
// texturas: Style.BlackBar.CensorBar â†’ T_CensorBar, Style.Chaotic.ToxicJorts-Back â†’ T_ChaoticCensor_ToxicJorts-Back
const texDir = path.join(EX, 'Plugins', 'AdHocPlugin', 'Content', 'Story', 'MediaPlayer');
const list = [];
for (const sub of ['BlackBarTextures', 'ChaoticCensorTextures']) {
  for (const f of fs.readdirSync(path.join(texDir, sub)).filter((f) => f.endsWith('.uasset'))) list.push(`/AdHocPlugin/Story/MediaPlayer/${sub}/${f.slice(0, -7)}.${f.slice(0, -7)}`);
}
const outTex = path.join(ROOT, 'web', 'assets', 'censor');
const need = list.filter((l) => !fs.existsSync(path.join(outTex, 'textures', l.split('.').pop() + '.png')));
if (need.length) {
  fs.writeFileSync(path.join(ROOT, 'work', 'censor-tex.txt'), need.join('\n'));
  execFileSync(MESHX, [path.join(ROOT, 'work', 'extract'), outTex, path.join(ROOT, 'work', 'censor-tex.txt')], { stdio: 'inherit' });
}
const texOf = {};
for (const img of images) {
  const m = /^Style\.(BlackBar|Chaotic)\.(.+)$/.exec(img);
  if (!m) continue;
  const name = m[1] === 'BlackBar' ? `T_${m[2]}` : `T_ChaoticCensor_${m[2].replace('MalevoaSword', 'MalevolaSword')}`;
  if (fs.existsSync(path.join(outTex, 'textures', name + '.png'))) texOf[img] = name;
}
fs.writeFileSync(path.join(ROOT, 'web', 'data', 'censors.json'), JSON.stringify({ fps: 30, textures: texOf, videos: out }));
console.log(`${Object.keys(out).length} videos, ${Object.values(out).flat().length} pistas, texturas ${Object.keys(texOf).length}/${images.size}`);
console.log([...images].filter((i) => !texOf[i]).join(', '));
