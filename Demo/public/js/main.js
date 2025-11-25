/* =========================
   Firebase Setup
========================= */
const firebaseConfig = {
  apiKey: "AIzaSyB67GerJlAu15rw8vOzvEjEUQLxIC53Apg",
  authDomain: "gamesecai-28.firebaseapp.com",
  projectId: "gamesecai-28",
  storageBucket: "gamesecai-28.firebasestorage.app",
  messagingSenderId: "982650361273",
  appId: "1:982650361273:web:873dd0bb485ddbb87cd268"
};

// Initialize Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();
const generateQuizQuestion = functions.httpsCallable('generateQuizQuestion');

console.log("🔥 Firebase is ready! Database connected!");

/* =========================
   Gemini API Key Setup
========================= */
const GEMINI_API_KEY = "AIzaSyB8EzwfTNJNHLhvv5xHRCfZbLJ5XFTB6XY";
window.GEMINI_API_KEY = GEMINI_API_KEY;
window.GEMINI_MODEL = "gemini-2.5-flash";
const QUIZ_START_LEVEL = 'Medium';

/* =========================
   State & persistence
========================= */
const STORAGE_KEY = 'gamesecai_state_v2';
let defaultState = {
  user: { name: '', role: 'Student', isGuest: false },
  missions: { phishing: 30, password: 50, wifi: 0 },
  quizIndex: 0,
  quiz: [],
  log: [],
  stats: { attempted:0, correct:0, confTotal:0, hesitationSum:0 },
  users: [
    { name:"Alice", score:92, conf:4.8, role:"Student", hesitation:"6.2s", date:"2025-09-29" },
    { name:"Sravani", score:88, conf:4.5, role:"Intern", hesitation:"8.2s", date:"2025-09-28" },
    { name:"Shashanth", score:85, conf:4.2, role:"Developer", hesitation:"7.1s", date:"2025-09-27" }
  ],
  seenIntro: false,
  trendData: { labels: ['2025-09-20','2025-09-22','2025-09-24','2025-09-26','2025-09-28'], values: [82,78,75,73,72] }
};

let state = loadState();
// Create a fresh session object so quiz runtime does NOT mutate persistent state
let sess = {
  quizIndex: 0,
  quiz: [],
  log: [],
  stats: { attempted: 0, correct: 0, confTotal: 0, hesitationSum: 0 }
};

let USE_AI_QUIZ = true;  // Set to false to disable AI (offline mode)
let AI_FAILURE_COUNT = 0;
const MAX_AI_FAILURES = 3;
let _questionStarted = false;
let feedbackTimer = null;
let nextQuestionTimer = null;
let aiGenerationLock = false;




function loadState(){
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw) return JSON.parse(raw);
  } catch(e){ console.warn('loadState error', e); }
  return JSON.parse(JSON.stringify(defaultState));
}

function saveState(){
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch(e){ console.warn('saveState error', e); }
}



/* =========================
   User Authentication & Login
========================= */
function showLoginModal() {
  document.getElementById('loginModal').style.display = 'flex';
  document.getElementById('loginModal').classList.remove('hidden');
}

function hideLoginModal() {
  document.getElementById('loginModal').style.display = 'none';
  document.getElementById('loginModal').classList.add('hidden');
}

function setupPlayer() {
  // Check if user already has a name
  if (state.user && state.user.name && state.user.name !== '' && state.user.name !== 'Guest') {
    console.log("User already set up:", state.user.name);
    hideLoginModal();
updateAdminNavVisibility();
    return true;
  }
  
  // Show login modal if no user is set
  showLoginModal();
  return false;
}

// Login event handlers
document.getElementById('loginStart').addEventListener('click', () => {
  const nameInput = document.getElementById('playerNameInput');
  const roleSelect = document.getElementById('playerRoleSelect');
  const playerName = nameInput.value.trim();
  
  if (!playerName) {
    showToast("Please enter your name to continue!");
    return;
  }
  
  state.user = { 
    name: playerName, 
    role: roleSelect.value,
    isGuest: false
  };
  saveState();
  hideLoginModal();
updateAdminNavVisibility();
renderDashboard(); 
  showToast(`Welcome, ${playerName}! 🦸‍♂️`);
 gotoView('landing');

});

document.getElementById('loginGuest').addEventListener('click', () => {
  state.user = { 
    name: "Guest", 
    role: 'Student',
    isGuest: true 
  };
  saveState();
  hideLoginModal();
updateAdminNavVisibility();
renderDashboard(); 
  showToast("Continuing as Guest");
  gotoView('landing');

});

function logout() {
  if (confirm('Are you sure you want to logout? Your progress will be saved.')) {
    state.user = { name: '', role: 'Student', isGuest: false };
    saveState();
updateAdminNavVisibility();
    showLoginModal();
    showToast("Logged out successfully");
  }
}


function updateAdminNavVisibility() {
  const adminBtn = document.getElementById('adminNavBtn');
  if (!adminBtn) return;

  if (state.user && state.user.role === 'Admin') {
    adminBtn.style.display = 'inline-block';   // show only for Admin
  } else {
    adminBtn.style.display = 'none';          // hide for everyone else
  }
}



/* =========================
   Question Loading
========================= */
async function loadQuestions() {
  try {
    const r = await fetch('./data/realtime_awareness_flat_for_app.json');
    if (!r.ok) throw new Error('JSON load failed');

    let fullQuizData = await r.json();

    // -----------------------------------------------------------------
    //  1. SORT BY ID (numeric) – this guarantees 1,2,3,… order
    // -----------------------------------------------------------------
    // ---- SORT BY ID (prevents Q1 → Q37) ----
fullQuizData.sort((a, b) => (parseInt(a.id, 10) || 0) - (parseInt(b.id, 10) || 0));

    // -----------------------------------------------------------------
    //  2. DEBUG – see the first 5 questions in the console
    // -----------------------------------------------------------------
    console.log(
      '%cQUIZ ORDER (first 5)',
      'color:#8b00ff;font-weight:bold',
      fullQuizData.slice(0, 5).map(q => ({ id: q.id, text: q.text.slice(0, 40) + '…' }))
    );

    sess.quiz = fullQuizData;
    sess.qTotal = fullQuizData.length;
    document.getElementById('qTotal').innerText = sess.qTotal;

    console.log(`Loaded ${fullQuizData.length} questions.`);
    
    // Only start quiz if user is logged in
    if (state.user && state.user.name) {
      startQuiz(QUIZ_START_LEVEL);
      renderQuiz();
    }
  } catch (error) {
    console.error('Error loading questions:', error);
    showToast('Error loading questions. Check console for details.');
  }
}
async function startQuiz(difficulty) {
  sess.quizIndex = 0;
  sess.log = [];
  sess.stats = { attempted:0, correct:0, confTotal:0, hesitationSum:0 };

  // -----------------------------------------------------------------
  //  DO NOT reload the quiz array here – it would overwrite the sorted
  //  version we just built in loadQuestions().
  // -----------------------------------------------------------------
  renderQuiz();
  _startTime = Date.now();
}

/* =========================
   Behavior Tracking
   ========================= */
let _hoverStart = null;
let _hoverTotalMs = 0;
let _prevChoice = null;
let _switches = 0;
let _startTime = 0; // canonical question start time
let _feedbackFired = false;
let _behaviourTrackingAttached = false;

function attachHoverTracking() {
  if (_behaviourTrackingAttached) return;
  _behaviourTrackingAttached = true;

  const answersEl = document.getElementById('answers');
  if (!answersEl) return;

  answersEl.addEventListener('mouseover', (e) => {
    if (e.target.classList.contains('answer') && !_hoverStart) {
      _hoverStart = Date.now();
    }
  }, true);

  answersEl.addEventListener('mouseout', (e) => {
    if (e.target.classList.contains('answer') && _hoverStart) {
      _hoverTotalMs += (Date.now() - _hoverStart);
      _hoverStart = null;
    }
  }, true);
}

// ---- Answer Switch Tracking ----
function attachAnswerSwitchTracking() {
  const answersEl = document.getElementById("answers");
  if (!answersEl) return;

  // Avoid duplicate listeners (only attach once per page load)
  if (answersEl._switchTrackingAttached) return;
  answersEl._switchTrackingAttached = true;

  answersEl.addEventListener("click", (e) => {
    const btn = e.target.closest(".answer");
    if (!btn) return;

    const choice = (btn.dataset.id || '').trim().toUpperCase();

    if (_prevChoice && _prevChoice !== choice) {
      _switches++;
      console.log("[SWITCH] from", _prevChoice, "to", choice, "total:", _switches);
    } else {
      console.log("[SWITCH] first choice:", choice, "total:", _switches);
    }

    _prevChoice = choice;
  });
}


/* =========================
   Gemini AI Helper
   ========================= */

/* simple HTML escape - for safety filter */
function escapeHtml(s){ 
  s = String(s);
  s = s.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  
  // Custom Safety filter: remove links, emails, phone numbers
  s = s.replace(/https?:\/\/\S+/gi, '[link]')
   .replace(/www\.[^\s]+/gi, '[link]')
   .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[email]')
   .replace(/\+?\d[\d\s\-\(\)]{7,}/g, '[number]');

  // Never show the option letter in AI response
  s = s.replace(/(correct(answer)? (is|was) ?: ?|option[: ]+) ?[A-D]\b/gi, '$1(omitted)');

  // Keep messages short
  if (s.length > 360) s = s.slice(0, 357) + '...';
  return s.trim();
}


/* =========================
   Gemini AI – Fixed with New Key
   ========================= */
