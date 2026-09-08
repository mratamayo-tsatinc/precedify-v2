// ============================================================================
// VARIABLE FINAL STATE — FLOATING PANEL
// ----------------------------------------------------------------------------
// Wraps var-final-state.js's existing renderVariableFinalState(item) section
// into a floating, draggable window instead of a fixed block glued to the
// bottom of the eval panel. Fully self-contained: injects its own <style>
// tag on first use rather than requiring any edit to styles.css, and keeps
// every bit of UI state (open/closed, animate-on/off, dragged position) in
// module-local variables here — none of it lives on `state` (state.js) or
// on the item, so it survives exactly like showConnectors does (a global,
// session-long UI preference), but without state.js needing to know this
// module exists.
//
// Public surface (called from render-session.js / index.html):
//   renderVariableFinalFloat(item)   — (re)builds + mounts the floating
//                                       panel for the current item. Call
//                                       this once per render, AFTER the
//                                       eval panel (and its timeline) has
//                                       already been appended into the live
//                                       document — the fly-in mode needs to
//                                       look up each value's origin token in
//                                       that live timeline, the same way
//                                       connector-lines.js locates its
//                                       srcEl/dstEl.
//   toggleVarFinalFloatVisible()     — header button: show/hide the panel.
//
// ----------------------------------------------------------------------------
// TWO INDEPENDENT TOGGLES
// ----------------------------------------------------------------------------
//   floatVisible   — whether the floating panel is shown at all. Default
//                     true (matches the old always-shown inline behavior).
//                     Controlled from the global app header (#varFloatToggle
//                     in index.html), since it's meaningful whether or not
//                     the panel currently exists on screen.
//   flyAnimEnabled — whether a newly-committed binding's value travels from
//                     its origin token in the timeline to its card (true),
//                     or simply appears in place with the existing one-shot
//                     colorFlash pulse (false). Default OFF, per spec — the
//                     un-animated path is not a separate implementation,
//                     it's a direct call into the ORIGINAL, unmodified
//                     renderVariableFinalState(item) from var-final-state.js,
//                     so "no animation" really does mean "exactly the
//                     current behavior", just inside a floating shell.
//                     Controlled from a small toggle INSIDE the panel's own
//                     header (see mountVarFinalFloatPanel) rather than the
//                     global app header — this setting only means anything
//                     while the panel it animates is actually on screen, and
//                     it isn't a session-wide concern the way floatVisible
//                     or showConnectors are, so it has no business occupying
//                     permanent space in the app header (nor being reachable
//                     at all while there's nothing on screen for it to
//                     affect — previously it lived there disabled, which
//                     still cost a control's worth of header space for no
//                     benefit).
//
// The animated path (buildAnimatedVarFinalSection below) necessarily
// duplicates var-final-state.js's row-building loop, because it needs to
// intercept a binding at the exact moment it becomes newly committed —
// showing its PRE-commit value on the actual card while a separate,
// transient flying token carries the new value in from its origin — rather
// than rendering the post-commit value immediately like the original does.
// Everything it depends on (ensureBindings, resolveBindingLive,
// bindingTagText, bindingTagShort, `b._flashed`) is reused as-is from
// var-final-state.js's global functions/binding objects, so both paths stay
// in lockstep: whichever one runs for a given render is the one that
// consumes (sets) `b._flashed`, so switching the toggle mid-session never
// causes a double-flash or a silently-skipped one.
// ============================================================================

let floatVisible = true;
let flyAnimEnabled = false;

// Flight duration, in ms — one of three discrete levels (1s/2s/3s), chosen
// via the segmented toggle rendered inside the panel body (see
// renderVarFinalSpeedToggle) whenever fly-in mode is
// on. Module-local like everything else here, so it persists across
// re-renders even though the toggle's own DOM node is rebuilt each time.
let flightDurationMs = 1000;

// Dragged position, in viewport px — null until the user actually drags the
// panel at least once, in which case the default CSS-anchored corner
// position (see .var-final-float below) is used instead. Persists across
// re-renders (module-local, not DOM-local) since the panel's DOM node is
// torn down and rebuilt on every render(), same as the rest of the app.
let floatPos = null;

let dragging = false;
let dragPanelEl = null;
let dragOffsetX = 0, dragOffsetY = 0;
let memoryTransferInProgress = false;

// Whether the panel was already showing as of the LAST render — used to
// tell "just appeared" (toggled on, or first render of the session) apart
// from "still open, just being rebuilt because the student clicked an
// operator" (see renderVariableFinalFloat). Without this, the entrance
// animation would replay on every single render — the panel is torn down
// and rebuilt every time regardless of whether anything it shows actually
// changed — making the whole window look like it "snaps"/re-enters on
// every operator click even when none of its values did anything.
let floatWasMounted = false;

