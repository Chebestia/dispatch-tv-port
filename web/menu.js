// Menús de Dispatch portados de los Widget Blueprints de Shared/Menu (datos: tools/uigen.js, tools/menugen.js).
// WBP_MainMenu (fondo por progreso, Jugar / Ajustes / Salir), WBP_EpisodesMenu (episodios, ranura, escenas),
// WBP_ScenesMenu (rebobinar a un punto de guardado), WBP_SaveMenu (3 ranuras), WBP_SettingsMenu (DispatchSettings),
// WBP_PauseMenu (en la historia) y el cierre de episodio. Diseño en 1920×1080, escalado a la ventana.
const P = () => window.Player;
const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

let MENU = null, STRINGS = {}, UI = {};
// texto de un FText {ns,key,src} o {table,key} de los widgets, traducido
function tx(t, fallback = '') {
  if (!t) return fallback;
  if (typeof t === 'string') return t;
  if (t.table) {
    const s = STRINGS[`${t.table.replace(/\.[^/]*$/, '')}/${t.key}`];
    if (s) return P().t(s.key, s.src) || fallback || t.key;
    // tablas que no están en _strings.json: la traducción va por el nombre de la tabla, con o sin ST_
    // (ST_MenuTitles/Settings, EpisodeBlurbs/EpisodeBlurb1)
    const name = t.table.split(/[./]/).pop();
    return P().t(`${name}/${t.key}`) || P().t(`${name.replace(/^ST_/, '')}/${t.key}`) || fallback || t.key;
  }
  return P().t(`${t.ns}/${t.key}`, t.src) || fallback;
}
// texto de un widget con nombre dentro de un WBP (p. ej. WBP_PauseMenu / ResumeButton)
function wtext(wbp, name, fallback) {
  const find = (n) => (n.name === name ? n : (n.children || []).map(find).find(Boolean));
  const n = UI[wbp]?.root && find(UI[wbp].root);
  return tx(n?.props?.Text, fallback);
}
// televisor: videos en H.264 720p con la misma ruta pero .mp4 (tools/build.js)
const mp4 = (src) => src && src.replace(/\.webm$/, '.mp4');
const S = (key, fallback) => P().t(`DispatchSettings/${key}`, fallback); // textos de ajustes (código nativo)
const fmt = (s, args) => String(s).replace(/\{(\w+)\}/g, (_, k) => args[k] ?? `{${k}}`);

// --- sonido de interfaz ---
const ui = (name) => window.dispatchAudio?.sfx(name, 0.7);
let ambience = null;
function setAmbience(name) {
  if (ambience?.name === name) return;
  ambience?.el.pause();
  ambience = null;
  const f = window.dispatchAudio?.files?.(name)?.[0];
  if (!f) return;
  const el = new Audio(`assets/audio/${f}`);
  el.loop = true;
  const s = window.dispatchSettings;
  el.volume = 0.5 * (s.MasterVolume ?? 1) * (s.SFXVolume ?? 1);
  el.play().catch(() => {});
  ambience = { name, el };
}

// --- ajustes (DispatchSettings) ---
const DEFAULTS = {
  Language: null, QuickTimeEvents: true, HackingEasyMode: false, PauseOnLostFocus: true,
  MasterVolume: 1, SFXVolume: 1, VOVolume: 1, MusicVolumeCinematics: 1, MusicVolumeGameplay: 1, MonoAudio: false, DialogueBoost: false, DisableCopyrightedMusic: false,
  SubtitlesEnabled: true, SubtitleSpeakerNamesEnabled: true, LargeSubtitles: false, SubtitlesLetterboxEnabled: false, SubtitlesLetterboxOpacity: 0.6,
  SubtitleTypewriterAnimationEnabled: true, SubtitlesColorEnabled: false, ColorblindSetting: 'NormalVision', ColorblindIntensitySetting: 1,
  FullscreenEnabled: false, CensorshipStyle: 'Blackout', StreamerModeCensorBars: false, StreamerModeCensoredAudio: false,
};
window.dispatchSettings = { ...DEFAULTS, ...store.get('dispatch-web-settings', {}) };
function setSetting(k, v) {
  window.dispatchSettings[k] = v;
  store.set('dispatch-web-settings', window.dispatchSettings);
  if (k === 'Language') P().setLang(v).then(() => render());
  if (k === 'FullscreenEnabled') { if (v) document.documentElement.requestFullscreen?.().catch(() => {}); else if (document.fullscreenElement) document.exitFullscreen(); }
  if (k === 'ColorblindSetting' || k === 'ColorblindIntensitySetting') applyColorblind();
}
function applyColorblind() {
  const s = window.dispatchSettings;
  const f = { Deuteranope: 'url(#cb-deut)', Protanope: 'url(#cb-prot)', Tritanope: 'url(#cb-trit)' }[s.ColorblindSetting];
  document.getElementById('stage').style.filter = f || '';
}
// pestañas y opciones de WBP_SettingsMenu (categorías y claves de DispatchSettings)
const toggle = (k) => ({ k, type: 'toggle' });
const slider = (k) => ({ k, type: 'slider' });
const SETTINGS_TABS = [
  { k: 'SettingCategoryGeneral', items: [
    // televisor: sin QTE, hackeo, turnos ni ventanas, así que QuickTimeEvents, HackingEasyMode, PauseOnLostFocus (la app
    // pausa sola al salir), MusicVolumeGameplay y la pestaña de pantalla no van
    { k: 'Language', type: 'list', options: () => Object.entries(P().langs) }] },
  { k: 'SettingCategorySound', items: [slider('MasterVolume'), slider('VOVolume'), slider('SFXVolume'), slider('MusicVolumeCinematics'), toggle('DialogueBoost'), toggle('MonoAudio'), toggle('DisableCopyrightedMusic')] },
  { k: 'SettingCategoryAccessibility', items: [
    { header: 'SettingSubCategorySubtitles' }, toggle('SubtitlesEnabled'), toggle('SubtitleSpeakerNamesEnabled'),
    { k: 'LargeSubtitles', type: 'list', options: () => [[false, S('LargeSubtitlesOff', 'Standard')], [true, S('LargeSubtitlesOn', 'Large')]] },
    toggle('SubtitlesLetterboxEnabled'), slider('SubtitlesLetterboxOpacity'), toggle('SubtitleTypewriterAnimationEnabled'),
    { k: 'SubtitlesColorEnabled', type: 'list', options: () => [[false, S('SubtitlesColorEnabledFalse', 'White')], [true, S('SubtitlesColorEnabledTrue', 'Per-Character')]] },
    { k: 'ColorblindSetting', type: 'list', options: () => ['NormalVision', 'Deuteranope', 'Protanope', 'Tritanope'].map((v) => [v, P().t(`DispatchSettings.ColorblindSetting/${v}`, v)]) }] },
  { k: 'SettingCategoryFilters', items: [
    { k: 'CensorshipStyle', type: 'list', options: () => ['Blackout', 'Mosaic', 'Chaotic'].map((v) => [v, S(`CensorshipStyle${v}`, v)]) },
    { k: 'StreamerModeCensorBars', type: 'list', options: () => [[false, S('SettingsOff', 'Off')], ['Partial', S('SettingsCensorPartial', 'Partial')], ['Full', S('SettingsCensorFull', 'Full')]] }, toggle('StreamerModeCensoredAudio')] },
  { k: 'SettingCategoryControls', items: [{ info: true }] },
];

