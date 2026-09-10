// ============================================================================
// UI STATE + RENDERING
// ============================================================================
const state = {
  screen: 'login', // login | setup | session | done
  userEmail: null,
  userStudentId: null,
  language: 'c',
  mode: 'practice',
  profileId: PROFILES[0].id,
  itemIndex: 0,
  itemIndexByProfile: {}, // Remembers which item each profile was last viewing, so switching profiles via the sidebar returns to that exact item instead of resetting to Item 1
  showConnectors: true, // whether the operator→result connector line (connector-lines.js) is drawn
  items: [], // {originalTree, originalFlat, decls, correctFinalValue, canonicalTrace, workingFlat, history:[], trace:[], checked, itemScore, revealSolution}
  itemsByProfile: {}, // Stores all generated items per profile for persistence
  sessionSeed: null, // Seed used for reproducible item generation
  practicePolicy: null, // immutable snapshot of practice settings captured when a session starts
  examPolicy: null, // immutable snapshot of exam settings captured when an attempt starts
  examTimerMinutes: null,
  examSubmitted: false,
  examSubmittedAt: null
};

// ============================================================================
// APP SETTINGS
// ============================================================================
// Global settings configured during login (via settings modal).
// These apply to the entire session and cannot be changed during the session.
//  - mode: 'practice' or 'exam' (set once at login)
//  - timerMinutes: duration for exam mode (set once at login)
// ============================================================================
const DEFAULT_APP_SETTINGS = Object.freeze({
  schemaVersion: 5,
  // local-configurable | state-only. This deployment switch is intentionally
  // read only: persisted browser data can never override it.
  settingsPolicy: 'local-configurable',
  mode: 'practice',
  timerMinutes: 15,
  practice: Object.freeze({
    interactionMode: 'guided', // guided | strict-sequence
    manualResponses:Object.freeze({mode:'profile',namedValueRate:50,operatorRate:50})
  }),
  exam: Object.freeze({
    interactionMode: 'guided', // guided | strict-sequence
    allowUndo: true,
    allowReviewFlags: true,
    showNeutralGuidance: false,
    showScoresDuringExam: false,
    feedbackRelease: 'after-submit', // after-submit | never
    lockItemAfterCheck: true,
    autoSubmitOnTimeout: true,
    showCorrectSolution: false
    ,manualResponses:Object.freeze({mode:'profile',namedValueRate:50,operatorRate:50})
  })
});

function cloneDefaultAppSettings(){
  return {
    schemaVersion:DEFAULT_APP_SETTINGS.schemaVersion,
    settingsPolicy:DEFAULT_APP_SETTINGS.settingsPolicy,
    mode:DEFAULT_APP_SETTINGS.mode,
    timerMinutes:DEFAULT_APP_SETTINGS.timerMinutes,
    practice:Object.assign({},DEFAULT_APP_SETTINGS.practice,{manualResponses:Object.assign({},DEFAULT_APP_SETTINGS.practice.manualResponses)}),
    exam:Object.assign({},DEFAULT_APP_SETTINGS.exam,{manualResponses:Object.assign({},DEFAULT_APP_SETTINGS.exam.manualResponses)})
  };
}

function settingsAreStateOnly(){
  return DEFAULT_APP_SETTINGS.settingsPolicy==='state-only';
}

function snapshotPracticePolicy(settings){
  const source=(settings&&settings.practice)||{};
  return Object.assign({},DEFAULT_APP_SETTINGS.practice,source,{manualResponses:Object.assign({},DEFAULT_APP_SETTINGS.practice.manualResponses,source.manualResponses||{})});
}

let appSettings = cloneDefaultAppSettings();

function snapshotExamPolicy(settings){
  const source=(settings&&settings.exam)||{};
  return Object.assign({},DEFAULT_APP_SETTINGS.exam,source, {
    // Correct-solution disclosure is never a configurable exam behavior.
    showCorrectSolution:false,
    lockItemAfterCheck:true,
    autoSubmitOnTimeout:true,
    manualResponses:Object.assign({},DEFAULT_APP_SETTINGS.exam.manualResponses,source.manualResponses||{})
  });
}

function activeExamPolicy(){
  return state.examPolicy || snapshotExamPolicy(appSettings);
}

function activePracticePolicy(){
  return state.practicePolicy || snapshotPracticePolicy(appSettings);
}

function examAllowsUndo(){
  return state.mode!=='exam' || (!state.examSubmitted && activeExamPolicy().allowUndo);
}

function strictSequenceEnabled(){
  if(state.mode==='practice') return activePracticePolicy().interactionMode==='strict-sequence';
  return state.mode==='exam' && !state.examSubmitted
    && activeExamPolicy().interactionMode==='strict-sequence';
}

// Compatibility name retained for optional modules authored against the
// first exam-only version of this policy.
function strictExamSequenceEnabled(){
  return state.mode==='exam' && strictSequenceEnabled();
}

function examResultsVisible(){
  if(state.mode!=='exam') return true;
  return state.examSubmitted
    ? activeExamPolicy().feedbackRelease==='after-submit'
    : activeExamPolicy().showScoresDuringExam;
}

