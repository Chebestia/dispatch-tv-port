// Personajes de la historia (AdHocStoryCharacter: Char_X con SubtitleColor y DisplayName) → web/data/characters.json
// { "Char_Brainbook": { name: {ns, key, src}, color: "#d4e3f0" } }. WBP_SubtitleBlock usa el color con "Color por personaje".
// Uso: node tools/chargen.js
const fs = require('fs');
const path = require('path');
const { parse } = require('./uprops');

const { ROOT } = require('./env');
const out = {}, aliases = {};
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { walk(p); continue; }
    if (!/^(Char|Alias)_.*\.uasset$/.test(e.name)) continue;
    let o;
    try { o = Object.values(parse(p))[0]; } catch { continue; }
    if (o?.class === 'AdHocStoryCharacterAlias') { aliases[e.name.slice(0, -7)] = o.props; continue; }
    if (o?.class !== 'AdHocStoryCharacter') continue;
    const c = o.props.SubtitleColor;
    const hex = (v) => v.toString(16).padStart(2, '0');
    out[e.name.slice(0, -7)] = { name: o.props.DisplayName || null, color: c ? `#${hex(c.r)}${hex(c.g)}${hex(c.b)}` : null };
  }
})(path.join(ROOT, 'work', 'extract', 'Dispatch'));
// AdHocStoryCharacterAlias: nombre propio (Mecha Man) con el color del personaje al que apunta
for (const [id, a] of Object.entries(aliases)) {
  const base = out[String(a.Character || '').replace(/^.*\./, '')];
  out[id] = { name: a.DisplayName || base?.name || null, color: base?.color || null };
}
fs.writeFileSync(path.join(ROOT, 'web', 'data', 'characters.json'), JSON.stringify(out));
console.log(`${Object.keys(out).length} personajes, ${Object.values(out).filter((c) => c.color).length} con color`);
