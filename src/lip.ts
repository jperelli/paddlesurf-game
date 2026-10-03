import * as THREE from 'three';
import {
  CURL_WIDTH,
  brokenAmount,
  brokenHalfWidth,
  crestZ,
  crestZAt,
  localHeight,
  seaPointAt,
  steepness,
  type SeaPoint,
  type SpotConfig,
  type Wave,
} from './wave';
import type { WaterPalette } from './palette';
import type { Conditions } from './conditions';

const NX = 28; // segments along the crest
const NV = 10; // segments along the curl
const STRIP_LEN = CURL_WIDTH + 6;
const POOL = 4;
const SPRAY_N = 1600;
const MIST_N = 2600;
/** How many crest samples either side of the pocket shed wind spray. */
const WIND_STRIP = 14;

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
  // A droplet: solid core with a short falloff, not a soft blob.
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.42, 'rgba(255,255,255,0.95)');
  g.addColorStop(0.62, 'rgba(255,255,255,0.25)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Fixed-size particle pool rendered as sprites. */
class SprayPool {
  readonly points: THREE.Points;
  private pos: Float32Array;
  private vel: Float32Array;
  private life: Float32Array;
  private next = 0;
  private n: number;

  constructor(n: number, size: number, opacity: number) {
    this.n = n;
    this.pos = new Float32Array(n * 3);
    this.vel = new Float32Array(n * 3);
    this.life = new Float32Array(n);
    for (let i = 0; i < n; i++) this.pos[i * 3 + 1] = -50;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    // Droplets stay a few pixels on screen whatever their distance: close ones never balloon into blobs.
    const mat = new THREE.PointsMaterial({
      map: sprayTexture(),
      size,
      sizeAttenuation: false,
      transparent: true,
      depthWrite: false,
      opacity,
      color: '#ffffff',
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number): void {
    const i = this.next;
    this.next = (i + 1) % this.n;
    this.pos[i * 3] = x;
    this.pos[i * 3 + 1] = y;
    this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx;
    this.vel[i * 3 + 1] = vy;
    this.vel[i * 3 + 2] = vz;
    this.life[i] = life;
  }

  /** Droplets that flew into the camera during the last step. */
  hits = 0;

  /** Integrate: gravity plus air drag pulling the horizontal velocity toward the wind. */
  step(dt: number, gravity: number, wind: { x: number; z: number }, drag: number, cam: THREE.Vector3 | null = null): void {
    const { pos, vel, life } = this;
    const wk = Math.min(1, drag * dt);
    this.hits = 0;
    for (let i = 0; i < this.n; i++) {
      if (life[i] <= 0) continue;
      if (cam) {
        const dx = pos[i * 3] - cam.x;
        const dy = pos[i * 3 + 1] - cam.y;
        const dz = pos[i * 3 + 2] - cam.z;
        if (dx * dx + dy * dy + dz * dz < 2.2) {
          this.hits++;
          life[i] = 0;
          pos[i * 3 + 1] = -50;
          continue;
        }
      }
      life[i] -= dt;
      vel[i * 3 + 1] -= gravity * dt;
      vel[i * 3] += (wind.x - vel[i * 3]) * wk;
      vel[i * 3 + 2] += (wind.z - vel[i * 3 + 2]) * wk;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      if (life[i] <= 0) pos[i * 3 + 1] = -50;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
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

  /** Coarse spray where the lip lands. */
  private spray = new SprayPool(SPRAY_N, 3.4, 0.95);
  /** Fine spindrift torn off the crest by the wind. */
  private mist = new SprayPool(MIST_N, 2.2, 0.8);
  private wind = { x: 0, z: 0 };
  private windAcc = 0;

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
    this.group.add(this.spray.points, this.mist.points);
    this.setPalette(palette);
  }

  setPalette(p: WaterPalette): void {
    this.lipColor.set(p.face).lerp(new THREE.Color(p.sky), 0.5);
    this.foamColor.set(p.foam);
  }

  setConditions(c: Conditions): void {
    this.wind.x = c.windX;
    this.wind.z = c.windZ;
  }

  /** Spindrift: a plume torn off the crest of a wave that is standing up, carried by the wind. */
  private emitWind(x: number, y: number, z: number, power: number): void {
    const wx = this.wind.x;
    const wz = this.wind.z;
    this.mist.emit(
      x + (Math.random() - 0.5) * 1.6,
      y + Math.random() * 0.3,
      z,
      wx * (0.5 + 0.5 * Math.random()) + (Math.random() - 0.5),
      (2.4 + 3.2 * Math.random()) * power,
      wz * (0.5 + 0.5 * Math.random()) + (Math.random() - 0.5),
      1.2 + 1.0 * Math.random(),
    );
  }

  private emit(x: number, y: number, z: number, vz: number, power: number): void {
    this.spray.emit(
      x + (Math.random() - 0.5) * 1.2,
      y,
      z + (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 1.5,
      (1.5 + 3.5 * Math.random()) * power,
      vz * 0.6 + Math.random() * 1.5,
      0.7 + 0.7 * Math.random(),
    );
  }

  /** Spray droplets that hit the camera this frame (for the lens). */
  lensHits = 0;

  update(waves: Wave[], t: number, spot: SpotConfig, dt: number, cam: THREE.Vector3 | null = null): void {
    let used = 0;
    for (const w of waves) {
      if (!w.isSet || w.fronts.length === 0) continue;
      const cz = crestZ(w, t);
      if (cz > w.fadeZ + 2) continue;
      const half = brokenHalfWidth(w, t, spot);
      const sides: (1 | -1)[] = w.peel === 0 ? [1, -1] : [w.peel];
      for (const side of sides) {
        if (used >= POOL) break;
        const strip = this.strips[used++];
        this.fill(strip, w, side, half, cz, waves, t, spot, dt);
      }
    }
    for (let i = used; i < POOL; i++) this.strips[i].mesh.visible = false;

    // Wind spray off the crests that are standing up but not yet broken.
    const windSpeed = Math.hypot(this.wind.x, this.wind.z);
    if (windSpeed > 1) {
      this.windAcc += dt * 360 * Math.min(1, windSpeed / 5);
      for (const w of waves) {
        if (!w.isSet || this.windAcc < 1) continue;
        const half = brokenHalfWidth(w, t, spot);
        const sides: (1 | -1)[] = w.peel === 0 ? [1, -1] : [w.peel];
        for (const side of sides) {
          for (let i = 0; i < WIND_STRIP && this.windAcc >= 1; i++) {
            const x = w.peakX + side * (half + 1 + i * 1.7 + Math.random() * 1.7);
            const T = steepness(w, x, t, spot) * (1 - brokenAmount(w, x, t, spot));
            if (T < 0.35) continue;
            const amp = localHeight(w, x, t);
            if (amp < 0.5) continue;
            const czx = crestZAt(w, x, t);
            const top = seaPointAt(waves, x, czx, t, spot, this.pt);
            this.emitWind(x, top.y + 0.1, top.z, T * Math.min(1.2, amp) * Math.min(1, windSpeed / 4));
            this.windAcc -= 1;
          }
        }
      }
      this.windAcc = Math.min(this.windAcc, 12);
    }

    // Heavy spray falls fast and barely feels the wind; the fine mist is carried by it.
    this.spray.step(dt, 6, this.wind, 0.6, cam);
    this.mist.step(dt, 3.5, this.wind, 2.2, cam);
    this.lensHits = this.spray.hits + this.mist.hits;
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
    const tanA = Math.tan(w.angle);
    let maxT = 0;
    const emitBudget = Math.min(14, Math.ceil(220 * dt));
    for (let i = 0; i <= NX; i++) {
      const s = i / NX;
      const x = x0 + side * s * STRIP_LEN;
      const dx = Math.abs(x - w.peakX) - half;
      const edge = dx < 0 ? Math.max(0, 1 + dx / 1.5) : dx < CURL_WIDTH ? 1 : Math.max(0, 1 - (dx - CURL_WIDTH) / 6);
      const amp = localHeight(w, x, t) * (1 - 0.35 * brokenAmount(w, x, t, spot));
      const czx = cz + tanA * (x - w.peakX);
      const throwRamp = Math.min(1, Math.max(0, (czx - (w.breakZ - 3)) / 7));
      const T = steepness(w, x, t, spot) * edge * throwRamp;
      maxT = Math.max(maxT, T);
      const top = seaPointAt(waves, x, czx, t, spot, this.pt);
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