function canUndoForCurrentMode(item){
  if(!item||item.checked||!examAllowsUndo()) return false;
  if(state.mode==='practice'&&item.practiceInvalidExecution) return true;
  if(state.mode!=='exam') return canUndoProgram(item);
  const statement=currentProgramStatement(item);
  const plugin=statementPluginFor(statement);
  return !!(plugin&&typeof plugin.canUndo==='function'
    &&plugin.canUndo({program:item.program,statement,item}));
}

// ============================================================================
// TIMER STATE — Session-level countdown for exam mode
// ============================================================================
// Timer runs for the entire exam session across all items.
// Starts when startSession() is called (in exam mode) and continues until
// the session ends or time runs out.
// ============================================================================
let timerIntervalId = null;
let timeRemaining = 0; // in seconds
let examEndTimestamp = null;

function currentProfile(){ return PROFILES.find(p=>p.id===state.profileId); }
function currentItem(){ return state.items[state.itemIndex]; }

function generateItemsForProfile(profileId) {
  const profile = PROFILES.find(p => p.id === profileId);
  if (!profile) return [];
  
  const items = [];
  for(let i = 0; i < profile.itemCount; i++) {
    const inst = generateInstance(profile);
    const flat0 = flattenInstance(inst.tree);
    const item = {
      profileId: profile.id, // which profile generated this item — scoreItem()/handleCheck() use this to look up that profile's own pointsPerItem, rather than a single global point budget shared by every profile
      originalTree: inst.tree,
      originalFlat: flat0,
      decls: inst.decls,
      resultName: inst.resultName, // per-item randomly (seeded) chosen name for the "int ___ = ...;" assignment target — see generator.js's RESULT_NAMES/pickResultName. Replaces the old hardcoded literal "result".
      correctFinalValue: inst.correctFinalValue,
      canonicalTrace: inst.canonicalTrace,
      workingFlat: deepCloneFlat(flat0),
      history: [deepCloneFlat(flat0)],
      trace: [],
      checked: false,
      itemScore: null,
      points: null,
      maxPoints: null,
      correctSteps: 0,
      totalOpSteps: 0,
      wasCorrectFinal: null,
      showSolution: false,
      playback: null,
      flagged: false,
      lockedAt: null,
      examOmitted: false,
      examActionLog: [],
      examSequenceFailure: null,
      practiceInvalidExecution: null,
      _bindings: null // lazily built by var-final-state.js (ensureBindings)
    };
    buildGeneratedProgram(item, profile);
    items.push(item);
  }
  if(typeof assignManualResponsePlans==='function') assignManualResponsePlans(profile,items);
  return items;
}

function startSession(){
  // A fresh login is a fresh attempt. Resumed exams bypass this function and
  // restore their saved seed, so reload/logout-login still reproduces exactly
  // the same items while a different student never inherits an in-memory seed.
  state.sessionSeed = Date.now() >>> 0;
  
  // Initialize seeded random generator
  initializeSeededRandom(state.sessionSeed);
  
  // Apply settings mode
  state.mode = appSettings.mode;
  state.practicePolicy = state.mode==='practice' ? snapshotPracticePolicy(appSettings) : null;
  state.examPolicy = state.mode==='exam' ? snapshotExamPolicy(appSettings) : null;
  state.examTimerMinutes = state.mode==='exam' ? appSettings.timerMinutes : null;
  state.examSubmitted = false;
  state.examSubmittedAt = null;
  state.itemIndexByProfile = {};
  
  // Generate items for ALL profiles once using the seed
  state.itemsByProfile = {};
  PROFILES.forEach(profile => {
    state.itemsByProfile[profile.id] = generateItemsForProfile(profile.id);
  });
  
  // Set current profile's items
  state.items = state.itemsByProfile[state.profileId];
  state.itemIndex = 0;
  
  // Reset to non-seeded random for other operations
  resetRandomGenerator();
  
  // Reset pagination handler so it gets reattached
  itemPaginationHandlerAttached = false;
  
  state.screen = 'session';
  render();
  
  // Start timer if exam mode
  if (appSettings.mode === 'exam') {
    startTimer();
  }
}

function itemFullyResolved(item){
  return item.workingFlat.operands.length===1 && isFlatOperandReady(item.workingFlat.operands[0]);
}

