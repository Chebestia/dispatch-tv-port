// Fin de episodio (WBP_EndOfEpisodeStatsScreen): EndOfEpisode_10x (AdHocStoryEndOfEpisodeData) con sus páginas de
// estadísticas (StatPages → ChoiceStats) y el video de créditos (CreditsVideo → FileMediaSource.FilePath).
//  - AdHocChoiceStatStory: opciones {OptionNode, OptionVariable, bPassesOnFalseOptionVariable, DisplayText, Image, Video}
//    y la alternativa NoOption*; gana la primera opción cuyo nodo se recorrió.
//  - AdHocChoiceStatCustomInstance: clase de blueprint (percentiles, tasas de QTE…); se guarda el texto literal de
//    GetDisplayText y la imagen por defecto del CDO (APROX: sin los datos globales de Analytics).
// Salida: web/data/ui/eoe.json; imágenes en web/assets/eoe/textures.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const { ROOT } = require('./env');
const EXTRACT = path.join(ROOT, 'work', 'extract');
const { MESHX } = require('./env');
const JSONDIR = path.join(ROOT, 'work', 'eoejson');
fs.mkdirSync(JSONDIR, { recursive: true });

const dump = (paths) => {
  const todo = paths.filter((p) => !fs.existsSync(path.join(JSONDIR, p.split('/').pop().replace(/\..*$/, '') + '.json')));
  if (!todo.length) return;
  const lst = path.join(ROOT, 'work', 'eoe-list.txt');
  fs.writeFileSync(lst, todo.join('\n'));
  execFileSync(MESHX, [EXTRACT, JSONDIR, lst, 'json'], { stdio: 'inherit' });
};
const load = (name) => { const f = path.join(JSONDIR, name + '.json'); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f)) : []; };
const objPath = (ref) => String(ref?.ObjectPath || '').replace(/\.\d+$/, '');
const shortName = (ref) => objPath(ref).split('/').pop();
const ftext = (t) => (t && (t.SourceString || t.Key) ? { ns: t.Namespace || '', key: t.Key || '', src: t.SourceString || '' } : null);
const textures = new Set();
const tex = (ref) => { const p = objPath(ref); if (!p) return null; textures.add(`${p}.${p.split('/').pop()}`); return p.split('/').pop(); };
const movies = {};
const video = (ref) => {
  const n = shortName(ref);
  if (!n) return null;
  if (!(n in movies)) {
    dump([`${objPath(ref)}.${n}`]);
    const fp = load(n).find((e) => e.Type === 'FileMediaSource')?.Properties?.FilePath || '';
    movies[n] = fp ? 'movies/' + fp.replace(/^\.\/Movies\//, '') : null;
  }
  return movies[n];
};

// texto literal de GetDisplayText en el blueprint de una estadística a medida
function customText(cls) {
  const f = (() => {
    const walk = (d) => { for (const x of fs.readdirSync(d)) { const p = path.join(d, x); if (fs.statSync(p).isDirectory()) { const r = walk(p); if (r) return r; } else if (x === cls + '.uasset') return p; } return null; };
    return walk(path.join(EXTRACT, 'Dispatch', 'Plugins'));
  })();
  if (!f) return {};
  const src = execFileSync('node', [path.join(__dirname, 'kismet.js'), f], { encoding: 'utf8', maxBuffer: 1 << 26 });
  const fn = src.split(/\nfunction /).find((s) => s.startsWith('GetDisplayText()')) || '';
  const lit = [...fn.matchAll(/text\("((?:[^"\\]|\\.)*)"\)/g)].map((m) => m[1]);
  return { text: lit.length ? lit[lit.length - 1] : null };
}

const episodes = {};
for (let ep = 101; ep <= 108; ep++) {
  const name = `EndOfEpisode_${ep}`;
  dump([`/DispatchEp${ep}/EpisodeData/${name}.${name}`]);
  const data = load(name).find((e) => e.Type === 'AdHocStoryEndOfEpisodeData');
  if (!data) continue;
  const P = data.Properties;
  const statRefs = (P.StatPages || []).flatMap((p) => p.ChoiceStats || []);
  dump(statRefs.map((r) => `${objPath(r)}.${shortName(r)}`));
  const pages = (P.StatPages || []).map((pg) => ({
    gameplay: !!pg.bIsGameplayStatsPage,
    stats: (pg.ChoiceStats || []).map((r) => {
      const e = load(shortName(r)).find((x) => /ChoiceStat/.test(x.Type));
      if (!e) return { id: shortName(r), missing: true };
      const p = e.Properties || {};
      if (e.Type === 'AdHocChoiceStatStory') {
        return {
          id: e.Name, kind: 'story',
          options: (p.Options || []).map((o) => ({
            node: shortName(o.OptionNode) || null, variable: shortName(o.OptionVariable) || null, passOnFalse: !!o.bPassesOnFalseOptionVariable,
            text: ftext(o.DisplayText), image: tex(o.Image), video: video(o.Video),
          })),
          none: { text: ftext(p.NoOptionText), image: tex(p.NoOptionImage), video: video(p.NoOptionVideo) },
        };
      }
      const cls = shortName(p.InstanceClass).replace(/_C$/, '');
      return { id: e.Name, kind: 'custom', cls, ...customText(cls) };
    }),
  }));
  episodes[ep] = { pages, credits: video(P.CreditsVideo) };
  console.log(`${ep}: ${pages.length} páginas, ${statRefs.length} estadísticas, créditos ${episodes[ep].credits}`);
}

// páginas de turnos: héroes (BPDA_EndOfEpisodeStats_Specials: nombre, color, retrato de poderes y su encuadre) e
// imágenes de BP_LuckyStat (Barely_ChoiceStat) y BP_PerfectFitStat (Perfect_ChoiceStat)
const { parse } = require('./uprops');
const DAS = path.join(EXTRACT, 'Dispatch', 'Content', 'Shared', 'Menu', 'Widgets', 'Stats', 'Assets', 'EndOfEpisodeStats_DataAssets');
const lin = (c) => Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
const heroes = {};
for (const f of fs.readdirSync(DAS).filter((f) => /^DA_EOES_.*\.uasset$/.test(f))) {
  const p = parse(path.join(DAS, f), { byIndex: true }).filter(Boolean).find((o) => /Specials/.test(o.class))?.props;
  if (!p) continue;
  const key = String(p.HeroName?.src || f.slice(8, -7)).normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase();
  heroes[key] = { name: p.HeroName, color: p.TextColor ? `rgb(${lin(p.TextColor.r)},${lin(p.TextColor.g)},${lin(p.TextColor.b)})` : null,
    image: p.Texture ? tex({ ObjectPath: p.Texture.replace(/\.[^/.]*$/, '') }) : null, pos: p.Position || { x: 0, y: 0 }, scale: p.Scale || { x: 1, y: 1 }, flip: !!p.IsFlipped };
}
episodes._heroes = heroes;
episodes._images = {
  lucky: tex({ ObjectPath: '/Game/Shared/Menu/Blueprints/EndOfEpisode/Images/Barely_ChoiceStat' }),
  perfect: tex({ ObjectPath: '/Game/Shared/Menu/Blueprints/EndOfEpisode/Images/Perfect_ChoiceStat' }),
};

// imágenes de las estadísticas
const lst = path.join(ROOT, 'work', 'eoe-tex.txt');
const outTex = path.join(ROOT, 'web', 'assets', 'eoe');
const need = [...textures].filter((t) => !fs.existsSync(path.join(outTex, 'textures', t.split('.').pop() + '.png')));
if (need.length) {
  fs.writeFileSync(lst, need.join('\n'));
  execFileSync(MESHX, [EXTRACT, outTex, lst], { stdio: 'inherit' });
}
fs.writeFileSync(path.join(ROOT, 'web', 'data', 'ui', 'eoe.json'), JSON.stringify(episodes));
console.log(`${textures.size} imágenes → web/data/ui/eoe.json`);
