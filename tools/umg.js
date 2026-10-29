// Árbol de un Widget Blueprint (UMG) de UE4.27 → JSON para el reproductor web.
// Uso: node umg.js <WBP.uasset> [salida.json]   |   node umg.js --all <carpeta> <salidaDir>
// Cada nodo: { name, class, widget (ruta del WBP si es un widget de usuario), props, slot, children }.
// Los textos quedan como {ns, key, src}; las imágenes como ruta de textura (/Game/...).
const fs = require('fs');
const path = require('path');
const { parse } = require('./uprops');
const { readAsset } = require('./uasset');

const ROOT = path.join(require('./env').ROOT, 'work', 'extract', 'Dispatch', 'Content');
// propiedades del slot y del widget que hacen falta para dibujar
const SKIP = new Set(['Slot', 'Slots', 'Parent', 'Content', 'bIsVariable', 'Navigation', 'bExpandedInDesigner', 'bLockedInDesigner',
  'DesignerFlags', 'DisplayLabel', 'Bindings', 'Style', 'WidgetStyle', 'NavigationRules']);

function classPackages(file) {
  const a = readAsset(file);
  const map = {};
  for (const im of a.imports) {
    if (!/_C$/.test(im.name) || !im.outer) continue;
    const pkg = a.imports[-im.outer - 1];
    if (pkg && /^\/Game\//.test(pkg.name)) map[im.name] = pkg.name;
  }
  return map;
}

function tree(file) {
  const objs = parse(file, { byIndex: true });
  const pkgs = classPackages(file);
  const at = (ref) => (typeof ref === 'string' && ref.startsWith('export#') ? objs[+ref.slice(7) - 1] : null);
  const clean = (p) => {
    const o = {};
    for (const [k, v] of Object.entries(p || {})) {
      if (SKIP.has(k)) continue;
      if (typeof v === 'string' && v.startsWith('export#')) continue;
      o[k] = v;
    }
    return o;
  };
  const seen = new Set();
  const node = (o) => {
    if (!o || seen.has(o)) return null;
    seen.add(o);
    const p = o.props || {};
    const n = { name: o.name, class: o.class };
    if (pkgs[o.class]) n.widget = pkgs[o.class];
    n.props = clean(p);
    const slot = at(p.Slot);
    if (slot) n.slot = { class: slot.class, ...clean(slot.props) };
    const kids = [];
    for (const s of p.Slots || []) { const c = node(at(at(s)?.props?.Content)); if (c) kids.push(c); }
    if (!p.Slots && p.Content) { const c = node(at(p.Content)); if (c) kids.push(c); }
    // widget de usuario con NamedSlot: el contenido que le pone este WBP (se marca con namedSlot)
    for (const b of p.NamedSlotBindings || []) { const c = node(at(b.Content)); if (c) { c.namedSlot = b.Name; kids.push(c); } }
    if (kids.length) n.children = kids;
    return n;
  };
  const wt = objs.find((o) => o.class === 'WidgetTree' && /WidgetTree/.test(o.name) && objs[o.outer - 1]?.class === 'WidgetBlueprintGeneratedClass') || objs.find((o) => o.class === 'WidgetTree');
  const cls = objs.find((o) => o.class === 'WidgetBlueprintGeneratedClass');
  const cdo = objs.find((o) => /^Default__/.test(o.name));
  // animaciones: nombre y duración (MovieScene.PlaybackRange en ticks / 60000)
  const anims = objs.filter((o) => o.class === 'MovieScene' && o.props?.PlaybackRange).map((o) => ({ name: o.name, seconds: +((o.props.PlaybackRange[1] - o.props.PlaybackRange[0]) / 60000).toFixed(3) }));
  return {
    class: cls?.name, super: pkgs[Object.keys(pkgs).find((k) => cls && objs[cls.outer - 1] && false)] || undefined,
    defaults: clean(cdo?.props), animations: anims,
    root: wt ? node(at(wt.props?.RootWidget)) : null,
  };
}

function textures(t, out = new Set()) {
  const walk = (o) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) return o.forEach(walk);
    for (const [k, v] of Object.entries(o)) {
      if (k === 'ResourceObject' && typeof v === 'string' && v.startsWith('/Game/')) out.add(v.replace(/\.[^/]*$/, ''));
      else walk(v);
    }
  };
  walk(t);
  return out;
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--all') {
    const [dir, outDir] = args.slice(1);
    fs.mkdirSync(outDir, { recursive: true });
    const tex = new Set();
    const walk = (d) => {
      for (const f of fs.readdirSync(d)) {
        const p = path.join(d, f);
        if (fs.statSync(p).isDirectory()) walk(p);
        else if (/^WBP_.*\.uasset$/.test(f)) {
          try {
            const t = tree(p);
            textures(t, tex);
            fs.writeFileSync(path.join(outDir, f.replace('.uasset', '.json')), JSON.stringify(t));
          } catch (e) { console.error(f, e.message); }
        }
      }
    };
    walk(dir);
    fs.writeFileSync(path.join(outDir, '_textures.txt'), [...tex].join('\n'));
    console.log(`${tex.size} texturas`);
  } else {
    const t = tree(args[0]);
    const s = JSON.stringify(t, null, 1);
    if (args[1]) fs.writeFileSync(args[1], s); else console.log(s);
  }
}
module.exports = { tree, textures, ROOT };
