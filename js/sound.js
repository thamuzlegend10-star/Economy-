// Tiny synthesized sound effects (Web Audio). No audio files, so nothing to download or license.
let ac = null, enabled = true, volume = 0.5, lastSale = 0;

function ctx() {
  if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch { return null; } }
  if (ac.state === "suspended") ac.resume().catch(() => {});
  return ac;
}

function tone(c, freq, start, dur, { type = "sine", gain = 0.2, to = 0 } = {}) {
  const t0 = c.currentTime + start, o = c.createOscillator(), g = c.createGain();
  o.type = type; o.frequency.setValueAtTime(freq, t0);
  if (to) o.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  const peak = gain * volume;
  g.gain.setValueAtTime(0.0001, t0);
  g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.02);
}

const SOUNDS = {
  click: c => tone(c, 620, 0, 0.05, { gain: 0.07 }),
  sale: c => { tone(c, 988, 0, 0.12, { gain: 0.14, type: "triangle" }); tone(c, 1480, 0.07, 0.2, { gain: 0.12, type: "triangle" }); },
  delivery: c => { tone(c, 196, 0, 0.45, { type: "sawtooth", gain: 0.09 }); tone(c, 247, 0, 0.45, { type: "sawtooth", gain: 0.07 }); },
  order: c => { tone(c, 520, 0, 0.1, { gain: 0.12 }); tone(c, 780, 0.09, 0.14, { gain: 0.12 }); },
  error: c => tone(c, 220, 0, 0.18, { type: "square", gain: 0.08, to: 150 }),
  warn: c => { tone(c, 440, 0, 0.1, { type: "square", gain: 0.06 }); tone(c, 440, 0.16, 0.1, { type: "square", gain: 0.06 }); },
  dayend: c => [523, 659, 784, 1047].forEach((f, i) => tone(c, f, i * 0.11, 0.35, { gain: 0.13, type: "triangle" })),
  milestone: c => [659, 784, 988, 1319].forEach((f, i) => tone(c, f, i * 0.08, 0.3, { gain: 0.13, type: "triangle" })),
  hire: c => { tone(c, 440, 0, 0.1, { gain: 0.12 }); tone(c, 660, 0.1, 0.18, { gain: 0.12 }); },
};

export const sound = {
  setEnabled(v) { enabled = !!v; },
  setVolume(v) { volume = Math.max(0, Math.min(1, Number(v) || 0)); },
  isEnabled: () => enabled,
  play(name) {
    if (!enabled || volume <= 0 || !SOUNDS[name]) return;
    if (name === "sale") { const now = performance.now(); if (now - lastSale < 140) return; lastSale = now; }
    const c = ctx(); if (c) SOUNDS[name](c);
  },
};
