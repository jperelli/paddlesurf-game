import * as THREE from 'three';
import { BOARDS, BODIES, DEFAULT_LOOK, FACES, PADDLES, paintFace, type BoardSpec, type Look, type PaddleSpec } from './looks';
import { mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import type { SurferPalette } from './palette';

export type Stance = -1 | 0 | 1;

// Board (metres). Local +z is the nose, +x is the right rail.
const RAIL = 0.05;
const BOARD_CORE = 0.03;
const BOARD_THICK = BOARD_CORE + 2 * RAIL;

// Body segment lengths (metres) for a ~1.78 m paddler, from Richer's 7.5-head average figure
// (head unit 0.237 m: femur 2 heads, lower leg 2 heads, shoulders 2 heads wide, hips ~1.3).
const THIGH = 0.46;
const SHIN = 0.43;
const TORSO = 0.57;
const UPPER_ARM = 0.33;
const FOREARM = 0.27;
const HIP_X = 0.1;
const SHOULDER_X = 0.19;
const SHAFT = 1.95;

const UP = new THREE.Vector3(0, 1, 0);

/** Position/orient a unit-height mesh so it spans from a to b. */
function span(mesh: THREE.Object3D, a: THREE.Vector3, b: THREE.Vector3): void {
  const dir = _v1.subVectors(b, a);
  const len = dir.length();
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.scale.y = Math.max(0.01, len);
  mesh.quaternion.setFromUnitVectors(UP, dir.normalize());
}

/** Two-bone IK: joint position for a limb from a to c with segment lengths l1, l2 bending toward hint. */
function joint(a: THREE.Vector3, c: THREE.Vector3, l1: number, l2: number, hint: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dir = _v2.subVectors(c, a);
  let d = dir.length();
  const max = l1 + l2 - 0.01;
  if (d > max) {
    dir.multiplyScalar(max / d);
    c.copy(a).add(dir);
    d = max;
  }
  dir.normalize();
  const along = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - along * along));
  const perp = _v3.copy(hint).addScaledVector(dir, -hint.dot(dir));
  if (perp.lengthSq() < 1e-6) perp.set(0, 0, 1);
  perp.normalize();
  return out.copy(a).addScaledVector(dir, along).addScaledVector(perp, h);
}

const _v1 = new THREE.Vector3();
const _v2 = new THREE.Vector3();
const _v3 = new THREE.Vector3();

function approach(cur: number, target: number, k: number): number {
  return cur + (target - cur) * k;
}

function wrapAngle(a: number): number {
  return ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI;
}

/**
 * Unit-height limb/torso volume from a radius profile: pairs of [y, r] with y in -0.5..0.5
 * (span() stretches it between two joints). Lathed so segments taper and bulge like a real
 * limb instead of reading as a pipe. scaleZ flattens the cross-section (torso, hands).
 */
