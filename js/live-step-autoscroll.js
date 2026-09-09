// ============================================================================
// LIVE STEP AUTO-SCROLL
// ----------------------------------------------------------------------------
// Follows newly appended student-work rows inside #app without coupling scroll
// state to evaluation semantics. A WeakMap remembers rendered progress for each
// item, so profile changes, restored sessions, timer/UI rerenders, undo, reset,
// and answer-key playback do not create unsolicited viewport jumps.
// ============================================================================

const liveStepScrollProgressByItem = new WeakMap();
let pendingLiveStepScrollFrame = null;
let liveStepStagePending = false;
let liveStepStageCommitInProgress = false;

const LIVE_STEP_SCROLL_MAX_MS = 900;
const LIVE_STEP_SCROLL_BOTTOM_INSET = 28;

function liveStepProgress(item){
  if(!item) return 0;
  let progress = Array.isArray(item.trace) ? item.trace.length : 0;
  const program = item.program;
  if(!program || !Array.isArray(program.statements)) return progress;
  program.statements.forEach(statement=>{
    if(statement.kind==='legacy-expression' || !statement.runtime) return;
    const trace = statement.runtime.trace;
    progress += Array.isArray(trace) ? trace.length : 0;
    // Compound assignment completion appends a dedicated merged-value row
    // without adding a semantic expression step.
    if(statement.kind==='assignment' && statement.operator!=='='
      && statement.runtime.checked) progress++;
  });
  // Completing a declaration or assignment unlocks and renders the next
  // statement even when the completed statement itself adds no trace row.
  progress += Array.isArray(program.events) ? program.events.length : 0;
  return progress;
}

function newestLiveStepRow(){
  const rows = document.querySelectorAll(
    '#app .program-expression-panel .tl-row, #app .eval-panel .tl-row');
  return rows.length ? rows[rows.length-1] : null;
}

function liveStepScrollOverflow(target){
  const scroller = document.getElementById('app');
  if(!scroller || !target || !target.isConnected) return null;
  const viewport = scroller.getBoundingClientRect();
  const row = target.getBoundingClientRect();
  return {scroller,overflow:row.bottom-(viewport.bottom-LIVE_STEP_SCROLL_BOTTOM_INSET)};
}

function scrollLiveStepIntoView(target,behavior){
  const measurement = liveStepScrollOverflow(target);
  if(!measurement || measurement.overflow<=0) return null;
  const {scroller,overflow} = measurement;
  const prefersReduced = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const requestedTop = scroller.scrollTop+overflow;
  const maxTop = Number.isFinite(scroller.scrollHeight) && Number.isFinite(scroller.clientHeight)
    ? Math.max(0,scroller.scrollHeight-scroller.clientHeight) : requestedTop;
  const targetTop = Math.min(requestedTop,maxTop);
  scroller.scrollTo({
    top:targetTop,
    behavior:prefersReduced ? 'auto' : behavior
  });
  return {scroller,targetTop};
}

// Wait until a smooth scroll has actually settled before revealing the new
// educational content. scrollend is not yet dependable on every browser used
// by the app, so stable animation frames provide the cross-browser signal.
function waitForLiveStepScroll(scroller,targetTop,done){
  const started = performance.now();
  let lastTop = scroller.scrollTop;
  let stableFrames = 0;
  const tick = now=>{
    const top = scroller.scrollTop;
    if(Math.abs(top-lastTop)<0.5) stableFrames++;
    else stableFrames=0;
    lastTop=top;
    const reachedTarget = Math.abs(top-targetTop)<1;
    if((reachedTarget&&stableFrames>=2) || now-started>=LIVE_STEP_SCROLL_MAX_MS){
      done();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function liveStepStageHeight(lastRow,action){
  const measured = lastRow ? lastRow.getBoundingClientRect().height : 0;
  // Compound-assignment convergence has a taller minimum than an ordinary
  // expression row. Other rows normally match the current row's dimensions.
  const minimum = action && action.type==='commit-assignment' ? 70 : 55;
  return Math.ceil(Math.max(measured,minimum));
}

// Prepares an empty stage BEFORE a semantic action mutates state. The stage
// reserves the next row's space without exposing its text, connector, spinner
// or result. Once it is visible, `commit` performs the normal render/animation
// path synchronously as the stage is removed, so there is no collapse frame.
function prepareLiveStepStage(item,action,commit){
  // Absorb repeated clicks while the first click is preparing its viewport;
  // returning true tells the caller that this coordinator owns the action.
  if(liveStepStagePending) return true;
  if(!item || typeof commit!=='function') return false;
  const lastRow = newestLiveStepRow();
  const panel = lastRow && lastRow.closest
    ? lastRow.closest('.program-expression-panel, .eval-panel') : null;
  const scroller = document.getElementById('app');
  if(!panel || !scroller){
    commit();
    return true;
  }

  liveStepStagePending = true;
  const stage = document.createElement('div');
  stage.className = 'live-step-empty-stage';
  stage.setAttribute('aria-hidden','true');
  stage.style.height = liveStepStageHeight(lastRow,action)+'px';
  stage.style.visibility = 'hidden';
  stage.style.pointerEvents = 'none';
  panel.appendChild(stage);

  const finish = ()=>{
    if(!liveStepStagePending) return;
    liveStepStagePending = false;
    if(stage.isConnected) stage.remove();
    // Navigation during the preparatory scroll invalidates the queued click.
    if(typeof currentItem==='function' && currentItem()!==item) return;
    liveStepStageCommitInProgress = true;
    try{ commit(); }
    finally{ liveStepStageCommitInProgress = false; }
  };

  // Give layout one frame to include the reserved height before calculating
  // the destination. Even when no scroll is necessary, content is committed
  // on a later frame so stage preparation still precedes reveal.
  requestAnimationFrame(()=>{
    if(!stage.isConnected){ liveStepStagePending=false; return; }
    const scroll = scrollLiveStepIntoView(stage,'smooth');
    if(!scroll){ requestAnimationFrame(finish); return; }
    waitForLiveStepScroll(scroll.scroller,scroll.targetTop,finish);
  });
  return true;
}

function handleLiveStepAutoScroll(item){
  if(!item) return;
  const progress = liveStepProgress(item);
  const previous = liveStepScrollProgressByItem.get(item);
  liveStepScrollProgressByItem.set(item,progress);
  // A prepared commit has already positioned the viewport while its empty
  // stage was present. Never issue a second post-render scroll for that row.
  if(liveStepStageCommitInProgress) return;
  // The reverse memory flight measures a fixed destination before it moves.
  // Record progress now, but never move that destination while it is in flight.
  if(typeof memoryTransferInProgress==='boolean' && memoryTransferInProgress) return;
  if(previous==null || progress<=previous) return;

  const target = newestLiveStepRow();
  if(!target) return;
  if(pendingLiveStepScrollFrame!=null) cancelAnimationFrame(pendingLiveStepScrollFrame);
  pendingLiveStepScrollFrame=requestAnimationFrame(()=>{
    pendingLiveStepScrollFrame=null;
    scrollLiveStepIntoView(target,'smooth');
  });
}
