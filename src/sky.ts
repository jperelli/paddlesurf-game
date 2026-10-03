import * as THREE from 'three';
import type { WaterPalette } from './palette';
import { tileableFbm } from './noise';

// Afternoon sun off to the right and a little in front, so its glitter path runs across the lineup.
const SUN_ELEVATION = 32;
const SUN_AZIMUTH = 140;

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Gradient dome: hazy horizon, deeper zenith, a sun disc with a soft glow, slightly darker below the horizon.
const SKY_FRAG = /* glsl */ `
uniform vec3 uZenith;
uniform vec3 uHorizon;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform float uHaze;
varying vec3 vDir;
void main() {
  vec3 d = normalize( vDir );
  float h = clamp( d.y, 0.0, 1.0 );
  float grad = pow( h, 0.38 + 0.25 * uHaze );
  vec3 col = mix( uHorizon, uZenith, grad );
  float s = max( dot( d, uSunDir ), 0.0 );
  col += uSunColor * ( pow( s, 1500.0 ) * 6.0 + pow( s, 24.0 ) * 0.22 + pow( s, 3.0 ) * 0.07 * ( 1.0 - grad ) );
  col = mix( col, uHorizon * 0.8, smoothstep( 0.0, -0.04, d.y ) );
  gl_FragColor = vec4( col, 1.0 );
  #include <colorspace_fragment>
}`;

const CLOUD_VERT = /* glsl */ `
varying vec3 vDir;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4( position, 1.0 );
  vDir = wp.xyz - cameraPosition;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

// Two drifting layers of the noise texture; clouds thin out and take the haze colour towards the horizon.
const CLOUD_FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform vec3 uShade;
uniform vec3 uHorizon;
uniform float uOpacity;
uniform float uTime;
varying vec3 vDir;
varying vec2 vUv;
void main() {
  vec3 d = normalize( vDir );
  float up = clamp( d.y, 0.0, 1.0 );
  vec4 a = texture2D( uMap, vUv * 3.0 + vec2( uTime * 0.0030, uTime * 0.0012 ) );
  vec4 b = texture2D( uMap, vUv * 7.0 + vec2( 0.37, 0.61 ) + vec2( -uTime * 0.0045, uTime * 0.0021 ) );
  float dens = clamp( a.a * 1.4 + b.a * 0.5 - 0.2, 0.0, 1.0 );
  float lit = a.r;
  vec3 col = mix( uShade, uColor, lit );
  float horizonMix = 1.0 - smoothstep( 0.0, 0.3, up );
  col = mix( col, uHorizon, horizonMix * 0.85 );
  float alpha = dens * uOpacity * smoothstep( 0.0, 0.1, up );
  gl_FragColor = vec4( col, alpha );
  #include <colorspace_fragment>
}`;

/** Cloud texture: alpha = density, red = lit amount (bright edges, grey bases). */
function cloudTexture(size = 512): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(size, size);
  const fbm = tileableFbm(7, 2, 6);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dens = THREE.MathUtils.smoothstep(fbm(x / size, y / size), 0.5, 0.66);
      const k = (y * size + x) * 4;
      img.data[k] = Math.round(255 * (1 - 0.8 * dens * dens));
      img.data[k + 1] = img.data[k + 2] = 0;
      img.data[k + 3] = Math.round(255 * dens);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

/** Gradient sky dome with sun and drifting clouds, also baked into the scene environment for reflections. */
export class SkyDome {
  readonly dome: THREE.Mesh;
  readonly clouds: THREE.Mesh;
  readonly sunDir = new THREE.Vector3();
  readonly horizon = new THREE.Color();
  private skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator;
  private envScene = new THREE.Scene();
  private envTarget: THREE.WebGLRenderTarget | null = null;

  constructor(renderer: THREE.WebGLRenderer) {
    this.pmrem = new THREE.PMREMGenerator(renderer);
    const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
    const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
    this.sunDir.setFromSphericalCoords(1, phi, theta);

    this.skyMat = new THREE.ShaderMaterial({
      uniforms: {
        uZenith: { value: new THREE.Color() },
        uHorizon: { value: new THREE.Color() },
        uSunColor: { value: new THREE.Color(0xfff1d6) },
        uSunDir: { value: this.sunDir },
        uHaze: { value: 0.5 },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      toneMapped: false,
    });
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(320, 32, 16), this.skyMat);
    this.dome.renderOrder = -2;

    this.cloudMat = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: cloudTexture() },
        uColor: { value: new THREE.Color(0xffffff) },
        uShade: { value: new THREE.Color(0x9aa3ad) },
        uHorizon: { value: this.horizon },
        uOpacity: { value: 0.8 },
        uTime: { value: 0 },
      },
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    });
    const cloudGeo = new THREE.PlaneGeometry(3000, 3000, 1, 1);
    cloudGeo.rotateX(Math.PI / 2);
    this.clouds = new THREE.Mesh(cloudGeo, this.cloudMat);
    this.clouds.position.set(0, 150, -300);
    this.clouds.renderOrder = -1;
  }

  update(t: number): void {
    this.cloudMat.uniforms.uTime.value = t;
  }

  apply(p: WaterPalette, scene: THREE.Scene, sun: THREE.DirectionalLight): void {
    const c = new THREE.Color(p.sky);
    const hsl = { h: 0, s: 0, l: 0 };
    c.getHSL(hsl);
    // Greyer reference skies read as hazier air: paler horizon, flatter gradient, more cloud.
    const haze = 1 - hsl.s;
    this.horizon.copy(c).lerp(new THREE.Color(0xf4f6f7), 0.45 + 0.3 * haze);
    const u = this.skyMat.uniforms;
    (u.uZenith.value as THREE.Color).copy(c).lerp(new THREE.Color(0x2f62a8), 0.45 - 0.25 * haze);
    (u.uHorizon.value as THREE.Color).copy(this.horizon);
    u.uHaze.value = haze;
    this.cloudMat.uniforms.uOpacity.value = 0.55 + 0.4 * haze;
    (this.cloudMat.uniforms.uShade.value as THREE.Color).set(0x9aa3ad).lerp(c, 0.3);

    sun.position.copy(this.sunDir).multiplyScalar(200);
    sun.color.set(0xffffff).lerp(new THREE.Color(0xffd9a8), 0.4);

    this.envScene.add(this.dome);
    this.envTarget?.dispose();
    this.envTarget = this.pmrem.fromScene(this.envScene);
    scene.add(this.dome, this.clouds);
    scene.environment = this.envTarget.texture;
    scene.background = null;
    scene.fog = new THREE.Fog(this.horizon, 50, 150);
  }
}