// ----------------------------------------------------------------------------
// Toggles. toggleVarFinalFloatVisible is wired from index.html, mirroring
// toggleConnectors()'s header-button pattern in connector-lines.js.
// toggleVarFinalFlyAnim is wired from the button built in
// mountVarFinalFloatPanel below instead — see the module header comment for
// why it doesn't belong in the global app header.
// ----------------------------------------------------------------------------
function toggleVarFinalFloatVisible(){
  floatVisible = !floatVisible;
  syncVarFinalFloatToggleUI();
  render();
}
function toggleVarFinalFlyAnim(){
  // Only ever wired to a button rendered inside the panel's own header (see
  // mountVarFinalFloatPanel), which only exists while floatVisible is true —
  // so unlike before, there's no "inert/disabled while hidden" state to
  // guard against here; if this runs, the panel is on screen.
  flyAnimEnabled = !flyAnimEnabled;
  // A render() IS needed here now (the old header-button version didn't
  // need one): the toggle button's own active/inactive look and the speed
  // toggle's visibility both live inside the panel body, which is rebuilt
  // by render() — without this the click would silently do nothing until
  // some unrelated render happened to fire.
  render();
}

// Reverse direction of the same memory visualization. The semantic action is
// applied first so its history row and connector can render immediately; the
// newly rendered value card is then blanked and given a spinner before the
// browser paints. The stored value flies into that waiting card and is only
// revealed when it lands.
function animateVarFinalMemoryToExpression(item, action, applyAction){
  if(!flyAnimEnabled || !floatVisible || !item || !action
    || (action.type!=='substitute'&&action.type!=='reveal-assignment-target')) return false;
  if(memoryTransferInProgress) return true;

  const statement = typeof currentProgramStatement==='function' ? currentProgramStatement(item) : null;
  const runtime = statement && statement.kind!=='legacy-expression' ? statement.runtime : item;
  let named,tokenId;
  if(action.type==='reveal-assignment-target'){
    if(!statement || statement.kind!=='assignment' || !isCompoundAssignment(statement)
      || runtime.targetRevealed) return false;
    named={name:statement.target,kind:'variable'};
    tokenId=assignmentTargetTokenId(statement);
  } else {
    const node = runtime && runtime.workingFlat ? findFlatOperandById(runtime.workingFlat,action.id) : null;
    if(!node || node.resolved) return false;
    named = node.kind==='unary' ? node.inner : node;
    if(!named || (named.kind!=='variable' && named.kind!=='constant')) return false;
    tokenId=action.id;
  }

  const source = document.querySelector('.var-final-float [data-token-id="vff-'+named.name+'"]');
  const scope = statement && statement.kind!=='legacy-expression'
    ? '[data-statement-id="'+statement.id+'"].program-expression-panel'
    : '.eval-panel';
  const destinations = document.querySelectorAll(scope+' [data-token-id="'+tokenId+'"]');
  const destination = destinations.length ? destinations[destinations.length-1] : null;
  if(!source || !destination) return false;

  memoryTransferInProgress = true;
  const shield = h('div',{class:'var-final-transfer-shield','aria-hidden':'true'});
  const clone = source.cloneNode(true);
  clone.removeAttribute('data-token-id');
  clone.classList.add('var-final-flying','var-final-flying-reverse');
  const sourceRect = source.getBoundingClientRect();
  const sourceValueEl = source.querySelector('.tok-card-body');
  const sourceValue = sourceValueEl ? sourceValueEl.textContent : '';
  clone.style.position = 'fixed';
  clone.style.left = sourceRect.left+'px';
  clone.style.top = sourceRect.top+'px';
  clone.style.width = sourceRect.width+'px';
  clone.style.height = sourceRect.height+'px';
  clone.style.margin = '0';
  clone.style.transform = 'none';
  document.body.appendChild(shield);
  document.body.appendChild(clone);
  void clone.getBoundingClientRect();

  // render() runs synchronously inside this callback. Consequently the next
  // statements execute before a paint, preventing the resolved value from
  // flashing briefly before it is replaced by the waiting spinner.
  const applied = typeof applyAction==='function' && applyAction();
  if(!applied){
    clone.remove();
    shield.remove();
    memoryTransferInProgress = false;
    return true;
  }

  const renderedDestinations = document.querySelectorAll(scope+' [data-token-id="'+tokenId+'"]');
  const renderedDestination = renderedDestinations.length
    ? renderedDestinations[renderedDestinations.length-1] : null;
  const waitingBody = renderedDestination && renderedDestination.querySelector('.tok-card-body');
  if(!renderedDestination || !waitingBody){
    clone.remove();
    shield.remove();
    memoryTransferInProgress = false;
    return true;
  }
  renderedDestination.classList.remove('tok-card-flash');
  renderedDestination.classList.add('memory-transfer-waiting');
  renderedDestination.setAttribute('aria-busy','true');
  waitingBody.textContent = '';
  waitingBody.appendChild(h('span',{class:'memory-transfer-spinner','aria-hidden':'true'}));
  const destinationRect = renderedDestination.getBoundingClientRect();

  const durationMs = flightDurationMs;

  let finished = false;
  const finish = ()=>{
    if(finished) return;
    finished = true;
    clone.remove();
    shield.remove();
    memoryTransferInProgress = false;
    if(renderedDestination.isConnected){
      waitingBody.textContent = sourceValue;
      renderedDestination.classList.remove('memory-transfer-waiting');
      renderedDestination.removeAttribute('aria-busy');
      renderedDestination.classList.add('tok-card-flash');
    }
    // Reconcile the temporary waiting DOM with the semantic history. If this
    // substitution completed the final expression, this render also starts
    // its now-unblocked expression-to-memory target flight.
    if(typeof render==='function') requestAnimationFrame(()=>render());
  };
  clone.addEventListener('transitionend',finish,{once:true});
  setTimeout(finish,durationMs+150);
  requestAnimationFrame(()=>{
    clone.style.transition =
      `left ${durationMs}ms cubic-bezier(.22,.72,.22,1), top ${durationMs}ms cubic-bezier(.22,.72,.22,1), `+
      `width ${durationMs}ms ease, height ${durationMs}ms ease, opacity ${durationMs}ms ease`;
    clone.style.left = destinationRect.left+'px';
    clone.style.top = destinationRect.top+'px';
    clone.style.width = Math.max(destinationRect.width,28)+'px';
    clone.style.height = destinationRect.height+'px';
    clone.style.opacity = '0.72';
  });
  return true;
}
function syncVarFinalFloatToggleUI(){
  const vBtn = document.getElementById('varFloatToggle');
  const vText = document.getElementById('varFloatToggleText');
  if(vBtn) vBtn.classList.toggle('active', floatVisible);
  if(vText) vText.textContent = floatVisible ? 'Vars on' : 'Vars off';
}