// action is {type:'substitute', id}, {type:'evaluate', leftId, rightId}, or
// the assignment plugin's {type:'reveal-assignment-target'} command.
// Any ready operator anywhere in the expression (not just a single
// "correct next" one) can be clicked — see the FLAT model comment above.
function handleTokenClick(action){
  const item = currentItem();
  if(!item || item.checked || state.examSubmitted || item.practiceInvalidExecution) return;
  const statement=currentProgramStatement(item);
  const runtime=statement&&statement.kind==='legacy-expression'?item:(statement&&statement.runtime);
  if(!action.manualResponse&&typeof manualResponseDescriptor==='function'){
    const descriptor=manualResponseDescriptor(item,statement,runtime,action);
    if(descriptor){
      requestManualResponse(descriptor,response=>handleTokenClick(Object.assign({},action,{manualResponse:response})));
      return;
    }
  }
  const applyAction = ()=>{
    const traceLength=runtime&&runtime.trace?runtime.trace.length:0;
    const result = dispatchProgramAction(item, action, {applyExpressionAction});
    if(result.applied){
      const producedStep=runtime&&runtime.trace&&runtime.trace.length>traceLength
        ? runtime.trace[runtime.trace.length-1] : null;
      const event=result.event||null;
      const scoredAction=!!((producedStep&&producedStep.action==='EVALUATE')
        ||(event&&event.action==='ASSIGN'));
      const actionWasCorrect=producedStep&&producedStep.action==='EVALUATE'
        ? producedStep.wasCorrect : (event&&event.action==='ASSIGN'?event.wasCorrect:undefined);
      recordExamAction(item,action,{
        statementId:statement&&statement.id,
        wasCorrect:actionWasCorrect,
        scoredAction:scoredAction||!!action.manualResponse,
        creditEligible:actionWasCorrect!==false,
        value:event&&event.value,
        manualResponseValue:action.manualResponse&&action.manualResponse.value,
        manualExpectedValue:action.manualResponse&&action.manualResponse.expectedValue,
        manualWasCorrect:action.manualResponse&&action.manualResponse.wasCorrect,
        manualResponseKey:action.manualResponse&&action.manualResponse.key
      });
      render();
    } else if(strictSequenceEnabled()){
      const reason=strictSequenceInvalidAttemptReason(item,statement,runtime,action);
      if(reason){
        if(state.mode==='exam') terminateStrictExamItem(item,action,reason,statement);
        else pauseStrictPracticeItem(item,action,reason,statement);
      }
    }
    return !!result.applied;
  };

  const commitAction = ()=>{
    // When the optional memory animation is enabled, substitution remains a
    // two-phase action. It now starts only after the empty stage is on-screen.
    if(action && (action.type==='substitute'||action.type==='reveal-assignment-target')
      && !action.manualResponse && typeof animateVarFinalMemoryToExpression==='function'
      && animateVarFinalMemoryToExpression(item,action,applyAction)) return;
    applyAction();
  };

  // Every visible evaluation step first reserves and scrolls to an empty
  // stage. With animations disabled the same ordering is preserved; only the
  // subsequent value flight/merge is skipped by its existing feature toggle.
  if(typeof prepareLiveStepStage==='function'
    && prepareLiveStepStage(item,action,commitAction)) return;
  commitAction();
}

function examCurrentCorrectScoredChecks(item){
  let correct=Array.isArray(item.trace)
    ? item.trace.filter(step=>step.action==='EVALUATE'&&step.wasCorrect===true).length : 0;
  if(item.program&&item.program.scoreAssignments){
    item.program.statements.forEach(statement=>{
      const plugin=statementPluginFor(statement);
      if(!plugin||!plugin.scoresCommit||!statement.runtime) return;
      correct+=statement.runtime.trace.filter(step=>step.action==='EVALUATE'&&step.wasCorrect===true).length;
      if(statement.runtime.checked&&statement.runtime.wasCorrectAssignment===true) correct++;
    });
  }
  if(typeof manualResponseFacts==='function') correct+=manualResponseFacts(item).correct;
  return correct;
}

function examCanonicalScoredCheckCount(item){
  let total=1; // final derived-value check
  const finalSteps=item&&item.canonicalTrace&&Array.isArray(item.canonicalTrace.steps)
    ? item.canonicalTrace.steps : [];
  total+=finalSteps.filter(step=>step.action==='EVALUATE').length;
  if(item&&item.program&&item.program.scoreAssignments){
    item.program.statements.forEach(statement=>{
      const plugin=statementPluginFor(statement);
      if(!plugin||!plugin.scoresCommit||!statement.runtime) return;
      const canonical=statement.runtime.canonicalTrace&&Array.isArray(statement.runtime.canonicalTrace.steps)
        ? statement.runtime.canonicalTrace.steps : [];
      total+=canonical.filter(step=>step.action==='EVALUATE').length+1;
    });
  }
  if(typeof plannedManualScoredCheckCount==='function') total+=plannedManualScoredCheckCount(item);
  return Math.max(1,total);
}

function strictExamFailurePoints(item){
  const profile=PROFILES.find(candidate=>candidate.id===item.profileId)||currentProfile();
  const maximum=profile?profile.pointsPerItem:0;
  const failure=item.examSequenceFailure;
  const correct=failure?failure.correctPrefixChecks:0;
  const total=failure?failure.totalChecks:examCanonicalScoredCheckCount(item);
  return {points:roundPoints(total>0?maximum*(correct/total):0),maxPoints:maximum};
}

function markStrictExamSequenceFailure(item,action,reason,terminal,detail){
  if(!strictExamSequenceEnabled()||!item||item.examSequenceFailure) return false;
  item.examSequenceFailure=Object.assign({
    reason,terminal:!!terminal,timestamp:Date.now(),
    attemptedAction:action&&action.type?action.type:String(action),
    correctPrefixChecks:examCurrentCorrectScoredChecks(item),
    totalChecks:examCanonicalScoredCheckCount(item)
  },detail||{});
  return true;
}