async function geminiGenerate(prompt, config = {}, retries = 1) {
const url = `https://generativelanguage.googleapis.com/v1beta/models/${window.GEMINI_MODEL}:generateContent?key=${window.GEMINI_API_KEY}`;

  // 🧠 Build prompt text
  let promptText = "";
  if (Array.isArray(prompt)) {
    promptText = prompt.map(p => (typeof p === "string" ? p : p.parts?.[0]?.text || "")).join("\n");
  } else if (typeof prompt === "object" && prompt.parts) {
    promptText = prompt.parts.map(p => p.text).join("\n");
  } else {
    promptText = String(prompt);
  }

  // 🧩 Prepare body
  const body = {
    contents: [{ role: "user", parts: [{ text: promptText }] }],
    ...config
  };

  // 🔁 Retry logic
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        if (res.status === 503 && i < retries - 1) {
  console.warn(`Gemini overloaded, retrying in ${3 * (i + 1)}s...`);
  await new Promise(r => setTimeout(r, 300 * (i + 1)));
  continue;
}

throw new Error(`Gemini Error: ${err.error?.message || res.statusText}`);
      }

      const data = await res.json();
      console.log("[Gemini raw response]", data);
      return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || "";
    } catch (err) {
      console.warn("Gemini retry failed:", err.message);
      if (i === retries - 1) return "";
    }
  }

  return "";
}

/* =========================
   Background AI Question Generator
   ========================= */
async function queueAIQuestionInBackground() {
  // If AI is off or we already failed too many times, bail out
  if (!USE_AI_QUIZ) return;
  if (AI_FAILURE_COUNT >= MAX_AI_FAILURES) {
    console.warn("[AI] Max failure count reached, skipping background AI.");
    return;
  }

  // Don’t spam the API
  if (aiGenerationLock) {
    console.log("[AI] Background generation skipped: lock is active.");
    return;
  }

  aiGenerationLock = true;
  console.log("[AI] Background question generation started…");

  try {
    const persona = getRiskPersona(sess.log);

    const lastAnswers = sess.log.slice(-3).map(x =>
      `Q:${x.mission} | Correct:${x.correct} | Confidence:${x.confidence}`
    ).join("\n");

    const prompt = `Create a cybersecurity quiz question in this exact JSON format only:
{
  "status": "new_question",
  "question": {
    "id": "AI-${Date.now()}",
    "mission": "Phishing",
    "difficulty": "Medium", 
    "text": "A short cybersecurity question here?",
    "options": {
      "A": "Option A text",
      "B": "Option B text", 
      "C": "Option C text",
      "D": "Option D text"
    },
    "correct_option": "A",
    "why": "Brief security explanation",
    "action": "Practical security tip"
  }
}

Player profile: ${persona.title}
Recent performance: ${lastAnswers || "No recent answers"}
Generate a question that matches their skill level.`;

    // 👇 Call your existing Gemini helper (we’ll make it lighter in Step 3)
    const rawText = await geminiGenerate(prompt);

    if (!rawText) {
      console.warn("[AI] Gemini returned empty text (background).");
      AI_FAILURE_COUNT++;
      return;
    }

    // Clean up ```json fences etc.
    let cleanedText = rawText.trim()
      .replace(/```json/gi, '')
      .replace(/```/g, '')
      .trim();

    let ai;
    try {
      ai = JSON.parse(cleanedText);
    } catch (err) {
      console.error("[AI] JSON parse failed (background):", err.message);
      console.error("Problematic text was:", cleanedText);
      AI_FAILURE_COUNT++;
      return;
    }

    if (!ai || ai.status !== "new_question" || !ai.question) {
      console.warn("[AI] Background AI did not return valid question structure.");
      AI_FAILURE_COUNT++;
      return;
    }

    const q = ai.question;

    // Validate minimal fields
    if (!q.text || !q.options || !q.correct_option) {
      console.warn("[AI] Background AI question missing fields.");
      AI_FAILURE_COUNT++;
      return;
    }

    // Ensure id + flag
    q.id = q.id || `gen_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    q._aiGenerated = true;

    sess.quiz.push(q);
    AI_FAILURE_COUNT = 0; // reset on success

    console.log("[AI BACKGROUND] New question added:", q.id);
  } catch (err) {
    AI_FAILURE_COUNT++;
    console.error("[AI BACKGROUND] Generation failed:", err);
  } finally {
    aiGenerationLock = false;
  }
}



/* =========================
   AI Features
   ========================= */

// AI Hint for current question (called by button)
function aiHintForCurrent() {
  const q = sess.quiz[sess.quizIndex];
  if (!q) return;

  // Convert options to array safely (supports array OR object)
  let optionsArray = [];
  if (Array.isArray(q.options)) {
    optionsArray = q.options;
  } else if (typeof q.options === 'object' && q.options !== null) {
    optionsArray = Object.entries(q.options).map(([id, text]) => ({ id, text }));
  } else {
    console.warn("Invalid q.options format in aiHintForCurrent:", q.options);
    return;
  }

  // Build prompt for Gemini
  const prompt = `
You are a cybersecurity mentor. The user is stuck on this question:
"${q.text}"

Options:
${optionsArray.map(o => `${o.id}: ${o.text}`).join('\n')}

Correct answer is "${q.correct_option}".

Give a short, subtle hint (1 sentence) that guides them without revealing the answer.
`;

  geminiGenerate([prompt])
    .then(hint => {
      document.getElementById('aiHint').textContent = hint.trim();
      document.getElementById('aiHint').style.display = 'block';
    })
    .catch(err => {
      console.error("AI Hint failed:", err);
      document.getElementById('aiHint').textContent = "Hint unavailable.";
      document.getElementById('aiHint').style.display = 'block';
    });
}
/* =========================
   AI Explain Why/What-to-do (After Submission)
   ========================= */
async function aiExplainLast() {
  const box = document.getElementById('feedbackAiExplain');  // Renamed ID
  if (!box || !USE_AI_QUIZ) {
    box.innerHTML = '<em>AI offline—check feedback note above.</em>';
    box.style.display = 'block';
    return;
  }

  box.innerHTML = '<em>Generating detailed explanation...</em>';
  box.style.display = 'block';

  const last = sess.log[sess.log.length - 1];
  if (!last) return;

  const q = sess.quiz.find(item => item.id === last.id);
  if (!q) { box.innerHTML = 'Could not find question details for explanation.'; return; }

  const chosenText = q.options.find(opt => opt.id === last.chosen)?.text || 'The option text was not found.';
  const correctText = q.options.find(opt => opt.id === last.correct_option)?.text || 'The correct option text was not found.';
  
  const correctness = last.correct ? 'Correct' : 'Incorrect';
  
  const prompt = [
    'You are a cybersecurity educator providing detailed, non-judgmental feedback. Give a 3-4 sentence explanation focusing on the core security principle.',
    `**Question:** "${q.text}"`,
    `**User's Choice:** "${chosenText}" (Result: ${correctness})`,
    `**Correct Answer:** "${correctText}"`,
    'Output must clearly state the security principle, explain why the correct choice is the best defense, and if the user was incorrect, briefly explain the flaw in their chosen option. Do NOT use option letters (A, B, C, D).'
  ];

  // Define threatTool if not already (add globally if missing)
  const threatTool = { google_search: {} };  // Simple tool for recent threats

  let txt;
  try {
    txt = await geminiGenerate(prompt);
} catch (e) {
    console.error('AI Explain Error:', e);
    box.innerHTML = '<em>AI unavailable—quota or error. Use feedback note.</em>';
    return;
  }

  // Parse if response is JSON-like
  let aiResponse = txt;
  try {
    aiResponse = JSON.parse(txt).explanation || txt;  // Fallback to text
  } catch {}

  box.innerHTML = `<strong>Explanation:</strong> ${escapeHtml(aiResponse)}`;
}


// AI Coach Feedback (called after submit)
async function coachFeedback() {
  const coachNote = document.getElementById('feedbackCoachNote');  // Renamed ID
  if (!coachNote || !USE_AI_QUIZ) {
    coachNote.innerHTML = '<em>AI offline—using basic feedback.</em>';
    coachNote.style.display = 'block';
    return;
  }

  coachNote.innerHTML = 'Generating coach note...';
  
  const last = sess.log[sess.log.length - 1];
  if (!last) return;
  
  const correct = last.correct ? 'correct' : 'incorrect';
  const confidence = last.confidence;
  const time = last.time_ms / 1000;
  const mission = last.mission;

  const prompt = [
    'You are a friendly, encouraging security coach. Give a 1-2 sentence motivational note. Mention mission and consider correctness, confidence (1-5), and speed (time in seconds).',
    `User result: ${correct} on ${mission} mission. Confidence: ${confidence}/5. Time to respond: ${time.toFixed(1)} seconds.`,
    'Be encouraging. Do not give the quiz answer or explanation.'
  ];

  let txt;
  try {
    txt = await geminiGenerate(prompt);
  } catch (e) {
    console.error('Coach Feedback Error:', e);
    coachNote.innerHTML = '<em>Feedback not available—keep training!</em>';
    return;
  }

  coachNote.style.display = 'block';
  coachNote.innerHTML = `<strong>Coach Note:</strong> ${escapeHtml(txt)}`;
}
/* =========================
   Small UI helpers
   ========================= */
function showToast(msg, timeout=2200){
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=> t.classList.remove('show'), timeout);
}

// Helper to format ms to readable string
function msPretty(ms) {
    if (ms === 0) return '0s';
    const totalSeconds = ms / 1000;
    if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = (totalSeconds % 60).toFixed(0);
    return `${minutes}m ${seconds}s`;
}

/* =========================
   Navigation & view switching (with fade)
   ========================= */
function hideAllViews() { 
  document.querySelectorAll('.view').forEach(v => v.style.display = 'none'); 
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active')); 
}

