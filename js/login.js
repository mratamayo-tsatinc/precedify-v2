// ============================================================================
// LOGIN HANDLING WITH STUDENT DATABASE VALIDATION
// ============================================================================

let studentDatabase = []; // Will be populated from data/students.csv

// Load student database from CSV file
async function loadStudentDatabase() {
  try {
    const response = await fetch('data/students.csv');
    if (!response.ok) {
      console.error('Failed to load students.csv:', response.status);
      return false;
    }
    
    const text = await response.text();
    const rows = text.split('\n').slice(1); // Skip header row
    
    studentDatabase = rows
      .filter(row => row.trim().length > 0) // Skip empty rows
      .map(row => {
        const [email, studentNumber] = row.split(',');
        return { 
          email: email?.trim(), 
          studentNumber: studentNumber?.trim() 
        };
      })
      .filter(record => record.email && record.studentNumber); // Filter out invalid records
    
    console.log(`Student database loaded: ${studentDatabase.length} students`);
    return true;
  } catch (err) {
    console.error('Error loading student database:', err);
    return false;
  }
}

function handleLogin(event) {
  event.preventDefault();
  
  const emailInput = document.getElementById('emailInput');
  const studentNumInput = document.getElementById('studentNumInput');
  const errorDiv = document.getElementById('loginError');
  
  // Clear previous errors
  errorDiv.textContent = '';
  errorDiv.style.display = 'none';
  
  const email = emailInput.value.trim();
  const studentNumber = studentNumInput.value.trim();
  
  // Validation
  if (!email) {
    showLoginError('Please enter your email address');
    emailInput.focus();
    return;
  }
  
  if (!studentNumber) {
    showLoginError('Please enter your student number');
    studentNumInput.focus();
    return;
  }
  
  // Simple email validation
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    showLoginError('Please enter a valid email address');
    emailInput.focus();
    return;
  }
  
  // Check if user exists in student database
  const user = studentDatabase.find(s => s.email === email && s.studentNumber === studentNumber);
  
  if (!user) {
    showLoginError('Invalid email or student number. Please check and try again.');
    return;
  }
  
  // Save login to localStorage
  const loginData = {
    email: email,
    studentId: studentNumber,
    timestamp: new Date().toISOString()
  };
  
  localStorage.setItem('precedifyLogin', JSON.stringify(loginData));
  
  // Update state with app settings mode (set once at login, cannot be changed)
  state.userEmail = email;
  state.userStudentId = studentNumber;
  state.mode = appSettings.mode;
  // state.profileId already defaults to PROFILES[0].id — startSession()
  // generates every profile's items and drops the student straight into
  // the first profile's actual questions, skipping the legacy setup screen.
  
  // Animate transition
  const loginOverlay = document.getElementById('loginOverlay');
  loginOverlay.style.opacity = '0';
  loginOverlay.style.pointerEvents = 'none';
  
  setTimeout(() => {
    // appSettings.mode is now globally persisted (settings-persistence.js)
    // and re-loaded on app boot / whenever Settings is opened, so it's a
    // reliable, disk-backed signal here — not something that merely
    // happens to still be sitting in memory. Resume only if that persisted
    // mode is currently 'exam'. Practice sessions never delete a stored
    // exam; only an explicit Danger Zone action may purge an attempt.
    if (appSettings.mode === 'exam' && tryResumeExamSession(email)) {
      return;
    }
    startSession();
  }, 300);
}

function showLoginError(message) {
  const errorDiv = document.getElementById('loginError');
  errorDiv.textContent = message;
  errorDiv.style.display = 'block';
}

