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
// LINE COLOR follows dom-helpers.js stepVisualColor(): retrieving a named
// binding uses that binding's stable identity color; evaluating an operator
// uses the generated color for that operation. A unary token can therefore
// be binding-colored on its SUBSTITUTE step, then operation-colored when the
// unary operator derives its result. The connector, endpoint, timeline dot
// and result accent all receive the same semantic step color.
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

// Uses the same semantic color resolver as timeline dots and rendered results:
// binding color for value retrieval, generated step color for operations.
function originColorForStep(steps, i){
  return stepVisualColor(steps[i],i);
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
    // Resolve the semantic step color once, then apply it to both the curve
    // and its endpoint marker.
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

// Measure in the panel's scroll-content coordinate space. Rows and SVG then
// move together under horizontal scrolling, so scrolling itself needs no
// connector redraw; only a genuine layout change does.
function connectorContentRect(panel){
  const rect=panel.getBoundingClientRect();
  return {
    left:rect.left-(panel.scrollLeft||0),
    top:rect.top-(panel.scrollTop||0),
    right:rect.right,bottom:rect.bottom,width:rect.width,height:rect.height
  };
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

  const panelRect = connectorContentRect(panel);
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
  const visibleAttr=panel.getAttribute('data-canonical-visible');
  const visibleCount=visibleAttr==null ? pb.index : Number(visibleAttr);
  if(visibleCount<=0) return; // nothing revealed yet

  const rows = panel.querySelectorAll('.tl-row');

  panel.classList.add('connector-measuring');
  void panel.offsetHeight;

  const panelRect = connectorContentRect(panel);
  const {paths, dots} = buildConnectorVisuals(panelRect, rows,item.canonicalTrace.steps,visibleCount);

  panel.classList.remove('connector-measuring');
  appendConnectorSvg(panel, paths, dots);
}

// Canonical declaration/assignment timelines reuse the live expression
// renderer, but are driven by the model trace and the program-wide playback
// cursor. Draw their connectors from those same model steps, including the
// final assignment write, without touching any live/student trace.
function drawCanonicalProgramConnectorLines(item){
  const panels=document.querySelectorAll('.canonical-program-expression-panel');
  panels.forEach(panel=>{
    const stale=panel.querySelector('.connector-svg');
    if(stale) stale.remove();
  });
  if(!state.showConnectors||!item||!item.showSolution||!item.playback
    ||typeof canonicalProgramSegments!=='function'||typeof canonicalStatementRuntime!=='function') return;
  const segments=canonicalProgramSegments(item);
  panels.forEach(panel=>{
    const id=panel.getAttribute('data-statement-id');
    const segment=segments.find(candidate=>candidate.kind==='statement'&&candidate.statement.id===id);
    if(!segment||item.playback.index<=segment.start) return;
    const localIndex=Math.min(segment.length,item.playback.index-segment.start);
    const runtime=canonicalStatementRuntime(segment.statement,localIndex);
    const commitVisible=localIndex>=segment.length;
    let visualSteps=runtime.trace.slice();
    if(commitVisible){
      const resultNodeId=segment.statement.kind==='assignment'&&isCompoundAssignment(segment.statement)
        ? assignmentResultTokenId(segment.statement)
        : `canonical-assignment-result-${segment.statement.id}`;
      visualSteps.push({action:'APPLY_ASSIGNMENT',statementId:segment.statement.id,resultNodeId});
    }
    if(!visualSteps.length) return;
    const rows=panel.querySelectorAll('.tl-row');
    panel.classList.add('connector-measuring');
    void panel.offsetHeight;
    const visuals=buildConnectorVisuals(connectorContentRect(panel),rows,visualSteps,visualSteps.length);
    panel.classList.remove('connector-measuring');
    appendConnectorSvg(panel,visuals.paths,visuals.dots);
  });
}

// Each interactive declaration owns an independent expression trace. Draw
// connectors inside each statement panel using the same geometry engine as
// the legacy expression timeline; no statement semantics live here.
function drawDeclarationConnectorLines(item){
  // The final expression reuses .program-expression-panel for workspace
  // styling, but its trace and connector lifecycle are owned by
  // drawConnectorLines(). Excluding it here prevents this second pass from
  // deleting the live SVG that the first pass just appended.
  const panels = document.querySelectorAll(
    '.program-expression-panel:not(.final-expression-panel)');
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
      connectorContentRect(panel),rows,visualSteps,visualSteps.length);
    panel.classList.remove('connector-measuring');
    appendConnectorSvg(panel,paths,dots);
  });
}
