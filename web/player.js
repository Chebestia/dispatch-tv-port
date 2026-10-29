// Reproductor de Dispatch: recorre el grafo de historia compilado y encadena los clips de video.
'use strict';

const $ = (id) => document.getElementById(id);
const videos = [$('v0'), $('v1')];
let active = 0;          // índice del video visible
let graph = null;
let state = null;        // { episode, node, vars }
let current = null;      // nodo en reproducción
let chosen = false;
let qteDone = new Set();
let raf = 0;

const SAVE_KEY = 'dispatch-web-save';
const LANG_KEY = 'dispatch-web-lang';
// idiomas de Content/Localization
const LANGS = { 'es-419': 'Español (Latinoamérica)', es: 'Español (España)', en: 'English', 'pt-BR': 'Português (Brasil)', fr: 'Français', de: 'Deutsch', it: 'Italiano', pl: 'Polski', ru: 'Русский', uk: 'Українська', tr: 'Türkçe', ja: '日本語', ko: '한국어', 'zh-Hans': '简体中文', 'zh-Hant': '繁體中文', th: 'ไทย' };
// Idioma "Por defecto" como el juego (UE toma la cultura de la interfaz y sube por su cadena de padres de CLDR):
// es-ES → es, español de América (padre es-419) → es-419, zh-TW/HK/MO → zh-Hant, el resto por su idioma base.
function systemLang() {
  const LATAM = /^es-(419|AR|BO|BR|BZ|CL|CO|CR|CU|DO|EC|GT|HN|MX|NI|PA|PE|PR|PY|SV|US|UY|VE)$/i;
  for (const raw of (typeof navigator !== 'undefined' && (navigator.languages?.length ? navigator.languages : [navigator.language])) || []) {
    const l = String(raw || '');
    if (/^es/i.test(l)) return LATAM.test(l) ? 'es-419' : 'es';
    if (/^zh-(TW|HK|MO|Hant)/i.test(l)) return 'zh-Hant';
    if (/^zh/i.test(l)) return 'zh-Hans';
    if (/^pt/i.test(l)) return 'pt-BR';
    const base = l.split('-')[0].toLowerCase();
    if (LANGS[base]) return base;
  }
  return 'en';
}
let lang = systemLang();
let loc = {}; // "Namespace/Key" -> texto traducido
// (el idioma guardado sólo manda si el jugador lo eligió en Ajustes; si no, "Por defecto" sigue al sistema)
try { if (localStorage.getItem(`${LANG_KEY}-chosen`)) lang = localStorage.getItem(LANG_KEY) || lang; localStorage.setItem(LANG_KEY, lang); } catch {}

async function loadLang(l, chosen) {
  lang = l;
  try { localStorage.setItem(LANG_KEY, l); if (chosen) localStorage.setItem(`${LANG_KEY}-chosen`, '1'); } catch {}
  try { loc = await (await fetch(`data/loc/${l}.json`)).json(); } catch { loc = {}; }
}
const lineText = (t) => (t[2] && loc[t[2]]) || t[1];
const optionText = (o) => (o.textKey && loc[o.textKey]) || o.text;
// variables Shared/ con las que arranca cada episodio: { ep102: {...}, ... }, se guardan al terminar el anterior
const SHARED_KEY = 'dispatch-web-shared';
const EPISODES = [101, 102, 103, 104, 105, 106, 107, 108].map((n) => 'ep' + n);

function save() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch {}
}

function load() {
  try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; }
}

function loadShared() {
  try { return JSON.parse(localStorage.getItem(SHARED_KEY)) || {}; } catch { return {}; }
}

// lo que pasa de un episodio al siguiente: en el original todas las variables de la historia viven en la partida
// (AdHocSaveGameSubsystem), no sólo las de /Game/Shared. Las de cada episodio se consultan después (Var_Threw_Water del 1
// en el 2–5, Var_Cut_Sonar del 3 en el 4–8…) y el progreso de los turnos (__heroes, __careerRank, __shiftVars) también
// sigue. Los nombres no chocan: sólo se repiten entre /Game/Shared y el episodio 1, y ésas llevan el prefijo Shared/.
function sharedVars(vars) {
  return { ...vars };
}

// --- condiciones ---
function evalExpr(e) {
  if (!e) return true;
  if ('v' in e) return state.vars[e.v] ?? graph.defaults?.[e.v] ?? false;
  if ('lit' in e) return e.lit;
  if ('cond' in e) return evalExpr(graph.conditions[e.cond]);
  if (e.cmp) {
    const l = evalExpr(e.l), r = evalExpr(e.r);
    switch (e.cmp) {
      case 'Equal': return l == r;
      case 'NotEqual': return l != r;
      case 'Greater': return l > r;
      case 'GreaterOrEqual': return l >= r;
      case 'Less': return l < r;
      case 'LessOrEqual': return l <= r;
    }
    return false;
  }
  if (e.op === 'and') return e.of.every(evalExpr);
  if (e.op === 'or') return e.of.some(evalExpr);
  console.warn('expresión desconocida', e);
  return false;
}

const passes = (condId) => !condId || evalExpr(graph.conditions[condId]);

function applySets(n) {
  for (const [v, op, val] of n.set || []) {
    if (op === '=') state.vars[v] = val;
    else if (op === '+') state.vars[v] = (state.vars[v] || 0) + val;
  }
}

// --- audio FMOD (web/assets/audio, tools/fmodx.js) ---
// Los videos vienen mudos: el diálogo (LS_<secuencia>_DX), los efectos (_FX), los eventos explícitos de la secuencia
// y el ambiente (BG_LOOP, se mantiene entre nodos) salen de los bancos FMOD convertidos a Opus.
let audioIndex = {};
let clipAudio = []; // [{ el, start (ms), started }]
let bgAudio = null, bgName = null;
const VOLUME_BASE = { DX: 1, FX: 0.8, BG: 0.45, music: 0.5, other: 0.8 };
// ajustes de sonido del menú (DispatchSettings): global × VO / SFX / música de cinemáticas
const settings = () => window.dispatchSettings || {};
const VOLUME = new Proxy(VOLUME_BASE, { get: (t, k) => {
  const s = settings(), m = s.MasterVolume ?? 1;
  const part = k === 'DX' ? s.VOVolume : k === 'music' ? (window.Player?.inShift ? s.MusicVolumeGameplay : s.MusicVolumeCinematics) : s.SFXVolume;
  // DialogueBoost: baja lo que no es diálogo para que las voces se destaquen
  const boost = s.DialogueBoost && k !== 'DX' ? 0.6 : 1;
  return (t[k] ?? 0.8) * m * (part ?? 1) * boost;
} });
// MonoAudio: cada audio o video que suena pasa por un AudioContext con salida de un canal (mezcla a mono)
(() => {
  let ctx = null;
  const routed = new WeakSet();
  const play = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (...a) {
    if (ctx) ctx.destination.channelCount = settings().MonoAudio ? 1 : Math.min(2, ctx.destination.maxChannelCount || 2);
    if (settings().MonoAudio && !routed.has(this)) {
      try {
        ctx ||= new AudioContext();
        ctx.destination.channelCount = 1;
        ctx.destination.channelInterpretation = 'speakers';
        ctx.createMediaElementSource(this).connect(ctx.destination);
        routed.add(this);
        ctx.resume?.();
      } catch {}
    }
    return play.apply(this, a);
  };
})();
const audioKind = (name) => (/_DX/i.test(name) ? 'DX' : /_FX/i.test(name) ? 'FX' : /BG/i.test(name) ? 'BG' : 'other');