function gotoView(viewId) {

// Prevent unauthorized access to admin panel
if (viewId === "admin" && state.user.role !== "Admin") {
    showToast("❌ Access Denied — Admins Only");
    return;
}

  // Hide all views + clear active tabs
  hideAllViews();
  
  // Show the target view
  const target = document.getElementById(viewId);
  if (target) target.style.display = 'block';
  
  // Render specific view logic
  if (viewId === 'quiz') {
    renderQuiz();
  }
if (viewId === "dashboard" || viewId === "results" || viewId === "leaderboard") {
    renderLeaderboard();
}
if (viewId === "dashboard" || viewId === "leaderboard") {
    renderSidebarLeaderboard();
}


  // (Optional) set active tab if you have tabs linked by data-view
  const tab = document.querySelector(`.tab[data-tab="${viewId}"]`);

  if (tab) tab.classList.add('active');
  
  state.lastView = viewId;
  saveState();
  console.log('View switched to:', viewId);
}

/* =========================
   Dashboard rendering
   ========================= */
function renderDashboard(){
  document.getElementById('userName').textContent = state.user.name;
  const dash = document.getElementById('dashboardMissions');
  dash.innerHTML = '';
  const map = {
    phishing: { title: "Phishing", desc:"Identify phishing emails & suspicious links" },
    password: { title:"Password Attacks", desc:"Strengthen passwords & best practices" },
    wifi: { title:"Wi-Fi Spoofing", desc:"Recognize rogue hotspots" }
  };
  Object.keys(state.missions).forEach(k => {
    // FIX: Check if the key 'k' has a corresponding definition in 'map'
    if (!map[k]) {
        console.warn(`[renderDashboard] Skipping unknown mission key: ${k}`);
        return; 
    }
    const val = state.missions[k];
    const div = document.createElement('div');
    div.className = 'missionRow';
    div.innerHTML = `<div style="flex:1">
      <div class="missionTitle">${map[k].title}</div>
      <div class="mutedSmall">${map[k].desc}</div>
      <div class="progressWrap" style="margin-top:8px"><div class="bar" style="width:${val}%"></div></div>
    </div>
    <div style="width:120px;text-align:right">
      <div class="mutedSmall">${val}%</div>
      <div style="margin-top:8px"><button class="btn ghost" onclick="gotoView('quiz')">Train</button></div>
    </div>`;
    dash.appendChild(div);
  });

// Show/hide admin nav button based on role
const adminBtn = document.getElementById('adminNavBtn');

if (state.user.role === "Admin") {
    adminBtn.style.display = "block";
} else {
    adminBtn.style.display = "none";
}

  renderMissions(); recalcRisk();
}
/* =========================
   Risk calculation & profile values
   ========================= */
function recalcRisk() {
  const avgMission = Math.round(
    (state.missions.phishing + state.missions.password + state.missions.wifi) / 3
  );
  const riskScore = Math.max(0, 100 - avgMission);

  // Update results screen
  const riskEl = document.getElementById('resRisk');
  if (riskEl) riskEl.textContent = riskScore + '%';

  // Optional: Update dashboard risk
  const dashRisk = document.getElementById('dashboardRisk');
  if (dashRisk) dashRisk.textContent = riskScore + '%';

  // Optional: Color code
  if (riskEl) {
    riskEl.style.color = riskScore > 70 ? '#ff4d6d' : riskScore > 40 ? '#ffb347' : '#39ff14';
  }
}

/* helper to set mission progress */
function setMissionProgress(key, value){
  state.missions[key] = Math.max(0, Math.min(100, Math.round(value)));
  saveState();
  recalcRisk();
  renderDashboard();
}

/* ======================================
   GLOBAL FLAGS / SESSION STATES
====================================== */
let FEEDBACK_MODE = false;   // <--- ADD HERE


/* =========================
   Quiz rendering & logic
   ========================= */
function renderQuiz() {
  const q = sess.quiz[sess.quizIndex];
  if (!q) {
    document.getElementById('qText').textContent = `Quiz finished or no questions loaded.`;
    document.getElementById('answers').innerHTML = '';
    return;
  }

  // 🔄 RESET AI HINT FOR NEW QUESTION
  const hintBox = document.getElementById('aiHint');
  if (hintBox) {
    hintBox.textContent = '';          // clear old hint text
    hintBox.style.display = 'none';    // hide until user asks again
  }

  // ---------- QUESTION TEXT & DYNAMIC COUNTER ----------
  // Count how many *distinct* questions have been answered so far
  const answeredUnique = sess.log
    ? new Set(sess.log.map(e => e.id)).size
    : 0;

  const currentNumber = answeredUnique + 1;
  const totalNumber   = sess.targetQuestions || sess.quiz.length;

  document.getElementById('qText').textContent = `Q${currentNumber}. ${q.text}`;
  document.getElementById('qIndex').textContent = currentNumber;
  document.getElementById('qTotal').textContent = totalNumber;


  /* ---------- ANSWERS (array OR object) ---------- */
  const ansEl = document.getElementById('answers');
  ansEl.innerHTML = ''; // clear old options
  let optionsArray = [];
  if (Array.isArray(q.options)) {
    optionsArray = q.options; // local questions
  } else if (typeof q.options === 'object' && q.options !== null) {
    // AI-generated → {A:"…", B:"…", …}
    optionsArray = Object.entries(q.options).map(([id, text]) => ({ id, text }));
  }
  optionsArray.forEach(opt => {
    const div = document.createElement('div');
    div.className = 'answer';
    div.setAttribute('role', 'option');
    div.tabIndex = 0;
    div.dataset.id = opt.id;
    div.textContent = `${opt.id}: ${opt.text}`;
    div.onclick = () => selectAnswer(div);
    div.onkeydown = e => { if (e.key === 'Enter') selectAnswer(div); };
    ansEl.appendChild(div);
  });

   /* ---------- CONFIDENCE & STATS ---------- */
  // Reset per-question trackers for the new question
  _hoverTotalMs = 0;
  _hoverStart   = null;
  _switches     = 0;
  _prevChoice   = null;

  // Reset question timing
  _questionStarted = false;
  _startTime       = Date.now();

  // Show current confidence stars
  renderConfidenceStars(getConfidence());

  /* ---------- BEHAVIOUR TRACKING ---------- */
  attachHoverTracking();
  attachAnswerSwitchTracking();
}


/* answer selection */
function selectAnswer(div){
  document.querySelectorAll('.answer').forEach(a => a.classList.remove('selected'));
  div.classList.add('selected');
}


function submitAnswer() {
  const selected = document.querySelector('.answer.selected');
  if (!selected) {
    showToast('Please select an answer!');
    return;
  }

  const q = sess.quiz[sess.quizIndex];

  // Normalise chosen option (letter)
  const chosen = (selected.dataset.id || '').trim().toUpperCase();

  // Support multiple possible correct-answer fields
  const rawCorrect =
    q.correct_option ??
    q.correctOption ??
    q.correct_answer ??
    q.answer ??
    q.correct ??
    null;

  const correctKey = rawCorrect == null
    ? ''
    : String(rawCorrect).trim().toUpperCase();

  const correct = chosen === correctKey;

  // ---- timing & behaviour tracking ----
  const timeMs = Date.now() - _startTime;
  const hoverMs = _hoverTotalMs + (_hoverStart ? (Date.now() - _hoverStart) : 0);

  // ---- SAVE LOG ENTRY ----
  sess.log.push({
    id: q.id,
    chosen,
    // store the *normalised* correct letter so the feedback UI & AI explanation can use it
    correct_option: correctKey,
    correct,
    confidence: getConfidence(),
    time_ms: timeMs,
    hoverMs,
    answerSwitches: _switches,
    mission: q.mission
  });

  // ---- Update global stats ----
  sess.stats.attempted++;
  if (correct) sess.stats.correct++;
  sess.stats.confTotal += sess.log[sess.log.length - 1].confidence;
  sess.stats.hesitationSum += timeMs / 1000;

  // ---- Reset trackers for next question ----
  _hoverTotalMs = 0;
  _hoverStart = null;
  _switches = 0;
  _prevChoice = null;
  _questionStarted = false;

  // ---- Show feedback view ----
  showFeedback(correct);
}
  

function skipQuestion() {
  sess.quizIndex++;
  if (sess.quizIndex >= sess.quiz.length) {
    gotoResults();  // End quiz if no more questions
  } else {
    renderQuiz();   // Show next question
  }
}

// Unified confidence getter/setter (UI uses stars -> sess.currentConf)
function setConfidence(val){
  sess.currentConf = Math.max(1, Math.min(5, parseInt(val || 3)));
  renderConfidenceStars(sess.currentConf);
  saveState();
}

function getConfidence(){
  // fallback to 3 if not set
  return sess.currentConf || 3;
}

function renderConfidenceStars(currentValue = 3) {
  const container = document.getElementById('confidenceStars');
  if (!container) return;
  
  container.innerHTML = ''; // Clear existing stars
  
  for (let i = 1; i <= 5; i++) {
    const star = document.createElement('span');
    star.className = `confidence-star ${i <= currentValue ? 'active' : ''}`;
    star.textContent = i <= currentValue ? '★' : '☆';
    star.style.cursor = 'pointer';
    star.style.marginRight = '4px';
    star.style.color = i <= currentValue ? '#ffd700' : '#666';
    star.style.transition = 'color 0.2s';
    
    star.addEventListener('click', () => {
      setConfidence(i);
    });
    
    container.appendChild(star);
  }
}


/* --- Enhanced Feedback System (final version) --- */
let feedbackCountdownTimer = null;

/* Move from feedback view to the next question */
function nextQuestionFromFeedback() {
  // stop the countdown timer if it's still running
  clearInterval(feedbackCountdownTimer);
  feedbackCountdownTimer = null;

  // we're leaving feedback mode now
  FEEDBACK_MODE = false;

  // go to the next question (this will render + gotoView('quiz'))
  nextQuestion();
}


