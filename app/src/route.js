// Written with AI tools (Claude and Codex). See AI_USE.md.
// The planned route, the dashed line on the ground, the station beacons and the footstep cues.
// The route is the path of the plan in force between the places (see PLACES below): least oxygen,
// with the factors the crew switched on (planner.js, usePlan).
import * as THREE from 'three';
import { heightAt, estimatedAt, inNavcamSquare } from './terrain.js';
import { planFootholds, PARAMS } from './footholds.js';
import { planTraverse, trace, cellOf, cellXZ } from './planner.js';

export const HUD_CYAN = '#7fe9ff';
export const HUD_GREEN = '#7dffb0';
export const HUD_RED = '#ff6b5e';

// Places. x is east, z is minus north, in metres from the rover position of sol 4709.
// HAB stands at Curiosity's stop of sol 4709 (site 120 drive 0). The stations are three real
// Curiosity stops where Mastcam documented a target (owner's decision of 2026-11-14, docs/decisions.md).
// Positions: MSL PLACES localized_pos.csv. Photos and label facts: app/public/data/stations.json,
// made by tools/station_photos.py. The test checks that these numbers match that file.
// The path between places is the plan's path over the real ground (planner.js).
export const PLACES = [
  { x: 0, z: 0, name: 'HAB' },
  { x: -94.95, z: -165.57, name: 'STN A', target: 'Villa_Abecia', sol: 4616, task: 'Boxwork ridge: vein crossing and wall layers', workMin: 25 },
  { x: 106.95, z: 7.93, name: 'STN B', target: 'Jayhuayco', sol: 4829, task: 'Light-toned bedrock at the east edge of the boxwork', workMin: 25 },
  { x: 77.59, z: 101.78, name: 'STN C', target: 'Salar_De_Maricunga', sol: 4838, task: 'Light-toned ridge at the south edge of the boxwork', workMin: 25 },
  { x: 0, z: 0, name: 'HAB' },
];
// At another place of the world map (site.js) the list is replaced before the app starts.
export function setPlaces(list) { PLACES.length = 0; PLACES.push(...list); }
// workMin: planned work time at a station. PLACEHOLDER (decision O12, issue 38).
// task: our short wording of the Mastcam label rationale at that stop (stations.json has the full text).

export class Route {
  // fields: the fields that lead toward each place (main.js). A leg to such a place is read from
  // its field, so the route and the numbers of the plan come from the same search.
  constructor(flatKmh, places = PLACES, fields = null) {
    this.places = places;
    const plan = planTraverse(places, flatKmh, 'plan', { fields });
    this.plannedSeconds = plan.seconds;
    // Put the route endpoints at HAB itself instead of the centre of its planning cell.
    plan.marks.forEach((mark, i) => {
      if (mark.name === 'HAB') plan.points[mark.index] = places[i];
    });
    // If all stations were dropped while in the HAB cell, the planner returns one cell.
    // Keep both endpoints so the route can also represent a walk of zero metres.
    if (plan.points.length === 1) {
      plan.points[0] = places[0];
      plan.points.push(places.at(-1));
      plan.marks.at(-1).index = 1;
    }
    // Keep every third grid point and the marked places, then smooth.
    const keep = new Set(plan.marks.map((m) => m.index));
    const pts = [];
    const at = new Map();
    plan.points.forEach((q, i) => {
      if (i % 3 === 0 || keep.has(i)) { if (keep.has(i)) at.set(i, pts.length); pts.push(new THREE.Vector3(q.x, 0, q.z)); }
    });
    this.curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal', 0.5);
    const flatLength = this.curve.getLength();
    const n = Math.max(1, Math.ceil(flatLength / 0.5));
    this.samples = [];
    let s = 0, prev = null;
    for (let i = 0; i <= n; i++) {
      const p = this.curve.getPointAt(i / n);
      p.y = heightAt(p.x, p.z);
      if (prev) s += p.distanceTo(prev);
      this.samples.push({ p, s });
      prev = p;
    }
    this.length = s;
    // Stations: the sample closest to each marked place, searched in order along the route.
    this.stations = [];
    let from = 0;
    plan.marks.forEach((m) => {
      const q = plan.points[m.index];
      let best = from, bestD = Infinity;
      for (let k = from; k < this.samples.length; k++) {
        const sm = this.samples[k].p;
        const d = Math.hypot(sm.x - q.x, sm.z - q.z);
        if (d < bestD) { bestD = d; best = k; }
        if (d > bestD + 60) break;
      }
      from = best;
      // 'HERE' is where a re-planned route starts. It is not a station.
      if (m.name !== 'HERE') this.stations.push({ name: m.name, s: this.samples[best].s, p: this.samples[best].p.clone() });
    });
  }

