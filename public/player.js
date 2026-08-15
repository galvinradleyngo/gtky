const PLAYER_ICONS = [
  '😀', '😎', '🤖', '👽', '🐱', '🐶', '🦊', '🐼', '🐨', '🐵',
  '🦁', '🐯', '🐸', '🐙', '🦄', '🐝', '🦋', '🐬', '🦉', '🦖',
  '🍩', '🍪', '🍉', '🍓', '🍒', '🥑', '🍔', '🌮', '⚽', '🏀',
  '🎸', '🎧', '🚀', '🛸', '⭐', '🌙', '🔥', '💎', '🎯', '🎨'
];

const joinCard = document.getElementById('joinCard');
const form = document.getElementById('joinForm');
const iconPickerEl = document.getElementById('iconPicker');
const joinErrorEl = document.getElementById('joinError');
const gameDiv = document.getElementById('game');
const gameIconEl = document.getElementById('gameIcon');
const roomNameDisplay = document.getElementById('roomNameDisplay');
const waitingEl = document.getElementById('waiting');
const timerWrap = document.getElementById('timerWrap');
const timerEl = document.getElementById('timer');
const muteMusicBtn = document.getElementById('muteMusic');
const questionLabelEl = document.getElementById('questionLabel');
const questionEl = document.getElementById('question');
const optionsEl = document.getElementById('options');
const statusEl = document.getElementById('status');
const finishedNoticeEl = document.getElementById('finishedNotice');
const finalPanel = document.getElementById('finalPanel');
const removeMeBtn = document.getElementById('removeMe');
const removeStatusEl = document.getElementById('removeStatus');

let code;
let name;
let source;
let hasAnswered = false;
let musicEnabled = false;
let musicUserMuted = false;
let countdownTimer = null;
let cachedOptions = [];
let selectedIcon = PLAYER_ICONS[Math.floor(Math.random() * PLAYER_ICONS.length)];

const params = new URLSearchParams(location.search);
const prefillCode = params.get('code');
if (prefillCode) {
  form.code.value = prefillCode.toUpperCase();
  form.name.focus();
}

PLAYER_ICONS.forEach(icon => {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = icon;
  if (icon === selectedIcon) btn.classList.add('selected');
  btn.onclick = () => {
    selectedIcon = icon;
    [...iconPickerEl.children].forEach(b => b.classList.toggle('selected', b === btn));
  };
  iconPickerEl.appendChild(btn);
});

function showError(msg) {
  joinErrorEl.textContent = msg;
  joinErrorEl.classList.remove('hidden');
}

function setOptionsDisabled(disabled) {
  [...optionsEl.children].forEach(b => (b.disabled = disabled));
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

form.onsubmit = async e => {
  e.preventDefault();
  if (window.GtkyMusic) window.GtkyMusic.unlock();
  joinErrorEl.classList.add('hidden');
  code = form.code.value.trim().toUpperCase();
  name = form.name.value.trim();
  const fact = form.fact.value.trim();
  if (!code || !name || !fact) return;

  let data;
  try {
    const res = await fetch('/join-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, fact, icon: selectedIcon })
    });
    data = await res.json();
    if (!res.ok || data.error) {
      showError(data.error || 'Could not join the game.');
      return;
    }
  } catch {
    showError('Network error. Please try again.');
    return;
  }

  musicEnabled = Boolean(data.musicEnabled);
  if (data.icon) gameIconEl.textContent = data.icon;
  if (data.roomName) {
    roomNameDisplay.textContent = data.roomName;
    roomNameDisplay.classList.remove('hidden');
  } else {
    roomNameDisplay.classList.add('hidden');
  }

  joinCard.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  connectEvents();
};