function strictSequenceInvalidAttemptReason(item,statement,runtime,action){
  if(!item||!statement||!runtime||!action) return null;
  if(action.type==='evaluate'){
    const flat=runtime.workingFlat;
    if(!flat) return null;
    for(let i=0;i<flat.operators.length;i++){
      const left=flat.operands[i],right=flat.operands[i+1];
      if(left.id!==action.leftId||right.id!==action.rightId) continue;
      if(!isFlatOperandReady(left)||!isFlatOperandReady(right)) return 'operands-unresolved';
      if((flat.operators[i]==='/'||flat.operators[i]==='%')&&flatOperandValue(right)===0) return 'division-by-zero';
      return null;
    }
    return null;
  }
  if(action.type==='apply-unary'){
    const node=findFlatOperandById(runtime.workingFlat,action.id);
    return node&&node.kind==='unary'&&!node.substituted?'unary-operand-unresolved':null;
  }
  return typeof classifyRejectedProgramAction==='function'
    ? classifyRejectedProgramAction(item,action) : null;
}

function pauseStrictPracticeItem(item,action,reason,statement){
  if(!item||item.practiceInvalidExecution) return false;
  item.practiceInvalidExecution={
    reason,
    timestamp:Date.now(),
    attemptedAction:action&&action.type?action.type:String(action),
    statementId:statement&&statement.id,
    recoverable:true
  };
  render();
  if(typeof bringInvalidExecutionAlertIntoView==='function') bringInvalidExecutionAlertIntoView();
  return true;
}

function terminateStrictExamItem(item,action,reason,statement){
  if(!markStrictExamSequenceFailure(item,action,reason,true,{statementId:statement&&statement.id})) return false;
  if(item.program&&Array.isArray(item.program.statements)){
    item.program.status='terminated';
    item.program.statements.forEach((candidate,index)=>{
      if(index===item.program.cursor) candidate.status='invalid';
      else if(index>item.program.cursor) candidate.status='blocked';
    });
  }
  const score=strictExamFailurePoints(item);
  item.checked=true;
  item.lockedAt=Date.now();
  item.flagged=false;
  item.showSolution=false;
  item.playback=null;
  item.studentFinal=null;
  item.correctSteps=item.examSequenceFailure.correctPrefixChecks;
  item.totalOpSteps=item.examSequenceFailure.totalChecks;
  item.wasCorrectFinal=false;
  item.points=score.points;
  item.maxPoints=score.maxPoints;
  item.itemScore=score.maxPoints>0?score.points/score.maxPoints:0;
  item.programScoreFacts={
    programCorrectChecks:item.examSequenceFailure.correctPrefixChecks,
    programTotalChecks:item.examSequenceFailure.totalChecks,
    expressionCorrectSteps:0,expressionTotalSteps:0,finalCorrect:false,
    strictSequenceTerminated:true
  };
  recordExamAction(item,action,{statementId:statement&&statement.id,wasCorrect:false,
    scoredAction:true,creditEligible:false,terminal:true,reason});
  render();
  if(typeof bringInvalidExecutionAlertIntoView==='function') bringInvalidExecutionAlertIntoView();
  return true;
}

function recordExamAction(item,action,detail){
  if(state.mode!=='exam'||state.examSubmitted||!item) return;
  if(!Array.isArray(item.examActionLog)) item.examActionLog=[];
  item.examActionLog.push(Object.assign({
    type:action&&action.type?action.type:String(action),timestamp:Date.now()
  },detail||{}));
}

