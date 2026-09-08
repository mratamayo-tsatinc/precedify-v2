// ---------------------------------------------------------------------------
// "On-paper" assignment-line layout.
// ----------------------------------------------------------------------------
// A student working an expression out by hand writes the "TYPE varname ="
// left-hand side once, then just "= ..." underneath for every subsequent
// transformation, reading straight down the "=" column rather than
// re-parsing "int result" on every line. We mimic that here: the LHS label
// is shown only on the very first evaluation-panel row (the untouched
// expression) and the very last (the fully-derived final value) — see
// callers below — with every row in between rendering a blank space of the
// exact same width instead.
//
// The LHS text is now PER-ITEM, not a fixed constant: each generated item
// carries its own randomly (seeded) chosen assignment-target name (see
// generator.js's RESULT_NAMES/pickResultName, threaded onto item.resultName
// in state.js), so one item might read "int total = ..." while another
// reads "int outcome = ...". assignLineString() (language.js) mirrors this
// same name for the source panel's own assignment line.
//
// Because the label text now varies in length per item, its reserved width
// (in `ch` units) can no longer be a single module-level constant — it's
// computed once per render, from that item's own resultName, and passed
// into every renderAssignLabel() call for that item so every row (and the
// canonical-playback panel, which renders the very same item) reserves the
// identical width. That's still the important invariant: within one item's
// own rows, the width must never vary, or the "=" column drifts.
//
// Two things must stay a constant width on every row for the "=" to
// actually land in the same pixel column: this label, and the correctness
// badge (which only appears on some EVALUATE rows, after Check). Both are
// wrapped in fixed-width slots so their presence/absence never shifts
// anything to their right. This depends on .code-out having a single,
// non-varying font-size across done/current rows (see the CSS) — `ch` units
// are font-size-relative, so a size difference between rows would silently
// reintroduce misalignment even with these slots in place.
// ---------------------------------------------------------------------------
// labelText/labelCh are computed per-item by the caller (see renderSession
// and renderCanonicalPlayback below) from item.resultName, since the LHS
// text is no longer a fixed constant. Falls back to a bare space-reserving
// width of 0 if somehow not supplied, rather than throwing.
function renderAssignLabel(show, labelText, labelCh){
  const text = labelText || '';
  const ch = labelCh || 0;
  return h('span',{class:'assign-label', style:`display:inline-block;width:${ch}ch;`}, show ? text+' ' : '');
}
// 22px = .step-badge's own 15px width + 7px margin-right, so the slot holds
// the badge with no extra shift when one is present, and no gap collapse
// when one isn't.
function renderBadgeSlot(badge){
  return h('span',{class:'badge-slot', style:'display:inline-block;width:22px;'}, badge);
}

function renderInlineEvaluationActions(options){
  options=options||{};
  const actions=[];
  if(options.canUndo){
    actions.push(h('button',{class:'inline-eval-action inline-undo-action',type:'button',
      title:'Undo last action','aria-label':'Undo last action',onclick:handleUndo},
      h('i',{class:'fa-solid fa-rotate-left','aria-hidden':'true'})));
  }
  if(options.canCheck){
    actions.push(h('button',{class:'inline-eval-action inline-check-action',type:'button',
      title:'Check answer','aria-label':'Check answer',onclick:handleCheck},
      h('i',{class:'fa-solid fa-check','aria-hidden':'true'}),h('span',{},'Check')));
  }
  return actions.length ? h('span',{class:'inline-eval-actions'},...actions) : null;
}

function renderItemResetControl(show){
  if(!show) return null;
  return h('div',{class:'item-reset-control'},
    h('button',{class:'item-reset-button',type:'button',onclick:handleReset},'Reset item'));
}