  // Position and heading at distance s along the route.
  at(s) {
    const sm = this.samples;
    s = THREE.MathUtils.clamp(s, 0, this.length);
    let lo = 0, hi = sm.length - 1;
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (sm[mid].s <= s) lo = mid; else hi = mid; }
    const a = sm[lo], b = sm[hi];
    const t = b.s > a.s ? (s - a.s) / (b.s - a.s) : 0;
    const p = a.p.clone().lerp(b.p, t);
    const heading = Math.atan2(b.p.x - a.p.x, -(b.p.z - a.p.z));
    return { p, heading };
  }

  // Distance along the route of the sample closest to (x, z), searched near a hint.
  project(x, z, hintS) {
    const sm = this.samples;
    let best = 0, bestD = Infinity;
    for (let k = 0; k < sm.length; k++) {
      if (Math.abs(sm[k].s - hintS) > 60) continue;
      const d = (sm[k].p.x - x) ** 2 + (sm[k].p.z - z) ** 2;
      if (d < bestD) { bestD = d; best = k; }
    }
    return { s: sm[best].s, offset: Math.sqrt(bestD) };
  }

  nextStation(s) {
    return this.stations.find(st => st.s > s + 2) || this.stations[this.stations.length - 1];
  }
}

function dashMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false, fog: false,
    toneMapped: false, side: THREE.DoubleSide,
  });
}

