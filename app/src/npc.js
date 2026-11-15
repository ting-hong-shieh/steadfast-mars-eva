// Written with an AI tool (Claude). See AI_USE.md.
// Two machines in the world that the walker can click (owner, 2026-11-15: robots and rovers).
//
//  - Curiosity. The model is NASA's (NASA 3D Resources, "Curiosity Rover (MSL)", SOURCES.md S54).
//    MEASURED: every place of the app is one of the rover's real stops, and the rover faces the
//    way it faced there (yaw in MSL PLACES, S31). The weather and the dose on the display are
//    its own readings of sol 4709, and the card shows them from the instrument that took them.
//    IMAGINED: a rover and a crew on the same ground on the same day, the rover standing
//    ROVER_OFFSET_M beside its stop so the route stays clear, and the mast turning to look at you.
//  - RASSOR. The model is NASA's (NASA 3D Resources, "Regolith Advanced Surface Systems Operations
//    Robot (RASSOR)", S54), thinned to 3 % of its triangles, at the size in the file.
//    IMAGINED: everything it does here. It rolls a loop round the habitat, and follows the walker
//    when told to. It changes no number on the display.
import * as THREE from 'three';
import { gltfLoader } from './habitat.js';
import { envNow } from './env.js';
import { radNow } from './rad.js';

const ROVER_OFFSET_M = 7;          // north-east of the stop. Our choice.
const UP = new THREE.Vector3(0, 1, 0);
const base = `${import.meta.env.BASE_URL}models/`;

// The instruments on the card: mesh names in the NASA model, and what the display takes from each.
const PARTS = {
  rems: { label: 'REMS', meshes: ['REMS_01', 'REMS_02', 'REMS_03'], name: 'Rover Environmental Monitoring Station',
    read: (e) => `Air ${e.air ? (e.air.v - 273.15).toFixed(0) : '--'} °C · ground ${e.ground ? (e.ground.v - 273.15).toFixed(0) : '--'} °C · ${e.pressure ? Math.round(e.pressure.v) : '--'} Pa`,
    note: 'The weather tiles on your display. Sensors on the mast and the deck.' },
  rad: { label: 'RAD', meshes: ['RAD', 'RAD_i'], name: 'Radiation Assessment Detector',
    read: (e, r) => `${r.rate.toFixed(r.rate < 20 ? 1 : 0)} µGy/h${r.replay ? ' · replay of 20 May 2024' : ''}`,
    note: 'The dose rate on your display, and the particle event. Measured inside the instrument, not in a suit.' },
  cam: { label: 'MASTCAM', meshes: ['MastCam', 'NavCam'], name: 'Mast cameras',
    read: () => 'Photos at the stations · stereo of the ground at BOXWORK',
    note: 'The photo you see when you reach a station, and the 5 cm ground at the main place.' },
};

