// ---------------------------------------------------------------------------
// "On-paper" assignment-line layout.
// ----------------------------------------------------------------------------
// A student working an expression out by hand writes the "TYPE varname ="
// left-hand side once, then just "= ..." underneath for every subsequent
// transformation, reading straight down the "=" column rather than
// re-parsing "int result" on every line. We mimic that here: the LHS label
// is shown only on the first evaluation row (the untouched source statement),
// while every derived row reserves the same blank width.
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

// Compatibility helper retained for optional plugins that need a standalone
// source block. Built-in statements now place their authoritative source in
// the first evaluation row and do not call this helper.
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

function programStatementSource(statement,item){
  if(statement.kind==='declaration'){
    return `${declarationKeyword(statement)} ${statement.binding.name} = ${renderString(statement.runtime.originalTree)};`;
  }
  if(statement.kind==='assignment'){
    return `${statement.target} ${statement.operator} ${renderString(statement.runtime.originalTree)};`;
  }
  const expression=renderString(item.originalTree);
  return typeof assignLineString==='function'
    ? assignLineString(expression,item.resultName)
    : `int ${item.resultName||'result'} = ${expression};`;
}

function renderProgramWorkspaceShell(container,item,program){
  container.appendChild(h('div',{class:'session-bar'},
    h('div',{class:'session-meta'},h('b',{},`Item ${state.itemIndex+1}`),` / ${state.items.length}  ·  ${currentProfile().name}`)));
  const workspace=h('section',{class:'program-workspace','aria-label':'Program execution'});
  const progress=h('div',{class:'program-progress-visual',role:'progressbar',
    'aria-label':`Program statement ${Math.min(program.cursor+1,program.statements.length)} of ${program.statements.length}`,
    'aria-valuemin':'1','aria-valuemax':String(program.statements.length),
    'aria-valuenow':String(Math.min(program.cursor+1,program.statements.length))});
  program.statements.forEach((statement,index)=>{
    const status=statement.status==='complete'?'complete':(index===program.cursor?'current':'waiting');
    progress.appendChild(h('span',{class:`program-progress-dot ${status}`,
      title:`Statement ${index+1}: ${status}`,'aria-hidden':'true'}));
  });
  workspace.appendChild(progress);
  const flow=h('div',{class:'program-statement-flow'});
  workspace.appendChild(flow);
  container.appendChild(workspace);
  return flow;
}

function toggleProgramStatementDetails(statement){
  if(!statement || statement.status!=='complete') return;
  const isOpen=!!(statement._uiExpanded||statement._uiJustCompleted);
  statement._uiJustCompleted=false;
  statement._uiExpanded=!isOpen;
  render();
}

function renderProgramStatementSummary(statement,statementIndex,source){
  const complete=statement.status==='complete';
  const timeline=h('div',{class:'timeline program-summary-timeline'});
  const row=h('div',{class:`tl-row program-summary-row ${complete?'done':'waiting'}`});
  row.appendChild(h('div',{class:'tl-dot statement-source-dot',
    title:complete?'Completed statement':'Waiting statement'},String(statementIndex+1)));
  const statusIcon=h('i',{class:`fa-solid ${complete?'fa-circle-check':'fa-lock'} program-summary-status`,
    title:complete?'Completed':'Waiting','aria-label':complete?'Completed statement':'Waiting statement'});
  const action=complete?h('button',{class:'program-summary-toggle',type:'button',
    title:'Show evaluation steps','aria-label':`Show evaluation steps for statement ${statementIndex+1}`,
    onclick:()=>toggleProgramStatementDetails(statement)},
    h('i',{class:'fa-solid fa-chevron-down','aria-hidden':'true'})):null;
  row.appendChild(h('div',{class:'code-out program-summary-code'},statusIcon,
    h('code',{},source),action));
  timeline.appendChild(row);
  return timeline;
}

function renderCollapseStatementAction(statement,statementIndex){
  return h('button',{class:'inline-eval-action program-collapse-action',type:'button',
    title:'Collapse evaluation steps','aria-label':`Collapse statement ${statementIndex+1}`,
    onclick:()=>toggleProgramStatementDetails(statement)},
    h('i',{class:'fa-solid fa-chevron-up','aria-hidden':'true'}));
}

