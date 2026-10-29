// Partidas en la PC: el port sigue usando localStorage (menu.js, player.js, lang.js), pero las claves dispatch-web-*
// se guardan también en el servidor (el de la app en el televisor, o tools/servidor.js en la PC). Va antes que los
// demás scripts:
//   al cargar, trae del servidor todas las claves (pedido síncrono, para que el menú ya las encuentre) y las pone en el
//   localStorage; las que sólo están en el televisor (partidas de antes de esto) se suben;
//   cada setItem / removeItem de esas claves se manda al servidor (agrupado por clave, siempre el último valor y en
//   orden), y al salir de la app se manda lo pendiente.
// Si el servidor no responde, el juego sigue con lo que haya en el televisor.
(() => {
  const KEY = /^dispatch-web/;
  const ls = window.localStorage;
  const set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;

  const timers = new Map();
  let chain = Promise.resolve();
  function send(k) {
    timers.delete(k);
    const v = ls.getItem(k);
    chain = chain.then(() => fetch(`/__saves/${k}`, v == null ? { method: 'DELETE' } : { method: 'PUT', body: v })).catch((e) => console.warn('partidas: no se pudo guardar en la PC', k, e));
  }
  function queue(k) {
    clearTimeout(timers.get(k));
    timers.set(k, setTimeout(() => send(k), 400));
  }
  function flush() {
    for (const [k, t] of timers) {
      clearTimeout(t);
      timers.delete(k);
      const v = ls.getItem(k);
      // al salir la página puede no terminar un fetch común: keepalive (hasta 64 KB) o el último intento normal
      const init = v == null ? { method: 'DELETE' } : { method: 'PUT', body: v };
      fetch(`/__saves/${k}`, { ...init, keepalive: (v || '').length < 60000 }).catch(() => {});
    }
  }

  try {
    const x = new XMLHttpRequest();
    x.open('GET', '/__saves', false);
    x.send();
    if (x.status === 200) {
      const remote = JSON.parse(x.responseText);
      for (const [k, v] of Object.entries(remote)) set.call(ls, k, v);
      for (let i = 0; i < ls.length; i++) {
        const k = ls.key(i);
        if (KEY.test(k) && !(k in remote)) queue(k);
      }
    }
  } catch (e) { console.warn('partidas: el servidor no respondió, se usa lo guardado en el televisor', e); }

  Storage.prototype.setItem = function (k, v) { set.call(this, k, v); if (this === ls && KEY.test(k)) queue(k); };
  Storage.prototype.removeItem = function (k) { remove.call(this, k); if (this === ls && KEY.test(k)) queue(k); };
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });
})();