function showFeedback(isCorrect) {
  const feedbackResult = document.getElementById("feedbackResult");  // Main header
  const feedbackText = document.getElementById("feedbackText");  // Extra text/body
  const countdownEl = document.getElementById("feedbackCountdown");

  const q = sess.quiz[sess.quizIndex];
  const log = sess.log[sess.log.length - 1];

  // --- Behavior insights ---
  const hesitation = (log.time_ms / 1000).toFixed(1);
    const switches = log.answerSwitches || 0;

  // --- Personalized explanation ---
  let explanation = "";
  if (q.why) explanation += `<p><b>Why:</b> ${q.why}</p>`;
  if (q.action) explanation += `<p><b>Tip:</b> ${q.action}</p>`;

  // --- Adaptive AI coach feedback ---
let behaviorMsg = "";
const confidence = log.confidence || 3; // Get confidence from the log
if (hesitation > 12) behaviorMsg += "You hesitated quite a bit — next time trust your instincts after reading carefully. ";
if (switches > 2) behaviorMsg += "You switched answers multiple times; stay calm and evaluate options once. ";
if (confidence <= 2) behaviorMsg += "Low confidence noted. Review similar topics to boost certainty. ";
if (confidence >= 4 && isCorrect) behaviorMsg += "Great confidence and accuracy — keep it up!";
if (behaviorMsg === "") behaviorMsg = "Good effort on this question.";

  // --- Final assembled text (render to feedbackResult for header, feedbackText for body) ---
  feedbackResult.innerHTML = isCorrect ? "✅ Correct!" : "❌ Incorrect.";
  feedbackResult.style.color = isCorrect ? 'var(--success)' : 'var(--danger)';
  
  const aiMessage = `
  <div class="aiFeedback">
    ${explanation}
    <p><i>${behaviorMsg}</i></p>
    <p class="mutedSmall">⏱ Hesitation: ${hesitation}s | 🌟 Confidence: ${confidence}/5 | 🔁 Switches: ${switches}</p>
  </div>
`;
  feedbackText.innerHTML = aiMessage;  // Put detailed content here

  FEEDBACK_MODE = true;
gotoView("feedback");


  // --- Countdown to next question ---
  let seconds = 15;
  countdownEl.textContent = "Next in " + seconds + "s";
  clearInterval(feedbackCountdownTimer);
  feedbackCountdownTimer = setInterval(() => {
    seconds--;
    if (seconds <= 0) {
      clearInterval(feedbackCountdownTimer);
      nextQuestionFromFeedback();
    } else {
      countdownEl.textContent = "Next in " + seconds + "s";
    }
  }, 1000);
}
document.getElementById('feedbackNext').addEventListener('click', nextQuestionFromFeedback);
document.getElementById('feedbackFinish').addEventListener('click', gotoResults);


/* ✅ nextQuestion() — Instant version (AI in background) */
async function nextQuestion() {

  _questionStarted = false;

  // Clear any pending timer slot
  clearTimeout(nextQuestionTimer);
  nextQuestionTimer = setTimeout(() => {}, 0);

  // Don’t block on AI anymore ⛔ (removed aiGenerationLock check)

  if (FEEDBACK_MODE) {
    console.warn("⏳ Skipped nextQuestion — feedback still active");
    return;
  }

  // ⚡ NO artificial delay anymore
  // (Removed: await new Promise(res => setTimeout(res, 250));)

  try {
    const answeredIDs = new Set(sess.log.map(q => q.id));

// All questions not yet answered
const availableAny = sess.quiz.filter(q => !answeredIDs.has(q.id));

if (availableAny.length === 0) {
  showToast("You've completed all available questions!");
  gotoResults();
  return;
}

// ⭐ Prefer AI-generated questions if any are available
const availableAI = availableAny.filter(q => q._aiGenerated);
const pool = availableAI.length ? availableAI : availableAny;

// 👉 Pick the first from the chosen pool (you can randomize if you want)
const pick = pool[0];

let nextIndex = sess.quiz.findIndex(q => q.id === pick.id);
if (nextIndex === -1) {
  console.error("[nextQuestion] Could not map picked question back to index");
  nextIndex = 0;
}

sess.quizIndex = nextIndex;

  } 

catch (e) 

{
    console.error("Next question selection completely failed:", e);

    if (!sess.quiz || sess.quiz.length === 0) {
      showToast("No questions available!");
      gotoResults();
      return;
    }

    // Last-resort fallback
    sess.quizIndex = 0;
  }

  // 🔁 Reset behaviour tracking + timers for the new question
  _hoverStart = null; 
  _hoverTotalMs = 0;
  _prevChoice = null; 
  _switches = 0;
  _startTime = Date.now();

  // Persist + render UI
  saveState();
  renderQuiz();
  gotoView('quiz');

  // 🤖 Now, AFTER showing the question instantly, ask AI
  // to prepare future questions in the background
  queueAIQuestionInBackground();
}

//------------------------------------------------------
// ⭐ Save User Score to Leaderboard
//------------------------------------------------------
function saveUserToLeaderboard() {
  const score = Math.round((sess.stats.correct / sess.stats.attempted) * 100) || 0;
  const confAvg = (sess.stats.confTotal / sess.stats.attempted).toFixed(1);

  state.users.push({
    name: state.user.name || "Guest",
    score: score,
    conf: confAvg,
    role: state.user.role || "User",
    date: new Date().toISOString()
  });

  saveState();
}


document.getElementById('finishBtn').addEventListener('click', gotoResults);

function gotoResults() {

 saveUserToLeaderboard();

// 🛑 STOP any auto-next timers when entering results
if (window.feedbackCountdownTimer) {
    clearInterval(window.feedbackCountdownTimer);
    window.feedbackCountdownTimer = null;
}
if (window.nextQuestionTimer) {
    clearTimeout(window.nextQuestionTimer);
    window.nextQuestionTimer = null;
}
FEEDBACK_MODE = false;


  // ----- SAFETY: if no questions answered -----
  if (!sess || !Array.isArray(sess.log)) sess.log = [];

  const attempted = sess.log.length;
  const correct   = sess.log.filter(r => r.correct).length;

  const avgConf = attempted === 0
    ? 0
    : sess.log.reduce((a, b) => a + (b.confidence || 0), 0) / attempted;

  const avgHes = attempted === 0
    ? 0
    : sess.log.reduce((a, b) => a + (b.time_ms || 0), 0) / (attempted * 1000);

  const avgHover = attempted === 0
    ? 0
    : sess.log.reduce((a, b) => a + (b.hoverMs || 0), 0) / (attempted * 1000);

  const avgSwitch = attempted === 0
    ? 0
    : sess.log.reduce((a, b) => a + (b.answerSwitches || 0), 0) / attempted;

  // ----- Persona -----
  const persona = getRiskPersona(sess.log);
  document.getElementById('personaTitle').textContent = persona.title;
  document.getElementById('personaDesc').textContent  = persona.description;

  // ----- Basic stats (TOP CARD) -----
  document.getElementById('resCorrect').textContent = `${correct} / ${attempted}`;
  document.getElementById('resConf').textContent    = avgConf.toFixed(2);
  document.getElementById('resHes').textContent     = avgHes.toFixed(1) + 's';
  document.getElementById('resHover').textContent   = avgHover.toFixed(1) + 's';
  document.getElementById('resSwitch').textContent  = avgSwitch.toFixed(1);

  // If you later add "bottom" IDs, you can mirror into them here too.

  // ----- Risk score (reusing your mission-based calc) -----
  const riskScore = Math.max(
    0,
    100 - Math.round(
      (state.missions.phishing + state.missions.password + state.missions.wifi) / 3
    )
  );
  // recalcRisk() probably uses missions already, keep it:
  recalcRisk();

  // ----- GPT-style tips -----
  const tips = [
    'Don’t click unknown links',
    'Report suspicious messages to IT',
    'Use unique passphrases',
    'Use VPN on public Wi-Fi'
  ];
  const tipsEl = document.getElementById('gptTips');
  if (tipsEl) {
    tipsEl.innerHTML = '';
    tips.forEach(t => {
      const li = document.createElement('li');
      li.className = 'mutedSmall';
      li.textContent = t;
      tipsEl.appendChild(li);
    });
  }

  // ----- SAVE TO FIREBASE + LEADERBOARD -----
  if (attempted > 0 && state.user && state.user.name) {
    const quizData = {
      playerName:         state.user.name,
      playerRole:         state.user.role,
      playerIsGuest:      state.user.isGuest || false,
      score:              `${correct}/${attempted}`,
      riskScore:          riskScore,
      persona:            `${persona.title} ${persona.description}`,

      timestamp:          new Date(),
      missions:           state.missions,
      log:                sess.log,
      sessionId:          Date.now().toString()
    };

    const safeQuizData = JSON.parse(JSON.stringify(quizData)); // strip undefined

    db.collection("quizResults").add(safeQuizData)
      .then(docRef => {
        console.log("Quiz saved to Firebase! ID:", docRef.id);
        showToast("Quiz results saved under your name!");
        saveState();
        renderAdminTable();
        renderLeaderboard();
renderSidebarLeaderboard();
      })
      .catch(err => {
        console.error("Error saving quiz:", err);
        showToast("Couldn’t save to cloud, but that’s okay!");
      });
  }

  // ----- finally show results view -----
  gotoView('results');
}

