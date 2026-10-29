// Reproductor de las animaciones originales de los widgets (UWidgetAnimation), datos de tools/uianimgen.js.
// Cada pista apunta a un widget por nombre: en el DOM se busca el elemento con data-w="<nombre>" dentro de la raíz
// (los nombres WBP_*_C_N son el propio widget = la raíz). Propiedades que se aplican:
//   RenderOpacity → opacity · RenderTransform → transform (pivote al centro, como el RenderTransformPivot 0.5) ·
//   colores (BrushColor, ColorAndOpacity, …) → variable CSS --ua-<prop> en sRGB · Padding → padding (o margin si es del slot) ·
//   Visibility → display / visibility · parámetros de material → variables CSS --ua-<param>.
// Las traslaciones van en unidades de Slate; se multiplican por la escala de la raíz (opción u, o la variable CSS --u).
const cache = {};
const base = new URL('./data/ui-anims/', import.meta.url);

export function load(wbp) {
  if (!cache[wbp]) cache[wbp] = fetch(new URL(`${wbp}.json`, base)).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
  return cache[wbp];
}
// para usar sin esperar (si ya se cargó)
const ready = {};
export async function preload(...wbps) { await Promise.all(wbps.map(async (w) => { ready[w] = await load(w); })); }
export const get = (wbp, name) => ready[wbp]?.[name] || null;

// FMovieSceneFloatChannel: constante, lineal o cúbica (Hermite con las tangentes guardadas, ya por segundo)
export function evalChannel(c, t) {
  if (!c) return undefined;
  const T = c.t, V = c.v;
  if (!T.length) return c.d;
  if (t <= T[0]) return V[0];
  const n = T.length - 1;
  if (t >= T[n]) return V[n];
  let k = 0;
  while (k < n - 1 && t >= T[k + 1]) k++;
  const dt = T[k + 1] - T[k], u = (t - T[k]) / dt;
  const mode = c.i ? c.i[k] : 2;
  if (mode === 1) return V[k];
  if (mode === 0) return V[k] + (V[k + 1] - V[k]) * u;
  const l = c.l ? c.l[k] : 0, a = c.a ? c.a[k + 1] : 0;
  const u2 = u * u, u3 = u2 * u;
  return (2 * u3 - 3 * u2 + 1) * V[k] + (u3 - 2 * u2 + u) * dt * l + (-2 * u3 + 3 * u2) * V[k + 1] + (u3 - u2) * dt * a;
}

const lin2srgb = (c) => Math.round(255 * Math.max(0, Math.min(1, c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055)));
const VIS = ['visible', 'collapsed', 'hidden', 'visible', 'visible'];

function targets(root, name, map) {
  if (!name || /^WBP_\w+_C_\d+$/.test(name)) return [root];
  const sel = map?.[name];
  if (sel === null) return [];
  if (sel instanceof Element) return [sel];
  if (sel === ':scope') return [root];
  const list = root.querySelectorAll(sel || `[data-w="${CSS.escape(name)}"]`);
  return list.length ? [...list] : [];
}

function apply(el, tr, t, u) {
  const ch = tr.ch, v = (k, d) => { const x = evalChannel(ch[k], t); return x === undefined ? d : x; };
  switch (tr.k) {
    case 'float':
      if (tr.p === 'RenderOpacity') el.style.opacity = v('v', 1);
      else el.style.setProperty(`--ua-${tr.p}`, v('v', 0));
      break;
    case 'tr2d': {
      const tx = v('tx', 0) * u, ty = v('ty', 0) * u, rot = v('rot', 0), sx = v('sx', 1), sy = v('sy', 1), hx = v('hx', 0), hy = v('hy', 0);
      const tf = `translate(${tx.toFixed(2)}px,${ty.toFixed(2)}px) rotate(${rot.toFixed(3)}deg) scale(${sx.toFixed(4)},${sy.toFixed(4)})${hx || hy ? ` skew(${-hx}deg,${-hy}deg)` : ''}`;
      // data-tfvar: el elemento ya se ubica con transform en CSS; la animación se compone por la variable --ua-tf
      if (el.hasAttribute('data-tfvar')) el.style.setProperty('--ua-tf', tf); else el.style.transform = tf;
      if (el.hasAttribute('data-scalevar')) { el.style.setProperty('--ua-sx', sx.toFixed(4)); el.style.setProperty('--ua-sy', sy.toFixed(4)); }
      break;
    }
    case 'color': {
      const r = v('r', 1), g = v('g', 1), b = v('b', 1), a = v('a', 1);
      el.style.setProperty(`--ua-${tr.p}`, `rgba(${lin2srgb(r)},${lin2srgb(g)},${lin2srgb(b)},${a.toFixed(3)})`);
      break;
    }
    case 'margin': {
      const s = `${(v('t', 0) * u).toFixed(2)}px ${(v('r', 0) * u).toFixed(2)}px ${(v('b', 0) * u).toFixed(2)}px ${(v('l', 0) * u).toFixed(2)}px`;
      if (tr.slot) {
        // el padding del slot mueve el widget dentro de su contenedor: además se publica cada lado sin unidad (unidades de Slate)
        el.style.setProperty('--ua-slot-pad', s);
        for (const k of ['l', 't', 'r', 'b']) if (ch[k]) el.style.setProperty(`--ua-s${k}`, v(k, 0).toFixed(2));
      } else el.style.setProperty('--ua-pad', s);
      break;
    }
    case 'byte':
      if (tr.p === 'Visibility') {
        const vis = VIS[Math.round(v('v', 0))] || 'visible';
        el.style.display = vis === 'collapsed' ? 'none' : '';
        el.style.visibility = vis === 'hidden' ? 'hidden' : '';
      } else el.style.setProperty(`--ua-${tr.p}`, Math.round(v('v', 0)));
      break;
    case 'mat':
      for (const [k, c] of Object.entries(ch)) el.style.setProperty(`--ua-${k.replace(/[^\w-]/g, '_')}`, evalChannel(c, t));
      break;
  }
}

