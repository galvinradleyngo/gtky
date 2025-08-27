const createBtn = document.getElementById('create');
const codeSpan = document.getElementById('code');
const roomDiv = document.getElementById('room');
const playersList = document.getElementById('players');
const leaderboardList = document.getElementById('leaderboard');
let code;
let source;

createBtn.onclick = async () => {
  const res = await fetch('/create-room', { method: 'POST' });
  const data = await res.json();
  code = data.code;
  codeSpan.textContent = code;
  roomDiv.classList.remove('hidden');
  source = new EventSource(`/events?code=${code}`);
  source.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'player-joined') {
      const li = document.createElement('li');
      li.textContent = msg.name;
      playersList.appendChild(li);
    }
    if (msg.type === 'leaderboard') {
      leaderboardList.innerHTML = '';
      msg.leaderboard.forEach(p => {
        const li = document.createElement('li');
        li.textContent = `${p.name}: ${p.score}`;
        leaderboardList.appendChild(li);
      });
    }
    if (msg.type === 'question') {
      // simple roulette animation
      const question = document.createElement('div');
      question.className = 'roulette';
      question.textContent = msg.fact;
      document.body.appendChild(question);
      setTimeout(() => question.remove(), 3000);
    }
  };
};

document.getElementById('start').onclick = async () => {
  await fetch('/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code })
  });
};
