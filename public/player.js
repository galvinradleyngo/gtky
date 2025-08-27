const form = document.getElementById('joinForm');
const gameDiv = document.getElementById('game');
const questionEl = document.getElementById('question');
const optionsEl = document.getElementById('options');
const statusEl = document.getElementById('status');
let code;
let name;
let source;

form.onsubmit = async e => {
  e.preventDefault();
  code = form.code.value.trim().toUpperCase();
  name = form.name.value.trim();
  const fact = form.fact.value.trim();
  const res = await fetch('/join-room', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, fact })
  });
  const data = await res.json();
  if (data.error) {
    alert(data.error);
    return;
  }
  form.classList.add('hidden');
  gameDiv.classList.remove('hidden');
  source = new EventSource(`/events?code=${code}&name=${encodeURIComponent(name)}`);
  source.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'question') {
      questionEl.textContent = msg.fact;
      optionsEl.innerHTML = '';
      msg.options.forEach(opt => {
        const btn = document.createElement('button');
        btn.textContent = opt;
        btn.onclick = () => answer(opt);
        optionsEl.appendChild(btn);
      });
      statusEl.textContent = '';
    }
    if (msg.type === 'reveal') {
      statusEl.textContent = msg.correct && msg.name === name
        ? 'Correct!'
        : `Answer: ${msg.answer}`;
    }
  };
};

async function answer(guess) {
  await fetch('/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, name, guess })
  });
}
