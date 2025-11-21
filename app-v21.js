console.log("%cBBB PWA v21.3 — RENDER BACKEND EDITION", "color: gold; font-weight: bold");

// === BACKEND LOADER (RENDER.COM) ===
const BACKEND = 'https://pwa-players-backend.onrender.com';

async function loadDataFromBackend() {
  const loader = document.getElementById('courseLoader');
  const error = document.getElementById('courseError');
  const picker = document.getElementById('coursePicker');

  try {
    const [playersRes, coursesRes] = await Promise.all([
      fetch(`${BACKEND}/players`),
      fetch(`${BACKEND}/courses`)
    ]);

    if (!playersRes.ok || !coursesRes.ok) throw new Error('Network error');

    const playersCSV = await playersRes.text();
    const coursesCSV = await coursesRes.text();

    roster = parseCSV(playersCSV).map(p => ({
      name: p.Name?.trim(),
      phone: p.Phone?.trim(),
      email: p.Email?.trim()
    })).filter(p => p.name);

    courses = parseCSV(coursesCSV).map(c => {
      const name = c.Name?.trim();
      const pars = [];
      for (let i = 1; i <= 18; i++) {
        const par = parseInt(c[`Par${i}`]);
        if (!isNaN(par)) pars.push(par);
      }
      return { name, pars };
    }).filter(c => c.name && c.pars.length === 18);

    sortPlayersAlphabetically();   // ← ALPHABETIZES BOTH ROSTER AND FUTURE PLAYERS

    if (courses.length === 0) throw new Error('No courses returned');

    // SUCCESS – SHOW PICKER
    loader.classList.add('hidden');
    picker.classList.remove('hidden');
    renderCourseSelect(); // your existing function – works perfectly

    console.log('%cBackend data loaded – PWA ready!', 'color: gold; font-weight: bold');

    // First-time welcome
    if (!localStorage.getItem('bbb-welcome-2025')) {
      setTimeout(() => document.getElementById('firstTimeWelcome')?.classList.remove('hidden'), 400);
    }

  } catch (err) {
    console.error('Backend load failed:', err);
    loader.classList.add('hidden');
    error.classList.remove('hidden');
  }
}

function logScreen(msg) {
  console.log('%cSCREEN: ' + msg, 'color: cyan; font-weight: bold');
}


// Retry button
document.addEventListener('click', (e) => {
  if (e.target && e.target.id === 'retryBtn') {
    document.getElementById('courseError').classList.add('hidden');
    document.getElementById('courseLoader').classList.remove('hidden');
    loadDataFromBackend();
  }
});

// === CSV PARSER ===
function parseCSV(text) {
  const lines = text.trim().split('\n');
  const headers = lines[0].split(',').map(h => h.trim());
  const rows = lines.slice(1).map(line => {
    const values = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"' && line[i+1] === '"') { current += '"'; i++; }
      else if (char === '"') inQuotes = !inQuotes;
      else if (char === ',' && !inQuotes) { values.push(current.trim()); current = ''; }
      else current += char;
    }
    values.push(current.trim());
    return values;
  });
  return rows.map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i] || '');
    return obj;
  });
}

// === STATE & REST OF YOUR ORIGINAL CODE (UNCHANGED) ===
let roster = [];
let players = [];
let currentHole = 1;
const HOLES = 18;
const MAX_PLAYERS = 6;
let currentCourse = null;
let courses = [];
let roundHistory = [];
let finishedHoles = new Set();
let inRound = false;
let isHoleInProgress = false;
let els = {};

function sortPlayersAlphabetically() {
  players.sort((a, b) => a.name.localeCompare(b.name));
  // Also keep roster sorted for consistency in player select screen
  roster.sort((a, b) => a.name.localeCompare(b.name));
}




// === NAVIGATION LOCK ===
function lockNavigation() {
  isHoleInProgress = true;
  // Force immediate disable on mobile
  if ('ontouchstart' in window) setTimeout(() => updateNavButtons(), 0);
  else updateNavButtons();
}

function unlockNavigation() {
  isHoleInProgress = false;
  // Force immediate enable + double-call for mobile async
  updateNavButtons();
  if ('ontouchstart' in window) setTimeout(updateNavButtons, 0);
}

