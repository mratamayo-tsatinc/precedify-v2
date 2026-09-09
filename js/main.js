function captureExpressionScrollPositions(container){
  const positions=new Map();
  if(!container) return positions;
  container.querySelectorAll('.expression-scroll-surface').forEach((panel,index)=>{
    const key=panel.getAttribute('data-statement-id')||`legacy-expression-${index}`;
    positions.set(key,panel.scrollLeft||0);
  });
  return positions;
}

function restoreExpressionScrollPositions(container,positions){
  if(!container||!positions||!positions.size) return;
  container.querySelectorAll('.expression-scroll-surface').forEach((panel,index)=>{
    const key=panel.getAttribute('data-statement-id')||`legacy-expression-${index}`;
    if(positions.has(key)) panel.scrollLeft=positions.get(key);
  });
}

function render(){
  if(activePlaybackTimer){ clearTimeout(activePlaybackTimer); activePlaybackTimer = null; }

  // Handle login screen visibility
  const loginOverlay = document.getElementById('loginOverlay');
  const mainContent = document.getElementById('mainContent');
  
  if(state.screen === 'login'){
    loginOverlay.style.display = 'flex';
    mainContent.style.display = 'none';
    if(typeof syncFeedbackDrawerForItem === 'function') syncFeedbackDrawerForItem(null);
    return;
  } else {
    loginOverlay.style.display = 'none';
    mainContent.style.display = 'flex';
    
    // Populate sidebar when showing main content
    populateProfileSidebar();
  }

  // Global app-header controls (mode tag, links toggle, exam timer) live in
  // static header markup, outside the #app container rebuilt below —
  // specifically so a profile switch (or any other render() call) never
  // recreates-then-restores them. That recreate-then-restore gap was the
  // cause of the timer flashing "00:00" on every profile switch. These are
  // session-wide settings, not per-profile state.
  syncGlobalHeaderUI();

  const container = document.getElementById('app');
  const expressionScrollPositions=captureExpressionScrollPositions(container);
  container.innerHTML = '';
  renderProgramItem(container, currentItem());
  // A click rebuilds #app, but the student's horizontal reading position is
  // part of the current work context. Restore it before connector geometry is
  // measured so rows and their shared SVG begin in the same content space.
  restoreExpressionScrollPositions(container,expressionScrollPositions);

  // The feedback drawer lives outside #app and survives its rebuild. Sync it
  // at this global boundary so unchecked declaration/assignment items (which
  // do not render the final expression yet) cannot inherit another item's tab
  // or feedback content.
  if(typeof syncFeedbackDrawerForItem === 'function'){
    syncFeedbackDrawerForItem(currentItem());
  }

  // Fallback follower for rows created outside the click-stage coordinator
  // (for example restored or plugin-driven progress). Ordinary student steps
  // have already prepared their viewport and are suppressed here.
  if(typeof handleLiveStepAutoScroll === 'function') handleLiveStepAutoScroll(currentItem());

  // Mount at the program boundary so this authoritative panel refreshes for
  // legacy expressions and for every declaration in a statement chain.
  if(typeof renderVariableFinalFloat === 'function') renderVariableFinalFloat(currentItem());

  if(state.screen==='session'){
    // Keeps the saved exam-mode record current on every state change —
    // no-op outside exam mode (see saveExamProgress's own guard), so this
    // is safe to call unconditionally here.
    if (typeof saveExamProgress === 'function') saveExamProgress();

    // Render item pagination bar
    renderItemPaginationBar();
    
    // Draws every operator→result connector line (connector-lines.js) after
    // the DOM has been built, since it measures real element positions.
    // No-op when state.showConnectors is false or there's no step yet.
    drawConnectorLines(currentItem());
    if(typeof drawDeclarationConnectorLines === 'function') drawDeclarationConnectorLines(currentItem());
    // Same treatment for the answer-key/canonical playback timeline, when
    // it's currently showing — a separate DOM subtree (.solution-playback)
    // driven by item.canonicalTrace.steps rather than item.trace. No-op
    // when the solution isn't open or no step has been revealed yet.
    drawCanonicalConnectorLines(currentItem());
    if(typeof drawCanonicalProgramConnectorLines==='function') drawCanonicalProgramConnectorLines(currentItem());

    const item = currentItem();
    if(item && item.playback && item.playback.playing){
      const total = typeof canonicalPlaybackTotal==='function'
        ? canonicalPlaybackTotal(item) : item.canonicalTrace.steps.length;
      if(item.playback.index < total){
        activePlaybackTimer = setTimeout(()=>{
          item.playback.index++;
          if(item.playback.index >= total) item.playback.playing = false;
          render();
        }, 1000);
      } else {
        item.playback.playing = false;
      }
    }
  }
}

// Updates the header's mode tag / links toggle / timer visibility in place.
// Never recreates these elements — only text/class/display — so an exam
// timer already running keeps showing its live value across any render()
// call instead of momentarily resetting.
function syncGlobalHeaderUI(){
  const modeTag = document.getElementById('headerModeTag');
  if(modeTag){
    modeTag.textContent = state.mode;
    modeTag.className = 'mode-tag ' + state.mode;
  }
  const linksToggle = document.getElementById('headerLinksToggle');
  if(linksToggle) linksToggle.classList.toggle('active', state.showConnectors);
  const linksToggleText = document.getElementById('headerLinksToggleText');
  if(linksToggleText) linksToggleText.textContent = state.showConnectors ? 'Links on' : 'Links off';

  const timerContainer = document.getElementById('timerContainer');
  if(timerContainer){
    timerContainer.style.display = (timerIntervalId !== null && appSettings.mode === 'exam') ? 'flex' : 'none';
  }
}

// appSettings (mode/timerMinutes) is persisted globally, not per-user (see
// settings-persistence.js) — load it before any login/session logic below
// runs, since both this refresh path and login.js's logout->login path now
// key their resume decision off it.
loadPersistedAppSettings();

// Check for existing login session and restore if available.
// Mirrors handleLogin()'s post-login flow (login.js): restore the saved
// identity, then actually call startSession() to (re)generate every
// profile's items and land on state.screen='session'. Previously this only
// set state.screen='setup' and left state.items as [] — but render() calls
// renderSession(container) unconditionally for any non-login screen (the
// 'setup' screen itself is legacy/dead now that login always skips straight
// to session), so on refresh renderSession ran against an empty state.items,
// currentItem() returned undefined, and accessing item.decls threw —
// producing the blank #app area and the "Cannot read properties of
// undefined" console errors.
const savedLogin = localStorage.getItem('precedifyLogin');
if(savedLogin){
  const login = JSON.parse(savedLogin);
  state.userEmail = login.email;
  state.userStudentId = login.studentId;
  // Resume only if the persisted global mode is currently 'exam' — the
  // SAME check login.js's logout->login path uses, so refresh and
  // logout->login now behave identically instead of refresh resuming
  // unconditionally while logout checked appSettings. If mode is 'exam'
  // but this particular email has no saved record, tryResumeExamSession
  // returns false and this falls through to a normal fresh startSession().
  if (appSettings.mode === 'exam' && tryResumeExamSession(login.email)) {
    // resumed
  } else {
    state.mode = appSettings.mode;
    startSession();
  }
}

// Initialize student database
loadStudentDatabase().then(() => {
  render();
}).catch(err => {
  console.error('Failed to initialize:', err);
  render();
});