// --- partidas: 3 ranuras (EAdHocSaveSlot, las dos primeras no se muestran) ---
// ranura: { created, saved, resume: {episode,node,vars,scene}, scenes: {id: {episode,node,vars}}, completed: {101:true}, shared: {102: vars} }
const SLOTS_KEY = 'dispatch-web-slots';
let slots = store.get(SLOTS_KEY, {});
let activeSlot = store.get('dispatch-web-active-slot', 1);
const saveSlots = () => { store.set(SLOTS_KEY, slots); store.set('dispatch-web-active-slot', activeSlot); };
const slot = () => (slots[activeSlot] ||= { created: Date.now(), saved: null, resume: null, scenes: {}, completed: {}, shared: {} });
const epById = (id) => MENU.episodes.find((e) => e.id === String(id).replace(/^ep/, ''));
const epName = (e) => tx(e.name, e.packagingName);

// el fondo del menú principal sigue el progreso (último episodio terminado → siguiente fondo)
function progressEpisode() {
  const s = slots[activeSlot];
  if (!s) return 1;
  // WBP_MainMenuBase.GetEpisodeBackgroundIndex: el primer episodio sin empezar o en curso; si no queda ninguno (o el
  // 8 está completo) el fondo del final
  const first = MENU.episodes.find((e) => !s.completed[e.id]);
  return !first || s.completed[MENU.episodes[7]?.id] ? 'endGame' : first.num;
}

// --- vista ---
let root, page = null, stack = [];
function mount() {
  root = document.createElement('div');
  root.className = 'mn';
  root.innerHTML = `<video class="mn-bg" muted loop playsinline></video><div class="mn-art" hidden></div><div class="mn-shade"></div><div class="mn-canvas"></div>
    <svg width="0" height="0" style="position:absolute"><filter id="cb-deut"><feColorMatrix values="0.625 0.375 0 0 0 0.7 0.3 0 0 0 0 0.3 0.7 0 0 0 0 0 1 0"/></filter>
    <filter id="cb-prot"><feColorMatrix values="0.567 0.433 0 0 0 0.558 0.442 0 0 0 0 0.242 0.758 0 0 0 0 0 1 0"/></filter>
    <filter id="cb-trit"><feColorMatrix values="0.95 0.05 0 0 0 0 0.433 0.567 0 0 0 0.475 0.525 0 0 0 0 0 1 0"/></filter></svg>`;
  document.getElementById('stage').appendChild(root);
  const fit = () => {
    const k = Math.min(innerWidth / 1920, innerHeight / 1080);
    const c = $('.mn-canvas', root);
    c.style.transform = `translate(${(innerWidth - 1920 * k) / 2}px, ${(innerHeight - 1080 * k) / 2}px) scale(${k})`;
  };
  addEventListener('resize', fit);
  fit();
  addEventListener('keydown', onKey, true);
}
function show(name, opts = {}) {
  if (!opts.replace && page) stack.push(page);
  page = { name, ...opts };
  render();
}
function back() {
  ui('SFX_MenuUI_MenuBack');
  page = stack.pop() || { name: 'main' };
  render();
}
function onKey(e) {
  if (!root || root.hidden || e.dispatchPaused) return;
  if (e.code === 'Escape' || e.code === 'Backspace') {
    e.preventDefault(); e.stopPropagation();
    if (page?.name === 'pause') resumeGame();
    else if (page?.name !== 'main' && page?.name !== 'end') back();
  } else if (page?.keys) page.keys(e);
}
function setArt(name) {
  const a = $('.mn-art', root);
  a.hidden = !name;
  if (name) a.style.backgroundImage = `url(assets/ui/textures/${name}.png)`;
}
// botón de menú (WBP_MenuButton: MI_UI_MenuButton, texto en mayúsculas, sonido al pasar)
function btn(label, action, cls = '') {
  const b = document.createElement('button');
  b.className = `mn-btn ${cls}`;
  b.innerHTML = `<span>${esc(label)}</span>`;
  b.onmouseenter = () => ui('SFX_ShiftUI_ButtonHover');
  b.onclick = (e) => { e.stopPropagation(); action(); };
  return b;
}
function backdrop() {
  const v = $('.mn-bg', root);
  const p = progressEpisode();
  const src = mp4(MENU.backdrops[p === 'endGame' ? 'endGame' : p === 1 ? 'ep1' : `ep${p}`]);
  if (src && !v.src.endsWith(src)) { v.src = src; v.play().catch(() => {}); }
  setAmbience(p === 'endGame' ? 'Amb_MainMenu_EndOfGame' : `Amb_MainMenu_Ep10${p}`);
}

function render() {
  const c = $('.mn-canvas', root);
  c.innerHTML = '';
  if (!['episodes', 'scenes', 'saves', 'prompt'].includes(page.name)) setArt(null);
  root.classList.toggle('in-game', page.name === 'pause');
  const v = $('.mn-bg', root);
  if (page.name === 'pause') { v.pause(); ambience?.el.pause(); } else { backdrop(); v.play().catch(() => {}); ambience?.el.play().catch(() => {}); }
  ({ main: renderMain, 'ftue-settings': renderFtueSettings, episodes: renderEpisodes, scenes: renderScenes, saves: renderSaves, settings: renderSettings, pause: renderPause, end: renderEnd, prompt: renderPrompt, extras: renderExtras, books: renderBooks, book: renderBook, choicestats: renderChoiceStats })[page.name](c);
}