const running = new WeakMap(); // raíz → { nombre de animación → reproducción }

// play(root, wbp, nombre, { map, speed, reverse, u, from }) → promesa al terminar (o al ser reemplazada / detenida)
export function play(root, wbp, name, opt = {}) {
  const anim = typeof name === 'object' ? name : get(wbp, name);
  if (!root || !anim) return Promise.resolve(false);
  const u = opt.u ?? (parseFloat(getComputedStyle(root).getPropertyValue('--u')) || 1);
  const speed = opt.speed || 1, reverse = !!opt.reverse;
  const per = running.get(root) || new Map();
  running.set(root, per);
  const key = opt.key || name;
  const prev = per.get(key);
  // como UUMGSequencePlayer: si ya estaba sonando la misma animación, sigue desde su tiempo actual
  let time = opt.from ?? (prev ? prev.time : reverse ? anim.len : 0);
  if (prev) prev.stop(false);
  const bound = anim.tracks.map((tr) => [tr, targets(root, tr.w, opt.map)]).filter(([, els]) => els.length);
  return new Promise((resolve) => {
    let last = performance.now(), raf = 0, alive = true, guard = 0;
    const rec = { get time() { return time; }, stop(done) { alive = false; cancelAnimationFrame(raf); clearTimeout(guard); if (per.get(key) === rec) per.delete(key); resolve(done); } };
    // respaldo: con la pestaña oculta requestAnimationFrame no corre; al vencer el tiempo se deja el estado final
    if (!opt.loop) guard = setTimeout(() => {
      if (!alive) return;
      time = reverse ? 0 : anim.len;
      for (const [tr, els] of bound) for (const el of els) apply(el, tr, time, u);
      rec.stop(true);
    }, ((reverse ? time : anim.len - time) / speed) * 1000 + 300);
    per.set(key, rec);
    const frame = (now) => {
      if (!alive) return;
      if (!root.isConnected) { rec.stop(false); return; }
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      time += (reverse ? -dt : dt) * speed;
      const end = reverse ? time <= 0 : time >= anim.len;
      if (end) time = reverse ? 0 : anim.len;
      for (const [tr, els] of bound) for (const el of els) apply(el, tr, time, u);
      if (end) { if (opt.loop) { time = reverse ? anim.len : 0; raf = requestAnimationFrame(frame); return; } rec.stop(true); return; }
      raf = requestAnimationFrame(frame);
    };
    for (const [tr, els] of bound) for (const el of els) apply(el, tr, time, u);
    raf = requestAnimationFrame(frame);
  });
}
export function stop(root, name) { const r = running.get(root)?.get(name); if (r) r.stop(false); }
export function isPlaying(root, name) { return !!running.get(root)?.get(name); }
// deja el estado final (o el inicial) sin reproducir
export function setAt(root, wbp, name, t, opt = {}) {
  const anim = get(wbp, name);
  if (!root || !anim) return;
  const u = opt.u ?? (parseFloat(getComputedStyle(root).getPropertyValue('--u')) || 1);
  const tt = t === 'end' ? anim.len : t;
  for (const tr of anim.tracks) for (const el of targets(root, tr.w, opt.map)) apply(el, tr, tt, u);
}
// secuencia de animaciones una tras otra
export async function chain(root, wbp, names, opt = {}) {
  for (const n of names) if (!(await play(root, wbp, n, opt)) && !root.isConnected) return false;
  return true;
}