function updateNavButtons() {
  console.log('%cNAV UPDATE CALLED', 'color: blue; font-weight: bold');
  console.log('currentHole:', currentHole, 'isHoleInProgress:', isHoleInProgress);
  
  const canPrev = currentHole > 1 && !isHoleInProgress;
  const canNext = currentHole < HOLES && !isHoleInProgress;
  
  console.log('Calculated: canPrev=', canPrev, 'canNext=', canNext);
  
  els.prevHole.disabled = !canPrev;
  els.nextHole.disabled = !canNext;
  
  console.log('Set: prev.disabled=', els.prevHole.disabled, 'next.disabled=', els.nextHole.disabled);
  
  // Your existing visual feedback
  [els.prevHole, els.nextHole].forEach(btn => {
    if (btn.disabled) {
      btn.style.opacity = '0.5';
    } else {
      btn.style.opacity = '1';
      btn.style.cursor = 'pointer';
    }
  });
  
  console.log('%cNAV UPDATE END', 'color: blue; font-weight: bold');
}

// === RENDER COURSE SELECT ===
function renderCourseSelect() {
  if (!els.courseSelect) return;
  els.courseSelect.innerHTML = '<option value="">-- Select Course --</option>';
  if (courses.length === 0) {
    els.courseSelect.innerHTML += '<option disabled>No courses available</option>';
    els.nextToPlayers.disabled = true;
    return;
  }
  courses.forEach((c, i) => {
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = c.name;
    els.courseSelect.appendChild(opt);
  });
  const saved = localStorage.getItem('bbb_currentCourse');
  const savedIdx = parseInt(saved);
  if (!isNaN(savedIdx) && savedIdx >= 0 && savedIdx < courses.length) {
    els.courseSelect.value = savedIdx;
    currentCourse = savedIdx;
    els.nextToPlayers.disabled = false;
  } else {
    currentCourse = null;
    els.nextToPlayers.disabled = true;
  }
}

// === DOM READY ===
document.addEventListener('DOMContentLoaded', () => {
  console.log('DOM ready — initializing app');

// Prevent iOS from sleeping / killing the tab during a round
let wakeLock = null;

async function requestWakeLock() {
  if ('wakeLock' in navigator && inRound) {
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('Wake Lock active — screen stays awake during round');
    } catch (err) {
      console.log('Wake Lock failed (iOS ignores it anyway)', err);
    }
  }
}

// Call it when round starts and release when finished
// In startGame.onclick after inRound = true:
requestWakeLock();

// In completeRound, saveRound, exitRound, etc.:
if (wakeLock) wakeLock.release().then(() => wakeLock = null);



  // === BUILD ELS CACHE ===
  els = {
  courseSetup: document.getElementById('courseSetup'),
  playerSetup: document.getElementById('playerSetup'),
  game: document.getElementById('game'),
  summary: document.getElementById('summary'),

  darkModeToggle: document.getElementById('darkModeToggle'),
  backToSetup: document.querySelectorAll('#backToSetup'),

  courseSelect: document.getElementById('courseSelect'),
  nextToPlayers: document.getElementById('nextToPlayers'),
  playerSelect: document.getElementById('playerSelect'),
  startGame: document.getElementById('startGame'),

  holeDisplay: document.getElementById('holeDisplay'),
  prevHole: document.getElementById('prevHole'),
  nextHole: document.getElementById('nextHole'),
  finishHole: document.getElementById('finishHole'),
  editHole: document.getElementById('editHole'),
  firstOnHeader: document.getElementById('firstOnHeader'),
  scoreTable: document.getElementById('scoreTable'),
  holeSummary: document.querySelector('.holeSummary'),
  roundSummary: document.getElementById('roundSummary'),

  sendSMS: document.getElementById('sendSMS'),
  exportCSV: document.getElementById('exportCSV'),
  completeRound: document.getElementById('completeRound'),
  exitRound: document.getElementById('exitRound'),
 
  leaderboard: document.getElementById('leaderboard'),
  restart: document.getElementById('restart'),

  courseInfoBar: document.getElementById('courseInfoBar'),
  infoCourseName: document.getElementById('infoCourseName'),
  infoCurrentHole: document.getElementById('infoCurrentHole'),
  infoPar: document.getElementById('infoPar'),

  // Debug (optional — you can keep these if you ever use F2 or Ctrl+Shift+D)
  debugPanel: document.getElementById('debugPanel'),
  debugOutput: document.getElementById('debugOutput'),
  closeDebug: document.getElementById('closeDebug'),
  simResult: document.getElementById('simResult')
};


  loadDataFromBackend();

  // === DARK MODE ===
  function initDarkMode() {
    const saved = localStorage.getItem('bbb_dark');
    const isDark = saved === 'true' || (saved === null && window.matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.setAttribute('data-theme', isDark ? 'dark' : 'light');
  }
  initDarkMode();
  els.darkModeToggle.addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const newMode = isDark ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', newMode);
    localStorage.setItem('bbb_dark', newMode === 'dark');
  });

  // === COLORBLIND MODE ===
 /*  let colorblindMode = localStorage.getItem('bbb_cb') === 'true';
  document.body.classList.toggle('cb-mode', colorblindMode);
  els.cbToggle.addEventListener('click', () => {
    colorblindMode = !colorblindMode;
    localStorage.setItem('bbb_cb', colorblindMode);
    document.body.classList.toggle('cb-mode', colorblindMode);
  }); */


  let debugMode = false;
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.shiftKey && e.key === 'D') {
      debugMode = !debugMode;
      els.debugPanel.classList.toggle('hidden', !debugMode);
      if (debugMode) updateDebugPanel();
    }
    if (e.keyCode === 113) {
      e.preventDefault();
      if (confirm('Run full 18-hole simulation?')) {
        simulateRound();
      }
    }
  });
  els.closeDebug.addEventListener('click', () => {
    debugMode = false;
    els.debugPanel.classList.add('hidden');
  });

  function updateDebugPanel() {
    els.debugOutput.innerHTML = '';
    renderDebugCarryTable();
    const hint = document.createElement('div');
    hint.style.marginTop = '1rem'; hint.style.padding = '0.5rem'; hint.style.background = '#333';
    hint.style.borderRadius = '6px'; hint.style.fontSize = '0.8rem'; hint.style.color = '#0f0';
    hint.innerHTML = '<strong>F2</strong> = Run Simulation (PC only)';
    els.debugOutput.appendChild(hint);
  }

  
  function save() {
    localStorage.setItem('bbb', JSON.stringify({ 
      players: players.map(p => ({ ...p, _cachedTotal: undefined, _cachedHoleTotals: undefined })), 
      currentHole, currentCourse,
      finishedHoles: Array.from(finishedHoles), inRound
    }));
  }

  // ==== FLOW ====
 function hideAll() {
  const screens = [
    els.courseSetup,
    els.playerSetup,
    els.game,
    els.summary
    // roster, history, courseForm are gone — no longer referenced
  ];

  screens.forEach(screen => {
    if (screen) screen.classList.add('hidden');
  });
}

  els.courseSelect.addEventListener('change', () => {
    const val = els.courseSelect.value;
    if (val === '') {
      currentCourse = null;
      els.nextToPlayers.disabled = true;
    } else {
      currentCourse = parseInt(val);
      localStorage.setItem('bbb_currentCourse', currentCourse);
      els.nextToPlayers.disabled = false;
    }
    save();
  });