// WBP_MainMenu: logo (T_UI_DispatchLogo_SDF) y fila inferior de 4 botones (GridPanel, 76 px de alto, 96 px de margen)
let mainShown = false;
function renderMain(c) {
  // WBP_MainMenu.Appear: la primera vez, todo el menú aparece en 1.05 s
  if (!mainShown) {
    mainShown = true;
    import('./uianim.js').then((UA) => UA.load('WBP_MainMenu').then((a) => { const el = $('.mn-main', c); if (el && a.Appear) UA.play(el, 'WBP_MainMenu', a.Appear, { map: { Overlay_1: ':scope' }, u: 1 }); }));
  }
  c.innerHTML = `<div class="mn-main"><canvas class="mn-logo"></canvas><div class="mn-row"></div><div class="mn-version">Dispatch TV ·${esc(P().langs[P().lang] || '')}</div></div>`;
  drawLogo($('.mn-logo', c));
  const row = $('.mn-row', c);
  row.append(
    btn(wtext('WBP_MainMenu', 'PlayButton', 'Play'), () => { ui('SFX_MenuUI_ChangePage'); show(store.get('dispatch-web-ftue', false) ? 'episodes' : 'ftue-settings'); }),
    btn(wtext('WBP_MainMenu', 'SettingsButton', 'Settings'), () => { ui('SFX_MenuUI_ChangePage'); show('settings', { tab: 0 }); }),
    btn(wtext('WBP_MainMenu', 'ExtrasButton', 'Extras'), () => { ui('SFX_MenuUI_ChangePage'); show('extras'); }),
    btn(wtext('WBP_MainMenu', 'ExitButton', 'Exit Game'), () => prompt(wtext('WBP_MainMenu', 'ExitButton', 'Exit Game') + '?', [['SaveMenu/WarningPromptYes', 'Yes', () => { window.close(); location.href = 'about:blank'; }], ['SaveMenu/WarningPromptNo', 'No', back]]), 'exit'),
  );
  // ExitButton.CustomContents: ExitGameIconFiltered (T_UI_Leave_SDF, 40 × 40) + texto con 8 px de separación
  const exit = $('.mn-btn.exit', row);
  if (exit) { exit.insertAdjacentHTML('afterbegin', '<canvas class="mn-exit-ico"></canvas>'); drawLogo($('.mn-exit-ico', exit), 'assets/ui/textures/T_UI_Leave_SDF.png'); }
}
// el logo es un campo de distancia (SDF): se recorta en 0,5 como SDF_CutoffFactor de WBP_FilteredImage
const logoCache = {};
function drawLogo(cv, src = 'assets/ui/textures/T_UI_DispatchLogo_SDF.png') {
  const paint = (img) => {
    cv.width = img.width; cv.height = img.height;
    const g = cv.getContext('2d');
    g.drawImage(img, 0, 0);
    const d = g.getImageData(0, 0, cv.width, cv.height);
    for (let i = 0; i < d.data.length; i += 4) {
      const v = d.data[i] / 255, a = Math.min(1, Math.max(0, (v - 0.49) / 0.02));
      d.data[i] = d.data[i + 1] = d.data[i + 2] = 255; d.data[i + 3] = a * 255;
    }
    g.putImageData(d, 0, 0);
  };
  if (logoCache[src]) return paint(logoCache[src]);
  const img = new Image();
  img.onload = () => { logoCache[src] = img; paint(img); };
  img.src = src;
}

// WBP_FTUE: la primera vez, antes de jugar, se muestran los ajustes de subtítulos
function renderFtueSettings(c) {
  page.tab = 2;
  renderSettings(c, () => { store.set('dispatch-web-ftue', true); page = { name: 'episodes' }; render(); });
}

// WBP_EpisodesMenu
function renderEpisodes(c) {
  const sel = page.ep ?? (slot().resume ? epById(slot().resume.episode).num : 1);
  page.ep = sel;
  const e = MENU.episodes[sel - 1];
  const s = slot();
  const unlockedByDate = !e.unlock || e.unlock <= Date.now();
  const resumeHere = s.resume && s.resume.episode === e.id;
  // WBP_MainMenuBase.BgSwitcher: StaticBgImage con el arte del episodio + PlayMenuGradient
  setArt(e.art);
  c.innerHTML = `<div class="mn-episodes">
    <div class="mn-ep-top"></div>
    <div class="mn-ep-text"><div class="mn-ep-num">${esc(fmt(tx({ table: '/Game/Shared/Menu/Widgets/EpisodesMenu/ST_EpisodesMenuStrings', key: 'EpisodeNumber' }, 'EPISODE {EpisodeNum}'), { EpisodeNum: e.num }))}</div>
      <div class="mn-ep-title">${esc(epName(e))}</div><div class="mn-ep-blurb">${esc(tx(e.blurb))}</div></div>
    <div class="mn-ep-scroller"></div><div class="mn-ep-actions"></div></div>`;
  $('.mn-ep-top', c).append(btn(fmt(tx({ table: '/Game/Shared/Menu/Widgets/EpisodesMenu/ST_EpisodesMenuStrings', key: 'SaveSlotButtonText' }, 'SAVE SLOT {SlotNum}'), { SlotNum: activeSlot }), () => show('saves'), 'small'));
  const scroller = $('.mn-ep-scroller', c);
  for (const ep of MENU.episodes) {
    const b = document.createElement('button');
    const locked = ep.unlock && ep.unlock > Date.now();
    b.className = `mn-ep-card${ep.num === sel ? ' sel' : ''}${locked ? ' locked' : ''}${s.completed[ep.id] ? ' done' : ''}`;
    b.style.backgroundImage = `url(assets/ui/textures/${ep.buttonArt}.png)`;
    b.innerHTML = `<span>${ep.num}</span>${s.resume?.episode === ep.id ? `<em>${esc(P().t('EpisodesMenu/PlayButtonResume', 'RESUME'))}</em>` : ''}`;
    b.onmouseenter = () => ui('SFX_ShiftUI_ButtonHover');
    b.onclick = () => { ui('SFX_MenuUI_EpisodeSelect'); page.ep = ep.num; render(); };
    scroller.appendChild(b);
  }
  const actions = $('.mn-ep-actions', c);
  actions.append(btn(P().t('EpisodesMenu/SkipEpisodePromptCancel', 'BACK'), back, 'small'));
  actions.append(btn(P().t('EpisodesMenu/ScenesButton', 'VIEW SCENES'), () => show('scenes', { ep: e.num }), 'small'));
  const label = !unlockedByDate ? P().t('EpisodesMenu/PlayButtonLocked', 'EPISODE LOCKED') : resumeHere ? P().t('EpisodesMenu/PlayButtonResume', 'RESUME') : P().t('EpisodesMenu/PlayButtonPlay', 'PLAY');
  actions.append(btn(label, () => unlockedByDate && playEpisode(e), `primary${unlockedByDate ? '' : ' disabled'}`));
}
// Jugar: continuar desde el último punto de guardado, o empezar el episodio. Si faltan episodios previos, sus
// decisiones se completan al azar (SimulateGameFromNodeWithRandomChoices); si ya hay progreso, se avisa que se pisa.
async function playEpisode(e) {
  const s = slot();
  if (s.resume && s.resume.episode === e.id) return launch(s.resume);
  const prev = MENU.episodes.filter((x) => x.num < e.num);
  const missing = prev.filter((x) => !s.completed[x.id]);
  const progress = s.resume && epById(s.resume.episode).num > e.num || MENU.episodes.some((x) => x.num >= e.num && s.completed[x.id]);
  const go = async () => {
    if (missing.length) {
      page = { name: 'prompt', text: '…', buttons: [] }; render();
      let vars = s.shared[missing[0].id] || {};
      for (const x of MENU.episodes.filter((x) => x.num >= missing[0].num && x.num < e.num)) {
        vars = P().sharedVars(await P().simulate(`ep${x.id}`, vars));
        s.completed[x.id] = true;
        s.shared[String(+x.id + 1)] = vars;
      }
    }
    // rebobinar al inicio del episodio: se olvidan las escenas y episodios posteriores
    for (const x of MENU.episodes) if (x.num >= e.num) delete s.completed[x.id];
    for (const [id, sc] of Object.entries(s.scenes)) if (epById(sc.episode).num >= e.num) delete s.scenes[id];
    launch({ episode: e.id, node: null, vars: s.shared[e.id] || {}, scene: null });
  };
  if (missing.length) prompt(P().t('EpisodesMenu/SkipEpisodePrompt', 'You have not completed previous episodes. Choices for previous episodes will be randomly pre-populated.'),
    [['EpisodesMenu/SkipEpisodePromptCancel', 'BACK', back], ['EpisodesMenu/SkipEpisodePromptConfirm', 'PLAY', go]]);
  else if (progress) prompt(fmt(P().t('EpisodesMenu/RewindPromptEpisode', 'Starting over from episode {EpisodeNum} will overwrite your current progress!'), { EpisodeNum: e.num }),
    [['EpisodesMenu/RewindPromptCancel', 'CANCEL', back], ['EpisodesMenu/RewindPromptConfirm', 'OVERWRITE', go]]);
  else go();
}

