// Íconos de teclas y ratón como los dibuja el juego (ControllerData_KeyboardMouse → MI_UI_PC__<tecla> sobre
// M_UI_ButtonPrompt_Master). La textura T_UI_PC__<tecla> trae tres máscaras: R = relleno, G = contorno medio,
// B = contorno exterior; cada una se pinta con su color según el estado (VectorValues del material):
//   0: relleno #2B2E35, medio #FFFFFF, exterior #061012 (normal)
//   1: relleno #A0E2FF, medio #003754, exterior #FFFFFF (resaltado)
//   2: relleno #BA7800, medio #FFFFFF, exterior #061012
// También recolorea otras texturas RGBA de M_UI_RGBAMasking (ColorR/G/B), p. ej. T_UI_Icon_X_DropShadow.
// Uso: DispatchPrompts.icon('Escape', 0) → Promise<dataURL>; DispatchPrompts.mask(url, [r, g, b]) → Promise<dataURL>
(() => {
  const STATES = [
    ['#2B2E35', '#FFFFFF', '#061012'],
    ['#A0E2FF', '#003754', '#FFFFFF'],
    ['#BA7800', '#FFFFFF', '#061012'],
  ];
  const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
  const cache = new Map();
  const base = (() => { const s = document.currentScript?.src || location.href; return s.replace(/[^/]*$/, ''); })();
  function mask(url, colors) {
    const key = `${url}|${colors.join(',')}`;
    if (cache.has(key)) return cache.get(key);
    const cols = colors.map((c) => (typeof c === 'string' ? hex(c) : c));
    const p = new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = img.width; cv.height = img.height;
        const g = cv.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, cv.width, cv.height), a = d.data;
        for (let i = 0; i < a.length; i += 4) {
          const m = [a[i] / 255, a[i + 1] / 255, a[i + 2] / 255];
          const sum = m[0] + m[1] + m[2];
          const al = Math.min(1, Math.max(m[0], m[1], m[2])) * (a[i + 3] / 255);
          for (let k = 0; k < 3; k++) a[i + k] = sum ? (m[0] * cols[0][k] + m[1] * cols[1][k] + m[2] * cols[2][k]) / sum : 0;
          a[i + 3] = al * 255;
        }
        g.putImageData(d, 0, 0);
        resolve(cv.toDataURL());
      };
      img.onerror = () => resolve(url);
      img.src = url;
    });
    cache.set(key, p);
    return p;
  }
  const icon = (key, state = 0) => mask(`${base}assets/ui/textures/T_UI_PC__${key}.png`, STATES[state] || STATES[0]);
  // KeyboardEvent.code → nombre de tecla de UE (ControllerData_KeyboardMouse)
  const CODE = { Escape: 'Escape', Tab: 'Tab', Space: 'SpaceBar', Enter: 'Enter', Backspace: 'BackSpace', ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right' };
  const fromCode = (code) => CODE[code] || (/^Key([A-Z])$/.exec(code)?.[1]) || code;
  // aplica el ícono a un elemento (como background-image)
  function apply(el, key, state = 0) { icon(key, state).then((u) => { el.style.backgroundImage = `url(${u})`; }); }
  window.DispatchPrompts = { icon, mask, apply, fromCode, STATES };
})();