// ----------------------------------------------------------------------------
// Entry point
// ----------------------------------------------------------------------------
function renderVariableFinalFloat(item){
  const stale = document.querySelector('.var-final-float');
  if(stale) stale.remove();
  if(!floatVisible || !item){
    floatWasMounted = false; // next time it opens, it should re-enter
    return;
  }

  ensureVarFinalFloatStyles();

  // True only the render where the panel transitions from not-showing to
  // showing (toggled on, or the very first render of the session) — every
  // subsequent render while it's already open rebuilds the same content in
  // place with no entrance animation, however many times that happens.
  const isAppearing = !floatWasMounted;
  floatWasMounted = true;

  if(!flyAnimEnabled){
    // "No animation" mode is not a separate code path — it's literally the
    // existing, unmodified section from var-final-state.js, just mounted
    // inside the floating shell instead of appended inline. Whatever pulse
    // behavior that function already implements (isFlash) is exactly what
    // plays here.
    const section = renderVariableFinalState(item);
    if(!section) return;
    mountVarFinalFloatPanel(section, null, isAppearing);
    return;
  }

  const built = buildAnimatedVarFinalSection(item);
  if(!built) return;
  mountVarFinalFloatPanel(built.section, built.flights, isAppearing);
}

// ----------------------------------------------------------------------------
// Animated section builder — mirrors renderVariableFinalState's row loop
// (var-final-state.js) closely enough to reuse its CSS classes verbatim,
// but shows a binding's PRE-commit value on its real card the instant it
// becomes newly committed, and queues a flight (see runVarFinalFlights)
// that carries the new value in from its origin token instead of just
// swapping it in place.
// ----------------------------------------------------------------------------
function buildAnimatedVarFinalSection(item){
  const bindings = ensureBindings(item);
  if(bindings.length===0) return null;

  const wrap = h('div',{class:'var-final-panel'});
  wrap.appendChild(h('div',{class:'var-final-title'},
    itemHasInteractiveProgram(item) ? 'Program variables and constants' : 'Variable final state'));
  const list = h('div',{class:'var-final-list'});
  const flights = [];

  bindings.forEach(b=>{
    const live = resolveBindingLive(b, item);
    // Same one-shot criterion as var-final-state.js's own isFlash — the
    // first render where this binding is found committed. Consuming
    // `b._flashed` here means the OTHER render path (the plain
    // renderVariableFinalState call above) will correctly see this binding
    // as already-flashed if the toggle is flipped afterward, and vice
    // versa — both paths share one flag.
    // The last inbound substitution may also complete the final expression.
    // Keep that target pending until the inbound flight lands, then let the
    // follow-up render begin the outbound final-value flight.
    const postponeTargetFlight = memoryTransferInProgress && b.kind==='target';
    const justCommitted = live.committed && !b._flashed && !postponeTargetFlight;
    if(justCommitted) b._flashed = true;

    let hasValue, displayValue, flashColor;
    if(justCommitted || (postponeTargetFlight && live.committed)){
      // Pre-commit display — mirrors resolveBindingLive's own "not yet
      // committed" branches (declared value for a variable, "—" for a
      // still-unassigned target), since the flight itself is what's
      // responsible for carrying the value in.
      if(b.kind==='target' || b.trigger==='program-assignment'){
        hasValue = b.trigger==='program-assignment' && b._lastDisplayValue!==undefined;
        displayValue = hasValue ? b._lastDisplayValue : null;
      } else { hasValue = true; displayValue = b.declaredValue; }
      flashColor = null;
    } else {
      hasValue = live.hasValue; displayValue = live.displayValue; flashColor = live.flashColor;
      if(live.hasValue) b._lastDisplayValue=live.displayValue;
    }

    const row = h('div',{class:'var-final-row'+(b.trigger!=='static' && live.committed ? ' var-final-changed':'')});
    const card = renderValueCard({
      id: 'vff-'+b.name,
      name: b.name,
      value: hasValue ? displayValue : '—',
      kind: b.kind==='program-constant' ? 'constant' : 'variable',
      color: flashColor,
      isFlash: false
    });
    row.appendChild(card);

    const fullTag = bindingTagText(b, live);
    row.appendChild(h('span',{class:'vf-tag'+(b.trigger==='static'?' vf-unchanged':''), tabindex:'0', title:fullTag, 'aria-label':fullTag},
      bindingTagShort(b, live),
      h('i',{class:'fa-solid fa-circle-info vf-hint-icon', 'aria-hidden':'true'})
    ));
    list.appendChild(row);

    if(justCommitted){
      // Mirrors connector-lines.js's own source-lookup concept: the token
      // that ORIGINATED this value in the timeline. For a mutated variable
      // (prefix, live the instant its step fires; postfix, only once the
      // whole statement completes) that's its unary node's id. For the
      // assignment target, the final EVALUATE step collapses the whole
      // expression into one freshly-minted literal, and that literal's
      // resultNodeId is the same id findConnectorDestEl would look up for
      // that step — see var-final-state.js's own resolveBindingLive comment
      // on why "the last step's index IS the origin" for a target.
      let originId;
      let mergeRuntime=null;
      if(b.trigger==='program-assignment'){
        const statementId=live.originStatementId||b.statementId;
        const statement = item.program.statements.find(s=>s.id===statementId);
        const flat = statement && statement.runtime && statement.runtime.workingFlat;
        mergeRuntime=statement && statement.kind==='assignment' && statement.runtime.assignmentMergePending
          ? statement.runtime : null;
        originId = mergeRuntime && mergeRuntime.assignmentResultNodeId
          ? mergeRuntime.assignmentResultNodeId
          : (flat && flat.operands.length ? flat.operands[0].id : null);
      } else {
        originId = b.kind==='target'
          ? (item.trace.length ? item.trace[item.trace.length-1].resultNodeId : null)
          : b.unaryNodeId;
      }
      flights.push({originId, statementId:live.originStatementId||b.statementId||null, cardEl:card,binding:b,
        name:b.name, kind:b.kind==='program-constant'?'constant':'variable',
        value:live.displayValue, color:live.flashColor,
        // Compound calculation timing is deliberately fixed and independent
        // from flightDurationMs. The speed selector controls only the later
        // expression-to-memory travel, never the instructional merge itself.
        delayMs:mergeRuntime&&typeof COMPOUND_WRITEBACK_DELAY_MS==='number'
          ? COMPOUND_WRITEBACK_DELAY_MS : (mergeRuntime?2400:0),mergeRuntime});
    }
  });

  wrap.appendChild(list);
  return {section: wrap, flights};
}

