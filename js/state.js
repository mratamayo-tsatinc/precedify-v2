// ============================================================================
// UI STATE + RENDERING
// ============================================================================
const state = {
  screen: 'login', // login | setup | session | done
  userEmail: null,
  userStudentId: null,
  language: 'java',
  mode: 'practice',
  profileId: PROFILES[0].id,
  itemIndex: 0,
  itemIndexByProfile: {}, // Remembers which item each profile was last viewing, so switching profiles via the sidebar returns to that exact item instead of resetting to Item 1
  showConnectors: true, // whether the operator→result connector line (connector-lines.js) is drawn
  items: [], // {originalTree, originalFlat, decls, correctFinalValue, canonicalTrace, workingFlat, history:[], trace:[], checked, itemScore, revealSolution}
  itemsByProfile: {}, // Stores all generated items per profile for persistence
  sessionSeed: null, // Seed used for reproducible item generation
};

// ============================================================================
// APP SETTINGS
// ============================================================================
// Global settings configured during login (via settings modal).
// These apply to the entire session and cannot be changed during the session.
//  - mode: 'practice' or 'exam' (set once at login)
//  - timerMinutes: duration for exam mode (set once at login)
// ============================================================================
let appSettings = {
  mode: 'practice', // 'practice' or 'exam' — set at login, fixed for the session
  timerMinutes: 15  // duration for exam mode (minutes)
};

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
      _bindings: null // lazily built by var-final-state.js (ensureBindings)
    };
    buildGeneratedProgram(item, profile);
    items.push(item);
  }
  return items;
}

function startSession(){
  // Generate a seed based on current timestamp if not already set
  if (!state.sessionSeed) {
    state.sessionSeed = Date.now() >>> 0; // Use current timestamp as seed
  }
  
  // Initialize seeded random generator
  initializeSeededRandom(state.sessionSeed);
  
  // Apply settings mode
  state.mode = appSettings.mode;
  
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
  const applyAction = ()=>{
    const result = dispatchProgramAction(item, action, {applyExpressionAction});
    if(result.applied) render();
    return !!result.applied;
  };

  const commitAction = ()=>{
    // When the optional memory animation is enabled, substitution remains a
    // two-phase action. It now starts only after the empty stage is on-screen.
    if(action && (action.type==='substitute'||action.type==='reveal-assignment-target')
      && typeof animateVarFinalMemoryToExpression==='function'
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
      item.workingFlat = substituteFlatById(item.workingFlat, action.id);
      const after = flatToString(item.workingFlat);
      item.trace.push({action:'SUBSTITUTE', target:(node.inner.kind==='literal'?String(node.inner.value):node.inner.name), targetKind:node.inner.kind, sourceValue:unaryBaseValue(node), expressionBefore:before, expressionAfter:after, resultNodeId:node.id});
      item.history.push(deepCloneFlat(item.workingFlat));
      return true;
    }
    if(node.resolved) return false;
    const before = flatToString(item.workingFlat);
    item.workingFlat = resolveFlatById(item.workingFlat, action.id);
    const after = flatToString(item.workingFlat);
    item.trace.push({action:'SUBSTITUTE', target:node.name, targetKind:node.kind, sourceValue:node.declaredValue, expressionBefore:before, expressionAfter:after, resultNodeId:node.id});
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
    item.workingFlat = resolveFlatById(item.workingFlat, action.id);
    const after = flatToString(item.workingFlat);
    item.trace.push({action:'UNARY', op:node.op, form:node.form, target:(node.inner.kind==='literal'?String(node.inner.value):node.inner.name), sourceValue:unaryBaseValue(node), result:unaryComputedValue(node), expressionBefore:before, expressionAfter:after, resultNodeId:node.id});
    item.history.push(deepCloneFlat(item.workingFlat));
    return true;
  }

  if(action.type==='evaluate'){
    const unresolvedAny = collectUnresolvedFlat(item.workingFlat,[]).length>0;
    if(unresolvedAny) return false; // gated: all variables/constants must resolve first
    const before = flatToString(item.workingFlat);
    const maxCands = getMaxPrecCandidatesFlat(item.workingFlat);
    const wasCorrect = maxCands.some(c=>c.leftId===action.leftId && c.rightId===action.rightId);
    const evalResult = evaluateFlatAt(item.workingFlat, action.leftId, action.rightId);
    if(!evalResult.applied) return false;
    item.workingFlat = evalResult.newFlat;
    const after = flatToString(item.workingFlat);
    item.trace.push({action:'EVALUATE', target:{operator:evalResult.op, operands:[evalResult.a, evalResult.b]}, result:evalResult.result, expressionBefore:before, expressionAfter:after, wasCorrect, resultNodeId:evalResult.resultId, leftId:action.leftId, rightId:action.rightId});
    item.history.push(deepCloneFlat(item.workingFlat));
    return true;
  }
  return false;
}

function handleUndo(){
  const item = currentItem();
  const result = undoProgramAction(item, {undoExpressionAction});
  if(result.applied) render();
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
  const result = checkProgramItem(currentItem(), {checkExpressionItem});
  if(result.applied) render();
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
      if(!['declaration','assignment'].includes(statement.kind) || !statement.runtime || !statement.runtime.checked) return;
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
  item.showSolution = !item.showSolution;
  if(item.showSolution){
    if(!item.playback) item.playback = {index:0, playing:false};
  } else {
    item.playback = null;
  }
  render();
}