// audio censurado (StreamerModeCensoredAudio = parámetro global Censor de FMOD): en cada evento con insultos, el
// instrumento "Censor Sine Wave" suena en su tramo de la línea de tiempo (data/fmod-censor.json: [ms, largo]).
// APROX: la voz se silencia durante el pitido (en FMOD queda debajo del seno a +10 dB).
let censorBeeps = {}, censorSrc = null;
function censorAudio(el, name) {
  const beeps = censorBeeps[name];
  if (!beeps || !censorSrc) return;
  let beep = null, on = -1;
  const base = () => el._censorVol ?? el.volume;
  const tick = () => {
    if (!el.src || el.ended) { clearInterval(iv); beep?.pause(); return; }
    const ms = el.currentTime * 1000;
    const i = settings().StreamerModeCensoredAudio && !el.paused ? beeps.findIndex(([at, len]) => ms >= at && ms < at + len) : -1;
    if (i === on) return;
    if (on < 0) el._censorVol = el.volume;
    on = i;
    if (i >= 0) {
      el.volume = 0;
      beep ||= new Audio(censorSrc);
      beep.volume = Math.min(1, VOLUME.DX);
      try { beep.currentTime = 0; } catch {}
      beep.play().catch(() => {});
    } else {
      el.volume = base();
      el._censorVol = null;
      beep?.pause();
    }
  };
  const iv = setInterval(tick, 20);
}

let fmodEvents = {}; // evento FMOD -> muestras (tools/fmodmap.js)
async function loadAudioIndex() {
  try { audioIndex = await (await fetch('data/audio.json', { cache: 'no-store' })).json(); } catch { audioIndex = {}; }
  try { fmodEvents = await (await fetch('data/fmod-events.json', { cache: 'no-store' })).json(); } catch { fmodEvents = {}; }
  try { censorBeeps = await (await fetch('data/fmod-censor.json', { cache: 'no-store' })).json(); } catch { censorBeeps = {}; }
  const f = Object.values(fmodEvents).flat().find((x) => /Censor Sine Wave/i.test(x));
  censorSrc = f ? `assets/audio/${f}` : null;
}
// muestras de un evento: la de mismo nombre (cinemáticas) o las que referencia el evento en el banco
// (las voces con insulto llevan además el instrumento "Censor Sine Wave", condicionado al parámetro global Censor de
// FMOD: sólo suena con el audio censurado. APROX: no se reproduce el pitido; se toca siempre la voz)
function eventFiles(name) {
  const direct = audioIndex[String(name).toLowerCase()];
  return direct ? [direct] : (fmodEvents[name] || []).filter((f) => !/Censor Sine Wave/i.test(f));
}
const audioUrl = (name) => { const f = eventFiles(name)[0]; return f && `assets/audio/${f}`; };

// música: los eventos son interactivos (partes que avanzan por parámetros); APROX: las partes en orden y la última en bucle
let music = null, musicName = null;
function setMusic(name) {
  if (!name || name === musicName) return;
  const files = [...eventFiles(name)].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!files.length) return;
  musicName = name;
  const old = music;
  let i = 0;
  const el = new Audio(`assets/audio/${files[0]}`);
  el.volume = 0;
  el.onended = () => {
    i = Math.min(i + 1, files.length - 1);
    el.src = `assets/audio/${files[i]}`;
    el.loop = i === files.length - 1;
    el.play().catch(() => {});
  };
  el.loop = files.length === 1;
  el.play().catch(() => {});
  fade(el, VOLUME.music, 2);
  if (old) fade(old, 0, 2, () => old.pause());
  music = el;
}

function stopClipAudio() {
  for (const a of clipAudio) { a.el.pause(); a.el.src = ''; }
  clipAudio = [];
}
function startClipAudio(n) {
  stopClipAudio();
  const events = (n.audio || []).map(([start, , name]) => ({ start, name }));
  for (const suffix of ['_DX', '_FX']) {
    const name = n.seq && n.seq + suffix;
    if (name && !events.some((e) => e.name.toLowerCase() === name.toLowerCase())) events.push({ start: 0, name });
  }
  for (const e of events) {
    const src = audioUrl(e.name);
    if (!src) continue;
    const el = new Audio(src);
    el.preload = 'auto';
    el.volume = VOLUME[audioKind(e.name)];
    censorAudio(el, e.name);
    clipAudio.push({ el, start: e.start, started: false });
  }
  setMusic(n.music);
  // ambiente: cambia sólo si la secuencia fija otro (KeepState)
  if (n.bg && n.bg !== bgName && audioUrl(n.bg)) {
    const old = bgAudio;
    bgName = n.bg;
    bgAudio = new Audio(audioUrl(n.bg));
    bgAudio.loop = true;
    bgAudio.volume = 0;
    bgAudio.play().catch(() => {});
    fade(bgAudio, VOLUME.BG, 1);
    if (old) fade(old, 0, 1, () => old.pause());
  }
}
function fade(el, to, seconds, done) {
  const from = el.volume, t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / (seconds * 1000));
    el.volume = from + (to - from) * k;
    if (k < 1) requestAnimationFrame(step); else if (done) done();
  };
  step();
}
// --- tiempo de la secuencia ---
// El nodo dura LevelSequenceLengthMs. Mientras el video corre, su tiempo manda; si termina antes que la secuencia
// (bucles de QTE: video de ~1 s en una secuencia de ~3,7 s), queda en el último cuadro y el reloj sigue.
let hold = null; // { at: ms de video al terminar, t0: performance.now() }
function seqMs(v) {
  if (hold) return hold.at + (performance.now() - hold.t0);
  return v.currentTime * 1000;
}
const seqRunning = (v) => !!hold || !v.paused;