// ----------------------------------------------------------------------------
// Mounting + drag
// ----------------------------------------------------------------------------
function mountVarFinalFloatPanel(sectionEl, flights, playEntrance){
  const panel = h('div',{class:'var-final-float'+(playEntrance?' var-final-float-enter':''), style: floatPositionStyle()});
  const activeItem = typeof currentItem==='function' ? currentItem() : null;
  const title = itemHasInteractiveProgram(activeItem)
    ? 'Program variables and constants' : 'Variable final state';

  const flyTitle = flyAnimEnabled
    ? 'Turn off fly-in animation (values will appear instantly, matching the existing pulse)'
    : 'Turn on fly-in animation for variable value updates';
  const header = h('div',{class:'var-final-float-header', onmousedown: onVarFinalFloatDragStart, ontouchstart: onVarFinalFloatDragStart},
    h('i',{class:'fa-solid fa-up-down-left-right var-final-float-drag-icon', 'aria-hidden':'true'}),
    h('span',{class:'var-final-float-title-label'}, title),
    h('button',{class:'var-final-float-fly-toggle'+(flyAnimEnabled?' active':''), title:flyTitle, 'aria-label':flyTitle, 'aria-pressed':String(flyAnimEnabled),
      onclick: (e)=>{ e.stopPropagation(); toggleVarFinalFlyAnim(); }
    }, h('i',{class:'fa-solid fa-wand-magic-sparkles','aria-hidden':'true'})),
    h('button',{class:'var-final-float-close', title:'Hide this panel', 'aria-label':'Hide this panel',
      onclick: (e)=>{ e.stopPropagation(); toggleVarFinalFloatVisible(); }
    }, h('i',{class:'fa-solid fa-xmark','aria-hidden':'true'}))
  );
  panel.appendChild(header);

  const body = h('div',{class:'var-final-float-body'});
  if(flyAnimEnabled) body.appendChild(renderVarFinalSpeedToggle());
  body.appendChild(sectionEl);
  panel.appendChild(body);

  document.body.appendChild(panel);
  clampVarFinalFloatPosition(panel);

  if(flights && flights.length){
    // Deferred to the next frame: this render() call may still be
    // mid-flight itself (main.js typically builds/attaches the session
    // container synchronously, then does whatever else it does after
    // render() returns). rAF guarantees the timeline this panel needs to
    // read origin positions from is fully attached to the live document by
    // the time we measure it, regardless of exactly where in that sequence
    // this function happened to run.
    requestAnimationFrame(()=>runVarFinalFlights(flights));
  }
}

