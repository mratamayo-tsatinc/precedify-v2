// ============================================================================
// FEEDBACK DRAWER — fully additive, content-agnostic module
// ----------------------------------------------------------------------------
// Same shell pattern as console-drawer.js: this file never edits engine.js /
// state.js / main.js / render-*.js. It only owns the open/close/toggle
// mechanism, the tab's visibility, and rendering whatever content it's
// given — it has NO opinion about what that content is. render-session.js
// wires it up by calling setFeedbackDrawerContent(fb) with the exact same
// `fb` node it already builds for the "Check answer" feedback card (see
// that file's `if(item.checked){ ... }` block), instead of appending it
// inline below the action bar.
//
// PUBLIC API (mirrors console-drawer.js's naming/shape exactly):
//
//   openFeedbackDrawer() / closeFeedbackDrawer() / toggleFeedbackDrawer()
//   isFeedbackDrawerOpen() -> boolean
//   setFeedbackDrawerTitle(text)
//   setFeedbackDrawerContent(contentOrNode)
//     contentOrNode: a real DOM Node (the usual case — render-session.js's
//       `fb`) OR a string (rendered as plain text, never interpreted as
//       HTML). Unlike console-drawer.js there's no {cursor} option — this
//       drawer never shows a terminal cursor.
//   clearFeedbackDrawerContent()
//   showFeedbackDrawerTab() / hideFeedbackDrawerTab()
//   setFeedbackDrawerStatus(correct)
//     Colors the small dot on the docked tab green/red so a student can see
//     at a glance whether their last check was correct even with the
//     drawer closed. Pass a boolean; pass null/undefined to hide the dot.
//   syncFeedbackDrawerForItem(item)
//     Clears, closes and hides the drawer whenever the current item is absent
//     or unchecked. Checked-item content remains owned by render-session.js.
//
// Every function is defensive (matches console-drawer.js/moment-feedback.js's
// try/catch convention): a missing DOM node or bad argument degrades to a
// silent no-op rather than throwing back into the rest of the app.
//
// MUTUAL EXCLUSIVITY WITH THE CONSOLE DRAWER: both drawers slide in from the
// same right edge at the same width, so having both open at once would
// visually stack one on top of the other. openFeedbackDrawer() closes the
// console drawer if it happens to be open (and vice versa is intentionally
// NOT added here, to avoid editing console-drawer.js) — done purely through
// its existing public functions (isConsoleDrawerOpen/closeConsoleDrawer),
// guarded with typeof checks so this file works standalone even if
// console-drawer.js isn't loaded at all.
// ============================================================================
(function(){
  const root = (typeof globalThis !== 'undefined') ? globalThis : window;

  const IDS = {
    tab: 'feedbackDrawerTab',
    tabDot: 'feedbackDrawerTabDot',
    panel: 'feedbackDrawerPanel',
    overlay: 'feedbackDrawerOverlay',
    title: 'feedbackDrawerTitle',
    content: 'feedbackDrawerContent'
  };

  function el(id){ return document.getElementById(id); }

  function renderPlainText(container, text){
    container.textContent = String(text == null ? '' : text);
  }

  function openFeedbackDrawer(){
    try{
      const panel = el(IDS.panel);
      const overlay = el(IDS.overlay);
      if(!panel) return;

      // Avoid two same-edge, same-width panels stacked on top of each
      // other — see file header. Purely additive: only touches the console
      // drawer through its own public API, and only if that API exists.
      try{
        if(typeof isConsoleDrawerOpen === 'function' && isConsoleDrawerOpen()
           && typeof closeConsoleDrawer === 'function') closeConsoleDrawer();
      }catch(e){ /* no-op */ }

      if(overlay){
        overlay.style.display = 'block';
        overlay.setAttribute('aria-hidden', 'false');
      }
      panel.setAttribute('aria-hidden', 'false');
      updateFeedbackDrawerTabState(true);

      requestAnimationFrame(() => {
        try{ panel.classList.add('open'); }catch(e){ /* no-op */ }
      });
    }catch(e){ /* never let a UI glitch here surface as an app error */ }
  }

  function closeFeedbackDrawer(){
    try{
      const panel = el(IDS.panel);
      const overlay = el(IDS.overlay);
      if(!panel) return;

      const wasOpen = panel.classList.contains('open');
      panel.classList.remove('open');
      panel.setAttribute('aria-hidden', 'true');
      updateFeedbackDrawerTabState(false);

      if(overlay){
        overlay.setAttribute('aria-hidden', 'true');
        if(wasOpen){
          const onEnd = () => {
            try{
              // The drawer may have been reopened before this close animation
              // finished (for example during fast item navigation).
              if(!panel.classList.contains('open')) overlay.style.display = 'none';
            }catch(e){ /* no-op */ }
            panel.removeEventListener('transitionend', onEnd);
          };
          panel.addEventListener('transitionend', onEnd);
        } else {
          overlay.style.display = 'none';
        }
      }
    }catch(e){ /* purely UI bookkeeping */ }
  }

  function toggleFeedbackDrawer(){
    try{
      const panel = el(IDS.panel);
      if(!panel) return;
      if(panel.classList.contains('open')) closeFeedbackDrawer();
      else openFeedbackDrawer();
    }catch(e){ /* no-op */ }
  }

  function isFeedbackDrawerOpen(){
    try{
      const panel = el(IDS.panel);
      return !!(panel && panel.classList.contains('open'));
    }catch(e){ return false; }
  }

  function setFeedbackDrawerTitle(text){
    try{
      const titleEl = el(IDS.title);
      if(titleEl) titleEl.textContent = (text == null ? 'Feedback' : String(text));
    }catch(e){ /* no-op */ }
  }

  function setFeedbackDrawerContent(contentOrNode){
    try{
      const container = el(IDS.content);
      if(!container) return;

      container.innerHTML = '';

      if(contentOrNode instanceof Node){
        container.appendChild(contentOrNode);
      } else {
        renderPlainText(container, contentOrNode);
      }
    }catch(e){ /* no-op — a bad content payload should never break the app */ }
  }

  function clearFeedbackDrawerContent(){
    try{
      const container = el(IDS.content);
      if(!container) return;
      container.innerHTML = '';
      const placeholder = document.createElement('span');
      placeholder.className = 'feedback-drawer-empty';
      placeholder.textContent = 'No feedback yet — check an answer to see it here.';
      container.appendChild(placeholder);
    }catch(e){ /* no-op */ }
  }

  function updateFeedbackDrawerTabState(forceOpen){
    try{
      const tab = el(IDS.tab);
      const panel = el(IDS.panel);
      if(!tab || !panel) return;
      const isOpen = forceOpen !== undefined ? forceOpen : panel.classList.contains('open');
      tab.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }catch(e){ /* no-op */ }
  }

  function showFeedbackDrawerTab(){
    try{
      const tab = el(IDS.tab);
      if(tab) tab.style.display = 'flex';
    }catch(e){ /* no-op */ }
  }

  function hideFeedbackDrawerTab(){
    try{
      const tab = el(IDS.tab);
      if(tab) tab.style.display = 'none';
    }catch(e){ /* no-op */ }
  }

  // correct: true/false to show+color the tab's status dot, null/undefined
  // to hide it (e.g. once feedback has been cleared for a fresh item).
  function setFeedbackDrawerStatus(correct){
    try{
      const dot = el(IDS.tabDot);
      if(!dot) return;
      if(correct === null || correct === undefined){
        dot.classList.remove('shown', 'correct', 'incorrect');
        return;
      }
      dot.classList.add('shown');
      dot.classList.toggle('correct', !!correct);
      dot.classList.toggle('incorrect', !correct);
    }catch(e){ /* no-op */ }
  }

  // Keeps this persistent, app-level drawer synchronized with the activity
  // currently rendered in #app. Some program items intentionally do not call
  // renderSession() until their declaration/assignment prelude is complete,
  // so cleanup cannot live only inside that expression renderer.
  function syncFeedbackDrawerForItem(item){
    try{
      if(item && item.checked) return;
      clearFeedbackDrawerContent();
      setFeedbackDrawerStatus(null);
      closeFeedbackDrawer();
      hideFeedbackDrawerTab();
    }catch(e){ /* drawer state must never interrupt item navigation */ }
  }

  // Escape closes whichever of the two drawers is currently open, mirroring
  // console-drawer.js's own Escape handling. Self-contained listener —
  // doesn't assume or touch console-drawer.js's own listener.
  document.addEventListener('keydown', (e) => {
    if(e.key === 'Escape' && isFeedbackDrawerOpen()) closeFeedbackDrawer();
  });

  root.openFeedbackDrawer = openFeedbackDrawer;
  root.closeFeedbackDrawer = closeFeedbackDrawer;
  root.toggleFeedbackDrawer = toggleFeedbackDrawer;
  root.isFeedbackDrawerOpen = isFeedbackDrawerOpen;
  root.setFeedbackDrawerTitle = setFeedbackDrawerTitle;
  root.setFeedbackDrawerContent = setFeedbackDrawerContent;
  root.clearFeedbackDrawerContent = clearFeedbackDrawerContent;
  root.showFeedbackDrawerTab = showFeedbackDrawerTab;
  root.hideFeedbackDrawerTab = hideFeedbackDrawerTab;
  root.setFeedbackDrawerStatus = setFeedbackDrawerStatus;
  root.syncFeedbackDrawerForItem = syncFeedbackDrawerForItem;
})();