// cada cuadro: arrancar cada sonido en su tiempo y corregir si se separa más de 0,25 s
function syncClipAudio(v) {
  const ms = seqMs(v);
  for (const a of clipAudio) {
    const t = (ms - a.start) / 1000;
    if (t < 0) continue;
    if (!seqRunning(v)) { if (!a.el.paused) a.el.pause(); continue; }
    if (!a.started || a.el.paused) {
      if (a.el.ended || (a.el.duration && t >= a.el.duration)) continue;
      a.started = true;
      try { a.el.currentTime = t; } catch {}
      a.el.play().catch(() => {});
    } else if (Math.abs(a.el.currentTime - t) > 0.25 && !a.el.ended) {
      try { a.el.currentTime = t; } catch {}
    }
  }
}
// API para los minijuegos: música del turno y efectos sueltos (PlayEvent2D)
// sonidos sueltos: se liberan al terminar y hay un tope (el navegador limita los reproductores de medios)
const loose = new Set();
function looseAudio(src) {
  if (loose.size >= 24) return null;
  const el = new Audio(src);
  loose.add(el);
  const free = () => { loose.delete(el); el.removeAttribute('src'); el.load(); };
  el.addEventListener('ended', free, { once: true });
  el.addEventListener('error', free, { once: true });
  setTimeout(() => { if (loose.has(el) && (el.paused || el.ended)) free(); }, 30000);
  return el;
}
function sfx(name, volume = 0.8) {
  const src = audioUrl(name);
  if (!src) return;
  const el = looseAudio(src);
  if (!el) return;
  const s = settings();
  el.volume = Math.min(1, volume * (s.MasterVolume ?? 1) * (s.SFXVolume ?? 1));
  censorAudio(el, name);
  el.play().catch(() => {});
}
// hackeo: la música de la escena sigue, pasando a su parte "Hacking" si la tiene (p. ej. EP01_Music_Hangar)
function hackingMusic() {
  const files = eventFiles(musicName || '').filter((f) => /hacking/i.test(f));
  if (!files.length || !music) return;
  music.onended = null;
  music.src = `assets/audio/${files[0]}`;
  music.loop = true;
  music.play().catch(() => {});
}
// voz suelta (VO del hackeo): devuelve el elemento para encadenar líneas
function voice(name) {
  // multi-instrumento de FMOD: una de sus variantes al azar
  const files = eventFiles(name);
  if (!files.length) return null;
  const src = `assets/audio/${files[Math.floor(Math.random() * files.length)]}`;
  const el = looseAudio(src);
  if (!el) return null;
  el.volume = Math.min(1, VOLUME.DX);
  if (files.length === 1) censorAudio(el, name);
  el.play().catch(() => {});
  return el;
}
window.dispatchAudio = { setMusic: (name) => setMusic(name), sfx, hackingMusic, voice, files: (name) => eventFiles(name) };

function pauseAllAudio() { for (const a of clipAudio) a.el.pause(); if (bgAudio) bgAudio.pause(); if (music) music.pause(); }
function resumeBg() { if (bgAudio && bgAudio.paused) bgAudio.play().catch(() => {}); if (music && music.paused) music.play().catch(() => {}); }

// --- video ---
// televisor: los videos van recodificados a H.264 720p (tools/build.js), con la misma ruta pero .mp4
const url = (video) => 'movies/' + video.replace(/\.webm$/, '.mp4');

function preload(nodeId) {
  const n = graph.nodes[nodeId];
  const target = n && firstVideoFrom(nodeId);
  if (!target) return;
  const v = videos[1 - active];
  if (!v.src.endsWith(url(target))) { v.src = url(target); v.load(); }
}

// sigue ramas sin video hasta encontrar el próximo clip probable
function firstVideoFrom(nodeId, depth = 0) {
  const n = graph.nodes[nodeId];
  if (!n || depth > 8) return null;
  if (n.video) return n.video;
  if (n.type === 'branch') {
    const p = n.paths.find((x) => passes(x.if)) || n.paths[0];
    return p && firstVideoFrom(p.next, depth + 1);
  }
  return n.next ? firstVideoFrom(n.next, depth + 1) : null;
}

function show(v) {
  videos.forEach((x, i) => x.classList.toggle('on', x === v));
  active = videos.indexOf(v);
  const other = videos[1 - active];
  other.pause();
}

// --- nodos ---
function go(nodeId) {
  cancelAnimationFrame(raf);
  hold = null;
  hideUi();
  const n = graph.nodes[nodeId];
  if (!n && !nodeId) { endEpisode(); return; }
  if (!n) { endCard(`Fin del contenido disponible (${nodeId})`); return; }
  current = { id: nodeId, ...n };
  state.node = nodeId;
  // nodos recorridos (AdHocChoiceStatStory.OptionNode los consulta al final del episodio)
  (state.visited ||= []).includes(nodeId) || state.visited.push(nodeId);
  applySets(n);
  save();
  hooks.node?.(state, nodeId); // puntos de guardado (SavePointInfo.SaveNode) en menu.js
  $('debug').textContent = nodeId;

  switch (n.type) {
    case 'branch': {
      const p = n.paths.find((x) => passes(x.if)) || n.paths[n.paths.length - 1];
      go(p && p.next);
      return;
    }
    case 'gameplay':
      // televisor: sin minijuegos. El hackeo cuenta como superado (Var_Hacking_Success), el turno de práctica como bien
      // jugado (LV_Shift01: Played_Tutorial_Well) y el último despacho del episodio 8 como logrado (EndShift8:
      // Var_Failed_Last_Dispatch = false; sin valor, Cond_Succeeded_Last_Dispatch no pasa). Los demás turnos, sus cierres
      // y la base de datos de héroes no dejan variables que lea la historia: se pasa directo a la escena siguiente
      if (/^LV_Hacking_/.test(n.level)) state.vars['Shared/Var_Hacking_Success'] = true;
      if (n.level === 'LV_Shift01') Object.assign(state.vars, { Var_Played_Tutorial_Well: true, Var_Played_Tutorial_Poorly: false });
      if (/^LV_Shift08/.test(n.level)) state.vars.Var_Failed_Last_Dispatch = false;
      go(n.next);
      return;
    case 'exch':
    case 'choice':
      playClip(n);
      return;
    default:
      go(n.next);
  }
}