// Shared source-code panel for every expression-shaped statement. Keeping the
// complete statement outside the compact evaluation rows is especially
// important on mobile, where the rows intentionally hide their LHS label.
function renderExpressionSourcePanel(title, lines, panelClass){
  const panel = h('div',{class:'source-panel'+(panelClass?' '+panelClass:'')});
  panel.appendChild(h('div',{class:'panel-title'},title));
  (lines || []).forEach(line=>{
    const value = typeof line==='string' ? line : line.text;
    const lineClass = typeof line==='string' ? 'active-line' : (line.className || 'active-line');
    panel.appendChild(h('div',{class:`code-line ${lineClass}`},value));
  });
  return panel;
}

// Full step detail as plain text only — used for a hover title / aria-label,
// never rendered as a visible line. The visible surface is just the badge
// (see .step-badge) plus the expression's own token colors.
function stepTooltip(t, revealCorrectness){
  if(t.action==='READ_TARGET') return `read current ${t.target} → ${formatValue(t.sourceValue)}`;
  if(t.action==='SUBSTITUTE') return `substitute ${t.target} → ${formatValue(t.sourceValue)}`;
  if(t.action==='UNARY') return `apply ${t.op} to ${t.target} → ${formatValue(t.result)}`;
  const order = (!revealCorrectness || t.wasCorrect==null) ? '' : (t.wasCorrect ? ' (correct order)' : ' (out of order)');
  return `evaluate ${formatValue(t.target.operands[0])} ${t.target.operator} ${formatValue(t.target.operands[1])} → ${formatValue(t.result)}${order}`;
}

// ---------------------------------------------------------------------------
// Answer-key playback controls (per item: {index, playing})
// ---------------------------------------------------------------------------
let activePlaybackTimer = null;
function playbackTogglePlay(){
  const item = currentItem();
  if(!item || !item.playback) return;
  const total = item.canonicalTrace.steps.length;
  if(item.playback.index >= total) item.playback.index = 0;
  item.playback.playing = !item.playback.playing;
  render();
}
function playbackStep(delta){
  const item = currentItem();
  if(!item || !item.playback) return;
  const total = item.canonicalTrace.steps.length;
  item.playback.playing = false;
  item.playback.index = Math.max(0, Math.min(total, item.playback.index+delta));
  render();
}
function playbackRestart(){
  const item = currentItem();
  if(!item || !item.playback) return;
  item.playback.index = 0;
  item.playback.playing = false;
  render();
}