function renderResults() {
  // This renders the results view (called from gotoView)
  // Your gotoResults() already sets UI – this ensures no error
  const attempted = sess.stats.attempted;
  const correct = sess.stats.correct;
  const avgConf = attempted === 0 ? 0 : (sess.stats.confTotal / attempted);
  const avgHes = attempted === 0 ? 0 : (sess.stats.hesitationSum / attempted);
  
  const persona = getRiskPersona(sess.log);
  document.getElementById('personaTitle').textContent = persona.title;
  document.getElementById('personaDesc').textContent = persona.description;
  document.getElementById('resCorrect').textContent = `${correct} / ${attempted}`;
  document.getElementById('resConf').textContent = avgConf.toFixed(2);
  document.getElementById('resHes').textContent = avgHes.toFixed(1) + 's';

  const avgHover = attempted === 0 ? 0 : sess.log.reduce((a,b)=>a+(b.hoverMs||0),0)/(attempted*1000);
  const avgSwitch = attempted === 0 ? 0 : sess.log.reduce((a,b)=>a+(b.answerSwitches||0),0)/attempted;
  document.getElementById('resHover').textContent = avgHover.toFixed(1) + 's';
  document.getElementById('resSwitch').textContent = avgSwitch.toFixed(1);

  recalcRisk();
  console.log('Results rendered');
}

/* retake */
function retakeQuiz() {
  if (!confirm('Reset quiz stats and start over?')) return;
  startQuiz(QUIZ_START_LEVEL);
  saveState();
  renderQuiz();
  renderDashboard();
  renderLeaderboard();  // ← add this
renderSidebarLeaderboard();

  gotoView('quiz');
}

/* =========================
   Chat (Gemini Enabled)
   ========================= */
async function postChat(){
  const box = document.getElementById('chatBox');
  const inputEl = document.getElementById('chatInput');
  const val = inputEl.value.trim();
  if(!val) return;

  // 1. Add User Message and clear input
  const p = document.createElement('div'); 
  p.style.marginBottom='6px'; p.style.color='#fff'; p.textContent = 'You: ' + val;
  box.appendChild(p);
  box.scrollTop = box.scrollHeight;
  inputEl.value = ''; 
  
  // 2. Add AI Loading Message
  const r = document.createElement('div'); 
  r.style.marginBottom='8px'; r.style.color = 'var(--muted)';
  r.innerHTML = 'AI: *Thinking...*';
  box.appendChild(r);
  box.scrollTop = box.scrollHeight;

  const prompt = [
    'You are a cybersecurity assistant named Cydor. Answer the user\'s question about cybersecurity, phishing, or password safety briefly and clearly.',
    `User Question: ${val}`
  ];

  try {
    const aiResponse = await geminiGenerate(prompt);
    // Use innerHTML to allow for simple formatting/new lines from AI
    r.innerHTML = `AI: ${aiResponse.replace(/\n/g, '<br>')}`; 
  } catch(e) {
    r.innerHTML = 'AI: Error connecting to Gemini API. Check your API key and browser console.';
    console.error('Chat API Error:', e);
  }
  
  // Scroll to bottom once response is fully loaded
  box.scrollTop = box.scrollHeight;
}
/* =========================
   Admin & Leaderboard
   ========================= */
function renderAdminTable() {
  const tbody = document.getElementById('adminSessionsTable');
  if (!tbody) {
    console.warn('Admin sessions table not found in DOM. Skipping render.');
    return;
  }
  tbody.innerHTML = '';
  state.users.slice().reverse().forEach(u => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
  <td>${u.name}</td>
  <td>${u.role}</td>
  <td>${u.score}</td>
  <td>${u.risk || "-"}</td>
  <td>${u.persona || "-"}</td>
  <td>${u.conf}</td>
  <td>${u.date}</td>
`;

    tbody.appendChild(tr);
  });
}

function renderLeaderboard() {
  const table = document.querySelector('#leaderTable tbody');
  if (!table) {
    console.warn('[renderLeaderboard] #leaderTable tbody not found');
    return;
  }

  table.innerHTML = '';

  // Sort by numeric score descending
  let arr = state.users.slice().sort((a, b) => {
    const sa = parseFloat(a.score) || 0;
    const sb = parseFloat(b.score) || 0;
    return sb - sa;
  });

  const filterEl = document.getElementById('roleFilter');
  const f = filterEl ? filterEl.value : 'all';
  if (f && f !== 'all') {
    arr = arr.filter(u => u.role === f);
  }

  const noEl = document.getElementById('leaderNo');
  if (arr.length === 0) {
    if (noEl) noEl.style.display = 'block';
    return;
  } else {
    if (noEl) noEl.style.display = 'none';
  }

  arr.forEach((u, idx) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${idx + 1}</td>
      <td>${u.name}</td>
      <td>${u.score}</td>
      <td>${u.conf}</td>
      <td>${u.role || '-'}</td>
    `;
    table.appendChild(tr);
  });
}

function filterLeaderboard(){ renderLeaderboard(); }