function playClip(n) {
  chosen = false;
  cutWait = null;
  qteDone = new Set();
  if (!n.video) { finish(); return; }
  let v = videos[1 - active];
  if (!v.src.endsWith(url(n.video))) { v.src = url(n.video); }
  v.currentTime = 0;
  hold = null;
  // si la secuencia dura más que el video, el nodo sigue en el último cuadro hasta su largo (ver seqMs)
  v.onended = () => {
    if (n.length && v.currentTime * 1000 < n.length - 60) hold = { at: v.currentTime * 1000, t0: performance.now() };
    else finish();
  };
  startClipAudio(n);
  resumeBg();
  v.play().then(() => {
    show(v);
    if (n.type === 'exch' && n.next) preload(n.next);
    if (n.type === 'choice') {
      const def = n.options.find((o) => o.def) || n.options[0];
      const t = def && resolveOption(def);
      if (t) preload(t);
    }
  }).catch((e) => {
    // video que no está en los paks (Ep108 SQ0030-0020c): la escena sigue con su reloj sobre negro (subtítulos y audio)
    // hasta su largo o el final del último subtítulo, para no trabar la historia
    console.error('no se pudo reproducir', n.video, e);
    if (current !== n || hold) return;
    for (const x of videos) x.classList.remove('on');
    hold = { at: 0, t0: performance.now(), until: n.length || (n.subs?.length ? n.subs[n.subs.length - 1][1] + 400 : 1000) };
  });
  raf = requestAnimationFrame(tick);
}

// Decisiones resueltas por QTE: opciones de acción (SUCCESS/FAIL, bucle) sin opción por defecto.
// Acierto -> primera opción; fallo -> segunda (fallo o repetición), o la primera si no hay otra.
const isQteChoice = (n) => n.type === 'choice' && n.qte && !n.options.some((o) => o.def);
const qteOutcome = (ok) => current.options[ok ? 0 : 1] || current.options[0];

function finish() {
  cancelAnimationFrame(raf);
  if (!current) return;
  if (cutWait) { const w = cutWait; chosen = false; pick(w.o); return; }
  if (isQteChoice(current)) {
    if (!chosen) pick(qteOutcome(false));
  } else if (current.type === 'choice') {
    if (!chosen) pick(current.options.find((o) => o.def && passes(o.if)) || current.options.find((o) => passes(o.if)));
  } else go(current.next);
}

function resolveOption(o, cut) {
  const ok = o.to.filter((t) => passes(t.if));
  // idle complejo: la salida del corte en que se pasa a la respuesta (la última si ya no quedan cortes)
  const edge = cut != null && ok.length > 1 ? ok[Math.min(cut, ok.length - 1)] : ok[0];
  return edge && edge.next;
}

// Idle complejo (bIsComplexIdle + ComplexIdleCutOutSection): al elegir, el idle sigue hasta el próximo punto de corte y
// ahí pasa a la respuesta de ese corte (Node_…_In1 en el primero, _In2 en el segundo…); si ya pasaron todos, al final
// de la secuencia con la última. APROX: la lógica es nativa (AdHocStory); sale de los nombres y de que en todas las
// decisiones del juego hay exactamente una salida más que cortes.
let cutWait = null; // { o, cut, at }
function cutPick(o) {
  const ms = seqMs(videos[active]);
  const k = current.cuts.filter((c) => c <= ms).length;
  cutWait = { o, cut: k, at: k < current.cuts.length ? current.cuts[k] : current.length || Infinity };
}

function pick(o) {
  if (chosen || !o) return;
  chosen = true;
  if (current.complexIdle && current.cuts?.length && o.to.length > 1 && !cutWait) {
    cutPick(o);
    if (cutWait.at > seqMs(videos[active]) + 30) return; // tick pasa a la respuesta al llegar al corte
  }
  const cut = cutWait ? cutWait.cut : null;
  cutWait = null;
  let next = resolveOption(o, cut);
  if (!next) {
    // opciones sin destino propio: continuar por la primera que sí tenga
    const alt = current.options.find((x) => x !== o && resolveOption(x));
    next = alt && resolveOption(alt);
    console.warn('opción sin destino', o.text, '→', next);
  }
  go(next);
}

// --- UI por cuadro ---
function tick() {
  const v = videos[active];
  const ms = seqMs(v);
  const n = current;
  if (v.classList.contains('on') && v.src.endsWith(url(n?.video || ''))) syncClipAudio(v);
  window.DispatchCensor?.update(v, n?.video); // censura visual (web/censor.js)
  if (hold && n && ms >= (hold.until ?? n.length)) { hold = null; finish(); return; }
  if (cutWait && ms >= cutWait.at) { const w = cutWait; chosen = false; pick(w.o); return; }
  if (n && (n.type === 'exch' || n.type === 'choice')) {
    const s = n.subs && n.subs.find((x) => ms >= x[0] && ms < x[1]);
    const t = s && graph.text[s[2]];
    renderSubtitle(s, t, ms);

    if (n.type === 'choice' && n.choice && !chosen && !isQteChoice(n)) {
      const [a, b] = n.choice;
      if (ms >= a) {
        if ($('choice').hidden) showChoice(n);
        setTimer(Math.max(0, 1 - (ms - a) / (b - a)));
      }
    }
    // go() arranca su propio bucle de tick: si el QTE resolvió la decisión, no encadenar otro
    if (updateQte(n, ms)) return;
  }
  updateNotes(n, ms);
  raf = requestAnimationFrame(tick);
}

// --- avisos de la historia (StoryNotificationSceneSection → WBP_NotificationsOverlay) ---
// StoryNotificationOverlay en (40, 40) del lienzo de 1920 × 1080 (o NotificationOffset), ícono T_UI_Icon_Map_Alert con
// borde y el texto enriquecido (^nombre^ resaltado) con su sombra; StoryNotificationEnter (0.5 s) al empezar la sección y
// StoryNotificationExit (0.35 s) al terminar. El TopLeftShadow (degradado de la esquina) acompaña la animación.
let noteEl = null, noteKey = null;
function noteText(t) { return (t && (loc[`${t.ns}/${t.key}`] ?? t.src)) || ''; }
function updateNotes(n, ms) {
  const x = n?.notes?.find((y) => ms >= y.t[0] && ms < y.t[1]);
  const key = x ? `${n.id}:${x.t[0]}` : null;
  if (key === noteKey) return;
  const old = noteEl;
  if (old) { noteEl = null; import('./uianim.js').then((UA) => UA.play(old, 'WBP_NotificationsOverlay', 'StoryNotificationExit', { map: { StoryNotificationContainer: '.nt-box', TopLeftShadow: '.nt-shadow' } }).then(() => old.remove())).catch(() => old.remove()); }
  noteKey = key;
  if (!x) return;
  const el = document.createElement('div');
  el.className = 'nt';
  const [ox, oy] = x.offset || [40, 40];
  el.style.setProperty('--ox', ox);
  el.style.setProperty('--oy', oy);
  const html = esc(noteText(x.text)).replace(/\^(.+?)\^/g, '<b>$1</b>');
  el.innerHTML = `<i class="nt-shadow" data-w="TopLeftShadow"></i><div class="nt-box" data-w="StoryNotificationContainer"><span class="nt-icon"><i></i></span><span class="nt-text"><span class="nt-sh">${html}</span><span class="nt-tx">${html}</span></span></div>`;
  $('stage').appendChild(el);
  noteEl = el;
  import('./uianim.js').then((UA) => UA.play(el, 'WBP_NotificationsOverlay', 'StoryNotificationEnter', { map: { StoryNotificationContainer: '.nt-box', TopLeftShadow: '.nt-shadow' } })).catch(() => {});
}