// Existing expression semantics, extracted behind the statement-plugin
// boundary. Returning a boolean lets Program Core decide whether a render is
// needed; every state transition below is otherwise byte-for-byte equivalent
// to the former handleTokenClick flow.
function applyExpressionAction(item, action){
  if(!item || item.checked) return false;

  if(action.type==='substitute'){
    const node = findFlatOperandById(item.workingFlat, action.id);
    if(!node) return false;
    if(node.kind==='unary'){
      // First half only: reveal the wrapped variable's value. The operator
      // itself is applied by a separate 'apply-unary' click below — a
      // unary operator always acts on a variable, so its value must be
      // identified/substituted before the operator can be applied, exactly
      // like any other variable operand.
      if(node.substituted) return false;
      const before = flatToString(item.workingFlat);
      if(action.manualResponse) node.inner.declaredValue=action.manualResponse.value;
      item.workingFlat = substituteFlatById(item.workingFlat, action.id);
      const after = flatToString(item.workingFlat);
      item.trace.push({action:'SUBSTITUTE', target:(node.inner.kind==='literal'?String(node.inner.value):node.inner.name), targetKind:node.inner.kind, sourceValue:unaryBaseValue(node), expressionBefore:before, expressionAfter:after, resultNodeId:node.id,
        manualResponse:!!action.manualResponse,manualExpectedValue:action.manualResponse&&action.manualResponse.expectedValue,manualWasCorrect:action.manualResponse&&action.manualResponse.wasCorrect});
      item.history.push(deepCloneFlat(item.workingFlat));
      return true;
    }
    if(node.resolved) return false;
    const before = flatToString(item.workingFlat);
    if(action.manualResponse) node.declaredValue=action.manualResponse.value;
    item.workingFlat = resolveFlatById(item.workingFlat, action.id);
    const after = flatToString(item.workingFlat);
    item.trace.push({action:'SUBSTITUTE', target:node.name, targetKind:node.kind, sourceValue:node.declaredValue, expressionBefore:before, expressionAfter:after, resultNodeId:node.id,
      manualResponse:!!action.manualResponse,manualExpectedValue:action.manualResponse&&action.manualResponse.expectedValue,manualWasCorrect:action.manualResponse&&action.manualResponse.wasCorrect});
    item.history.push(deepCloneFlat(item.workingFlat));
    return true;
  }

  if(action.type==='apply-unary'){
    // Second half of a unary token's resolution: applies the operator
    // (++/--/!) to the value revealed by the preceding 'substitute' click
    // (e.g. "++7" -> "8"). Only reachable once substituted, never resolved.
    const node = findFlatOperandById(item.workingFlat, action.id);
    if(!node || node.kind!=='unary' || !node.substituted || node.resolved) return false;
    const before = flatToString(item.workingFlat);
    const base=unaryBaseValue(node);
    const expected=node.op==='!'?!base:base+(node.op==='++'?1:-1);
    const writeValue=action.manualResponse?action.manualResponse.value:expected;
    const expressionValue=node.op==='!'?writeValue:(node.form==='postfix'?base:writeValue);
    item.workingFlat={operands:item.workingFlat.operands.map(operand=>operand.id===node.id
      ?Object.assign({},operand,{resolved:true,resultValue:expressionValue}):operand),operators:item.workingFlat.operators};
    const after = flatToString(item.workingFlat);
    item.trace.push({action:'UNARY', op:node.op, form:node.form, target:(node.inner.kind==='literal'?String(node.inner.value):node.inner.name), sourceValue:base, result:expressionValue,writeValue,
      expressionBefore:before, expressionAfter:after, resultNodeId:node.id,manualResponse:!!action.manualResponse,
      manualExpectedValue:action.manualResponse&&action.manualResponse.expectedValue,manualWasCorrect:action.manualResponse&&action.manualResponse.wasCorrect});
    item.history.push(deepCloneFlat(item.workingFlat));
    return true;
  }

  if(action.type==='evaluate'){
    const unresolvedAny = collectUnresolvedFlat(item.workingFlat,[]).length>0;
    if(strictSequenceEnabled()){
      const executable=collectReadyOperatorsFlat(item.workingFlat,[])
        .some(candidate=>candidate.leftId===action.leftId&&candidate.rightId===action.rightId);
      if(!executable) return false;
    } else if(unresolvedAny) return false;
    const before = flatToString(item.workingFlat);
    const maxCands = getMaxPrecCandidatesFlat(item.workingFlat);
    // In strict mode a locally computable pair may be selected while another
    // named operand elsewhere is still unresolved. Execute it so the chosen
    // path can play out, but never award sequence credit: substitution was
    // still the required next phase before any binary evaluation.
    const wasCorrect = !unresolvedAny
      && maxCands.some(c=>c.leftId===action.leftId && c.rightId===action.rightId);
    const evalResult = action.manualResponse
      ?evaluateFlatAt(item.workingFlat,action.leftId,action.rightId,action.manualResponse.value)
      :evaluateFlatAt(item.workingFlat, action.leftId, action.rightId);
    if(!evalResult.applied) return false;
    item.workingFlat = evalResult.newFlat;
    const after = flatToString(item.workingFlat);
    item.trace.push({action:'EVALUATE', target:{operator:evalResult.op, operands:[evalResult.a, evalResult.b]}, result:evalResult.result, expressionBefore:before, expressionAfter:after, wasCorrect, expectedOperators:maxCands.map(candidate=>candidate.op), resultNodeId:evalResult.resultId, leftId:action.leftId, rightId:action.rightId,
      manualResponse:!!action.manualResponse,manualExpectedValue:action.manualResponse&&action.manualResponse.expectedValue,manualWasCorrect:action.manualResponse&&action.manualResponse.wasCorrect});
    item.history.push(deepCloneFlat(item.workingFlat));
    return true;
  }
  return false;
}

function handleUndo(){
  const item = currentItem();
  if(!examAllowsUndo() || !item || item.checked) return;
  if(state.mode==='practice'&&item.practiceInvalidExecution){
    item.practiceInvalidExecution=null;
    render();
    return;
  }
  if(state.mode==='exam'){
    const statement=currentProgramStatement(item);
    const plugin=statementPluginFor(statement);
    if(!plugin || typeof plugin.canUndo!=='function'
      || !plugin.canUndo({program:item.program,statement,item})) return;
  }
  const result = undoProgramAction(item, {undoExpressionAction});
  if(result.applied){recordExamAction(item,{type:'undo'});render();}
}

// Original expression-local undo behavior used by the compatibility plugin.
function undoExpressionAction(item){
  if(!item || item.checked || item.history.length<=1) return false;
  item.history.pop();
  item.trace.pop();
  item.workingFlat = deepCloneFlat(item.history[item.history.length-1]);
  return true;
}
function handleReset(){
  // Reset (start this item completely over) is Practice-only; Exam mode
  // never allows it, even before checking — that's the only real
  // Practice/Exam difference besides the one-check-per-item rule below.
  const item = currentItem();
  if(state.mode==='exam' || item.checked) return;
  item.practiceInvalidExecution=null;
  const result = resetProgramAction(item, {resetExpressionAction});
  if(result.applied) render();
}

