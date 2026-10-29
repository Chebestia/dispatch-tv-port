// Censura visual de los videos (AdHocMediaCensor, datos de tools/censorgen.js → data/censors.json).
// Ajustes: StreamerModeCensorBars (Censura visual: apagada / Parcial / Completa) y CensorshipStyle (Blackout → barras
// negras, Mosaic → mosaico con la forma de la barra, Chaotic → imágenes "caóticas"). Las pistas On.Partial salen con
// Parcial y Completa; las On.Full sólo con Completa. Tiempos en cuadros a 30 fps; posición 0–1 del cuadro, rotación en
// radianes alrededor del ancla.
// APROX: el lado del cuadrado base de la textura en pantalla se toma como 0.25 del alto del video por unidad de escala.
(() => {
  let data = null;
  fetch('data/censors.json').then((r) => r.json()).then((d) => { data = d; }).catch(() => {});
  const BASE = 0.25;
  let layer = null;
  const pool = [];
  const lerp = (keys, f) => {
    if (!keys?.length) return 0;
    if (f <= keys[0][0]) return keys[0][1];
    for (let i = 0; i < keys.length - 1; i++) {
      const [t0, v0, c] = keys[i], [t1, v1] = keys[i + 1];
      if (f < t1) return c ? v0 : v0 + ((v1 - v0) * (f - t0)) / (t1 - t0 || 1);
    }
    return keys[keys.length - 1][1];
  };
  const small = document.createElement('canvas');
  function el(i) {
    if (!pool[i]) {
      const d = document.createElement('div');
      d.className = 'cs-item';
      d.innerHTML = '<canvas></canvas>';
      layer.appendChild(d);
      pool[i] = d;
    }
    return pool[i];
  }
  function clear(from = 0) { for (let i = from; i < pool.length; i++) pool[i].hidden = true; }
  function update(video, name) {
    if (!layer) { layer = document.createElement('div'); layer.id = 'censor'; document.getElementById('stage').appendChild(layer); }
    const st = window.dispatchSettings || {};
    const level = st.StreamerModeCensorBars === true ? 'Full' : st.StreamerModeCensorBars;
    const tracks = data && level && name ? data.videos[String(name).split('/').pop().replace(/\.webm$/, '')] : null;
    if (!tracks || !video.videoWidth) { clear(); return; }
    const f = video.currentTime * (data.fps || 30);
    const style = { Blackout: 'BlackBar', Mosaic: 'Mosaic', Chaotic: 'Chaotic' }[st.CensorshipStyle || 'Blackout'] || 'BlackBar';
    const active = tracks.filter((t) => f >= t.start && f <= t.end && (level === 'Full' || t.strength === 'Partial')
      && (style === 'Chaotic' ? t.image.startsWith('Style.Chaotic') : t.image.startsWith('Style.BlackBar') && t.styles.includes(style === 'Mosaic' ? 'Mosaic' : 'BlackBar')));
    // rectángulo del video dentro del elemento (object-fit: contain)
    const box = video.getBoundingClientRect(), sb = document.getElementById('stage').getBoundingClientRect();
    const k = Math.min(box.width / video.videoWidth, box.height / video.videoHeight);
    const W = video.videoWidth * k, H = video.videoHeight * k;
    const X = box.left - sb.left + (box.width - W) / 2, Y = box.top - sb.top + (box.height - H) / 2;
    active.forEach((t, i) => {
      const d = el(i);
      d.hidden = false;
      const tex = data.textures[t.image];
      const s = lerp(t.scale, f), r = lerp(t.rot, f);
      const square = t.image.startsWith('Style.Chaotic') || /Square/.test(tex || '');
      const h = H * BASE * s * (square ? 1.6 : 1), w = square ? h : (h * 16) / 9;
      const cx = X + lerp(t.x, f) * W, cy = Y + lerp(t.y, f) * H;
      Object.assign(d.style, { left: `${cx - w * t.anchor[0]}px`, top: `${cy - h * t.anchor[1]}px`, width: `${w}px`, height: `${h}px`,
        transformOrigin: `${t.anchor[0] * 100}% ${t.anchor[1] * 100}%`, transform: `rotate(${r}rad)` });
      const url = tex ? `url(assets/censor/textures/${tex}.png)` : 'none';
      const cv = d.firstChild;
      if (style === 'Mosaic') {
        // mosaico: el cuadro reducido y ampliado sin suavizar, recortado con la forma de la barra
        d.style.backgroundImage = 'none';
        d.style.webkitMaskImage = d.style.maskImage = url;
        cv.hidden = false;
        cv.width = 32; cv.height = 18;
        const g = cv.getContext('2d');
        try {
          small.width = 32; small.height = 18;
          const sx = ((cx - X) / W) * video.videoWidth, sy = ((cy - Y) / H) * video.videoHeight;
          const sw = (w / W) * video.videoWidth, sh = (h / H) * video.videoHeight;
          g.imageSmoothingEnabled = false;
          g.drawImage(video, sx - sw * t.anchor[0], sy - sh * t.anchor[1], sw, sh, 0, 0, 32, 18);
        } catch { g.fillStyle = '#000'; g.fillRect(0, 0, 32, 18); }
      } else {
        cv.hidden = true;
        d.style.webkitMaskImage = d.style.maskImage = 'none';
        d.style.backgroundImage = url;
      }
    });
    clear(active.length);
  }
  window.DispatchCensor = { update, clear: () => clear() };
})();