// --- QTE de la historia ---
// Círculo (WBP_ShrinkingCircleQTE): el anillo va de OuterCircleInitialScale (6 por defecto) a 0,25 durante la sección;
// presionar con la escala entre 3,5 y 0,5 (OuterCircleScaleSuccessMax/Min) es acierto, antes es fallo inmediato
// (WBP_BaseQTE: InputClicked fuera de SuccessWindow), y si no se presiona falla al terminar.
// Arrastre (WBP_FluxQTE, QTEType Flux): mantener el clic y arrastrar a favor de DragAngles hasta completar.
// Curvas de la sección (RenderOpacity, Scale, Position, RotationAngle, Shear): data/qte-curves.json (ticks de secuencia).
const QTE = { scaleMin: 0.25, succMax: 3.5, succMin: 0.5, base: 50, fluxLength: 400 };
let qte = null;
let qteCurves = {};
fetch('data/qte-curves.json').then((r) => r.json()).then((c) => { qteCurves = c; }).catch(() => {});
function evalChannel(c, tick) {
  if (!c) return null;
  const { t, v } = c;
  if (!t.length) return c.d ?? null;
  if (tick <= t[0]) return v[0];
  const n = t.length - 1;
  if (tick >= t[n]) return v[n];
  let k = 0;
  while (k < n - 1 && tick >= t[k + 1]) k++;
  const dt = t[k + 1] - t[k], u = (tick - t[k]) / dt;
  if (c.i[k] === 1) return v[k];
  if (c.i[k] === 0) return v[k] + (v[k + 1] - v[k]) * u;
  const h00 = 2 * u ** 3 - 3 * u ** 2 + 1, h10 = u ** 3 - 2 * u ** 2 + u, h01 = -2 * u ** 3 + 3 * u ** 2, h11 = u ** 3 - u ** 2;
  return h00 * v[k] + h10 * dt * c.l[k] + h01 * v[k + 1] + h11 * dt * c.a[k + 1];
}
const unit = () => Math.min(innerWidth / 1920, innerHeight / 1080);
// posición de diseño (1920×1080) → píxeles de la ventana (el video se ve completo y centrado)
const designToScreen = (x, y) => { const u = unit(); return [(innerWidth - 1920 * u) / 2 + x * u, (innerHeight - 1080 * u) / 2 + y * u]; };
function startQte(n, i) {
  const q = n.qte[i];
  const el = document.createElement('div');
  el.className = `sq sq-${q.type}`;
  // ícono de la acción (DT_CommonInputActions TimedPressBottom → ControllerData_KeyboardMouse: clic izquierdo)
  const icon = '<i class="sq-input"></i>';
  if (q.type === 'flux') {
    // WBP_FluxQTE: cápsula del recorrido (WBP_FluxPointsBase) y el botón (QTEPrompt / WBP_BaseQTE) con "MANTÉN"
    el.innerHTML = `<div class="sq-arrow"><div class="sq-track"></div><div class="sq-cursor"><span class="sq-disc"></span>${icon}<svg class="sq-time" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46"/></svg><span class="sq-lw"><b class="sq-label">${esc(loc['ExtrasStrings/Hold'] || 'Hold')}</b></span></div></div>`;
  } else {
    // WBP_ShrinkingCircleQTE: Shadow (M_RadialOpacity), Overlay_5 con ShrinkingCircle (MI_UI_OutlineCircle) que se
    // achica, ShrinkingCircle_Internal (M_FluxBackgroundCircleShrinking: desactivado / activo / acierto / fallo), EdgeFade,
    // el ícono de entrada y OnFail_X_Icon; en los dos primeros QTE del episodio 1, TutorialText01/02 (Espera / Pulsa)
    const tuto = /^Node_SDN_EP01_SQ0010-0050xL?_Choice$/.test(n.id);
    el.innerHTML = `<div class="sq-shadow"></div><div class="sq-o5"><div class="sq-glow"></div><div class="sq-ring"></div><div class="sq-disc"></div><div class="sq-edge"></div>${icon}</div><div class="sq-x"></div>${tuto ? `<div class="sq-tuto"><b class="t1">${esc(loc['ST_QTETutorial/WaitText'] || 'Wait')}</b><b class="t2">${esc(loc['ST_QTETutorial/PressText'] || 'Press')}</b></div>` : ''}`;
  }
  $('stage').appendChild(el);
  // íconos con los colores de sus materiales (web/prompts.js): clic izquierdo y la X de MI_Icon_X_DropShadow
  for (const i of el.querySelectorAll('.sq-input')) window.DispatchPrompts?.apply(i, 'LeftMouseButton', 0);
  const x = el.querySelector('.sq-x');
  if (x) window.DispatchPrompts?.mask('assets/ui/textures/T_UI_Icon_X_DropShadow.png', [[146, 13, 59], [255, 255, 255], [60, 56, 46]]).then((u) => { x.style.backgroundImage = `url(${u})`; });
  const curves = (qteCurves[n.seq] || []).find((c) => q.r && Math.abs(c.r[0] - q.r[0]) < 2 && Math.abs(c.r[1] - q.r[1]) < 2);
  qte = { node: n.id, i, q, el, curves: curves?.c || null, result: null, progress: 0, held: false, drag: 0, keys: new Set(), lastMs: null };
}
function endQte() { if (qte) { qte.el.remove(); qte = null; } }
function resolveQte(ok) {
  if (!qte || qte.result != null) return false;
  qte.result = ok;
  qteDone.add(qte.i);
  state.vars[`qte:${current.id}:${qte.i}`] = ok;
  qte.el.classList.add(ok ? 'ok' : 'fail');
  // al fallar, la pantalla se tiñe desde los bordes (M_InvertedSphericalOpacityQTEs en naranja)
  if (!ok) { const fx = document.createElement('div'); fx.className = 'sq-failfx'; $('stage').appendChild(fx); setTimeout(() => fx.remove(), 1300); }
  sfx(ok ? 'SFX_Hacking_SequenceSuccess' : 'SFX_Hacking_OutcomeFailure');
  const el = qte.el, node = current;
  setTimeout(() => el.remove(), 500);
  qte = null;
  if (isQteChoice(node)) { setTimeout(() => { if (current === node && !chosen) pick(qteOutcome(ok)); }, 250); }
  return false;
}
function updateQte(n, ms) {
  if (qte && qte.node !== n.id) endQte();
  if (!qte) {
    const i = n.qte ? n.qte.findIndex((x, k) => !qteDone.has(k) && ms >= x.t[0] && ms < x.t[1]) : -1;
    if (i < 0) return false;
    // televisor: sin QTE. Cada uno se da por acertado apenas empieza, sin mostrar nada ni sonar (como QuickTimeEvents
    // = Cinematic, pero sin el círculo); en los QTE que deciden la rama, sigue la de acierto
    qteDone.add(i);
    state.vars[`qte:${n.id}:${i}`] = true;
    if (isQteChoice(n)) setTimeout(() => { if (current === n && !chosen) pick(qteOutcome(true)); }, 250);
    return false;
  }
  const { q, el } = qte;
  const unfailable = n.choiceUI === 'WBP_UnfailableDragAndPress';
  // QuickTimeEvents = Cinematic (Off): acierto automático
  if (settings().QuickTimeEvents === false) return resolveQte(true);
  if (ms >= q.t[1]) return resolveQte(unfailable);
  const alpha = Math.min(1, Math.max(0, (ms - q.t[0]) / (q.t[1] - q.t[0])));
  // curvas de la sección
  const C = qte.curves, tick = ms * 120;
  const pos = C?.Position ? [evalChannel(C.Position.x, tick), evalChannel(C.Position.y, tick)] : [q.x * 1920, q.y * 1080];
  const scl = C?.Scale ? [evalChannel(C.Scale.x, tick) ?? 1, evalChannel(C.Scale.y, tick) ?? 1] : [1, 1];
  const op = C?.RenderOpacity ? evalChannel(C.RenderOpacity, tick) ?? 1 : 1;
  const rot = C?.RotationAngle ? evalChannel(C.RotationAngle, tick) ?? 0 : 0;
  const sh = C?.Shear ? [evalChannel(C.Shear.x, tick) ?? 0, evalChannel(C.Shear.y, tick) ?? 0] : [0, 0];
  const [sx, sy] = designToScreen(pos[0], pos[1]);
  const u = unit();
  el.style.left = `${sx}px`;
  el.style.top = `${sy}px`;
  el.style.opacity = qte.result == null ? op : '';
  el.style.setProperty('--u', u);
  el.style.transform = `translate(-50%, -50%) rotate(${rot}deg) skew(${sh[0]}deg, ${sh[1]}deg) scale(${scl[0]}, ${scl[1]})`;
  if (q.type === 'flux') {
    // UpdateMouseMovement: velocidad = clamp(clamp(dot × DragFactor × 1,5, 0, 4) × k(400 px) = 1, 0, 14) en una animación de 1 s
    const dt = qte.lastMs == null ? 0 : Math.max(0, ms - qte.lastMs) / 1000;
    qte.lastMs = ms;
    const a = ((q.angles?.[0] || 0) * Math.PI) / 180, dir = [Math.cos(a), Math.sin(a)];
    for (const d of qte.keys) { const k = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0], KeyW: [0, -1], KeyS: [0, 1], KeyA: [-1, 0], KeyD: [1, 0] }[d]; if (k) qte.drag += (k[0] * dir[0] + k[1] * dir[1]) * 3 * dt * 60; }
    const held = qte.held || qte.keys.size > 0;
    const dot = held && dt > 0 ? qte.drag / (dt * 60) : 0;
    qte.drag = 0;
    qte.progress = Math.min(1, qte.progress + dt * Math.min(14, Math.min(4, Math.max(0, dot * 1.5))));
    el.querySelector('.sq-arrow').style.transform = `rotate(${q.angles?.[0] || 0}deg)`;
    el.style.setProperty('--p', qte.progress);
    el.style.setProperty('--rot', q.angles?.[0] || 0); // (el texto "Mantén" queda derecho)
    el.style.setProperty('--t', 1 - alpha); // tiempo que queda (anillo; rosado al final: Low_Inner_Color)
    el.classList.toggle('low', alpha > 0.75);
    el.classList.toggle('held', held);
    if (qte.progress >= 1) return resolveQte(true);
  } else {
    const s = (q.scale0 || 6) + (QTE.scaleMin - (q.scale0 || 6)) * alpha;
    // WBP_BaseQTE.DelayToActivation (1 s): la entrada se activa recién después; IsInSuccessRange 3,5 … 0,5
    qte.inWindow = s <= QTE.succMax && s >= QTE.succMin && ms - q.t[0] >= 1000;
    el.style.setProperty('--s', s);
    el.classList.toggle('window', qte.inWindow);
  }
  return false;
}
// Espacio / clic: en el círculo, acierto sólo dentro de la ventana
function qtePress() {
  if (!qte || qte.result != null || qte.q.type !== 'circle') return;
  resolveQte(!!qte.inWindow);
}
addEventListener('pointerdown', (e) => { if (qte?.q.type === 'flux' && !e.target.closest('button, .mn')) qte.held = true; });
addEventListener('pointerup', () => { if (qte) qte.held = false; });
addEventListener('pointermove', (e) => {
  if (!qte || qte.q.type !== 'flux' || !qte.held) return;
  const a = ((qte.q.angles?.[0] || 0) * Math.PI) / 180;
  qte.drag += e.movementX * Math.cos(a) + e.movementY * Math.sin(a);
});
addEventListener('keyup', (e) => { if (qte) qte.keys.delete(e.code); });

