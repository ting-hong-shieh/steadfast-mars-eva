// Written with an AI tool (Claude). See AI_USE.md.
// Real terrain of the Gale crater boxwork site. The files in public/data are made from NASA data
// by tools/build_gale_terrain.py. See SOURCES.md for the datasets.
//
//  - Orbital ground: 1 m elevation model and 25 cm orthoimage, a 600 m square.
//  - Measured ground: Curiosity Navcam stereo of sol 4709 on 5 cm cells, a 48 m square around the
//    place where the rover stood. Outside the measured cells the ground is the orbital one.
//  - Generated, not measured: the fine grain of the surface below the pixel size of the images,
//    the colour (the images are grey), the sky and the light.
//
// Axes: x is east, z is minus north, y is up. Metres from the rover position of sol 4709.
import * as THREE from 'three';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';

export const TERRAIN_SIZE = 600;
const D = { ready: false };

async function bin(url, Type) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return new Type(await r.arrayBuffer());
}
function image(url) {
  return new Promise((ok, fail) => {
    const im = new Image();
    im.onload = () => ok(im); im.onerror = () => fail(new Error(url));
    im.src = url;
  });
}
function pixels(im) {
  const cv = document.createElement('canvas');
  cv.width = im.width; cv.height = im.height;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(im, 0, 0);
  return ctx.getImageData(0, 0, im.width, im.height).data;
}

export async function loadTerrain(base = 'data/') {
  const meta = await fetch(base + 'terrain.json').then((r) => r.json());
  // A place from tools/build_site_terrain.py has orbital ground only (meta.near is null).
  const hasNear = !!meta.near;
  const [orb, det, ortho, grey, weight] = await Promise.all([
    bin(base + 'orbital_height.bin', Int16Array),
    hasNear ? bin(base + 'near_detail.bin', Int16Array) : null,
    image(base + 'orbital_ortho.jpg'),
    hasNear ? image(base + 'near_grey.png') : null,
    hasNear ? image(base + 'near_weight.png') : null,
  ]);
  // Ground classes from the terrain model (tools/seg/infer_sites.py), one 48 m patch per Curiosity
  // stop with Navcam stereo: HAB and STN A (classes/classes.json). Optional: without the files the
  // oxygen model uses its default ground factor everywhere.
  D.patches = [];
  try {
    const idx = await fetch(base + 'classes/classes.json').then((r) => r.json());
    for (const p of idx.patches) {
      const im = await image(base + 'classes/' + p.file);
      D.patches.push({ ...p, n: im.width, px: pixels(im) });
    }
  } catch { D.patches = []; }
  Object.assign(D, {
    meta, orb, det, ortho, grey, weight,
    on: meta.orbital.cells, nn: hasNear ? meta.near.cells : 0,
    nearHalf: hasNear ? meta.near.size_m / 2 : 0, nearCell: hasNear ? meta.near.cell_m : 1,
    weightPx: hasNear ? pixels(weight) : null, ready: true,
  });
  return meta;
}

function sample(grid, n, col, row) {
  const c0 = Math.min(n - 2, Math.max(0, Math.floor(col)));
  const r0 = Math.min(n - 2, Math.max(0, Math.floor(row)));
  const fc = Math.min(1, Math.max(0, col - c0)), fr = Math.min(1, Math.max(0, row - r0));
  const i = r0 * n + c0;
  return grid[i] * (1 - fc) * (1 - fr) + grid[i + 1] * fc * (1 - fr)
    + grid[i + n] * (1 - fc) * fr + grid[i + n + 1] * fc * fr;
}

export function orbitalHeightAt(x, z) {
  // Cell centres are at half metres. Row 0 is the north edge.
  return sample(D.orb, D.on, x + TERRAIN_SIZE / 2 - 0.5, z + TERRAIN_SIZE / 2 - 0.5) / 100;
}

