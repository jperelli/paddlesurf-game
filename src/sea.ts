import * as THREE from 'three';
import { BEACH_Z, brokenAmount, crestZ, seaHeightAt, type SpotConfig, type Wave } from './wave';
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
      roughness: 0.3,
      metalness: 0.05,
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
    (this.beach.material as THREE.MeshStandardMaterial).color.set(p.sand);
  }

  update(waves: Wave[], t: number, spot: SpotConfig): void {
    const pos = this.positions;
    const col = this.colors;
    const nx = this.nx;
    const nz = this.nz;
    for (let j = 0; j < nz; j++) {
      const z = Z_MIN + j * STEP;
      for (let i = 0; i < nx; i++) {
        const x = X_MIN + i * STEP;
        const k = (j * nx + i) * 3;
        const h = seaHeightAt(waves, x, z, t, spot);
        pos[k + 1] = h;

        // Colour: deep -> face as the water rises, foam where the wave is broken near the crest.
        let foamAmt = 0;
        let rise = 0;
        for (const w of waves) {
          const cz = crestZ(w, t);
          const d = z - cz;
          if (d > 3 * w.length || d < -3 * w.length) continue;
          const near = Math.exp(-(d * d) / (w.length * w.length * (d > 0 ? 0.6 : 1.4)));
          rise = Math.max(rise, near * Math.min(1, w.height / 1.4));
          if (w.fronts.length > 0 || cz > 30) {
            const b = brokenAmount(w, x, t, spot);
            if (b > 0) {
              const front = d > -0.4 * w.length && d < 1.6 * w.length ? 1 : Math.exp(-((d - 0.6 * w.length) ** 2) / (w.length * w.length * 2));
              foamAmt = Math.max(foamAmt, b * front);
            }
          }
        }
        const shoreFoam = z > 42 ? Math.min(0.6, (z - 42) / 25) * (0.6 + 0.4 * Math.sin(x * 0.7 + t * 2 + z)) : 0;
        foamAmt = Math.max(foamAmt, shoreFoam);
        const c = this.tmp.copy(this.deep).lerp(this.face, Math.min(1, rise * 1.3 + Math.max(0, h) * 0.25));
        if (foamAmt > 0) c.lerp(this.foam, Math.min(1, foamAmt));
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
