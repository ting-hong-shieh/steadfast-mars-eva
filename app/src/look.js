// Scene look: light, sky glow, dust in the air and a camera finish. Display choices only. Nothing
// here changes a height, a route, a number on the HUD or any measured value.
// ?look=new turns it on. ?look=old (or no option, until the team picks) keeps the earlier look.
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

// Soft round sprite for the dust.
function dotTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// Fine dust drifting in a box that follows the camera.
class Dust {
  constructor(n = 1400, box = 26) {
    this.box = box;
    const pos = new Float32Array(3 * n);
    for (let i = 0; i < 3 * n; i++) pos[i] = (Math.random() - 0.5) * box;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      map: dotTexture(), color: '#f3d2b4', size: 0.022, sizeAttenuation: true,
      transparent: true, opacity: 0.55, depthWrite: false, fog: true,
    }));
    this.points.frustumCulled = false;
    this.wind = new THREE.Vector3(0.35, 0.02, -0.12);
  }
  update(dt, cam) {
    const p = this.points.geometry.attributes.position, a = p.array, h = this.box / 2;
    for (let i = 0; i < a.length; i += 3) {
      a[i] += this.wind.x * dt; a[i + 1] += this.wind.y * dt + Math.sin(i + performance.now() * 0.0004) * 0.002; a[i + 2] += this.wind.z * dt;
      // Keep every grain inside the box around the camera.
      for (let k = 0; k < 3; k++) {
        const c = cam.position.getComponent(k);
        if (a[i + k] < c - h) a[i + k] += this.box; else if (a[i + k] > c + h) a[i + k] -= this.box;
      }
    }
    p.needsUpdate = true;
  }
}

const FinishShader = {
  uniforms: { tDiffuse: { value: null }, time: { value: 0 }, aspect: { value: 1 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
  fragmentShader: `
    uniform sampler2D tDiffuse; uniform float time; uniform float aspect; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
      float v = smoothstep(1.05, 0.35, length(d));      // soft visor vignette
      c.rgb *= mix(0.74, 1.0, v);
      float n = fract(sin(dot(vUv * vec2(1733.0, 977.0) + time, vec2(12.9898, 78.233))) * 43758.5453);
      c.rgb += (n - 0.5) * 0.022;                         // light grain
      gl_FragColor = c;
    }`,
};

export function setupLook({ renderer, scene, camera, sun, hemi, sky }) {
  // Light: a stronger, warmer sun and a weaker sky fill, so shapes read by their shadows.
  sun.color.set('#ffe7cc');
  sun.intensity = 3.1;
  sun.shadow.mapSize.set(4096, 4096);
  hemi.intensity = 0.55;
  hemi.color.set('#e8bf9c');
  hemi.groundColor.set('#4a2c1f');
  scene.fog.color.set('#cf9f78');
  // Sky: a wide warm glow around the sun as well as the small blue one.
  sky.material.uniforms.halo.value = 0.12;
  sky.material.uniforms.decode.value = 1;

  const dust = new Dust();
  scene.add(dust.points);

  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const target = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType, samples: 4 });
  const composer = new EffectComposer(renderer, target);
  composer.addPass(new RenderPass(scene, camera));
  // No ambient occlusion pass: it drew dark slabs under the see-through lines on the ground
  // (route ribbon, return line), seen in the screenshots of 2026-11-14.
  composer.addPass(new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.28, 0.6, 0.92));
  composer.addPass(new OutputPass());
  const finish = new ShaderPass(FinishShader);
  composer.addPass(finish);

  return {
    render(dt) {
      dust.update(dt, camera);
      finish.uniforms.time.value = (performance.now() % 10000) / 1000;
      composer.render(dt);
    },
    resize(w, h) {
      composer.setSize(w, h);
      finish.uniforms.aspect.value = w / h;
    },
  };
}
