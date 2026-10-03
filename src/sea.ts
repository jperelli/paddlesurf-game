import * as THREE from 'three';
import { BEACH_Z, brokenAmount, chopAt, crestSkew, crestZ, localHeight, profile, steepness, type SpotConfig, type Wave } from './wave';
import type { WaterPalette } from './palette';
import { WAKE_LIFE, type WakePoint } from './wake';
import { tileableFbm } from './noise';

const X_MIN = -90;
const X_MAX = 90;
const Z_MIN = -100;
const Z_MAX = BEACH_Z + 10;
const STEP = 1;
const UV_SCALE = 1 / 6;

/** Tileable greyscale bubble/streak pattern that breaks up the foam colour. */
function foamNoiseMap(size = 256): THREE.DataTexture {
  const a = tileableFbm(53, 4, 5);
  const b = tileableFbm(71, 12, 3);
  const data = new Uint8Array(size * size * 4);
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const n = 0.65 * a(u, v) + 0.35 * b(u, v);
      const k = (j * size + i) * 4;
      data[k] = data[k + 1] = data[k + 2] = Math.round(255 * Math.min(1, Math.max(0, n)));
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.needsUpdate = true;
  return tex;
}

/** Tileable ripple normal map from a noise heightfield plus a little directional chop, so it does not read as a lattice. */
function rippleNormalMap(size = 256): THREE.DataTexture {
  const fbm = tileableFbm(31, 3, 5);
  const fine = tileableFbm(97, 16, 3);
  const h = (u: number, v: number): number =>
    1.6 * fbm(u, v) + 0.5 * fine(u, v) + 0.08 * Math.sin(2 * Math.PI * (5 * u + 2 * v)) + 0.05 * Math.sin(2 * Math.PI * (-3 * u + 7 * v));
  const data = new Uint8Array(size * size * 4);
  const e = 1 / size;
  const strength = 0.07;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const u = i / size;
      const v = j / size;
      const dx = (h(u + e, v) - h(u - e, v)) / (2 * e);
      const dy = (h(u, v + e) - h(u, v - e)) / (2 * e);
      const n = new THREE.Vector3(-dx * strength, -dy * strength, 1).normalize();
      const k = (j * size + i) * 4;
      data[k] = (n.x * 0.5 + 0.5) * 255;
      data[k + 1] = (n.y * 0.5 + 0.5) * 255;
      data[k + 2] = (n.z * 0.5 + 0.5) * 255;
      data[k + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

// Three scrolling layers of the ripple map at different scales, faded with distance and under foam.
const RIPPLE_NORMALS = /* glsl */ `
	vec2 uvA = vNormalMapUv + vec2( 0.021, 0.034 ) * uTime;
	vec2 uvB = vNormalMapUv * 2.3 + vec2( -0.047, 0.013 ) * uTime;
	vec2 uvC = vNormalMapUv * 0.41 + vec2( 0.009, -0.016 ) * uTime;
	vec3 nA = texture2D( normalMap, uvA ).xyz * 2.0 - 1.0;
	vec3 nB = texture2D( normalMap, uvB ).xyz * 2.0 - 1.0;
	vec3 nC = texture2D( normalMap, uvC ).xyz * 2.0 - 1.0;
	vec3 mapN = normalize( vec3( 0.7 * nA.xy + 0.45 * nB.xy + 0.9 * nC.xy, nA.z * nB.z * nC.z ) );
	float rippleFade = clamp( 1.0 - length( vViewPosition ) / 110.0, 0.08, 1.0 ) * ( 1.0 - 0.8 * vFoam );
	mapN.xy *= rippleFade;`;

export class Sea {
  readonly mesh: THREE.Mesh;
  readonly beach: THREE.Mesh;
  /** Flat water out to the horizon beyond the simulated grid, fogged into the sky. */
  readonly far: THREE.Mesh;
  private geometry: THREE.BufferGeometry;
  private positions: Float32Array;
  private colors: Float32Array;
  private foamAttr: Float32Array;
  private timeUniform = { value: 0 };
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
    this.foamAttr = new Float32Array(n);
    const uvs = new Float32Array(n * 2);
    const indices: number[] = [];
    for (let j = 0; j < this.nz; j++) {
      for (let i = 0; i < this.nx; i++) {
        const k = j * this.nx + i;
        this.positions[k * 3] = X_MIN + i * STEP;
        this.positions[k * 3 + 1] = 0;
        this.positions[k * 3 + 2] = Z_MIN + j * STEP;
        uvs[k * 2] = (X_MIN + i * STEP) * UV_SCALE;
        uvs[k * 2 + 1] = (Z_MIN + j * STEP) * UV_SCALE;
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
    this.geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    this.geometry.setAttribute('foam', new THREE.BufferAttribute(this.foamAttr, 1));
    this.geometry.setIndex(indices);
    const material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: 0.34,
      metalness: 0,
      envMapIntensity: 0.7,
      normalMap: rippleNormalMap(),
      normalScale: new THREE.Vector2(0.3, 0.3),
    });
    material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.timeUniform;
      shader.uniforms.foamMap = { value: foamNoiseMap() };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float foam;\nvarying float vFoam;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFoam = foam;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uTime;\nuniform sampler2D foamMap;\nvarying float vFoam;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
	float fpA = texture2D( foamMap, vNormalMapUv * 1.9 + uTime * vec2( 0.012, 0.02 ) ).r;
	float fpB = texture2D( foamMap, vNormalMapUv * 6.1 - uTime * vec2( 0.03, 0.017 ) ).r;
	float foamPat = smoothstep( 0.3, 0.75, 0.6 * fpA + 0.4 * fpB );
	float thin = vFoam * ( 0.35 + 0.65 * ( 1.0 - vFoam ) );
	diffuseColor.rgb *= mix( 1.0, 0.62 + 0.38 * foamPat, thin );`,
        )
        .replace('vec3 mapN = texture2D( normalMap, vNormalMapUv ).xyz * 2.0 - 1.0;', RIPPLE_NORMALS)
        .replace('float roughnessFactor = roughness;', 'float roughnessFactor = mix( roughness, 0.95, vFoam );');
    };
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.receiveShadow = true;

    const beachGeo = new THREE.PlaneGeometry(X_MAX - X_MIN + 40, 80, 1, 1);
    beachGeo.rotateX(-Math.PI / 2);
    const beachMat = new THREE.MeshStandardMaterial({ color: palette.sand, roughness: 1 });
    this.beach = new THREE.Mesh(beachGeo, beachMat);
    this.beach.position.set(0, -0.15, BEACH_Z + 38);
    this.beach.rotation.x = 0.03;
    const farGeo = new THREE.PlaneGeometry(3000, 1200, 1, 1);
    farGeo.rotateX(-Math.PI / 2);
    this.far = new THREE.Mesh(farGeo, new THREE.MeshStandardMaterial({ color: palette.deep, roughness: 0.3 }));
    this.far.position.set(0, -0.3, Z_MIN - 598);
    this.setPalette(palette);
  }

  setPalette(p: WaterPalette): void {
    this.deep.set(p.deep);
    this.face.set(p.face);
    this.foam.set(p.foam);
    this.lip.copy(this.face).lerp(new THREE.Color(p.sky), 0.6);
    this.shadow.copy(this.foam).lerp(this.deep, 0.45);
    (this.beach.material as THREE.MeshStandardMaterial).color.set(p.sand);
    (this.far.material as THREE.MeshStandardMaterial).color.set(p.deep);
  }

  update(waves: Wave[], t: number, spot: SpotConfig, wake: WakePoint[] = []): void {
    this.timeUniform.value = t;
    const pos = this.positions;
    const col = this.colors;
    const foamA = this.foamAttr;
    let wx0 = Infinity;
    let wx1 = -Infinity;
    let wz0 = Infinity;
    let wz1 = -Infinity;
    for (const p of wake) {
      wx0 = Math.min(wx0, p.x - 3);
      wx1 = Math.max(wx1, p.x + 3);
      wz0 = Math.min(wz0, p.z - 3);
      wz1 = Math.max(wz1, p.z + 3);
    }
    const nx = this.nx;
    const nz = this.nz;
    const czs = waves.map((w) => crestZ(w, t));
    const tans = waves.map((w) => Math.tan(w.angle));
    const skews = waves.map((w) => crestSkew(w, X_MAX));
    const active: number[] = [];
    for (let j = 0; j < nz; j++) {
      const z = Z_MIN + j * STEP;
      active.length = 0;
      for (let wi = 0; wi < waves.length; wi++) {
        const d = z - czs[wi];
        const L = waves[wi].length;
        if (d > 3.5 * L + skews[wi] || d < -5 * L - skews[wi]) continue;
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
          const L = w.length;
          const d = z - czs[wi] - tans[wi] * (x - w.peakX);
          if (d > 3.5 * L || d < -5 * L) continue;
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
            const fe = L * (1.3 + 0.35 * Math.sin(1.7 * x + 3 * t) + 0.2 * Math.sin(4.3 * x - 2.2 * t));
            const fb = -L * (0.3 + 0.18 * Math.sin(2.1 * x + 1.3 * t) + 0.1 * Math.sin(5.3 * x - 2 * t));
            if (d >= fb && d <= fe) front = 1;
            else if (d > fe) front = Math.exp(-((d - fe) ** 2) / (0.1 * L * L));
            else {
              // Trailing foam behind the whitewater: thins out and breaks into patches.
              const back = (fb - d) / (1.4 * L);
              const patch = 0.5 + 0.5 * Math.sin(1.3 * x + 0.9 * d + 2 * t) * Math.sin(0.6 * x - 1.1 * d + 0.7 * t);
              front = Math.exp(-back * back) * (1 - 0.45 * Math.min(1, back * 3) * patch);
            }
            foamAmt = Math.max(foamAmt, b * front);
            if (d > 0.4 * L && d < 2.2 * L) shade = Math.max(shade, b * 0.55 * Math.min(1, (d - 0.4 * L) / (0.9 * L)));
          }
        }
        // Small ripples and a foam smear along the board's wake.
        if (x >= wx0 && x <= wx1 && z >= wz0 && z <= wz1) {
          for (const p of wake) {
            const dx = x - p.x;
            const dz = z - p.z;
            const d2 = dx * dx + dz * dz;
            if (d2 > 9) continue;
            const age = t - p.t;
            const life = Math.max(0, 1 - age / WAKE_LIFE);
            const s = life * Math.min(1, p.speed / 2.5);
            const d = Math.sqrt(d2);
            h += 0.045 * s * Math.exp(-d2 / 2.2) * Math.cos(3.2 * d - 5 * age);
            foamAmt = Math.max(foamAmt, 0.8 * s * Math.exp(-d2 / 1.1));
          }
        }
        pos[k + 1] = h;
        pos[k + 2] = zz;
        foamA[k / 3] = Math.min(1, foamAmt);
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
    this.geometry.attributes.foam.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }
}
