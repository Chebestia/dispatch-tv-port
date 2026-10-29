// Compila el JSON de la carpeta Story de un episodio a un grafo compacto para el reproductor web.
// Uso: node compile.js <story.json> <salida.json>
const fs = require('fs');
const [inPath, outPath] = process.argv.slice(2);
const j = JSON.parse(fs.readFileSync(inPath));

const TICKS = 120; // ticks de secuencia por milisegundo (120000/s)
const short = (p) => p && p.replace(/^.*\//, '').replace(/\..*$/, '').replace(/:.*$/, '');
const main = (k) => { const v = j[k]; return v && v[k.split('/').pop()]; };
const assetOf = (p) => p && p.replace(/^\/[^/]+\/Story\//, '').replace(/\..*$/, '');
// las variables de /Game/Shared persisten entre episodios y pueden llamarse igual que una del episodio
const varName = (p) => (/^\/Game\/Shared\//.test(p) ? 'Shared/' : '') + short(p);
const sub = (path) => {
  // "/X/Story/Conditions/Cond.Cond:l0-var" -> export l0-var de ese asset
  const [obj, name] = path.split(':');
  const asset = j[assetOf(obj)];
  return asset && asset[name];
};

// --- expresiones ---
function expr(path) {
  const e = sub(path);
  if (!e) return null;
  const p = e.props;
  switch (e.class) {
    case 'AdHocStoryVariableExpression': return { v: varName(p.Variable) };
    case 'AdHocStoryBooleanLiteralExpression': return { lit: !!p.bValue };
    case 'AdHocStoryNumberLiteralExpression': return { lit: p.Value || 0 };
    case 'AdHocStoryEnumerationLiteralExpression': return { lit: p.Value };
    case 'AdHocStoryNestedConditionExpression': return { cond: cond(p.Condition) };
    case 'AdHocStoryComparisonExpression':
      return { cmp: (p.ComparisonOperator || 'Equal').replace(/^.*::/, ''), l: expr(p.LeftExpression), r: expr(p.RightExpression) };
    case 'AdHocStoryCompoundExpression':
      return { op: /OR/.test(path.split(':')[1]) || /Or/.test(p.Operator || '') ? 'or' : 'and', of: (p.SubExpressions || []).map(expr) };
    default: return { unknown: e.class };
  }
}
// ruta de paquete de una String Table → .uasset extraído (/Game/... o /<Plugin>/...)
const stringTableFile = (ref) => {
  const p = String(ref).replace(/\.[^/.]*$/, '');
  const EX = require('path').join(require('./env').ROOT, 'work', 'extract', 'Dispatch');
  const m = /^\/Game\/(.*)$/.exec(p) || /^\/(\w+)\/(.*)$/.exec(p);
  return m.length === 2 ? `${EX}/Content/${m[1]}.uasset` : `${EX}/Plugins/${m[1]}/Content/${m[2]}.uasset`;
};
const conditions = {};
function cond(path) {
  if (!path) return null;
  const id = short(path);
  if (!(id in conditions)) {
    const c = main(assetOf(path));
    conditions[id] = c ? expr(c.props.RootExpression) : null;
  }
  return id;
}

// --- secuencias: video, subtítulos, ventana de decisión, QTE ---
const lines = {};
function seq(path) {
  const s = j[assetOf(path)];
  if (!s) return null;
  const out = { subs: [], qte: [] };
  for (const e of Object.values(s)) {
    const p = e.props, r = p.SectionRange;
    const ms = r ? [Math.round(r[0] / TICKS), Math.round(r[1] / TICKS)] : null;
    // audio FMOD: eventos explícitos (AdHocFMODSceneSection) y ambiente/música fijados por propiedad (KeepState)
    // comentarios del elenco y de los desarrolladores (actualización del 23/10: /Game/FMOD/Events/EpNNN/Commentary/,
    // eventos *_Cast / *_Dev en el canal DevCommentaryChannelFmod): sólo suenan con el modo comentario
    if ((e.class === 'AdHocFMODSceneSection' && /\/Commentary\//.test(p.Event || '')) ||
        (e.class === 'MovieSceneObjectPropertySection' && /\/Commentary\//.test(p.ObjectChannel?.DefaultValue?.SoftPtr || ''))) {
      (out.commentary = out.commentary || []).push([ms ? ms[0] : 0, ms ? ms[1] : null, short(p.Event || p.ObjectChannel.DefaultValue.SoftPtr)]);
    } else if (e.class === 'AdHocFMODSceneSection' && p.Event) {
      (out.audio = out.audio || []).push([ms ? ms[0] : 0, ms ? ms[1] : null, short(p.Event)]);
    } else if (e.class === 'MovieSceneObjectPropertySection' && p.ObjectChannel?.DefaultValue?.SoftPtr) {
      const ev = short(p.ObjectChannel.DefaultValue.SoftPtr);
      if (/BG_LOOP/i.test(ev)) out.bg = ev;
      else if (/Music/i.test(ev)) out.music = ev;
    }
    if (e.class === 'MovieSceneMediaSection') {
      const m = main(assetOf(p.MediaSource));
      out.video = m && m.props.FilePath.replace(/^\.\/Movies\//, '');
    } else if (e.class === 'AdHocSubtitlesSection') {
      const l = short(p.Line);
      out.subs.push([ms[0], ms[1], l]);
      lines[l] = p.Line;
    } else if (e.class === 'PresentChoiceSceneSection') {
      out.choice = ms;
      // interfaz de decisión (OverrideChoiceUI; por defecto WBP_StandardChoiceUI) y parámetros de QTE de arrastrar y presionar
      if (p.OverrideChoiceUI) out.choiceUI = short(p.OverrideChoiceUI).replace(/_C$/, '');
      if (p.bIsComplexIdle) out.complexIdle = true;
      const q = p.QTEParameters;
      if (q?.DragAndPressStartCursorPosition) out.dragPress = { from: [q.DragAndPressStartCursorPosition.x, q.DragAndPressStartCursorPosition.y], to: [q.DragAndPressTargetCursorPosition.x, q.DragAndPressTargetCursorPosition.y] };
    }
    // StoryNotificationSceneSection: el aviso "… recordará esto" (WBP_NotificationsOverlay.BP_PlayStoryNotification)
    // con su texto de String Table y, si la sección lo pide, su posición (NotificationOffset)
    else if (e.class === 'StoryNotificationSceneSection' && p.NotificationText) {
      let text = p.NotificationText;
      if (text.table) {
        try {
          const st = require('./stringtable').readStringTable(stringTableFile(text.table));
          text = { ns: st.namespace, key: text.key, src: st.entries[text.key] || '' };
        } catch { text = { ns: '', key: text.key, src: text.key }; }
      }
      (out.notes = out.notes || []).push({ t: ms, text, offset: p.bOverrideNotificationOffset && p.NotificationOffset ? [p.NotificationOffset.x, p.NotificationOffset.y] : null });
    }
    // idle complejo (PresentChoiceSceneSection.bIsComplexIdle): ComplexIdleCutOutSection son los puntos donde el idle
    // puede cortar a la respuesta; la salida N de la opción (Node_…_InN) corresponde al corte N (ver cutPick en player.js)
    else if (e.class === 'ComplexIdleCutOutSection' && ms) (out.cuts = out.cuts || []).push(ms[0]);
    else if (e.class === 'QTESection') {
      // QTEType: por defecto círculo que se achica (WBP_ShrinkingCircleQTE); Flux = arrastre (WBP_FluxQTE, DragAngles)
      const q = { t: ms, x: p.Position ? +(p.Position.x / 1920).toFixed(4) : 0.5, y: p.Position ? +(p.Position.y / 1080).toFixed(4) : 0.5, fail: !!p.bTriggersSequenceSuccessFail,
        type: /Flux/.test(p.QTEType || '') ? 'flux' : 'circle', r: r ? [r[0], r[1]] : null };
      if (p.OuterCircleInitialScale) q.scale0 = p.OuterCircleInitialScale.x;
      if (p.DragAngles) q.angles = p.DragAngles;
      if (p.bHasCustomNoQTESuccessDelay) q.noQteDelay = p.CustomNoQTESuccessDelay;
      out.qte.push(q);
    }
  }
  out.subs.sort((a, b) => a[0] - b[0]);
  if (out.cuts) out.cuts.sort((a, b) => a - b);
  // el diálogo y los efectos de la mayoría de las secuencias van por convención de nombre: LS_<secuencia>_DX / _FX
  out.seq = short(path);
  if (!out.qte.length) delete out.qte;
  return out;
}

function assigns(list, node) {
  return (list || []).map((ref) => {
    const e = node[ref.replace(/^export:/, '')];
    if (!e) return null;
    if (e.class === 'AdHocStoryBooleanVariableAssignment') return [varName(e.props.Variable), '=', !!e.props.bValue];
    if (e.class === 'AdHocStoryNumberVariableAddition') return [varName(e.props.Variable), '+', e.props.AddedValue || 0];
    if (e.class === 'AdHocStoryEnumerationVariableAssignment') return [varName(e.props.Variable), '=', e.props.Value];
    return [e.class];
  }).filter(Boolean);
}

// --- nodos ---
const nodes = {};
for (const [k, v] of Object.entries(j)) {
  if (!k.startsWith('Nodes/')) continue;
  const n = main(k);
  if (!n) continue;
  const p = n.props, id = short(k);
  // largo de la secuencia: el nodo dura esto aunque el video sea más corto (queda en el último cuadro)
  const base = { scene: short(p.Scene), length: p.LevelSequenceLengthMs ? Math.round(p.LevelSequenceLengthMs) : undefined };
  if (p.VariableAssignments) base.set = assigns(p.VariableAssignments, v);
  switch (n.class) {
    case 'AdHocStoryExchange':
      nodes[id] = { type: 'exch', ...base, next: short(p.NextNode), ...seq(p.LevelSequence) };
      break;
    case 'AdHocStoryChoice':
      nodes[id] = {
        type: 'choice', ...base, ...seq(p.LevelSequence),
        options: (p.ChoiceOptions || []).map((o) => ({
          text: o.Title && o.Title.src, textKey: o.Title && o.Title.key ? `${o.Title.ns}/${o.Title.key}` : undefined,
          def: o.bIsDefaultOption || undefined, if: cond(o.Condition) || undefined,
          to: (o.Edges || []).map((e) => ({ next: short(e.NextNode), if: cond(e.Condition) || undefined })),
        })),
      };
      break;
    case 'AdHocStoryCallback':
      nodes[id] = { type: 'branch', ...base, paths: (p.Paths || []).map((x) => ({ next: short(x.NextNode), if: cond(x.Condition) || undefined })) };
      break;
    case 'AdHocStoryGameplayNode':
      nodes[id] = { type: 'gameplay', ...base, level: short(p.GameplayLevel), next: short(p.NextNode) };
      break;
    default:
      nodes[id] = { type: n.class, ...base, next: short(p.NextNode) };
  }
}

// --- textos de subtítulos ---
const text = {};
for (const [k] of Object.entries(j)) {
  if (!k.startsWith('Lines/')) continue;
  const l = main(k);
  // [personaje, texto fuente, clave de traducción "Namespace/Key" para web/data/loc/<idioma>.json]
  const t = l && l.props.LocalizeableSlicedText;
  // 4.º: AdHocStoryCharacter (Char_X: SubtitleColor y DisplayName, en web/data/characters.json)
  if (t) text[short(k)] = [l.props.CharacterText || '', t.src, t.key ? `${t.ns}/${t.key}` : '', short(l.props.Character) || ''];
}
// líneas de otro episodio o de los GameplayBarks (Line_Robert_dba99c del 1 en el 2, Line_Golem_e899cb del turno 2 en el 3):
// no están en el JSON de la carpeta Story; se leen del asset
for (const [l, ref] of Object.entries(lines)) {
  if (text[l] || !ref) continue;
  const m = /^\/([^/]+)\/(.+)\.[^.]+$/.exec(ref);
  if (!m) continue;
  const EX = require('path').join(require('./env').ROOT, 'work', 'extract', 'Dispatch');
  const f = m[1] === 'Game' ? require('path').join(EX, 'Content', `${m[2]}.uasset`) : require('path').join(EX, 'Plugins', m[1], 'Content', `${m[2]}.uasset`);
  if (!fs.existsSync(f)) { console.warn('línea sin asset', ref); continue; }
  const x = Object.values(require('./uprops').parse(f))[0];
  const t = x?.props?.LocalizeableSlicedText;
  if (t) text[l] = [x.props.CharacterText || '', t.src, t.key ? `${t.ns}/${t.key}` : '', short(x.props.Character) || ''];
}

// --- valores iniciales de las enumeraciones (bool y número arrancan en false/0) ---
const defaults = {};
for (const v of Object.values(j)) {
  for (const [name, e] of Object.entries(v)) {
    if (e.class === 'AdHocStoryEnumerationVariable' && e.props.DefaultValue != null) defaults[name] = e.props.DefaultValue;
  }
}

const project = Object.values(j).flatMap((v) => Object.values(v)).find((e) => e.class === 'AdHocStoryProject');
const graph = { start: short(project.props.StartNode), nodes, conditions, text, defaults };
fs.writeFileSync(outPath, JSON.stringify(graph));
const count = {};
for (const n of Object.values(nodes)) count[n.type] = (count[n.type] || 0) + 1;
console.log('inicio', graph.start, count, 'condiciones', Object.keys(conditions).length, 'líneas', Object.keys(text).length,
  'KB', (fs.statSync(outPath).size / 1024).toFixed(0));
const missing = Object.values(nodes).flatMap((n) => [n.next, ...(n.paths || []).map((x) => x.next), ...(n.options || []).flatMap((o) => o.to.map((t) => t.next))]).filter((x) => x && !nodes[x]);
console.log('destinos fuera del episodio:', [...new Set(missing)].join(', ') || 'ninguno');
