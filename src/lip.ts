import * as THREE from 'three';
import {
  BREAK_Z,
  CURL_WIDTH,
  FADE_Z,
  brokenAmount,
  brokenHalfWidth,
  crestZ,
  localHeight,
  seaPointAt,
  steepness,
  type SeaPoint,
  type SpotConfig,
  type Wave,
} from './wave';
import type { WaterPalette } from './palette';

const NX = 28; // segments along the crest
const NV = 10; // segments along the curl
const STRIP_LEN = CURL_WIDTH + 6;
const POOL = 4;
const SPRAY_N = 700;

interface Strip {
  mesh: THREE.Mesh;
  pos: Float32Array;
  col: Float32Array;
}

function makeStrip(material: THREE.Material): Strip {
  const n = (NX + 1) * (NV + 1);
  const pos = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  const idx: number[] = [];
  for (let j = 0; j < NV; j++) {
    for (let i = 0; i < NX; i++) {
      const a = j * (NX + 1) + i;
      const b = a + 1;
      const c = a + NX + 1;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setIndex(idx);
  const mesh = new THREE.Mesh(geo, material);
  mesh.frustumCulled = false;
  mesh.visible = false;
  return { mesh, pos, col };
}

function sprayTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The pitching lip: a curling sheet of water thrown from the crest into the trough next to the
 * whitewater (the pocket), feathering out onto the shoulder, plus spray where it lands.
 */
export class Lips {
  readonly group = new THREE.Group();
  private strips: Strip[] = [];
  private material: THREE.MeshStandardMaterial;
  private lipColor = new THREE.Color();
  private foamColor = new THREE.Color();
  private tmp = new THREE.Color();
  private pt: SeaPoint = { y: 0, z: 0 };

  private spray: THREE.Points;
  private sprayPos = new Float32Array(SPRAY_N * 3);
  private sprayVel = new Float32Array(SPRAY_N * 3);
  private sprayLife = new Float32Array(SPRAY_N);
  private sprayNext = 0;

  constructor(palette: WaterPalette) {
    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
      roughness: 0.35,
      metalness: 0.05,
      transparent: true,
      opacity: 0.96,
    });
    for (let i = 0; i < POOL; i++) {
      const s = makeStrip(this.material);
      this.strips.push(s);
      this.group.add(s.mesh);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.sprayPos, 3));
    const mat = new THREE.PointsMaterial({
      map: sprayTexture(),
      size: 1.4,
      transparent: true,
      depthWrite: false,
      opacity: 0.8,
      color: '#ffffff',
    });
    this.spray = new THREE.Points(geo, mat);
    this.spray.frustumCulled = false;
    for (let i = 0; i < SPRAY_N; i++) this.sprayPos[i * 3 + 1] = -50;
    this.group.add(this.spray);
    this.setPalette(palette);
  }

  setPalette(p: WaterPalette): void {
    this.lipColor.set(p.face).lerp(new THREE.Color('#a9dcf7'), 0.42);
    this.foamColor.set(p.foam);
  }

  private emit(x: number, y: number, z: number, vz: number, power: number): void {
    const i = this.sprayNext;
    this.sprayNext = (i + 1) % SPRAY_N;
    this.sprayPos[i * 3] = x + (Math.random() - 0.5) * 1.2;
    this.sprayPos[i * 3 + 1] = y;
    this.sprayPos[i * 3 + 2] = z + (Math.random() - 0.5) * 0.8;
    this.sprayVel[i * 3] = (Math.random() - 0.5) * 1.5;
    this.sprayVel[i * 3 + 1] = (1.5 + 3.5 * Math.random()) * power;
    this.sprayVel[i * 3 + 2] = vz * 0.6 + Math.random() * 1.5;
    this.sprayLife[i] = 0.7 + 0.7 * Math.random();
  }

  update(waves: Wave[], t: number, spot: SpotConfig, dt: number): void {
    let used = 0;
    for (const w of waves) {
      if (!w.isSet || w.fronts.length === 0) continue;
      const cz = crestZ(w, t);
      if (cz > FADE_Z + 2) continue;
      const half = brokenHalfWidth(w, t, spot);
      for (const side of [1, -1] as const) {
        if (used >= POOL) break;
        const strip = this.strips[used++];
        this.fill(strip, w, side, half, cz, waves, t, spot, dt);
      }
    }
    for (let i = used; i < POOL; i++) this.strips[i].mesh.visible = false;

    // Spray physics.
    const pos = this.sprayPos;
    const vel = this.sprayVel;
    for (let i = 0; i < SPRAY_N; i++) {
      if (this.sprayLife[i] <= 0) continue;
      this.sprayLife[i] -= dt;
      vel[i * 3 + 1] -= 6 * dt;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (this.sprayLife[i] <= 0) pos[i * 3 + 1] = -50;
    }
    this.spray.geometry.attributes.position.needsUpdate = true;
  }

  private fill(
    strip: Strip,
    w: Wave,
    side: 1 | -1,
    half: number,
    cz: number,
    waves: Wave[],
    t: number,
    spot: SpotConfig,
    dt: number,
  ): void {
    const { pos, col } = strip;
    const x0 = w.peakX + side * (half - 1.5);
    const throwRamp = Math.min(1, Math.max(0, (cz - (BREAK_Z - 3)) / 7));
    let maxT = 0;
    const emitBudget = Math.min(6, Math.ceil(90 * dt));
    for (let i = 0; i <= NX; i++) {
      const s = i / NX;
      const x = x0 + side * s * STRIP_LEN;
      const dx = Math.abs(x - w.peakX) - half;
      const edge = dx < 0 ? Math.max(0, 1 + dx / 1.5) : dx < CURL_WIDTH ? 1 : Math.max(0, 1 - (dx - CURL_WIDTH) / 6);
      const amp = localHeight(w, x, t) * (1 - 0.35 * brokenAmount(w, x, t, spot));
      const T = steepness(w, x, t, spot) * edge * throwRamp;
      maxT = Math.max(maxT, T);
      const top = seaPointAt(waves, x, cz, t, spot, this.pt);
      const topY = top.y;
      const topZ = top.z;
      // Circle through the crest top, curling forward and down; the surfer rides inside it.
      const R = 0.9 * amp * T;
      const th0 = -0.35;
      const zc = topZ + R * Math.sin(-th0);
      const yc = topY - R * Math.cos(th0);
      const thEnd = 2.65;
      const ripple = 0.05 * amp * Math.sin(5 * x + 11 * t);
      for (let j = 0; j <= NV; j++) {
        const v = j / NV;
        const th = th0 + (thEnd - th0) * v;
        const k = (j * (NX + 1) + i) * 3;
        pos[k] = x + 0.12 * T * Math.sin(3 * x + 7 * t + 2 * v);
        pos[k + 1] = Math.max(0.05, yc + R * Math.cos(th) + ripple * v) + (j === 0 ? 0.03 : 0);
        pos[k + 2] = zc + R * Math.sin(th);
        const c = this.tmp.copy(this.lipColor).lerp(this.foamColor, Math.min(1, Math.max(0, (v - 0.4) / 0.45)));
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
      if (T > 0.45 && amp > 0.4 && i % 3 === 0 && i < emitBudget * 3) {
        this.emit(x, 0.2, zc + R * Math.sin(thEnd), w.speed, T * Math.min(1.3, amp));
      }
      if (dx < 0 && dx > -6 && i % 4 === 0) {
        this.emit(x, Math.max(0.3, amp * 0.7), topZ + amp, w.speed, 0.6 * Math.min(1.2, amp));
      }
    }
    strip.mesh.visible = maxT > 0.05;
    if (!strip.mesh.visible) return;
    const geo = strip.mesh.geometry;
    geo.attributes.position.needsUpdate = true;
    geo.attributes.color.needsUpdate = true;
    geo.computeVertexNormals();
  }
}