// --- subtítulos: WBP_SubtitleBlock ---
// Texto con estilo de DT_SubtitlesProtoRichText (Montserrat Medium 28 pt, 36 en grande), sombra difuminada, ancho 1050.
// "{Nombre}: " sin animar (donthide) y el resto letra por letra cada 0,025 s (PrintLetterInterval) si está activado.
// Color: SubtitleColor del personaje (AdHocStoryCharacter) con "Color por personaje"; si no, blanco.
let characters = {};
fetch('data/characters.json').then((r) => r.json()).then((c) => { characters = c; }).catch(() => {});
const PRINT_INTERVAL = 25;
// unidad de diseño: 1 px de la interfaz original a 1920×1080
const setUnit = () => document.documentElement.style.setProperty('--u', String(Math.min(innerWidth / 1920, innerHeight / 1080)));
addEventListener('resize', setUnit);
setUnit();
let subKey = '';
function speakerName(t) {
  const c = characters[t[3]];
  if (c?.name) return loc[`${c.name.ns}/${c.name.key}`] || c.name.src;
  return t[0] ? t[0].replace(/(^|\s)\S/g, (x) => x.toUpperCase()) : '';
}
function renderSubtitle(s, t, ms) {
  const st = settings();
  const subs = $('subs');
  subs.classList.toggle('large', !!st.LargeSubtitles);
  subs.classList.toggle('choice-open', !$('choice').hidden);
  subs.style.setProperty('--box', st.SubtitlesLetterboxEnabled ? st.SubtitlesLetterboxOpacity ?? 0.5 : 0);
  if (!t || st.SubtitlesEnabled === false) { if (subKey) { subs.innerHTML = ''; subKey = ''; } return; }
  const part = slicePart(lineText(t), (ms - s[0]) / (s[1] - s[0]));
  const name = st.SubtitleSpeakerNamesEnabled !== false ? speakerName(t) : '';
  const color = st.SubtitlesColorEnabled ? characters[t[3]]?.color || '#fff' : '#fff';
  // letras visibles desde el comienzo del tramo
  const since = ms - (s[0] + part.start * (s[1] - s[0]));
  const plain = part.text.replace(/<[^>]*>/g, '');
  const shown = st.SubtitleTypewriterAnimationEnabled === false ? plain.length : Math.min(plain.length, Math.floor(since / PRINT_INTERVAL) + 1);
  const key = `${s[2]}|${part.index}|${shown}|${name}|${color}`;
  if (key === subKey) return;
  subKey = key;
  // el texto completo ocupa su lugar desde el principio (las letras ocultas no mueven el ajuste de línea)
  let html = '', count = 0;
  for (const piece of part.text.split(/(<Italic>|<\/>)/)) {
    if (piece === '<Italic>') { html += '<i>'; continue; }
    if (piece === '</>') { html += '</i>'; continue; }
    const vis = piece.slice(0, Math.max(0, shown - count)), rest = piece.slice(vis.length);
    count += piece.length;
    html += esc(vis) + (rest ? `<span class="hid">${esc(rest)}</span>` : '');
  }
  subs.innerHTML = `<span class="line" style="color:${color}">${name ? `${esc(name)}: ` : ''}${html}</span>`;
}
// tramo actual de un texto partido con "|" y dónde empieza (fracción de la duración, proporcional al largo)
function slicePart(text, f) {
  const parts = text.split('|').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return { text: parts[0] || '', start: 0, index: 0 };
  const total = parts.reduce((a, p) => a + p.length, 0);
  let acc = 0;
  for (let i = 0; i < parts.length; i++) {
    const start = acc / total;
    acc += parts[i].length;
    if (f < acc / total || i === parts.length - 1) return { text: parts[i], start, index: i };
  }
}