function volume(profile: [number, number][], mat: THREE.Material, scaleZ = 1): THREE.Mesh {
  const pts = profile.map(([y, r]) => new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(pts, 18);
  if (scaleZ !== 1) {
    geo.scale(1, 1, scaleZ);
    geo.computeVertexNormals();
  }
  return new THREE.Mesh(geo, mat);
}

function paintPad(ctx: CanvasRenderingContext2D, W: number, H: number, y0: number, y1: number): void {
  ctx.fillStyle = 'rgba(210,210,200,0.9)';
  ctx.beginPath();
  ctx.roundRect(W * 0.14, H * y0, W * 0.72, H * (y1 - y0), W * 0.1);
  ctx.fill();
  ctx.strokeStyle = 'rgba(120,120,112,0.5)';
  ctx.lineWidth = W * 0.012;
  for (let i = 1; i < 8; i++) {
    const y = H * (y0 + ((y1 - y0) * i) / 8);
    ctx.beginPath();
    ctx.moveTo(W * 0.16, y);
    ctx.lineTo(W * 0.84, y);
    ctx.stroke();
  }
}

/** Deck designs: 0 the photo's board (orange nose, white stripes, yellow tail), 1 centre stripe, 2 colour blocks. */
export function paintDeck(ctx: CanvasRenderingContext2D, p: SurferPalette, design: number): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = p.board;
  ctx.fillRect(0, 0, W, H);
  if (design === 1) {
    ctx.fillStyle = p.boardNose;
    ctx.fillRect(W * 0.42, 0, W * 0.16, H);
    ctx.fillStyle = p.boardTail;
    ctx.fillRect(0, H * 0.84, W, H * 0.16);
    ctx.strokeStyle = 'rgba(255,255,255,0.6)';
    ctx.lineWidth = W * 0.015;
    ctx.strokeRect(W * 0.08, H * 0.05, W * 0.84, H * 0.9);
    paintPad(ctx, W, H, 0.38, 0.8);
    return;
  }
  if (design === 2) {
    ctx.fillStyle = p.boardNose;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H * 0.22);
    ctx.lineTo(0, H * 0.3);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = p.boardTail;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.78);
    ctx.lineTo(W, H * 0.7);
    ctx.lineTo(W, H);
    ctx.lineTo(0, H);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = W * 0.02;
    ctx.beginPath();
    ctx.moveTo(0, H * 0.32);
    ctx.lineTo(W, H * 0.24);
    ctx.moveTo(0, H * 0.76);
    ctx.lineTo(W, H * 0.68);
    ctx.stroke();
    paintPad(ctx, W, H, 0.4, 0.74);
    return;
  }

  const nose = ctx.createLinearGradient(0, 0, 0, H * 0.4);
  nose.addColorStop(0, p.boardNose);
  nose.addColorStop(0.55, p.boardNose);
  nose.addColorStop(1, p.board);
  ctx.fillStyle = nose;
  ctx.fillRect(0, 0, W, H * 0.4);

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = W * 0.045;
  for (let i = 0; i < 3; i++) {
    const y = H * (0.2 + i * 0.065);
    ctx.beginPath();
    ctx.moveTo(W * 0.1, y + W * 0.25);
    ctx.lineTo(W * 0.9, y - W * 0.25);
    ctx.stroke();
  }

  paintPad(ctx, W, H, 0.36, 0.76);

  const tail = ctx.createLinearGradient(0, H * 0.7, 0, H);
  tail.addColorStop(0, 'rgba(0,0,0,0)');
  tail.addColorStop(0.35, p.boardTail);
  tail.addColorStop(1, p.boardTail);
  ctx.fillStyle = tail;
  ctx.fillRect(0, H * 0.7, W, H * 0.3);
  ctx.fillStyle = p.board;
  ctx.beginPath();
  ctx.moveTo(W * 0.5, H * 0.72);
  ctx.lineTo(W * 0.68, H * 0.86);
  ctx.lineTo(W * 0.32, H * 0.86);
  ctx.closePath();
  ctx.fill();
}

/** Plan-shape outline (nose pointiness and tail shape from the spec); the bevel adds the rail back to full width. */
function boardOutline(b: BoardSpec): THREE.Shape {
  const w = b.halfW - RAIL;
  const N = b.nose;
  const T = b.tail;
  const p = b.pointy;
  const s = new THREE.Shape();
  const side = (sx: number) => {
    // from the widest tail point up to the nose tip
    s.bezierCurveTo(sx * w * (1.03 - 0.03 * p), N - (1.3 + 0.25 * p), sx * w * (0.62 - 0.34 * p), N - (0.02 + 0.5 * p), 0, N);
  };
  if (b.tailShape === 'squash') {
    s.moveTo(0, T);
    s.lineTo(w * 0.55, T);
    s.bezierCurveTo(w * 0.9, T + 0.04, w * 1.02, T + 0.45, w, T + 1.0);
    side(1);
    s.bezierCurveTo(-w * (0.62 - 0.34 * p), N - (0.02 + 0.5 * p), -w * (1.03 - 0.03 * p), N - (1.3 + 0.25 * p), -w, T + 1.0);
    s.bezierCurveTo(-w * 1.02, T + 0.45, -w * 0.9, T + 0.04, -w * 0.55, T);
    s.lineTo(0, T);
  } else if (b.tailShape === 'pin') {
    s.moveTo(0, T);
    s.bezierCurveTo(w * 0.25, T + 0.08, w * 0.98, T + 0.6, w, T + 1.1);
    side(1);
    s.bezierCurveTo(-w * (0.62 - 0.34 * p), N - (0.02 + 0.5 * p), -w * (1.03 - 0.03 * p), N - (1.3 + 0.25 * p), -w, T + 1.1);
    s.bezierCurveTo(-w * 0.98, T + 0.6, -w * 0.25, T + 0.08, 0, T);
  } else {
    s.moveTo(0, T);
    s.bezierCurveTo(w * 0.6, T, w * 1.02, T + 0.45, w, T + 1.0);
    side(1);
    s.bezierCurveTo(-w * (0.62 - 0.34 * p), N - (0.02 + 0.5 * p), -w * (1.03 - 0.03 * p), N - (1.3 + 0.25 * p), -w, T + 1.0);
    s.bezierCurveTo(-w * 1.02, T + 0.45, -w * 0.6, T, 0, T);
  }
  return s;
}