/* CSV export (admin) */
function downloadCSV(){
  // Use the full log (sess.log) for a complete export
  const logRows = [['id','mission','difficulty','chosen','correct_option','correct','confidence','time_ms','hoverMs','answerSwitches','points','why','action']];
  sess.log.forEach(l => logRows.push([
      l.id, l.mission, l.difficulty, l.chosen, l.correct_option, l.correct, l.confidence, l.time_ms, 
      l.hoverMs, l.answerSwitches, l.points, l.why, l.action
  ]));
  
  const csv = logRows.map(r => r.map(v => `"${(v+'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], {type: 'text/csv'}), url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = 'gamesecai_behavior_log.csv'; a.click();
  URL.revokeObjectURL(url);
  showToast('Behavior log exported');
}

/* =========================
   Missions & profile rendering
   ========================= */
function renderMissions(){
  document.getElementById('m1bar').style.width = state.missions.phishing + '%';
  document.getElementById('m2bar').style.width = state.missions.password + '%';
  document.getElementById('m3bar').style.width = state.missions.wifi + '%';
  recalcRisk();
}

function startMissionDemo(){ gotoView('quiz'); }
function simulateMissionComplete(key){ setMissionProgress(key, Math.min(100, state.missions[key] + 40)); renderMissions(); showToast('Mission simulated'); }

function renderProfile(){
  document.getElementById('profileName').textContent = state.user.name;
  document.getElementById('profileRole').textContent = state.user.role;
  document.getElementById('profileMissions').textContent = '2 / 5';
  const rs = document.getElementById('recentSessions'); rs.innerHTML = '';
  // Use sess.log for more accurate recent sessions if available
  const sessions = sess.log.slice(-3).reverse().map(l => 
    `${l.mission} (${l.correct_option === l.chosen ? 'Correct' : 'Wrong'}) - ${new Date().toLocaleDateString()}`
  );
  if (sessions.length === 0) sessions.push('No recent quiz sessions.');

  sessions.forEach(s => { const d = document.createElement('div'); d.className='mutedSmall'; d.style.marginBottom='6px'; d.textContent = s; rs.appendChild(d); });
}

/* =========================
   Reset and safety
   ========================= */
function confirmReset(){ if(confirm('Reset demo data?')) resetAll(); }

function resetAll(){
  state = JSON.parse(JSON.stringify(defaultState));
  state.seenIntro = true;
  saveState();
  showToast('Demo reset');
  // Reload questions and start quiz to ensure clean slate
  loadQuestions();
  renderDashboard(); renderAdminTable(); renderLeaderboard(); renderMissions();
  // We don't call renderQuiz() here as loadQuestions calls startQuiz which calls renderQuiz/selectNextQuestion
}

/* =========================
   Inline warnings (no alerts) for quiz 
 ========================= */

function inlineWarning(msg){
  // small custom inline error: use toast for simplicity
  showToast(msg, 2600);
}

/* =========================
   Chart (Risk Trend)
========================= */
let riskChart = null;

function renderRiskChart() {
  const canvas = document.getElementById("riskChartCanvas");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // Make sure new data exists
  if (!state.trendData || !state.trendData.labels || state.trendData.labels.length === 0) {
    console.warn("[RiskChart] No trend data yet.");
    return;
  }

  // 🔁 Destroy the old chart before creating a new one
  if (riskChart) {
    riskChart.destroy();
  }

  // Create new chart
  riskChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: state.trendData.labels,
      datasets: [{
        label: "Risk %",
        data: state.trendData.values,
        borderColor: "rgba(139, 0, 255, 0.8)",
        backgroundColor: "rgba(139, 0, 255, 0.1)",
        fill: true,
        tension: 0.3
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { min: 0, max: 100 }
      }
    }
  });
}

/* =========================
   Onboarding overlay behavior
   ========================= */

// ADD THESE THREE LINES:
const overlay = document.getElementById('loginModal');
const overlayStart = document.getElementById('loginStart');
const overlaySkip = document.getElementById('loginGuest');



overlayStart.addEventListener('click', ()=> {
  state.seenIntro = true; saveState();
  gotoView('quiz');
  closeOverlay();
});
overlaySkip.addEventListener('click', ()=> { state.seenIntro = true; saveState(); gotoView('dashboard'); closeOverlay(); });

function closeOverlay(){
  overlay.classList.add('hidden');
  setTimeout(()=> overlay.style.display='none', 420);
}

/* =========================
   Small keyboard navigation: Esc to close overlay
   ========================= */
document.addEventListener('keydown', (e)=>{
  if(e.key === 'Escape' && !overlay.classList.contains('hidden')){
    state.seenIntro = true; saveState(); closeOverlay(); gotoView('dashboard');
  }
});

// PASTE THIS RIGHT AFTER YOUR OTHER FUNCTIONS
function getRiskPersona(log) {
    if (!log || log.length < 3) {
        return {
            title: "👶 In Training",
            description: "Complete at least 3 questions to get your super-spy profile!"
        };
    }
    
    let totalTime = 0;
    let totalConfidence = 0;
    let correctAnswers = 0;
    
    // Count all the answers like counting candies!
    log.forEach(item => {
        totalTime += item.time_ms;
        totalConfidence += item.confidence;
        if (item.correct) correctAnswers++;
    });
    
    const avgTime = totalTime / log.length;
    const avgConfidence = totalConfidence / log.length;
    const accuracy = correctAnswers / log.length;
    
    // Now let's decide what kind of superhero you are!
    
    // 🦸‍♂️ Super Hero!
    if (accuracy >= 0.8 && avgConfidence > 3.5 && avgTime < 10000) {
        return {
            title: "🦸‍♂️ Cyber Superhero",
            description: "You're fast, confident, and always right! You're protecting the digital world!"
        };
    }
    
    // 🐢 Careful Turtle!
    if (accuracy >= 0.8 && avgConfidence <= 3.5) {
        return {
            title: "🐢 The Careful Expert", 
            description: "You know the answers but you're too shy! Trust yourself more!"
        };
    }
    
    // 🚀 Speedy Rocket (but crashes)!
    if (accuracy < 0.8 && avgConfidence > 3.5 && avgTime < 10000) {
        return {
            title: "🚀 Speedy Rocket",
            description: "You answer super fast but sometimes crash! Slow down a bit!"
        };
    }
    
    // Default: Good Student!
    return {
        title: "🌟 Good Student",
        description: "You're learning well! Keep practicing to become a cyber superhero!"
    };
}

// 👑 ADD THIS ADMIN FUNCTION
async function loadAllResults() {
    try {
        showToast("Loading quiz data...");
        const snapshot = await db.collection("quizResults").orderBy("timestamp", "desc").limit(20).get();
        let html = "";
        
        if (snapshot.empty) {
            html = "<p class='mutedSmall'>No quiz data found in database.</p>";
        } else {
            snapshot.forEach(doc => {
                const data = doc.data();
                html += `
                    <div style="background:rgba(139,0,255,0.1); padding:12px; margin:10px 0; border-radius:8px; border-left:4px solid var(--accent1);">
                        <strong>${data.playerName}</strong> - ${data.score} correct<br>
                        <small>🎭 ${data.persona} | ⚠️ Risk: ${data.riskScore}% | 📅 ${new Date(data.timestamp?.toDate()).toLocaleString()}</small>
                    </div>
                `;
            });
        }
        
        document.getElementById('adminResults').innerHTML = html;
        showToast(`Loaded ${snapshot.size} quiz results!`);
    } catch (error) {
        console.error("Error loading results:", error);
        showToast("Error loading data - check console");
    }
}


function normalizePersona(raw) {
    if (!raw) return "Unknown";
    raw = raw.toLowerCase();

    if (raw.includes("rocket")) return "🚀 Speedy Rocket";
    if (raw.includes("training")) return "🌱 In Training";
    if (raw.includes("good")) return "☀️ Good Student";
    if (raw.includes("superhero")) return "🛡 Cyber Superhero";
    if (raw.includes("expert")) return "🧩 Expert";
    
    return raw;
}



// 🆕 ENHANCED ADMIN FUNCTIONS - PASTE AT VERY END OF SCRIPT

// 👑 ENHANCED ADMIN DASHBOARD FUNCTIONS
async function loadAdminDashboard() {
    try {
        showToast("Loading admin data...");
        
        const timeFilter = document.getElementById('timeFilter').value;
        let query = db.collection("quizResults").orderBy("timestamp", "desc");
        
        // Apply time filter
        if (timeFilter === 'week') {
            const oneWeekAgo = new Date();
            oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
            query = query.where("timestamp", ">=", oneWeekAgo);
        } else if (timeFilter === 'day') {
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            query = query.where("timestamp", ">=", today);
        }
        
        const snapshot = await query.get();
        
        if (snapshot.empty) {
            showToast("No quiz data found");
            return;
        }
        
        // Calculate KPIs
        let totalRisk = 0;
        let totalConfidence = 0;
        let personaCounts = {};
        const sessions = [];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            sessions.push(data);
            
            // Sum for averages
            totalRisk += data.riskScore || 0;
            
            // Calculate average confidence from log
            if (data.log && data.log.length > 0) {
                const confSum = data.log.reduce((sum, item) => sum + (item.confidence || 0), 0);
                totalConfidence += confSum / data.log.length;
            }
            
            // Count personas
           const key = normalizePersona(data.persona?.title || data.persona);
personaCounts[key] = (personaCounts[key] || 0) + 1;

        });
        
        // Update KPI Cards
        document.getElementById('adminTotalQuizzes').textContent = snapshot.size;
        document.getElementById('adminAvgRisk').textContent = Math.round(totalRisk / snapshot.size) + '%';
        document.getElementById('adminAvgConfidence').textContent = (totalConfidence / snapshot.size).toFixed(1);
        
        // Find top persona
        const topPersona = Object.entries(personaCounts).sort((a, b) => b[1] - a[1])[0];
        document.getElementById('adminTopPersona').textContent = topPersona ? topPersona[0] : '-';
        
        // Update sessions table
        updateSessionsTable(sessions);
        
        // Update persona chart
        updatePersonaChart(personaCounts);
        
        showToast(`Loaded ${snapshot.size} quiz sessions!`);
        
    } catch (error) {
        console.error("Error loading admin data:", error);
        showToast("Error loading admin data");
    }
}

function updateSessionsTable(sessions) {
    const tbody = document.getElementById('adminSessionsTable');
    tbody.innerHTML = '';

    sessions.slice(0, 20).forEach(session => {

        // --- SAFE DATE HANDLING (Fix Unknown Date) ---
        let dateStr = "N/A";
        if (session.timestamp) {
            if (typeof session.timestamp.toDate === "function") {
                dateStr = session.timestamp.toDate().toLocaleDateString();
            } else {
                dateStr = new Date(session.timestamp).toLocaleDateString();
            }
        }

        // --- AVERAGE CONFIDENCE ---
        const avgConfidence = session.log && session.log.length > 0
            ? (
                session.log.reduce((sum, item) => sum + (item.confidence || 0), 0) 
                / session.log.length
            ).toFixed(1)
            : "0.0";

        // --- PERSONA DISPLAY (FIXED) ---
        const personaDisplay = session.persona || "-";

        // --- CREATE ROW ---
        const row = document.createElement("tr");
        row.innerHTML = `
            <td class="admCell">${session.playerName || "Unknown"}</td>
            <td class="admCell">${session.playerRole || "-"}</td>
            <td class="admCell">${session.score || "-"}</td>
            <td class="admCell">${session.riskScore !== undefined ? session.riskScore + "%" : "-"}</td>
            <td class="admCell">${personaDisplay}</td>
            <td class="admCell">${avgConfidence}/5</td>
            <td class="admCell">${dateStr}</td>
        `;

        tbody.appendChild(row);
    });
}


function updatePersonaChart(personaCounts) {

    const ctx = document.getElementById('personaChartCanvas').getContext('2d');

    if (window.personaChartInstance) {
        window.personaChartInstance.destroy();
    }

    const labels = Object.keys(personaCounts).map(label => {
        if (label.startsWith("👶")) return "In Training";
        if (label.startsWith("🦸")) return "Superhero";
        if (label.startsWith("🐢")) return "Expert";
        if (label.startsWith("🚀")) return "Rocket";
        if (label.startsWith("🌟")) return "Good Student";
        return label;
    });

    const data = Object.values(personaCounts);
    const colors = ['#8b00ff', '#da70d6', '#39ff14', '#ff4d6d', '#ffb347'];

    window.personaChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Number of Players',
                data: data,
                backgroundColor: colors,
                borderColor: colors,
                borderWidth: 1
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { color: 'rgba(255,255,255,0.6)' },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                },
                x: {
                    ticks: {
                        color: 'rgba(255,255,255,0.6)',
                        maxRotation: 0,
                        minRotation: 0,
                        autoSkip: false,
                        font: { size: 11 }
                    },
                    grid: { color: 'rgba(255,255,255,0.1)' }
                }
            }
        }
    });
}


// CSV Export Function
async function exportAdminData() {
    try {
        showToast("Generating export...");
        const snapshot = await db.collection("quizResults").orderBy("timestamp", "desc").get();
        
        if (snapshot.empty) {
            showToast("No data to export");
            return;
        }
        
        const csvRows = ['Player,Score,Risk%,Persona,Confidence,Date'];
        
        snapshot.forEach(doc => {
            const data = doc.data();
            const avgConfidence = data.log && data.log.length > 0 
                ? (data.log.reduce((sum, item) => sum + item.confidence, 0) / data.log.length).toFixed(2)
                : '0';
                
            const date = data.timestamp?.toDate?.().toLocaleDateString() || 'Unknown';
            
            csvRows.push([
                `"${data.playerName}"`,
                `"${data.score}"`,
                data.riskScore,
                `"${data.persona}"`,
                avgConfidence,
                `"${date}"`
            ].join(','));
        });
        
        const csvString = csvRows.join('\n');
        const blob = new Blob([csvString], { type: 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        
        a.href = url;
        a.download = `gamesecai_data_${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        showToast(`Exported ${snapshot.size} records!`);
        
    } catch (error) {
        console.error("Export error:", error);
        showToast("Export failed");
    }
}


window.addEventListener("DOMContentLoaded", () => {
  if (typeof bindQuizControls === 'function') {
    bindQuizControls();
  }
});

/* =========================
   Enhanced Dashboard with User Info
========================= */
function renderDashboard(){
  // Update user info throughout the dashboard
  if (state.user && state.user.name) {
    document.getElementById('userName').textContent = state.user.name;
    document.getElementById('profileName').textContent = state.user.name;
    document.getElementById('profileRole').textContent = state.user.role;
  }
  
  const dash = document.getElementById('dashboardMissions');
  dash.innerHTML = '';
 const map = {
  phishing: { title: "Phishing", desc: "Identify phishing emails & suspicious links" },
  password: { title: "Password Attacks", desc: "Strengthen passwords & best practices" },
  wifi: { title: "Wi-Fi Spoofing", desc: "Recognize rogue hotspots" },
  "ai phishing": { title: "AI Phishing", desc: "Detect AI-generated phishing threats" }  // <-- ADD THIS
};
  Object.keys(state.missions).forEach(k => {
  const lowerKey = k.toLowerCase(); // Normalize to lowercase
  if (!map[lowerKey]) {
    console.warn(`[renderDashboard] Skipping unknown mission key: ${k} (normalized: ${lowerKey})`);
    return; 
  }

  const val = state.missions[k];
  const div = document.createElement('div');
  div.className = 'missionRow';
  div.innerHTML = `<div style="flex:1">
    <div class="missionTitle">${map[lowerKey].title}</div>
    <div class="mutedSmall">${map[lowerKey].desc}</div>
    <div class="progressWrap" style="margin-top:8px"><div class="bar" style="width:${val}%"></div></div>
  </div>
  <div style="width:120px;text-align:right">
    <div class="mutedSmall">${val}%</div>
    <div style="margin-top:8px"><button class="btn ghost" onclick="gotoView('quiz')">Train</button></div>
  </div>`;
  dash.appendChild(div);
});
  renderMissions(); 
  recalcRisk();
  renderRiskChart();
}

let quizControlsAlreadyBound = false;

function bindQuizControls() {
  if (quizControlsAlreadyBound) {
    console.log("Quiz controls already bound, skipping re-bind");
    return;
  }
  quizControlsAlreadyBound = true;

  // Submit button
  const submitBtn = document.getElementById('submitAnswer');
  if (submitBtn) {
    submitBtn.addEventListener('click', submitAnswer);
  } else {
    console.warn('Submit button not found—check HTML ID "submitAnswer"');
  }

  // Answers click-to-select
  const answersContainer = document.getElementById('answers');
  if (answersContainer) {
    answersContainer.addEventListener('click', (e) => {
      const btn = e.target.closest('.answer');
      if (!btn) return;
      const selected = document.querySelector('.answer.selected');
      if (selected) selected.classList.remove('selected');
      btn.classList.add('selected');
      console.log('Answer selected:', btn.dataset.id);
    });
  }

  // Skip
  const skipBtn = document.getElementById('skipQuestion');
  if (skipBtn) {
    skipBtn.addEventListener('click', skipQuestion);
  }

  // Finish
  const finishBtn = document.getElementById('finishBtn');
  if (finishBtn) {
    finishBtn.addEventListener('click', gotoResults);
  }

  // Keyboard shortcut (optional – see note below)
  document.addEventListener('keydown', (e) => {
    if (
      e.key === 'Enter' &&
      document.getElementById('quiz').style.display !== 'none'
    ) {
      submitAnswer();
    }
  });

  console.log('Quiz controls bound successfully');
}

/* =========================
   Initialization 
========================= */
function initApp() {

  /* ========== 1. Overlay Logic ========== */
  if (state.seenIntro) {
    overlay.classList.add('hidden');
    overlay.style.display = 'none';
  } else {
    overlay.style.display = 'flex';
    overlay.classList.remove('hidden');
  }

  /* ========== 2. Player Setup ========== */
  setupPlayer();  // login modal, user name/role

  /* ========== 3. Load All Questions ========== */
  // loadQuestions() -> startQuiz() -> renderQuiz()
  loadQuestions();

  /* ========== 4. Ensure Persona Chart Canvas Exists ========== */
  const personaChartDiv = document.getElementById('personaChart');
  if (personaChartDiv && !document.getElementById('personaChartCanvas')) {
    const canvas = document.createElement('canvas');
    canvas.id = 'personaChartCanvas';
    personaChartDiv.appendChild(canvas);
  }


// ==========================
    //  REAL-TIME FIREBASE LEADERBOARD
    // ==========================
    db.collection("quizResults")
      .orderBy("timestamp", "desc")
      .limit(50)
      .onSnapshot(snapshot => {

        console.log("🔥 Live Firebase leaderboard update");

        state.users = []; // reset list
        const trendPoints = [];

        snapshot.forEach(doc => {
  const d = doc.data();

// Collect data for risk trend chart
if (typeof d.riskScore === "number" && d.timestamp) {
  let dt;
  if (typeof d.timestamp.toDate === "function") {
    dt = d.timestamp.toDate();
  } else {
    dt = new Date(d.timestamp);
  }

  trendPoints.push({
    name: d.playerName || "Unknown",
    date: dt,
    risk: d.riskScore
  });
}


  // Compute score %
  let scorePct = 0;
  if (d.score) {
    const [got, total] = d.score.split("/").map(Number);
    if (total > 0) scorePct = Math.round((got / total) * 100);
  }

  // Compute confidence from log[]
  let avgConf = 0;
  if (d.log && d.log.length > 0) {
    avgConf = d.log.reduce((sum, item) => sum + (item.confidence || 0), 0) / d.log.length;
  }

 // Format timestamp safely
let formattedDate = "N/A";
if (d.timestamp) {
    if (typeof d.timestamp.toDate === "function") {
        formattedDate = d.timestamp.toDate().toISOString().split("T")[0];
    } else {
        formattedDate = new Date(d.timestamp).toISOString().split("T")[0];
    }
}


  state.users.push({
    name: d.playerName || "Unknown",
    score: scorePct,
    conf: avgConf.toFixed(1),
    role: d.playerRole || "-",
    hesitation: d.avgHes || "0s",
    date: formattedDate
  });
});

// 👉 Build risk trend data for the chart
if (trendPoints.length > 0) {
  let filtered = trendPoints;

  // Prefer the logged-in user's trend
  if (state.user && state.user.name) {
    const mine = trendPoints.filter(p => p.name === state.user.name);
    if (mine.length > 0) filtered = mine;
  }

  // Sort by date oldest → newest
  filtered.sort((a, b) => a.date - b.date);

  // Save into state
  state.trendData = {
    labels: filtered.map(p => p.date.toLocaleDateString()),
    values: filtered.map(p => p.risk)
  };

  // Redraw chart
  renderRiskChart();
}

        // Refresh both leaderboards
        renderLeaderboard();
        renderSidebarLeaderboard();
      });

  /* ========== 5. Render All Static Views ========== */
  renderDashboard();
  renderAdminTable();
  renderLeaderboard();   // <--- leaderboard works from here
  renderMissions();
  renderProfile();
  renderRiskChart();

  /* ========== 6. Set Sidebar Bars ========== */
  document.getElementById('sideBarP').style.width  = state.missions.phishing + '%';
  document.getElementById('sideBarPwd').style.width= state.missions.password + '%';
  document.getElementById('sideBarW').style.width  = state.missions.wifi + '%';

  /* ========== 7. Go to Last Page ========== */
  const last = state.lastView || 'landing';
  gotoView(last);

  /* ========== 8. Tracking Behavior for Quiz ========== */
  attachHoverTracking();
  attachAnswerSwitchTracking();
}

/* Run Initialization Once */
document.addEventListener('DOMContentLoaded', initApp);

function renderSidebarLeaderboard() {
  const container = document.getElementById("sideLeaderboard");
  if (!container) return;

  container.innerHTML = "";

  const sorted = state.users
    .slice()
    .sort((a,b) => parseFloat(b.score) - parseFloat(a.score))
    .slice(0, 3); // top 3

  sorted.forEach((u, i) => {
    const row = document.createElement("div");
    row.className = `lb-item rank-${i+1}`;

    row.innerHTML = `
      <div class="lb-rank">${i+1}</div>
      <div class="lb-name">${u.name}</div>
      <div class="lb-score" data-score="${u.score}">0</div>
    `;

    container.appendChild(row);

    // Animate score
    const scoreEl = row.querySelector(".lb-score");
    let current = 0;
    const target = parseInt(u.score);

    const anim = setInterval(() => {
      current++;
      scoreEl.textContent = current + "%";
      if (current >= target) clearInterval(anim);
    }, 10);
  });
}

/* ============================
   📨 Phishing Micro-Game Logic
   ============================ */

// Small pool of sample emails
const PHISHING_EMAILS = [
  {
    id: 1,
    sender: 'IT Support <it-help@securecorp.com>',
    subject: 'URGENT: Password reset required within 1 hour',
    body:
      'Dear user,\n\nWe detected unusual login attempts on your account.\nPlease reset your password within the next 60 minutes using the link below:\n\nhttp://securecorp-security-reset.com/login\n\nFailure to do so will result in account suspension.\n\nThanks,\nIT Security Team',
    isPhish: true,
    reason: 'The link goes to a suspicious non-company domain and uses urgency to pressure you.',
    tip: 'Always hover over links and check the real domain. Go to the site directly instead of clicking email links.'
  },
  {
    id: 2,
    sender: 'HR Portal <hr@yourcompany.com>',
    subject: 'Updated holiday policy PDF',
    body:
      'Hi team,\n\nPlease find attached the updated holiday and PTO policy for this year.\nYou can also access it anytime from the official HR portal.\n\nBest,\nHR Team',
    isPhish: false,
    reason: 'The sender and content match an expected internal HR communication. No links asking for login.',
    tip: 'Even when it looks safe, it is still good practice to open attachments from trusted portals only.'
  },
  {
    id: 3,
    sender: 'Microsoft Account Team <no-reply@m1crosoft-security.com>',
    subject: 'Your mailbox is almost full – verify now',
    body:
      'Hello,\n\nYour mailbox has exceeded the storage limit and must be verified.\nClick the link below to keep receiving emails:\n\nhttps://m1crosoft-security.com/verify\n\nThank you,\nMicrosoft Account Team',
    isPhish: true,
    reason: 'Domain is misspelled (m1crosoft) and asks you to click a login link out of nowhere.',
    tip: 'Always check for subtle spelling changes in sender addresses and domains.'
  },
  {
    id: 4,
    sender: 'Team Lead <lead@yourcompany.com>',
    subject: 'Reminder: Stand-up meeting tomorrow',
    body:
      'Hi,\n\nQuick reminder that our daily stand-up is at 9:30 AM tomorrow in the usual Zoom room.\nNo action needed, just be on time :) \n\nThanks!',
    isPhish: false,
    reason: 'No unexpected links or attachments, and matches an expected internal reminder.',
    tip: 'Phishing emails often introduce unexpected requests, links, or attachments.',
  }
];

let currentPhish = null;

// Called by the Landing "Play" button
function startPhishingGame() {
  gotoView('gamePhishing');
  loadRandomPhish();
}

// Pick a random email and render it
function loadRandomPhish() {
  if (!PHISHING_EMAILS.length) return;

  const idx = Math.floor(Math.random() * PHISHING_EMAILS.length);
  currentPhish = PHISHING_EMAILS[idx];

  // Fill the UI
  const senderEl = document.getElementById('phishSender');
  const subjectEl = document.getElementById('phishSubject');
  const bodyEl = document.getElementById('phishBody');
  const tagEl = document.getElementById('phishTag');
  const timeEl = document.getElementById('phishTime');

  if (senderEl) senderEl.textContent = currentPhish.sender;
  if (subjectEl) subjectEl.textContent = currentPhish.subject;
  if (bodyEl) bodyEl.textContent = currentPhish.body;
  if (tagEl) tagEl.textContent = currentPhish.isPhish ? 'Suspicious' : 'Inbox';
  if (timeEl) timeEl.textContent = 'Just now';

  // Hide previous feedback
  const fb = document.getElementById('phishFeedback');
  const reason = document.getElementById('phishReason');
  const tip = document.getElementById('phishTip');

  if (fb) {
    fb.style.display = 'none';
    fb.classList.remove('correct', 'incorrect');
    fb.textContent = '';
  }
  if (reason) {
    reason.style.display = 'none';
    reason.textContent = '';
  }
  if (tip) {
    tip.style.display = 'none';
    tip.textContent = '';
  }
}

// User clicked "Looks Safe" or "Looks Phishy"
function evaluatePhish(thinksItsPhish) {
  if (!currentPhish) return;

  const fb = document.getElementById('phishFeedback');
  const reason = document.getElementById('phishReason');
  const tip = document.getElementById('phishTip');

  const isCorrect = (thinksItsPhish === currentPhish.isPhish);

  if (fb) {
    fb.style.display = 'block';
    fb.classList.remove('correct', 'incorrect');
    fb.classList.add(isCorrect ? 'correct' : 'incorrect');
    fb.textContent = isCorrect
      ? '✅ Nice call — you classified this correctly.'
      : '❌ Not quite — that classification is risky.';
  }

  if (reason) {
    reason.style.display = 'block';
    reason.textContent = 'Why: ' + currentPhish.reason;
  }

  if (tip) {
    tip.style.display = 'block';
    tip.textContent = 'Tip: ' + currentPhish.tip;
  }
}



/* ============================
   🌐 Website Inspector Micro-Game
   ============================ */

const INSPECT_DATA = [
  {
    url: "https://secure-update-login.com",
    correct: "url",
    reason: "The domain is suspicious and not related to any official service.",
    tip: "Always check the domain name carefully — look for subtle misspellings."
  },
  {
    url: "https://bank-verification-panel.com",
    correct: "popup",
    reason: "A login popup appears without you asking — a classic phishing trick.",
    tip: "Never enter credentials into surprise popups or overlays."
  },
  {
    url: "https://file-download-secure.net",
    correct: "download",
    reason: "The file download button is unrelated to the content on the page.",
    tip: "Avoid downloading files from unusual or mismatched pages."
  }
];

let currentInspect = null;

function startInspectorGame() {
  gotoView("gameInspector");
  loadInspectSite();
}

function loadInspectSite() {
  const random = INSPECT_DATA[Math.floor(Math.random() * INSPECT_DATA.length)];
  currentInspect = random;

  document.getElementById("inspectorURL").textContent = random.url;

  // clear feedback
  const r = document.getElementById("inspectResult");
  const re = document.getElementById("inspectReason");
  const t = document.getElementById("inspectTip");
  r.style.display = re.style.display = t.style.display = "none";
  r.textContent = re.textContent = t.textContent = "";
}

function checkInspectorChoice(choice) {
  const isCorrect = (choice === currentInspect.correct);

  const r = document.getElementById("inspectResult");
  const re = document.getElementById("inspectReason");
  const t = document.getElementById("inspectTip");

  r.style.display = re.style.display = t.style.display = "block";

  r.classList.remove("correct", "incorrect");
  r.classList.add(isCorrect ? "correct" : "incorrect");

  r.textContent = isCorrect
    ? "✅ Correct — you spotted the suspicious element."
    : "❌ Not quite — that isn’t the suspicious part.";

  re.textContent = "Why: " + currentInspect.reason;
  t.textContent = "Tip: " + currentInspect.tip;
}

/* ============================
   🔐 Password Fortress Micro-Game
   ============================ */

function startPasswordGame() {
  gotoView("gamePassword");
  resetPasswordGame();
}

function resetPasswordGame() {
  const input = document.getElementById("pwInput");
  const bar = document.getElementById("pwStrengthBar");
  const label = document.getElementById("pwStrengthLabel");
  const hint = document.getElementById("pwHint");

  if (input) input.value = "";
  if (bar) bar.style.width = "0%";
  if (label) label.textContent = "";
  if (hint) hint.textContent = "";
}

function evaluatePasswordStrength() {
  const pw = document.getElementById("pwInput").value;
  const bar = document.getElementById("pwStrengthBar");
  const label = document.getElementById("pwStrengthLabel");
  const hint = document.getElementById("pwHint");

  let score = 0;
  let suggestions = [];

  if (pw.length >= 8) score += 25;
  else suggestions.push("Use at least 8 characters.");

  if (/[A-Z]/.test(pw)) score += 25;
  else suggestions.push("Add uppercase letters.");

  if (/[0-9]/.test(pw)) score += 25;
  else suggestions.push("Include numbers.");

  if (/[^A-Za-z0-9]/.test(pw)) score += 25;
  else suggestions.push("Add special characters (!, $, #, etc.).");

  // Update bar
  if (bar) bar.style.width = score + "%";

  let strengthText = "";
  if (score <= 25) strengthText = "Very Weak";
  else if (score <= 50) strengthText = "Weak";
  else if (score <= 75) strengthText = "Strong";
  else strengthText = "Very Strong";

  if (label) {
    label.textContent = `Strength: ${strengthText}`;
    label.style.color =
      score <= 25 ? "#e74c3c" :
      score <= 50 ? "#e67e22" :
      score <= 75 ? "#f1c40f" :
      "#2ecc71";
  }

  if (hint) {
    hint.textContent = suggestions.length ? ("Tips: " + suggestions.join(" ")) : "Great password!";
  }
}

/* ============================
   📶 Wi-Fi Threat Finder Game
   ============================ */

const WIFI_DATA = [
  {
    networks: [
      { name: "Starbucks_Guest", safe: false },
      { name: "Home_5GHz", safe: true },
      { name: "FreeAirportWiFi", safe: false }
    ],
    reason: "Public Wi-Fi networks like Starbucks or Airport Wi-Fi are unsafe because they lack encryption.",
    tip: "Always prefer private networks with WPA2/WPA3 security."
  },
  {
    networks: [
      { name: "TP-Link_23B8", safe: false },
      { name: "MyHomeSecure", safe: true },
      { name: "PublicLibrary_Free", safe: false }
    ],
    reason: "Only the private home network is encrypted and hidden from public access.",
    tip: "Avoid networks labeled 'Free', 'Public', or generic router names."
  },
  {
    networks: [
      { name: "Hotel_WiFi_Open", safe: false },
      { name: "Pixel_Hotspot", safe: true },
      { name: "RandomWifi123", safe: false }
    ],
    reason: "Phone hotspots are far safer than shared hotel networks.",
    tip: "When traveling, prefer your hotspot over hotel Wi-Fi."
  }
];

let currentWifiSet = null;

function startWifiGame() {
  gotoView("gameWifi");
  loadWifiOptions();
}

function loadWifiOptions() {
  const random = WIFI_DATA[Math.floor(Math.random() * WIFI_DATA.length)];
  currentWifiSet = random;

  const listContainer = document.getElementById("wifiList");
  const result = document.getElementById("wifiResult");
  const reason = document.getElementById("wifiReason");
  const tip = document.getElementById("wifiTip");

  // clear previous
  result.style.display = reason.style.display = tip.style.display = "none";
  result.textContent = reason.textContent = tip.textContent = "";

  listContainer.innerHTML = "";

  random.networks.forEach((net, i) => {
    const div = document.createElement("div");
    div.className = "wifiOption";
    div.setAttribute("onclick", `selectWifiOption(${i})`);
    div.innerHTML = `<span>${net.name}</span>`;
    listContainer.appendChild(div);
  });
}

function selectWifiOption(index) {
  const net = currentWifiSet.networks[index];
  const result = document.getElementById("wifiResult");
  const reason = document.getElementById("wifiReason");
  const tip = document.getElementById("wifiTip");

  const isCorrect = net.safe;

  result.style.display = reason.style.display = tip.style.display = "block";
  result.classList.remove("correct", "incorrect");
  result.classList.add(isCorrect ? "correct" : "incorrect");

  result.textContent = isCorrect
    ? "✅ Correct — this is the safest Wi-Fi option."
    : "❌ Incorrect — this network is not secure.";

  reason.textContent = "Why: " + currentWifiSet.reason;
  tip.textContent = "Tip: " + currentWifiSet.tip;
}
