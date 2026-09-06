const LIBRARY_KEY = 'gtky-library';
const MAX_LIBRARY_ENTRIES = 20;

const libraryChooser = document.getElementById('libraryChooser');
const libraryList = document.getElementById('libraryList');
const showCreateFormBtn = document.getElementById('showCreateForm');
const createCard = document.getElementById('createCard');
const createForm = document.getElementById('createForm');
const roomNameInput = document.getElementById('roomName');
const roomPasswordInput = document.getElementById('roomPassword');
const gameModeInput = document.getElementById('gameMode');
const roundSecondsRow = document.getElementById('roundSecondsRow');
const roundSecondsInput = document.getElementById('roundSeconds');
const factsPerPlayerInput = document.getElementById('factsPerPlayer');
const toggleAdvancedBtn = document.getElementById('toggleAdvanced');
const advancedSettings = document.getElementById('advancedSettings');
const factsToPlayInput = document.getElementById('factsToPlay');
const questionsPerPlayerRow = document.getElementById('questionsPerPlayerRow');
const questionsPerPlayerInput = document.getElementById('questionsPerPlayer');
const musicEnabledInput = document.getElementById('musicEnabled');
const roomDiv = document.getElementById('room');
const gameIconEl = document.getElementById('gameIcon');
const roomNameDisplay = document.getElementById('roomNameDisplay');
const codeSpan = document.getElementById('code');
const joinPanelExtra = document.getElementById('joinPanelExtra');
const qrImg = document.getElementById('qr');
const joinUrlInput = document.getElementById('joinUrl');
const copyLinkBtn = document.getElementById('copyLink');
const passwordBadge = document.getElementById('passwordBadge');
const playersList = document.getElementById('players');
const playerCountEl = document.getElementById('playerCount');
const startBtn = document.getElementById('start');
const endBtn = document.getElementById('end');
const deleteRoomBtn = document.getElementById('deleteRoom');
const timerWrap = document.getElementById('timerWrap');
const timerEl = document.getElementById('timer');
const progressStatusEl = document.getElementById('progressStatus');
const muteMusicBtn = document.getElementById('muteMusic');
const retentionNoticeEl = document.getElementById('retentionNotice');
const editSettingsBtn = document.getElementById('editSettingsBtn');
const editSettingsPanel = document.getElementById('editSettingsPanel');
const editSettingsForm = document.getElementById('editSettingsForm');
const editRoomName = document.getElementById('editRoomName');
const editRoomPassword = document.getElementById('editRoomPassword');
const editGameMode = document.getElementById('editGameMode');
const editRoundSecondsRow = document.getElementById('editRoundSecondsRow');
const editRoundSeconds = document.getElementById('editRoundSeconds');
const editFactsPerPlayer = document.getElementById('editFactsPerPlayer');
const editToggleAdvancedBtn = document.getElementById('editToggleAdvanced');
const editAdvancedSettings = document.getElementById('editAdvancedSettings');
const editFactsToPlay = document.getElementById('editFactsToPlay');
const editQuestionsPerPlayerRow = document.getElementById('editQuestionsPerPlayerRow');
const editQuestionsPerPlayer = document.getElementById('editQuestionsPerPlayer');
const editMusicEnabled = document.getElementById('editMusicEnabled');
const cancelEditSettingsBtn = document.getElementById('cancelEditSettings');
const gameOverPanel = document.getElementById('gameOverPanel');
const showLeaderboardBtn = document.getElementById('showLeaderboardBtn');
const podiumPanel = document.getElementById('podiumPanel');
const podiumEl = document.getElementById('podium');
const historyPanel = document.getElementById('historyPanel');
const historyNameEl = document.getElementById('historyName');
const historyListEl = document.getElementById('historyList');
const closeHistoryBtn = document.getElementById('closeHistory');
const leaderboardPanel = document.getElementById('leaderboardPanel');
const leaderboardList = document.getElementById('leaderboard');
const confettiCanvas = document.getElementById('confettiCanvas');
const livePanel = document.getElementById('livePanel');
const liveQuestionLabel = document.getElementById('liveQuestionLabel');
const liveFact = document.getElementById('liveFact');
const liveProgress = document.getElementById('liveProgress');
const liveRevealBtn = document.getElementById('liveRevealBtn');
const liveResults = document.getElementById('liveResults');
const liveAnswerName = document.getElementById('liveAnswerName');
const liveTally = document.getElementById('liveTally');
const liveMiniLeaderboard = document.getElementById('liveMiniLeaderboard');
const liveNextBtn = document.getElementById('liveNextBtn');

