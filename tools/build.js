// Arma el paquete de Dispatch TV desde la copia del juego instalada en esta PC: datos de la historia, menús, textos,
// audio e imágenes, y los videos en H.264 720p. No baja nada del juego de ningún lado: todo sale de los paks locales.
//   node build.js <carpetaDelJuego> <claveAES> <carpetaDeTrabajo> [--conservar] [--prueba]
// --conservar no borra los archivos extraídos al terminar; --prueba hace un solo banco de audio y 6 videos (y conserva).
// La carpeta del juego es la que contiene Dispatch\Content\Paks (en Steam: steamapps\common\Dispatch).
// Herramientas (variables de entorno, las fija instalar.ps1): DTV_PAKX, DTV_MESHX, DTV_FFMPEG, DTV_VGM.
// Resultado: <carpetaDeTrabajo>\web (el paquete que se copia al televisor). Retoma donde quedó si se corta.
// Ocupa ~6 GB de archivos extraídos en <carpetaDeTrabajo>\work mientras trabaja (se borran al terminar) y ~4 GB el paquete.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const [GAME, KEY, WORK] = process.argv.slice(2);
const PRUEBA = process.argv.includes('--prueba');
if (!GAME || !KEY || !WORK) { console.error('usage: node build.js <gameFolder> <aesKey> <workFolder>'); process.exit(1); }
const PAKS = path.join(GAME, 'Dispatch', 'Content', 'Paks');
const ROOT = path.resolve(WORK);
const OUT = path.join(ROOT, 'web');
const W = path.join(ROOT, 'work');
const EXTRACT = path.join(W, 'extract');
const INVENTORY = path.join(W, 'inventory.json');
const TOOLS = __dirname;
const env = { ...process.env, DTV_ROOT: ROOT, DTV_GAME: GAME };
const PAKX = env.DTV_PAKX || 'pakx.exe';
const FFMPEG = env.DTV_FFMPEG || 'ffmpeg.exe';
for (const d of [W, path.join(OUT, 'data'), path.join(OUT, 'assets')]) fs.mkdirSync(d, { recursive: true });

const t0 = Date.now();
const log = (s) => console.log(`[${((Date.now() - t0) / 60000).toFixed(1)} min] ${s}`);
const node = (script, ...args) => execFileSync(process.execPath, [path.join(TOOLS, script), ...args], { env, stdio: ['ignore', 'pipe', 'inherit'], maxBuffer: 1 << 28 }).toString().trim().split('\n').pop();
// cada paso deja una marca en work/ al terminar; al volver a correr se saltea
function step(name, fn) {
  const mark = path.join(W, `paso-${name}.ok`);
  if (fs.existsSync(mark)) return;
  log(name);
  const r = fn();
  if (r) console.log('  ' + r);
  fs.writeFileSync(mark, '');
}

if (!fs.existsSync(PAKS)) { console.error(`${PAKS} not found: is that the game folder?`); process.exit(1); }

// --- archivos del juego ---
step('inventario', () => node('pakinv.js', PAKS, KEY, INVENTORY));
step('extraccion', () => {
  // todo menos los videos (se extraen de a tandas al final para no llenar el disco)
  execFileSync(PAKX, [PAKS, KEY, INVENTORY, EXTRACT, '!^Dispatch/Content/Movies/'], { stdio: ['ignore', 'ignore', 'inherit'] });
  return 'listo';
});

// --- datos ---
for (let n = 101; n <= 108; n++) {
  step(`episodio-${n}`, () => {
    node('dumpdir.js', path.join(EXTRACT, 'Dispatch', 'Plugins', `DispatchEp${n}`, 'Content', 'Story'), path.join(W, `story${n}.json`));
    return node('compile.js', path.join(W, `story${n}.json`), path.join(OUT, 'data', `ep${n}.json`));
  });
}
step('personajes', () => node('chargen.js'));
step('menu', () => node('menugen.js'));
step('widgets', () => node('uigen.js'));
step('textos', () => node('locgen.js'));
step('qte', () => node('qtecurves.js'));
step('animaciones', () => {
  // sólo los widgets que anima el port de TV
  fs.writeFileSync(path.join(W, 'uianim-list.txt'), '/Game/Shared/Menu/Widgets/WBP_MainMenu.WBP_MainMenu\n/Game/Shared/Story/Widgets/WBP_NotificationsOverlay\n');
  return node('uianimgen.js', '--extract');
});
step('fin-de-episodio', () => node('eoegen.js'));
step('censura', () => node('censorgen.js'));
step('extras', () => node('extrasgen.js'));

