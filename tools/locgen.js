// Genera web/data/loc/<idioma>.json con las traducciones de los textos que usan los grafos de los episodios
// (subtítulos y opciones de decisión), a partir de los .locres de Content/Localization (episodios + Shared).
// Uso: node locgen.js
const fs = require('fs');
const path = require('path');
const { readLocres } = require('./locres');

const { ROOT } = require('./env');
const LOC = path.join(ROOT, 'work', 'extract', 'Dispatch', 'Content', 'Localization');
const DATA = path.join(ROOT, 'web', 'data');
const OUT = path.join(DATA, 'loc');
fs.mkdirSync(OUT, { recursive: true });

// claves usadas por los grafos
const used = new Set();
for (const f of fs.readdirSync(DATA).filter((f) => /^ep\d+\.json$/.test(f))) {
  const g = JSON.parse(fs.readFileSync(path.join(DATA, f)));
  for (const t of Object.values(g.text)) if (t[2]) used.add(t[2]);
  for (const n of Object.values(g.nodes)) {
    for (const o of n.options || []) if (o.textKey) used.add(o.textKey);
    for (const x of n.notes || []) if (x.text?.key) used.add(`${x.text.ns}/${x.text.key}`); // avisos "… recordará esto"
  }
}

// textos de los niveles de hackeo: cualquier FText {ns, key, src} dentro de los JSON
(function scan(v) {
  if (!v || typeof v !== 'object') return;
  if (typeof v.key === 'string' && typeof v.src === 'string' && 'ns' in v) used.add(`${v.ns}/${v.key}`);
  // textos literales del bytecode de los niveles ({k: 'text', key: {k: 'const', v: '"…"'}, ns: …}: ForceResting "Handcuffed")
  const q = (x) => (typeof x?.v === 'string' ? x.v.replace(/^"|"$/g, '') : null);
  if (v.k === 'text' && q(v.key)) used.add(`${q(v.ns) || ''}/${q(v.key)}`);
  for (const x of Array.isArray(v) ? v : Object.values(v)) scan(x);
})(['heroes.json', 'herodb.json'].filter((f) => fs.existsSync(path.join(DATA, f))).map((f) => JSON.parse(fs.readFileSync(path.join(DATA, f)))).concat(['hacking', 'shifts', 'ui'].flatMap((d) => fs.existsSync(path.join(DATA, d)) ? fs.readdirSync(path.join(DATA, d)).filter((f) => /^(LV_|WBP_|crimetypes|career|eoe|tutorials|lines|heronames)/.test(f)).map((f) => JSON.parse(fs.readFileSync(path.join(DATA, d, f)))) : [])));

// textos sueltos de widgets que el port arma a mano (Format de WBP_HeroTeamWidget: clima del turno)
for (const k of ['ADD5894947AB929E356D3494EAEDB0D4', '0F67770B439B3DD876DB72AAACDBA0C6', '181EE7C44A537D70D905CD9011AD5215', '1E1A37EE4045FE1DFD50DF897C4A7A12',
  '00B6ED794C0A74624E6A8EA022616AD5']) used.add(`/${k}`); // WBP_Database_Trait: "Unknown" de los poderes sin descubrir

// String Tables de los menús (work/ui-tables.txt, de uigen.js): en los locres la clave es "<TableNamespace>/<clave>".
// El texto de origen (inglés) queda en web/data/ui/_strings.json como respaldo.
const tablesList = path.join(ROOT, 'work', 'ui-tables.txt');
if (fs.existsSync(tablesList)) {
  const { readStringTable } = require('./stringtable');
  const strings = {};
  for (const pkg of fs.readFileSync(tablesList, 'utf8').replace(/^﻿/, '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean)) {
    const f = path.join(ROOT, 'work', 'extract', 'Dispatch', 'Content', pkg.replace(/^\/Game\//, '') + '.uasset');
    if (!fs.existsSync(f)) continue;
    const st = readStringTable(f);
    for (const [k, v] of Object.entries(st.entries)) { strings[`${pkg}/${k}`] = { key: `${st.namespace}/${k}`, src: v }; used.add(`${st.namespace}/${k}`); }
  }
  fs.writeFileSync(path.join(DATA, 'ui', '_strings.json'), JSON.stringify(strings));
}

// espacios de nombres completos de menús y ajustes (los ajustes los arma el código nativo: sólo están en los locres)
const WHOLE_NS = /^(AdHocStory\.Characters|DispatchSettings(\..*)?|SettingsSubtitlePreview|FAdHocSubtitlesModule|EndOfEpisodeScreen|CommonEndOfEpisodeStatStrings|ExtrasStrings|SaveMenu|EpisodesMenu|EpisodesMenuUnlock|EpisodeTitles|Episodes|EpisodeBlurbs|TutorialText|ST_\w+)$/;

const langs = new Set();
for (const target of fs.readdirSync(LOC)) {
  const dir = path.join(LOC, target);
  if (!fs.statSync(dir).isDirectory()) continue;
  for (const l of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, l)).isDirectory()) langs.add(l);
}

const summary = [];
for (const lang of [...langs].sort()) {
  const table = {};
  for (const target of fs.readdirSync(LOC)) {
    const file = path.join(LOC, target, lang, `${target}.locres`);
    if (!fs.existsSync(file)) continue;
    for (const [k, v] of Object.entries(readLocres(file))) if (used.has(k) || WHOLE_NS.test(k.slice(0, k.lastIndexOf('/')))) table[k] = v;
  }
  fs.writeFileSync(path.join(OUT, `${lang}.json`), JSON.stringify(table));
  summary.push(`${lang}:${Object.keys(table).length}`);
}
console.log(`${used.size} claves usadas; ${summary.join(' ')}`);