// WBP_ScenesMenu: puntos de guardado del episodio; los no alcanzados aparecen bloqueados
function renderScenes(c) {
  const e = MENU.episodes[page.ep - 1], s = slot();
  c.innerHTML = `<div class="mn-scenes"><h2>${esc(P().t('EpisodesMenu/SceneSelectTitle', 'SCENE SELECT'))} · ${esc(epName(e))}</h2><div class="mn-scene-grid"></div><div class="mn-ep-actions"></div></div>`;
  const grid = $('.mn-scene-grid', c);
  e.scenes.filter((x) => x.rewindable).forEach((sc, i) => {
    const reached = s.scenes[sc.id];
    const b = document.createElement('button');
    b.className = `mn-scene${reached ? '' : ' locked'}`;
    b.style.backgroundImage = reached ? `url(assets/ui/textures/${sc.image}.png)` : '';
    b.innerHTML = `<span>${i + 1}</span>`;
    b.onmouseenter = () => ui('SFX_ShiftUI_ButtonHover');
    b.onclick = () => reached && prompt(P().t('EpisodesMenu/RewindPromptScene', 'Starting over from this scene will overwrite your current progress!'),
      [['EpisodesMenu/RewindPromptCancel', 'CANCEL', back], ['EpisodesMenu/RewindPromptConfirm', 'OVERWRITE', () => {
        // RewindToSavePointScene: se descarta lo posterior a la escena
        const at = e.scenes.indexOf(sc);
        for (const later of e.scenes.slice(at + 1)) delete s.scenes[later.id];
        for (const x of MENU.episodes) if (x.num >= e.num) delete s.completed[x.id];
        launch({ ...reached, scene: sc.id });
      }]]);
    grid.appendChild(b);
  });
  $('.mn-ep-actions', c).append(btn(P().t('EpisodesMenu/Return', 'RETURN'), back, 'small'));
}

