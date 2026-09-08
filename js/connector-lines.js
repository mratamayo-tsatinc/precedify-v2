// ============================================================================
// OPERATOR → RESULT CONNECTOR LINES
// ----------------------------------------------------------------------------
// Purely additive visual feature, kept isolated from the core render/engine/
// state modules so it can be toggled off or removed without touching them.
// Depends only on:
//   - state.showConnectors      (declared in state.js)
//   - item.trace / item.canonicalTrace.steps / stepColor()  (existing data)
//   - data-token-id / data-op-left / data-op-right attributes that BOTH the
//     flat renderers (render-flat.js, live session) and the tree renderer
//     (render-tree.js, answer-key/canonical playback) stamp onto their DOM
//     nodes — the exact same attribute names/values in both, which is what
//     lets one shared lookup routine work against either panel.
//
// Draws ONE line per step, from the operator (or token) that fired on that
// step to the value it produced. All steps drawn so far are shown
// simultaneously — not just the latest — so the full derivation history is
// visible at once. To keep that from becoming visual noise, only the MOST
// RECENT step is drawn as a solid, brighter line; every earlier step is
// drawn dotted and dimmer, giving "current" a clear visual lead over
// "history".
//
// TWO independent timelines use this same logic:
//   1. The main session timeline (.eval-panel / .tl-row), driven by
//      item.trace — the student's own step-by-step derivation.
//   2. The answer-key/canonical playback timeline (.solution-playback /
//      .solution-timeline), driven by item.canonicalTrace.steps — the one
//      true correct derivation, revealed incrementally as pb.index
//      advances. Only steps with index < pb.index are actually revealed
//      (see render-session.js's tl-future rows), so only that many lines
//      should ever be drawn there, however many rows exist in the DOM.
// Both share the identical row <-> state mapping: rows[0] renders the
// original untouched state, rows[k] (k=1..n) renders the state after step
// k-1 fired. So for step i, its SOURCE token/operator lives in rows[i] (the
// state just before it fired) and its RESULT token lives in rows[i+1] (the
// state just after) — regardless of which of the two timelines/panels it's
// looked up in.
//
// LINE COLOR (must match dom-helpers.js buildColorMap's rule, not raw step
// index): a unary token (e.g. "++x") produces TWO distinct steps that share
// the same resultNodeId — a SUBSTITUTE step (reveals the variable's value
// into its card) followed by a UNARY step (applies the operator to that
// same node). buildColorMap() deliberately keeps "first-touch wins" for a
// given resultNodeId, so the post-operator literal ("18") is rendered in
// the SUBSTITUTE step's color, not the UNARY step's own color — a value
// keeps the color of the step that ORIGINATED it, per that file's contract.
// If a step's line were colored by its own raw index, the UNARY step's line
// would be drawn in a different color than the very text it points to.
// originColorForStep() below re-derives the same "earliest step to touch
// this resultNodeId" rule so every line's color always matches its
// destination token's actual displayed color, in either timeline.
//
// ENDPOINT CURVE SHAPE: fixed-length vertical "lead-in" control points (see
// `lead` below) force the bezier to approach/leave each end near-vertically
// regardless of how much horizontal distance separates the two tokens, so
// the line reads as plugging into each box rather than swooping past it. A
// small solid dot at the destination point marks the exact attachment spot.
//
// MEASUREMENT-VS-ANIMATION: this measures live DOM geometry via
// getBoundingClientRect(), which is only correct once an element is at its
// resting layout position. A row or token that just entered on THIS render
// (row-enter, tok-card-flash, tok-colored-flash) is mid-CSS-animation at the
// moment this runs, so a naive measurement here would capture its transient
// starting offset instead of where it settles — producing a connector line
// that looks wrong only for the newest step, then appears to "fix itself"
// on the very next render. To avoid that, the panel being measured is given
// a `connector-measuring` class immediately before reading any rects; that
// class force-cancels the relevant entrance animations (see styles.css) so
// layout reflects each element's final resting position during the
// measurement pass. The class is removed again before returning, and —
// because all of this happens within a single synchronous script execution
// with no paint in between — the entrance animations still play normally
// on screen; only the internal measurement snapshot is affected.
// ============================================================================

function toggleConnectors(){
  state.showConnectors = !state.showConnectors;
  render();
}

