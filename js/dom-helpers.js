// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------
function h(tag, attrs, ...children){
  const el = document.createElement(tag);
  for(const k in (attrs||{})){
    const v = attrs[k];
    if(v==null) continue; // skip null/undefined attrs (e.g. disabled conditional handlers)
    if(k==='class') el.className = v;
    else if(k.startsWith('on') && typeof v==='function') el.addEventListener(k.slice(2), v);
    else if(k==='html') el.innerHTML = v;
    else if(typeof v==='boolean'){ if(v) el.setAttribute(k,''); } // boolean attrs (disabled, etc.) must be absent when false
    else el.setAttribute(k, v);
  }
  for(const c of children.flat()){
    if(c==null) continue;
    el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return el;
}

// Renders a resolved variable/constant as a small two-line "memory card"
// (name on top, value below) rather than collapsing it into a bare numeral.
// Used everywhere a resolved variable/constant is displayed — live
// interaction, historical timeline rows, and answer-key playback — so the
// student is reminded the value came from a named slot in memory for as
// long as it survives un-consumed. Once the value is used as an operand in
// an EVALUATE step, the result is a genuine new literal and is rendered as a
// plain numeral again (see the literal branches of the callers below).
//
// Takes a single named-fields object rather than positional arguments —
// intentionally, after a positional version caused a real bug: a call site
// passing arguments in the wrong order/count silently shifted every later
// param (e.g. a number landing in the `name` slot), which only surfaced as
// a cryptic "appendChild parameter 1 is not of type Node" deep inside `h`.
// A required-shape object makes that class of mistake impossible — a typo'd
// or missing key is undefined/obviously wrong rather than silently shifted.
//
// Stable binding colors identify the same named memory slot across declaration,
// assignment and expression views. Step colors remain a separate timeline/
// connector channel and are exposed as --step-color for the arrival pulse.
const VARIABLE_BINDING_PALETTE = Object.freeze([
  '#6fb7ff','#4fd9b0','#f6c85f','#ff8fb8','#5eead4','#fb923c','#93c5fd','#a3e635'
]);
const CONSTANT_BINDING_PALETTE = Object.freeze([
  '#c39bff','#a78bfa','#e879f9','#f0abfc','#818cf8','#d8b4fe','#f472b6','#c4b5fd'
]);

function bindingIdentityColor(name,kind){
  const palette = kind==='constant' ? CONSTANT_BINDING_PALETTE : VARIABLE_BINDING_PALETTE;
  const text = String(name==null ? '' : name);
  let hash = 2166136261;
  for(let i=0;i<text.length;i++){
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash,16777619);
  }
  return palette[(hash>>>0)%palette.length];
}

function bindingIdentityStyle(name,kind,stepColorValue){
  let style = `--binding-color:${bindingIdentityColor(name,kind)};color:var(--binding-color);`;
  if(stepColorValue) style += `--step-color:${stepColorValue};`;
  return style;
}

// opts: {id, name, value, kind, color, isFlash}
//   id      - the node's own id (same id it carries in the trace/flat model);
//             stamped as data-token-id so connector-lines.js can locate this
//             exact card in the DOM. Has no effect on layout/scoring.
//   name    - display name shown on the card's header line (e.g. "x", "RATE")
//   value   - the resolved numeric/boolean value shown on the card's body line
//   kind    - 'variable' | 'constant' (selects identity palette + border style)
//   color   - optional per-step accent used by the arrival pulse, never as identity
//   isFlash - whether to play the brief "just resolved" highlight animation
function renderValueCard(opts){
  const {id, name, value, kind, color, isFlash} = opts;
  const cls = 'tok-card binding-identity '+(kind==='constant' ? 'tok-card-const' : 'tok-card-var')+(isFlash?' tok-card-flash':'');
  const displayValue = formatValue(value);
  const attrs = {class:cls, 'data-token-id':id, 'data-binding-name':name,
    style:bindingIdentityStyle(name,kind,color),
    title:`${name} = ${displayValue}`,
    'aria-label':`${kind==='constant'?'constant':'variable'} ${name}, value ${displayValue}`};
  return h('span', attrs,
    h('span',{class:'tok-card-head'}, name),
    h('span',{class:'tok-card-body'}, displayValue)
  );
}

