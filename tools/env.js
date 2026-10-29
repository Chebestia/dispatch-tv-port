// Rutas comunes de los generadores. build.js las fija con variables de entorno:
//   DTV_ROOT    carpeta de trabajo, con work/extract (archivos del juego) y web/data, web/assets (salida)
//   DTV_MESHX   meshx.exe (CUE4Parse)
//   DTV_FFMPEG  ffmpeg.exe
//   DTV_VGM     vgmstream-cli.exe
//   DTV_GAME    instalación del juego (la carpeta que contiene Dispatch\Content)
const path = require('path');

const ROOT = process.env.DTV_ROOT || path.join(__dirname, '..');
const GAME = process.env.DTV_GAME || 'C:\\Program Files (x86)\\Steam\\steamapps\\common\\Dispatch';
module.exports = {
  ROOT,
  GAME,
  BANKS: path.join(GAME, 'Dispatch', 'Content', 'FMOD', 'Desktop'),
  MESHX: process.env.DTV_MESHX || 'meshx.exe',
  FFMPEG: process.env.DTV_FFMPEG || 'ffmpeg.exe',
  VGM: process.env.DTV_VGM || 'vgmstream-cli.exe',
};
