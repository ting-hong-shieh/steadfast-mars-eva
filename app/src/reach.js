// Written with an AI tool (Claude). See AI_USE.md.
// Safe-return line: the edge of the ground the astronaut can still visit and come back from.
//
// A cell c is inside when walking from here to c and then from c to the habitat fits both
// budgets that the return-limit rule uses (main.js, numbers()):
//   time:   t(here -> c) + t(c -> HAB) <= time left - reserve
//   oxygen: g(here -> c) + g(c -> HAB) <= O2 left - O2 reserve
// Both legs are least-oxygen paths over the 2 m grid (planner.js), and the grams carry the +1 SD
// band, as every turn-back number does (metabolic.js). The astronaut stands inside exactly when
// the margin on the panel is above zero, so the line and the turn-back rule agree.
// The line is drawn between cell centres with marching squares.
import * as THREE from 'three';
import { heightAt } from './terrain.js';

export function reachMask(from, home, budgetT, budgetG) {
  const n = from.time.length, mask = new Uint8Array(n);
  for (let i = 0; i < n; i++) mask[i] = from.time[i] + home.time[i] <= budgetT && from.o2[i] + home.o2[i] <= budgetG ? 1 : 0;
  return mask;
}

// Segments [x1, z1, x2, z2] along the edge of the mask. Cell (r, c) has its centre at
// ((c + 0.5) * cell - half, (r + 0.5) * cell - half). Saddle cases are split one fixed way.
export function contour(mask, N, cell, half) {
  const segs = [];
  const X = (c) => (c + 0.5) * cell - half, Z = (r) => (r + 0.5) * cell - half;
  for (let r = 0; r < N - 1; r++) {
    for (let c = 0; c < N - 1; c++) {
      const a = mask[r * N + c], b = mask[r * N + c + 1], d = mask[(r + 1) * N + c], e = mask[(r + 1) * N + c + 1];
      const k = a | (b << 1) | (e << 2) | (d << 3);
      if (k === 0 || k === 15) continue;
      // Edge midpoints of the square a(top left) b(top right) e(bottom right) d(bottom left).
      const top = [X(c) + cell / 2, Z(r)], right = [X(c + 1), Z(r) + cell / 2];
      const bottom = [X(c) + cell / 2, Z(r + 1)], left = [X(c), Z(r) + cell / 2];
      const add = (p, q) => segs.push([p[0], p[1], q[0], q[1]]);
      switch (k) {
        case 1: case 14: add(left, top); break;
        case 2: case 13: add(top, right); break;
        case 4: case 11: add(right, bottom); break;
        case 8: case 7: add(bottom, left); break;
        case 3: case 12: add(left, right); break;
        case 6: case 9: add(top, bottom); break;
        case 5: add(left, top); add(right, bottom); break;
        case 10: add(top, right); add(bottom, left); break;
      }
    }
  }
  return segs;
}

// The line on the ground: one flat strip per segment, amber, drawn over the terrain.
export class ReachLine {
  constructor(max = 6000) {
    const geo = new THREE.PlaneGeometry(1, 0.32);
    geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color: '#ffb454', transparent: true, opacity: 0.9, depthWrite: false, fog: false, toneMapped: false, side: THREE.DoubleSide });
    this.mesh = new THREE.InstancedMesh(geo, mat, max);
    this.mesh.count = 0; this.mesh.renderOrder = 3; this.mesh.frustumCulled = false;
    this.max = max; this.segs = [];
  }
  set(segs) {
    this.segs = segs;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), ex = new THREE.Vector3(1, 0, 0), d = new THREE.Vector3(), p = new THREE.Vector3(), s = new THREE.Vector3();
    const n = Math.min(this.max, segs.length);
    for (let i = 0; i < n; i++) {
      const [x1, z1, x2, z2] = segs[i];
      const mx = (x1 + x2) / 2, mz = (z1 + z2) / 2;
      const h1 = heightAt(x1, z1), h2 = heightAt(x2, z2);
      p.set(mx, (h1 + h2) / 2 + 0.15, mz);
      // Lay the strip along the slope of the ground.
      d.set(x2 - x1, h2 - h1, z2 - z1);
      const l3 = d.length(); d.divideScalar(l3);
      q.setFromUnitVectors(ex, d);
      s.set(l3 + 0.05, 1, 1);
      m.compose(p, q, s);
      this.mesh.setMatrixAt(i, m);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