function renderPlayerSelect() {
  console.log('%cDEBUG: renderPlayerSelect() called', 'color: orange; font-weight: bold');
  console.log('Players:', players.length, 'Roster:', roster.length);

  els.playerSelect.innerHTML = '';
  roster.forEach((p, i) => {
    const div = document.createElement('div');
    div.innerHTML = `<label><input type="checkbox" data-index="${i}" ${players.find(pl => pl.name === p.name) ? 'checked' : ''}> ${p.name}</label>`;
    els.playerSelect.appendChild(div);
  });

  // === GET startGame BUTTON ===
  els.startGame = document.getElementById('startGame');
  if (!els.startGame) {
    console.error('%cFATAL: #startGame NOT FOUND!', 'color: red');
    return;
  }

 // === SHOW BUTTON CONTAINER (FORCE ENTIRE CHAIN) ===
  const container = els.startGame.parentElement;
  container.style.display = 'block';
  els.playerSetup.style.display = 'block';  // Force show parent
  els.playerSetup.classList.remove('hidden');  // Remove hidden class

  // === ATTACH CHECKBOX LISTENERS ===
  els.playerSelect.querySelectorAll('input[type="checkbox"]').forEach(chk => {
    chk.addEventListener('change', () => {
      const idx = parseInt(chk.dataset.index);
      const player = roster[idx];

   if (chk.checked) {
    if (players.length >= MAX_PLAYERS) {
     chk.checked = false;
     alert(`Max ${MAX_PLAYERS} players`);
     return;
    }
    players.push({ ...player, scores: Array(HOLES).fill(null).map(() => ({})), gir: Array(HOLES).fill(false), _cachedTotal: 0, _cachedHoleTotals: {} });
  } else {
  players = players.filter(p => p.name !== player.name);
}

// ADD THIS LINE — keeps table and standings alphabetical
players.sort((a, b) => a.name.localeCompare(b.name));


      els.startGame.disabled = players.length < 2;
      save();
    });
  });

  // === INITIAL STATE ===
  els.startGame.disabled = players.length < 2;

  // === ATTACH START GAME LISTENER ===
 els.startGame.onclick = () => {
  if (players.length < 2) return alert('Select at least 2 players');
  
  currentHole = 1;  // ← FORCE HOLE 1
  finishedHoles.clear();
  isHoleInProgress = false;  // ← ENSURE

  players.forEach(p => {
    p.scores = Array(HOLES).fill(null).map(() => ({}));
    p.gir = Array(HOLES).fill(false);
    p._cachedTotal = 0;
    p._cachedHoleTotals = {};
  });

  players.sort((a, b) => a.name.localeCompare(b.name));

  inRound = true;
  hideAll();
  els.game.classList.remove('hidden');
  updateHole();
  attachFinishHoleListener();   // ← ADD THIS LINE
  attachNavListeners();   // ← ADD THIS LINE
  setupGameButtons();
  updateCourseInfoBar()
  save();
  logScreen('GAME STARTED');
};
}
  els.nextToPlayers.addEventListener('click', () => {
    if (currentCourse === null) return alert('Select a course');
    hideAll();
    els.playerSetup.classList.remove('hidden');
    renderPlayerSelect();
    logScreen('PLAYER SETUP');
  });

  
  

  /* els.addCourse.addEventListener('click', () => {
    hideAll();
    els.courseForm.classList.remove('hidden');
    els.courseName.value = '';
    generateParInputs();
    logScreen('NEW COURSE');
  }); */

  function generateParInputs() {
    const container = document.getElementById('pars');
    container.innerHTML = '';
    for (let i = 0; i < HOLES; i++) {
      const label = document.createElement('label');
      label.innerHTML = `Hole ${i+1}: <input type="number" min="3" max="5" value="4" class="par-input" data-hole="${i}">`;
      container.appendChild(label);
    }
  }

  /* els.saveCourse.addEventListener('click', () => {
    const name = els.courseName.value.trim();
    if (!name) return alert('Enter course name');
    const pars = Array.from(document.querySelectorAll('.par-input')).map(inp => parseInt(inp.value));
    if (pars.some(p => p < 3 || p > 5)) return alert('Par must be 3–5');
    courses.push({ name, pars });
    localStorage.setItem('bbb_courses', JSON.stringify(courses));
    hideAll();
    renderCourseSelect();
    logScreen('COURSE SAVED');
  }); */

 /*  els.cancelCourse.addEventListener('click', () => {
    hideAll();
    logScreen('COURSE CANCELLED');
  });
 */
  // === CARRY LOGIC ===
 function getCarryInForHole(holeNumber) {
  const carry = { firstOn: 0, closest: 0, putt: 0, greenie: 0 };

  for (let h = 1; h < holeNumber; h++) {
    if (!finishedHoles.has(h)) continue;

    const idx = h - 1;
    const par = courses[currentCourse].pars[idx];
    const isPar3 = par === 3;
    const scores = players.map(p => p.scores[idx]).filter(Boolean);

    // === FIRST ON (only Par 4/5) ===
    if (!isPar3) {
      if (scores.some(s => s.firstOn)) {
        carry.firstOn = 0;  // awarded → reset carry
      } else {
        carry.firstOn++;    // no winner → carry forward
      }
    }

    // === GREENIE (only Par 3) ===
    if (isPar3) {
      if (scores.some(s => s.firstOn)) {  // firstOn = Greenie on Par 3
        carry.greenie = 0;
      } else {
        carry.greenie++;
      }
    }

    // === CLOSEST (all holes) ===
    if (scores.some(s => s.closest)) {
      carry.closest = 0;
    } else {
      carry.closest++;
    }

    // === PUTT (all holes) ===
    if (scores.some(s => s.putt)) {
      carry.putt = 0;
    } else {
      carry.putt++;
    }
  }

  return carry;
}



 function precomputeAllTotals() {
  players.forEach(p => {
    let total = 0;
    p._cachedHoleTotals = {};

    for (let idx = 0; idx < HOLES; idx++) {
      const holeNumber = idx + 1;
      if (!finishedHoles.has(holeNumber)) continue;

      const s = p.scores[idx] || {};
      const carryIn = getCarryInForHole(holeNumber);
      const par = courses[currentCourse].pars[idx];
      const isPar3 = par === 3;

      let holePoints = 0;

      // Base points
      if (s.firstOn) holePoints += 1;
      if (s.closest) holePoints += 1;
      if (s.putt) holePoints += 1;

      // Carry-in
      if (holeNumber < HOLES) {
        if (s.firstOn) {
          holePoints += isPar3 ? carryIn.greenie : carryIn.firstOn;
        }
        if (s.closest) holePoints += carryIn.closest;
        if (s.putt) holePoints += carryIn.putt;
      }

      p._cachedHoleTotals[idx] = holePoints;
      total += holePoints;
    }

    p._cachedTotal = total;
  });
}

  function getRunningTotal(player) {
    let sum = 0;
    for (let h = 1; h <= currentHole; h++) {
      if (finishedHoles.has(h)) {
        sum += player._cachedHoleTotals?.[h - 1] || 0;
      }
    }
    return sum;
  }

 function updateHole() {
  if (!inRound || players.length === 0 || currentCourse === null || !courses[currentCourse]) return;

  precomputeAllTotals();  // always fresh totals

  const holeIdx = currentHole - 1;
  const par = courses[currentCourse].pars[holeIdx];
  const isPar3 = par === 3;

  const courseName = courses[currentCourse].name;
  els.holeDisplay.innerHTML = `<strong>${courseName}</strong> • Hole ${currentHole} (Par ${par}) • ${finishedHoles.size} finished`;

  els.firstOnHeader.textContent = isPar3 ? 'GR' : 'FO';

  const isFinished = finishedHoles.has(currentHole);

  // ---- SHOW / HIDE BUTTONS (using direct DOM so they’re never stale) ----
  const finishBtn = document.getElementById('finishHole');
  const editBtn   = document.getElementById('editHole');

  if (finishBtn) finishBtn.classList.toggle('hidden', isFinished);
  if (editBtn)   editBtn.classList.toggle('hidden', !isFinished);

    const carryIn = getCarryInForHole(currentHole);
  renderTable(carryIn, isFinished);

  // ---- HOLE & ROUND SUMMARIES — ALWAYS CORRECT AFTER EDITS ----
  renderHoleSummary();      // ← current hole carry summary
  renderRoundSummary();     // ← bottom round summary (Wins / C_Car / O_Car)

  updateCourseInfoBar();
  updateNavButtons();
  save();
  if (debugMode) renderDebugCarryTable();

  
  
}
 
  function updateCourseInfoBar() {
  if (!inRound || !currentCourse) {
    els.courseInfoBar.style.display = 'none';
    return;
  }

  // NEW: Safely get the course object (works whether currentCourse is object or old index)
  const course = typeof currentCourse === 'object' ? currentCourse : courses[currentCourse];
  
  if (!course || !course.pars || !course.pars[currentHole - 1]) {
    els.courseInfoBar.style.display = 'none';
    return;
  }

  els.infoCourseName.textContent = course.name;
  els.infoCurrentHole.textContent = currentHole;
  els.infoPar.textContent = `Par ${course.pars[currentHole - 1]}`;

  els.courseInfoBar.style.display = 'block';
}
  



  function renderTable(carryIn, isFinished) {
    if (!els.scoreTable || !els.scoreTable.tBodies || !els.scoreTable.tBodies[0]) return;
    const tbody = els.scoreTable.tBodies[0];
    tbody.innerHTML = '';

    const holeIdx = currentHole - 1;
    const par = courses[currentCourse].pars[holeIdx];
    const isPar3 = par === 3;

    players.forEach(p => {
      const s = p.scores[holeIdx] || {};
      const row = tbody.insertRow();

      row.insertCell().textContent = p.name;
      row.cells[0].className = 'player-name';

      const createCheckbox = (point) => {
        const cell = row.insertCell();
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = !!s[point];
        input.disabled = isFinished;
        input.onclick = (e) => {
           e.preventDefault(); // Stop double-tap zoom on iOS
           toggleScore(p, holeIdx, point);
    };
        cell.appendChild(input);
      };

      createCheckbox('firstOn');
      createCheckbox('closest');
      createCheckbox('putt');

      const holeCell = row.insertCell();
if (isFinished) {
  const s = p.scores[holeIdx] || {};
  const counts = { FO: 0, GR: 0, CL: 0, P: 0 };

  // Base win on this hole (always 1 if won)
  if (s.firstOn) counts[isPar3 ? 'GR' : 'FO'] += 1;
  if (s.closest) counts.CL += 1;
  if (s.putt) counts.P += 1;

  // Add carries
  if (s.firstOn) counts[isPar3 ? 'GR' : 'FO'] += (isPar3 ? carryIn.greenie : carryIn.firstOn);
  if (s.closest) counts.CL += carryIn.closest;
  if (s.putt) counts.P += carryIn.putt;

  const totalPts = p._cachedHoleTotals?.[holeIdx] || 0;

  // Build label like "6GR" "3P" "2FO•CL"
  const parts = [];
  if (counts.GR > 0) parts.push(`${counts.GR}GR`);
  if (counts.FO > 0) parts.push(`${counts.FO}FO`);
  if (counts.CL > 0) parts.push(`${counts.CL}CL`);
  if (counts.P  > 0) parts.push(`${counts.P}P`);

  const labelText = parts.length > 0 ? parts.join(' • ') : '—';

  holeCell.innerHTML = `
    <div style="font-size:0.85rem;line-height:1.3;text-align:center;">
      <strong style="font-size:1.1em;">${totalPts}</strong><br>
      <small style="color:#888;">${labelText}</small>
    </div>
  `;
} else {
  holeCell.textContent = '—';
  holeCell.style.color = '#666';
}

      const runCell = row.insertCell();
      runCell.textContent = getRunningTotal(p);
      runCell.style.fontWeight = '600';
      runCell.style.color = '#0a0';

      const totalCell = row.insertCell();
      totalCell.textContent = p._cachedTotal || 0;
      totalCell.style.fontWeight = '600';
    });
  }
 