// Once ++/-- fires, the operand still represents a named variable even
// though it now supplies a numeric value to its surrounding expression.
// Returning the shared memory-card component preserves that identity until a
// later binary operation consumes the operand. Prefix cards contain the
// updated value; postfix cards contain the original value used by the current
// expression. The separate memory model already applies the corresponding
// side effect at the correct time.
function renderResolvedUnaryMutationCard(node,color,isFlash){
  if(!node||node.kind!=='unary'||!node.resolved
    ||(node.op!=='++'&&node.op!=='--')) return null;
  const inner=node.inner||{};
  const card=renderValueCard({
    id:node.id,name:inner.name,value:node.resultValue,
    kind:inner.kind==='constant'?'constant':'variable',color,isFlash
  });
  card.className+=' unary-mutating-result-card';
  return card;
}

// ---------------------------------------------------------------------------
// Result-connection helpers. Variable/constant retrieval keeps the binding's
// stable identity color; operations receive a color by their trace position.
// The same resolved color is shared by the timeline dot, connector and result
// accent so one visible step always reads as one operation.
// ---------------------------------------------------------------------------
const STEP_PALETTE = ['#ffa35c','#6fb7ff','#c39bff','#ffd166','#5ce1c9','#ff8fc7','#9ad068','#7aa2ff'];
function stepColor(index){ return STEP_PALETTE[((index%STEP_PALETTE.length)+STEP_PALETTE.length)%STEP_PALETTE.length]; }
// One semantic color decision for every rendered step. Retrieving an existing
// named value preserves that binding's identity; operations that derive or
// mutate a value receive the generated color for their step position.
function stepVisualColor(step,index){
  if(step && step.action==='READ_TARGET'){
    return bindingIdentityColor(step.target,'variable');
  }
  if(step && step.action==='SUBSTITUTE' && step.targetKind!=='literal'){
    return bindingIdentityColor(step.target,step.targetKind==='constant'?'constant':'variable');
  }
  return stepColor(index);
}
function hexToRgba(hex, alpha){
  const c = hex.replace('#','');
  const r = parseInt(c.substring(0,2),16), g = parseInt(c.substring(2,4),16), b = parseInt(c.substring(4,6),16);
  return `rgba(${r},${g},${b},${alpha})`;
}
// Persistent id -> color map: for each of the first `count` steps in
// `steps`, the node that step PRODUCED (resultNodeId — a new literal's id
// for EVALUATE, or the same var/const id it always had for SUBSTITUTE) is
// tagged with that step's semantic color. Derived literals keep it in later
// renders, while named variable/constant retrieval stays binding-colored.
function buildColorMap(steps, count){
  const map = new Map();
  const n = count==null ? steps.length : count;
  for(let i=0;i<n;i++){
    const step = steps[i];
    const id = step.resultNodeId;
    const color = stepVisualColor(step,i);
    // SUBSTITUTE and UNARY intentionally share a node id. The first row is a
    // binding-colored retrieval card; after UNARY fires, that same node is a
    // newly derived literal and must adopt the operator step's color.
    if(step.action==='UNARY' || !map.has(id)) map.set(id,color);
  }
  return map;
}
// Locates the binop node (in a "before" tree snapshot) whose two operands
// match the leftId/rightId recorded on an EVALUATE step — i.e. the exact
// operator that step is about to fire.
function findBinopByOperandIds(node, leftId, rightId){
  if(node.kind==='binop'){
    if(node.left.id===leftId && node.right.id===rightId) return node;
    return findBinopByOperandIds(node.left,leftId,rightId) || findBinopByOperandIds(node.right,leftId,rightId);
  }
  return null;
}
// Given a step and the exact tree snapshot that immediately precedes it, find
// the id of the token that step is about to consume: the named var/const
// token for SUBSTITUTE (same id before and after resolution), or the binop
// node for EVALUATE. Used to preview a step's color on its operator/token
// *before* it fires, in already-recorded (historical or canonical) rows —
// where, unlike the live interactive row, exactly which token fires next is
// already known rather than still up to the student.
function pendingNodeId(step, treeBefore){
  if(!step) return null;
  if(step.action==='SUBSTITUTE' || step.action==='UNARY') return step.resultNodeId;
  const n = findBinopByOperandIds(treeBefore, step.leftId, step.rightId);
  return n ? n.id : null;
}