// Guidance stays available without occupying the learning surface. Native
// title handles mouse hover; details provides keyboard and touch disclosure.
function renderContextHelp(text){
  if(!text) return null;
  return h('details',{class:'context-help'},
    h('summary',{title:text,'aria-label':'Show guidance'},
      h('i',{class:'fa-solid fa-circle-info','aria-hidden':'true'})),
    h('div',{class:'context-help-popover'},text));
}

function renderSeededSourceDisclosure(decls){
  if(!Array.isArray(decls)||!decls.length) return null;
  return h('details',{class:'context-help seeded-source-help'},
    h('summary',{title:'Show seeded declarations','aria-label':'Show seeded declarations'},
      h('i',{class:'fa-solid fa-code','aria-hidden':'true'})),
    h('div',{class:'context-help-popover'},...decls.map(decl=>
      h('code',{class:'seeded-source-line'},declLine(decl,state.language)))));
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
  const total = canonicalPlaybackTotal(item);
  if(item.playback.index >= total) item.playback.index = 0;
  item.playback.playing = !item.playback.playing;
  render();
}
function playbackStep(delta){
  const item = currentItem();
  if(!item || !item.playback) return;
  const total = canonicalPlaybackTotal(item);
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
  const embeddedProgram=itemHasInteractiveProgram(item)&&item.program.statements.length>1;

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
  if(!embeddedProgram){
    container.appendChild(h('div',{class:'session-bar'},
      h('div',{class:'session-meta'}, h('b',{}, `Item ${state.itemIndex+1}`), ` / ${state.items.length}  ·  ${profile.name}`)
    ));
  }
  const hasInteractiveDeclarations = itemHasInteractiveProgram(item);
  let evaluationHost=container;
  if(embeddedProgram){
    evaluationHost=h('section',{class:'program-statement legacy-program-statement active expanded',
      'data-statement-id':'expression'});
    container.appendChild(evaluationHost);
  }
  if(!hasInteractiveDeclarations){
    const seededSource=renderSeededSourceDisclosure(item.decls);
    if(seededSource) evaluationHost.appendChild(seededSource);
  }

  // The same renderer is used by declaration initializers; this invocation
  // preserves the legacy item as the reference behavior.
  const evalPanel = renderExpressionEvaluationPanel({
    runtime:item,
    labelText:assignLabelText,
    labelCh:assignLabelCh,
    title:embeddedProgram?null:'Evaluation',
    panelClass:'eval-panel'+(embeddedProgram?' program-expression-panel final-expression-panel':''),
    statementId:embeddedProgram?'expression':null,
    statementNumber:embeddedProgram?item.program.cursor+1:null,
    continuationStyle:true,
    interactive:true,
    revealCorrectness:item.checked,
    isFullyResolved:()=>itemFullyResolved(item),
    renderTrailingActions:()=>renderInlineEvaluationActions({
      canUndo:!item.checked&&canUndoProgram(item),
      canCheck:!item.checked&&itemFullyResolved(item)
    })
  });
  evaluationHost.appendChild(evalPanel);
  const canReset = state.mode==='practice' && !item.checked && (
    item.trace.length>0 || (item.program && item.program.cursor>0));
  const resetControl=renderItemResetControl(canReset);
  if(resetControl) evaluationHost.appendChild(resetControl);

  if(!itemFullyResolved(item) && !item.checked){
    const unresolvedCount = collectUnresolvedFlat(item.workingFlat,[]).length;
    if(unresolvedCount>0){
      evaluationHost.appendChild(renderContextHelp(`Resolve ${unresolvedCount} more highlighted token${unresolvedCount>1?'s':''} (variable, constant, or unary) before operators become active.`));
    } else {
      evaluationHost.appendChild(renderContextHelp('Tap any highlighted operator to evaluate it — you choose the order. Wrong order is allowed; you\'ll see how it plays out.'));
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
        fb.appendChild(hasInteractiveDeclarations
          ? renderCanonicalProgramPlayback(item, assignLabelText, assignLabelCh)
          : renderCanonicalPlayback(item, assignLabelText, assignLabelCh));
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
function renderPlaybackControls(item,total){
  const pb=item.playback;
  return h('div',{class:'playback-controls'},
    h('button',{class:'btn playback-btn', disabled:pb.index<=0, onclick:()=>playbackStep(-1)}, h('i',{class:'fa-solid fa-backward-step'}), ' Prev'),
    h('button',{class:'btn btn-primary playback-btn', onclick:playbackTogglePlay},
      pb.playing ? h('span',{}, h('i',{class:'fa-solid fa-pause'}), ' Pause') : (pb.index>=total ? h('span',{}, h('i',{class:'fa-solid fa-rotate-right'}), ' Replay') : h('span',{}, h('i',{class:'fa-solid fa-play'}), ' Play'))),
    h('button',{class:'btn playback-btn', disabled:pb.index>=total, onclick:()=>playbackStep(1)}, 'Next ', h('i',{class:'fa-solid fa-forward-step'})),
    h('span',{class:'playback-progress'}, `${pb.index} / ${total} steps`));
}

function renderCanonicalPlayback(item, assignLabelText, assignLabelCh, options){
  options=options||{};
  const pb = options.playback || item.playback;
  const total = item.canonicalTrace.steps.length;

  const wrap = h('div',{class:'solution-playback'+(options.embedded?' canonical-final-playback':''),
    'data-canonical-visible':pb.index});
  if(!options.hideControls) wrap.appendChild(renderPlaybackControls(item,total));

  const timeline = h('div',{class:'timeline solution-timeline'});

  const state0Row = h('div',{class:'tl-row'+(pb.index===0?' current':' done')});
  state0Row.appendChild(h('div',{class:'tl-dot', style:'background:#4b5364;'}));
  const pend0 = pendingNodeId(item.canonicalTrace.steps[0], item.canonicalTrace.treeStates[0]);
  state0Row.appendChild(h('div',{class:'code-out'+(pb.index===0?' row-enter':'')}, renderAssignLabel(true, assignLabelText, assignLabelCh),
    h('span',{class:'source-assignment-equals',title:'Assignment operator'},'='),' ',
    renderStaticExpr(item.canonicalTrace.treeStates[0], 0, new Map(), null, pend0,
      stepVisualColor(item.canonicalTrace.steps[0],0)), ';'));
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
    const color = stepVisualColor(t,i);
    const row = h('div',{class:'tl-row'+(isLast?' current':' done')+(revealed?'':' tl-future')});
    row.appendChild(h('div',{class:'tl-dot', style:`background:${color};`+(isLast&&revealed?`box-shadow:0 0 0 4px ${hexToRgba(color,0.25)};`:''), title: revealed ? stepTooltip(t) : null}));
    // Unrevealed rows get no color map / pending preview / flash — they're
    // laid out (for height) but must not visually leak the upcoming value.
    const colorMap = revealed ? buildColorMap(item.canonicalTrace.steps, i+1) : new Map();
    const nextStep = item.canonicalTrace.steps[i+1];
    const pendId = revealed && nextStep ? pendingNodeId(nextStep, item.canonicalTrace.treeStates[i+1]) : null;
    row.appendChild(h('div',{class:'code-out'+(isLast&&revealed?' row-enter':'')}, renderAssignLabel(false, assignLabelText, assignLabelCh),
      h('span',{class:'continuation-equals',title:'Equivalent evaluation step'},'='),' ',
      renderStaticExpr(item.canonicalTrace.treeStates[i+1], 0, colorMap, isLast&&revealed ? t.resultNodeId : null, pendId,
        revealed&&nextStep ? stepVisualColor(nextStep,i+1) : null)));
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
    : [renderAssignLabel(context.showLabel,labelText,labelCh),
      h('span',{class:context.isSource?'source-assignment-equals':'continuation-equals',
        title:context.isSource?'Assignment operator':'Equivalent evaluation step'},equalsNode(context.ready)),' '];
  const terminator = context=>options.continuationStyle
    ? (context.isSource?';':'') : ';';
  const trailingActions = context=>typeof options.renderTrailingActions==='function'
    ? options.renderTrailingActions(context) : null;
  const panelAttrs = {class:(options.panelClass || 'eval-panel')+' expression-scroll-surface'};
  if(options.statementId) panelAttrs['data-statement-id'] = options.statementId;
  const panel = h('div',panelAttrs);
  if(options.title!==null) panel.appendChild(h('div',{class:'panel-title'},options.title || 'Evaluation'));
  if(options.beforeTimeline) panel.appendChild(options.beforeTimeline);
  const timeline = h('div',{class:'timeline expression-timeline'});

  const initRow = h('div',{class:'tl-row source-row'+(runtime.trace.length>0||options.rowsComplete?' done':' current')});
  initRow.appendChild(h('div',{class:'tl-dot'+(options.statementNumber?' statement-source-dot':''),
    style:'background:#4b5364;',title:'Original statement'},options.statementNumber?String(options.statementNumber):null));
  if(runtime.trace.length===0){
    const unresolved = collectUnresolvedFlat(runtime.workingFlat,[]).length>0;
    const ready = canInteract && resolved();
    initRow.appendChild(h('div',{class:'code-out'},renderBadgeSlot(null),
      prefixNodes({showLabel:true,isSource:true,ready,isCurrent:true,isFinalRow:resolved(),activeColor:stepColor(0),
        stepCount:0,pendingStep:null,currentStep:null,flashId:null}),
      canInteract
        ? renderInteractiveFlatExpr(runtime.workingFlat,new Map(),stepColor(0),null,unresolved)
        : renderStaticFlatExpr(runtime.workingFlat,new Map(),null,null),terminator({isSource:true}),
      trailingActions({isCurrent:true,isFinalRow:resolved(),runtime})));
  } else {
    const firstColor = stepVisualColor(runtime.trace[0],0);
    const pending = pendingFlatWithColor(runtime.trace[0],firstColor);
    initRow.appendChild(h('div',{class:'code-out'},renderBadgeSlot(null),
      prefixNodes({showLabel:true,isSource:true,ready:false,isCurrent:false,isFinalRow:false,activeColor:firstColor,
        stepCount:0,pendingStep:runtime.trace[0],currentStep:null,flashId:null}),
      renderStaticFlatExpr(runtime.originalFlat,new Map(),null,pending),terminator({isSource:true})));
  }
  timeline.appendChild(initRow);

  runtime.trace.forEach((step,index)=>{
    const isLast = index===runtime.trace.length-1;
    const isCurrent=isLast&&!options.rowsComplete;
    const row = h('div',{class:'tl-row'+(isCurrent?' current':' done')});
    const color = stepVisualColor(step,index);
    const tip = stepTooltip(step,options.revealCorrectness);
    row.appendChild(h('div',{class:'tl-dot',style:`background:${color};`+(isCurrent?`box-shadow:0 0 0 4px ${hexToRgba(color,0.25)};`:''),title:tip}));
    const badge = step.action==='EVALUATE' && options.revealCorrectness
      ? h('span',{class:'step-badge '+(step.wasCorrect?'ok':'warn'),title:tip,'aria-label':tip,role:'img'},
          h('i',{class:'fa-solid '+(step.wasCorrect?'fa-check':'fa-exclamation')})) : null;
    const colors = buildColorMap(runtime.trace,index+1);
    const flashId = step._flashed || !isCurrent ? null : step.resultNodeId;
    step._flashed = true;
    const isFinalRow = isLast && resolved();
    if(isLast){
      const unresolved = collectUnresolvedFlat(runtime.workingFlat,[]).length>0;
      const enterClass = step._entered || !isCurrent ? '' : ' row-enter';
      step._entered = true;
      row.appendChild(h('div',{class:'code-out'+enterClass},renderBadgeSlot(badge),
        prefixNodes({showLabel:false,isSource:false,ready:canInteract&&isFinalRow,isCurrent:true,isFinalRow,
          activeColor:stepColor(runtime.trace.length),stepCount:index+1,pendingStep:null,
          currentStep:step,flashId}),
        canInteract
          ? renderInteractiveFlatExpr(runtime.workingFlat,colors,stepColor(runtime.trace.length),flashId,unresolved)
          : renderStaticFlatExpr(runtime.workingFlat,colors,flashId,null),terminator({isSource:false,isFinalRow}),
        trailingActions({isCurrent:true,isFinalRow,runtime})));
    } else {
      const nextStep = runtime.trace[index+1];
      const nextColor = stepVisualColor(nextStep,index+1);
      const pending = pendingFlatWithColor(nextStep,nextColor);
      row.appendChild(h('div',{class:'code-out'},renderBadgeSlot(badge),
        prefixNodes({showLabel:false,isSource:false,ready:false,isCurrent:false,isFinalRow:false,activeColor:nextColor,
          stepCount:index+1,pendingStep:nextStep,currentStep:step,flashId}),
        renderStaticFlatExpr(runtime.history[index+1],colors,flashId,pending),terminator({isSource:false,isFinalRow:false})));
    }
    timeline.appendChild(row);
  });

  if(typeof options.renderAfterRows==='function') options.renderAfterRows(timeline,{runtime,resolved:resolved()});

  panel.appendChild(timeline);
  return panel;
}

function canonicalProgramSegments(item){
  if(!itemHasInteractiveProgram(item)) return [];
  const segments=[];
  item.program.statements.forEach((statement,index)=>{
    if(statement.kind==='declaration'||statement.kind==='assignment'){
      const expressionSteps=(statement.runtime&&statement.runtime.canonicalTrace
        ? statement.runtime.canonicalTrace.steps.length : 0);
      const targetRead=statement.kind==='assignment'&&isCompoundAssignment(statement)?1:0;
      segments.push({kind:'statement',statement,index,targetRead,expressionSteps,
        length:targetRead+expressionSteps+1});
    } else if(statement.kind==='legacy-expression'){
      segments.push({kind:'final',statement,index,length:item.canonicalTrace.steps.length});
    }
  });
  let start=0;
  segments.forEach((segment,index)=>{
    segment.start=start;
    start+=segment.length+(index<segments.length-1?1:0);
  });
  return segments;
}

function canonicalPlaybackTotal(item){
  const segments=canonicalProgramSegments(item);
  return segments.length ? segments[segments.length-1].start+segments[segments.length-1].length
    : (item&&item.canonicalTrace ? item.canonicalTrace.steps.length : 0);
}

function canonicalStatementRuntime(statement,localIndex){
  const source=statement.runtime;
  const compound=statement.kind==='assignment'&&isCompoundAssignment(statement);
  const readVisible=compound&&localIndex>0;
  const expressionVisible=Math.max(0,Math.min(source.canonicalTrace.steps.length,
    localIndex-(compound?1:0)));
  const flats=source.canonicalTrace.treeStates.map(tree=>flattenInstance(tree));
  const trace=[];
  const history=[deepCloneFlat(flats[0])];
  if(readVisible){
    trace.push({action:'READ_TARGET',target:statement.target,targetKind:'variable',
      sourceValue:source.expectedBefore,resultNodeId:assignmentTargetTokenId(statement),
      expressionBefore:flatToString(flats[0]),expressionAfter:flatToString(flats[0])});
    history.push(deepCloneFlat(flats[0]));
  }
  for(let i=0;i<expressionVisible;i++){
    trace.push(source.canonicalTrace.steps[i]);
    history.push(deepCloneFlat(flats[i+1]));
  }
  return Object.assign({},source,{
    originalFlat:deepCloneFlat(flats[0]),workingFlat:deepCloneFlat(flats[expressionVisible]),
    history,trace,targetRevealed:readVisible,targetReadValue:source.expectedBefore,
    checked:false,assignmentMergePending:false
  });
}

function canonicalAssignmentPrefix(statement,context){
  if(isCompoundAssignment(statement)) return renderCompoundAssignmentPrefix(statement,context,false);
  return [renderAssignLabel(context.showLabel,statement.target,statement.target.length+1),
    h('span',{class:context.isSource?'source-assignment-equals':'continuation-equals',
      'data-assignment-op-id':statement.id,title:'Assignment operator'},'='),' '];
}

function canonicalDeclarationPrefix(statement,labelText,labelCh,context){
  return [renderAssignLabel(context.showLabel,labelText,labelCh),
    h('span',{class:context.isSource?'source-assignment-equals':'continuation-equals',
      'data-assignment-op-id':statement.id,title:'Assignment operator'},'='),' '];
}

function appendCanonicalAssignmentResult(timeline,statement,runtime,isCurrent){
  if(statement.kind==='assignment'&&isCompoundAssignment(statement)){
    const completeStatement=Object.assign({},statement,{runtime:Object.assign({},runtime,{
      checked:true,beforeValue:runtime.expectedBefore,rhsValue:runtime.expectedRhs,
      assignedValue:runtime.expectedAfter,assignmentResultNodeId:assignmentResultTokenId(statement),
      assignmentMergePending:false
    })});
    appendCompoundAssignmentResult(timeline,completeStatement,{historical:!isCurrent});
    return;
  }
  const target=statement.kind==='declaration'?statement.binding.name:statement.target;
  const kind=statement.kind==='declaration'?statement.binding.kind:'variable';
  const value=statement.kind==='declaration'?runtime.expectedValue:runtime.expectedAfter;
  const resultId=`canonical-assignment-result-${statement.id}`;
  const color=stepVisualColor({action:'APPLY_ASSIGNMENT'},runtime.canonicalTrace.steps.length);
  const row=h('div',{class:`tl-row ${isCurrent?'current':'done'} canonical-assignment-result-row`});
  row.appendChild(h('div',{class:'tl-dot',style:`background:${color};${isCurrent?`box-shadow:0 0 0 4px ${hexToRgba(color,0.25)};`:''}`,
    title:`${target} now stores ${formatValue(value)}`}));
  const result=renderValueCard({id:resultId,name:target,value,kind,color,isFlash:isCurrent});
  row.appendChild(h('div',{class:'code-out'+(isCurrent?' row-enter':'')},renderBadgeSlot(null),result));
  timeline.appendChild(row);
}

function renderCanonicalStatementSegment(segment,localIndex,globalIndex){
  const statement=segment.statement;
  const sourceRuntime=statement.runtime;
  const runtime=canonicalStatementRuntime(statement,localIndex);
  const commitVisible=localIndex>=segment.length;
  const commitCurrent=commitVisible&&globalIndex===segment.start+segment.length;
  const labelText=statement.kind==='declaration'
    ? `${declarationKeyword(statement)} ${statement.binding.name}` : statement.target;
  const viewStatement=Object.assign({},statement,{runtime});
  const card=h('section',{class:`canonical-program-statement ${statement.kind}-statement`,
    'data-canonical-statement-id':statement.id});
  card.appendChild(renderExpressionEvaluationPanel({runtime,labelText,labelCh:labelText.length+1,
    title:null,panelClass:'canonical-program-expression-panel',statementId:statement.id,
    statementNumber:segment.index+1,continuationStyle:true,interactive:false,
    rowsComplete:commitVisible,
    isFullyResolved:()=>false,
    renderPrefix:statement.kind==='declaration'
      ? (context=>canonicalDeclarationPrefix(statement,labelText,labelText.length+1,context))
      : (context=>canonicalAssignmentPrefix(viewStatement,context)),
    renderAfterRows:commitVisible?(timeline=>appendCanonicalAssignmentResult(timeline,statement,sourceRuntime,commitCurrent)):null}));
  return card;
}

function renderCanonicalProgramPlayback(item,assignLabelText,assignLabelCh){
  const segments=canonicalProgramSegments(item);
  const total=canonicalPlaybackTotal(item);
  const wrap=h('div',{class:'canonical-program-playback'});
  wrap.appendChild(renderPlaybackControls(item,total));
  wrap.appendChild(h('div',{class:'panel-title'},'Correct program sequence'));
  segments.forEach(segment=>{
    if(item.playback.index<segment.start) return;
    const localIndex=Math.min(segment.length,item.playback.index-segment.start);
    if(segment.kind==='statement') wrap.appendChild(renderCanonicalStatementSegment(segment,localIndex,item.playback.index));
    else wrap.appendChild(renderCanonicalPlayback(item,assignLabelText,assignLabelCh,{
      playback:{index:localIndex,playing:item.playback.playing},hideControls:true,embedded:true}));
  });
  return wrap;
}

// Program Core owns statement dispatch; this renderer remains the exact
// legacy session renderer for the compatibility statement kind.
registerStatementRenderer('legacy-expression', ({container,item,program,statement,statementIndex,isActive})=>{
  // A one-statement compatibility item renders exactly as before. In an
  // interactive program, the final expression remains visible as a compact
  // waiting line until Program Core advances to it.
  if(program.statements.length>1 && !isActive){
    const card=h('section',{class:`program-statement legacy-program-statement ${statement.status}`,
      'data-statement-id':statement.id});
    card.appendChild(renderProgramStatementSummary(statement,statementIndex,
      programStatementSource(statement,item)));
    container.appendChild(card);
    return;
  }
  renderSession(container);
});
