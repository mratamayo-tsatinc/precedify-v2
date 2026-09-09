// ============================================================================
// GLOBAL APP SETTINGS PERSISTENCE (localStorage, NOT per-user)
// ----------------------------------------------------------------------------
// appSettings.mode / appSettings.timerMinutes are deliberately persisted
// globally under ONE shared key, not keyed per student — this models a
// device/browser-level "what mode is this station in" setting, the same
// way a physical exam-mode switch would work. It is the SINGLE SOURCE OF
// TRUTH for whether the app should treat itself as mid-exam: both a page
// refresh (main.js) and a logout->login (login.js) resume exam progress
// if and only if this persisted mode is currently 'exam' — no other
// signal (in-memory appSettings state, whatever a settings dialog happened
// to show mid-session, etc.) factors into that decision. That makes resume
// fully intentional and reproducible from disk, not an assumption derived
// from whatever state happened to survive in memory.
// ============================================================================

const APP_SETTINGS_KEY = 'precedifyAppSettings';

function normalizeAppSettings(value){
  const normalized=cloneDefaultAppSettings();
  if(!value||typeof value!=='object') return normalized;
  if(value.mode==='practice'||value.mode==='exam') normalized.mode=value.mode;
  if(typeof value.timerMinutes==='number'&&value.timerMinutes>=1&&value.timerMinutes<=999){
    normalized.timerMinutes=Math.round(value.timerMinutes);
  }
  const exam=value.exam&&typeof value.exam==='object'?value.exam:{};
  ['allowUndo','allowReviewFlags','showNeutralGuidance','showScoresDuringExam'].forEach(key=>{
    if(typeof exam[key]==='boolean') normalized.exam[key]=exam[key];
  });
  if(exam.feedbackRelease==='after-submit'||exam.feedbackRelease==='never'){
    normalized.exam.feedbackRelease=exam.feedbackRelease;
  }
  // Assessment integrity invariants cannot be relaxed by stale/tampered data.
  normalized.exam.showCorrectSolution=false;
  normalized.exam.lockItemAfterCheck=true;
  normalized.exam.autoSubmitOnTimeout=true;
  normalized.schemaVersion=DEFAULT_APP_SETTINGS.schemaVersion;
  return normalized;
}

function loadPersistedAppSettings(){
  try{
    const raw = localStorage.getItem(APP_SETTINGS_KEY);
    appSettings=normalizeAppSettings(raw?JSON.parse(raw):null);
  }catch(e){ /* ignore malformed/unavailable storage — keep in-code defaults */ }
}

function savePersistedAppSettings(){
  try{
    appSettings=normalizeAppSettings(appSettings);
    localStorage.setItem(APP_SETTINGS_KEY, JSON.stringify(appSettings));
  }catch(e){ /* storage full/unavailable — silently skip */ }
}

// Manual, explicit "wipe every student's exam progress" action. This is the
// ONLY sanctioned way saved exam progress disappears outside of a timer
// actually expiring — switching Settings to Practice, logging out, etc.
// must never implicitly trigger it. Iterates every localStorage key rather
// than targeting the currently logged-in email, since the entire point is
// clearing OTHER students' leftover records too (shared/lab machine use).
function clearAllExamProgressEverywhere(){
  try{
    const toRemove = [];
    for(let i=0;i<localStorage.length;i++){
      const key = localStorage.key(i);
      if(key && key.indexOf('precedifyExamProgress:')===0) toRemove.push(key);
    }
    toRemove.forEach(k=>localStorage.removeItem(k));
    return toRemove.length;
  }catch(e){ return 0; }
}

function resetPersistedAppSettings(){
  try{ localStorage.removeItem(APP_SETTINGS_KEY); }catch(e){ /* ignore */ }
  appSettings=cloneDefaultAppSettings();
  return true;
}

function clearAllPrecedifyLocalData(){
  let removed=0;
  try{
    const keys=[];
    for(let i=0;i<localStorage.length;i++){
      const key=localStorage.key(i);
      if(key&&(key==='precedifyLogin'||key===APP_SETTINGS_KEY
        ||key.indexOf('precedifyExamProgress:')===0)) keys.push(key);
    }
    keys.forEach(key=>{localStorage.removeItem(key);removed++;});
  }catch(e){ /* return whatever was removed before the failure */ }
  appSettings=cloneDefaultAppSettings();
  return removed;
}