export function heightAt(x, z) {
  let h = orbitalHeightAt(x, z);
  const half = D.nearHalf;
  if (Math.abs(x) < half && Math.abs(z) < half) {
    h += sample(D.det, D.nn, (x + half) / D.nearCell - 0.5, (z + half) / D.nearCell - 0.5) / 1000;
  }
  return h;
}

// True where the 5 cm cell under (x, z) holds measured Navcam points.
export function measuredAt(x, z) {
  const half = D.nearHalf;
  if (Math.abs(x) >= half || Math.abs(z) >= half) return false;
  const c = Math.floor((x + half) / D.nearCell), r = Math.floor((z + half) / D.nearCell);
  return D.weightPx[4 * (r * D.nn + c)] > 127;
}

// Ground class of the 5 cm cell under (x, z) from the terrain model: 0 soil, 1 bedrock, 2 sand,
// 3 big rock. -1 where the model gave no class (outside the Navcam square, or no stereo point).
export function classAt(x, z) {
  for (const p of D.patches || []) {
    const dx = x - p.x, dz = z - p.z;
    if (Math.abs(dx) >= p.half_m || Math.abs(dz) >= p.half_m) continue;
    const c = Math.floor((dx + p.half_m) / p.cell_m), r = Math.floor((dz + p.half_m) / p.cell_m);
    const v = p.px[4 * (r * p.n + c)];
    if (v < 4) return v;
    // Far from the rover the stereo points thin out and many 5 cm cells hold no vote. Then take
    // the most common class within 0.3 m (6 cells), or none.
    const cnt = [0, 0, 0, 0];
    for (let dr = -6; dr <= 6; dr += 2) for (let dc = -6; dc <= 6; dc += 2) {
      const rr = r + dr, cc = c + dc;
      if (rr < 0 || cc < 0 || rr >= p.n || cc >= p.n) continue;
      const w = p.px[4 * (rr * p.n + cc)];
      if (w < 4) cnt[w]++;
    }
    const best = cnt.indexOf(Math.max(...cnt));
    return cnt[best] > 0 ? best : -1;
  }
  return -1;
}

// The classified patches: centre, half size and name.
export const classPatches = () => (D.patches || []).map((p) => ({ name: p.name, x: p.x, z: p.z, half_m: p.half_m }));

// The patch that holds (x, z), or null.
export function classPatchAt(x, z) {
  return (D.patches || []).find((p) => Math.abs(x - p.x) < p.half_m && Math.abs(z - p.z) < p.half_m) || null;
}