let code = null;
let hostToken = null;
let musicEnabled = false;
let source = null;
let countdownTimer = null;
let musicUserMuted = false;
let roomStatus = 'lobby';
let currentRoomName = '';
let currentRoundSeconds = 180;
let currentFactsPerPlayer = 1;
let currentFactsToPlay = null;
let currentQuestionsPerPlayer = null;
let currentGameMode = 'self-paced';
let pendingLeaderboard = [];
let pendingPodium = [];
let playerIcons = new Map(); // name -> icon, refreshed on every roster update

// --- session (this tab, this active room) ---

function saveSession() {
  sessionStorage.setItem('gtky-host', JSON.stringify({ code, hostToken }));
}

function clearSession() {
  sessionStorage.removeItem('gtky-host');
}

// --- library (this browser, every room ever created here) ---

function loadLibrary() {
  try {
    return JSON.parse(localStorage.getItem(LIBRARY_KEY)) || [];
  } catch {
    return [];
  }
}

function saveLibrary(list) {
  localStorage.setItem(LIBRARY_KEY, JSON.stringify(list));
}

function addToLibrary(entry) {
  const list = loadLibrary().filter(e => e.code !== entry.code);
  list.unshift(entry);
  saveLibrary(list.slice(0, MAX_LIBRARY_ENTRIES));
}

function removeFromLibrary(roomCode) {
  saveLibrary(loadLibrary().filter(e => e.code !== roomCode));
}

function renderLibraryChooser() {
  const list = loadLibrary();
  if (list.length === 0) {
    libraryChooser.classList.add('hidden');
    createCard.classList.remove('hidden');
    return;
  }
  libraryList.innerHTML = '';
  list.forEach(entry => {
    const when = new Date(entry.createdAt).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    });

    const iconSpan = document.createElement('span');
    iconSpan.className = 'lib-icon';
    iconSpan.textContent = entry.icon || '🎮';

    const nameSpan = document.createElement('span');
    nameSpan.className = 'lib-name';
    nameSpan.textContent = entry.roomName || entry.code;

    const subSpan = document.createElement('span');
    subSpan.className = 'lib-sub';
    subSpan.textContent = `${entry.code} · ${when}${entry.passwordProtected ? ' · 🔒' : ''}`;

    const metaSpan = document.createElement('span');
    metaSpan.className = 'lib-meta';
    metaSpan.appendChild(nameSpan);
    metaSpan.appendChild(document.createElement('br'));
    metaSpan.appendChild(subSpan);

    const li = document.createElement('li');
    li.appendChild(iconSpan);
    li.appendChild(metaSpan);
    li.onclick = () => openFromLibrary(entry);
    libraryList.appendChild(li);
  });
  libraryChooser.classList.remove('hidden');
  createCard.classList.add('hidden');
}

// Returns 'ok', 'wrong-password', 'not-found' (room no longer exists in
// server memory — there's no database, so a server restart wipes every
// room, not just this one), 'cancelled', or 'error'. Callers need to tell
// "not found" apart from "wrong password" so a stale library entry doesn't
// just keep re-prompting for a password against a game that's already gone.
async function verifyRoomPassword(roomCode, promptMessage) {
  const pw = prompt(promptMessage);
  if (pw === null) return 'cancelled';
  try {
    const res = await fetch('/verify-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: roomCode, password: pw })
    });
    const data = await res.json();
    if (res.status === 404) return 'not-found';
    if (!res.ok || !data.ok) return 'wrong-password';
    return 'ok';
  } catch {
    return 'error';
  }
}

