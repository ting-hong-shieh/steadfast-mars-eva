// Written with an AI tool (Claude). See AI_USE.md.
// The second astronaut (EV2): how much oxygen EV2 uses, and the figure on the ground.
//
// OXYGEN. Two people on the same walk do not use the same oxygen. The Apollo report (SOURCES.md
// S38) gives the oxygen left at the end of each EVA for both crew members, with one prediction
// for both (confidence.js, APOLLO_O2_REMAINING). The ratio of what the two used, per EVA:
//   used = 100 - % remaining, ratio = larger use / smaller use.
// EV2 uses a multiple of the oxygen of EV1 for the same walk and the same work. The default is the
// median of the six ratios (team decision of 2026-11-14). Key E switches EV2 to the largest ratio
// (Apollo 16 EVA 1) from that moment on, for the film: the plan assumed a typical pair, and EV2
// turns out to use more, as one Apollo 16 crew member did. `?ev2=max` or `?ev2=<number>` sets
// the starting ratio.
// This is our use of the report: it gives the numbers, not this rule.
//
// THE PAIR RULE (team decision of 2026-11-14, feature b). The pair walks together and turns back
// together, so every oxygen limit uses whoever runs out first: the margin, the turn-back, the
// safe-return line, the return confidence, the station plan and the off-route numbers.
//
// FIGURE. If the rigged figure below is there (a rigged figure with recorded "Walk" and "Idle"
// clips), it is drawn and its clips are played with three.js's AnimationMixer, at the speed EV2
// walks. Otherwise the fallback below is used.
// FALLBACK FIGURE. NASA 3D Resources "Mark III Spacesuit" (SOURCES.md S39). The Mark III is the suit of
// the NASA walkback test that our oxygen numbers come from (metabolic.js). The file has no
// skeleton, so the legs and arms are given simple joints here, weighted by height and side, and
// they swing as EV2 walks. The swing is a picture, not a gait model.
import * as THREE from 'three';
import { APOLLO_PAIR_RATIOS, PAIR_RATIO_MAX, PAIR_RATIO_MEDIAN, ev2Ratio } from './confidence.js';
export { APOLLO_PAIR_RATIOS, PAIR_RATIO_MAX, PAIR_RATIO_MEDIAN, ev2Ratio };
import { gltfLoader, bakeScene } from './habitat.js';
import { heightAt } from './terrain.js';

// Where EV2 walks: LEAD_M ahead of EV1 along the plan and SIDE_M to its left, so EV1 sees EV2.
// When EV1 leaves the route, EV2 waits on the route. Our choice for the picture.
export const LEAD_M = 9, SIDE_M = 2.2;
const SUIT_H = 1.9;   // drawn height of the suit, m. Our choice: the file has no units.
// The figure (team pick 2026-11-14, "B Tripo 版"): models/astronaut_tripo.glb, made in Tripo Studio
// from our front view, retopologised to about 20,000 triangles, rigged and given its Walk and Idle
// clips there, clips renamed and textures halved in Blender. Its walk covers 1.36 m per 2.333 s
// loop at 1.9 m tall, measured from the stance speed of the feet (docs/checks/ev2_tripo_walk.json, made by
// tools/prep_tripo_figure.py). Played at that rate the feet do not slide.
// ?fig=old shows the earlier figure (Hunyuan3D shape, Quaternius clips; 1.53 m per 1.333 s loop).
const FIG = typeof location !== 'undefined' && new URLSearchParams(location.search).get('fig') === 'old'
  ? { file: 'astronaut.glb', mPerLoop: 1.53, credit: 'TENCENT HUNYUAN3D' }
  : { file: 'astronaut_tripo.glb', mPerLoop: 1.36, credit: 'TRIPO' };
// The credits line names the tool that made the figure on screen (AI watermark rule).
if (typeof document !== 'undefined') {
  const c = document.getElementById('figCredit'); if (c) c.textContent = FIG.credit;
}
const WALK_M_PER_LOOP = FIG.mPerLoop;