// --- imágenes y fuentes ---
step('texturas', () => {
  // las de la interfaz que usa el port (tools/ui-textures.txt) más el arte de menús y widgets que listan menugen y uigen
  const list = new Set();
  for (const f of [path.join(TOOLS, 'ui-textures.txt'), path.join(W, 'menu-textures.txt'), path.join(W, 'ui-assets.txt')]) {
    for (const l of fs.readFileSync(f, 'utf8').split(/\r?\n/)) if (l.trim() && !/\/(MI_|M_)[^/]*$/.test(l.trim())) list.add(l.trim()); // sin materiales (carpetas MI_UI sí)
  }
  const lst = path.join(W, 'texturas.txt');
  fs.writeFileSync(lst, [...list].join('\n'));
  execFileSync(env.DTV_MESHX || 'meshx.exe', [EXTRACT, path.join(OUT, 'assets', 'ui'), lst], { stdio: ['ignore', 'ignore', 'inherit'] });
  // meshx también crea estas carpetas; el port de TV no usa materiales ni mallas
  for (const d of ['materials', 'meshes']) fs.rmSync(path.join(OUT, 'assets', 'ui', d), { recursive: true, force: true });
  return `${fs.readdirSync(path.join(OUT, 'assets', 'ui', 'textures')).length} texturas`;
});
step('fuentes', () => {
  // los .ufont de UE son TTF
  const dst = path.join(OUT, 'assets', 'fonts');
  fs.mkdirSync(dst, { recursive: true });
  let n = 0;
  for (const dir of ['UI/Fonts/Montserrat/static', 'UI/Fonts/Orbitron', 'UI/Fonts/Rajdhani', 'Shifts/Art/Fonts/schaboxcondensed']) {
    const src = path.join(EXTRACT, 'Dispatch', 'Content', 'Shared', ...dir.split('/'));
    for (const f of fs.readdirSync(src)) if (f.endsWith('.ufont')) { fs.copyFileSync(path.join(src, f), path.join(dst, f.replace(/\.ufont$/, '.ttf'))); n++; }
  }
  return `${n} fuentes`;
});

// --- audio: bancos FMOD de la historia (sin los comentarios de los desarrolladores ni las voces de los turnos) ---
step('audio', () => node('fmodx.js', path.join(GAME, 'Dispatch', 'Content', 'FMOD', 'Desktop'), PRUEBA ? '^SharedSFX$' : '^(?!.*DevCommentary)(?!Shift)(?!SharedShiftVO)'));
step('eventos-de-audio', () => node('fmodmap.js', path.join(GAME, 'Dispatch', 'Content', 'FMOD', 'Desktop')));

// --- código del port ---
step('codigo', () => {
  const web = path.join(TOOLS, '..', 'web');
  for (const f of fs.readdirSync(web)) fs.copyFileSync(path.join(web, f), path.join(OUT, f));
  return 'listo';
});

// --- videos: H.264 720p, de a tandas (cada tanda se extrae, se recodifica y se borra) ---
const videos = new Set();
for (let e = 101; e <= 108; e++) {
  for (const n of Object.values(JSON.parse(fs.readFileSync(path.join(OUT, 'data', `ep${e}.json`))).nodes)) if (n.video) videos.add(n.video);
}
for (const f of ['menu.json', 'ui/eoe.json']) {
  for (const m of fs.readFileSync(path.join(OUT, 'data', f), 'utf8').matchAll(/movies\/([^"]+?\.webm)/g)) videos.add(m[1]);
}
const real = new Map();
for (const f of JSON.parse(fs.readFileSync(INVENTORY)).files) {
  if (f[1].startsWith('Dispatch/Content/Movies/')) real.set(f[1].slice(24).toLowerCase(), f[1].slice(24));
}
const mp4 = (v) => path.join(OUT, 'movies', v.replace(/\.webm$/, '.mp4'));
const todo = [...videos].filter((v) => !fs.existsSync(mp4(v))).slice(0, PRUEBA ? 6 : Infinity);
log(`videos: ${videos.size}, ${todo.length} to do`);
const SRC = path.join(W, 'videos');
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const tv = Date.now();
let failed = 0;
for (let i = 0; i < todo.length; i += 25) {
  const batch = todo.slice(i, i + 25);
  fs.rmSync(SRC, { recursive: true, force: true });
  const re = `^Dispatch/Content/Movies/(${batch.map((v) => esc(real.get(v.toLowerCase()) || v)).join('|')})$`;
  try { execFileSync(PAKX, [PAKS, KEY, INVENTORY, SRC, re], { stdio: 'ignore', windowsHide: true }); } catch (e) { console.log('  pakx failed:', e.message.split('\n')[0]); }
  for (const v of batch) {
    const src = path.join(SRC, 'Dispatch', 'Content', 'Movies', real.get(v.toLowerCase()) || v);
    if (!fs.existsSync(src)) { console.log('  could not extract', v); failed++; continue; }
    const dst = mp4(v);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    // 720p (sin agrandar los más chicos), mismos tiempos que el original (el reproductor sincroniza con currentTime),
    // un cuadro clave cada 2 s para saltar rápido dentro de una escena
    try {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', src, '-map', '0:v:0', '-map', '0:a?', '-vf', "scale=-2:'min(720,ih)'",
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-profile:v', 'high', '-level', '4.0', '-pix_fmt', 'yuv420p', '-g', '60',
        '-fps_mode', 'passthrough', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', `${dst}.tmp.mp4`], { stdio: 'inherit' });
      fs.renameSync(`${dst}.tmp.mp4`, dst);
    } catch (e) { console.log('  re-encoding failed', v); failed++; }
  }
  fs.rmSync(SRC, { recursive: true, force: true });
  const min = (Date.now() - tv) / 60000, done = Math.min(i + 25, todo.length);
  log(`videos ${done}/${todo.length} (~${((min / done) * (todo.length - done)).toFixed(0)} min left)`);
}

if (failed) { console.log(`\n${failed} videos failed: run it again to retry them.`); process.exit(2); }
// los archivos extraídos ya no hacen falta (el inventario queda para el servidor)
if (!PRUEBA && !process.argv.includes('--conservar')) fs.rmSync(EXTRACT, { recursive: true, force: true });
let total = 0;
(function walk(d) { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else total += fs.statSync(p).size; } })(OUT);
log(`done: ${(total / 1e9).toFixed(2)} GB package in ${OUT}`);