// How the classes look on the ground. 'material': a light change of the surface per class, so the
// classified ground reads as different materials; soil stays the base. 'label': the class colours
// of the model's own previews, for showing what the model found (key C). The tints are our choice.
const CLASS_LOOK = {
  material: [[0, 0, 0, 0], [246, 226, 204, 0.20], [92, 78, 68, 0.26], [70, 58, 50, 0.34]],
  label: [[205, 160, 110, 0.5], [120, 120, 200, 0.55], [240, 220, 80, 0.55], [220, 60, 60, 0.6]],
};
const classMeshes = [];
function classTexture(p, look) {
  const cv = document.createElement('canvas');
  cv.width = cv.height = p.n;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(p.n, p.n);
  for (let i = 0; i < p.n * p.n; i++) {
    const v = p.px[4 * i];
    if (v > 3) continue;
    const [r, g, b, a] = CLASS_LOOK[look][v];
    img.data[4 * i] = r; img.data[4 * i + 1] = g; img.data[4 * i + 2] = b; img.data[4 * i + 3] = Math.round(255 * a);
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export function setClassLook(look) {
  for (const m of classMeshes) { m.material.map = m.userData[look]; m.material.needsUpdate = true; }
}

// True inside the square of ground built from Curiosity Navcam points (48 m on a side).
export function inNavcamSquare(x, z) {
  const half = D.nearHalf;
  return Math.abs(x) < half && Math.abs(z) < half;
}

// True inside the Navcam square where the cell holds no measured points. The ground there is the
// orbital shape moved by a smoothed difference (tools/build_gale_terrain.py).
export function estimatedAt(x, z) {
  const half = D.nearHalf;
  return Math.abs(x) < half && Math.abs(z) < half && !measuredAt(x, z);
}

export function slopeDegAt(x, z, heading) {
  const step = 1.0;
  const dx = Math.sin(heading) * step, dz = -Math.cos(heading) * step;
  const rise = heightAt(x + dx, z + dz) - heightAt(x - dx, z - dz);
  return Math.atan2(rise, 2 * step) * 180 / Math.PI;
}

function hash(ix, iz) {
  let h = (ix * 374761393 + iz * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967295;
}

// GENERATED. Grain below the pixel size of the images. It only changes how light falls on the
// surface (a bump map). It does not change any height used by the app.
function grainTexture(repeat) {
  const size = 512;
  const cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(size, size);
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    const v = Math.floor(96 + 150 * (0.5 * hash(x >> 2, y >> 2) + 0.5 * hash(x, y)));
    img.data[4 * i] = img.data[4 * i + 1] = img.data[4 * i + 2] = v;
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat, repeat);
  return tex;
}

// GENERATED. The look of the surface below what the images resolve (owner, 2026-11-15: the ground
// read as a smooth desert). It follows two real things: how bright the orbital image is at that
// spot, and how steep the measured ground is. Dark and flat is drawn as dark rippled sand, bright
// as light plates with cracks, steep as rubble. This is a drawing style and NOT a ground type:
// our check (tools/build_ground_estimate.py) found that the orbital data cannot tell the camera
// model's classes. It changes colour only. No height, route or number reads it.
function noiseTexture() {
  const size = 256, cv = document.createElement('canvas');
  cv.width = cv.height = size;
  const ctx = cv.getContext('2d'), img = ctx.createImageData(size, size);
  // Smooth value noise that tiles, three different patterns in red, green and blue.
  const val = (x, y, cells, seed) => {
    const fx = x / size * cells, fy = y / size * cells, x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0, sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const g = (ix, iy) => hash(((ix % cells) + cells) % cells + seed * 97, ((iy % cells) + cells) % cells + seed * 131);
    return (g(x0, y0) * (1 - sx) + g(x0 + 1, y0) * sx) * (1 - sy) + (g(x0, y0 + 1) * (1 - sx) + g(x0 + 1, y0 + 1) * sx) * sy;
  };
  for (let i = 0; i < size * size; i++) {
    const x = i % size, y = (i / size) | 0;
    for (let ch = 0; ch < 3; ch++) {
      const v = 0.55 * val(x, y, 8, ch + 1) + 0.3 * val(x, y, 16, ch + 4) + 0.15 * val(x, y, 32, ch + 7);
      img.data[4 * i + ch] = Math.round(255 * v);
    }
    img.data[4 * i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
let noiseTex = null;
// Median brightness (linear, green) of an image, from a 64 x 64 copy. The look below compares each
// spot with it, so a dark place and a bright place get the same share of sand and plates.
function medianGreen(image) {
  try {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64;
    const ctx = cv.getContext('2d'); ctx.drawImage(image, 0, 0, 64, 64);
    const d = ctx.getImageData(0, 0, 64, 64).data, v = [];
    for (let i = 1; i < d.length; i += 4) { const a = d[i] / 255; v.push(a <= 0.04045 ? a / 12.92 : ((a + 0.055) / 1.055) ** 2.4); }
    v.sort((a, b) => a - b);
    return v[v.length >> 1] || 0.33;
  } catch { return 0.33; }
}
function marsLook(mat, strength = 1, median = 0.33) {
  noiseTex = noiseTex || noiseTexture();
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNoise = { value: noiseTex }; sh.uniforms.uLook = { value: strength }; sh.uniforms.uGain = { value: 0.33 / Math.max(0.08, median) };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWp = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vWp; uniform sampler2D uNoise; uniform float uLook; uniform float uGain;')
      .replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec2 m = vWp.xz;
        float g = texture2D(map, vMapUv).g * uGain;                      // brightness of the measured image against the median of the place
        float n1 = texture2D(uNoise, m / 9.0).r, n2 = texture2D(uNoise, m / 1.7).g, n3 = texture2D(uNoise, m / 0.31).b;
        float up = abs(normalize(cross(dFdx(vWp), dFdy(vWp))).y);
        float flatK = smoothstep(0.93, 0.99, up), steep = 1.0 - smoothstep(0.80, 0.93, up);
        float sand = (1.0 - smoothstep(0.20, 0.36, g + 0.10 * (n1 - 0.5))) * flatK;
        float plate = smoothstep(0.44, 0.62, g + 0.12 * (n1 - 0.5)) * (1.0 - steep);
        float ripple = 0.5 + 0.5 * sin((m.x * 0.8 + m.y * 0.6) * 11.0 + n2 * 7.0);
        float crack = (1.0 - smoothstep(0.0, 0.03, abs(n2 - 0.5))) + 0.6 * (1.0 - smoothstep(0.0, 0.05, abs(texture2D(uNoise, m / 4.3 + 0.37).r - 0.5)));
        vec3 c = diffuseColor.rgb * (0.80 + 0.42 * n3 * (0.6 + 0.8 * n2));
        c = mix(c, c * vec3(0.50, 0.40, 0.36) * (0.90 + 0.22 * ripple), sand * 0.8);
        c = mix(c, c * vec3(1.10, 1.03, 0.95), plate * 0.55);
        c *= 1.0 - 0.5 * min(1.0, crack) * plate;
        c = mix(c, c * vec3(0.62, 0.56, 0.53) * (0.55 + 1.0 * n3), steep * 0.65);
        diffuseColor.rgb = mix(diffuseColor.rgb, c, uLook);
      }`);
  };
  mat.customProgramCacheKey = () => `mars${strength}`;   // the gain is a uniform, one program serves every place
  return mat;
}

// GENERATED. Small rocks scattered on the orbital ground, where it is not steep. Decoration: they
// are not rocks that a camera saw, and none stands inside the 48 m square of measured ground,
// where the real rocks are in the measured shape. No route or number reads them.
function scatterRocks(skipHalf) {
  let geo = new THREE.IcosahedronGeometry(1, 1);
  geo.deleteAttribute('normal'); geo.deleteAttribute('uv'); geo = mergeVertices(geo, 1e-3);   // shared corners, so the rocks shade smooth
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    const k = 0.82 + 0.2 * Math.sin(3.1 * x + 1.7 * y) * Math.sin(2.3 * z + x) + 0.1 * Math.sin(5.3 * y + 2.9 * z);
    pos.setXYZ(i, x * k, y * k * 0.6, z * k);
  }
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: '#a38a78', roughness: 1, metalness: 0 });
  const N = 11000, mesh = new THREE.InstancedMesh(geo, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  const half = TERRAIN_SIZE / 2 - 4;
  let n = 0;
  for (let i = 0; i < 90000 && n < N; i++) {
    const x = (hash(i, 11) * 2 - 1) * half, z = (hash(i, 29) * 2 - 1) * half;
    if (Math.abs(x) < skipHalf && Math.abs(z) < skipHalf) continue;
    // Clusters: a slow pattern decides where rocks gather.
    const cl = 0.5 * hash(Math.floor(x / 14), Math.floor(z / 14) + 5) + 0.5 * hash(Math.floor(x / 37) + 9, Math.floor(z / 37));
    if (hash(i, 53) > 0.15 + 0.85 * cl * cl) continue;
    const y = heightAt(x, z), sl = Math.hypot(heightAt(x + 1, z) - heightAt(x - 1, z), heightAt(x, z + 1) - heightAt(x, z - 1)) / 2;
    if (sl > 0.45) continue;
    const r = 0.05 + 0.3 * hash(i, 71) ** 3 + (hash(i, 73) > 0.992 ? 0.45 : 0);
    e.set(hash(i, 3) * 0.6, hash(i, 5) * 6.28, hash(i, 7) * 0.6); q.setFromEuler(e);
    p.set(x, y + r * 0.18, z); sc.set(r * (0.8 + 0.6 * hash(i, 13)), r, r * (0.8 + 0.6 * hash(i, 17)));
    mesh.setMatrixAt(n++, m4.compose(p, q, sc));
  }
  mesh.count = n; mesh.instanceMatrix.needsUpdate = true;
  mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = false;
  mesh.userData.generated = n;
  rockMesh = mesh;
  return mesh;
}
// The generated rocks are decoration: no camera measured them, and the route does not know them.
// So none may lie on the planned path, where it would read as an obstacle the display ignores.
// This takes away every generated rock within `r` metres of the given points (owner, 2026-11-15).
let rockMesh = null;
export function clearRocksNear(points, r = 3) {
  if (!rockMesh) return 0;
  const m4 = new THREE.Matrix4(), zero = new THREE.Matrix4().makeScale(0, 0, 0), r2 = r * r;
  let gone = 0;
  for (let i = 0; i < rockMesh.count; i++) {
    rockMesh.getMatrixAt(i, m4);
    const x = m4.elements[12], z = m4.elements[14];
    if (m4.elements[0] === 0 && m4.elements[5] === 0) continue;
    for (const p of points) { const dx = p.x - x, dz = p.z - z; if (dx * dx + dz * dz < r2) { rockMesh.setMatrixAt(i, zero); gone += 1; break; } }
  }
  rockMesh.instanceMatrix.needsUpdate = true;
  if (typeof window !== 'undefined') window.__rocksCleared = (window.__rocksCleared || 0) + gone;
  return gone;
}

function drape(size, seg, heightFn, keepFace) {
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) pos.setY(i, heightFn(pos.getX(i), pos.getZ(i)));
  if (keepFace) {
    const src = geo.index.array, out = [];
    for (let i = 0; i < src.length; i += 3) {
      if (keepFace(pos, src[i], src[i + 1], src[i + 2])) out.push(src[i], src[i + 1], src[i + 2]);
    }
    geo.setIndex(out);
  }
  geo.computeVertexNormals();
  return geo;
}

// The images are grey. The tint sets their colour. Since 2026-11-14 it comes from the three
// calibrated Mastcam images of the stations (S30): it was adjusted until the rendered ground at
// STN A had the same mean colour share (red, green, blue in linear light) as those photos,
// 0.53 : 0.29 : 0.18, and then set to full brightness. The colour is from the photos. The
// brightness is a display choice. ?tint=assumed shows the earlier assumed orange tint.
const TINT = typeof location !== 'undefined' && new URLSearchParams(location.search).get('tint') === 'assumed' ? '#f0b183' : '#ffe8de';

export function buildTerrain(renderer) {
  const group = new THREE.Group();
  const aniso = renderer ? renderer.capabilities.getMaxAnisotropy() : 8;

  // Orbital ground, with a square hole where the measured ground sits.
  const hole = D.nearHalf - 1.5;
  const inside = (p, i) => Math.abs(p.getX(i)) < hole && Math.abs(p.getZ(i)) < hole;
  const farGeo = drape(TERRAIN_SIZE, 480, orbitalHeightAt, (p, a, b, c) => !(inside(p, a) && inside(p, b) && inside(p, c)));
  const orthoTex = new THREE.Texture(D.ortho);
  orthoTex.colorSpace = THREE.SRGBColorSpace; orthoTex.anisotropy = aniso; orthoTex.needsUpdate = true;
  const farMat = new THREE.MeshStandardMaterial({
    color: TINT, map: orthoTex, roughness: 1, metalness: 0,
    bumpMap: grainTexture(TERRAIN_SIZE / 1.6), bumpScale: 2.2,
  });
  const plainLook = typeof location !== 'undefined' && new URLSearchParams(location.search).get('ground') === 'plain';
  if (!plainLook) marsLook(farMat, 1, medianGreen(D.ortho));
  const far = new THREE.Mesh(farGeo, farMat);
  far.receiveShadow = true;
  group.add(far);
  if (!plainLook) { const rocks = scatterRocks(D.nearHalf + 1); group.add(rocks); if (typeof window !== 'undefined') window.__rocks = rocks.userData.generated; }

  if (!D.nn) return group;   // a place with orbital ground only
  // Measured ground: Navcam grey where a cell is measured, the orbital image elsewhere.
  const n = D.nn;
  const cv = document.createElement('canvas');
  cv.width = cv.height = n;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  const pxPerM = D.ortho.width / TERRAIN_SIZE;
  const s0 = (TERRAIN_SIZE / 2 - D.nearHalf) * pxPerM;
  ctx.drawImage(D.ortho, s0, s0, 2 * D.nearHalf * pxPerM, 2 * D.nearHalf * pxPerM, 0, 0, n, n);
  const base = ctx.getImageData(0, 0, n, n);
  const g = pixels(D.grey), w = D.weightPx;
  for (let i = 0; i < n * n; i++) {
    if (w[4 * i] > 127) {
      base.data[4 * i] = base.data[4 * i + 1] = base.data[4 * i + 2] = g[4 * i];
    } else {
      // Estimated ground inside the Navcam square: a light red overlay, so that the border
      // between measured and estimated ground is visible. Proposed by the presentation lead
      // in issue 10. Kept light: the proposal asks for a semi-transparent light red.
      base.data[4 * i] = Math.min(255, base.data[4 * i] * 0.9 + 255 * 0.1);
      base.data[4 * i + 1] = base.data[4 * i + 1] * 0.8;
      base.data[4 * i + 2] = base.data[4 * i + 2] * 0.8;
    }
  }
  ctx.putImageData(base, 0, 0);
  const nearTex = new THREE.CanvasTexture(cv);
  nearTex.colorSpace = THREE.SRGBColorSpace; nearTex.anisotropy = aniso;
  const nearGeo = drape(2 * D.nearHalf, 640, heightAt);
  const nearMat = new THREE.MeshStandardMaterial({
    color: TINT, map: nearTex, roughness: 1, metalness: 0,
    bumpMap: grainTexture(2 * D.nearHalf / 1.6), bumpScale: 1.2,
    polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
  });
  const near = new THREE.Mesh(nearGeo, nearMat);
  near.receiveShadow = true; near.castShadow = true;
  group.add(near);

  // Ground classes: a thin layer over the ground of each patch.
  for (const p of D.patches) {
    const geo = drape(2 * p.half_m, 320, (x, z) => heightAt(x + p.x, z + p.z) + 0.02);
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffffff', transparent: true, depthWrite: false, roughness: 1, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(p.x, 0, p.z);
    m.receiveShadow = true;
    m.userData = { material: classTexture(p, 'material'), label: classTexture(p, 'label') };
    mat.map = m.userData.material;
    classMeshes.push(m);
    group.add(m);
  }
  return group;
}

// GENERATED sky. The colours and the size of the sun are not taken from a source yet.
export function buildSky() {
  const geo = new THREE.SphereGeometry(2000, 32, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      horizon: { value: new THREE.Color('#d6a67c') },
      zenith: { value: new THREE.Color('#7d6152') },
      sunDir: { value: new THREE.Vector3(0.45, 0.32, -0.83).normalize() },
      halo: { value: 0 },
      decode: { value: 0 },
    },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `
      varying vec3 vDir; uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; uniform float halo; uniform float decode;
      void main(){
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 col = mix(horizon, zenith, pow(h, 0.55));
        float s = max(dot(normalize(vDir), sunDir), 0.0);
        col += vec3(0.55, 0.62, 0.72) * pow(s, 60.0) * 0.5;
        col += vec3(1.0, 0.88, 0.74) * pow(s, 6.0) * halo;
        col += vec3(1.0, 0.97, 0.93) * smoothstep(0.99975, 0.99988, s);
        // decode = 1 when a later pass encodes to sRGB (look.js): undo it so the sky looks the same.
        if (decode > 0.5) col = pow(col, vec3(2.2));
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  return new THREE.Mesh(geo, mat);
}