function renderSession(container){
  const item = currentItem();
  const profile = currentProfile();

  // This item's own assignment-target label text/width — see the header
  // comment above. Computed once per render and threaded through every
  // renderAssignLabel() call below (and into renderCanonicalPlayback, which
  // renders this same item's derivation) so the "=" column lines up
  // consistently across every row for THIS item.
  const assignLabelText = 'int ' + (item.resultName || 'result');
  const assignLabelCh = assignLabelText.length + 1; // +1 for the space before '='

  // Mode tag, links toggle, and exam timer are global app settings, not
  // per-profile — they now live in the static app header (index.html) and
  // are kept in sync by main.js's syncGlobalHeaderUI(), not rebuilt here.
  container.appendChild(h('div',{class:'session-bar'},
    h('div',{class:'session-meta'}, h('b',{}, `Item ${state.itemIndex+1}`), ` / ${state.items.length}  ·  ${profile.name}`)
  ));

  // SOURCE panel
  const hasInteractiveDeclarations = itemHasInteractiveProgram(item);
  const sourceLines = [];
  if(!hasInteractiveDeclarations){
    for(const decl of item.decls){
      sourceLines.push({text:declLine(decl,state.language),className:'decl-line'});
    }
  }
  const originalExprStr = renderString(item.originalTree);
  sourceLines.push({text:assignLineString(originalExprStr,item.resultName),className:'active-line'});
  container.appendChild(renderExpressionSourcePanel(
    hasInteractiveDeclarations ? 'Final expression' : 'Original source',sourceLines));

  // The same renderer is used by declaration initializers; this invocation
  // preserves the legacy item as the reference behavior.
  const evalPanel = renderExpressionEvaluationPanel({
    runtime:item,
    labelText:assignLabelText,
    labelCh:assignLabelCh,
    title:'Evaluation',
    panelClass:'eval-panel',
    interactive:true,
    revealCorrectness:item.checked,
    isFullyResolved:()=>itemFullyResolved(item),
    renderTrailingActions:()=>renderInlineEvaluationActions({
      canUndo:!item.checked&&canUndoProgram(item),
      canCheck:!item.checked&&itemFullyResolved(item)
    })
  });
  container.appendChild(evalPanel);
  const canReset = state.mode==='practice' && !item.checked && (
    item.trace.length>0 || (item.program && item.program.cursor>0));
  const resetControl=renderItemResetControl(canReset);
  if(resetControl) container.appendChild(resetControl);

  if(!itemFullyResolved(item) && !item.checked){
    const unresolvedCount = collectUnresolvedFlat(item.workingFlat,[]).length;
    if(unresolvedCount>0){
      container.appendChild(h('p',{class:'helper-text'}, `Resolve ${unresolvedCount} more highlighted token${unresolvedCount>1?'s':''} (variable, constant, or unary) before operators become active.`));
    } else {
      container.appendChild(h('p',{class:'helper-text'}, 'Tap any highlighted operator to evaluate it — you choose the order. Wrong order is allowed; you\'ll see how it plays out.'));
    }
  }

  // feedback
  if(item.checked){
    const correct = item.wasCorrectFinal;
    // The whole session view is torn down and rebuilt on every render() call
    // (including once per second while answer-key playback is auto-advancing),
    // so a brand-new .feedback DOM node is created every single tick even
    // though the box itself never actually re-appears. An unconditional
    // "pop in" animation class would therefore replay on every tick, making
    // the whole box look like it's blinking. `_feedbackAnimated` is a plain
    // flag on the persistent item object (not the DOM), so it survives
    // across rebuilds and the entrance animation fires exactly once, right
    // when Check is first pressed.
    // Also doubles as the "should the feedback drawer auto-open?" signal
    // below — both questions are really the same one ("has feedback for
    // THIS check already been shown to the student"), so they share the
    // one flag rather than tracking it twice.
    const isFirstFeedbackShow = !item._feedbackAnimated;
    const fbEnterCls = item._feedbackAnimated ? '' : ' feedback-enter';
    item._feedbackAnimated = true;
    const fb = h('div',{class:'feedback '+(correct?'correct':'incorrect')+fbEnterCls});
    fb.appendChild(h('div',{class:'feedback-head'}, h('i',{class:'fa-solid '+(correct?'fa-circle-check':'fa-circle-xmark')}), correct ? ' Correct' : ' Incorrect'));
    fb.appendChild(h('div',{class:'feedback-body'},
      correct
        ? h('span',{}, 'Your derived result matches the independently calculated answer: ', h('span',{class:'num'}, String(item.correctFinalValue)), '.')
        : h('span',{}, 'Your derived result was ', h('span',{class:'num'}, String(item.studentFinal)), '. The correct result is ', h('span',{class:'num'}, String(item.correctFinalValue)), '.')
    ));
    fb.appendChild(h('div',{class:'feedback-stats'},
      h('div',{class:'stat'}, h('div',{class:'sv'}, `${item.correctSteps}/${item.totalOpSteps}`), h('div',{class:'sl'},'steps in correct order')),
      item.programScoreFacts && item.programScoreFacts.programTotalChecks>0
        ? h('div',{class:'stat'},
            h('div',{class:'sv'}, `${item.programScoreFacts.programCorrectChecks}/${item.programScoreFacts.programTotalChecks}`),
            h('div',{class:'sl'},'program statement checks'))
        : null,
      h('div',{class:'stat'}, h('div',{class:'sv'}, `${Math.round(item.itemScore*100)}%`), h('div',{class:'sl'},'item score'))
    ));
    // Additive hook for the moment-to-moment feedback module
    // (js/moment-feedback.js) — entirely optional. If that script isn't
    // loaded, or it fails for any reason, this is a silent no-op and the
    // feedback card renders exactly as it did before that module existed.
    if(typeof renderMomentFeedbackBlock === 'function'){
      let mfBlock = null;
      try{ mfBlock = renderMomentFeedbackBlock(item); }catch(e){ mfBlock = null; }
      if(mfBlock) fb.appendChild(mfBlock);
    }
    if(state.mode==='practice'){
      fb.appendChild(h('button',{class:'solution-toggle', onclick:toggleSolution}, item.showSolution ? 'Hide correct solution' : 'Show correct solution'));
      if(item.showSolution){
        if(hasInteractiveDeclarations) fb.appendChild(renderCanonicalDeclarationPrelude(item));
        fb.appendChild(renderCanonicalPlayback(item, assignLabelText, assignLabelCh));
      }
    }
    // Feedback now lives in the toggleable feedback drawer (feedback-drawer.js)
    // instead of inline below the action bar — same content/behavior as
    // before, just relocated to cut down on page scrolling. Fully guarded:
    // if feedback-drawer.js isn't loaded (or setFeedbackDrawerContent
    // throws for any reason), fall straight back to the original inline
    // placement so a missing/broken drawer module can never hide the
    // student's result.
    let placedInDrawer = false;
    if(typeof setFeedbackDrawerContent === 'function'){
      try{
        setFeedbackDrawerContent(fb);
        placedInDrawer = true;
      }catch(e){ placedInDrawer = false; }
    }
    if(!placedInDrawer) container.appendChild(fb);

    // Additive hook for the juice/feel module (js/juice.js) — entirely
    // optional. fb must already be attached to the live DOM (true either
    // way above — the drawer's content div is part of the live document
    // once setFeedbackDrawerContent has run) for spawnConfetti's
    // positioning to be accurate. If the script isn't loaded, or it fails
    // for any reason, this is a silent no-op.
    if(typeof renderItemCelebration === 'function'){
      try{
        const celebration = renderItemCelebration(item, fb);
        if(celebration) fb.appendChild(celebration);
      }catch(e){ /* silent no-op */ }
    }

    if(placedInDrawer){
      // Keep the tab visible and its correct/incorrect dot in sync, and
      // auto-open the drawer the FIRST time this item's feedback is shown
      // (mirroring the one-shot behavior isFirstFeedbackShow/
      // _feedbackAnimated already governs for the entrance animation).
      // Later re-renders of the SAME check — e.g. the once-a-second
      // re-renders that happen while the answer-key playback below is
      // auto-advancing — never force it back open if the student closed
      // it; a fresh item (item.checked false again) resets the flag via
      // the branch below, so the NEXT check still auto-opens.
      if(typeof showFeedbackDrawerTab === 'function') showFeedbackDrawerTab();
      if(typeof setFeedbackDrawerStatus === 'function') setFeedbackDrawerStatus(correct);
      if(isFirstFeedbackShow && typeof openFeedbackDrawer === 'function') openFeedbackDrawer();
    }

    if(state.mode==='practice'){
      const bottomBar = h('div',{class:'action-bar'},
        h('div',{class:'btn-group'},
          h('button',{class:'btn', onclick:handleRetrySameItem}, h('i',{class:'fa-solid fa-rotate-right'}), ' Try again')
        )
      );
      container.appendChild(bottomBar);
    }
  } else if(typeof clearFeedbackDrawerContent === 'function'){
    // This item hasn't been checked yet — make sure feedback left over
    // from a PREVIOUS item (or a previous attempt at this one, after
    // Reset/Try again) doesn't linger visible in the drawer. Guarded like
    // every other call into feedback-drawer.js: a missing/broken module
    // here is a silent no-op, never a thrown error.
    try{
      clearFeedbackDrawerContent();
      if(typeof setFeedbackDrawerStatus === 'function') setFeedbackDrawerStatus(null);
      if(typeof hideFeedbackDrawerTab === 'function') hideFeedbackDrawerTab();
      if(typeof isFeedbackDrawerOpen === 'function' && isFeedbackDrawerOpen()
         && typeof closeFeedbackDrawer === 'function') closeFeedbackDrawer();
    }catch(e){ /* no-op */ }
  }
}