async function openFromLibrary(entry) {
  if (entry.passwordProtected) {
    const result = await verifyRoomPassword(entry.code, `Enter the password for "${entry.roomName || entry.code}":`);
    if (result === 'cancelled') return;
    if (result === 'not-found') {
      removeFromLibrary(entry.code);
      alert('This game no longer exists on the server (it was cleared, e.g. by a server restart) — removing it from your list.');
      renderLibraryChooser();
      return;
    }
    if (result === 'wrong-password') {
      alert('Incorrect password.');
      return;
    }
    if (result === 'error') {
      alert('Network error. Please try again.');
      return;
    }
  }
  hostToken = entry.hostToken;
  const resumed = await resumeRoom(entry.code, entry.hostToken);
  if (!resumed) {
    removeFromLibrary(entry.code);
    alert('This game is no longer available.');
    renderLibraryChooser();
    return;
  }
  saveSession();
}

showCreateFormBtn.onclick = () => {
  libraryChooser.classList.add('hidden');
  createCard.classList.remove('hidden');
};

function renderPlayers(players) {
  playersList.innerHTML = '';
  playerIcons = new Map(players.map(p => [p.name, p.icon]));
  players.forEach(p => {
    const li = document.createElement('li');
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = p.icon || '🙂';
    li.appendChild(avatar);
    li.appendChild(document.createTextNode(p.name));
    playersList.appendChild(li);
  });
  playerCountEl.textContent = players.length;
}

function renderLeaderboard(leaderboard, targetEl = leaderboardList) {
  targetEl.innerHTML = '';
  leaderboard.forEach(p => {
    const li = document.createElement('li');
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = p.icon || '🙂';
    li.appendChild(avatar);
    li.appendChild(document.createTextNode(`${p.name}: ${p.score}`));
    targetEl.appendChild(li);
  });
}

const PODIUM_ORDER = [1, 0, 2]; // display order: 2nd, 1st, 3rd

function buildPodiumSpot(p, i) {
  const spot = document.createElement('div');
  spot.className = `podium-spot place-${i + 1}`;

  const medal = document.createElement('div');
  medal.className = 'podium-medal';
  medal.textContent = i + 1;

  const avatar = document.createElement('div');
  avatar.className = 'podium-avatar';
  avatar.textContent = p.icon || '🙂';

  const name = document.createElement('div');
  name.className = 'podium-name';
  name.textContent = p.name;

  const score = document.createElement('div');
  score.className = 'podium-score';
  score.textContent = `${p.score} pt${p.score === 1 ? '' : 's'}`;

  spot.appendChild(medal);
  spot.appendChild(avatar);
  spot.appendChild(name);
  spot.appendChild(score);
  spot.onclick = () => showHistory(p.name);
  return spot;
}

function renderPodium(podium) {
  podiumEl.innerHTML = '';
  PODIUM_ORDER.forEach(i => {
    const p = podium[i];
    if (!p) return;
    podiumEl.appendChild(buildPodiumSpot(p, i));
  });
  podiumPanel.classList.remove('hidden');
}

function renderPodiumAnimated(podium) {
  podiumEl.innerHTML = '';
  podiumPanel.classList.remove('hidden');
  const spots = {};
  PODIUM_ORDER.forEach(i => {
    const p = podium[i];
    if (!p) return;
    const spot = buildPodiumSpot(p, i);
    spot.style.visibility = 'hidden';
    podiumEl.appendChild(spot);
    spots[i] = spot;
  });
  const revealSequence = [2, 1, 0].filter(i => spots[i] !== undefined);
  revealSequence.forEach((i, idx) => {
    setTimeout(() => {
      spots[i].style.visibility = 'visible';
      spots[i].classList.add('reveal-in');
    }, idx * 550);
  });
  return revealSequence.length * 550;
}