function floatPositionStyle(){
  if(floatPos) return `left:${floatPos.left}px; top:${floatPos.top}px; right:auto; bottom:auto;`;
  return ''; // default anchored corner position comes from the injected CSS
}

// Works for both MouseEvent (clientX/clientY) and TouchEvent (only exposes
// coordinates via .touches/.changedTouches) — every drag handler below reads
// the pointer position through this instead of assuming e.clientX exists.
function varFinalFloatEventPoint(e){
  if(e.touches && e.touches.length) return {x:e.touches[0].clientX, y:e.touches[0].clientY};
  if(e.changedTouches && e.changedTouches.length) return {x:e.changedTouches[0].clientX, y:e.changedTouches[0].clientY};
  return {x:e.clientX, y:e.clientY};
}
function onVarFinalFloatDragStart(e){
  // The header's mousedown/touchstart listener also fires when the event
  // originates on one of the header's own buttons (close, fly-toggle), via
  // normal bubbling. That's harmless for mouse — preventDefault() on
  // mousedown doesn't stop the click that follows on mouseup — but on touch
  // devices preventDefault()ing touchstart can suppress the synthetic click
  // Safari fires afterward, which would silently break tapping those
  // buttons. Bail out before starting a drag (and before calling
  // preventDefault at all) whenever the touch/click actually started on one
  // of them.
  if(e.target.closest('.var-final-float-close, .var-final-float-fly-toggle')) return;
  const panel = e.currentTarget.closest('.var-final-float');
  if(!panel) return;
  dragging = true;
  dragPanelEl = panel;
  const rect = panel.getBoundingClientRect();
  const pt = varFinalFloatEventPoint(e);
  dragOffsetX = pt.x - rect.left;
  dragOffsetY = pt.y - rect.top;
  panel.classList.add('var-final-float-dragging');
  // For touch, this also stops the gesture from ALSO being interpreted as a
  // page scroll/pull-to-refresh while dragging the panel.
  e.preventDefault();
}
function onVarFinalFloatDragMove(e){
  if(!dragging) return;
  // The panel's DOM node is rebuilt on every render() — including the 1s
  // auto-advance tick that drives solution-playback (see main.js). If that
  // fires mid-drag, the node we grabbed at mousedown/touchstart is now
  // detached; grab whichever '.var-final-float' is currently live instead
  // of silently freezing until mouseup/touchend. The offset stays valid
  // since it's relative to where the pointer sits within the panel, not
  // tied to a specific node.
  if(!dragPanelEl || !dragPanelEl.isConnected){
    dragPanelEl = document.querySelector('.var-final-float');
    if(!dragPanelEl){ dragging = false; return; }
    dragPanelEl.classList.add('var-final-float-dragging');
  }
  const pt = varFinalFloatEventPoint(e);
  floatPos = clampVarFinalFloatPoint(pt.x - dragOffsetX, pt.y - dragOffsetY, dragPanelEl);
  dragPanelEl.style.left = floatPos.left+'px';
  dragPanelEl.style.top = floatPos.top+'px';
  dragPanelEl.style.right = 'auto';
  dragPanelEl.style.bottom = 'auto';
  // Touchmove is registered non-passive (see the addEventListener call
  // below) specifically so this preventDefault is allowed to actually stop
  // the underlying page from scrolling while a touch-drag is in progress.
  e.preventDefault();
}
function onVarFinalFloatDragEnd(){
  if(!dragging) return;
  dragging = false;
  if(dragPanelEl) dragPanelEl.classList.remove('var-final-float-dragging');
  dragPanelEl = null;
}
// Attached once at module load (not per-render) — dragging spans exactly
// one continuous mousedown→mouseup (or touchstart→touchend) gesture during
// which no render() ever fires, so caching dragPanelEl for that gesture's
// duration is safe; the listeners themselves just need to exist for the
// lifetime of the page.
//
// Touch listeners are registered alongside the existing mouse ones —
// touchstart is wired directly on the panel header (see
// mountVarFinalFloatPanel), same as onmousedown, while move/end/cancel are
// document-level like their mouse counterparts, since a drag gesture can
// carry the finger anywhere on screen, not just over the header. touchmove
// must be {passive:false} — the whole point of calling preventDefault()
// inside onVarFinalFloatDragMove is to stop the page itself from scrolling
// underneath the drag, and a passive listener isn't allowed to do that.
// touchcancel (e.g. an incoming call interrupts the gesture) is mapped to
// the same end handler as touchend, so a dropped gesture can't leave
// `dragging` stuck true.
document.addEventListener('mousemove', onVarFinalFloatDragMove);
document.addEventListener('mouseup', onVarFinalFloatDragEnd);
document.addEventListener('touchmove', onVarFinalFloatDragMove, {passive:false});
document.addEventListener('touchend', onVarFinalFloatDragEnd);
document.addEventListener('touchcancel', onVarFinalFloatDragEnd);