function logout() {
  stopTimer();
  localStorage.removeItem('precedifyLogin');
  state.screen = 'login';
  state.userEmail = null;
  state.userStudentId = null;
  
  // Clear form
  document.getElementById('emailInput').value = '';
  document.getElementById('studentNumInput').value = '';
  document.getElementById('loginError').textContent = '';
  
  // Undo the inline fade-out applied by handleLogin() when this same
  // overlay element was last dismissed — without this, render() sets
  // display:flex again but the overlay stays invisible/unclickable at
  // opacity:0, producing a blank screen until a full page refresh clears
  // the inline styles.
  const loginOverlay = document.getElementById('loginOverlay');
  loginOverlay.style.opacity = '';
  loginOverlay.style.pointerEvents = '';
  
  render();
}

// ============================================================================
// SETTINGS MODAL FUNCTIONS
// ============================================================================

function openSettingsModal() {
  document.getElementById('settingsModal').style.display = 'flex';
  document.getElementById('settingsOverlay').style.display = 'block';

  // appSettings is the persisted, global source of truth (see
  // settings-persistence.js) — re-read it here in case it changed via
  // another tab/window since this modal was last opened.
  loadPersistedAppSettings();

  // Set current settings in the modal
  document.querySelector(`input[name="mode"][value="${appSettings.mode}"]`).checked = true;
  document.getElementById('timerInput').value = appSettings.timerMinutes;
  const exam=appSettings.exam;
  const setChecked=(id,value)=>{const el=document.getElementById(id);if(el)el.checked=!!value;};
  setChecked('examAllowUndo',exam.allowUndo);
  setChecked('examAllowReviewFlags',exam.allowReviewFlags);
  setChecked('examShowNeutralGuidance',exam.showNeutralGuidance);
  setChecked('examShowScoresDuringExam',exam.showScoresDuringExam);
  const release=document.getElementById('examFeedbackRelease');
  if(release) release.value=exam.feedbackRelease;
  
  // Show/hide timer section based on mode
  const timerSection = document.getElementById('timerSection');
  if (appSettings.mode === 'exam') {
    timerSection.style.display = 'block';
  } else {
    timerSection.style.display = 'none';
  }

  document.querySelectorAll('.danger-result').forEach(el=>{el.style.display='none';});
}

function closeSettingsModal() {
  document.getElementById('settingsModal').style.display = 'none';
  document.getElementById('settingsOverlay').style.display = 'none';
}

function handleModeChange() {
  const selectedMode = document.querySelector('input[name="mode"]:checked').value;
  const timerSection = document.getElementById('timerSection');
  
  if (selectedMode === 'exam') {
    timerSection.style.display = 'block';
  } else {
    timerSection.style.display = 'none';
  }
}

function validateTimerInput(input) {
  let value = parseInt(input.value, 10);
  
  if (isNaN(value)) {
    input.classList.add('invalid');
    return false;
  }
  
  if (value < 1) {
    input.value = '1';
    input.classList.remove('invalid');
  } else if (value > 999) {
    input.value = '999';
    input.classList.remove('invalid');
  } else {
    input.classList.remove('invalid');
  }
  
  return true;
}

function saveSettings() {
  const selectedMode = document.querySelector('input[name="mode"]:checked').value;
  const timerInput = document.getElementById('timerInput');
  const timerValue = parseInt(timerInput.value, 10);
  
  // Validate timer input
  if (selectedMode === 'exam') {
    if (isNaN(timerValue) || timerValue < 1 || timerValue > 999) {
      alert('Please enter a valid timer value between 1 and 999 minutes.');
      return;
    }
    appSettings.timerMinutes = timerValue;
  }
  
  appSettings.mode = selectedMode;
  const checked=id=>{const el=document.getElementById(id);return !!(el&&el.checked);};
  appSettings.exam={
    allowUndo:checked('examAllowUndo'),
    allowReviewFlags:checked('examAllowReviewFlags'),
    showNeutralGuidance:checked('examShowNeutralGuidance'),
    showScoresDuringExam:checked('examShowScoresDuringExam'),
    feedbackRelease:(document.getElementById('examFeedbackRelease')||{}).value==='never'?'never':'after-submit',
    lockItemAfterCheck:true,autoSubmitOnTimeout:true,showCorrectSolution:false
  };
  // Persist immediately — this global setting is the single source of
  // truth every subsequent refresh/login checks before resuming exam
  // progress (see main.js / login.js).
  savePersistedAppSettings();
  
  closeSettingsModal();
}

