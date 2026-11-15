// Written with an AI tool (Claude). See AI_USE.md.
// Sound inside the helmet. Every sound is made here with the Web Audio API: filtered noise and
// sine tones. Nothing is a recording and nothing is measured. SIMULATED, and the briefing says so.
// What the sounds follow is real state of the walk: the ground type under the boots (steps and
// breathing rate), the level of the gauge (tones), the dose rate of the replay (clicks).
// A browser allows sound only after a click or a key, so the context starts on the first one.
// Key N switches the sound off and on.

let ctx = null, master = null, noise = null, muted = false;
try { muted = localStorage.getItem('mm.mute') === '1'; } catch { /* private window */ }

function start() {
  if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain(); master.gain.value = muted ? 0 : 0.9; master.connect(ctx.destination);
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  // The suit: a low hum and a little air noise, always on.
  const hum = ctx.createOscillator(); hum.frequency.value = 90;
  const hg = ctx.createGain(); hg.gain.value = 0.012; hum.connect(hg).connect(master); hum.start();
  const air = src(true); const af = filter('lowpass', 420); const ag = ctx.createGain(); ag.gain.value = 0.02;
  air.connect(af).connect(ag).connect(master); air.start();
}
for (const ev of ['pointerdown', 'keydown']) addEventListener(ev, start, { capture: true });
addEventListener('keydown', (e) => { if (e.code === 'KeyN' && !e.repeat) setMuted(!muted); });

export function setMuted(v) {
  muted = v; if (master) master.gain.setTargetAtTime(v ? 0 : 0.9, ctx.currentTime, 0.05);
  try { localStorage.setItem('mm.mute', v ? '1' : '0'); } catch { /* private window */ }
  document.body.classList.toggle('muted', v);
}
export const isMuted = () => muted;

function src(loop = false) { const s = ctx.createBufferSource(); s.buffer = noise; s.loop = loop; return s; }
function filter(type, f, q = 0.8) { const b = ctx.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; return b; }
// A burst of filtered noise: attack, then an exponential fall.
function burst(type, f, dur, vol, at = 0, q = 0.8) {
  if (!ctx) return;
  const t = ctx.currentTime + at, s = src(), g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(filter(type, f, q)).connect(g).connect(master);
  s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
}
function tone(f, dur, vol = 0.06, at = 0, type = 'sine', f2 = null) {
  if (!ctx) return;
  const t = ctx.currentTime + at, o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type; o.frequency.setValueAtTime(f, t); if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master); o.start(t); o.stop(t + dur + 0.02);
}

// One boot on the ground. kind: 0 soil, 1 bedrock, 2 sand, 3 big rock, -1 not classified.
export function step(kind) {
  const k = 0.95 + Math.random() * 0.1;
  if (kind === 2) burst('lowpass', 380 * k, 0.16, 0.10);
  else if (kind === 1) { burst('highpass', 1900 * k, 0.045, 0.07); tone(85 * k, 0.09, 0.05); }
  else if (kind === 3) burst('bandpass', 1300 * k, 0.09, 0.10, 0, 2.5);
  else burst('bandpass', 720 * k, 0.10, 0.09, 0, 1.2);
}

// Breathing: in and out, the period set by what a step costs on this ground (1.0 to 2.1).
let breathTimer = 0, breathPeriod = 4;
export function setEffort(eta) { breathPeriod = 4 - (Math.min(2.1, Math.max(1, eta)) - 1) / 1.1 * 1.6; }
function breathe() {
  if (ctx && !muted) {
    const p = breathPeriod;
    const one = (f, t0, dur, vol) => {
      const t = ctx.currentTime + t0, s = src(), g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.45); g.gain.linearRampToValueAtTime(0.0001, t + dur);
      s.connect(filter('bandpass', f, 1.4)).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
    };
    one(1100, 0, p * 0.38, 0.030); one(620, p * 0.46, p * 0.42, 0.038);
  }
  breathTimer = setTimeout(breathe, breathPeriod * 1000);
}
breathTimer = setTimeout(breathe, 1500);

export const tick = () => tone(1200, 0.04, 0.05);
export const ok = () => { tone(880, 0.08, 0.06); tone(1320, 0.12, 0.06, 0.09); };
export const chord = () => { for (const f of [220, 329.6, 440]) tone(f, 1.6, 0.05); };
export const thud = () => { tone(70, 0.28, 0.22, 0, 'sine', 38); burst('lowpass', 200, 0.2, 0.12); };
export const drill = (sec) => { if (!ctx) return; tone(110, sec, 0.05, 0, 'sawtooth'); burst('bandpass', 2400, sec, 0.02, 0, 3); };
export const radio = () => burst('bandpass', 1800, 0.16, 0.08, 0, 1.2);
export const sweep = () => tone(400, 1.1, 0.05, 0, 'sine', 1200);
// The gauge changed level. Down the scale for worse, up for better.
export function level(to) {
  if (to === 'caution') { tone(659, 0.12, 0.07); tone(523, 0.16, 0.07, 0.13); }
  else if (to === 'back' || to === 'emergency') { tone(659, 0.12, 0.08); tone(523, 0.12, 0.08, 0.13); tone(392, 0.3, 0.08, 0.26); }
  else if (to === 'go') { tone(523, 0.1, 0.05); tone(659, 0.16, 0.05, 0.11); }
}
export const alarm = () => { for (let i = 0; i < 3; i++) { tone(880, 0.18, 0.09, i * 0.4, 'square'); tone(659, 0.18, 0.09, i * 0.4 + 0.2, 'square'); } };
// Clicks of a counter: more per second as the measured dose rate rises above the background.
let clickAcc = 0;
export function clicks(dt, ratio) {
  if (!ctx || !(ratio > 1)) return;
  const perSec = Math.min(14, Math.max(1, 12 * Math.log10(ratio) / Math.log10(60)));
  clickAcc += dt * perSec * (0.5 + Math.random());
  while (clickAcc >= 1) { clickAcc -= 1; burst('highpass', 3000, 0.012, 0.12, Math.random() * 0.05); }
}