function findConnectorSourceEl(row, step){
  if(step.action==='EVALUATE'){
    return row.querySelector(`[data-op-left="${step.leftId}"][data-op-right="${step.rightId}"]`);
  }
  // Compound assignment completion is intentionally a presentation-only
  // step: scoring and undo continue to use the semantic expression trace,
  // while the visible merge still receives the same operator-to-result
  // connector as an ordinary evaluated operation.
  if(step.action==='APPLY_ASSIGNMENT'){
    return row.querySelector(`[data-assignment-op-id="${step.statementId}"]`)
      || row.querySelector('.assignment-operator, .assignment-operator-static');
  }
  // SUBSTITUTE, UNARY or READ_TARGET: the token keeps the same id before
  // and after, so compound targets use the standard token-to-card connector.
  return row.querySelector(`[data-token-id="${step.resultNodeId}"]`);
}
function findConnectorDestEl(row, step){
  return row.querySelector(`[data-token-id="${step.resultNodeId}"]`);
}

// Mirrors buildColorMap()'s "first-touch wins per resultNodeId" rule (see
// dom-helpers.js), but for a single arbitrary step index within a given
// steps array rather than a running map — returns the color of the
// EARLIEST step that produced this step's resultNodeId, which is always
// <= i and is the same color the destination token is actually displayed
// in, whichever timeline `steps` came from.
function originColorForStep(steps, i){
  const id = steps[i].resultNodeId;
  for(let j=0;j<=i;j++){
    if(steps[j].resultNodeId===id) return stepColor(j);
  }
  return stepColor(i); // unreachable in practice — step i always matches itself
}

// Capped vertical lead-in length for the bezier control points, in px.
// Capped (via halfGap at each call site) at half the total vertical gap
// between the two rows so it never overshoots and flips the curve on very
// short rows.
const CONNECTOR_MAX_LEAD = 18;

// Shared geometry/color builder used by both timelines below. `steps` is
// either item.trace or item.canonicalTrace.steps; `rows` is the NodeList of
// .tl-row elements for whichever panel is being drawn; `visibleCount` is how
// many of `steps` (from the start) should actually be drawn as lines —
// item.trace.length for the live session (every step made so far), or
// pb.index for the solution playback (only steps actually revealed so far,
// since later rows exist in the DOM already for fixed-height layout but are
// still `.tl-future` and must not visually leak upcoming values).
function buildConnectorVisuals(panelRect, rows, steps, visibleCount){
  const paths = [];
  const dots = [];
  const lastIndex = visibleCount - 1;
  if(rows.length < visibleCount+1) return {paths, dots}; // DOM not fully in sync yet

  for(let i=0;i<visibleCount;i++){
    const step = steps[i];
    const sourceRow = rows[i];
    const destRow = rows[i+1];
    if(!sourceRow || !destRow) continue;
    const srcEl = findConnectorSourceEl(sourceRow, step);
    const dstEl = findConnectorDestEl(destRow, step);
    if(!srcEl || !dstEl) continue;

    const s = srcEl.getBoundingClientRect(), d = dstEl.getBoundingClientRect();
    const x1 = s.left + s.width/2 - panelRect.left, y1 = s.bottom - panelRect.top;
    const x2 = d.left + d.width/2 - panelRect.left, y2 = d.top - panelRect.top;
    const isCurrent = i===lastIndex;
    // Color follows the destination token's ACTUAL displayed color (origin
    // step), not this step's own raw index — see file header re: unary
    // SUBSTITUTE/UNARY pairs sharing a resultNodeId.
    const color = originColorForStep(steps, i);

    const halfGap = (y2 - y1) / 2;
    const lead = Math.min(CONNECTOR_MAX_LEAD, halfGap>0 ? halfGap : 0);
    const c1y = y1 + lead, c2y = y2 - lead;

    const path = document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d', `M ${x1} ${y1} C ${x1} ${c1y}, ${x2} ${c2y}, ${x2} ${y2}`);
    path.setAttribute('stroke', color);
    path.setAttribute('stroke-width', isCurrent ? '1.75' : '1.25');
    path.setAttribute('fill','none');
    path.setAttribute('stroke-linecap','round');
    path.setAttribute('class', 'connector-line '+(isCurrent ? 'connector-line-current' : 'connector-line-past'));
    paths.push(path);

    // Small solid anchor dot at the exact point the line meets the
    // destination box's top edge, so the connection reads as physically
    // attached even when the approach angle is shallow.
    const dot = document.createElementNS('http://www.w3.org/2000/svg','circle');
    dot.setAttribute('cx', String(x2));
    dot.setAttribute('cy', String(y2));
    dot.setAttribute('r', isCurrent ? '2.5' : '2');
    dot.setAttribute('fill', color);
    dot.setAttribute('class', 'connector-anchor-dot '+(isCurrent ? 'connector-line-current' : 'connector-line-past'));
    dots.push(dot);
  }

  return {paths, dots};
}

