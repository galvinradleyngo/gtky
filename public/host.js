const LIBRARY_KEY = 'gtky-library';
const MAX_LIBRARY_ENTRIES = 20;

const libraryChooser = document.getElementById('libraryChooser');
const libraryList = document.getElementById('libraryList');
const showCreateFormBtn = document.getElementById('showCreateForm');
const createCard = document.getElementById('createCard');
const createForm = document.getElementById('createForm');
const roomNameInput = document.getElementById('roomName');
const roomPasswordInput = document.getElementById('roomPassword');
const roundSecondsInput = document.getElementById('roundSeconds');
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
const podiumPanel = document.getElementById('podiumPanel');
const podiumEl = document.getElementById('podium');
const historyPanel = document.getElementById('historyPanel');
const historyNameEl = document.getElementById('historyName');
const historyListEl = document.getElementById('historyList');
const closeHistoryBtn = document.getElementById('closeHistory');
const leaderboardList = document.getElementById('leaderboard');

let code = null;
let hostToken = null;
let musicEnabled = false;
let source = null;
let countdownTimer = null;
let musicUserMuted = false;

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

async function openFromLibrary(entry) {
  if (entry.passwordProtected) {
    const pw = prompt(`Enter the password for "${entry.roomName || entry.code}":`);
    if (pw === null) return;
    try {
      const res = await fetch('/verify-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: entry.code, password: pw })
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        alert(data.error || 'Incorrect password.');
        return;
      }
    } catch {
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

function renderLeaderboard(leaderboard) {
  leaderboardList.innerHTML = '';
  leaderboard.forEach(p => {
    const li = document.createElement('li');
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = p.icon || '🙂';
    li.appendChild(avatar);
    li.appendChild(document.createTextNode(`${p.name}: ${p.score}`));
    leaderboardList.appendChild(li);
  });
}

const PODIUM_ORDER = [1, 0, 2]; // display order: 2nd, 1st, 3rd

function renderPodium(podium) {
  podiumEl.innerHTML = '';
  PODIUM_ORDER.forEach(i => {
    const p = podium[i];
    if (!p) return;
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
    podiumEl.appendChild(spot);
  });
  podiumPanel.classList.remove('hidden');
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

function openRoomPanel({ code: c, joinUrl, qrCode, passwordProtected, icon, roomName, musicEnabled: me }) {
  code = c;
  musicEnabled = Boolean(me);
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
  startBtn.classList.add('hidden');
  endBtn.classList.remove('hidden');
  podiumPanel.classList.add('hidden');
  historyPanel.classList.add('hidden');
  retentionNoticeEl.classList.add('hidden');
  progressStatusEl.textContent = '';
  // QR/link and the full name list stop being useful once play starts —
  // collapse them so the timer and progress don't need scrolling to see.
  joinPanelExtra.classList.add('hidden');
  playersList.classList.add('hidden');
  startCountdown(endsAt);
  if (musicEnabled) {
    muteMusicBtn.classList.remove('hidden');
    if (!musicUserMuted && window.GtkyMusic) window.GtkyMusic.start();
  }
}

function enterCompleteState(leaderboard, podium) {
  stopCountdown();
  timerWrap.classList.add('hidden');
  startBtn.classList.add('hidden');
  endBtn.classList.add('hidden');
  joinPanelExtra.classList.add('hidden');
  playersList.classList.add('hidden');
  if (window.GtkyMusic) window.GtkyMusic.stop();
  renderPodium(podium && podium.length ? podium : leaderboard.slice(0, 3));
  renderLeaderboard(leaderboard);
  retentionNoticeEl.textContent =
    "Players' fun facts have already been erased now that the game has ended. Names and scores will be deleted automatically within 2 weeks — use \"Delete Game Data\" above to remove them now.";
  retentionNoticeEl.classList.remove('hidden');
}

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
        roundSeconds: roundSecondsInput.value || undefined,
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
  enterActiveState(data.endsAt);
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

deleteRoomBtn.onclick = async () => {
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
    const res = await fetch(`/room-state?code=${roomCode}`);
    if (!res.ok) return false;
    const state = await res.json();
    hostToken = token;
    openRoomPanel(state);
    renderPlayers(state.players);
    renderLeaderboard(state.leaderboard);
    if (state.status === 'active') {
      enterActiveState(state.endsAt);
    } else if (state.status === 'complete') {
      enterCompleteState(state.leaderboard, state.leaderboard.slice(0, 3));
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