// Original Practice-mode reset used by the legacy-expression adapter.
function resetExpressionAction(item){
  if(!item || item.checked) return false;
  const changed = item.trace.length>0;
  item.workingFlat = deepCloneFlat(item.originalFlat);
  item.history = [deepCloneFlat(item.originalFlat)];
  item.trace = [];
  item.practiceInvalidExecution = null;
  item._bindings = null;
  return changed;
}
// ============================================================================
// SCORING CONFIGURATION (data-driven — Project Brief §14E)
// ----------------------------------------------------------------------------
// §14E requires the scoring formula be "configurable without rewriting the
// evaluation engine," and explicitly lists several policies (final-answer-
// only, step-based, step+final, process-focused) as things a teacher should
// be able to select between, not things baked into handleCheck as a single
// literal formula. So scoring lives here as data (SCORING_CONFIG) plus a
// small table of named model functions (ITEM_SCORE_MODELS) that data selects
// between. handleCheck itself no longer contains any formula — it just
// gathers the step/final facts and calls scoreItem(), so swapping policies,
// or adding a new one, never touches the evaluation engine or handleCheck.
//
// Every model resolves to RAW POINTS: {points, maxPoints}, scaled against
// cfg.pointsPerItem — not a bare 0..1 ratio — so the end-of-session summary
// can show an honest "[earned]/[possible]" score instead of a percentage.
// Most models still round to a whole number; PER_CHECK (this app's default
// — see below) deliberately does NOT, since pointsPerItem is now small
// (1-3, see generator.js) and rounding an already-small per-check slice to
// the nearest whole point would collapse most partial-credit outcomes to
// either 0 or full credit.
//
// pointsPerItem is NOT set here anymore: it's now defined PER PROFILE (see
// generator.js's PROFILES — each profile carries its own pointsPerItem,
// scaled to that profile's own difficulty). SCORING_CONFIG only owns the
// *model* (which formula) and its weights, which stay global — every
// profile is graded by the same formula, just against a different point
// budget. scoreItem() below takes the active item's profile pointsPerItem
// as an explicit argument and merges it into a per-call cfg, rather than
// reading one shared constant.
// ============================================================================
const SCORING_CONFIG = {
  model: 'PER_CHECK',        // any key in ITEM_SCORE_MODELS below
  stepWeight: 0.5,            // used by STEP_PLUS_FINAL / PROCESS_FOCUSED only
  finalWeight: 0.5             // used by STEP_PLUS_FINAL / PROCESS_FOCUSED only
};

// Shared rounding helper: keeps a raw points value to 1 decimal place,
// stripping the floating-point noise that summing several already-rounded
// decimal values produces (e.g. 0.6+0.6+0.6 === 1.7999999999999998 in JS).
// Used both when a single item's PER_CHECK score is computed (see below)
// and anywhere multiple items' .points are added together for a total —
// see render-done.js / score-summary.js / login.js's computeProfileScore.
function roundPoints(n){ return Math.round(n*10)/10; }