function appendConnectorSvg(panel, paths, dots){
  if(paths.length===0) return;
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('class','connector-svg');
  svg.setAttribute('width', String(panel.scrollWidth));
  svg.setAttribute('height', String(panel.scrollHeight));
  paths.forEach(p=>svg.appendChild(p));
  dots.forEach(d=>svg.appendChild(d));
  panel.appendChild(svg);
}

// ----------------------------------------------------------------------------
// Main session timeline (.eval-panel), driven by item.trace.
// ----------------------------------------------------------------------------
function drawConnectorLines(item){
  const panel = document.querySelector('.eval-panel');
  if(panel){
    const stale = panel.querySelector('.connector-svg');
    if(stale) stale.remove();
  }
  if(!state.showConnectors) return;
  if(!item || item.trace.length===0) return;
  if(!panel) return;

  const rows = panel.querySelectorAll('.tl-row');

  // Freeze entrance animations to their resting state for this synchronous
  // measurement pass (see file header). Forcing a layout read immediately
  // after adding the class ensures the style change has actually applied
  // before any getBoundingClientRect() calls below.
  panel.classList.add('connector-measuring');
  void panel.offsetHeight;

  const panelRect = panel.getBoundingClientRect();
  const {paths, dots} = buildConnectorVisuals(panelRect, rows, item.trace, item.trace.length);

  panel.classList.remove('connector-measuring');
  appendConnectorSvg(panel, paths, dots);
}

// ----------------------------------------------------------------------------
// Answer-key/canonical playback timeline (.solution-playback), driven by
// item.canonicalTrace.steps, revealed incrementally as pb.index advances.
// Only called (from main.js) when the solution panel is actually showing.
// ----------------------------------------------------------------------------
function drawCanonicalConnectorLines(item){
  const panel = document.querySelector('.solution-playback');
  if(panel){
    const stale = panel.querySelector('.connector-svg');
    if(stale) stale.remove();
  }
  if(!state.showConnectors) return;
  if(!item || !item.showSolution || !item.playback) return;
  if(!panel) return;

  const pb = item.playback;
  if(pb.index<=0) return; // nothing revealed yet

  const rows = panel.querySelectorAll('.tl-row');

  panel.classList.add('connector-measuring');
  void panel.offsetHeight;

  const panelRect = panel.getBoundingClientRect();
  const {paths, dots} = buildConnectorVisuals(panelRect, rows, item.canonicalTrace.steps, pb.index);

  panel.classList.remove('connector-measuring');
  appendConnectorSvg(panel, paths, dots);
}

// Each interactive declaration owns an independent expression trace. Draw
// connectors inside each statement panel using the same geometry engine as
// the legacy expression timeline; no statement semantics live here.
function drawDeclarationConnectorLines(item){
  const panels = document.querySelectorAll('.program-expression-panel');
  panels.forEach(panel=>{
    const stale = panel.querySelector('.connector-svg');
    if(stale) stale.remove();
  });
  if(!state.showConnectors || !item || !item.program) return;
  panels.forEach(panel=>{
    const id = panel.getAttribute('data-statement-id');
    const statement = item.program.statements.find(s=>s.id===id);
    const trace = statement && statement.runtime ? statement.runtime.trace : [];
    const assignmentResultId = statement && statement.kind==='assignment'
      ? (statement.runtime.assignmentResultNodeId
        || (typeof assignmentResultTokenId==='function'
          ? assignmentResultTokenId(statement) : `assignment-result-${statement.id}`))
      : null;
    const compoundApplied = !!(statement && statement.kind==='assignment'
      && statement.operator!=='=' && statement.runtime.checked
      && assignmentResultId);
    // The compound merge row is appended after the expression timeline and
    // is not part of runtime.trace by design. Add a synthetic visual step so
    // buildConnectorVisuals maps the last expression row to that merge row.
    const visualSteps = compoundApplied ? trace.concat({
      action:'APPLY_ASSIGNMENT',
      statementId:statement.id,
      resultNodeId:assignmentResultId
    }) : trace;
    if(!visualSteps.length) return;
    const rows = panel.querySelectorAll('.tl-row');
    panel.classList.add('connector-measuring');
    void panel.offsetHeight;
    const {paths,dots} = buildConnectorVisuals(
      panel.getBoundingClientRect(),rows,visualSteps,visualSteps.length);
    panel.classList.remove('connector-measuring');
    appendConnectorSvg(panel,paths,dots);
  });
}
