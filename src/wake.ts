import * as THREE from 'three';
import type { WaterPalette } from './palette';
import { seaHeightAt, type SpotConfig, type Wave } from './wave';

export interface WakePoint {
  x: number;
  z: number;
  t: number;
  /** Heading (unit) of the board when the point was laid down. */
  hx: number;
  hz: number;
  speed: number;
}

const MAX = 56;
export const WAKE_LIFE = 3.2;
const SPACING = 0.45;
const KELVIN = Math.tan(THREE.MathUtils.degToRad(19.47));
const LIFT = 0.07;

const VERT = /* glsl */ `
attribute float aAlpha;
attribute vec2 aUv;
varying float vA;
varying vec2 vUv2;
void main() {
  vA = aAlpha;
  vUv2 = aUv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
}`;

const FRAG = /* glsl */ `
uniform vec3 color;
uniform float uTime;
varying float vA;
varying vec2 vUv2;
void main() {
  float edge = smoothstep( 0.0, 0.7, 1.0 - abs( vUv2.x * 2.0 - 1.0 ) );
  float n = 0.72 + 0.28 * sin( vUv2.y * 2.3 + vUv2.x * 9.0 + uTime * 3.0 ) * sin( vUv2.y * 0.7 - uTime * 1.7 );
  gl_FragColor = vec4( color, vA * edge * n );
}`;

/** A fading two-sided strip built from a polyline of (left, right) pairs. */
class Ribbon {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  private pos = new Float32Array(MAX * 2 * 3);
  private alpha = new Float32Array(MAX * 2);
  private uv = new Float32Array(MAX * 2 * 2);
  private geometry = new THREE.BufferGeometry();

  constructor(opacity: number) {
    const idx: number[] = [];
    for (let i = 0; i < MAX - 1; i++) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
    this.geometry.setIndex(idx);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));
    this.geometry.setAttribute('aUv', new THREE.BufferAttribute(this.uv, 2));
    this.material = new THREE.ShaderMaterial({
      uniforms: { color: { value: new THREE.Color(0xffffff) }, uTime: { value: 0 } },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
      side: THREE.DoubleSide,
    });
    this.material.uniforms.color.value.multiplyScalar(opacity);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  set(i: number, l: THREE.Vector3, r: THREE.Vector3, a: number): void {
    const k = i * 6;
    this.pos[k] = l.x;
    this.pos[k + 1] = l.y;
    this.pos[k + 2] = l.z;
    this.pos[k + 3] = r.x;
    this.pos[k + 4] = r.y;
    this.pos[k + 5] = r.z;
    this.alpha[i * 2] = a;
    this.alpha[i * 2 + 1] = a;
    this.uv[i * 4] = 0;
    this.uv[i * 4 + 1] = i;
    this.uv[i * 4 + 2] = 1;
    this.uv[i * 4 + 3] = i;
  }

  finish(count: number, t: number): void {
    this.geometry.setDrawRange(0, Math.max(0, count - 1) * 6);
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.aAlpha.needsUpdate = true;
    this.geometry.attributes.aUv.needsUpdate = true;
    this.material.uniforms.uTime.value = t;
    this.mesh.visible = count > 1;
  }
}

const _l = new THREE.Vector3();
const _r = new THREE.Vector3();

/** Foam trail plus the two diverging Kelvin-wake arms behind a moving board. */
export class Wake {
  readonly group = new THREE.Group();
  readonly points: WakePoint[] = [];
  private foam = new Ribbon(1);
  private arms: [Ribbon, Ribbon] = [new Ribbon(0.9), new Ribbon(0.9)];
  private lastX = Number.NaN;
  private lastZ = Number.NaN;
  private colorFoam = new THREE.Color();

  constructor() {
    this.group.add(this.foam.mesh, this.arms[0].mesh, this.arms[1].mesh);
  }

  setPalette(p: WaterPalette): void {
    this.colorFoam.set(p.foam);
    this.foam.material.uniforms.color.value.copy(this.colorFoam);
    const crest = this.colorFoam.clone().lerp(new THREE.Color(p.sky), 0.25);
    for (const a of this.arms) a.material.uniforms.color.value.copy(crest);
  }

  clear(): void {
    this.points.length = 0;
    this.lastX = Number.NaN;
    this.lastZ = Number.NaN;
  }

  update(t: number, x: number, z: number, heading: number, speed: number, waves: Wave[], spot: SpotConfig): void {
    const pts = this.points;
    while (pts.length && t - pts[0].t > WAKE_LIFE) pts.shift();

    if (speed > 0.6) {
      const hx = Math.sin(heading);
      const hz = Math.cos(heading);
      const moved = Number.isNaN(this.lastX) ? Infinity : Math.hypot(x - this.lastX, z - this.lastZ);
      if (moved > SPACING) {
        if (moved > 4 * SPACING) pts.length = 0;
        pts.push({ x: x - hx * 1.2, z: z - hz * 1.2, t, hx, hz, speed });
        if (pts.length > MAX) pts.shift();
        this.lastX = x;
        this.lastZ = z;
      }
    }

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const age = t - p.t;
      const f = Math.max(0, 1 - age / WAKE_LIFE);
      const px = -p.hz;
      const pz = p.hx;
      const strength = Math.min(1, p.speed / 2.5);

      const half = 0.32 + age * 0.45;
      this.setPair(this.foam, i, p.x, p.z, px, pz, half, 0, f * f * strength * 1.1, t, waves, spot);

      const lateral = 0.5 + age * p.speed * KELVIN;
      const w = 0.2 + age * 0.12;
      const a = f * strength * 0.7;
      this.setPair(this.arms[0], i, p.x, p.z, px, pz, w, lateral, a, t, waves, spot);
      this.setPair(this.arms[1], i, p.x, p.z, px, pz, w, -lateral, a, t, waves, spot);
    }
    this.foam.finish(pts.length, t);
    this.arms[0].finish(pts.length, t);
    this.arms[1].finish(pts.length, t);
  }

  private setPair(
    rib: Ribbon, i: number, x: number, z: number, px: number, pz: number,
    half: number, offset: number, a: number, t: number, waves: Wave[], spot: SpotConfig,
  ): void {
    const cx = x + px * offset;
    const cz = z + pz * offset;
    _l.set(cx - px * half, 0, cz - pz * half);
    _r.set(cx + px * half, 0, cz + pz * half);
    _l.y = seaHeightAt(waves, _l.x, _l.z, t, spot) + LIFT;
    _r.y = seaHeightAt(waves, _r.x, _r.z, t, spot) + LIFT;
    rib.set(i, _l, _r, a);
  }
}
