const form = document.getElementById('joinForm');
const joinErrorEl = document.getElementById('joinError');
const gameDiv = document.getElementById('game');
const waitingEl = document.getElementById('waiting');
const questionEl = document.getElementById('question');
const subjectNoticeEl = document.getElementById('subjectNotice');
const optionsEl = document.getElementById('options');
const statusEl = document.getElementById('status');
const progressEl = document.getElementById('progress');
const finalPanel = document.getElementById('finalPanel');
const finalLeaderboardEl = document.getElementById('finalLeaderboard');
const removeMeBtn = document.getElementById('removeMe');
const removeStatusEl = document.getElementById('removeStatus');

let code;
let name;
let source;
let hasAnswered = false;

const params = new URLSearchParams(location.search);
const prefillCode = params.get('code');
if (prefillCode) {
  form.code.value = prefillCode.toUpperCase();
  form.name.focus();
}

function showError(msg) {
  joinErrorEl.textContent = msg;
  joinErrorEl.classList.remove('hidden');
}

function setOptionsDisabled(disabled) {
  [...optionsEl.children].forEach(b => (b.disabled = disabled));
}

form.onsubmit = async e => {
  e.preventDefault();
  joinErrorEl.classList.add('hidden');
  code = form.code.value.trim().toUpperCase();
  name = form.name.value.trim();
  const fact = form.fact.value.trim();
  const password = form.password.value;
  if (!code || !name || !fact) return;

  let data;
  try {
    const res = await fetch('/join-room', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, name, fact, password })
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

  form.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  connectEvents();
};

function connectEvents() {
  source = new EventSource(`/events?code=${code}&name=${encodeURIComponent(name)}`);
  source.onmessage = e => {
    const msg = JSON.parse(e.data);

    if (msg.type === 'question') {
      hasAnswered = false;
      waitingEl.classList.add('hidden');
      questionEl.classList.remove('hidden');
      questionEl.textContent = msg.fact;
      statusEl.textContent = '';
      progressEl.textContent = '';
      finalPanel.classList.add('hidden');
      optionsEl.innerHTML = '';
      if (msg.isSubject) {
        subjectNoticeEl.classList.remove('hidden');
      } else {
        subjectNoticeEl.classList.add('hidden');
        msg.options.forEach(opt => {
          const btn = document.createElement('button');
          btn.textContent = opt;
          btn.onclick = () => answer(opt);
          optionsEl.appendChild(btn);
        });
      }
    }

    if (msg.type === 'player-answered') {
      progressEl.textContent = `Answers in: ${msg.answeredCount}/${msg.totalEligible}`;
    }

    if (msg.type === 'reveal') {
      questionEl.classList.add('hidden');
      subjectNoticeEl.classList.add('hidden');
      setOptionsDisabled(true);
      progressEl.textContent = '';
      statusEl.textContent = `"${msg.fact}" was ${msg.answer}.`;
      waitingEl.textContent = 'Waiting for the next round...';
      waitingEl.classList.remove('hidden');
    }

    if (msg.type === 'game-over') {
      waitingEl.classList.add('hidden');
      questionEl.classList.add('hidden');
      subjectNoticeEl.classList.add('hidden');
      optionsEl.innerHTML = '';
      progressEl.textContent = '';
      statusEl.textContent = 'The game has ended.';
      finalLeaderboardEl.innerHTML = '';
      msg.leaderboard.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.name}: ${p.score}`;
        finalLeaderboardEl.appendChild(li);
      });
      removeMeBtn.disabled = false;
      removeMeBtn.classList.remove('hidden');
      removeStatusEl.classList.add('hidden');
      finalPanel.classList.remove('hidden');
    }

    if (msg.type === 'room-deleted') {
      questionEl.classList.add('hidden');
      subjectNoticeEl.classList.add('hidden');
      optionsEl.innerHTML = '';
      progressEl.textContent = '';
      waitingEl.classList.add('hidden');
      finalPanel.classList.add('hidden');
      statusEl.textContent = "This game's data has been deleted.";
    }
  };
}

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
    statusEl.textContent = data.correct
      ? 'Correct!'
      : `Not quite — it was ${data.answer}.`;
  } catch {
    statusEl.textContent = 'Network error submitting your answer.';
    hasAnswered = false;
    setOptionsDisabled(false);
  }
}