function renderQuestion(fact, questionIndex, totalQuestions) {
  hasAnswered = false;
  waitingEl.classList.add('hidden');
  finishedNoticeEl.classList.add('hidden');
  questionLabelEl.textContent = `Question ${questionIndex} of ${totalQuestions}`;
  questionLabelEl.classList.remove('hidden');
  questionEl.textContent = fact;
  questionEl.classList.remove('hidden');
  statusEl.textContent = '';
  optionsEl.innerHTML = '';
  cachedOptions.forEach(opt => {
    const btn = document.createElement('button');
    const avatar = document.createElement('span');
    avatar.className = 'player-avatar';
    avatar.textContent = opt.icon || '🙂';
    btn.appendChild(avatar);
    btn.appendChild(document.createTextNode(opt.name));
    btn.onclick = () => answer(opt.name);
    optionsEl.appendChild(btn);
  });
}

function connectEvents() {
  source = new EventSource(`/events?code=${code}&name=${encodeURIComponent(name)}`);
  source.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'question') {
      cachedOptions = msg.options;
      musicEnabled = Boolean(msg.musicEnabled);
      startCountdown(msg.endsAt);
      if (musicEnabled) {
        muteMusicBtn.classList.remove('hidden');
        if (!musicUserMuted && window.GtkyMusic) window.GtkyMusic.start();
      }
      renderQuestion(msg.fact, msg.questionIndex, msg.totalQuestions);
    }

    if (msg.type === 'game-over') {
      stopCountdown();
      timerWrap.classList.add('hidden');
      if (window.GtkyMusic) window.GtkyMusic.stop();
      waitingEl.classList.add('hidden');
      questionLabelEl.classList.add('hidden');
      questionEl.classList.add('hidden');
      finishedNoticeEl.classList.add('hidden');
      optionsEl.innerHTML = '';
      statusEl.textContent = 'The game has ended.';
      removeMeBtn.disabled = false;
      removeMeBtn.classList.remove('hidden');
      removeStatusEl.classList.add('hidden');
      finalPanel.classList.remove('hidden');
    }

    if (msg.type === 'room-deleted') {
      stopCountdown();
      if (window.GtkyMusic) window.GtkyMusic.stop();
      timerWrap.classList.add('hidden');
      questionEl.classList.add('hidden');
      questionLabelEl.classList.add('hidden');
      optionsEl.innerHTML = '';
      finishedNoticeEl.classList.add('hidden');
      waitingEl.classList.add('hidden');
      finalPanel.classList.add('hidden');
      statusEl.textContent = "This game's data has been deleted.";
    }
  };
}

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

removeMeBtn.onclick = async () => {
  if (!confirm('Remove your name, fact, and score from this game now?')) return;
  removeMeBtn.disabled = true;
  try {
    const res = await fetch('/remove-me', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name })
    });
    const data = await res.json();
    if (data.error) {
      removeStatusEl.textContent = data.error;
    } else {
      removeStatusEl.textContent = 'Your data has been removed.';
      removeMeBtn.classList.add('hidden');
    }
  } catch {
    removeStatusEl.textContent = 'Network error. Please try again.';
    removeMeBtn.disabled = false;
  }
  removeStatusEl.classList.remove('hidden');
};

async function answer(guess) {
  if (hasAnswered) return;
  hasAnswered = true;
  setOptionsDisabled(true);
  try {
    const res = await fetch('/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, guess })
    });
    const data = await res.json();
    if (data.error) {
      statusEl.textContent = data.error;
      hasAnswered = false;
      setOptionsDisabled(false);
      return;
    }
    statusEl.textContent = data.correct ? 'Correct!' : `Not quite — it was ${data.answer}.`;

    setTimeout(() => {
      if (data.finished) {
        questionLabelEl.classList.add('hidden');
        questionEl.classList.add('hidden');
        optionsEl.innerHTML = '';
        statusEl.textContent = '';
        finishedNoticeEl.classList.remove('hidden');
      } else if (data.next) {
        renderQuestion(data.next.fact, data.next.questionIndex, data.next.totalQuestions);
      }
    }, 1200);
  } catch {
    statusEl.textContent = 'Network error submitting your answer.';
    hasAnswered = false;
    setOptionsDisabled(false);
  }
}
