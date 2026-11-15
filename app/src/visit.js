// Written with an AI tool (Claude). See AI_USE.md.
// The stop at a station (owner, 2026-11-15: no timed run, no points, no ranking. The entry is a
// guided look at the whole product, and the science at each station is shown).
//
// When the walker reaches a station of the plan, the walk stands still and a card shows what is
// known about the place and what each choice leaves for the way home:
//  - MEASURED: the Mastcam photo Curiosity took at this stop and the reason on the image label,
//    and what the rover's APXS and ChemCam measured in the targets of this stop (chem.js).
//  - MODEL: the minutes to spare after each choice, from the same clock and oxygen numbers as the gauge.
//  - ASSUMED: the minutes of work at a station (route.js, workMin). What the crew does in them is
//    not modelled: the card only spends the minutes and the oxygen of standing work.
// This file also keeps the sound that follows the walk and the ring on the ground at an arrival.
import * as THREE from 'three';
import * as snd from './audio.js';
import { chemHtml } from './chem.js';

const ARRIVE_M = 7, HOME_M = 9;

const h = (tag, attrs = {}, html = '') => { const e = document.createElement(tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.innerHTML = html; return e; };
const span = (sec) => { const m = Math.abs(Math.trunc(sec / 60)); return m >= 90 ? `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min` : `${m} min`; };

// The caption of a descent, and what happens when the view lands.
export const arrivalCaption = (site, kicker) => `<span>${kicker}</span><b>${site.name} · SOL ${site.sol}</b><span>GALE CRATER, MARS</span><small>The descent is imagined. The ground is NASA's elevation model and image.</small>`;
export function land() { snd.thud(); document.body.classList.remove('landed'); void document.body.offsetWidth; document.body.classList.add('landed'); setTimeout(() => document.body.classList.remove('landed'), 1000); }

// ui.allow(): true when a station card may open (not in a tour step about something else, not under the start screen).
export function setupVisit(api, ui) {
  const { state } = api;
  const hud = document.getElementById('hud');
  const toast = h('div', { id: 'toast', hidden: '' });
  const banner = h('div', { id: 'banner', hidden: '' });
  const choice = h('section', { id: 'choice', hidden: '' });
  hud.append(toast, banner, choice);
  let toastTimer = 0, bannerTimer = 0;
  let V = fresh();
  function fresh() { return { seen: new Set(), at: null, busy: false, last: null, home: false, walked0: null }; }

  function say(html, ms = 4200) { toast.innerHTML = html; toast.hidden = false; toast.classList.remove('in'); void toast.offsetWidth; toast.classList.add('in'); clearTimeout(toastTimer); toastTimer = setTimeout(() => { toast.hidden = true; }, ms); }
  function big(head, sub, ms = 2600, cls = '') { banner.className = cls; banner.innerHTML = `<b>${head}</b><span>${sub}</span>`; banner.hidden = false; void banner.offsetWidth; banner.classList.add('in'); clearTimeout(bannerTimer); bannerTimer = setTimeout(() => { banner.hidden = true; }, ms); }

  // A ring on the ground at a station when the walker arrives.
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 64), new THREE.MeshBasicMaterial({ color: '#ffd978', transparent: true, opacity: 0, side: THREE.DoubleSide, depthTest: false, fog: false, toneMapped: false }));
  ring.rotation.x = -Math.PI / 2; ring.renderOrder = 4; ring.visible = false; api.scene.add(ring);
  let ringAt = 0;

  function close() {
    if (V.at) state.frozen = false;
    V.at = null; V.busy = false; choice.hidden = true; document.body.classList.remove('choosing');
  }
  // Another part of the app put the walk in a new state (a jump, a scenario, the start screen).
  function reset() { close(); V = fresh(); banner.hidden = true; toast.hidden = true; ring.visible = false; }

  function arrive(name, s) {
    V.at = name; V.seen.add(name); state.frozen = true; state.keys.clear(); toast.hidden = true;
    const pl = api.places.find((q) => q.name === name), first = api.stationInfo(name);
    snd.chord();
    ring.position.set(pl.x, api.heightAt(pl.x, pl.z) + 0.15, pl.z); ring.visible = true; ringAt = performance.now();
    big(`${name} · ARRIVED`, first && first.photo ? `Curiosity stood here on sol ${first.sol}` : 'An imagined stop: not a rover target', 1500, 'gold');
    const n = s.n, work = pl.workMin || 0;
    // What is left for a walk straight home from here, by the tighter of clock and oxygen, after `min` minutes of work.
    const after = (min) => Math.min(n.marginT - min * 60, n.marginO - min * api.stationGpm / api.walkGpm * 60);
    const more = s.ahead.filter((q) => q !== name).length > 0;
    const opt = (key, id, title, cost, sec) => {
      const lvl = sec >= 600 ? 'go' : sec >= 0 ? 'warn' : 'danger';
      return `<button data-id="${id}" data-lvl="${lvl}"><kbd>${key}</kbd><b>${title}</b><span class="cost">${cost}</span>
        <span class="after"><i class="kd" data-kind="model"></i>${sec >= 0 ? `${span(sec)} to spare` : `${span(sec)} into the reserve`}</span></button>`;
    };
    setTimeout(() => api.stationsReady.then(() => {   // the card waits for the station file, so it never shows without the photo and the reason
      if (V.at !== name) return;
      const info = api.stationInfo(name);   // read again: the station file may arrive after the first frame
      document.body.classList.add('choosing');
      choice.hidden = false;
      const photo = info && info.photo ? `<figure><img src="${import.meta.env.BASE_URL}${info.photo}" alt=""><figcaption><i class="kd" data-kind="measured"></i>CURIOSITY MASTCAM · SOL ${info.sol} · THE ROVER'S PHOTO AT THIS STOP</figcaption></figure>` : '';
      const why = info && info.rationale ? `<p class="why-here"><b><i class="kd" data-kind="measured"></i>WHY THE CURIOSITY TEAM LOOKED HERE</b> “${info.rationale.replace(/_/g, ' ')}” <span>Mastcam image label, sol ${info.sol}</span></p>` : '';
      // The chemistry stands beside the photo, so the card keeps its height.
      const chem = chemHtml(api.stationChem(name));
      choice.classList.toggle('wide', !!chem);
      choice.innerHTML = `<header><span class="badge">${name}</span><span class="data">${pl.task || ''}</span></header>
        ${chem ? `<div class="about"><div>${photo}${why}</div>${chem}</div>` : `${photo}${why}`}
        <h2>The plan holds ${work} minutes of work here.</h2>
        <div class="opts">
          ${opt('1', 'work', 'DO THE PLANNED WORK', `${work} min`, after(work))}
          ${opt('2', 'move', 'MOVE ON', 'no work here', after(0))}
          ${more ? opt('3', 'home', 'SKIP THE REST, GO HOME', 'no work here', after(0)) : ''}
        </div>
        <small>The clock stands while you choose. "To spare": what is left if you walk straight home from here, by the tighter of clock and oxygen. The ${work} minutes are an assumption of the plan. What the crew does in them is not modelled.</small>`;
      choice.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => choose(b.dataset.id)));
    }), 1300);
  }
  function choose(id) {
    if (!V.at || V.busy || choice.hidden || !choice.querySelector(`[data-id="${id}"]`)) return;
    const name = V.at, pl = api.places.find((q) => q.name === name), work = pl.workMin || 0;
    V.busy = true; V.last = id;
    choice.hidden = true; document.body.classList.remove('choosing');
    const done = () => {
      if (V.at !== name) return;
      api.stationDone(name); V.at = null; V.busy = false; state.frozen = false;
      if (id === 'home') { api.goHomeNow(); say('Your call: going home. <span>Follow the path to the habitat.</span>'); }
      else if (id === 'work') say(`${work} minutes of work done at ${name}. <span>The gauge now shows what is left.</span>`);
    };
    if (id === 'work') {
      // The work takes a moment on screen while the clock runs through its minutes.
      big('AT WORK', `${work} minutes`, 2300, 'work'); snd.drill(2.2);
      const t0 = performance.now(), each = work / 22; let spent = 0;
      const run = () => {
        if (V.at !== name) return;
        if (spent < 22 && performance.now() - t0 < 2400) { api.work(each); spent += 1; setTimeout(run, 100); } else { if (spent < 22) api.work(each * (22 - spent)); snd.ok(); done(); }
      };
      run();
    } else { snd.tick(); done(); }
  }
  addEventListener('mm-jump', reset);
  addEventListener('keydown', (e) => {
    if (choice.hidden) return;
    const id = { Digit1: 'work', Digit2: 'move', Digit3: 'home', Numpad1: 'work', Numpad2: 'move', Numpad3: 'home' }[e.code];
    if (id) choose(id);
  });

  // ----- Every frame -----
  let lastLevel = null, lastWalkedAll = 0, lastStepAt = 0, lastT = performance.now();
  function tick(s, now) {
    const dt = Math.min(0.1, (now - lastT) / 1000); lastT = now;
    // Sound follows the walk.
    const eta = s.ground >= 0 ? s.eta[s.ground] : s.etaDefault;
    snd.setEffort(eta);
    if (s.walked > lastWalkedAll + 0.01 && now - lastStepAt > 470) { lastStepAt = now; snd.step(s.ground); }
    lastWalkedAll = s.walked;
    if (lastLevel !== null && s.level !== lastLevel) snd.level(s.level);
    lastLevel = s.level;
    if (s.rad.replay) snd.clicks(dt, s.rad.rate / s.rad.quiet);
    if (ring.visible) {
      const k = (now - ringAt) / 1000, grow = Math.min(1, k / 0.5), e = 1 - (1 - grow) ** 3;
      ring.scale.setScalar(0.4 + 6 * e); ring.material.opacity = k < 3 ? 0.9 : Math.max(0, 0.9 - (k - 3));
      if (k > 4) ring.visible = false;
    }
    window.__visit = { at: V.at, open: !choice.hidden, seen: [...V.seen], last: V.last, home: V.home };
    if (V.at || !ui.allow()) return;
    // A station: within ARRIVE_M of it, once, not on the way home and not during a particle event.
    if (!s.back && !s.alarm && s.next.name !== 'HAB' && !V.seen.has(s.next.name) && Math.hypot(state.pos.x - s.next.p.x, state.pos.z - s.next.p.z) < ARRIVE_M) return arrive(s.next.name, s);
    // Home: back at the habitat after having left it. One line, and the walk goes on.
    if (!V.home && V.seen.size > 0 && s.n.back < HOME_M) {
      V.home = true; snd.thud();
      big('BACK AT THE HABITAT', s.n.margin >= 0 ? `${span(s.n.margin)} to spare · oxygen left ${s.n.o2Self} g` : `${span(s.n.margin)} into the reserve · oxygen left ${s.n.o2Self} g`, 4200, s.n.margin >= 0 ? 'gold' : 'danger');
    }
  }
  return { tick, reset, choose, open: () => !choice.hidden, last: () => V.last };
}