// --- Extras (WBP_ExtrasMenu): estadísticas de decisiones, "Art of Dispatch" y cómics (web/data/extras.json, tools/extrasgen.js) ---
const XT = (key, fallback) => tx({ table: '/Game/Shared/Menu/Data/ST_ExtrasStrings.ST_ExtrasStrings', key }, fallback);
let EXTRAS = null;
const loadExtras = () => (EXTRAS ||= fetch('data/extras.json').then((r) => r.json()).catch(() => ({ books: [] })));
// WBP_ExtrasMenuBase: título arriba a la izquierda, contenido y botón de volver abajo
function extrasFrame(c, title, cls) {
  c.innerHTML = `<div class="mn-extras ${cls}"><h2>${esc(title)}</h2><div class="mx-content"></div><div class="mn-ep-actions"></div></div>`;
  $('.mn-ep-actions', c).append(btn(XT('ReturnButton', 'Return'), back, 'small'));
  return $('.mx-content', c);
}
// tres opciones con su portada (WBP_ExtrasMenuOption_Special) y título
function renderExtras(c) {
  const box = extrasFrame(c, wtext('WBP_MainMenu', 'ExtrasButton', 'Extras'), 'main');
  const opts = [
    ['ExtrasMenuOptionChoiceStats', 'Choice Stats', 'T_UI_Extras_Analytics', () => show('choicestats')],
    ['ExtrasMenuOptionArtbook', 'Art of Dispatch', 'T_ExtrasMenu_ArtOfDispatchCover', () => show('books', { kind: 'artbook' })],
    ['ExtrasMenuOptionComics', 'Comic Books', 'T_ExtrasMenu_ComicsCover', () => show('books', { kind: 'comic' })],
  ];
  for (const [key, fb, tex, go] of opts) {
    const b = document.createElement('button');
    b.className = 'mx-opt';
    b.innerHTML = `<i style="background-image:url(assets/ui/textures/${tex}.png)"></i><span>${esc(XT(key, fb))}</span>`;
    b.onmouseenter = () => ui('SFX_MenuUI_ButtonHover');
    b.onclick = () => { ui('SFX_MenuUI_MenuForward'); go(); };
    box.appendChild(b);
  }
}
// WBP_ExtrasMenu_Artbook / _Comics: cuatro capítulos; cada uno se desbloquea al terminar su DependentEpisode
const EXTRA_COVERS = { artbook: (n) => `Artbook_ChapterCovers_${n}`, comic: (n) => ['T_UI_Comics_0000_Splash+TheLastBender', 'T_UI_Comics_0001_PasDeDeux+ShellShock', 'T_UI_Comics_0002_GetUp', 'T_UI_Comics_0003_DeathofMechaMan'][n - 1] };
async function renderBooks(c) {
  const kind = page.kind;
  const box = extrasFrame(c, XT(kind === 'artbook' ? 'ExtrasMenuOptionArtbook' : 'ExtrasMenuOptionComics', ''), 'books');
  const { books } = await loadExtras();
  const list = books.filter((b) => b.kind === kind);
  for (const [i, bk] of list.entries()) {
    const ep = epById(String(bk.episode).replace(/^EPI_Ep/, ''));
    const unlocked = !ep || slot().completed[ep.id];
    const title = kind === 'comic' && bk.comic1
      ? fmt(XT('MultiComicTitleDisplay', '{Comic1} ^and^ {Comic2}'), { Comic1: String(tx(bk.comic1)).toUpperCase(), Comic2: String(tx(bk.comic2 || '')).toUpperCase() }).replace(/\^(.*?)\^/g, '$1')
      : fmt(XT('ChapterButtonTitle', 'Chapter {ChapterNum}'), { ChapterNum: bk.episodeNum });
    const b = document.createElement('button');
    b.className = `mx-book${unlocked ? '' : ' locked'}`;
    b.innerHTML = `<i style="background-image:url(assets/ui/textures/${EXTRA_COVERS[kind](bk.n)}.png)"></i><span>${esc(title)}</span>${unlocked ? '' : `<em>${esc(fmt(XT('ArtbookChapterLocked_1', 'Complete episode {EpisodeNum} to unlock'), { EpisodeNum: ep.num }))}</em>`}`;
    b.onmouseenter = () => ui('SFX_MenuUI_ButtonHover');
    b.onclick = () => { if (!unlocked) { ui('SFX_MenuUI_Error'); return; } ui('SFX_MenuUI_MenuForward'); show('book', { kind, book: i }); };
    box.appendChild(b);
  }
}
// WBP_ArtBookBase + WBP_ArtViewer: página ajustada a la pantalla (StandardZoomLevel), rueda = zoom × (1 + 0.2 × delta)
// entre ZoomOutLimit 1 y ZoomInLimit 5 veces el ajuste, arrastre con el botón izquierdo limitado a la imagen,
// flechas de página y de libro con sus contadores
async function renderBook(c) {
  const { books } = await loadExtras();
  const list = books.filter((b) => b.kind === page.kind && (() => { const ep = epById(String(b.episode).replace(/^EPI_Ep/, '')); return !ep || slot().completed[ep.id]; })());
  const bi = Math.max(0, Math.min(list.length - 1, page.book ?? 0));
  const bk = list[bi];
  page.page = Math.max(0, Math.min((bk?.pages.length || 1) - 1, page.page ?? 0));
  c.innerHTML = `<div class="mx-viewer"><div class="mx-stage"><img class="mx-img" draggable="false" alt=""></div>
    <div class="mx-bar"><span class="mx-nav"><button class="mx-arrow" data-d="-1" data-k="book">◀</button><b class="mx-bookn"></b><button class="mx-arrow" data-d="1" data-k="book">▶</button></span>
    <i class="mx-sep"></i><span class="mx-nav"><button class="mx-arrow" data-d="-1" data-k="page">◀</button><b class="mx-pagen"></b><button class="mx-arrow" data-d="1" data-k="page">▶</button></span></div>
    <div class="mn-ep-actions"></div></div>`;
  $('.mn-ep-actions', c).append(btn(XT('ReturnButton', 'Return'), back, 'small'));
  if (!bk) return;
  const stage = $('.mx-stage', c), img = $('.mx-img', c);
  let zoom = 1, std = 1, x = 0, y = 0;
  const W = () => img.naturalWidth || bk.dims?.x || 1, H = () => img.naturalHeight || bk.dims?.y || 1;
  const clamp = () => {
    const r = stage.getBoundingClientRect(), k = r.width / 1920 || 1;
    const sw = r.width / k, sh = r.height / k, iw = W() * zoom, ih = H() * zoom;
    const mx = Math.max(0, (iw - sw) / 2), my = Math.max(0, (ih - sh) / 2);
    x = Math.max(-mx, Math.min(mx, x)); y = Math.max(-my, Math.min(my, y));
    img.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${zoom})`;
  };
  const reset = () => { const r = stage.getBoundingClientRect(), k = r.width / 1920 || 1; std = Math.min(r.width / k / W(), r.height / k / H()); zoom = std; x = y = 0; clamp(); };
  img.onload = reset;
  const update = () => {
    img.src = bk.pages[page.page];
    $('.mx-pagen', c).textContent = fmt(XT('ArtViewerPage', 'Page {CurrentPage} / {TotalPages}'), { CurrentPage: page.page + 1, TotalPages: bk.pages.length });
    $('.mx-bookn', c).textContent = fmt(XT(page.kind === 'artbook' ? 'ArtViewerChapter' : 'ArtViewerBook', 'Book {CurrentBook} / {TotalBooks}'), { CurrentChapter: bi + 1, TotalChapters: list.length, CurrentBook: bi + 1, TotalBooks: list.length });
    for (const a of c.querySelectorAll('.mx-arrow')) {
      const d = +a.dataset.d;
      a.disabled = a.dataset.k === 'page' ? page.page + d < 0 || page.page + d >= bk.pages.length : bi + d < 0 || bi + d >= list.length;
    }
  };
  const move = (k, d) => {
    if (k === 'page') { const p = page.page + d; if (p < 0 || p >= bk.pages.length) return; page.page = p; ui('SFX_MenuUI_ButtonHover'); update(); }
    else { const b = bi + d; if (b < 0 || b >= list.length) return; page.book = b; page.page = 0; ui('SFX_MenuUI_MenuForward'); render(); }
  };
  for (const a of c.querySelectorAll('.mx-arrow')) a.onclick = () => move(a.dataset.k, +a.dataset.d);
  stage.onwheel = (e) => {
    e.preventDefault();
    const r = stage.getBoundingClientRect(), k = r.width / 1920 || 1;
    const old = zoom;
    zoom = Math.max(std, Math.min(std * 5, zoom * (1 + 0.2 * (e.deltaY < 0 ? 1 : -1))));
    // Update Offset From Zoom Change: el punto bajo el cursor queda quieto
    const cx = (e.clientX - r.left - r.width / 2) / k, cy = (e.clientY - r.top - r.height / 2) / k;
    x = cx + (x - cx) * (zoom / old); y = cy + (y - cy) * (zoom / old);
    clamp();
  };
  let drag = null;
  stage.onmousedown = (e) => { if (e.button === 0) drag = { x: e.clientX, y: e.clientY }; };
  stage.onmousemove = (e) => {
    if (!drag) return;
    const k = stage.getBoundingClientRect().width / 1920 || 1;
    x += (e.clientX - drag.x) / k; y += (e.clientY - drag.y) / k;
    drag = { x: e.clientX, y: e.clientY };
    clamp();
  };
  stage.onmouseup = stage.onmouseleave = () => { drag = null; };
  stage.ondblclick = reset;
  // (preventDefault: tvnav.js no mueve el foco con las flechas que pasan páginas)
  page.keys = (e) => {
    if (e.code === 'ArrowRight' || e.code === 'KeyD') { e.preventDefault(); move('page', 1); }
    else if (e.code === 'ArrowLeft' || e.code === 'KeyA') { e.preventDefault(); move('page', -1); }
    else if (e.code === 'PageDown' || e.code === 'KeyE') { e.preventDefault(); move('book', 1); }
    else if (e.code === 'PageUp' || e.code === 'KeyQ') { e.preventDefault(); move('book', -1); }
  };
  update();
}
// WBP_ExtrasMenu_Analytics: el original muestra porcentajes globales en línea; acá, las decisiones tomadas en la
// ranura activa por episodio (las mismas que el resumen de fin de episodio)
function renderChoiceStats(c) {
  const box = extrasFrame(c, XT('ExtrasMenuOptionChoiceStats', 'Choice Stats'), 'stats');
  const s = slot();
  const done = MENU.episodes.filter((e) => s.completed[e.id]);
  if (!done.length) { box.innerHTML = `<p class="mx-empty">${esc(fmt(XT('ExtraEpisodeUnlock', 'Complete Episode {EpisodeNum}'), { EpisodeNum: 1 }))}</p>`; return; }
  const ep = MENU.episodes[(page.ep ?? done[done.length - 1].num) - 1];
  page.ep = ep.num;
  const tabs = document.createElement('div');
  tabs.className = 'mx-tabs';
  for (const e of MENU.episodes) {
    const t = document.createElement('button');
    t.className = `mx-tab${e === ep ? ' sel' : ''}${s.completed[e.id] ? '' : ' locked'}`;
    t.textContent = fmt(tx({ table: '/Game/Shared/Menu/Widgets/EpisodesMenu/ST_EpisodesMenuStrings', key: 'EpisodeNumber' }, 'EPISODE {EpisodeNum}'), { EpisodeNum: e.num });
    t.onclick = () => { if (s.completed[e.id]) { page.ep = e.num; render(); } };
    tabs.appendChild(t);
  }
  box.appendChild(tabs);
  const list = document.createElement('div');
  list.className = 'mx-choices';
  const picks = s.choices?.[ep.id] || [];
  list.innerHTML = picks.length ? picks.map((p) => `<div class="mx-choice"><b>${esc(p.q || '')}</b><span>${esc(p.a || '')}</span></div>`).join('') : `<p class="mx-empty">${esc(epName(ep))}</p>`;
  box.appendChild(list);
}

// WBP_SaveMenu / WBP_SaveSlotButton
function renderSaves(c) {
  const T = (k, f) => P().t(`SaveMenu/${k}`, f);
  c.innerHTML = `<div class="mn-saves"><h2>${esc(T('SaveMenuTitle', 'SAVE SELECT'))}</h2><div class="mn-slot-list"></div><div class="mn-ep-actions"></div></div>`;
  const list = $('.mn-slot-list', c);
  for (const n of [1, 2, 3]) {
    const s = slots[n];
    const row = document.createElement('div');
    row.className = `mn-slot${n === activeSlot ? ' sel' : ''}${s ? '' : ' empty'}`;
    if (s) {
      const ep = s.resume ? epById(s.resume.episode) : MENU.episodes.filter((e) => s.completed[e.id]).pop();
      const when = new Date(s.created).toLocaleString(P().lang);
      row.innerHTML = `<div class="mn-slot-title">${esc(fmt(T('SaveSlotTitle', 'SAVE SLOT {SaveSlotNum}'), { SaveSlotNum: n }))}</div>
        <div class="mn-slot-created">${esc(fmt(T('SaveSlotCreatedText', 'Created {DateTime}'), { DateTime: when }))}</div>
        <div class="mn-slot-main">${ep ? esc(fmt(T('SaveSlotMainText', 'Episode {EpisodeNum} - {EpisodeTitle}'), { EpisodeNum: ep.num, EpisodeTitle: epName(ep) })) : ''}</div>`;
      const erase = document.createElement('button');
      erase.className = 'mn-slot-erase';
      erase.title = 'Erase';
      erase.innerHTML = '<img src="assets/ui/textures/T_UI_TrashIcon.png" alt="">';
      erase.onclick = (ev) => { ev.stopPropagation(); prompt(fmt(T('EraseSlotPrompt', 'Delete save slot {SlotNum}?'), { SlotNum: n }), [['SaveMenu/WarningPromptNo', 'No', back], ['SaveMenu/WarningPromptYes', 'Yes', () => { delete slots[n]; saveSlots(); back(); }]]); };
      const copy = document.createElement('button');
      copy.className = 'mn-slot-erase';
      copy.title = 'Copy';
      copy.innerHTML = '<img src="assets/ui/textures/T_UI_CopyIcon.png" alt="">';
      copy.onclick = (ev) => { ev.stopPropagation(); const free = [1, 2, 3].find((k) => !slots[k]); if (free) { slots[free] = JSON.parse(JSON.stringify(s)); slots[free].created = Date.now(); saveSlots(); render(); } };
      row.append(copy, erase);
    } else row.innerHTML = `<div class="mn-slot-empty">${esc(T('EmptySlotText', 'EMPTY'))}</div>`;
    row.onmouseenter = () => ui('SFX_ShiftUI_ButtonHover');
    row.onclick = () => { ui('SFX_MenuUI_EpisodeSelect'); activeSlot = n; slot(); saveSlots(); back(); };
    list.appendChild(row);
  }
  $('.mn-ep-actions', c).append(btn(P().t('EpisodesMenu/Return', 'RETURN'), back, 'small'));
}

// WBP_SettingsMenu: pestañas (WBP_SettingsTabList) y filas (deslizador / interruptor / lista)
function renderSettings(c, done) {
  const tabs = SETTINGS_TABS;
  const tab = tabs[page.tab || 0];
  c.innerHTML = `<div class="mn-settings"><h2>${esc(tx({ table: '/Game/Shared/Menu/Data/ST_MenuTitles', key: 'Settings' }, 'Settings'))}</h2><div class="mn-tabs"></div><div class="mn-set-list"></div><div class="mn-ep-actions"></div></div>`;
  tabs.forEach((t, i) => {
    const b = document.createElement('button');
    b.className = `mn-tab${t === tab ? ' sel' : ''}`;
    b.textContent = S(t.k, t.k.replace('SettingCategory', ''));
    b.onclick = () => { ui('SFX_MenuUI_ChangePage'); page.tab = i; render(); };
    $('.mn-tabs', c).appendChild(b);
  });
  const list = $('.mn-set-list', c);
  const st = window.dispatchSettings;
  for (const it of tab.items) {
    const row = document.createElement('div');
    if (it.header) { row.className = 'mn-set-header'; row.textContent = S(it.header, it.header); list.appendChild(row); continue; }
    if (it.info) {
      row.className = 'mn-set-info';
      // televisor: el control remoto (la app de Android TV traduce OK a Enter y Atrás a Escape)
      row.innerHTML = '<p><b>Remote</b></p><p>◀ ▲ ▶ · highlight an answer</p><p>OK · select</p><p>Back · pause / go back</p><p>Arrows · move through menus</p><p>Menu · copy the game again or play from the PC</p>';
      list.appendChild(row); continue;
    }
    row.className = 'mn-set-row';
    const val = it.k === 'Language' ? P().lang : st[it.k];
    let control = '';
    if (it.type === 'slider') control = `<input type="range" min="0" max="1" step="0.01" value="${val}"><output>${Math.round(val * 100)}</output>`;
    else {
      const opts = it.type === 'toggle' ? [[false, S('SettingsOff', 'Off')], [true, S('SettingsOn', 'On')]] : it.options();
      const i = Math.max(0, opts.findIndex(([v]) => v === val));
      control = `<button class="mn-arrow" data-d="-1">‹</button><span class="mn-set-val">${esc(opts[i][1])}</span><button class="mn-arrow" data-d="1">›</button>`;
      row.dataset.opts = '1';
      row._opts = opts; row._i = i;
    }
    row.innerHTML = `<label>${esc(S(it.k, it.k))}</label><div class="mn-set-ctl">${control}</div>`;
    if (it.type === 'slider') {
      const r = $('input', row), o = $('output', row);
      r.oninput = () => { o.textContent = Math.round(r.value * 100); setSetting(it.k, +r.value); };
    } else row.querySelectorAll('.mn-arrow').forEach((a) => {
      a.onclick = () => {
        ui('SFX_MenuUI_DropdownOpen');
        row._i = (row._i + +a.dataset.d + row._opts.length) % row._opts.length;
        setSetting(it.k, row._opts[row._i][0]);
        $('.mn-set-val', row).textContent = row._opts[row._i][1];
      };
    });
    list.appendChild(row);
  }
  $('.mn-ep-actions', c).append(btn(P().t('EpisodesMenu/Return', 'RETURN'), done || back, 'small'));
}

// WBP_PauseMenu: PAUSED (SCHABO 150), episodio, Reanudar, Ajustes, "guardado hace X min", Salir al menú, Salir del juego
function renderPause(c) {
  const st = P().state, e = epById(st.episode);
  const saved = slot().saved;
  const mins = saved ? Math.max(0, Math.round((Date.now() - saved) / 60000)) : null;
  c.innerHTML = `<div class="mn-pause"><div class="mn-pause-box"><div class="mn-paused">${esc(wtext('WBP_PauseMenu', 'Paused', 'PAUSED'))}</div>
    <div class="mn-pause-ep">${esc(epName(e))}</div><div class="mn-pause-num"><img src="assets/ui/textures/T_UI_MechHelmet.png" alt="">${esc(fmt(P().t('EpisodesMenu/EpisodeNumber', 'EPISODE {EpisodeNum}'), { EpisodeNum: e.num }))}</div>
    <div class="mn-pause-btns"></div></div></div>`;
  const b = $('.mn-pause-btns', c);
  b.append(btn(wtext('WBP_PauseMenu', 'ResumeButton', 'Resume'), resumeGame), btn(wtext('WBP_PauseMenu', 'OptionsButton', 'Settings'), () => show('settings', { tab: 0 })));
  const d = document.createElement('div'); d.className = 'mn-divider'; b.append(d);
  const ls = document.createElement('div'); ls.className = 'mn-last-saved';
  ls.textContent = mins == null ? '' : mins < 1 ? 'Guardado hace instantes' : `Guardado hace ${mins} min`;
  b.append(ls);
  b.append(btn(wtext('WBP_PauseMenu', 'QuitToMenuButton', 'Exit To Menu'), () => { P().stop(); stack = []; page = { name: 'main' }; render(); }),
    btn(wtext('WBP_PauseMenu', 'QuitToDesktopButton', 'Exit Game'), () => { P().stop(); window.close(); location.href = 'about:blank'; }));
}
function resumeGame() { ui('SFX_MenuUI_MenuBack'); root.hidden = true; stack = []; page = null; P().resume(); }

// WBP_Prompt: texto y botones (pila de avisos de CommonUI)
function prompt(text, buttons) { show('prompt', { text, buttons }); }
function renderPrompt(c) {
  c.innerHTML = `<div class="mn-prompt"><div class="mn-prompt-box"><p>${esc(page.text).replace(/\r?\n/g, '<br>')}</p><div class="mn-prompt-btns"></div></div></div>`;
  for (const [key, fb, fn] of page.buttons) $('.mn-prompt-btns', c).append(btn(P().t(key, fb), fn, 'small'));
}

// fin de episodio (WBP_EndOfEpisodeStatsScreen): video de créditos (CreditsPanel) junto a las páginas de estadísticas
// (WBP_EndOfEpisode_StatsPanel). AdHocChoiceStatStory: la primera opción cuyo OptionNode se recorrió, si no NoOption*.
// APROX: sin Analytics no hay porcentaje global ({Percentage} queda "—") y las estadísticas a medida
// (AdHocChoiceStatCustomInstance, páginas de turnos) no se muestran.
let EOE = null;
const loadEoe = () => (EOE ||= fetch('data/ui/eoe.json').then((r) => r.json()).catch(() => ({})));
const richStat = (s) => esc(s).replace(/\^([^^]*)\^/g, '<b>$1</b>');
function evalStat(st, played) {
  if (st.kind !== 'story') return null;
  const seen = new Set(played?.visited || []);
  const vars = played?.vars || {};
  const pass = (o) => {
    if (o.node && !seen.has(o.node)) return false;
    if (o.variable) { const v = Object.entries(vars).find(([k]) => k.endsWith('/' + o.variable) || k === o.variable)?.[1]; return o.passOnFalse ? !v : !!v; }
    return !!o.node;
  };
  const o = st.options.find(pass) || st.none;
  return o && (o.text || o.image) ? o : null;
}
const NO_PERCENT = [
  [/\^Tú y un \{Percentage\}\^ de (los )?jugadores/, '^Tú y otros jugadores^'],
  [/\^You and \{Percentage\}\^ of players/, '^You and other players^'],
  [/\^Você e \{Percentage\}\^ dos jogadores/, '^Você e outros jogadores^'],
  [/\^Tu e il \{Percentage\}\^ dei giocatori/, '^Tu e altri giocatori^'],
  [/\^Du und \{Percentage\}\^ der Spieler/, '^Du und andere Spieler^'],
];
const statText = (o) => NO_PERCENT.reduce((s, [re, to]) => s.replace(re, to), tx(o.text));
async function renderEnd(c) {
  const e = epById(page.episode);
  const next = MENU.episodes[e.num];
  const data = (await loadEoe())[e.id] || { pages: [] };
  const played = slot().played?.[e.id];
  const eoe = await loadEoe();
  // páginas de turnos: SavedShiftStats combinados de los turnos del episodio (__shiftStats/<nivel> que deja shift.js)
  const sums = Object.entries(played?.vars || {}).filter(([k]) => k.startsWith('__shiftStats/')).map(([, v]) => v);
  const tot = sums.reduce((a, v) => {
    for (const k of ['perfect', 'lucky', 'powers', 'passed', 'failed', 'missed']) a[k] += v[k] || 0;
    for (const m of ['sent', 'won']) for (const [h, n] of Object.entries(v[m] || {})) a[m][h] = (a[m][h] || 0) + n;
    return a;
  }, { sent: {}, won: {}, perfect: 0, lucky: 0, powers: 0, passed: 0, failed: 0, missed: 0 });
  const CS = (k, f) => P().t(`CommonEndOfEpisodeStatStrings/${k}`, f);
  const top = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0];
  const heroStat = (line, name) => {
    const h = eoe._heroes?.[String(name || '').normalize('NFD').replace(/[^a-z0-9]/gi, '').toLowerCase()];
    return name && { text: `${CS(line, '')} ^${h ? tx(h.name) : name}^`, image: h?.image, hero: h };
  };
  const timesStat = (k, img, n) => n > 0 && { text: `${CS(k + 'Line1', '')} ${fmt(CS(k + 'Line2', '^{Times} times^.'), { Times: n })}`, image: img };
  const gameplay = (st) => {
    const id = st.id || '';
    if (/MostSentHero/.test(id)) return heroStat('MostSentHeroLine1', top(tot.sent));
    if (/MostSuccessfulHero/.test(id)) return heroStat('MostSuccessfulHeroLine1', top(tot.won));
    if (/PerfectFit/.test(id)) return timesStat('PerfectFit', eoe._images?.perfect, tot.perfect);
    if (/LuckyStat/.test(id)) return timesStat('LuckyStat', eoe._images?.lucky, tot.lucky);
    if (/PowerActivation/.test(id)) return timesStat('PowerActivation', null, tot.powers);
    return null; // CallSuccessRate y demás: percentiles globales de Analytics
  };
  // televisor: sin los porcentajes globales de Analytics. "Tú y un {Percentage} de jugadores tirasteis…" pasa a "Tú y
  // otros jugadores tirasteis…" (el verbo sigue concordando); lo que no se puede reescribir así (otros idiomas, "mejor
  // que el {Percentage} de los jugadores") no se muestra
  const global = (o) => /\{Percentage/.test(statText(o));
  const pages = data.pages.map((p) => p.stats.map((s) => (p.gameplay ? gameplay(s) : evalStat(s, played))).filter((o) => o && !global(o))).filter((p) => p.length);
  page.at ??= 0;
  c.innerHTML = `<div class="mn-end2">
    <div class="me-head"><div class="mn-ep-num">${esc(fmt(P().t('EpisodesMenu/EpisodeNumber', 'EPISODE {EpisodeNum}'), { EpisodeNum: e.num }))}</div><div class="mn-ep-title">${esc(epName(e))}</div></div>
    ${data.credits ? `<div class="me-credits"><video src="${mp4(data.credits)}" playsinline></video></div>` : ''}
    <div class="me-stats"></div><div class="mn-end-btns"></div></div>`;
  const v = $('.me-credits video', c);
  if (v) { v.volume = 0.6 * (window.dispatchSettings.MasterVolume ?? 1) * (window.dispatchSettings.MusicVolumeCinematics ?? 1); v.play().catch(() => {}); v.onended = () => v.parentElement.classList.add('done'); }
  const box = $('.me-stats', c);
  const draw = () => {
    const pg = pages[page.at];
    // retrato del héroe (BPDA_EndOfEpisodeStats_Specials): textura de poderes con Position/Scale/IsFlipped y color del nombre
    const img = (o) => (o.hero ? `<div class="me-hero" style="--hx:${o.hero.pos.x};--hy:${o.hero.pos.y};--hs:${o.hero.scale.x};--hf:${o.hero.flip ? -1 : 1};--hc:${o.hero.color || '#fff'}"><i style="background-image:url(assets/eoe/textures/${o.image}.png)"></i></div>`
      : o.video ? `<video src="${mp4(o.video)}" muted loop autoplay playsinline></video>` : o.image ? `<img src="assets/eoe/textures/${o.image}.png" alt="">` : '');
    box.innerHTML = pg ? pg.map((o) => `<div class="me-stat${o.hero ? ' hero' : ''}"${o.hero ? ` style="--hc:${o.hero.color || '#fff'}"` : ''}>${img(o)}
      <p>${richStat(statText(o))}</p></div>`).join('') + `<div class="me-pager">${pages.map((_, i) => `<i class="${i === page.at ? 'on' : ''}"></i>`).join('')}</div>` : '';
    const btns = $('.mn-end-btns', c);
    btns.innerHTML = '';
    if (page.at < pages.length - 1) btns.append(btn(P().t('/1CF4EE924A22A4B04D5A6DAD8A334153', 'CONTINUE'), () => { ui('SFX_MenuUI_MenuForward'); page.at++; draw(); }, 'primary'));
    else if (next) btns.append(btn(P().t('CommonEndOfEpisodeStatStrings/NextEpisode', 'Next Episode') + ` · ${epName(next)}`, () => { v?.pause(); launch(slot().resume); }, 'primary'));
    btns.append(btn(wtext('WBP_PauseMenu', 'QuitToMenuButton', 'Exit To Menu'), () => { v?.pause(); stack = []; page = { name: 'main' }; render(); }));
  };
  draw();
}

// --- enlace con el reproductor ---
// WBP_MainMenu.FadeOut: BG_Black (negro) pasa de 0 a 1 en 0.75 s antes de arrancar el episodio
function launch(r) {
  if (launch.busy) return;
  launch.busy = true;
  ui('SFX_MenuUI_LaunchEpisode');
  const fade = document.createElement('div');
  fade.className = 'mn-fadeout';
  fade.dataset.w = 'BG_Black';
  root.appendChild(fade);
  if (ambience) { const a = ambience.el, v0 = a.volume, t0 = performance.now(); const iv = setInterval(() => { const k = Math.min(1, (performance.now() - t0) / 750); a.volume = v0 * (1 - k); if (k >= 1) clearInterval(iv); }, 30); }
  import('./uianim.js').then((UA) => UA.load('WBP_MainMenu').then((a) => { if (a.FadeOut) UA.play(root, 'WBP_MainMenu', a.FadeOut, { map: { WBP_MainMenu_New_C_5: null } }); }));
  setTimeout(() => { launch.busy = false; fade.remove(); launchNow(r); }, 780);
}
function launchNow(r) {
  ambience?.el.pause();
  ambience = null;
  $('.mn-bg', root).pause();
  root.hidden = true;
  stack = [];
  page = null;
  const s = slot();
  s.resume = { episode: r.episode, node: r.node, vars: r.vars, scene: r.scene || null, visited: r.visited || [] };
  saveSlots();
  P().start(`ep${r.episode}`, r.node, r.vars, r.visited);
}
function hookPlayer() {
  const h = P().hooks;
  // al pasar por el SaveNode de un SavePointInfo se guarda la partida (reanudar / elegir escena)
  h.node = (st, id) => {
    const e = epById(st.episode);
    const sc = e?.scenes.find((x) => x.node === id);
    if (!sc) return;
    const s = slot();
    const snap = { episode: e.id, node: id, vars: { ...st.vars }, visited: [...(st.visited || [])] };
    s.scenes[sc.id] = snap;
    s.resume = { ...snap, scene: sc.id };
    s.saved = Date.now();
    saveSlots();
    showSaveIcon();
  };
  h.end = (st, shared) => {
    const e = epById(st.episode), s = slot();
    s.completed[e.id] = true;
    // lo necesario para las estadísticas de fin de episodio y de Extras (nodos recorridos y variables finales)
    (s.played ||= {})[e.id] = { visited: [...(st.visited || [])], vars: { ...st.vars } };
    const next = MENU.episodes[e.num];
    if (next) { s.shared[next.id] = shared; s.resume = { episode: next.id, node: null, vars: shared, scene: null }; } else s.resume = null;
    s.saved = Date.now();
    saveSlots();
    root.hidden = false; stack = []; page = { name: 'end', episode: e.id }; render();
  };
  h.exit = () => { root.hidden = false; stack = []; page = { name: 'main' }; render(); };
  h.pause = () => { root.hidden = false; stack = []; page = { name: 'pause' }; render(); };
}
// WBP_SaveIcon: aviso breve de guardado
function showSaveIcon() {
  let el = document.querySelector('.mn-saveicon');
  if (!el) { el = document.createElement('div'); el.className = 'mn-saveicon'; document.getElementById('stage').appendChild(el); }
  el.classList.remove('on'); void el.offsetWidth; el.classList.add('on');
}
// PauseOnLostFocus
addEventListener('blur', () => { if (window.dispatchSettings.PauseOnLostFocus && P()?.playing && !P().paused && P().pause()) P().hooks.pause(); });

async function init() {
  const [menu, strings, ...trees] = await Promise.all(['data/menu.json', 'data/ui/_strings.json', 'data/ui/WBP_MainMenu.json', 'data/ui/WBP_PauseMenu.json'].map((u) => fetch(u).then((r) => r.json())));
  await P().ready;
  MENU = menu; STRINGS = strings;
  UI.WBP_MainMenu = trees[0]; UI.WBP_PauseMenu = trees[1];
  if (window.dispatchSettings.Language) await P().setLang(window.dispatchSettings.Language);
  applyColorblind();
  hookPlayer();
  mount();
  show('main', { replace: true });
}
// la primera interacción habilita el audio del fondo (política de reproducción automática)
addEventListener('pointerdown', () => { $('.mn-bg', root)?.play().catch(() => {}); ambience?.el.play().catch(() => {}); }, { once: true });
if (window.Player) init(); else addEventListener('player-ready', init, { once: true });