// assignLabelText/assignLabelCh are passed in from renderSession (computed
// from this same item's item.resultName) rather than recomputed here, so
// the canonical-playback panel's "=" column lines up with exactly the same
// reserved width the live session panel above it used for this item.
function renderCanonicalPlayback(item, assignLabelText, assignLabelCh){
  const pb = item.playback;
  const total = item.canonicalTrace.steps.length;

  const wrap = h('div',{class:'solution-playback'});
  wrap.appendChild(h('div',{class:'playback-controls'},
    h('button',{class:'btn playback-btn', disabled: pb.index<=0, onclick:()=>playbackStep(-1)}, h('i',{class:'fa-solid fa-backward-step'}), ' Prev'),
    h('button',{class:'btn btn-primary playback-btn', onclick:playbackTogglePlay},
      pb.playing ? h('span',{}, h('i',{class:'fa-solid fa-pause'}), ' Pause') : (pb.index>=total ? h('span',{}, h('i',{class:'fa-solid fa-rotate-right'}), ' Replay') : h('span',{}, h('i',{class:'fa-solid fa-play'}), ' Play'))),
    h('button',{class:'btn playback-btn', disabled: pb.index>=total, onclick:()=>playbackStep(1)}, 'Next ', h('i',{class:'fa-solid fa-forward-step'})),
    h('span',{class:'playback-progress'}, `${pb.index} / ${total} steps`)
  ));

  const timeline = h('div',{class:'timeline solution-timeline'});

  const state0Row = h('div',{class:'tl-row'+(pb.index===0?' current':' done')});
  state0Row.appendChild(h('div',{class:'tl-dot', style:'background:#4b5364;'}));
  const pend0 = pendingNodeId(item.canonicalTrace.steps[0], item.canonicalTrace.treeStates[0]);
  state0Row.appendChild(h('div',{class:'code-out'+(pb.index===0?' row-enter':'')}, renderAssignLabel(true, assignLabelText, assignLabelCh), '= ',
    renderStaticExpr(item.canonicalTrace.treeStates[0], 0, new Map(), null, pend0, stepColor(0)), ';'));
  timeline.appendChild(state0Row);

  // Loop over EVERY step (0..total-1), not just the ones revealed so far.
  // A row for a not-yet-reached step is still built — same markup, same
  // font-size, same height — so the timeline's total height is fixed at its
  // maximum on the very first render of this panel. Only its visibility
  // (via the .tl-future class) changes as pb.index advances; nothing is
  // ever appended afterward, so nothing below this panel has to shift.
  for(let i=0; i<total; i++){
    const revealed = i < pb.index;
    const t = item.canonicalTrace.steps[i];
    const isLast = i === pb.index-1;
    const isFinalStep = i === total-1; // the step that resolves to the single derived value
    const color = stepColor(i);
    const row = h('div',{class:'tl-row'+(isLast?' current':' done')+(revealed?'':' tl-future')});
    row.appendChild(h('div',{class:'tl-dot', style:`background:${color};`+(isLast&&revealed?`box-shadow:0 0 0 4px ${hexToRgba(color,0.25)};`:''), title: revealed ? stepTooltip(t) : null}));
    // Unrevealed rows get no color map / pending preview / flash — they're
    // laid out (for height) but must not visually leak the upcoming value.
    const colorMap = revealed ? buildColorMap(item.canonicalTrace.steps, i+1) : new Map();
    const nextStep = item.canonicalTrace.steps[i+1];
    const pendId = revealed && nextStep ? pendingNodeId(nextStep, item.canonicalTrace.treeStates[i+1]) : null;
    row.appendChild(h('div',{class:'code-out'+(isLast&&revealed?' row-enter':'')}, renderAssignLabel(isFinalStep, assignLabelText, assignLabelCh), '= ',
      renderStaticExpr(item.canonicalTrace.treeStates[i+1], 0, colorMap, isLast&&revealed ? t.resultNodeId : null, pendId, revealed&&nextStep ? stepColor(i+1) : null), ';'));
    timeline.appendChild(row);
  }

  wrap.appendChild(timeline);
  return wrap;
}

