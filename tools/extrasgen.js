// Extras del menú (WBP_ExtrasMenu): "Art of Dispatch" y los cómics, con el visor WBP_ArtBookBase / WBP_ArtViewer.
// Lee DA_ExtrasPack_{Artbook,Comic}_N (AdHocExtrasContentPackagingInfo: episodo del que depende, capítulo, textos) y
// sus AdHocBookChapter (lista de páginas y PageDimensions). Exporta las páginas con tools/meshx y las pasa a JPG
// (lado mayor 2400 px; los originales pesan ~1.9 GB) en web/assets/extras/<libro>_<n>/. Salida: web/data/extras.json.
// Uso: node tools/extrasgen.js [--no-pages]
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { parse } = require('./uprops');

const { ROOT } = require('./env');
const EXTRACT = path.join(ROOT, 'work', 'extract', 'Dispatch');
const { MESHX } = require('./env');
const OUT = path.join(ROOT, 'web', 'assets', 'extras');
const TMP = path.join(ROOT, 'work', 'extras_png');
const MAX = 2400;

// /Game/... o /<Plugin>/... → archivo .uasset
function file(objPath) {
  const pkg = objPath.replace(/\.[^/.]*$/, '');
  const m = pkg.match(/^\/(\w+)\/(.*)$/);
  if (!m) return null;
  return m[1] === 'Game' ? path.join(EXTRACT, 'Content', m[2] + '.uasset') : path.join(EXTRACT, 'Plugins', m[1], 'Content', m[2] + '.uasset');
}
const props = (objPath) => {
  const f = file(objPath);
  if (!f || !fs.existsSync(f)) return null;
  return parse(f, { byIndex: true }).filter(Boolean).find((o) => /PackagingInfo|BookChapter/.test(o.class))?.props || null;
};
const short = (p) => String(p || '').split('.').pop();

// convierte con System.Drawing (Windows PowerShell): JPG calidad 86, lado mayor MAX
function toJpg(pairs) {
  if (!pairs.length) return;
  const list = path.join(TMP, 'convert.txt');
  fs.writeFileSync(list, pairs.map(([a, b]) => `${a}|${b}`).join('\n'));
  const ps = `Add-Type -AssemblyName System.Drawing
$enc = [System.Drawing.Imaging.ImageCodecInfo]::GetImageEncoders() | Where-Object { $_.MimeType -eq 'image/jpeg' }
$ep = New-Object System.Drawing.Imaging.EncoderParameters 1
$ep.Param[0] = New-Object System.Drawing.Imaging.EncoderParameter ([System.Drawing.Imaging.Encoder]::Quality), 86L
foreach ($l in Get-Content '${list.replace(/'/g, "''")}') {
  $a, $b = $l -split '\\|'
  $img = [System.Drawing.Image]::FromFile($a)
  $s = [Math]::Min(1.0, ${MAX} / [Math]::Max($img.Width, $img.Height))
  $w = [int]($img.Width * $s); $h = [int]($img.Height * $s)
  $bmp = New-Object System.Drawing.Bitmap $w, $h
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.DrawImage($img, 0, 0, $w, $h)
  $bmp.Save($b, $enc, $ep)
  $g.Dispose(); $bmp.Dispose(); $img.Dispose()
}`;
  const script = path.join(TMP, 'convert.ps1');
  fs.writeFileSync(script, ps);
  execFileSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script], { stdio: 'inherit' });
}

const pagesToo = !process.argv.includes('--no-pages');
fs.mkdirSync(TMP, { recursive: true });
const books = [];
for (const kind of ['Artbook', 'Comic']) {
  for (let n = 1; n <= 4; n++) {
    const info = props(`/Game/Shared/EpisodePackaging/Extras/DA_ExtrasPack_${kind}_${n}.DA_ExtrasPack_${kind}_${n}`);
    if (!info) continue;
    const ch = props(info.BookChapter);
    if (!ch) { console.log(`sin capítulo: ${kind} ${n}`); continue; }
    const id = `${kind.toLowerCase()}_${n}`;
    const book = {
      id, kind: kind.toLowerCase(), n, episode: short(info.DependentEpisode), episodeNum: info.EpisodeNum ?? n,
      buttonText: info.ButtonText || null, comic1: info.Comic1Text || null, comic2: info.Comic2Text || null,
      dims: ch.PageDimensions || null, pages: (ch.Pages || []).map((p) => `assets/extras/${id}/${short(p)}.jpg`),
    };
    books.push(book);
    if (!pagesToo) continue;
    const dir = path.join(OUT, id);
    fs.mkdirSync(dir, { recursive: true });
    const todo = (ch.Pages || []).filter((p) => !fs.existsSync(path.join(dir, short(p) + '.jpg')));
    if (!todo.length) continue;
    const tmp = path.join(TMP, id);
    fs.mkdirSync(tmp, { recursive: true });
    const lst = path.join(TMP, `${id}.txt`);
    fs.writeFileSync(lst, todo.join('\n'));
    execFileSync(MESHX, [path.join(ROOT, 'work', 'extract'), tmp, lst], { stdio: 'inherit' });
    toJpg(todo.map((p) => [path.join(tmp, 'textures', short(p) + '.png'), path.join(dir, short(p) + '.jpg')]).filter(([a]) => fs.existsSync(a)));
    fs.rmSync(tmp, { recursive: true, force: true });
    console.log(`${id}: ${book.pages.length} páginas`);
  }
}
// portadas y fondos del menú de extras (al lado de las otras texturas de la interfaz)
const covers = ['T_UI_Extras_Analytics', 'T_ExtrasMenu_ArtOfDispatchCover', 'T_ExtrasMenu_ComicsCover', 'Artbook_ChapterCovers_1', 'Artbook_ChapterCovers_2',
  'Artbook_ChapterCovers_3', 'Artbook_ChapterCovers_4', 'T_UI_Comics_0001_PasDeDeux+ShellShock', 'T_UI_Comics_0002_GetUp', 'T_UI_Comics_0003_DeathofMechaMan']
  .map((n) => `/Game/Shared/Menu/Widgets/ExtrasMenu/Assets/Textures/${n}.${n}`)
  .filter((p) => fs.existsSync(file(p)) && !fs.existsSync(path.join(ROOT, 'web', 'assets', 'ui', 'textures', short(p) + '.png')));
if (covers.length) {
  const lst = path.join(TMP, 'covers.txt');
  fs.writeFileSync(lst, covers.join('\n'));
  execFileSync(MESHX, [path.join(ROOT, 'work', 'extract'), path.join(ROOT, 'web', 'assets', 'ui'), lst], { stdio: 'inherit' });
}
fs.writeFileSync(path.join(ROOT, 'web', 'data', 'extras.json'), JSON.stringify({ books }, null, 1));
console.log(`${books.length} libros → web/data/extras.json`);