// Always show the correct carry summary — works after edits too
/* const currentCarryIn = getCarryInForHole(currentHole);
const nextCarryOut = getCarryInForHole(currentHole + 1);

let summaryText = '';
if (currentCarryIn.firstOn || currentCarryIn.closest || currentCarryIn.putt || currentCarryIn.greenie) {
  const parts = [];
  if (currentCarryIn.firstOn) parts.push(`FO: +${currentCarryIn.firstOn}`);
  if (currentCarryIn.closest) parts.push(`CL: +${currentCarryIn.closest}`);
  if (currentCarryIn.putt) parts.push(`P: +${currentCarryIn.putt}`);
  if (currentCarryIn.greenie) parts.push(`GR: +${currentCarryIn.greenie}`);
  summaryText = `<strong>Available Carry:</strong> ${parts.join(' • ')}`;
} else if (isFinished) {
  summaryText = `<strong>Open Carry:</strong> ${nextCarryOut.firstOn + nextCarryOut.closest + nextCarryOut.putt + nextCarryOut.greenie}`;
} else {
  summaryText = `<strong>Open Carry: 0</strong>`;
}

els.holeSummary.innerHTML = `<div class="summary-carry-in">${summaryText}</div>`;

 */
   
function renderRoundSummary() {
  if (!els.roundSummary) return;

  let wins = 0;
  players.forEach(p => wins += p._cachedTotal || 0);

  const expected = finishedHoles.size * 3;
  const openCarry = expected - wins;

  els.roundSummary.innerHTML = `
    <div>
      Wins: <strong>${wins}</strong> + Open Carry: <strong>${open}</strong> = <strong>${wins + open}</strong>
      <small>Expected Pts: ${finishedHoles.size} Holes × 3 = ${expected}</small>
    </div>
  `;


  els.roundSummary.classList.remove('hidden');
}