// Manual "clear everyone's exam progress" action — see
// clearAllExamProgressEverywhere's own comment for why this is the only
// sanctioned way that data disappears outside a timer expiring on its own.
function handleClearAllExamProgress() {
  const confirmed = confirm('This will permanently delete every student\'s saved exam progress on this device. This cannot be undone. Continue?');
  if (!confirmed) return;
  const count = clearAllExamProgressEverywhere();
  const resultEl = document.getElementById('clearExamProgressResult');
  if (resultEl) {
    resultEl.textContent = count > 0
      ? `Cleared ${count} saved exam session${count===1?'':'s'}.`
      : 'No saved exam progress was found.';
    resultEl.style.display = 'block';
  }
}

function showDangerResult(id,message){
  const resultEl=document.getElementById(id);
  if(resultEl){resultEl.textContent=message;resultEl.style.display='block';}
}

function handleResetApplicationSettings(){
  if(!confirm('Reset activity and exam settings to their built-in defaults? Student exam progress will not be deleted.')) return;
  resetPersistedAppSettings();
  openSettingsModal();
  showDangerResult('resetSettingsResult','Application settings restored to defaults. Student attempts were preserved.');
}

function handleClearAllLocalData(){
  if(!confirm('Delete application settings, saved login information, and every student exam attempt on this device? This cannot be undone.')) return;
  const count=clearAllPrecedifyLocalData();
  openSettingsModal();
  showDangerResult('clearAllDataResult',`Cleared ${count} stored application record${count===1?'':'s'}.`);
}

// ============================================================================
// TIMER FUNCTIONS (EXAM MODE) — Session-level timer for all items
// ============================================================================
// The timer counts down from a fixed duration (set in appSettings.timerMinutes)
// and applies to the entire exam session across ALL items, not individual items.
// Timer starts when startSession() is called and continues until:
//  1. User ends the session (End session button)
//  2. Time runs out (handleTimerExpired)
// ============================================================================