function clampVarFinalFloatPoint(left, top, panelEl){
  const w = panelEl.offsetWidth, hgt = panelEl.offsetHeight;
  const maxLeft = Math.max(8, window.innerWidth - w - 8);
  const maxTop = Math.max(8, window.innerHeight - hgt - 8);
  return { left: Math.min(Math.max(8, left), maxLeft), top: Math.min(Math.max(8, top), maxTop) };
}
function clampVarFinalFloatPosition(panel){
  if(!floatPos) return; // default corner position is within viewport by construction
  const rect = panel.getBoundingClientRect();
  const clamped = clampVarFinalFloatPoint(rect.left, rect.top, panel);
  if(clamped.left!==rect.left || clamped.top!==rect.top){
    floatPos = clamped;
    panel.style.left = clamped.left+'px';
    panel.style.top = clamped.top+'px';
  }
}

// Speed control for the fly-in animation, shown only while fly-in mode is
// on (meaningless when values just appear instantly). A discrete 3-level
// segmented toggle rather than a slider: this is a "set once and forget"
// preference, not something dragged around often, so a full-width range
// input was disproportionate to how often it's actually touched. Clicking
// a level DOES need a render() (unlike the old slider's live oninput),
// since the active segment's highlighted state lives in this same markup
// and has to be redrawn.
const SPEED_LEVELS = [1000, 2000, 3000];
function renderVarFinalSpeedToggle(){
  const label = h('span',{class:'var-final-float-speed-label'},
    h('i',{class:'fa-solid fa-stopwatch', 'aria-hidden':'true'}), ' Fly-in speed');
  const group = h('div',{class:'var-final-float-speed-toggle', role:'group', 'aria-label':'Fly-in animation speed'});
  SPEED_LEVELS.forEach(ms=>{
    const active = flightDurationMs===ms;
    const text = `${ms/1000}s`;
    group.appendChild(h('button',{
      class:'var-final-float-speed-btn'+(active?' active':''),
      'aria-pressed':String(active),
      'aria-label':`Fly-in duration ${text}`,
      onclick:()=>{ flightDurationMs = ms; render(); }
    }, text));
  });
  return h('div',{class:'var-final-float-speed-row'}, label, group);
}