function renderHoleSummary() {
  if (!els.holeSummary) return;

  // Always calculate fresh carry-in for the hole we are currently looking at
  const carryIn = getCarryInForHole(currentHole);

  const parts = [];
  if (carryIn.firstOn)  parts.push(`FO: +${carryIn.firstOn}`);
  if (carryIn.closest) parts.push(`CL: +${carryIn.closest}`);
  if (carryIn.putt)     parts.push(`P: +${carryIn.putt}`);
  if (carryIn.greenie)  parts.push(`GR: +${carryIn.greenie}`);

  let text = '';
  if (parts.length > 0) {
    text = `<strong>Available Carry:</strong> ${parts.join(' • ')}`;
  } else if (finishedHoles.has(currentHole)) {
    const nextCarry = getCarryInForHole(currentHole + 1);
    const totalOpen = nextCarry.firstOn + nextCarry.closest + nextCarry.putt + nextCarry.greenie;
    text = totalOpen > 0 ? `<strong>Open Carry:</strong> ${totalOpen}` : `<strong>Open Carry: 0</strong>`;
  } else {
    text = `<strong>Open Carry: 0</strong>`;
  }

  els.holeSummary.innerHTML = `<div class="summary-carry-in">${text}</div>`;
}


    function toggleScore(player, holeIdx, point) {
    const currentHoleIdx = currentHole - 1;
    if (holeIdx === currentHoleIdx && !isHoleInProgress) {
      const hasAnyScore = players.some(p => {
        const s = p.scores[holeIdx] || {};
        return s.firstOn || s.closest || s.putt;
      });
      if (!hasAnyScore) {
        lockNavigation();
      }
    }

    const score = player.scores[holeIdx];
    const wasChecked = !!score[point];
    const willBeChecked = !wasChecked;

    if (willBeChecked) {
      const otherHasIt = players.some((p, j) => {
        return j !== players.indexOf(player) && p.scores[holeIdx] && p.scores[holeIdx][point];
      });
      if (otherHasIt) {
        alert('Only one winner per point!');
        return;
      }
    }

    score[point] = willBeChecked;
    save();
    precomputeAllTotals();
    updateHole();
  }

