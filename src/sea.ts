import * as THREE from 'three';
import { BEACH_Z, brokenAmount, chopAt, crestZ, localHeight, profile, steepness, type SpotConfig, type Wave } from './wave';
import type { WaterPalette } from './palette';

const X_MIN = -90;
const X_MAX = 90;
const Z_MIN = -100;
const Z_MAX = BEACH_Z + 10;
const STEP = 1;

export class Sea {
  readonly mesh: THREE.Mesh;
  readonly beach: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private nx: number;
  private nz: number;
  private deep = new THREE.Color();
  private face = new THREE.Color();
  private foam = new THREE.Color();
  private lip = new THREE.Color();
  private shadow = new THREE.Color();
  private tmp = new THREE.Color();

  constructor(palette: WaterPalette) {
    this.nx = Math.round((X_MAX - X_MIN) / STEP) + 1;
    this.nz = Math.round((Z_MAX - Z_MIN) / STEP) + 1;
    const n = this.nx * this.nz;
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    const indices: number[] = [];
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        this.positions[k * 3] = X_MIN + i * STEP;
        this.positions[k * 3 + 1] = 0;
        this.positions[k * 3 + 2] = Z_MIN + j * STEP;
        if (i < this.nx - 1 && j < this.nz - 1) {
          const a = k;
          const b = k + 1;
          const c = k + this.nx;
          const d = k + this.nx + 1;
          indices.push(a, c, b, b, c, d);
        }
      }
    }
    this.geometry = new THREE.BufferGeometry();
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.22,
      metalness: 0.08,
      flatShading: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;

    const beachGeo = new THREE.PlaneGeometry(X_MAX - X_MIN + 40, 80, 1, 1);
    beachGeo.rotateX(-Math.PI / 2);
    const beachMat = new THREE.MeshStandardMaterial({ color: palette.sand, roughness: 1 });
    this.beach = new THREE.Mesh(beachGeo, beachMat);
    this.beach.position.set(0, -0.15, BEACH_Z + 38);
    this.beach.rotation.x = 0.03;
    this.setPalette(palette);
  }

  setPalette(p: WaterPalette): void {
    this.deep.set(p.deep);
    this.face.set(p.face);
    this.foam.set(p.foam);
    this.lip.copy(this.face).lerp(new THREE.Color(p.sky), 0.6);
    this.shadow.copy(this.foam).lerp(this.deep, 0.45);
    (this.beach.material as THREE.MeshStandardMaterial).color.set(p.sand);
  }

  update(waves: Wave[], t: number, spot: SpotConfig): void {
    const pos = this.positions;
    const col = this.colors;
    const nx = this.nx;
    const nz = this.nz;
    const czs = waves.map((w) => crestZ(w, t));
    const active: number[] = [];
    const ds: number[] = new Array(waves.length).fill(0);
    for (let j = 0; j < nz; j++) {
      const z = Z_MIN + j * STEP;
      active.length = 0;
      for (let wi = 0; wi < waves.length; wi++) {
        const d = z - czs[wi];
        const L = waves[wi].length;
        if (d > 3.5 * L || d < -5 * L) continue;
        ds[wi] = d;
        active.push(wi);
      }
      const shoreFoam = z > 42 ? Math.min(0.6, (z - 42) / 25) : 0;
      for (let i = 0; i < nx; i++) {
        const x = X_MIN + i * STEP;
        const k = (j * nx + i) * 3;
        let h = chopAt(x, z, t);
        let zz = z;
        // Colour: deep -> face as the water rises, a bright backlit lip on hollow faces,
        // foam where the wave is broken, a grey-blue shadow on the tumbling front of the whitewater.
        let foamAmt = shoreFoam > 0 ? shoreFoam * (0.6 + 0.4 * Math.sin(x * 0.7 + t * 2 + z)) : 0;
        let rise = 0;
        let lipAmt = 0;
        let shade = 0;
        for (const wi of active) {
          const w = waves[wi];
          const d = ds[wi];
          const L = w.length;
          const hw = localHeight(w, x, t);
          const b = brokenAmount(w, x, t, spot);
          const st = steepness(w, x, t, spot);
          const steep = st * (1 - b);
          const amp = hw * (1 - 0.35 * b);
          const f = profile(d, L, steep, b);
          h += amp * f + (b > 0 ? b * 0.12 * amp * Math.sin(2.7 * x + 6 * t) * Math.cos(1.9 * d - 4 * t) : 0);
          zz += (0.7 * steep * amp + 0.9 * b * amp) * f * f;

          if (d > 3 * L || d < -3 * L) continue;
          const near = Math.exp(-(d * d) / (L * L * (d > 0 ? 0.6 : 1.4)));
          rise = Math.max(rise, near * Math.min(1, w.height / 1.4));
          const hollow = Math.max(0, (st - 0.4) / 0.6);
          if (hollow > 0 && d > -0.2 * L && d < 0.9 * L) {
            lipAmt = Math.max(lipAmt, hollow * Math.exp(-((d - 0.25 * L) ** 2) / (0.08 * L * L)));
          }
          if (b > 0) {
            let front: number;
            if (d >= -0.3 * L && d <= 1.3 * L) front = 1;
            else if (d > 1.3 * L) front = Math.exp(-((d - 1.3 * L) ** 2) / (0.08 * L * L));
            else {
              const back = (d + 0.3 * L) / (2.0 * L);
              front = 0.55 * Math.exp(-back * back) * (0.7 + 0.3 * Math.sin(1.3 * x + 0.9 * d + 2 * t));
            }
            foamAmt = Math.max(foamAmt, b * front);
            if (d > 0.4 * L && d < 2.2 * L) shade = Math.max(shade, b * 0.55 * Math.min(1, (d - 0.4 * L) / (0.9 * L)));
          }
        }
        pos[k + 1] = h;
        pos[k + 2] = zz;
        const c = this.tmp.copy(this.deep).lerp(this.face, Math.min(1, rise * 1.3 + Math.max(0, h) * 0.25));
        if (lipAmt > 0) c.lerp(this.lip, Math.min(1, lipAmt * 0.7));
        if (foamAmt > 0) c.lerp(this.foam, Math.min(1, foamAmt));
        if (shade > 0) c.lerp(this.shadow, shade);
        col[k] = c.r;
        col[k + 1] = c.g;
        col[k + 2] = c.b;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