// ----------------------------------------------------------------------------
// Flights — the actual "value travels from where it was produced" effect.
// ----------------------------------------------------------------------------
function runVarFinalFlights(flights){
  flights.forEach(f=>{
    if(f.delayMs){
      const delayed=Object.assign({},f,{delayMs:0});
      setTimeout(()=>runVarFinalFlights([delayed]),f.delayMs);
      return;
    }
    const destRect = f.cardEl.getBoundingClientRect();
    const originEl = findVarFinalOriginEl(f.originId, f.statementId);
    if(!originEl){
      // No traceable origin (e.g. a static binding, which was always known
      // from the source rather than "produced" anywhere in the timeline) —
      // fall back to revealing the value in place with the same landing
      // pulse a completed flight ends with, rather than leaving the card
      // blank.
      settleVarFinalFlight(f, null);
      return;
    }
    spawnVarFinalFlyingToken(f, originEl.getBoundingClientRect(), destRect);
  });
}

// Same lookup concept as connector-lines.js's findConnectorDestEl: the
// live timeline stamps data-token-id on both the flat-expression renderer
// (render-flat.js) and the tree renderer, keyed by the node's resultNodeId.
// Several historical rows can share that id (a value keeps rendering in
// every later row once resolved), so the LAST match in document order is
// the current/most-recent on-screen instance of that token.
function findVarFinalOriginEl(id, statementId){
  if(id==null) return null;
  const scope = statementId
    ? '.program-expression-panel[data-statement-id="'+statementId+'"]'
    : '.eval-panel';
  const matches = document.querySelectorAll(scope+' [data-token-id="'+id+'"]');
  return matches.length ? matches[matches.length-1] : null;
}

function spawnVarFinalFlyingToken(f, originRect, destRect){
  const clone = renderValueCard({id:null, name:f.name, value:f.value, kind:f.kind || 'variable', color:f.color, isFlash:false});
  clone.classList.add('var-final-flying');
  clone.style.position = 'fixed';
  clone.style.left = originRect.left+'px';
  clone.style.top = originRect.top+'px';
  clone.style.width = originRect.width+'px';
  clone.style.height = originRect.height+'px';
  clone.style.margin = '0';
  clone.style.transform = 'none';
  document.body.appendChild(clone);

  // Force a layout read before enabling the transition, so the browser
  // registers this START position as the resting state before we move it —
  // otherwise the jump to the end position would happen instantly, with no
  // visible motion (same "measure before animating" concern as
  // connector-lines.js's connector-measuring class, just the reverse: here
  // we need the FIRST frame to actually stick, not be skipped).
  void clone.getBoundingClientRect();

  const durationMs = flightDurationMs;
  const opacityDelayMs = Math.round(durationMs * 0.6);
  clone.style.transition =
    `left ${durationMs}ms cubic-bezier(.3,.7,.2,1), top ${durationMs}ms cubic-bezier(.3,.7,.2,1), `+
    `width ${durationMs}ms ease, height ${durationMs}ms ease, opacity ${durationMs}ms ease ${opacityDelayMs}ms`;
  clone.style.left = destRect.left+'px';
  clone.style.top = destRect.top+'px';
  clone.style.width = destRect.width+'px';
  clone.style.height = destRect.height+'px';

  let done = false;
  const finish = ()=>{
    if(done) return;
    done = true;
    clone.remove();
    settleVarFinalFlight(f, f.color);
  };
  clone.addEventListener('transitionend', finish, {once:true});
  setTimeout(finish, durationMs + 150); // safety net if transitionend never fires (e.g. tab backgrounded)
}

// Reveals the real value on the actual destination card once its flight
// (or the no-origin fallback) completes, with the same one-shot pulse the
// rest of the app uses for "something just resolved" — see .tok-card-flash
// / colorFlash in styles.css.
function settleVarFinalFlight(f, color){
  const bodyEl = f.cardEl.querySelector('.tok-card-body');
  if(bodyEl) bodyEl.textContent = formatValue(f.value);
  if(color && f.cardEl.style && typeof f.cardEl.style.setProperty==='function'){
    f.cardEl.style.setProperty('--step-color',color);
  }
  f.cardEl.classList.add('tok-card-flash');
  if(f.binding) f.binding._lastDisplayValue=f.value;
  if(f.mergeRuntime) f.mergeRuntime.assignmentMergePending=false;
}

