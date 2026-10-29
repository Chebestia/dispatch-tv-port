// Idioma de los módulos (hackeo, turnos, dossier): el que eligió el jugador en Ajustes o, si no eligió, "Por defecto"
// como el juego: la cultura del sistema subiendo por su cadena de padres de CLDR (misma regla que systemLang de
// player.js): es-ES → es, español de América → es-419, zh-TW/HK/MO → zh-Hant, el resto por su idioma base.
const LANGS = ['es-419', 'es', 'en', 'pt-BR', 'fr', 'de', 'it', 'pl', 'ru', 'uk', 'tr', 'ja', 'ko', 'zh-Hans', 'zh-Hant', 'th'];
const LATAM = /^es-(419|AR|BO|BR|BZ|CL|CO|CR|CU|DO|EC|GT|HN|MX|NI|PA|PE|PR|PY|SV|US|UY|VE)$/i;

export function systemLang() {
  for (const raw of (navigator.languages?.length ? navigator.languages : [navigator.language]) || []) {
    const l = String(raw || '');
    if (/^es/i.test(l)) return LATAM.test(l) ? 'es-419' : 'es';
    if (/^zh-(TW|HK|MO|Hant)/i.test(l)) return 'zh-Hant';
    if (/^zh/i.test(l)) return 'zh-Hans';
    if (/^pt/i.test(l)) return 'pt-BR';
    const base = l.split('-')[0].toLowerCase();
    if (LANGS.includes(base)) return base;
  }
  return 'en';
}

export function currentLang() {
  try { if (localStorage.getItem('dispatch-web-lang-chosen')) return localStorage.getItem('dispatch-web-lang') || systemLang(); } catch {}
  return systemLang();
}