function boardGeometry(b: BoardSpec): THREE.BufferGeometry {
  let geo: THREE.BufferGeometry = new THREE.ExtrudeGeometry(boardOutline(b), {
    depth: BOARD_CORE,
    bevelEnabled: true,
    bevelSize: RAIL,
    bevelThickness: RAIL,
    bevelSegments: 6,
    curveSegments: 28,
  });
  geo.rotateX(Math.PI / 2);
  geo.translate(0, BOARD_CORE + RAIL, 0);
  geo = mergeVertices(geo, 1e-4);
  // Rocker: the nose and tail kick up a little.
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const z = pos.getZ(i);
    const nose = Math.max(0, (z - 0.4) / (b.nose - 0.4));
    const tail = Math.max(0, (-z - 0.7) / (-b.tail - 0.7));
    pos.setY(i, pos.getY(i) + b.rocker * (0.1 * nose * nose + 0.035 * tail * tail));
  }
  geo.computeVertexNormals();
  return geo;
}

/** Swept-back fin, built in (along-board, height) and turned to sit under the tail. */
function finGeometry(scale: number, x: number, z: number, toe: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-0.24, 0);
  s.lineTo(0.0, 0);
  s.bezierCurveTo(0.04, -0.1, 0.1, -0.18, 0.11, -0.25);
  s.bezierCurveTo(0.02, -0.21, -0.14, -0.12, -0.24, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.004, bevelSegments: 2, curveSegments: 12 });
  geo.scale(scale, scale, 1);
  geo.rotateY(Math.PI / 2 + toe);
  geo.translate(x - 0.01, 0.01, z);
  return geo;
}

function finGeometries(b: BoardSpec): THREE.BufferGeometry[] {
  const fins = [finGeometry(b.fins === 3 ? 0.85 : 1, 0, b.tail + 0.32, 0)];
  if (b.fins === 3) {
    fins.push(finGeometry(0.7, -b.halfW * 0.55, b.tail + 0.55, 0.08), finGeometry(0.7, b.halfW * 0.55, b.tail + 0.55, -0.08));
  }
  return fins;
}

/** Teardrop paddle blade in the paddle's local xy plane, +y running down the shaft. */
function bladeGeometry(pd: PaddleSpec): THREE.BufferGeometry {
  const L = pd.bladeLen;
  const k = pd.bladeW;
  const s = new THREE.Shape();
  s.moveTo(-0.025, 0);
  s.bezierCurveTo(-0.115 * k, 0.1, -0.12 * k, L * 0.65, -0.035 * k, L - 0.02);
  s.quadraticCurveTo(0, L + 0.01, 0.035 * k, L - 0.02);
  s.bezierCurveTo(0.12 * k, L * 0.65, 0.115 * k, 0.1, 0.025, 0);
  const geo = new THREE.ExtrudeGeometry(s, { depth: 0.008, bevelEnabled: true, bevelSize: 0.005, bevelThickness: 0.005, bevelSegments: 2, curveSegments: 14 });
  geo.translate(0, 0, -0.009);
  return geo;
}