// Shared live-expression renderer. Legacy items and declaration initializers
// both pass their expression-shaped runtime into this one implementation, so
// row spacing, LHS reservation, equals alignment, cards, colors, transitions
// and connector lookup attributes cannot drift between profile types.
function renderExpressionEvaluationPanel(options){
  const runtime = options.runtime;
  const labelText = options.labelText || '';
  const labelCh = options.labelCh == null ? labelText.length+1 : options.labelCh;
  const resolved = ()=>!!options.isFullyResolved(runtime);
  const canInteract = options.interactive !== false;
  const equalsNode = ready=>typeof options.renderEquals==='function'
    ? options.renderEquals(ready) : '=';
  const prefixNodes = context=>typeof options.renderPrefix==='function'
    ? options.renderPrefix(context)
    : [renderAssignLabel(context.showLabel,labelText,labelCh),equalsNode(context.ready),' '];
  const trailingActions = context=>typeof options.renderTrailingActions==='function'
    ? options.renderTrailingActions(context) : null;
  const panelAttrs = {class:options.panelClass || 'eval-panel'};
  if(options.statementId) panelAttrs['data-statement-id'] = options.statementId;
  const panel = h('div',panelAttrs);
  panel.appendChild(h('div',{class:'panel-title'},options.title || 'Evaluation'));
  const timeline = h('div',{class:'timeline'});

  const initRow = h('div',{class:'tl-row'+(runtime.trace.length>0?' done':' current')});
  initRow.appendChild(h('div',{class:'tl-dot',style:'background:#4b5364;'}));
  if(runtime.trace.length===0){
    const unresolved = collectUnresolvedFlat(runtime.workingFlat,[]).length>0;
    const ready = canInteract && resolved();
    initRow.appendChild(h('div',{class:'code-out'},renderBadgeSlot(null),
      prefixNodes({showLabel:true,ready,isCurrent:true,isFinalRow:resolved(),activeColor:stepColor(0),
        stepCount:0,pendingStep:null,currentStep:null,flashId:null}),
      canInteract
        ? renderInteractiveFlatExpr(runtime.workingFlat,new Map(),stepColor(0),null,unresolved)
        : renderStaticFlatExpr(runtime.workingFlat,new Map(),null,null),';',
      trailingActions({isCurrent:true,isFinalRow:resolved(),runtime})));
  } else {
    const pending = pendingFlatWithColor(runtime.trace[0],stepColor(0));
    initRow.appendChild(h('div',{class:'code-out'},renderBadgeSlot(null),
      prefixNodes({showLabel:true,ready:false,isCurrent:false,isFinalRow:false,activeColor:stepColor(0),
        stepCount:0,pendingStep:runtime.trace[0],currentStep:null,flashId:null}),
      renderStaticFlatExpr(runtime.originalFlat,new Map(),null,pending),';'));
  }
  timeline.appendChild(initRow);

  runtime.trace.forEach((step,index)=>{
    const isLast = index===runtime.trace.length-1;
    const row = h('div',{class:'tl-row'+(isLast?' current':' done')});
    const color = stepColor(index);
    const tip = stepTooltip(step,options.revealCorrectness);
    row.appendChild(h('div',{class:'tl-dot',style:`background:${color};`+(isLast?`box-shadow:0 0 0 4px ${hexToRgba(color,0.25)};`:''),title:tip}));
    const badge = step.action==='EVALUATE' && options.revealCorrectness
      ? h('span',{class:'step-badge '+(step.wasCorrect?'ok':'warn'),title:tip,'aria-label':tip,role:'img'},
          h('i',{class:'fa-solid '+(step.wasCorrect?'fa-check':'fa-exclamation')})) : null;
    const colors = buildColorMap(runtime.trace,index+1);
    const flashId = step._flashed ? null : step.resultNodeId;
    step._flashed = true;
    const isFinalRow = isLast && resolved();
    if(isLast){
      const unresolved = collectUnresolvedFlat(runtime.workingFlat,[]).length>0;
      const enterClass = step._entered ? '' : ' row-enter';
      step._entered = true;
      row.appendChild(h('div',{class:'code-out'+enterClass},renderBadgeSlot(badge),
        prefixNodes({showLabel:isFinalRow,ready:canInteract&&isFinalRow,isCurrent:true,isFinalRow,
          activeColor:stepColor(runtime.trace.length),stepCount:index+1,pendingStep:null,
          currentStep:step,flashId}),
        canInteract
          ? renderInteractiveFlatExpr(runtime.workingFlat,colors,stepColor(runtime.trace.length),flashId,unresolved)
          : renderStaticFlatExpr(runtime.workingFlat,colors,flashId,null),';',
        trailingActions({isCurrent:true,isFinalRow,runtime})));
    } else {
      const pending = pendingFlatWithColor(runtime.trace[index+1],stepColor(index+1));
      row.appendChild(h('div',{class:'code-out'},renderBadgeSlot(badge),
        prefixNodes({showLabel:false,ready:false,isCurrent:false,isFinalRow:false,activeColor:stepColor(index+1),
          stepCount:index+1,pendingStep:runtime.trace[index+1],currentStep:step,flashId}),
        renderStaticFlatExpr(runtime.history[index+1],colors,flashId,pending),';'));
    }
    timeline.appendChild(row);
  });

  if(typeof options.renderAfterRows==='function') options.renderAfterRows(timeline,{runtime,resolved:resolved()});

  panel.appendChild(timeline);
  return panel;
}