// --- confetti (self-contained canvas particle burst) ---

function fireConfetti() {
  const ctx = confettiCanvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  confettiCanvas.width = w * dpr;
  confettiCanvas.height = h * dpr;
  confettiCanvas.style.width = `${w}px`;
  confettiCanvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const colors = ['#5b3df5', '#2563eb', '#ef4444', '#f5b301', '#16a34a'];
  const pieces = [];
  for (let i = 0; i < 140; i++) {
    pieces.push({
      x: Math.random() * w,
      y: -20 - Math.random() * h * 0.5,
      size: 6 + Math.random() * 6,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 12,
      vy: 2.5 + Math.random() * 3,
      vx: (Math.random() - 0.5) * 2.5
    });
  }

  const start = performance.now();
  const duration = 3200;

  function frame(now) {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    pieces.forEach(p => {
      p.x += p.vx;
      p.y += p.vy;
      p.rotation += p.rotSpeed;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((p.rotation * Math.PI) / 180);
      ctx.fillStyle = p.color;
      ctx.fillRect(-p.size / 2, -p.size * 0.7, p.size, p.size * 1.4);
      ctx.restore();
    });
    if (elapsed < duration) {
      requestAnimationFrame(frame);
    } else {
      ctx.clearRect(0, 0, w, h);
    }
  }
  requestAnimationFrame(frame);
}

function historyRow(label, value) {
  const row = document.createElement('div');
  row.className = 'history-row';
  const labelSpan = document.createElement('span');
  labelSpan.className = 'history-label';
  labelSpan.textContent = `${label}:`;
  const valueSpan = document.createElement('span');
  valueSpan.className = 'history-value';
  valueSpan.textContent = value;
  row.appendChild(labelSpan);
  row.appendChild(valueSpan);
  return row;
}