// ----------------------------------------------------------------------------
// Injected styles — kept here rather than in styles.css so this file stays
// fully self-contained/removable. Reuses existing CSS variables (--panel,
// --line, --text, --radius, etc. from :root) and existing classes
// (.var-final-panel/.var-final-title/.var-final-list/.tok-card-flash) so
// the floating content matches the app's look with only the shell itself
// needing new rules.
// ----------------------------------------------------------------------------
function ensureVarFinalFloatStyles(){
  if(document.getElementById('var-final-float-styles')) return;
  const style = document.createElement('style');
  style.id = 'var-final-float-styles';
  style.textContent = `
.var-final-float{
  position:fixed; top:100px; right:24px; z-index:900;
  width:260px; max-width:calc(100vw - 32px);
  background:var(--panel); border:1px solid var(--line); border-radius:var(--radius);
  box-shadow:0 10px 30px rgba(0,0,0,0.45);
}
.var-final-float-enter{ animation:var-final-float-in .22s ease; }
.var-final-float-dragging{ user-select:none; }
.var-final-float-header{
  display:flex; align-items:center; gap:8px; padding:9px 10px;
  border-bottom:1px solid var(--line); cursor:grab; user-select:none; touch-action:none;
  font-family:var(--ui); font-size:11px; text-transform:uppercase; letter-spacing:0.08em;
  color:var(--text-mute); font-weight:700;
}
.var-final-float-header:active{ cursor:grabbing; }
.var-final-float-drag-icon{ font-size:11px; opacity:0.7; }
.var-final-float-title-label{ flex:1; }
.var-final-float-close{
  background:none; border:none; color:var(--text-mute); cursor:pointer; padding:2px 5px;
  border-radius:4px; line-height:1; font-size:12px;
}
.var-final-float-close:hover{ color:var(--text); background:var(--panel-alt); }
/* Fly-in toggle — lives in the panel's own header instead of the global app
   header, since it only ever means something while this panel is already
   on screen (see the module header comment above). Same slot/sizing as the
   close button next to it; only the active-state color differs, matching
   the app's existing .link-toggle.active convention. */
.var-final-float-fly-toggle{
  background:none; border:none; color:var(--text-mute); cursor:pointer; padding:2px 5px;
  border-radius:4px; line-height:1; font-size:12px;
}
.var-final-float-fly-toggle:hover{ color:var(--text); background:var(--panel-alt); }
.var-final-float-fly-toggle.active{ color:var(--op-glow); }
.var-final-float-body{ padding:12px 12px 14px; max-height:60vh; overflow:auto; }
.var-final-float-speed-row{
  display:flex; align-items:center; justify-content:space-between; gap:8px;
  margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--line-soft);
}
.var-final-float-speed-label{
  display:flex; align-items:center; gap:5px; white-space:nowrap;
  font-family:var(--ui); font-size:10.5px; color:var(--text-mute);
  text-transform:uppercase; letter-spacing:0.06em;
}
.var-final-float-speed-toggle{ display:flex; gap:4px; }
.var-final-float-speed-btn{
  background:none; border:1px solid var(--line); color:var(--text-mute); cursor:pointer;
  padding:3px 8px; border-radius:4px; font-family:var(--ui); font-size:10.5px; font-weight:700;
  line-height:1.4;
}
.var-final-float-speed-btn:hover{ color:var(--text); border-color:var(--text-dim); }
.var-final-float-speed-btn.active{ color:var(--op-glow); border-color:var(--op-glow); }
/* This section's own title/margins are meant for sitting inline at the
   bottom of .eval-panel — inside the float it's redundant with the
   header's own title (above) and the spacing needs to start at the body's
   own padding instead. */
.var-final-float .var-final-panel{ margin-top:0; padding-top:0; border-top:none; }
.var-final-float .var-final-title{ display:none; }
@keyframes var-final-float-in{ from{ opacity:0; transform:translateY(-6px); } to{ opacity:1; transform:translateY(0); } }
.var-final-flying{ pointer-events:none; z-index:920; box-shadow:0 6px 18px rgba(0,0,0,0.4); }
.var-final-flying-reverse{ z-index:922; }
.var-final-transfer-shield{ position:fixed; inset:0; z-index:910; cursor:wait; background:transparent; }
.memory-transfer-waiting .tok-card-body{
  min-height:1em; display:flex; align-items:center; justify-content:center;
}
.memory-transfer-spinner{
  width:10px; height:10px; border:2px solid currentColor; border-right-color:transparent;
  border-radius:50%; animation:memory-transfer-spin .65s linear infinite;
}
@keyframes memory-transfer-spin{ to{ transform:rotate(360deg); } }
@media (max-width:520px){
  .var-final-float{ width:calc(100vw - 32px); }
}
`;
  document.head.appendChild(style);
}

// Set the header buttons' initial label/active state to match the defaults
// above as soon as this file loads (index.html's buttons ship with generic
// placeholder text so it isn't duplicated/hardcoded in two places).
// ensureVarFinalFloatStyles() also runs now rather than waiting for the
// first panel mount, since the disabled-button styling below needs to
// apply to the header buttons immediately (they exist in the static markup
// from page load, before any session/item render happens).
ensureVarFinalFloatStyles();
syncVarFinalFloatToggleUI();