export function setupNpcs({ scene, camera, canvas, state, heightAt, site, hud, alarm }) {
  const ray = new THREE.Raycaster();
  const npcs = [];
  const card = document.createElement('section');
  card.id = 'npcCard'; card.hidden = true;
  hud.appendChild(card);
  let openNpc = null, part = 'rems';
  const want = new URLSearchParams(location.search).get('npc');   // ?npc=rover or ?npc=bot opens that card

  // ----- Curiosity -----
  const rover = { id: 'rover', group: new THREE.Group(), tag: tagEl('CURIOSITY'), head: null, pan: 0, lit: [], hi: [] };
  const yaw = (site.yaw_deg || 0) * Math.PI / 180;
  const rx = ROVER_OFFSET_M * Math.SQRT1_2, rz = -ROVER_OFFSET_M * Math.SQRT1_2;
  rover.pos = new THREE.Vector3(rx, heightAt(rx, rz), rz);
  gltfLoader().loadAsync(base + 'curiosity.glb').then((g) => {
    const m = g.scene;
    // The file holds small cubes that mark pivots (names ending in _p): not parts of the rover.
    // They are parents of real parts, so they are drawn with nothing instead of being switched off.
    m.traverse((o) => { if (o.isMesh) { if (/_p$/.test(o.name)) { o.material = hidden; o.raycast = () => {}; o.userData.pivot = true; } else { o.castShadow = true; o.receiveShadow = true; o.userData.npc = rover; o.material = plain(o.material); } } });
    const box = new THREE.Box3();
    m.updateMatrixWorld(true);
    m.traverse((o) => { if (o.isMesh && !o.userData.pivot) { o.geometry.computeBoundingBox(); box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld)); } });
    m.position.y = -box.min.y;
    rover.group.add(m);
    // The model's front (the arm) is +Z after export. Heading is clockwise from north, north is -z.
    rover.group.rotation.y = Math.PI - yaw;
    rover.group.position.copy(rover.pos);
    rover.head = m.getObjectByName('mast_02');
    for (const [k, p] of Object.entries(PARTS)) {
      for (const n of p.meshes) {
        const o = m.getObjectByName(n);
        if (!o || !o.isMesh) continue;
        o.material = o.material.clone(); o.material.emissive = new THREE.Color('#2f9a63'); o.material.emissiveIntensity = 0;
        rover.hi.push({ k, o });
      }
    }
    rover.height = box.max.y - box.min.y;
    scene.add(rover.group);
    npcs.push(rover);
    if (want === 'rover') show(rover);
    window.__npc = { ...(window.__npc || {}), rover: { x: rx, z: rz, yawDeg: site.yaw_deg, head: !!rover.head, parts: rover.hi.length } };
  }).catch((e) => console.error('curiosity', e));

  // ----- RASSOR -----
  const bot = { id: 'bot', group: new THREE.Group(), tag: tagEl('RASSOR'), follow: false, a: 0.6, pos: new THREE.Vector3(), heading: 0, height: 1 };
  gltfLoader().loadAsync(base + 'rassor.glb').then((g) => {
    const m = g.scene;
    m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.userData.npc = bot; o.material = plain(o.material); if (!o.geometry.attributes.normal) o.geometry.computeVertexNormals(); } });
    const box = new THREE.Box3().setFromObject(m), c = box.getCenter(new THREE.Vector3());
    m.position.set(-c.x, -box.min.y, -c.z);
    bot.group.add(m); bot.height = box.max.y - box.min.y;
    // A small lamp, so it reads as switched on. Our addition, not part of the NASA model.
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.045, 12, 8), new THREE.MeshBasicMaterial({ color: '#6fe3ff' }));
    lamp.position.set(0, bot.height + 0.08, 0); bot.group.add(lamp); bot.lamp = lamp;
    scene.add(bot.group);
    npcs.push(bot);
    if (want === 'bot') show(bot);
    window.__npc = { ...(window.__npc || {}), bot: true };
  }).catch((e) => console.error('rassor', e));

  // The materials of the files are replaced by a plain one that keeps the colour picture only.
  // With the exported normal and gloss maps the frame turned black when the rover was in view.
  function plain(src) {
    return new THREE.MeshStandardMaterial({ map: src.map || null, color: src.map ? '#ffffff' : '#c9c4bc', roughness: 0.78, metalness: 0.15 });
  }
  const hidden = new THREE.MeshBasicMaterial({ visible: false });
  function tagEl(name) {
    const d = document.createElement('div');
    d.className = 'npctag'; d.innerHTML = `<b>${name}</b><span>CLICK TO OPEN</span>`; d.style.display = 'none';
    hud.appendChild(d);
    return d;
  }

  // ----- The card -----
  function show(npc) {
    openNpc = npc; card.hidden = !npc; document.body.classList.toggle('npc-open', !!npc);
    if (!npc) { for (const h of rover.hi) h.o.material.emissiveIntensity = 0; return; }
    if (npc === rover) {
      card.dataset.kind = 'measured';
      card.innerHTML = `<header><span class="badge">NASA ROVER</span><span class="data">MODEL: NASA 3D RESOURCES</span><button aria-label="Close">×</button></header>
        <h2>Curiosity</h2>
        <p>The rover stood ${ROVER_OFFSET_M} m from here on sol ${site.sol}, facing ${Math.round(((site.yaw_deg % 360) + 360) % 360)}°. ${site.main ? 'Its instruments took the readings on your display today.' : 'The readings below are those of sol 4709, taken 13 km or less from here, not of the day it stood here.'}</p>
        <nav>${Object.entries(PARTS).map(([k, p]) => `<button data-part="${k}">${p.label}</button>`).join('')}</nav>
        <div class="part"><b id="npcPart"></b><strong id="npcRead"></strong><span id="npcNote"></span></div>
        <small>MEASURED: the stop, the heading, the readings. IMAGINED: a rover beside a crew, and the mast looking at you.</small>`;
      card.querySelectorAll('[data-part]').forEach((b) => b.addEventListener('click', () => { part = b.dataset.part; flash(); }));
      flash();
    } else {
      card.dataset.kind = 'simulated';
      card.innerHTML = `<header><span class="badge">ROBOT</span><span class="data">MODEL: NASA 3D RESOURCES</span><button aria-label="Close">×</button></header>
        <h2>RASSOR</h2>
        <p>NASA's Regolith Advanced Surface Systems Operations Robot. Here it keeps the crew company: it rolls a loop round the habitat, or follows you.</p>
        <nav><button data-bot="follow"></button></nav>
        <small>IMAGINED: everything this robot does here. It changes no number on your display. The model is thinned to 3 % of its triangles.</small>`;
      const b = card.querySelector('[data-bot]');
      const set = () => { b.textContent = bot.follow ? 'STAY AT THE HABITAT' : 'FOLLOW ME'; b.classList.toggle('on', bot.follow); };
      b.addEventListener('click', () => { bot.follow = !bot.follow; set(); bot.hop = performance.now(); });
      set(); bot.hop = performance.now();
    }
    card.querySelector('header button').addEventListener('click', () => show(null));
  }
  let flashAt = 0;
  function flash() {
    flashAt = performance.now();
    card.querySelectorAll('[data-part]').forEach((b) => b.classList.toggle('on', b.dataset.part === part));
    card.querySelector('#npcPart').textContent = PARTS[part].name;
    card.querySelector('#npcNote').textContent = PARTS[part].note;
  }

  // ----- Click and hover: a press that did not turn into a drag -----
  let down = null, hover = null;
  const pick = (e) => {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
    const hit = ray.intersectObjects(npcs.map((n) => n.group), true)[0];
    return hit && hit.distance < 60 ? hit.object.userData.npc || null : null;
  };
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 5) { const n = pick(e); if (n) show(n === openNpc ? null : n); }
    down = null;
  });
  // The name tag opens the card too: the robot is small and moves, so the tag is the easy target.
  hud.addEventListener('click', (e) => { const t = e.target.closest && e.target.closest('.npctag'); const n = t && npcs.find((q) => q.tag === t); if (n) show(n === openNpc ? null : n); });
  canvas.addEventListener('pointermove', (e) => {
    if (e.buttons) return;
    const n = pick(e);
    if (n !== hover) { hover = n; canvas.style.cursor = n ? 'pointer' : ''; }
  });

  const v = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion(), ax = new THREE.Vector3();
  function label(npc, top, now) {
    const d = Math.hypot(npc.group.position.x - state.pos.x, npc.group.position.z - state.pos.z);
    v.copy(npc.group.position); v.y += top + 0.35; v.project(camera);
    const on = d < 45 && v.z < 1 && Math.abs(v.x) < 1 && Math.abs(v.y) < 1 && openNpc !== npc && !document.body.classList.contains('world-open');
    npc.tag.style.display = on ? '' : 'none';
    if (on) { npc.tag.style.left = `${(v.x + 1) / 2 * innerWidth}px`; npc.tag.style.top = `${(1 - v.y) / 2 * innerHeight}px`; npc.tag.classList.toggle('near', d < 12 || hover === npc); }
    return d;
  }

  return {
    get open() { return openNpc ? openNpc.id : null; },
    update(dt, now) {
      const t = now / 1000;
      if (npcs.includes(rover)) {
        const d = label(rover, rover.height, now);
        // The mast: looks at the walker within 30 m, otherwise sweeps slowly.
        if (rover.head) {
          const want = d < 30 ? Math.atan2(state.pos.x - rover.pos.x, state.pos.z - rover.pos.z) - rover.group.rotation.y : Math.sin(t * 0.25) * 0.9;
          let diff = ((want - rover.pan + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          const step = Math.max(-dt * 0.9, Math.min(dt * 0.9, diff));
          if (Math.abs(step) > 1e-5) {
            rover.pan += step;
            rover.head.parent.getWorldQuaternion(pq);
            ax.copy(UP).applyQuaternion(pq.invert());
            rover.head.quaternion.premultiply(q.setFromAxisAngle(ax, step));
          }
        }
        // The chosen instrument glows; its reading follows the replay.
        const k = openNpc === rover ? 0.35 + 0.65 * Math.exp(-(now - flashAt) / 500) + 0.2 * Math.sin(t * 4) : 0;
        for (const h of rover.hi) h.o.material.emissiveIntensity = h.k === part ? Math.max(0, k) : 0;
        if (openNpc === rover) {
          const el = card.querySelector('#npcRead');
          if (el) el.textContent = PARTS[part].read(envNow(state.elapsedSec), radNow(state.elapsedSec, state.alarm));
        }
      }
      if (npcs.includes(bot)) {
        // Follow: a spot 2.2 m to the walker's right and a little behind. Otherwise a loop of
        // 11 m radius round the stop, at half a metre per second. Both our choices.
        let tx, tz;
        if (bot.follow) {
          tx = state.pos.x + Math.cos(state.heading) * 2.2 - Math.sin(state.heading) * 1.2;
          tz = state.pos.z + Math.sin(state.heading) * 2.2 + Math.cos(state.heading) * 1.2;
        } else { bot.a += dt * 0.5 / 11; tx = Math.cos(bot.a) * 11; tz = Math.sin(bot.a) * 11; }
        if (!bot.placed) { bot.pos.set(tx, 0, tz); bot.placed = true; }
        const dx = tx - bot.pos.x, dz = tz - bot.pos.z, dist = Math.hypot(dx, dz);
        const sp = Math.min(bot.follow ? 2.4 : 0.6, dist / Math.max(dt, 1e-3));
        if (dist > 0.05) {
          bot.pos.x += dx / dist * sp * dt; bot.pos.z += dz / dist * sp * dt;
          const wantH = Math.atan2(dx, dz);
          const dh = ((wantH - bot.heading + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI;
          bot.heading += dh * Math.min(1, dt * 4);
        }
        const y = heightAt(bot.pos.x, bot.pos.z);
        // A small hop when it is clicked or told something.
        const hop = bot.hop ? Math.max(0, 1 - (now - bot.hop) / 420) : 0;
        bot.group.position.set(bot.pos.x, y + 0.02 + Math.sin(hop * Math.PI) * 0.22, bot.pos.z);
        bot.group.rotation.set(0, bot.heading, 0);
        // Lean with the ground under it, front to back.
        const f = heightAt(bot.pos.x + Math.sin(bot.heading) * 0.6, bot.pos.z + Math.cos(bot.heading) * 0.6);
        bot.group.rotateX(-Math.atan2(f - y, 0.6));
        if (bot.lamp) bot.lamp.material.color.set(alarm && alarm() ? '#ff4d4d' : bot.follow ? '#7cffb2' : '#6fe3ff');
        label(bot, bot.height, now);
      }
    },
  };
}