async function showHistory(name) {
  try {
    const res = await fetch(
      `/player-history?code=${code}&hostToken=${hostToken}&name=${encodeURIComponent(name)}`
    );
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    historyNameEl.textContent = `${name}'s answers`;
    historyListEl.innerHTML = '';
    data.answers.forEach(a => {
      const li = document.createElement('li');
      li.className = `history-entry ${a.correct ? 'correct' : 'wrong'}`;

      const factLine = document.createElement('div');
      factLine.className = 'history-fact';
      factLine.textContent = a.fact
        ? `"${a.fact}"`
        : 'Fact no longer available (erased when the game ended)';
      li.appendChild(factLine);

      li.appendChild(historyRow('Guessed', a.guess));
      if (a.correct) {
        const tag = document.createElement('div');
        tag.className = 'history-row history-correct-tag';
        tag.textContent = '✓ Correct';
        li.appendChild(tag);
      } else {
        li.appendChild(historyRow('Correct answer', a.subject));
      }

      historyListEl.appendChild(li);
    });
    historyPanel.classList.remove('hidden');
    historyPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch {
    alert('Network error. Please try again.');
  }
}

closeHistoryBtn.onclick = () => historyPanel.classList.add('hidden');

// Settings that don't apply to the selected game mode are hidden rather
// than just shown-and-ignored: live mode has no round timer (the host
// paces it manually) and no per-player question count (everyone answers
// the same shared sequence), so showing those knobs would just be
// confusing clutter for a mode where they do nothing.
function updateModeVisibility() {
  const isLive = gameModeInput.value === 'live';
  roundSecondsRow.classList.toggle('hidden', isLive);
  questionsPerPlayerRow.classList.toggle('hidden', isLive);
}

function updateEditModeVisibility() {
  const isLive = editGameMode.value === 'live';
  editRoundSecondsRow.classList.toggle('hidden', isLive);
  editQuestionsPerPlayerRow.classList.toggle('hidden', isLive);
}

gameModeInput.onchange = updateModeVisibility;
editGameMode.onchange = updateEditModeVisibility;
updateModeVisibility();

toggleAdvancedBtn.onclick = () => advancedSettings.classList.toggle('hidden');
editToggleAdvancedBtn.onclick = () => editAdvancedSettings.classList.toggle('hidden');

function setRoomStatus(status) {
  roomStatus = status;
  editSettingsBtn.classList.toggle('hidden', status !== 'lobby');
  if (status !== 'lobby') editSettingsPanel.classList.add('hidden');
}

function openRoomPanel({
  code: c,
  joinUrl,
  qrCode,
  passwordProtected,
  icon,
  roomName,
  musicEnabled: me,
  roundSeconds,
  factsPerPlayer,
  factsToPlay,
  questionsPerPlayer,
  gameMode
}) {
  code = c;
  musicEnabled = Boolean(me);
  currentRoomName = roomName || '';
  currentRoundSeconds = roundSeconds || 180;
  currentFactsPerPlayer = factsPerPlayer || 1;
  currentFactsToPlay = factsToPlay || null;
  currentQuestionsPerPlayer = questionsPerPlayer || null;
  currentGameMode = gameMode || 'self-paced';
  codeSpan.textContent = code;
  if (joinUrl) joinUrlInput.value = joinUrl;
  if (qrCode) qrImg.src = qrCode;
  if (icon) gameIconEl.textContent = icon;
  if (roomName) {
    roomNameDisplay.textContent = roomName;
    roomNameDisplay.classList.remove('hidden');
  } else {
    roomNameDisplay.classList.add('hidden');
  }
  passwordBadge.classList.toggle('hidden', !passwordProtected);
  createCard.classList.add('hidden');
  libraryChooser.classList.add('hidden');
  roomDiv.classList.remove('hidden');
  setRoomStatus('lobby');
}

function formatRemaining(ms) {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function startCountdown(endsAt) {
  stopCountdown();
  timerWrap.classList.remove('hidden');
  const tick = () => {
    const remaining = endsAt - Date.now();
    timerEl.textContent = formatRemaining(remaining);
    if (remaining <= 0) stopCountdown();
  };
  tick();
  countdownTimer = setInterval(tick, 250);
}

function stopCountdown() {
  if (countdownTimer) {
    clearInterval(countdownTimer);
    countdownTimer = null;
  }
}

function enterActiveState(endsAt) {
  setRoomStatus('active');
  startBtn.classList.add('hidden');
  endBtn.classList.remove('hidden');
  gameOverPanel.classList.add('hidden');
  podiumPanel.classList.add('hidden');
  leaderboardPanel.classList.add('hidden');
  historyPanel.classList.add('hidden');
  retentionNoticeEl.classList.add('hidden');
  livePanel.classList.add('hidden');
  progressStatusEl.textContent = '';
  // QR/link and the full name list stop being useful once play starts —
  // collapse them so the timer and controls don't need scrolling to see.
  joinPanelExtra.classList.add('hidden');
  playersList.classList.add('hidden');
  startCountdown(endsAt);
  if (musicEnabled) {
    muteMusicBtn.classList.remove('hidden');
    if (!musicUserMuted && window.GtkyMusic) window.GtkyMusic.start();
  }
}

// Live/Kahoot-style mode has no shared countdown -- the host paces it by
// hand (Reveal, then Next) -- so this is a distinct entry point from the
// self-paced enterActiveState rather than a variant of it.
function enterLiveActiveState() {
  setRoomStatus('active');
  startBtn.classList.add('hidden');
  endBtn.classList.remove('hidden');
  gameOverPanel.classList.add('hidden');
  podiumPanel.classList.add('hidden');
  leaderboardPanel.classList.add('hidden');
  historyPanel.classList.add('hidden');
  retentionNoticeEl.classList.add('hidden');
  timerWrap.classList.add('hidden');
  joinPanelExtra.classList.add('hidden');
  playersList.classList.add('hidden');
  livePanel.classList.remove('hidden');
  if (musicEnabled) {
    muteMusicBtn.classList.remove('hidden');
    if (!musicUserMuted && window.GtkyMusic) window.GtkyMusic.start();
  }
}

function renderLiveQuestion(msg) {
  liveQuestionLabel.textContent = `Question ${msg.questionIndex} of ${msg.totalQuestions}`;
  liveFact.textContent = msg.fact;
  liveProgress.textContent = 'Waiting for answers...';
  liveResults.classList.add('hidden');
  liveRevealBtn.classList.remove('hidden');
  livePanel.classList.remove('hidden');
}

function renderLiveReveal(msg) {
  liveRevealBtn.classList.add('hidden');
  liveProgress.textContent = `${msg.answeredCount} player${msg.answeredCount === 1 ? '' : 's'} answered`;
  const icon = playerIcons.get(msg.subject) || '🙂';
  liveAnswerName.textContent = `${icon} ${msg.subject}`;

  liveTally.innerHTML = '';
  const total = Object.values(msg.tally).reduce((a, b) => a + b, 0) || 1;
  const tallyEntries = Object.entries(msg.tally).sort((a, b) => b[1] - a[1]);
  tallyEntries.forEach(([name, count]) => {
    const row = document.createElement('div');
    row.className = 'live-tally-row';
    const label = document.createElement('span');
    label.className = 'live-tally-label';
    label.textContent = `${playerIcons.get(name) || '🙂'} ${name} (${count})`;
    const bar = document.createElement('div');
    bar.className = `live-tally-bar${name === msg.subject ? ' correct' : ''}`;
    bar.style.width = `${Math.max(6, Math.round((count / total) * 100))}%`;
    row.appendChild(label);
    row.appendChild(bar);
    liveTally.appendChild(row);
  });

  renderLeaderboard(msg.leaderboard.slice(0, 5), liveMiniLeaderboard);
  liveResults.classList.remove('hidden');
}

function enterCompleteState(leaderboard, podium, { immediate = false } = {}) {
  setRoomStatus('complete');
  stopCountdown();
  timerWrap.classList.add('hidden');
  livePanel.classList.add('hidden');
  startBtn.classList.add('hidden');
  endBtn.classList.add('hidden');
  joinPanelExtra.classList.add('hidden');
  playersList.classList.add('hidden');
  if (window.GtkyMusic) window.GtkyMusic.stop();

  pendingLeaderboard = leaderboard;
  pendingPodium = podium && podium.length ? podium : leaderboard.slice(0, 3);

  if (immediate) {
    gameOverPanel.classList.add('hidden');
    renderPodium(pendingPodium);
    renderLeaderboard(pendingLeaderboard);
    leaderboardPanel.classList.remove('hidden');
    showRetentionNotice();
  } else {
    podiumPanel.classList.add('hidden');
    leaderboardPanel.classList.add('hidden');
    retentionNoticeEl.classList.add('hidden');
    gameOverPanel.classList.remove('hidden');
  }
}

function showRetentionNotice() {
  retentionNoticeEl.textContent =
    "Players' fun facts have already been erased now that the game has ended. Names and scores will be deleted automatically within 2 weeks — use \"Delete Game Data\" above to remove them now.";
  retentionNoticeEl.classList.remove('hidden');
}

showLeaderboardBtn.onclick = () => {
  gameOverPanel.classList.add('hidden');
  fireConfetti();
  const revealMs = renderPodiumAnimated(pendingPodium);
  setTimeout(() => {
    renderLeaderboard(pendingLeaderboard);
    leaderboardPanel.classList.remove('hidden');
    showRetentionNotice();
  }, revealMs + 200);
};

function connectEvents() {
  if (source) source.close();
  source = new EventSource(`/events?code=${code}`);
  source.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'roster') {
      renderPlayers(msg.players);
    }
    if (msg.type === 'round-started') {
      enterActiveState(msg.endsAt);
    }
    if (msg.type === 'player-progress') {
      progressStatusEl.textContent = `${msg.completedCount} of ${msg.totalPlayers} players finished`;
    }
    if (msg.type === 'live-question') {
      renderLiveQuestion(msg);
    }
    if (msg.type === 'live-progress') {
      liveProgress.textContent = `${msg.answeredCount} of ${msg.totalAnswerers} answered`;
    }
    if (msg.type === 'live-reveal') {
      renderLiveReveal(msg);
    }
    if (msg.type === 'game-over') {
      enterCompleteState(msg.leaderboard, msg.podium);
    }
    if (msg.type === 'room-deleted') {
      stopCountdown();
      if (window.GtkyMusic) window.GtkyMusic.stop();
      clearSession();
      removeFromLibrary(code);
      alert("This game's data has been deleted.");
      location.reload();
    }
  };
}