// Las líneas vienen partidas con "|": se muestra cada tramo en proporción a su largo.
function slice(text, f) {
  const parts = text.split('|').map((x) => x.trim()).filter(Boolean);
  if (parts.length < 2) return parts[0] || '';
  const total = parts.reduce((a, p) => a + p.length, 0);
  let acc = 0;
  for (const p of parts) {
    acc += p.length;
    if (f < acc / total) return p;
  }
  return parts[parts.length - 1];
}

// WBP_StandardChoiceUI: tercera opción arriba, primera a la izquierda y segunda a la derecha (60 px a cada lado),
// botones WBP_InteractiveDialogue (MI_UI_DialogueOption_Visual; Montserrat SemiBold 22 pt, ^negrita^) y abajo la barra
// WBP_UI_DialogueTimer (1173 × 20; roja, blanca bajo el 12 %). Aparece en 0,5 s; al elegir, las demás se apagan.
const richChoice = (s) => esc(s).replace(/\^(.+?)\^/g, '<b>$1</b>').replace(/~/g, '<br>');
let choiceToken = 0;
function showChoice(n) {
  choiceToken++;
  const box = $('options');
  box.innerHTML = '';
  box.className = '';
  const opts = n.options.filter((o) => passes(o.if));
  // IA_Story_Left / Right / Top (DT_CommonInputActions: ChoiceWest = A, ChoiceEast = D, ChoiceNorth = W)
  const keyOf = (k, total) => (total === 1 ? 'W' : ['A', 'D', 'W'][k] || '');
  const make = (o, k) => {
    const b = document.createElement('button');
    const key = keyOf(k, opts.length);
    b.className = `opt${key === 'D' ? ' prompt-right' : ''}`;
    // televisor: el D-pad del control (Izquierda / Derecha / Arriba) en lugar de A / D / W
    b.innerHTML = `<kbd>${{ A: '◀', D: '▶', W: '▲' }[key] || key}</kbd><span>${richChoice(optionText(o) || '…')}</span>`;
    b.dataset.key = String(k + 1);
    b.dataset.letter = key;
    b.onmouseenter = () => sfx('SFX_StoryUI_ChoiceHover', 0.6);
    b.onclick = (e) => { e.stopPropagation(); choose(o, b); };
    return b;
  };
  const top = document.createElement('div'), row = document.createElement('div');
  top.className = 'row top';
  row.className = 'row';
  const btns = opts.map(make);
  if (btns.length === 1) top.append(btns[0]);
  else { row.append(btns[0], btns[1]); if (btns[2]) top.append(btns[2]); for (const b of btns.slice(3)) row.append(b); }
  box.append(top, row);
  $('choice').hidden = false;
  $('choice').classList.remove('picked');
}
function choose(o, b) {
  if (chosen) return;
  sfx('SFX_StoryUI_ChoiceMake', 0.8);
  b?.classList.add('chosen');
  $('choice').classList.add('picked');
  pick(o);
}
function setTimer(f) {
  const t = $('timer');
  t.style.setProperty('--f', f);
  t.classList.toggle('alert', f < 0.12); // TimerAlertThreshold 12
}

function hitQte() { qtePress(); }

function hideUi() {
  // ChoiceSelected: la opción elegida queda un momento mientras las demás se desvanecen
  if ($('choice').classList.contains('picked')) {
    const token = ++choiceToken;
    setTimeout(() => { if (token === choiceToken && $('choice').classList.contains('picked')) { $('choice').hidden = true; $('choice').classList.remove('picked'); } }, 700);
  }
  else $('choice').hidden = true;
  endQte();
  $('card').hidden = true;
  $('subs').innerHTML = '';
  subKey = '';
}