// The planned route as a ribbon laid on the ground: one cross-section every half metre, each edge
// at the height of the ground under it, so the line follows humps and side slopes. Chevrons flow
// along it in the walking direction (uTime), so the way to go reads even while standing still.
// A stretch over estimated ground inside the Navcam square is red (issue 10).
export function buildRouteLine(route) {
  const half = 0.2, lift = 0.05, sm = route.samples, n = sm.length;
  const pos = new Float32Array(n * 6), uv = new Float32Array(n * 4), col = new Float32Array(n * 6), idx = [];
  const cyan = new THREE.Color(HUD_CYAN), red = new THREE.Color(HUD_RED);
  for (let i = 0; i < n; i++) {
    const a = sm[Math.max(0, i - 1)].p, b = sm[Math.min(n - 1, i + 1)].p, p = sm[i].p;
    let dx = b.x - a.x, dz = b.z - a.z; const d = Math.hypot(dx, dz) || 1; dx /= d; dz /= d;
    const c = estimatedAt(p.x, p.z) ? red : cyan;
    for (let k = 0; k < 2; k++) {
      const sgn = k ? 1 : -1, x = p.x - dz * half * sgn, z = p.z + dx * half * sgn;
      pos.set([x, heightAt(x, z) + lift, z], (i * 2 + k) * 3);
      uv.set([k, sm[i].s], (i * 2 + k) * 2);
      col.set([c.r, c.g, c.b], (i * 2 + k) * 3);
    }
    if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    uniforms: { uTime: { value: 0 }, uS: { value: 0 } },
    vertexShader: 'attribute vec3 color; varying vec2 vUv; varying vec3 vCol; varying float vDist; void main(){ vUv = uv; vCol = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); vDist = length(mv.xyz); gl_Position = projectionMatrix * mv; }',
    fragmentShader: `
      varying vec2 vUv; varying vec3 vCol; varying float vDist; uniform float uTime; uniform float uS;
      void main(){
        float x = abs(vUv.x - 0.5) * 2.0;                       // 0 at the centre line, 1 at the edge
        float edge = smoothstep(0.80, 0.90, x) * (1.0 - smoothstep(0.96, 1.0, x));
        // Chevrons every 1.8 m, pointing forward, moving at 1.4 m/s.
        float ph = fract((vUv.y + x * 0.42 - uTime * 1.4) / 1.8);
        float chev = smoothstep(0.0, 0.06, ph) * (1.0 - smoothstep(0.26, 0.34, ph)) * (1.0 - smoothstep(0.62, 0.74, x));
        float body = 0.10 * (1.0 - x);
        float ahead = smoothstep(uS - 1.5, uS + 1.0, vUv.y);     // dim what lies behind the walker
        // Faint under the boots, so the gauge at the bottom of the view stays the thing to read
        // (design review of 2026-11-14), full from about 10 m ahead.
        float near = mix(0.10, 1.0, smoothstep(3.0, 10.0, vDist));
        float a = (edge * 0.6 + chev * 0.8 + body) * mix(0.18, 1.0, ahead) * near;
        gl_FragColor = vec4(vCol * (1.0 + chev * 0.35), a);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  return mesh;
}

export function buildBeacons(route) {
  const group = new THREE.Group();
  for (const st of route.stations) {
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.6, 1.72, 64).rotateX(-Math.PI / 2),
      dashMaterial(HUD_CYAN, 0.9));
    ring.position.copy(st.p); ring.position.y += 0.08;
    const pole = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 9), dashMaterial(HUD_CYAN, 0.55));
    pole.position.copy(st.p); pole.position.y += 4.5;
    pole.userData.billboard = true;
    ring.userData.station = pole.userData.station = st.name;
    ring.userData.pulse = true;
    group.add(ring, pole);
  }
  return group;
}

function footTexture(letter, color) {
  const cv = document.createElement('canvas');
  cv.width = 128; cv.height = 256;
  const ctx = cv.getContext('2d');
  ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = 7;
  // Outline of a boot print: a rounded shape, drawn as lines.
  ctx.beginPath();
  ctx.roundRect(22, 14, 84, 228, 40);
  ctx.stroke();
  ctx.globalAlpha = 0.22; ctx.fill(); ctx.globalAlpha = 1;
  ctx.font = '600 76px "Chakra Petch", sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(letter, 64, 132);
  const tex = new THREE.CanvasTexture(cv);
  tex.anisotropy = 8;
  return tex;
}

// Footstep cues. Each cue sits on a foothold chosen from the ground heights (footholds.js).
// A cue on ground that Curiosity measured is drawn bright, and a cue on a gap inside the Navcam
// square is drawn faint. Outside the Navcam square the ground is only known from orbit (1 m
// cells), so no cue is drawn there: a foothold chosen from 1 m cells says nothing about where a
// boot can go (issue #40).
export class Footsteps {
  constructor(route) {
    this.route = route;
    this.count = 9;
    this.plan = planFootholds(route);
    const geo = new THREE.PlaneGeometry(0.15, 0.3).rotateX(-Math.PI / 2);
    const mk = (tex) => new THREE.MeshBasicMaterial({
      map: tex, transparent: true, depthWrite: false, fog: false, toneMapped: false });
    this.left = mk(footTexture('L', HUD_CYAN));
    this.right = mk(footTexture('R', HUD_GREEN));
    this.warn = mk(footTexture('!', '#ffb347'));
    this.group = new THREE.Group();
    this.meshes = [];
    for (let i = 0; i < this.count; i++) {
      const mesh = new THREE.Mesh(geo, this.left.clone());
      mesh.renderOrder = 3; mesh.rotation.order = 'YXZ';
      this.group.add(mesh); this.meshes.push(mesh);
    }
  }

  // The next foothold ahead of distance s. Used by the panel.
  next(s) {
    const first = Math.max(0, Math.floor(s / PARAMS.stride));
    return this.plan[first] || null;
  }

  update(s) {
    const first = Math.max(0, Math.floor(s / PARAMS.stride));
    for (let i = 0; i < this.count; i++) {
      const f = this.plan[first + i];
      const mesh = this.meshes[i];
      mesh.visible = !!f && inNavcamSquare(f.x, f.z);
      if (!mesh.visible) continue;
      mesh.position.set(f.x, f.y + 0.035, f.z);
      mesh.rotation.set(f.pitch, -f.heading, f.roll);
      mesh.material.map = !f.valid ? this.warn.map : (f.side < 0 ? this.left.map : this.right.map);
      const fade = i === 0 ? 1 : Math.max(0.12, 1 - i / this.count);
      mesh.material.opacity = fade * (f.measured ? 1 : 0.38);
    }
  }
}

// The way back to the habitat from where the astronaut stands: the least-time path from the
// field computed in planner.js. Drawn in amber.
export class ReturnLine {
  constructor(field) {
    this.field = field;
    const dash = 0.7, width = 0.06;
    this.step = 1.6;
    this.max = 700;
    const geo = new THREE.PlaneGeometry(width, dash).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(geo, dashMaterial('#ffb347', 0.95), this.max);
    this.mesh.renderOrder = 2; this.mesh.visible = false; this.mesh.frustumCulled = false;
    this.cell = -1;
    this.pts = [];
  }

  update(x, z, show) {
    this.mesh.visible = show;
    if (!show) return;
    const c = cellOf(x, z);
    // Same cell: the dashes stay, the start of the traced path moves with the person.
    if (c === this.cell) { if (this.pts.length) this.pts[0] = new THREE.Vector3(x, 0, z); return; }
    this.cell = c;
    const cells = trace(this.field, c);
    const pts = [new THREE.Vector3(x, 0, z)].concat(cells.slice(1).map((i) => { const q = cellXZ(i); return new THREE.Vector3(q.x, 0, q.z); }));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
    let n = 0, carry = 0;
    for (let k = 0; k + 1 < pts.length && n < this.max; k++) {
      const a = pts[k], b = pts[k + 1];
      const len = Math.hypot(b.x - a.x, b.z - a.z);
      const heading = Math.atan2(b.x - a.x, -(b.z - a.z));
      for (let d = carry; d < len && n < this.max; d += this.step) {
        const px = a.x + (b.x - a.x) * d / len, pz = a.z + (b.z - a.z) * d / len;
        q.setFromAxisAngle(up, -heading);
        m.compose(new THREE.Vector3(px, heightAt(px, pz) + 0.09, pz), q, one);
        this.mesh.setMatrixAt(n++, m);
      }
      carry = (carry + Math.ceil(Math.max(0, len - carry) / this.step) * this.step) - len;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.pts = pts;
  }

  // The point `ahead` metres along the way back from the start of the traced path.
  pointAhead(ahead) {
    const pts = this.pts || [];
    let left = ahead;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], len = Math.hypot(b.x - a.x, b.z - a.z);
      if (len >= left) return { x: a.x + (b.x - a.x) * left / len, z: a.z + (b.z - a.z) * left / len };
      left -= len;
    }
    return pts.length ? pts[pts.length - 1] : null;
  }
}