const ITEM_SCORE_MODELS = {
  // "Final-answer-only" (§14E): the derived value is all that's scored.
  // A wrong path that lands on the right answer still gets full credit; a
  // right path undone by one final slip gets zero — steps are never scored.
  FINAL_ONLY: (facts, cfg) => ({
    points: facts.wasCorrectFinal ? cfg.pointsPerItem : 0,
    maxPoints: cfg.pointsPerItem
  }),
  // "Step-based" (§14E): only the proportion of correctly-ordered evaluation
  // steps counts. A correct final value reached via a correct process will
  // already show as 100% of steps correct, so this still rewards it.
  STEP_ONLY: (facts, cfg) => {
    const ratio = facts.totalOpSteps>0 ? facts.correctSteps/facts.totalOpSteps : 1;
    return {points: Math.round(ratio*cfg.pointsPerItem), maxPoints: cfg.pointsPerItem};
  },
  // "Step + final", blended by weight (§14E): step credit and final credit
  // are each turned into a 0..1 ratio first, THEN combined via
  // cfg.stepWeight/cfg.finalWeight — so, unlike PER_CHECK below, an item
  // with many steps doesn't let step correctness dominate the final-value
  // check just because there are more of them; the two checks/final are
  // weighted as two lump categories, not as N+1 individually equal checks.
  STEP_PLUS_FINAL: (facts, cfg) => {
    const stepRatio = facts.totalOpSteps>0 ? facts.correctSteps/facts.totalOpSteps : 1;
    const ratio = cfg.stepWeight*stepRatio + cfg.finalWeight*(facts.wasCorrectFinal?1:0);
    return {points: Math.round(ratio*cfg.pointsPerItem), maxPoints: cfg.pointsPerItem};
  },
  // "Process-focused" (§14E): identical shape to STEP_PLUS_FINAL — the
  // policy difference is entirely in how SCORING_CONFIG's weights are set
  // (e.g. stepWeight:0.8, finalWeight:0.2), so most of the score reflects
  // the evaluation sequence rather than only the terminal value.
  PROCESS_FOCUSED: (facts, cfg) => {
    const stepRatio = facts.totalOpSteps>0 ? facts.correctSteps/facts.totalOpSteps : 1;
    const ratio = cfg.stepWeight*stepRatio + cfg.finalWeight*(facts.wasCorrectFinal?1:0);
    return {points: Math.round(ratio*cfg.pointsPerItem), maxPoints: cfg.pointsPerItem};
  },
  // "Per-check" (this app's default): every individual EVALUATE step AND
  // the final derived value are each treated as ONE equally-weighted check
  // — totalOpSteps checks for the steps, plus exactly 1 more for the final
  // value, so an item with N operator steps has N+1 checks total. The
  // item's whole pointsPerItem budget is split evenly across those checks,
  // and the student earns one slice per check they got right. E.g. a
  // 3-point item with 4 EVALUATE steps has 5 checks (4 steps + 1 final) →
  // 0.6 pts/check; getting 3/4 steps right and the final value wrong earns
  // 3 × 0.6 = 1.8 of the 3 points. Unlike STEP_PLUS_FINAL, the final value
  // is NOT a separate 50%-weighted category — it's just one more check,
  // worth exactly as much as any individual step, so items with more steps
  // naturally weight the final value proportionally less. Deliberately not
  // rounded to a whole number (see the header comment above) — the fixed
  // small pointsPerItem budgets (1-3) mean whole-number rounding would
  // erase most partial credit.
  PER_CHECK: (facts, cfg) => {
    const totalChecks = facts.totalOpSteps + 1; // every EVALUATE step, plus the final derived value
    const correctChecks = facts.correctSteps + (facts.wasCorrectFinal ? 1 : 0);
    const pointPerCheck = cfg.pointsPerItem / totalChecks;
    const rawPoints = correctChecks * pointPerCheck;
    // Rounded to 1 decimal place — enough to keep a clean, readable score
    // (matching the worked example: 3 pts / 5 checks = 0.6/check, 3 correct
    // checks = 1.8) without floating-point noise like 1.7999999999999998.
    const points = roundPoints(rawPoints);
    return {points, maxPoints: cfg.pointsPerItem};
  }
};
// pointsPerItem is supplied by the caller (looked up from the ACTIVE item's
// own profile — see handleCheck() below and generator.js's PROFILES), never
// read off SCORING_CONFIG directly, since the point budget is now a
// per-profile authoring decision rather than one global number. Every
// ITEM_SCORE_MODELS function already just reads cfg.pointsPerItem, so
// merging it into a fresh per-call cfg object (rather than mutating the
// shared SCORING_CONFIG) is the only change needed here.
function scoreItem(facts, pointsPerItem){
  const model = ITEM_SCORE_MODELS[SCORING_CONFIG.model] || ITEM_SCORE_MODELS.STEP_PLUS_FINAL;
  const cfg = Object.assign({}, SCORING_CONFIG, {pointsPerItem});
  return model(facts, cfg);
}

function handleCheck(){
  const item=currentItem();
  if(state.examSubmitted || !item) return;
  const result = checkProgramItem(item, {checkExpressionItem});
  if(result.applied){
    if(state.mode==='exam'){
      item.lockedAt=Date.now();
      item.flagged=false;
      item.showSolution=false;
      item.playback=null;
      recordExamAction(item,{type:'check'},{wasCorrect:item.wasCorrectFinal});
    }
    render();
  }
}

function toggleCurrentItemFlag(){
  const item=currentItem();
  if(state.mode!=='exam'||state.examSubmitted||!activeExamPolicy().allowReviewFlags
    ||!item||item.checked) return;
  item.flagged=!item.flagged;
  recordExamAction(item,{type:item.flagged?'flag':'unflag'});
  render();
}

function allExamItems(){
  const rows=[];
  PROFILES.forEach(profile=>{
    (state.itemsByProfile[profile.id]||[]).forEach((item,index)=>rows.push({profile,item,index}));
  });
  return rows;
}

function examAttemptSummary(){
  const rows=allExamItems();
  return {
    total:rows.length,
    answered:rows.filter(row=>row.item.checked).length,
    inProgress:rows.filter(row=>!row.item.checked&&itemHasAttempt(row.item)).length,
    unattempted:rows.filter(row=>!row.item.checked&&!itemHasAttempt(row.item)).length,
    flagged:rows.filter(row=>row.item.flagged).length
  };
}

function itemHasAttempt(item){
  if(!item) return false;
  if(item.trace&&item.trace.length) return true;
  return !!(item.program&&(item.program.cursor>0||item.program.statements.some(statement=>
    statement.runtime&&statement.runtime.trace&&statement.runtime.trace.length)));
}

function submitExam(force){
  if(state.mode!=='exam'||state.examSubmitted) return false;
  const summary=examAttemptSummary();
  if(!force&&typeof confirm==='function'){
    const accepted=confirm(`Submit this exam?\n\n${summary.answered} answered\n${summary.inProgress} in progress\n${summary.unattempted} unattempted\n${summary.flagged} flagged\n\nAfter submission, answers cannot be changed.`);
    if(!accepted) return false;
  }
  allExamItems().forEach(({profile,item})=>{
    if(item.checked) return;
    item.examOmitted=true;
    item.flagged=false;
    item.points=0;
    item.maxPoints=profile.pointsPerItem;
    item.itemScore=0;
  });
  state.examSubmitted=true;
  state.examSubmittedAt=Date.now();
  state.screen='done';
  if(typeof stopTimer==='function') stopTimer();
  if(typeof saveExamProgress==='function') saveExamProgress();
  render();
  return true;
}

