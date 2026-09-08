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

function scrollLiveStepIntoView(target,behavior){
  const scroller = document.getElementById('app');
  if(!scroller || !target || !target.isConnected) return;
  const viewport = scroller.getBoundingClientRect();
  const row = target.getBoundingClientRect();
  const bottomInset = 28;
  const overflow = row.bottom - (viewport.bottom-bottomInset);
  if(overflow<=0) return;
  const prefersReduced = window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  scroller.scrollTo({
    top:scroller.scrollTop+overflow,
    behavior:prefersReduced ? 'auto' : behavior
  });
}

function handleLiveStepAutoScroll(item){
  if(!item) return;
  // The reverse memory flight measures a fixed destination before it moves.
  // Wait for its completion render rather than moving that destination while
  // the token is already in flight.
  if(typeof memoryTransferInProgress==='boolean' && memoryTransferInProgress) return;

  const progress = liveStepProgress(item);
  const previous = liveStepScrollProgressByItem.get(item);
  liveStepScrollProgressByItem.set(item,progress);
  if(previous==null || progress<=previous) return;

  const target = newestLiveStepRow();
  if(!target) return;
  // When value-flight animation is enabled, settle the scroll synchronously
  // before the memory panel measures its origin/destination rectangles.
  if(typeof flyAnimEnabled==='boolean' && flyAnimEnabled){
    scrollLiveStepIntoView(target,'auto');
    return;
  }
  if(pendingLiveStepScrollFrame!=null) cancelAnimationFrame(pendingLiveStepScrollFrame);
  pendingLiveStepScrollFrame=requestAnimationFrame(()=>{
    pendingLiveStepScrollFrame=null;
    scrollLiveStepIntoView(target,'smooth');
  });
}
