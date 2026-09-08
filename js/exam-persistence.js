// ============================================================================
// EXAM-MODE PROGRESS PERSISTENCE (localStorage, keyed by student email)
// ----------------------------------------------------------------------------
// Practice mode is intentionally NEVER persisted here — a practice refresh
// or logout is expected to reseed everything and drop progress (see
// state.js's startSession(), still called fresh in those cases). This file
// only engages when appSettings.mode==='exam', and saves enough to resume
// an exam session EXACTLY where the student left off: which seed generated
// every profile's items, each item's live trace/history/checked state, the
// student's current profile/item position, and the timer's absolute
// deadline (so time actually keeps counting down while the student is away
// — a refresh never grants extra time).
//
// Storage key is per-student (precedifyExamProgress:<email>), so logging
// out never has to special-case exam mode to "preserve" anything: logout()
// only ever removes the separate 'precedifyLogin' remember-me record, never
// this key, so the record is simply still there — untouched — the next
// time that same email logs back in, however much later that is.
// ============================================================================

function examProgressKey(email){ return 'precedifyExamProgress:' + email; }

function loadExamProgress(email){
  if(!email) return null;
  try{
    const raw = localStorage.getItem(examProgressKey(email));
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}

function clearExamProgress(email){
  if(!email) return;
  try{ localStorage.removeItem(examProgressKey(email)); }catch(e){ /* ignore */ }
}

// No-op outside exam mode / outside the session screen, so this is safe to
// call unconditionally from render() on every state change — the guard
// itself is the only thing that matters for "practice is never persisted".
function saveExamProgress(){
  if(appSettings.mode !== 'exam' || !state.userEmail) return;
  if(state.screen !== 'session' && !(state.screen==='done'&&state.examSubmitted)) return;
  try{
    const record = {
      schemaVersion: 3,
      email: state.userEmail,
      studentId: state.userStudentId,
      profileId: state.profileId,
      itemIndex: state.itemIndex,
      itemIndexByProfile: state.itemIndexByProfile,
      sessionSeed: state.sessionSeed,
      itemsByProfile: state.itemsByProfile,
      showConnectors: state.showConnectors,
      timerMinutes: state.examTimerMinutes || appSettings.timerMinutes,
      examPolicy: activeExamPolicy(),
      submitted: !!state.examSubmitted,
      submittedAt: state.examSubmittedAt,
      examEndTimestamp: examEndTimestamp,
      savedAt: Date.now()
    };
    localStorage.setItem(examProgressKey(state.userEmail), JSON.stringify(record));
  }catch(e){ /* storage full/unavailable — silently skip persistence this time */ }
}

// Generic recursive walk over the restored (plain-JSON) itemsByProfile tree
// for the highest `id` value anywhere in it. Needed because engine.js's
// nextId()/__idCounter resets to 1 on every page load — without resyncing
// it here, the very next node created during a resumed session (e.g. a new
// literal from an EVALUATE click) would reuse an id already held by an
// existing node in that same item, and every id-keyed lookup in this app
// (data-token-id, colorMap, connector-lines' findConnectorSourceEl/DestEl,
// etc.) would start matching the wrong element.
function findMaxSerializedId(value, maxSoFar){
  if(value == null) return maxSoFar;
  if(Array.isArray(value)){
    for(const v of value) maxSoFar = findMaxSerializedId(v, maxSoFar);
    return maxSoFar;
  }
  if(typeof value === 'object'){
    if(typeof value.id === 'number' && value.id > maxSoFar) maxSoFar = value.id;
    for(const k in value){
      if(Object.prototype.hasOwnProperty.call(value,k)) maxSoFar = findMaxSerializedId(value[k], maxSoFar);
    }
  }
  return maxSoFar;
}

// Attempts to restore a previously-saved exam session for `email`. Returns
// true (and leaves state/appSettings/the exam timer fully restored, session
// screen rendered) if a record was found; returns false — caller should
// fall back to a normal fresh startSession() — otherwise.
function tryResumeExamSession(email){
  const record = loadExamProgress(email);
  if(!record) return false;

  appSettings.mode = 'exam';

  state.userEmail = record.email;
  state.userStudentId = record.studentId;
  state.mode = 'exam';
  state.profileId = record.profileId;
  state.itemIndex = record.itemIndex || 0;
  state.itemIndexByProfile = record.itemIndexByProfile || {};
  state.sessionSeed = record.sessionSeed;
  state.examPolicy = snapshotExamPolicy({exam:record.examPolicy||appSettings.exam});
  state.examTimerMinutes = record.timerMinutes || appSettings.timerMinutes;
  state.examSubmitted = !!record.submitted;
  state.examSubmittedAt = record.submittedAt || null;
  examEndTimestamp = record.examEndTimestamp || null;
  state.itemsByProfile = record.itemsByProfile;

  // A saved exam from an earlier release may not contain profiles added by
  // this one. Replay the seeded generation sequence and retain only missing
  // profiles; existing student work is never regenerated or overwritten.
  const missingProfileIds = PROFILES.filter(p=>!state.itemsByProfile[p.id]).map(p=>p.id);
  if(missingProfileIds.length){
    initializeSeededRandom(state.sessionSeed);
    PROFILES.forEach(profile=>{
      const generated = generateItemsForProfile(profile.id);
      if(!state.itemsByProfile[profile.id]) state.itemsByProfile[profile.id] = generated;
    });
    resetRandomGenerator();
  }
  state.items = state.itemsByProfile[state.profileId] || [];
  state.showConnectors = record.showConnectors !== undefined ? record.showConnectors : state.showConnectors;
  state.screen = 'session';

  // Resync the id generator so any node created from here on gets a
  // genuinely-unused id (see findMaxSerializedId's comment above).
  __idCounter = findMaxSerializedId(state.itemsByProfile, 0) + 1;

  // One-time render/animation flags don't survive JSON serialization as
  // "already played" — nor should they; a resumed page hasn't shown any of
  // these rows yet. Clearing them just means entrance/flash animations
  // play once more on first render, which is correct and has no effect on
  // scoring or trace data.
  Object.values(state.itemsByProfile).forEach(items=>{
    items.forEach(item=>{
      // Older saved sessions predate the Program Item envelope. Rehydrate
      // them as single legacy-expression programs without invalidating the
      // student's existing expression state or score.
      ensureProgramEnvelope(item);
      if(typeof item.flagged!=='boolean') item.flagged=false;
      if(typeof item.examOmitted!=='boolean') item.examOmitted=false;
      if(!Array.isArray(item.examActionLog)) item.examActionLog=[];
      if(item.examSequenceFailure===undefined) item.examSequenceFailure=null;
      if(item.practiceInvalidExecution===undefined) item.practiceInvalidExecution=null;
      if(item.lockedAt===undefined) item.lockedAt=item.checked ? (record.savedAt||null) : null;
      item._bindings = null;
      item._feedbackAnimated = false;
      if(item.trace) item.trace.forEach(t=>{ t._flashed = false; t._entered = false; });
    });
  });

  itemPaginationHandlerAttached = false;

  if(state.examSubmitted){
    state.screen='done';
    render();
    return true;
  }

  render();

  // Resume the countdown from wherever its original deadline left off —
  // never grant a fresh full duration on resume.
  const remaining = record.examEndTimestamp
    ? Math.max(0, Math.round((record.examEndTimestamp - Date.now())/1000))
    : 0;
  if(remaining <= 0){
    // Time ran out while the student was away. Preserve and submit the exact
    // restored attempt instead of deleting its audit/progress record.
    submitExam(true);
  } else {
    startTimer(remaining);
  }

  return true;
}