function finishCurrentHole() {
  finishedHoles.add(currentHole);
  isHoleInProgress = false;   // unlocks Next

  precomputeAllTotals();
  updateHole();
  logScreen('FINISHED HOLE ' + currentHole);
}


  function simulateRound() {
    if (inRound) {
      if (!confirm('End current round and start simulation?')) return;
      resetRound();
    }

    if (courses.length === 0) {
      alert('No courses found!');
      return;
    }
    currentCourse = 0;
    localStorage.setItem('bbb_currentCourse', currentCourse);

    if (roster.length < 2) {
      alert('Need at least 2 players in roster!');
      return;
    }
    players = roster.slice(0, 4).map(p => ({
      ...p,
      scores: Array(HOLES).fill(null).map(() => ({})),
      gir: Array(HOLES).fill(false),
      _cachedTotal: 0,
      _cachedHoleTotals: {}
    }));

    currentHole = 1;
    finishedHoles.clear();
    inRound = true;

    const names = players.map(p => p.name);
    const binomialSuccess = (p) => Math.random() < p;

    for (let h = 1; h <= HOLES; h++) {
      currentHole = h;
      const holeIdx = h - 1;
      const par = courses[currentCourse].pars[holeIdx];

      const firstOnWinner = binomialSuccess(0.90) ? names[Math.floor(Math.random() * names.length)] : null;
      const closestWinner = binomialSuccess(0.99) ? names[Math.floor(Math.random() * names.length)] : null;
      const puttWinner = binomialSuccess(0.80) ? names[Math.floor(Math.random() * names.length)] : null;

      if (firstOnWinner) players.find(p => p.name === firstOnWinner).scores[holeIdx].firstOn = true;
      if (closestWinner) players.find(p => p.name === closestWinner).scores[holeIdx].closest = true;
      if (puttWinner) players.find(p => p.name === puttWinner).scores[holeIdx].putt = true;

      finishedHoles.add(h);
    }

    precomputeAllTotals();
    updateHole();
    save();

    const playerTotal = players.reduce((sum, p) => sum + p._cachedTotal, 0);
    const carry = getCarryInForHole(HOLES + 1);
    const totalCarry = carry.firstOn + carry.closest + carry.putt + carry.greenie;

    els.simResult.innerHTML = `
      <div style="margin:1rem 0;padding:1rem;background:#e6f7e6;border-radius:8px;font-weight:600;color:#155724;">
        SIMULATION SUCCESSFUL!<br>
        18 holes • 54 total points<br>
        Players: ${playerTotal} • Carry: ${totalCarry}<br>
        <small style="color:#0a0">
          VALIDATED: ${playerTotal} + ${totalCarry} = 54<br>
          ${playerTotal === 54 && totalCarry === 0 ? 'All points awarded!' : 'ERROR'}
        </small>
      </div>
    `;

    logScreen('SIMULATION COMPLETE');
  }

  function setupGameButtons() {
    if (!inRound || currentCourse === null || !courses[currentCourse]) return;

    els.sendSMS.onclick = () => {
      const holeIdx = currentHole - 1;
      const par = courses[currentCourse].pars[holeIdx];
      const isPar3 = par === 3;
      let message = `BBB - H${currentHole} (P${par})\n\n`;
      players.forEach(p => {
        const s = p.scores[holeIdx] || {};
        const pts = p._cachedHoleTotals?.[holeIdx] || 0;
        const notes = [];
        if (s.firstOn) notes.push(isPar3 ? 'GR' : 'FO');
        if (s.closest) notes.push('CL');
        if (s.putt) notes.push('P');
        message += `${p.name}: ${pts}${notes.length ? ` (${notes.join('/')})` : ''} | Run: ${getRunningTotal(p)}\n`;
      });
      const carryOut = getCarryInForHole(currentHole + 1);
      const carryTotal = carryOut.firstOn + carryOut.closest + carryOut.putt + carryOut.greenie;
      message += `\nCarry: ${carryTotal}\n\nStandings:\n`;
      players.sort((a, b) => b._cachedTotal - a._cachedTotal);
      players.forEach((p, i) => {
        message += `${i+1}. ${p.name}: ${p._cachedTotal}\n`;
      });
      const phones = players.map(p => p.phone).filter(Boolean).join(',');
      if (!phones) return alert('Add phone numbers');
      window.location.href = `sms:${phones}?body=${encodeURIComponent(message)}`;
    };

    els.exportCSV.onclick = exportToCSV;
  }

  function exportToCSV() {
    const course = courses[currentCourse];
    let csv = `Hole,Par,Player,FO,CL,P,GR,GIR,HolePts,Run,Tot\n`;
    for (let h = 0; h < HOLES; h++) {
      if (!finishedHoles.has(h+1)) continue;
      const par = course.pars[h];
      const isPar3 = par === 3;
      players.forEach(p => {
        const s = p.scores[h] || {};
        const gir = p.gir[h] ? 1 : 0;
        const holePts = p._cachedHoleTotals?.[h] || 0;
        const run = getRunningTotal(p);
        const tot = p._cachedTotal || 0;
        csv += `${h+1},${par},${p.name},${s.firstOn||0},${s.closest||0},${s.putt||0},${isPar3 && s.firstOn ? 1 : 0},${gir},${holePts},${run},${tot}\n`;
      });
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `BBB_${course.name.replace(/ /g, '_')}_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function showSummary() {
    hideAll();
    els.summary.classList.remove('hidden');
    const totals = players.map(p => ({ name: p.name, points: p._cachedTotal || 0 }));
    totals.sort((a,b) => b.points - a.points);
    els.leaderboard.innerHTML = '';
    totals.forEach(t => {
      const li = document.createElement('li');
      li.textContent = `${t.name}: ${t.points} pts`;
      els.leaderboard.appendChild(li);
    });
    
  }

 els.completeRound.addEventListener('click', () => {
  if (finishedHoles.size !== HOLES) {
    alert(`Finish all ${HOLES} holes first.`);
    return;
  }

  precomputeAllTotals();

  // 1. Show the nice leaderboard screen first
  showSummary();

  // 2. Auto-email the CSV to you (Walt)
  emailRoundToWalt();

  // 3. Optional: give them a second to read it, then offer New Round
  setTimeout(() => {
    if (confirm('Round complete – summary emailed to Walt!\n\nStart a new round?')) {
      resetRound();
      hideAll();
      els.courseSetup.classList.remove('hidden');
    }
  }, 500);
});

  els.exitRound.addEventListener('click', () => {
    if (confirm('Exit without saving?')) {
      resetRound();
      /* els.historyBtn.disabled = false; */
      location.reload();
    }
  });

 

  function resetRound() {
    localStorage.removeItem('bbb');
    inRound = false;
    players = [];
    currentCourse = null;
    currentHole = 1;
    finishedHoles.clear();
  }

  

   

 
function attachFinishHoleListener() {
  const btn = document.getElementById('finishHole');
  if (!btn) return;
  btn.onclick = null; // clear any old listener
  btn.onclick = finishCurrentHole; // direct assignment — never fails
}

function attachNavListeners() {
  // Prev
  const prev = document.getElementById('prevHole');
  if (prev) {
    prev.onclick = null;
    prev.addEventListener('click', () => {
      if (currentHole > 1 && !isHoleInProgress) {
        currentHole--;
        updateHole();
        updateCourseInfoBar();
        logScreen(`PREV → HOLE ${currentHole}`);
      }
    });
  }

  // Next
  const next = document.getElementById('nextHole');
  if (next) {
    next.onclick = null;
    next.addEventListener('click', () => {
      if (currentHole < HOLES && !isHoleInProgress) {
        currentHole++;
        updateHole();
        updateCourseInfoBar();
        logScreen(`NEXT → HOLE ${currentHole}`);
      }
    });
  }

  // Edit
  const edit = document.getElementById('editHole');
  if (edit) {
    edit.onclick = null;
    edit.addEventListener('click', () => {
      if (finishedHoles.has(currentHole)) {
        finishedHoles.delete(currentHole);
        isHoleInProgress = false;
        precomputeAllTotals();
        updateHole();
        logScreen('EDIT MODE');
      }
    });
  }
}





  
  

  els.backToSetup.forEach(btn => {
    btn.addEventListener('click', () => {
      hideAll();
      logScreen('BACK TO SETUP');
    });
  });
});

 

