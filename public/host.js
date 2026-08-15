const createForm = document.getElementById('createForm');
const roomPasswordInput = document.getElementById('roomPassword');
const roomDiv = document.getElementById('room');
const codeSpan = document.getElementById('code');
const qrImg = document.getElementById('qr');
const joinUrlInput = document.getElementById('joinUrl');
const copyLinkBtn = document.getElementById('copyLink');
const passwordBadge = document.getElementById('passwordBadge');
const playersList = document.getElementById('players');
const playerCountEl = document.getElementById('playerCount');
const startBtn = document.getElementById('start');
const revealBtn = document.getElementById('reveal');
const endBtn = document.getElementById('end');
const deleteRoomBtn = document.getElementById('deleteRoom');
const roundStatusEl = document.getElementById('roundStatus');
const retentionNoticeEl = document.getElementById('retentionNotice');
const revealPanel = document.getElementById('revealPanel');
const revealAnswerEl = document.getElementById('revealAnswer');
const revealResultsEl = document.getElementById('revealResults');
const leaderboardList = document.getElementById('leaderboard');

let code = null;
let hostToken = null;
let source = null;

function saveSession() {
  sessionStorage.setItem('gtky-host', JSON.stringify({ code, hostToken }));
}

function clearSession() {
  sessionStorage.removeItem('gtky-host');
}

function renderPlayers(names) {
  playersList.innerHTML = '';
  names.forEach(n => {
    const li = document.createElement('li');
    li.textContent = n;
    playersList.appendChild(li);
  });
  playerCountEl.textContent = names.length;
}

function renderLeaderboard(leaderboard) {
  leaderboardList.innerHTML = '';
  leaderboard.forEach(p => {
    const li = document.createElement('li');
    li.textContent = `${p.name}: ${p.score}`;
    leaderboardList.appendChild(li);
  });
}

function openRoomPanel({ code: c, joinUrl, qrCode, passwordProtected }) {
  code = c;
  codeSpan.textContent = code;
  if (joinUrl) joinUrlInput.value = joinUrl;
  if (qrCode) qrImg.src = qrCode;
  passwordBadge.classList.toggle('hidden', !passwordProtected);
  roomDiv.classList.remove('hidden');
}

function connectEvents() {
  if (source) source.close();
  source = new EventSource(`/events?code=${code}`);
  source.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'roster') {
      renderPlayers(msg.players);
    }
    if (msg.type === 'leaderboard') {
      renderLeaderboard(msg.leaderboard);
    }
    if (msg.type === 'question') {
      roundStatusEl.textContent = `Round in progress: whose fact is "${msg.fact}"?`;
      startBtn.disabled = true;
      revealBtn.classList.remove('hidden');
      revealPanel.classList.add('hidden');
    }
    if (msg.type === 'player-answered') {
      roundStatusEl.textContent = `Answers in: ${msg.answeredCount}/${msg.totalEligible}`;
    }
    if (msg.type === 'reveal') {
      startBtn.disabled = false;
      revealBtn.classList.add('hidden');
      roundStatusEl.textContent = '';
      revealAnswerEl.textContent = `"${msg.fact}" belonged to ${msg.answer}`;
      revealResultsEl.innerHTML = '';
      msg.results.forEach(r => {
        const li = document.createElement('li');
        li.textContent = `${r.name} guessed ${r.guess} — ${r.correct ? 'correct' : 'incorrect'}`;
        revealResultsEl.appendChild(li);
      });
      revealPanel.classList.remove('hidden');
    }
    if (msg.type === 'game-over') {
      roundStatusEl.textContent = 'Game over!';
      startBtn.disabled = true;
      revealBtn.classList.add('hidden');
      renderLeaderboard(msg.leaderboard);
      retentionNoticeEl.textContent =
        "This game's data (names, facts, and scores) will be deleted automatically within 2 weeks. If it contains personal info you'd like removed sooner, use \"Delete Game Data\" above.";
      retentionNoticeEl.classList.remove('hidden');
    }
    if (msg.type === 'room-deleted') {
      clearSession();
      alert("This game's data has been deleted.");
      location.reload();
    }
  };
}

createForm.onsubmit = async e => {
  e.preventDefault();
  const submitBtn = createForm.querySelector('button[type="submit"]');
  submitBtn.disabled = true;
  try {
    const res = await fetch('/create-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: roomPasswordInput.value })
    });
    const data = await res.json();
    hostToken = data.hostToken;
    openRoomPanel(data);
    saveSession();
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
  const res = await fetch('/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) alert(data.error);
};

revealBtn.onclick = async () => {
  const res = await fetch('/reveal', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) alert(data.error);
};

endBtn.onclick = async () => {
  if (!confirm('End the game for everyone?')) return;
  const res = await fetch('/end', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, hostToken })
  });
  const data = await res.json();
  if (data.error) alert(data.error);
};

deleteRoomBtn.onclick = async () => {
  if (
    !confirm(
      "Permanently delete this game's data (players, facts, scores) now? This can't be undone."
    )
  )
    return;
  if (source) source.close();
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
  alert('Game data deleted.');
  location.reload();
};

window.addEventListener('DOMContentLoaded', async () => {
  const saved = sessionStorage.getItem('gtky-host');
  if (!saved) return;
  try {
    const { code: savedCode, hostToken: savedToken } = JSON.parse(saved);
    const res = await fetch(`/room-state?code=${savedCode}`);
    if (!res.ok) {
      clearSession();
      return;
    }
    const state = await res.json();
    hostToken = savedToken;
    openRoomPanel(state);
    renderPlayers(state.players.map(p => p.name));
    renderLeaderboard(state.leaderboard);
    if (state.status === 'question') {
      startBtn.disabled = true;
      revealBtn.classList.remove('hidden');
    }
    connectEvents();
  } catch {
    clearSession();
  }
});
