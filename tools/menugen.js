// Datos de los menús → web/data/menu.json y work/menu-textures.txt (arte de episodios y escenas para meshx).
// Episodios: EpisodePackageInfoRegistry → EPI_EpNNN (nombre, sinopsis, arte, fecha de desbloqueo).
// Escenas: SavePointRegistry_Dispatch_NNN → SavePoint_* (nodo de guardado, rebobinable, imagen).
// Fondos del menú principal: FMS_MainMenuBackdrop(_epN|_endGame) → Movies/Menus/*.webm.
const fs = require('fs');
const path = require('path');
const { parse } = require('./uprops');

const { ROOT } = require('./env');
const EX = path.join(ROOT, 'work', 'extract', 'Dispatch');
// /Game/... → Content, /DispatchEp101/... → Plugins/DispatchEp101/Content
const file = (pkg) => {
  const p = pkg.replace(/\.[^/]*$/, '');
  const m = p.match(/^\/(\w+)\/(.*)$/);
  return m[1] === 'Game' ? path.join(EX, 'Content', m[2] + '.uasset') : path.join(EX, 'Plugins', m[1], 'Content', m[2] + '.uasset');
};
const props = (pkg) => Object.values(parse(file(pkg)))[0].props;
const textures = new Set();
const tex = (p) => { if (!p) return null; textures.add(p); return p.replace(/^.*\./, ''); };

const reg = props('/Game/Shared/EpisodePackaging/EpisodePackageInfoRegistry');
const episodes = reg.EpisodeInfos.map((epi) => {
  const p = props(epi);
  const num = p.EpisodeNumber;
  const id = String(100 + num);
  let scenes = [];
  const regFile = file(`/DispatchEp${id}/Story/SavePoints/SavePointRegistry_Dispatch_${id}`);
  if (fs.existsSync(regFile)) {
    scenes = Object.values(parse(regFile))[0].props.SavePointInfos.map((sp) => {
      const s = props(sp);
      return { id: sp.replace(/^.*\./, ''), node: s.SaveNode.replace(/^.*\./, ''), rewindable: !!s.bIsRewindableScene, image: tex(s.DisplayImage) };
    });
  }
  // ExpectedUnlockTime: ticks de 100 ns desde el año 1 (FDateTime) → ms de Unix
  const unlock = p.ExpectedUnlockTime ? Number((BigInt(p.ExpectedUnlockTime) - 621355968000000000n) / 10000n) : null;
  return { num, id, name: p.EpisodeName, blurb: p.EpisodeBlurb, packagingName: p.EpisodePackagingName, art: tex(p.EpisodeArt), buttonArt: tex(p.EpisodeButtonArt), unlock, scenes };
});

const backdrops = {};
const bd = path.join(EX, 'Content', 'Shared', 'Menu', 'BackdropVideo');
for (const f of fs.readdirSync(bd).filter((f) => f.endsWith('.uasset'))) {
  const p = Object.values(parse(path.join(bd, f)))[0].props;
  backdrops[f.replace(/^FMS_MainMenuBackdrop_?|\.uasset$/g, '') || 'ep1'] = p.FilePath.replace(/^\.\/Movies\//, 'movies/');
}

fs.writeFileSync(path.join(ROOT, 'web', 'data', 'menu.json'), JSON.stringify({ episodes, backdrops }, null, 1));
fs.writeFileSync(path.join(ROOT, 'work', 'menu-textures.txt'), [...textures].join('\n'));
console.log(`${episodes.length} episodios, ${episodes.reduce((a, e) => a + e.scenes.length, 0)} escenas, ${textures.size} imágenes, fondos: ${Object.keys(backdrops).join(' ')}`);