/** The paddler from the photo: black full wetsuit, red SUP with orange nose and yellow tail, dark paddle. */
export class SurferRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private board = new THREE.Group();
  private deckCanvas = document.createElement('canvas');
  private deckTex: THREE.CanvasTexture;
  private faceCanvas = document.createElement('canvas');
  private faceTex: THREE.CanvasTexture;
  private photo: HTMLImageElement | null = null;
  private readonly look: Look;
  private readonly boardSpec: BoardSpec;
  private readonly shoulderX: number;
  private readonly hipX: number;
  private mats: {
    wetsuit: THREE.MeshStandardMaterial;
    skin: THREE.MeshStandardMaterial;
    hair: THREE.MeshStandardMaterial;
    board: THREE.MeshPhysicalMaterial;
    fin: THREE.MeshStandardMaterial;
    paddle: THREE.MeshStandardMaterial;
    blade: THREE.MeshStandardMaterial;
    face: THREE.MeshStandardMaterial;
  };

  private pelvis: THREE.Mesh;
  private torso: THREE.Mesh;
  private neck: THREE.Mesh;
  private head = new THREE.Group();
  private hipJoints: [THREE.Mesh, THREE.Mesh];
  private ankleJoints: [THREE.Mesh, THREE.Mesh];
  private shoulderJoints: [THREE.Mesh, THREE.Mesh];
  private elbowJoints: [THREE.Mesh, THREE.Mesh];
  private kneeJoints: [THREE.Mesh, THREE.Mesh];
  private thighs: [THREE.Mesh, THREE.Mesh];
  private shins: [THREE.Mesh, THREE.Mesh];
  private feet: [THREE.Mesh, THREE.Mesh];
  private upperArms: [THREE.Mesh, THREE.Mesh];
  private forearms: [THREE.Mesh, THREE.Mesh];
  private hands: [THREE.Mesh, THREE.Mesh];
  private paddle = new THREE.Group();

  // Smoothed pose state.
  private yaw = 0;
  private hipY = 0.92;
  private lean = 0.2;
  private twist = 0;
  private headYaw = 0;
  private headPitch = 0;
  private ragdoll = 0;
  private ragT = 0;
  private footL = new THREE.Vector3(-0.17, 0, 0.04);
  private footR = new THREE.Vector3(0.17, 0, -0.04);
  private grip = new THREE.Vector3(-0.2, 1.1, 0.2);
  private bladeTip = new THREE.Vector3(0.6, -0.2, 0.6);
  private kneeHint = new THREE.Vector3(0, 0, 1);

  constructor(palette: SurferPalette, look: Look = DEFAULT_LOOK) {
    this.look = look;
    const bs = BOARDS[look.board] ?? BOARDS[0];
    const bd = BODIES[look.body] ?? BODIES[0];
    const pd = PADDLES[look.paddle] ?? PADDLES[0];
    const fc = FACES[look.face] ?? FACES[0];
    this.boardSpec = bs;
    this.shoulderX = SHOULDER_X * bd.shoulder;
    this.hipX = HIP_X * (0.5 + 0.5 * bd.torso);
    const bw = bd.width;
    const m = (c: string, rough = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    this.deckCanvas.width = 128;
    this.deckCanvas.height = 512;
    this.deckTex = new THREE.CanvasTexture(this.deckCanvas);
    this.deckTex.colorSpace = THREE.SRGBColorSpace;
    this.deckTex.wrapS = THREE.ClampToEdgeWrapping;
    this.deckTex.wrapT = THREE.ClampToEdgeWrapping;
    this.deckTex.repeat.set(1 / (2 * bs.halfW + 0.06), 1 / (bs.nose - bs.tail));
    this.deckTex.offset.set((bs.halfW + 0.03) / (2 * bs.halfW + 0.06), -bs.tail / (bs.nose - bs.tail));
    this.faceCanvas.width = 256;
    this.faceCanvas.height = 256;
    this.faceTex = new THREE.CanvasTexture(this.faceCanvas);
    this.faceTex.colorSpace = THREE.SRGBColorSpace;
    this.mats = {
      wetsuit: m(palette.wetsuit, 0.72),
      skin: m(palette.skin, 0.8),
      hair: m(palette.hair, 0.85),
      board: new THREE.MeshPhysicalMaterial({ map: this.deckTex, roughness: 0.42, clearcoat: 0.7, clearcoatRoughness: 0.18 }),
      fin: m('#1d2328', 0.45),
      paddle: m(palette.paddle, 0.45),
      blade: m(palette.blade, 0.35),
      face: new THREE.MeshStandardMaterial({ map: this.faceTex, roughness: 0.75 }),
    };

    this.board.add(new THREE.Mesh(boardGeometry(bs), this.mats.board));
    for (const fin of finGeometries(bs)) this.board.add(new THREE.Mesh(fin, this.mats.fin));

    const ball = (r: number, mat: THREE.Material) => new THREE.Mesh(new THREE.SphereGeometry(r, 14, 12), mat);
    const jball = (r: number, mat: THREE.Material) => ball(r * bw, mat);
    const vol = (profile: [number, number][], mat: THREE.Material, scaleZ = 1) => volume(profile.map(([y, r]) => [y, r * bw] as [number, number]), mat, scaleZ);
    const ws = this.mats.wetsuit;
    const pair = (make: () => THREE.Mesh): [THREE.Mesh, THREE.Mesh] => [make(), make()];
    // Profiles run from the proximal joint (-0.5) to the distal one (0.5).
    this.thighs = pair(() => vol([[-0.5, 0.082], [-0.42, 0.095], [-0.1, 0.088], [0.3, 0.074], [0.5, 0.064]], ws));
    this.shins = pair(() => vol([[-0.5, 0.062], [-0.3, 0.074], [-0.05, 0.062], [0.3, 0.046], [0.5, 0.038]], ws));
    this.upperArms = pair(() => vol([[-0.5, 0.062], [-0.25, 0.056], [0.2, 0.048], [0.5, 0.04]], ws));
    this.forearms = pair(() => vol([[-0.5, 0.042], [-0.3, 0.05], [0.1, 0.04], [0.5, 0.028]], ws));
    this.hipJoints = pair(() => jball(0.088, ws));
    this.shoulderJoints = pair(() => {
      const d = jball(0.068, ws);
      d.scale.set(1, 1.12, 0.95);
      return d;
    });
    this.elbowJoints = pair(() => jball(0.044, ws));
    this.kneeJoints = pair(() => jball(0.064, ws));
    this.ankleJoints = pair(() => jball(0.04, ws));
    const footGeo = new THREE.CapsuleGeometry(0.045, 0.17, 4, 10);
    footGeo.rotateX(Math.PI / 2);
    footGeo.scale(1, 0.5, 1);
    footGeo.translate(0, 0, 0.03);
    this.feet = pair(() => new THREE.Mesh(footGeo, ws));
    this.hands = pair(() => {
      const h = ball(0.045, this.mats.skin);
      h.scale.set(1, 0.5, 1.9);
      return h;
    });

    // Torso: glutes/pelvis widening to the trochanters, a narrower waist at the navel, the
    // ribcage flaring to the chest, then the trapezius sloping into the neck. -0.5 is the hip
    // centre, 0.5 the shoulder line; the cross-section is an ellipse (deeper than it is wide
    // is wrong for a chest, so z is flattened to 0.62).
    const bt = bd.torso;
    const belly = (y: number) => (y > -0.5 && y < 0.2 ? bd.belly * Math.cos(((y + 0.15) / 0.35) * (Math.PI / 2)) : 0);
    this.torso = volume(
      (
        [
          [-0.56, 0.1],
          [-0.5, 0.148],
          [-0.42, 0.158],
          [-0.25, 0.15],
          [-0.08, 0.14],
          [0.1, 0.162],
          [0.3, 0.18],
          [0.42, 0.176],
          [0.5, 0.152],
          [0.57, 0.09],
          [0.6, 0.0],
        ] as [number, number][]
      ).map(([y, r]) => [y, r * bt + belly(y)] as [number, number]),
      ws,
      0.62 + 0.5 * bd.belly,
    );
    this.pelvis = ball(1, ws);
    this.pelvis.scale.set(0.165 * bt, 0.12, 0.115 * (0.5 + 0.5 * bt));
    this.neck = volume([[-0.5, 0.058], [-0.1, 0.05], [0.5, 0.05]], this.mats.skin);

    // Head: one head unit (0.237 m) from crown to chin, cranium plus a narrower jaw.
    const skull = ball(0.1, this.mats.skin);
    skull.scale.set(0.8, 1.0, 0.9);
    const jaw = ball(0.07, this.mats.skin);
    jaw.scale.set(0.9, 0.8, 0.95);
    jaw.position.set(0, -0.08, 0.012);
    // The face is a texture on an ellipsoid cap over the front of the skull and jaw (brow to chin).
    const face = new THREE.Mesh(new THREE.SphereGeometry(0.1, 24, 18, Math.PI / 2 - 0.95, 1.9, 0.75, 1.85), this.mats.face);
    face.scale.set(0.8, 1.25, 0.9);
    face.position.set(0, -0.03, 0.004);
    const parts: THREE.Object3D[] = [face];
    if (fc.hair) {
      // A photo brings its own hairline, so the hair cap stops higher and tilts back off the brow.
      const photo = !!this.look.facePhoto;
      const theta = photo ? Math.min(fc.hair.theta, 0.52) : fc.hair.theta;
      const hair = new THREE.Mesh(new THREE.SphereGeometry(0.106, 18, 14, 0, Math.PI * 2, 0, Math.PI * theta), this.mats.hair);
      hair.scale.set(...fc.hair.scale);
      hair.rotation.x = fc.hair.rot - (photo ? 0.3 : 0);
      parts.push(hair);
    }
    const nose = ball(0.016, this.mats.skin);
    nose.scale.set(0.8, 1.4, 1);
    nose.position.set(0, -0.04, 0.1);
    const earL = ball(0.02, this.mats.skin);
    earL.scale.set(0.5, 1.2, 0.9);
    earL.position.set(-0.08, -0.02, 0);
    const earR = earL.clone();
    earR.position.x = 0.08;
    this.head.add(skull, jaw, nose, earL, earR, ...parts);

    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(pd.shaftR, pd.shaftR, SHAFT, 10), this.mats.paddle);
    shaft.position.y = SHAFT / 2;
    let grip: THREE.Mesh;
    if (pd.grip === 'palm') {
      grip = ball(0.03, this.mats.paddle);
      grip.scale.set(1.5, 0.75, 1);
    } else {
      grip = new THREE.Mesh(new THREE.CylinderGeometry(pd.shaftR + 0.003, pd.shaftR + 0.003, 0.13, 10), this.mats.paddle);
      grip.rotation.z = Math.PI / 2;
    }
    const blade = new THREE.Mesh(bladeGeometry(pd), this.mats.blade);
    blade.position.y = SHAFT - 0.02;
    blade.rotation.x = 0.17;
    this.paddle.add(shaft, grip, blade);
    if (pd.collar) {
      const collar = new THREE.Mesh(new THREE.CylinderGeometry(pd.shaftR + 0.006, pd.shaftR + 0.006, 0.08, 10), this.mats.blade);
      collar.position.y = SHAFT * 0.42;
      this.paddle.add(collar);
    }
    if (look.facePhoto) {
      const img = new Image();
      img.onload = () => {
        this.photo = img;
        this.repaintFace();
      };
      img.src = look.facePhoto;
    }

    this.body.add(
      this.pelvis,
      this.torso,
      this.neck,
      this.head,
      ...this.hipJoints,
      ...this.ankleJoints,
      ...this.shoulderJoints,
      ...this.elbowJoints,
      ...this.kneeJoints,
      ...this.thighs,
      ...this.shins,
      ...this.feet,
      ...this.upperArms,
      ...this.forearms,
      ...this.hands,
      this.paddle,
    );
    this.body.position.y = BOARD_THICK + 0.05;
    this.group.add(this.board, this.body);
    this.group.traverse((o) => {
      o.castShadow = true;
    });
    this.setPalette(palette);
    this.pose(0, 0, 0, 1);
  }

  setPalette(p: SurferPalette): void {
    this.mats.wetsuit.color.set(p.wetsuit);
    this.mats.skin.color.set(p.skin);
    this.mats.hair.color.set(p.hair);
    this.mats.paddle.color.set(p.paddle);
    this.mats.blade.color.set(p.blade);
    paintDeck(this.deckCanvas.getContext('2d')!, p, this.boardSpec.deck);
    this.deckTex.needsUpdate = true;
    this.repaintFace();
  }

  private repaintFace(): void {
    paintFace(this.faceCanvas.getContext('2d')!, this.look.face, this.mats.skin.color.getStyle(), this.mats.hair.color.getStyle(), this.photo);
    this.faceTex.needsUpdate = true;
  }

  dispose(): void {
    this.group.traverse((o) => {
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    });
    for (const mat of Object.values(this.mats)) mat.dispose();
    this.deckTex.dispose();
    this.faceTex.dispose();
  }

  /**
   * @param stance -1 back, 0 centre, 1 front
   * @param strokePhase paddling animation phase (radians), 0 to freeze
   * @param crouch 0..1 (riding)
   * @param side which rail the paddle (and, when riding, the surfer's chest) faces: +1 right, -1 left
   * @param lookYaw where the head looks, yaw relative to the board's nose (radians)
   * @param lookPitch head pitch, positive looks down
   * @param turn -1..1 turning input: shoulders wind into the turn, hips counter-rotate
   * @param idle seconds of standing around (0 = none): slow weight shifts and a paddle that swings a little
   */
  pose(stance: Stance, strokePhase: number, crouch: number, side: 1 | -1, lookYaw = 0, lookPitch = 0, turn = 0, idle = 0): void {
    const riding = strokePhase === 0 && crouch > 0;
    const k = 0.18;
    this.body.position.z = approach(this.body.position.z, stance * 0.45, k);
    const rag = this.ragdoll;
    const ra = this.ragT;

    let yaw: number;
    let hipY: number;
    let lean: number;
    if (riding) {
      // Side-on stance facing the wave, like the photo: knees bent, chest forward, paddle dragging in the face.
      yaw = side * (Math.PI / 2);
      hipY = 0.9 - 0.4 * crouch;
      lean = 0.25 + 0.55 * crouch;
      this.footL.set(-side * 0.36, 0, 0.04);
      this.footR.set(side * 0.36, 0, -0.08);
      this.grip.set(-side * 0.12, hipY + 0.5, 0.35);
      this.bladeTip.set(side * 0.85, -0.35, 0.95);
      this.kneeHint.set(0, 0, 1);
    } else {
      yaw = 0;
      this.footL.set(-0.17, 0, 0.04);
      this.footR.set(0.17, 0, -0.04);
      this.kneeHint.set(0, 0, 1);
      if (strokePhase !== 0) {
        const c = Math.cos(strokePhase);
        const s = Math.sin(strokePhase);
        hipY = 0.86;
        lean = 0.22 + 0.1 * c;
        this.grip.set(-side * 0.08, 1.5 + 0.08 * c, 0.3 + 0.12 * c);
        this.bladeTip.set(side * 0.55, -0.4 + 0.22 * s, 0.25 + 0.75 * c);
      } else {
        const sway = idle > 0 ? Math.sin(0.9 * idle) : 0;
        const bob = idle > 0 ? Math.sin(1.7 * idle + 0.8) : 0;
        hipY = 0.9 - 0.02 * (1 - Math.cos(1.1 * idle)) * (idle > 0 ? 1 : 0);
        lean = 0.15 + 0.03 * sway;
        this.footL.set(-0.17 - 0.02 * sway, 0, 0.04);
        this.footR.set(0.17 - 0.02 * sway, 0, -0.04);
        this.grip.set(-side * 0.25 + 0.03 * sway, 1.05 + 0.02 * bob, 0.15 + 0.04 * sway);
        this.bladeTip.set(side * 0.6 + 0.05 * bob, -0.15 + 0.03 * sway, 0.7 + 0.08 * sway);
      }
    }
    // Weight shift: a step forward leans the chest over the nose, a step back sits into the tail.
    lean += 0.12 * stance;
    if (stance < 0) hipY -= 0.06;
    if (rag > 0) {
      // Ragdoll: limbs flung out, paddle let go, everything loose and wobbling.
      yaw = this.yaw;
      hipY = 0.75 - 0.25 * rag;
      lean = 0.6 + 0.15 * Math.sin(2.1 * ra);
      this.footL.set(-0.45, 0.35 * rag, -0.35 + 0.1 * Math.sin(2 * ra));
      this.footR.set(0.4, 0.15 * rag, 0.4 + 0.1 * Math.cos(1.7 * ra));
      this.kneeHint.set(0, 1, 0.4);
      this.grip.set(-0.75, hipY + 0.55 + 0.1 * Math.sin(2.6 * ra), -0.25);
      this.bladeTip.set(0.8, hipY + 0.45, 0.45 + 0.1 * Math.sin(1.9 * ra));
    }
    this.yaw = approach(this.yaw, yaw, k);
    this.hipY = approach(this.hipY, hipY, k);
    this.lean = approach(this.lean, lean, k);
    this.twist = approach(this.twist, rag > 0 ? 0 : THREE.MathUtils.clamp(turn, -1, 1) * 0.45, k);
    this.body.rotation.y = this.yaw;

    const hips = _p.hips.set(0, this.hipY, -0.08 * crouch);
    this.pelvis.position.copy(hips);
    // Hips counter-rotate against the shoulders in a turn.
    const hipTw = -0.4 * this.twist;
    this.pelvis.rotation.set(this.lean * 0.4, hipTw, 0);

    // Legs.
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? -1 : 1;
      const foot = i === 0 ? this.footL : this.footR;
      const hip = _p.hip.set(sideX * this.hipX * Math.cos(hipTw), this.hipY - 0.02, hips.z - sideX * this.hipX * Math.sin(hipTw));
      const ankle = _p.ankle.set(foot.x, 0.08, foot.z);
      const hint = _p.hint.copy(this.kneeHint).addScaledVector(_p.tmp.set(sideX, 0, 0), 0.3);
      const knee = joint(hip, ankle, THIGH, SHIN, hint, _p.knee);
      span(this.thighs[i], hip, knee);
      span(this.shins[i], knee, ankle);
      this.hipJoints[i].position.copy(hip);
      this.kneeJoints[i].position.copy(knee);
      this.ankleJoints[i].position.copy(ankle);
      this.feet[i].position.set(foot.x, 0.035, foot.z);
      this.feet[i].rotation.y = -this.yaw;
    }

    // Torso, neck, head.
    const shoulders = _p.shoulders.set(0, this.hipY + TORSO * Math.cos(this.lean), hips.z + TORSO * Math.sin(this.lean));
    span(this.torso, hips, shoulders);
    this.torso.scale.y = TORSO;
    this.torso.rotateY(0.6 * this.twist);
    const neckDir = _p.tmp.subVectors(shoulders, hips).normalize();
    this.head.position.copy(shoulders).addScaledVector(neckDir, 0.2).add(_p.tmp2.set(0, 0.03, 0.03));
    // Head: eyes on the wave, within what a neck can do.
    const wantYaw = rag > 0 ? 0.5 * Math.sin(1.7 * ra) : THREE.MathUtils.clamp(wrapAngle(lookYaw - this.yaw), -1.25, 1.25);
    const wantPitch = rag > 0 ? -0.5 * rag : -0.12 - 0.25 * crouch + lookPitch;
    this.headYaw = approach(this.headYaw, wantYaw, 0.12);
    this.headPitch = approach(this.headPitch, wantPitch, 0.12);
    this.head.rotation.set(this.headPitch, this.headYaw + 0.6 * this.twist, 0, 'YXZ');
    span(this.neck, _p.tmp2.copy(shoulders).addScaledVector(neckDir, -0.04), _p.tmp.copy(this.head.position).addScaledVector(neckDir, -0.07));

    // Paddle: its local +y runs from the T-grip down the shaft to the blade.
    const grip = this.grip;
    const tip = this.bladeTip;
    const dir = _p.tmp.subVectors(tip, grip).normalize();
    this.paddle.position.copy(grip);
    this.paddle.quaternion.setFromUnitVectors(UP, dir);
    if (rag > 0) {
      // The paddle gets away and tumbles off to the side.
      this.paddle.position.add(_p.tmp2.set(1.4 * rag, -0.35 * rag + 0.05 * Math.sin(3 * ra), 0.6 * rag));
      this.paddle.rotateOnAxis(UP, 2.5 * ra);
      this.paddle.rotateX(0.9 * rag);
    }
    const lowHand = _p.lowHand.copy(grip).addScaledVector(dir, 0.72);

    // Arms: the hand on the paddle side holds the shaft, the other one the grip.
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? -1 : 1;
      const shoulder = _p.shoulder.set(sideX * this.shoulderX * Math.cos(this.twist), shoulders.y - 0.01, shoulders.z - sideX * this.shoulderX * Math.sin(this.twist));
      const target = sideX === side ? lowHand : grip;
      const hand = _p.hand.copy(target);
      const hint = _p.hint.set(sideX * 0.8, -0.6, -0.2);
      const elbow = joint(shoulder, hand, UPPER_ARM, FOREARM, hint, _p.elbow);
      span(this.upperArms[i], shoulder, elbow);
      span(this.forearms[i], elbow, hand);
      this.shoulderJoints[i].position.copy(shoulder);
      this.elbowJoints[i].position.copy(elbow);
      this.hands[i].position.copy(hand);
      if (rag > 0) this.hands[i].quaternion.setFromUnitVectors(UP, _p.tmp2.subVectors(hand, elbow).normalize());
      else this.hands[i].quaternion.copy(this.paddle.quaternion);
    }
  }

  /**
   * @param progress 0..1 how far into the fall
   * @param age seconds since the wipeout started (drives the tumbling and bobbing)
   */
  setWipeout(progress: number, age = progress): void {
    this.ragdoll = progress;
    this.ragT = age;
    const wob = progress * 0.15 * Math.sin(3.1 * age);
    this.body.rotation.set(-progress * 1.9 + wob, this.yaw + progress * 0.9, progress * 0.7 + 0.1 * progress * Math.sin(2.3 * age));
    this.body.position.y = BOARD_THICK + 0.05 - progress * 0.45 + 0.04 * progress * Math.sin(2 * age);
    this.body.position.x = progress * 1.3;
    this.board.rotation.z = progress * 0.9 + 0.08 * progress * Math.sin(2.7 * age);
    this.board.rotation.x = 0.15 * progress * Math.sin(1.9 * age);
  }

  resetWipeout(): void {
    this.ragdoll = 0;
    this.ragT = 0;
    this.body.rotation.set(0, this.yaw, 0);
    this.body.position.set(0, BOARD_THICK + 0.05, this.body.position.z);
    this.board.rotation.set(0, 0, 0);
  }
}

const _p = {
  hips: new THREE.Vector3(),
  hip: new THREE.Vector3(),
  ankle: new THREE.Vector3(),
  knee: new THREE.Vector3(),
  hint: new THREE.Vector3(),
  shoulders: new THREE.Vector3(),
  shoulder: new THREE.Vector3(),
  elbow: new THREE.Vector3(),
  hand: new THREE.Vector3(),
  lowHand: new THREE.Vector3(),
  tmp: new THREE.Vector3(),
  tmp2: new THREE.Vector3(),
};