createForm.onsubmit = async e => {
  e.preventDefault();
  if (window.GtkyMusic) window.GtkyMusic.unlock();
  const submitBtn = createForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch('/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        password: roomPasswordInput.value,
        name: roomNameInput.value,
        gameMode: gameModeInput.value,
        roundSeconds: roundSecondsInput.value || undefined,
        factsPerPlayer: factsPerPlayerInput.value || undefined,
        factsToPlay: factsToPlayInput.value || undefined,
        questionsPerPlayer: questionsPerPlayerInput.value || undefined,
        musicEnabled: musicEnabledInput.checked
      })
    });
    const data = await res.json();
    if (data.error) {
      alert(data.error);
      return;
    }
    hostToken = data.hostToken;
    openRoomPanel(data);
    saveSession();
    addToLibrary({
      code: data.code,
      hostToken: data.hostToken,
      roomName: data.roomName,
      icon: data.icon,
      passwordProtected: data.passwordProtected,
      createdAt: Date.now()
    });
    connectEvents();
  } finally {
    submitBtn.disabled = false;
  }
};

copyLinkBtn.onclick = async () => {
  try {
    await navigator.clipboard.writeText(joinUrlInput.value);
  } catch {
    joinUrlInput.select();
    document.execCommand('copy');
  }
  copyLinkBtn.textContent = 'Copied!';
  setTimeout(() => (copyLinkBtn.textContent = 'Copy Link'), 1500);
};

