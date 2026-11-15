// Written with an AI tool (Claude). See AI_USE.md.
// The habitat and its antenna, drawn at HAB.
//
// Model: NASA 3D Resources, "Habitat Demonstration Unit (part 1)" (SOURCES.md S39). The Habitat
// Demonstration Unit is NASA's habitat prototype that was tested in the field at Desert RATS 2010.
// Size: "a 5-meter diameter vertical axis cylinder" (Tri et al. 2011, NTRS 20110013501, p. 2;
// SOURCES.md S40). The file has no units, so the cylinder is scaled to 5 m here.
//
// Place: the route starts and ends at Curiosity's stop of sol 4709 (route.js). The habitat is drawn
// HAB_OFFSET_M to the south-west of that point, so it stands beside the stop and not on the
// route. The line-of-sight model (los.js) still puts the habitat antenna on the stop itself, at
// HAB_ANT_M. The mast is drawn MAST_OFFSET_M from the stop, less than one 2 m grid cell.
// Both offsets are our choice for the picture. They change no number on the panel.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { heightAt } from './terrain.js';
import { HAB_ANT_M } from './los.js';

export const HDU_DIAMETER_M = 5;
const HAB_OFFSET_M = 8, MAST_OFFSET_M = 1.2;
// South-west of the stop: away from the first leg (to STN A, north-west) and the last leg (from
// STN C, south-east), so the habitat is seen when the astronaut turns round and on the way home.
const DIR = new THREE.Vector2(-1, 1).normalize();

let loader = null;
export function gltfLoader() {
  if (loader) return loader;
  const draco = new DRACOLoader();
  draco.setDecoderPath(`${import.meta.env.BASE_URL}draco/`);
  loader = new GLTFLoader();
  loader.setDRACOLoader(draco);
  return loader;
}

// Bake every mesh of a loaded scene into one group with y up and the given node transforms applied.
export function bakeScene(gltfScene) {
  gltfScene.updateMatrixWorld(true);
  const out = [];
  gltfScene.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    out.push({ geometry: g, material: o.material });
  });
  return out;
}

export async function buildHabitat(hab) {
  const group = new THREE.Group();
  const gltf = await gltfLoader().loadAsync(`${import.meta.env.BASE_URL}models/hdu.glb`);
  const parts = bakeScene(gltf.scene);
  const box = new THREE.Box3();
  for (const p of parts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  // The cylinder is the part's extent across the axis that is not the airlock's long axis: the
  // shorter horizontal extent of the whole model.
  const size = box.getSize(new THREE.Vector3());
  const k = HDU_DIAMETER_M / Math.min(size.x, size.z);
  const model = new THREE.Group();
  for (const p of parts) {
    const m = new THREE.Mesh(p.geometry, p.material);
    m.castShadow = m.receiveShadow = true;
    model.add(m);
  }
  model.scale.setScalar(k);
  // Feet on the ground: lowest point of the model at the ground height.
  const cx = hab.x + DIR.x * HAB_OFFSET_M, cz = hab.z + DIR.y * HAB_OFFSET_M;
  const centre = box.getCenter(new THREE.Vector3());
  model.position.set(cx - centre.x * k, heightAt(cx, cz) - box.min.y * k + 0.05, cz - centre.z * k);
  group.add(model);

  // Antenna mast: a pole to HAB_ANT_M with a small dish at the top.
  const mx = hab.x + DIR.x * MAST_OFFSET_M, mz = hab.z + DIR.y * MAST_OFFSET_M, my = heightAt(mx, mz);
  const metal = new THREE.MeshStandardMaterial({ color: '#c9c4bc', metalness: 0.6, roughness: 0.45 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, HAB_ANT_M, 10), metal);
  pole.position.set(mx, my + HAB_ANT_M / 2, mz);
  const dish = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 8, 0, Math.PI * 2, 0, Math.PI / 3.2), metal);
  dish.rotation.x = Math.PI / 2.4;
  dish.position.set(mx, my + HAB_ANT_M - 0.05, mz);
  const feet = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 3), metal);
  feet.position.set(mx, my + 0.02, mz);
  for (const m of [pole, dish, feet]) { m.castShadow = true; group.add(m); }
  group.userData = { centre: { x: cx, z: cz }, mast: { x: mx, z: mz } };
  return group;
}