function renderCanonicalDeclarationPrelude(item){
  const wrap = h('div',{class:'canonical-declaration-prelude'});
  wrap.appendChild(h('div',{class:'panel-title'}, 'Correct program sequence'));
  item.program.statements.filter(s=>s.kind==='declaration'||s.kind==='assignment').forEach((statement, index)=>{
    const runtime = statement.runtime;
    const isDeclaration=statement.kind==='declaration';
    const source=isDeclaration
      ? `${declarationKeyword(statement)} ${statement.binding.name} = ${renderString(runtime.originalTree)};`
      : `${statement.target} ${statement.operator} ${renderString(runtime.originalTree)};`;
    const target=isDeclaration?statement.binding.name:statement.target;
    const value=isDeclaration?runtime.expectedValue:runtime.expectedAfter;
    wrap.appendChild(h('div',{class:'canonical-declaration-row'},
      h('span',{class:'canonical-declaration-index'}, String(index+1)),
      h('code',{},source),
      h('span',{class:'canonical-declaration-result'}, `→ ${target} = ${formatValue(value)}`)
    ));
  });
  return wrap;
}

// Program Core owns statement dispatch; this renderer remains the exact
// legacy session renderer for the compatibility statement kind.
registerStatementRenderer('legacy-expression', ({container, program, isActive})=>{
  // A one-statement compatibility item renders exactly as before. In an
  // interactive declaration chain, the final expression stays hidden and
  // inactive until Program Core advances to it.
  if(program.statements.length>1 && !isActive) return;
  renderSession(container);
});
