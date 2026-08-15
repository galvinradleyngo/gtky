// Small self-contained generative background loop (Web Audio API).
// No external audio files: two detuned pad oscillators for ambience plus a
// plucky pentatonic arpeggio for a little game-show energy. Volume stays low.
(function () {
  let ctx = null;
  let masterGain = null;
  let padNodes = [];
  let arpTimer = null;
  let playing = false;

  function unlock() {
    if (ctx) return;
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      ctx = new Ctx();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0;
      masterGain.connect(ctx.destination);
    } catch {
      ctx = null;
    }
  }

  function pluckNote(freq, time, dur) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0, time);
    gain.gain.linearRampToValueAtTime(0.16, time + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + dur);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(time);
    osc.stop(time + dur + 0.05);
  }

  function start() {
    if (!ctx || playing) return;
    playing = true;
    ctx.resume().catch(() => {});
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0.5, now + 1);

    [130.81, 164.81].forEach((f, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = i === 0 ? -6 : 6;
      filter.type = 'lowpass';
      filter.frequency.value = 800;
      gain.gain.value = 0.05;
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(masterGain);
      osc.start();
      padNodes.push(osc, gain, filter);
    });

    const scale = [261.63, 293.66, 329.63, 392.0, 440.0]; // C D E G A
    let step = 0;
    arpTimer = setInterval(() => {
      if (!ctx) return;
      const freq = scale[step % scale.length] * (step % 8 === 0 ? 2 : 1);
      pluckNote(freq, ctx.currentTime, 0.4);
      step++;
    }, 420);
  }

  function stop() {
    if (!ctx || !playing) return;
    playing = false;
    if (arpTimer) {
      clearInterval(arpTimer);
      arpTimer = null;
    }
    const now = ctx.currentTime;
    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setValueAtTime(masterGain.gain.value, now);
    masterGain.gain.linearRampToValueAtTime(0, now + 0.6);
    const stale = padNodes;
    padNodes = [];
    setTimeout(() => {
      stale.forEach(n => {
        try {
          n.stop && n.stop();
        } catch {
          // already stopped
        }
        try {
          n.disconnect && n.disconnect();
        } catch {
          // already disconnected
        }
      });
    }, 700);
  }

  function isPlaying() {
    return playing;
  }

  window.GtkyMusic = { unlock, start, stop, isPlaying };
})();
