// Extrae los bancos FMOD del juego a Opus para el port web, banco por banco (los WAV intermedios se borran al terminar
// cada banco: uno solo puede ocupar más de 1 GB).
//   web/assets/audio/<Banco>/<muestra>.ogg   (Opus 96 kb/s)
//   web/data/audio.json                      { "nombre de muestra en minúsculas": "Banco/archivo.ogg" }
// En las cinemáticas, el nombre de la muestra es el del evento: LS_<secuencia>_FX / _DX / _BG_LOOP.
// Uso: node fmodx.js [dirBancos] [filtroDeBanco]   (retoma: saltea los bancos ya convertidos)
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const BANKS = process.argv[2] || require('./env').BANKS;
const FILTER = process.argv[3] ? new RegExp(process.argv[3], 'i') : null;
const { ROOT, VGM, FFMPEG } = require('./env');
const OUT = path.join(ROOT, 'web', 'assets', 'audio');
const INDEX = path.join(ROOT, 'web', 'data', 'audio.json');
const TMP = path.join(ROOT, 'work', 'fmodtmp');

const index = fs.existsSync(INDEX) ? JSON.parse(fs.readFileSync(INDEX)) : {};
// borrar temporales sin cortar la conversión si Windows tiene un WAV bloqueado (EPERM): reintenta y si no, lo deja
const rm = (p, opts = {}) => { try { fs.rmSync(p, { force: true, maxRetries: 5, retryDelay: 200, ...opts }); } catch (e) { console.log(`no se pudo borrar ${p}: ${e.code}`); } };
const safe = (s) => s.replace(/[^\w.\- ]+/g, '_').trim();

for (const bankFile of fs.readdirSync(BANKS).filter((f) => f.endsWith('.bank'))) {
  const bank = bankFile.replace(/\.bank$/, '');
  if (FILTER && !FILTER.test(bank)) continue;
  const outDir = path.join(OUT, bank);
  if (fs.existsSync(path.join(outDir, '.done'))) { console.log(`${bank}: ya convertido`); continue; }
  rm(TMP, { recursive: true });
  fs.mkdirSync(TMP, { recursive: true });
  fs.mkdirSync(outDir, { recursive: true });
  const t0 = Date.now();
  try {
    execFileSync(VGM, ['-S', '0', '-o', path.join(TMP, '?n.wav'), path.join(BANKS, bankFile)], { stdio: 'ignore' });
  } catch (e) {
    console.log(`${bank}: vgmstream falló (${e.message.split('\n')[0]})`);
  }
  const wavs = fs.readdirSync(TMP).filter((f) => f.endsWith('.wav'));
  let ok = 0;
  for (const w of wavs) {
    const name = w.replace(/\.wav$/, '');
    const file = `${safe(name)}.ogg`;
    try {
      execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', path.join(TMP, w), '-c:a', 'libopus', '-b:a', '96k', path.join(outDir, file)], { stdio: 'ignore' });
      index[name.toLowerCase()] = `${bank}/${file}`;
      ok++;
    } catch {}
    rm(path.join(TMP, w));
  }
  fs.writeFileSync(path.join(outDir, '.done'), String(ok));
  fs.writeFileSync(INDEX, JSON.stringify(index));
  console.log(`${bank}: ${ok}/${wavs.length} muestras en ${Math.round((Date.now() - t0) / 1000)} s`);
}
rm(TMP, { recursive: true });
console.log('listo', Object.keys(index).length, 'muestras');