function startTimer(resumeSeconds) {
  if (appSettings.mode !== 'exam') {
    return;
  }
  // Exam time is allotted once for the ENTIRE session across every
  // profile, not per profile — if a timer is already running, do nothing
  // rather than reinitialize it. This is a defensive guard on top of the
  // fix in selectProfile(): even if something else ever calls startTimer()
  // again mid-session, the countdown already in flight is never clobbered.
  if (timerIntervalId !== null) {
    return;
  }

  if (typeof resumeSeconds === 'number' && resumeSeconds >= 0) {
    timeRemaining = resumeSeconds;
    examEndTimestamp = Date.now() + timeRemaining * 1000;
  } else {
    // Initialize timer from the configured duration (appSettings.timerMinutes)
    timeRemaining = (state.examTimerMinutes || appSettings.timerMinutes) * 60; // Convert to seconds
    examEndTimestamp = Date.now() + timeRemaining * 1000;
  }
  // Persist the deadline immediately, rather than waiting for the next
  // render() (which won't happen until the student's next action, or a
  // full second later) — otherwise an immediate refresh right after
  // starting/resuming an exam would save with no deadline yet.
  if (typeof saveExamProgress === 'function') saveExamProgress();

  const timerContainer = document.getElementById('timerContainer');
  if (timerContainer) timerContainer.style.display = 'flex';

  updateTimerDisplay();

  let tickCount = 0;
  timerIntervalId = setInterval(() => {
    // Recompute from the fixed deadline each tick to avoid drift
    timeRemaining = Math.max(0, Math.round((examEndTimestamp - Date.now()) / 1000));
    updateTimerDisplay();

    tickCount++;
    if (timeRemaining <= 0) {
      clearInterval(timerIntervalId);
      handleTimerExpired();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const minutes = Math.floor(timeRemaining / 60);
  const seconds = timeRemaining % 60;
  const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  
  const timerDisplay = document.getElementById('timerDisplay');
  if (timerDisplay) {
    timerDisplay.textContent = display;
    timerDisplay.classList.remove('warning', 'critical');
    
    if (timeRemaining <= 60) {
      timerDisplay.classList.add('critical');
    } else if (timeRemaining <= 300) {
      timerDisplay.classList.add('warning');
    }
  }
}

function stopTimer() {
  if (timerIntervalId) {
    clearInterval(timerIntervalId);
    timerIntervalId = null;
  }
  const timerContainer = document.getElementById('timerContainer');
  if (timerContainer) timerContainer.style.display = 'none';
}

function handleTimerExpired() {
  stopTimer();
  alert('Time is up. Your exam has been submitted automatically.');
  submitExam(true);
}

// ============================================================================
// SIDEBAR NAVIGATION (Profile Selection)
// ============================================================================

function toggleSidebar() {
  const sidebar = document.getElementById('profileSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  const btn = document.getElementById('sidebarToggleBtn');
  
  if (window.innerWidth <= 768) {
    // Mobile: toggle overlay
    if (sidebar.classList.contains('sidebar-open')) {
      closeSidebar();
    } else {
      openSidebar();
    }
  } else {
    // Desktop: toggle collapse
    if (sidebar.classList.contains('sidebar-collapsed')) {
      expandDesktopSidebar();
    } else {
      collapseDesktopSidebar();
    }
  }
}

function openSidebar() {
  const sidebar = document.getElementById('profileSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar.classList.add('sidebar-open');
  backdrop.classList.add('show');
  document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'true');
}

function closeSidebar() {
  const sidebar = document.getElementById('profileSidebar');
  const backdrop = document.getElementById('sidebarBackdrop');
  sidebar.classList.remove('sidebar-open');
  backdrop.classList.remove('show');
  document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'false');
}

function closeSidebarIfMobile() {
  if (window.innerWidth <= 768) {
    closeSidebar();
  }
}

function collapseDesktopSidebar() {
  const sidebar = document.getElementById('profileSidebar');
  sidebar.classList.add('sidebar-collapsed');
  document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'false');
}

function expandDesktopSidebar() {
  const sidebar = document.getElementById('profileSidebar');
  sidebar.classList.remove('sidebar-collapsed');
  document.getElementById('sidebarToggleBtn').setAttribute('aria-expanded', 'true');
}

function selectProfile(profileId) {
  // Update active state in sidebar
  document.querySelectorAll('.profile-nav-btn').forEach(btn => {
    btn.classList.remove('active');
  });
  const activeBtn = document.querySelector(`[data-profile-id="${profileId}"]`);
  if (activeBtn) {
    activeBtn.classList.add('active');
  }
  closeSidebarIfMobile();

  // Remember exactly which item the OUTGOING profile was on before we
  // switch away from it, so navigating back to it later (via the sidebar)
  // restores that same item instead of resetting to Item 1.
  if (state.profileId) {
    state.itemIndexByProfile[state.profileId] = state.itemIndex;
  }

  // Set profile ID
  state.profileId = profileId;

  // startSession() already ran exactly once at login and generated every
  // profile's items up front (see handleLogin) — a profile switch never
  // regenerates items or touches the timer. Deliberately NOT calling
  // startSession() here: the old "first selection" fallback this used to
  // have was legacy from before login always ran it, and re-invoking
  // startSession() on a later profile switch would silently reset the
  // shared exam timer back to full duration, since exam time is allotted
  // once for the whole session across all profiles, not per profile.
  state.items = state.itemsByProfile[profileId];
  state.itemIndex = state.itemIndexByProfile[profileId] || 0;
  render();
}

// Reads the live score for one profile straight from state.itemsByProfile —
// no separate tracking to keep in sync, so it's always correct as soon as
// handleCheck() writes item.points and render() re-runs. Returns null (no
// pill shown) until at least one item in that profile has been checked.
function computeProfileScore(profileId){
  if(!examResultsVisible()) return null;
  const items = state.itemsByProfile && state.itemsByProfile[profileId];
  if(!items || items.length===0) return null;
  const anyChecked = items.some(it => it.checked);
  if(!anyChecked) return null;
  const earned = roundPoints(items.reduce((sum, it) => sum + (it.points || 0), 0)); // roundPoints() (state.js) — strips floating-point noise from summing decimal .points values
  // pointsPerItem is per-profile now (generator.js's PROFILES), not one
  // shared constant — look up THIS profile's own budget.
  const profile = PROFILES.find(p=>p.id===profileId);
  const max = items.length * (profile ? profile.pointsPerItem : 0);
  return {earned, max};
}

function populateProfileSidebar() {
  const profileList = document.getElementById('profileList');
  profileList.innerHTML = '';
  
  PROFILES.forEach(profile => {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'profile-nav-btn' + (state.profileId === profile.id ? ' active' : '');
    btn.setAttribute('data-profile-id', profile.id);
    btn.onclick = () => selectProfile(profile.id);

    const score = computeProfileScore(profile.id);
    const pillHtml = score ? `<span class="profile-score-pill">${score.earned}/${score.max}</span>` : '';

    btn.innerHTML = `
      <span class="profile-nav-name">${profile.name}${pillHtml}</span>
      <span class="profile-nav-desc">${profile.description}</span>
    `;
    
    li.appendChild(btn);
    profileList.appendChild(li);
  });
}

// ============================================================================
// ITEM PAGINATION (Free navigation between seeded items)
// ============================================================================

const ITEM_PAGE_WINDOW_SIZE = 5;

function buildItemPageWindow(total, current) {
  if (total <= ITEM_PAGE_WINDOW_SIZE) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  let start = current - Math.floor(ITEM_PAGE_WINDOW_SIZE / 2);
  start = Math.max(1, Math.min(start, total - ITEM_PAGE_WINDOW_SIZE + 1));
  return Array.from({ length: ITEM_PAGE_WINDOW_SIZE }, (_, i) => start + i);
}

// Derives a page button's status purely from the item's own live fields —
// no separate tracking needed, so it's always in sync:
//   'correct'   — checked, and the final derived value matched
//   'incorrect' — checked, and it didn't match
//   'attempted' — not checked yet, but the student has made at least one move
//   ''          — untouched
function itemPageStatus(item){
  if (!item) return '';
  if(state.mode==='exam'&&!state.examSubmitted){
    if(item.checked) return 'locked';
    if(item.flagged) return 'flagged';
    if(itemHasAttempt(item)) return 'attempted';
    return '';
  }
  if (item.checked) return item.wasCorrectFinal ? 'correct' : 'incorrect';
  if(itemHasAttempt(item)) return 'attempted';
  return '';
}
const ITEM_STATUS_CLASS = {correct:'item-page-correct',incorrect:'item-page-incorrect',attempted:'item-page-attempted',locked:'item-page-locked',flagged:'item-page-flagged'};
const ITEM_STATUS_LABEL = {correct:', correct',incorrect:', incorrect',attempted:', in progress',locked:', answer locked',flagged:', flagged for review','':', not yet answered'};
const ITEM_STATUS_MARK = {correct:' \u2713',incorrect:' \u2715',attempted:' \u2022',locked:' \uD83D\uDD12',flagged:' \u2691','':''};

function buildItemPaginationHtml(total, currentIdx, items) {
  if (total <= 1) return '';
  const current = currentIdx + 1; // 1-based for display

  const numbersHtml = buildItemPageWindow(total, current).map(p => {
    const isActive = p === current;
    const status = itemPageStatus(items[p - 1]);
    const statusCls = ITEM_STATUS_CLASS[status] ? ' ' + ITEM_STATUS_CLASS[status] : '';
    return '<button type="button" class="item-page-btn' + (isActive ? ' active' : '') + statusCls + '" data-page="' + (p - 1) + '"' +
        (isActive ? ' aria-current="true"' : '') + ' aria-label="Go to item ' + p + ITEM_STATUS_LABEL[status] + '">' + p + '</button>';
  }).join('');

  let jumpOptionsHtml = '';
  for (let i = 0; i < total; i++) {
    const status = itemPageStatus(items[i]);
    jumpOptionsHtml += '<option value="' + i + '"' + (i === currentIdx ? ' selected' : '') + '>Item ' + (i + 1) + ITEM_STATUS_MARK[status] + '</option>';
  }

  const atFirst = currentIdx === 0;
  const atLast = currentIdx === total - 1;

  return (
    '<nav class="item-pagination" aria-label="Item navigation">' +
      '<button type="button" class="item-page-nav-btn item-page-first" data-page="0"' + (atFirst ? ' disabled' : '') + ' aria-label="First item"><i class="fa-solid fa-angles-left" aria-hidden="true"></i></button>' +
      '<button type="button" class="item-page-nav-btn item-page-prev" data-page="' + (currentIdx - 1) + '"' + (atFirst ? ' disabled' : '') + ' aria-label="Previous item"><i class="fa-solid fa-angle-left" aria-hidden="true"></i></button>' +
      '<div class="item-page-numbers">' + numbersHtml + '</div>' +
      '<div class="item-page-mobile-indicator">' +
        '<select class="item-page-jump-select" aria-label="Jump to item">' + jumpOptionsHtml + '</select>' +
        '<span class="item-page-mobile-total">of ' + total + '</span>' +
      '</div>' +
      '<button type="button" class="item-page-nav-btn item-page-next" data-page="' + (currentIdx + 1) + '"' + (atLast ? ' disabled' : '') + ' aria-label="Next item"><i class="fa-solid fa-angle-right" aria-hidden="true"></i></button>' +
      '<button type="button" class="item-page-nav-btn item-page-last" data-page="' + (total - 1) + '"' + (atLast ? ' disabled' : '') + ' aria-label="Last item"><i class="fa-solid fa-angles-right" aria-hidden="true"></i></button>' +
    '</nav>'
  );
}

function renderItemPaginationBar() {
  const container = document.getElementById('itemPaginationContainer');
  if (!container) return;
  const total = state.items.length;
  const current = state.itemIndex;
  container.innerHTML = buildItemPaginationHtml(total, current, state.items);
  
  // Show pagination if in session and have multiple items
  if (state.screen === 'session' && total > 1) {
    container.style.display = 'flex';
    attachItemPaginationHandlers();
  } else {
    container.style.display = 'none';
  }
}

let itemPaginationHandlerAttached = false;
function attachItemPaginationHandlers() {
  if (itemPaginationHandlerAttached) return;
  itemPaginationHandlerAttached = true;
  
  const container = document.getElementById('itemPaginationContainer');
  if (!container) return;
  
  container.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-page]');
    if (btn) {
      const newIndex = parseInt(btn.getAttribute('data-page'), 10);
      goToItem(newIndex);
    }
  });
  
  container.addEventListener('change', (e) => {
    if (e.target.classList.contains('item-page-jump-select')) {
      const newIndex = parseInt(e.target.value, 10);
      goToItem(newIndex);
    }
  });
}

function goToItem(index) {
  const total = state.items.length;
  const safeIndex = Math.max(0, Math.min(index, total - 1));
  state.itemIndex = safeIndex;
  render();
}
