// Control remoto (Android TV): flechas del D-pad, OK (Enter) y Atrás (Escape, que la app de Android TV manda al tocar
// Atrás). En los menús las flechas mueven el foco al control más cercano en esa dirección y OK lo activa; en una fila de
// ajustes, Izquierda / Derecha cambian el valor como el selector del original con mando. Lo que una página ya maneja
// (e.defaultPrevented, p. ej. pasar páginas en el visor de libros) no se toca. Durante las escenas no hace nada: las
// decisiones y la pausa los atiende player.js.
(() => {
  const FOCUSABLE = 'button:not([disabled]), [tabindex="0"], .mn-set-row';
  const visible = (el) => { if (el.closest('[hidden]')) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  // capa activa: el menú si está a la vista (pausa incluida); si no, nada
  const layer = () => { const m = document.querySelector('.mn'); return m && !m.hidden ? m : null; };
  // las flechas ‹ › de una fila de ajustes no son destino propio: la fila entera recibe el foco
  const items = (root) => [...root.querySelectorAll(FOCUSABLE)]
    .filter((el) => visible(el) && (el.classList.contains('mn-set-row') || !el.closest('.mn-set-row')));

  function ensureFocus(root) {
    const list = items(root);
    if (!list.length) return null;
    if (list.includes(document.activeElement)) return document.activeElement;
    // la fila de ajustes recibe foco como un todo
    for (const r of root.querySelectorAll('.mn-set-row')) r.tabIndex = 0;
    // el botón principal de la página (JUGAR en episodios), si no el seleccionado, si no el primero
    const first = [...root.querySelectorAll('.mn-btn.primary, .mn-btn.sel, .mn-tab.sel')].find((el) => list.includes(el)) || list[0];
    first.focus({ preventScroll: false });
    return first;
  }

  // el candidato más cercano en la dirección (centro a centro), penalizando el desvío lateral
  function nearest(from, list, dir) {
    const a = from.getBoundingClientRect(), ax = a.left + a.width / 2, ay = a.top + a.height / 2;
    let best = null, bestD = Infinity;
    for (const el of list) {
      if (el === from || from.contains(el) || el.contains(from)) continue;
      const b = el.getBoundingClientRect(), bx = b.left + b.width / 2, by = b.top + b.height / 2;
      const dx = bx - ax, dy = by - ay;
      const along = { ArrowRight: dx, ArrowLeft: -dx, ArrowDown: dy, ArrowUp: -dy }[dir];
      const side = dir === 'ArrowRight' || dir === 'ArrowLeft' ? Math.abs(dy) : Math.abs(dx);
      if (along <= 2) continue;
      const d = along + side * 2.5;
      if (d < bestD) { bestD = d; best = el; }
    }
    return best;
  }

  function adjustRow(row, dir) {
    const range = row.querySelector('input[type=range]');
    if (range) {
      const step = 0.05;
      range.value = Math.max(+range.min, Math.min(+range.max, +range.value + (dir === 'ArrowRight' ? step : -step)));
      range.dispatchEvent(new Event('input', { bubbles: true }));
      return;
    }
    row.querySelector(`.mn-arrow[data-d="${dir === 'ArrowRight' ? 1 : -1}"]`)?.click();
  }

  addEventListener('keydown', (e) => {
    const root = layer();
    if (!root || e.defaultPrevented) return;
    if (!/^Arrow(Up|Down|Left|Right)$/.test(e.key) && e.key !== 'Enter') return;
    const cur = ensureFocus(root);
    if (!cur) return;
    if (e.key === 'Enter') {
      // las filas de ajustes no se activan; los botones sí (sin repetir el click nativo de Enter sobre un botón enfocado)
      if (cur.tagName !== 'BUTTON' && !cur.classList.contains('mn-set-row')) { e.preventDefault(); cur.click(); }
      return;
    }
    e.preventDefault();
    if (cur.classList.contains('mn-set-row') && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) { adjustRow(cur, e.key); return; }
    const next = nearest(cur, items(root), e.key);
    if (next) {
      next.focus();
      next.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
      window.dispatchAudio?.sfx?.('SFX_ShiftUI_ButtonHover', 0.4);
    }
  });

  // después de cada cambio de página del menú, el foco vuelve a un control visible
  new MutationObserver(() => { const root = layer(); if (root && document.activeElement && !root.contains(document.activeElement)) ensureFocus(root); })
    .observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
})();