const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Companion {
  constructor() {
    this.group = new THREE.Group();
    this.group.visible = false;
    this.ready = false;
    this.phase = 0;
    this.pos = new THREE.Vector3();
    this.heading = 0;
  }

  async load() {
    try {
      const gltf = await gltfLoader().loadAsync(`${import.meta.env.BASE_URL}models/${FIG.file}`);
      const walk = gltf.animations.find((c) => c.name === 'Walk'), idle = gltf.animations.find((c) => c.name === 'Idle');
      if (walk && idle) return this.loadRigged(gltf, walk, idle);
    } catch (e) { /* no rigged figure: use the fallback */ }
    return this.loadMark3();
  }

  // A rigged figure: y up, facing +z, feet at y = 0 (the export rules given to the maker).
  loadRigged(gltf, walk, idle) {
    const fig = gltf.scene;
    fig.updateMatrixWorld(true);  // skinned bounds use the bones' world matrices
    const box = new THREE.Box3().setFromObject(fig), size = box.getSize(new THREE.Vector3());
    this.rawHeight = size.y;
    fig.scale.setScalar(SUIT_H / size.y);
    fig.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    this.group.add(fig);
    this.mixer = new THREE.AnimationMixer(fig);
    this.walk = this.mixer.clipAction(walk); this.idle = this.mixer.clipAction(idle);
    this.walk.play(); this.idle.play();
    this.walk.setEffectiveWeight(0); this.idle.setEffectiveWeight(1);
    this.walkLoopSec = walk.duration;
    this.rigged = true;
    this.ready = true;
  }

  async loadMark3() {
    const gltf = await gltfLoader().loadAsync(`${import.meta.env.BASE_URL}models/mark3.glb`);
    const parts = bakeScene(gltf.scene);
    const box = new THREE.Box3();
    for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
    const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
    const k = SUIT_H / size.y;
    const H = SUIT_H;
    for (const p of parts) p.geometry.translate(-c.x, -box.min.y, -c.z).scale(k, k, k);
    const halfW = size.x * k / 2;

    // Joints, as shares of the height (our estimates for a suited person).
    const hipY = 0.5 * H, kneeY = 0.27 * H, shY = 0.78 * H, legX = 0.09, armX = 0.62 * halfW;
    const bones = [];
    const mk = (parent, x, y, z) => { const b = new THREE.Bone(); b.position.set(x, y, z); if (parent) parent.add(b); bones.push(b); return b; };
    const root = mk(null, 0, hipY, 0);
    const hipL = mk(root, -legX, 0, 0), kneeL = mk(hipL, 0, kneeY - hipY, 0);
    const hipR = mk(root, legX, 0, 0), kneeR = mk(hipR, 0, kneeY - hipY, 0);
    const shL = mk(root, -armX, shY - hipY, 0), shR = mk(root, armX, shY - hipY, 0);
    this.bones = { root, hipL, kneeL, hipR, kneeR, shL, shR, hipY };
    // The bones hang from the group, so moving the group moves the figure. The bind pose is taken
    // with the group at the origin.
    this.group.add(root);
    this.group.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(bones);

    for (const p of parts) {
      const g = p.geometry, pos = g.attributes.position, n = pos.count;
      const idx = new Uint16Array(n * 4), wt = new Float32Array(n * 4);
      for (let i = 0; i < n; i++) {
        const x = pos.getX(i), y = pos.getY(i);
        const left = x < 0;
        let a = 0, b = 0, cIdx = 0, wa = 1, wb = 0, wc = 0;
        // Legs: below the hip, split by side; the shin below the knee.
        const leg = smooth(hipY + 0.06, hipY - 0.12, y);
        // Arms: outside the torso, between hip and shoulder height.
        const arm = (1 - leg) * smooth(armX - 0.1, armX + 0.02, Math.abs(x)) * smooth(hipY - 0.05, hipY + 0.1, y) * smooth(shY + 0.18, shY + 0.02, y);
        if (leg > 0) {
          const shin = smooth(kneeY + 0.05, kneeY - 0.05, y);
          a = 0; b = left ? 1 : 3; cIdx = left ? 2 : 4;
          wa = 1 - leg; wb = leg * (1 - shin); wc = leg * shin;
        } else if (arm > 0) {
          a = 0; b = left ? 5 : 6; wa = 1 - arm; wb = arm;
        }
        idx.set([a, b, cIdx, 0], i * 4); wt.set([wa, wb, wc, 0], i * 4);
      }
      g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(idx, 4));
      g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(wt, 4));
      const mats = Array.isArray(p.material) ? p.material : [p.material];
      // The file's materials are set up for a studio render (transmission, metal). On the open
      // ground they render near black, so they are made plain matte cloth here.
      for (const m of mats) {
        m.side = THREE.FrontSide;
        if ('transmission' in m) m.transmission = 0;
        if ('metalness' in m) m.metalness = Math.min(m.metalness, 0.05);
        if ('roughness' in m) m.roughness = Math.max(m.roughness, 0.75);
        if ('specularIntensity' in m) m.specularIntensity = Math.min(m.specularIntensity, 0.3);
        m.needsUpdate = true;
      }
      const mesh = new THREE.SkinnedMesh(g, p.material);
      mesh.castShadow = true; mesh.frustumCulled = false;
      mesh.bind(skeleton, new THREE.Matrix4());
      this.group.add(mesh);
    }
    this.ready = true;
  }

  // target: where EV2 should stand, dir: the way it should face (unit vector in x, z), dt: s.
  update(target, dir, dt) {
    if (!this.ready || !target) return;
    if (!this.group.visible) {
      this.pos.set(target.x, 0, target.z); this.heading = Math.atan2(dir.x, dir.z);
      this.v = 0; this.y = heightAt(target.x, target.z);
    }
    this.group.visible = true;
    // Walk toward the target at up to 2.5 m/s on screen (faster than EV1, so it keeps up). The
    // speed eases up and down (at most 2 m/s each second) instead of jumping between standing and
    // full speed, so the gait does not stutter when EV1 starts, stops or turns.
    const dx = target.x - this.pos.x, dz = target.z - this.pos.z, d = Math.hypot(dx, dz);
    const want = Math.min(2.5, d * 1.2);
    this.v += Math.max(-2 * dt, Math.min(2 * dt, want - this.v));
    const step = Math.min(d, this.v * dt);
    if (d > 1e-3) { this.pos.x += dx / d * step; this.pos.z += dz / d * step; }
    const moving = this.v > 0.12;
    const face = moving && d > 0.3 ? Math.atan2(dx, dz) : Math.atan2(dir.x, dir.z);
    let dh = face - this.heading; dh = Math.atan2(Math.sin(dh), Math.cos(dh));
    this.heading += dh * Math.min(1, dt * 3);
    // Ground height eased too: the 1 m ground steps would otherwise make the figure hop.
    this.y += (heightAt(this.pos.x, this.pos.z) - this.y) * Math.min(1, dt * 8);
    this.group.position.set(this.pos.x, this.y, this.pos.z);
    if (this.rigged) {
      // Facing +z, so the heading turns it straight to the walking direction.
      this.group.rotation.y = this.heading;
      const speed = this.v;
      // Blend from idle to walk as the speed rises, and play the walk at the speed EV2 moves so
      // the feet do not slide: one loop covers WALK_M_PER_LOOP.
      this.walkW = (this.walkW || 0) + (smooth(0.08, 0.6, speed) - (this.walkW || 0)) * Math.min(1, dt * 5);
      this.walk.setEffectiveWeight(this.walkW); this.idle.setEffectiveWeight(1 - this.walkW);
      this.walk.timeScale = WALK_M_PER_LOOP ? Math.max(0.3, speed * this.walkLoopSec / WALK_M_PER_LOOP) : 1;
      this.mixer.update(dt);
      return;
    }
    // The suit in the file faces -z, so it is turned half a circle to face the walking direction.
    this.group.rotation.y = this.heading + Math.PI;
    // Swing: one stride cycle per 1.4 m walked. Arms swing against the legs.
    this.phase = moving ? this.phase + step / 1.4 * Math.PI * 2 : this.phase * Math.max(0, 1 - dt * 3);
    const s = Math.sin(this.phase), B = this.bones;
    const amp = moving ? 0.42 : 0;
    B.hipL.rotation.x = amp * s; B.hipR.rotation.x = -amp * s;
    B.kneeL.rotation.x = amp * Math.max(0, -Math.cos(this.phase)) * 0.9;
    B.kneeR.rotation.x = amp * Math.max(0, Math.cos(this.phase)) * 0.9;
    B.shL.rotation.x = -amp * 0.5 * s; B.shR.rotation.x = amp * 0.5 * s;
    B.root.position.y = B.hipY + (moving ? Math.abs(Math.cos(this.phase)) * 0.04 : 0);
  }

  head() { return new THREE.Vector3(this.pos.x, heightAt(this.pos.x, this.pos.z) + SUIT_H + 0.25, this.pos.z); }
}