function card(text, label, action) {
  videos.forEach((v) => v.pause());
  pauseAllAudio();
  const c = $('card');
  c.innerHTML = `<p>${esc(text)}</p>`;
  const b = document.createElement('button');
  b.textContent = label;
  b.onclick = () => { c.hidden = true; action(); };
  c.appendChild(b);
  c.hidden = false;
}

function endCard(text) {
  card(text, 'Volver al menú', () => stopPlayback());
}

// Fin de episodio: menu.js guarda las variables de la partida para el siguiente y muestra la pantalla de cierre.
function endEpisode() {
  const ended = { ...state, vars: { ...state.vars } };
  stopPlayback(false);
  if (hooks.end) hooks.end(ended, sharedVars(ended.vars));
  else location.reload();
}

// detiene la historia (videos, audio, interfaz) y avisa al menú
function stopPlayback(notify = true) {
  cancelAnimationFrame(raf);
  paused = false;
  videos.forEach((v) => { v.pause(); v.classList.remove('on'); });
  stopClipAudio();
  if (bgAudio) { bgAudio.pause(); bgAudio = null; bgName = null; }
  if (music) { music.pause(); music = null; musicName = null; }
  hideUi();
  current = null;
  playing = false;
  if (notify) hooks.exit?.();
}

// pausa (WBP_PauseMenu): congela video, audio y el reloj de la secuencia
let paused = false, playing = false;
function pausePlayback() {
  if (!playing || paused || !current) return false;
  paused = true;
  cancelAnimationFrame(raf);
  videos[active].pause();
  if (hold) hold.pausedAt = performance.now();
  pauseAllAudio();
  return true;
}
function resumePlayback() {
  if (!paused) return;
  paused = false;
  if (hold && hold.pausedAt) { hold.t0 += performance.now() - hold.pausedAt; delete hold.pausedAt; }
  if (current && current.video) videos[active].play().catch(() => {});
  resumeBg();
  for (const a of clipAudio) if (a.started && !a.el.ended) a.el.play().catch(() => {});
  raf = requestAnimationFrame(tick);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// --- entrada ---
addEventListener('keydown', (e) => {
  if (!playing) return;
  if (e.code === 'Escape' || e.code === 'KeyP') { if (!paused && hooks.pause && pausePlayback()) { e.dispatchPaused = true; hooks.pause(); } return; }
  if (paused) return;
  // decisiones con el control remoto: Izquierda / Arriba / Derecha marcan la opción de ese lado y OK (Enter) la elige;
  // A / W / D del teclado eligen directo, como el original
  if (!$('choice').hidden && !chosen) {
    const dir = { ArrowLeft: 'A', ArrowRight: 'D', ArrowUp: 'W' }[e.code];
    if (dir) {
      e.preventDefault();
      const b = $('options').querySelector(`.opt[data-letter="${dir}"]`);
      if (b && !b.classList.contains('focus')) {
        for (const x of $('options').querySelectorAll('.opt.focus')) x.classList.remove('focus');
        b.classList.add('focus');
        sfx('SFX_StoryUI_ChoiceHover', 0.6);
      }
      return;
    }
    if (e.code === 'Enter' || e.code === 'NumpadEnter') {
      e.preventDefault();
      $('options').querySelector('.opt.focus')?.click();
      return;
    }
    if (/^Key[ADW]$/.test(e.code)) {
      const b = $('options').querySelector(`.opt[data-letter="${e.code.slice(3)}"]`);
      if (b) { e.preventDefault(); b.click(); return; }
    }
  }
  if (/^Digit[1-9]$/.test(e.code) && !$('choice').hidden) {
    const b = $('options').querySelector(`.opt[data-key="${e.code.slice(5)}"]`);
    if (b) b.click();
  } else if (e.code === 'KeyS' && current) {
    // saltar: hasta la ventana de decisión o al final del clip
    const v = videos[active];
    if (current.type === 'choice' && current.choice && !chosen) {
      const target = current.choice[0];
      if (v.duration && target / 1000 >= v.duration) hold = { at: target, t0: performance.now() };
      else v.currentTime = target / 1000;
    }
    else if (current.type === 'exch') finish();
  } else if (e.code === 'KeyD') $('debug').hidden = !$('debug').hidden;
});
$('stage').addEventListener('click', (e) => { if (playing && !paused && !e.target.closest('button, .mn')) hitQte(); });

const hooks = {}; // menu.js: node(state, id), end(state, shared), exit(), pause()
const graphs = {};
async function loadGraph(episode) {
  if (!graphs[episode]) graphs[episode] = await (await fetch(`data/${episode}.json`)).json();
  return graphs[episode];
}

// arranca un episodio en un nodo (inicio, punto de guardado o escena) con sus variables
async function start(episode, node, vars, visited) {
  graph = await loadGraph(episode);
  await loadAudioIndex();
  state = { episode, node: node || graph.start, vars: { ...(vars || {}) }, visited: [...(visited || [])] };
  playing = true;
  paused = false;
  go(state.node);
}

// SimulateGameFromNodeWithRandomChoices: recorre el episodio eligiendo al azar entre las opciones posibles
// (los minijuegos se dan por superados al azar) y devuelve las variables al terminar
async function simulate(episode, vars, from) {
  const g = await loadGraph(episode);
  const saveG = graph, saveS = state;
  graph = g;
  state = { episode, node: from || g.start, vars: { ...(vars || {}) } };
  try {
    let id = state.node;
    for (let steps = 0; id && steps < 50000; steps++) {
      const n = g.nodes[id];
      if (!n) break;
      applySets(n);
      if (n.type === 'branch') { const p = n.paths.find((x) => passes(x.if)) || n.paths[n.paths.length - 1]; id = p && p.next; }
      else if (n.type === 'choice') {
        const ok = n.options.filter((o) => passes(o.if) && resolveOption(o));
        const o = ok[Math.floor(Math.random() * ok.length)];
        id = o ? resolveOption(o) : null;
      } else {
        if (n.type === 'gameplay' && /^LV_Hacking_/.test(n.level)) state.vars['Shared/Var_Hacking_Success'] = Math.random() < 0.7;
        id = n.next;
      }
    }
    return state.vars;
  } finally { graph = saveG; state = saveS; }
}

const ready = Promise.all([loadLang(lang), loadAudioIndex()]);
window.Player = {
  ready,
  start, simulate, loadGraph, hooks, stop: () => stopPlayback(false), pause: pausePlayback, resume: resumePlayback,
  get state() { return state; }, get playing() { return playing; }, get paused() { return paused; },
  get lang() { return lang; }, setLang: (l) => loadLang(l), langs: LANGS, t: (key, fallback) => loc[key] ?? fallback,
  sharedVars, inShift: false,
};
window.dispatchEvent(new Event('player-ready'));