startBtn.onclick = async () => {
  if (window.GtkyMusic) window.GtkyMusic.unlock();
  const res = await fetch('/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  if (data.live) {
    enterLiveActiveState();
  } else {
    enterActiveState(data.endsAt);
  }
};

liveRevealBtn.onclick = async () => {
  const res = await fetch('/live-reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) alert(data.error);
};

liveNextBtn.onclick = async () => {
  const res = await fetch('/live-next', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) alert(data.error);
};

endBtn.onclick = async () => {
  if (!confirm('End the game now and reveal the final results?')) return;
  const res = await fetch('/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) alert(data.error);
};

muteMusicBtn.onclick = () => {
  if (!window.GtkyMusic) return;
  if (window.GtkyMusic.isPlaying()) {
    window.GtkyMusic.stop();
    musicUserMuted = true;
    muteMusicBtn.textContent = '🔊 Unmute Music';
  } else {
    window.GtkyMusic.start();
    musicUserMuted = false;
    muteMusicBtn.textContent = '🔇 Mute Music';
  }
};

editSettingsBtn.onclick = () => {
  editRoomName.value = currentRoomName;
  editRoomPassword.value = '';
  editGameMode.value = currentGameMode;
  editRoundSeconds.value = String(currentRoundSeconds);
  editFactsPerPlayer.value = String(currentFactsPerPlayer);
  editFactsToPlay.value = currentFactsToPlay ? String(currentFactsToPlay) : '';
  editQuestionsPerPlayer.value = currentQuestionsPerPlayer ? String(currentQuestionsPerPlayer) : '';
  editMusicEnabled.checked = musicEnabled;
  updateEditModeVisibility();
  editSettingsPanel.classList.remove('hidden');
  editSettingsPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

cancelEditSettingsBtn.onclick = () => editSettingsPanel.classList.add('hidden');

editSettingsForm.onsubmit = async e => {
  e.preventDefault();
  const body = {
    code,
    hostToken,
    name: editRoomName.value,
    gameMode: editGameMode.value,
    roundSeconds: editRoundSeconds.value,
    factsPerPlayer: editFactsPerPlayer.value || '',
    factsToPlay: editFactsToPlay.value || '',
    questionsPerPlayer: editQuestionsPerPlayer.value || '',
    musicEnabled: editMusicEnabled.checked
  };
  // Only touch the password if the host actually typed a new one — an
  // untouched blank field must never silently wipe an existing password.
  if (editRoomPassword.value) body.password = editRoomPassword.value;

  const res = await fetch('/update-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  openRoomPanel(data);
  editSettingsPanel.classList.add('hidden');
};

deleteRoomBtn.onclick = async () => {
  const result = await verifyRoomPassword(
    code,
    "Enter this game's password to confirm deletion (leave blank if none was set):"
  );
  if (result === 'cancelled') return;
  if (result === 'not-found') {
    clearSession();
    removeFromLibrary(code);
    alert('This game no longer exists on the server (it was already cleared) — nothing left to delete.');
    location.reload();
    return;
  }
  if (result === 'wrong-password') {
    alert('Incorrect password.');
    return;
  }
  if (result === 'error') {
    alert('Network error. Please try again.');
    return;
  }
  if (
    !confirm(
      "Permanently delete this game's data (players, facts, scores) now? This can't be undone."
    )
  )
    return;
  if (source) source.close();
  stopCountdown();
  if (window.GtkyMusic) window.GtkyMusic.stop();
  const res = await fetch('/delete-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  clearSession();
  removeFromLibrary(code);
  alert('Game data deleted.');
  location.reload();
};

async function resumeRoom(roomCode, token) {
  try {
    const res = await fetch(`/room-state?code=${roomCode}&qr=1`);
    if (!res.ok) return false;
    const state = await res.json();
    hostToken = token;
    openRoomPanel(state);
    renderPlayers(state.players);
    renderLeaderboard(state.leaderboard);
    if (state.status === 'active' && state.gameMode === 'live') {
      // Resuming mid-live-game doesn't replay the current question (its
      // fact/subject aren't exposed by this public endpoint, since players
      // can call it too) -- the host lands here and picks back up on the
      // next reveal/next-question broadcast.
      enterLiveActiveState();
      liveFact.textContent = 'Reconnected — waiting for the next update...';
      liveRevealBtn.classList.add('hidden');
    } else if (state.status === 'active') {
      enterActiveState(state.endsAt);
    } else if (state.status === 'complete') {
      enterCompleteState(state.leaderboard, state.leaderboard.slice(0, 3), { immediate: true });
    }
    connectEvents();
    return true;
  } catch {
    return false;
  }
}

window.addEventListener('DOMContentLoaded', async () => {
  const saved = sessionStorage.getItem('gtky-host');
  if (saved) {
    try {
      const { code: savedCode, hostToken: savedToken } = JSON.parse(saved);
      const resumed = await resumeRoom(savedCode, savedToken);
      if (resumed) return;
      clearSession();
    } catch {
      clearSession();
    }
  }
  renderLibraryChooser();
});