// Scoring for the legacy expression statement is unchanged; it is now a
// service invoked by that statement's plugin rather than by the DOM handler.
function checkExpressionItem(item){
  if(!item || !itemFullyResolved(item) || item.checked) return false;
  const studentFinal = flatOperandValue(item.workingFlat.operands[0]);
  const evalSteps = item.trace.filter(t=>t.action==='EVALUATE');
  const correctSteps = evalSteps.filter(s=>s.wasCorrect).length;
  const totalOpSteps = evalSteps.length;
  const wasCorrectFinal = studentFinal === item.correctFinalValue;

  // Interactive declarations add their initializer evaluations and explicit
  // assignment commits as scorable checks. Current one-expression profiles
  // have no declaration statements, so their scoring inputs remain identical.
  let priorCorrectChecks = 0;
  let priorTotalChecks = 0;
  if(item.program && item.program.scoreAssignments){
    item.program.statements.forEach(statement=>{
      const plugin=statementPluginFor(statement);
      if(!plugin||!plugin.scoresCommit||!statement.runtime||!statement.runtime.checked) return;
      priorCorrectChecks += statement.runtime.correctSteps;
      priorTotalChecks += statement.runtime.totalOpSteps;
      priorTotalChecks += 1; // the declaration's explicit `=` assignment
      if(statement.runtime.wasCorrectAssignment) priorCorrectChecks += 1;
    });
  }
  item.checked = true;
  item.studentFinal = studentFinal;
  item.correctSteps = correctSteps;
  item.totalOpSteps = totalOpSteps;
  item.wasCorrectFinal = wasCorrectFinal;
  // Look up the point budget from the profile THIS item was generated
  // under (item.profileId — stamped in generateItemsForProfile), not
  // necessarily state.profileId/currentProfile(): those track whichever
  // profile the sidebar currently has selected, which is always the same
  // profile as the item being checked in normal use, but item.profileId is
  // the actually-correct, unambiguous source now that pointsPerItem is
  // per-profile data.
  const itemProfile = PROFILES.find(p=>p.id===item.profileId) || currentProfile();
  const scoringFacts = {
    correctSteps:correctSteps + priorCorrectChecks,
    totalOpSteps:totalOpSteps + priorTotalChecks,
    wasCorrectFinal
  };
  const manualFacts=typeof manualResponseFacts==='function'?manualResponseFacts(item):{correct:0,total:0};
  scoringFacts.correctSteps+=manualFacts.correct;
  scoringFacts.totalOpSteps+=manualFacts.total;
  if(state.mode==='exam'&&Array.isArray(item.examActionLog)){
    const attemptedEvaluations=item.examActionLog.filter(entry=>entry.type==='evaluate');
    if(attemptedEvaluations.length){
      const assignmentStatements=item.program&&item.program.scoreAssignments
        ? item.program.statements.filter(statement=>{
          const plugin=statementPluginFor(statement);
          return !!(plugin&&plugin.scoresCommit&&statement.runtime&&statement.runtime.checked);
        }) : [];
      scoringFacts.correctSteps=attemptedEvaluations.filter(entry=>entry.wasCorrect===true).length
        +assignmentStatements.filter(statement=>statement.runtime.wasCorrectAssignment).length;
      scoringFacts.totalOpSteps=attemptedEvaluations.length+assignmentStatements.length+manualFacts.total;
      scoringFacts.correctSteps+=manualFacts.correct;
    }
  }
  const {points, maxPoints} = scoreItem(scoringFacts, itemProfile.pointsPerItem);
  item.points = points;
  item.maxPoints = maxPoints;
  item.programScoreFacts = {
    programCorrectChecks:priorCorrectChecks,
    programTotalChecks:priorTotalChecks,
    declarationCorrectChecks:priorCorrectChecks,
    declarationTotalChecks:priorTotalChecks,
    expressionCorrectSteps:correctSteps,
    expressionTotalSteps:totalOpSteps,
    finalCorrect:wasCorrectFinal
  };
  // Ratio form is retained only for the per-item "% item score" stat shown
  // in the mid-session feedback card; the session summary uses raw points.
  item.itemScore = maxPoints>0 ? points/maxPoints : 0;
  return true;
}

function handleRetrySameItem(){
  // Re-attempt the SAME generated expression from scratch (multiple Verify attempts, per Practice mode rules).
  const item = currentItem();
  if(state.mode==='exam') return;
  item.workingFlat = deepCloneFlat(item.originalFlat);
  item.history = [deepCloneFlat(item.originalFlat)];
  item.trace = [];
  item.practiceInvalidExecution = null;
  item.checked = false;
  item.itemScore = null;
  item.points = null; item.maxPoints = null;
  item.correctSteps = 0; item.totalOpSteps = 0; item.wasCorrectFinal = null;
  item.showSolution = false;
  item.playback = null;
  item._feedbackAnimated = false;
  item._bindings = null;
  item.programScoreFacts = null;
  if(itemHasInteractiveProgram(item)){
    resetProgramAction(item, {resetExpressionAction});
  }
  render();
}

function toggleSolution(){
  const item = currentItem();
  if(state.mode==='exam') return;
  item.showSolution = !item.showSolution;
  if(item.showSolution){
    if(!item.playback) item.playback = {index:0, playing:false};
  } else {
    item.playback = null;
  }
  render();
}
