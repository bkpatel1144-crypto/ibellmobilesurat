// Short scanner-style sounds, so staff can scan shelves without looking at the screen.
let ctx;

export function beep(kind = 'ok') {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    const tones = kind === 'ok' ? [[1320, 0.08]] : kind === 'warn' ? [[660, 0.1], [660, 0.1]] : [[220, 0.25]];
    let t = ctx.currentTime;
    for (const [freq, dur] of tones) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = kind === 'error' ? 'square' : 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur + 0.05;
    }
  } catch {
    /* no audio available - the on-screen result still shows */
  }
}
