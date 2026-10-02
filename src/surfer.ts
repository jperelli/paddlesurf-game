import * as THREE from 'three';
import type { SurferPalette } from './palette';

export type Stance = -1 | 0 | 1;

// Board (metres). Local +z is the nose, +x is the right rail.
const BOARD_NOSE = 1.5;
const BOARD_TAIL = -1.3;
const BOARD_HALF_W = 0.39;
const BOARD_THICK = 0.12;

// Body segment lengths (metres) for a ~1.78 m paddler.
const THIGH = 0.44;
const SHIN = 0.44;
const TORSO = 0.55;
const UPPER_ARM = 0.3;
const FOREARM = 0.28;
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

/** Paints the deck: red board, orange nose with white stripes, grey pad, yellow-green tail (like the photo). */
function paintDeck(ctx: CanvasRenderingContext2D, p: SurferPalette): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.fillStyle = p.board;
  ctx.fillRect(0, 0, W, H);

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

  ctx.fillStyle = 'rgba(210,210,200,0.9)';
  ctx.beginPath();
  ctx.roundRect(W * 0.14, H * 0.36, W * 0.72, H * 0.4, W * 0.1);
  ctx.fill();

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

/** The paddler from the photo: black full wetsuit, red SUP with orange nose and yellow tail, dark paddle. */
export class SurferRig {
  readonly group = new THREE.Group();
  private body = new THREE.Group();
  private board: THREE.Mesh;
  private deckCanvas = document.createElement('canvas');
  private deckTex: THREE.CanvasTexture;
  private mats: { wetsuit: THREE.MeshStandardMaterial; skin: THREE.MeshStandardMaterial; hair: THREE.MeshStandardMaterial; board: THREE.MeshStandardMaterial; paddle: THREE.MeshStandardMaterial; blade: THREE.MeshStandardMaterial };

  private pelvis: THREE.Mesh;
  private torso: THREE.Mesh;
  private head: THREE.Mesh;
  private hair: THREE.Mesh;
  private thighs: [THREE.Mesh, THREE.Mesh];
  private shins: [THREE.Mesh, THREE.Mesh];
  private feet: [THREE.Mesh, THREE.Mesh];
  private upperArms: [THREE.Mesh, THREE.Mesh];
  private forearms: [THREE.Mesh, THREE.Mesh];
  private hands: [THREE.Mesh, THREE.Mesh];
  private shaft: THREE.Mesh;
  private blade: THREE.Mesh;

  // Smoothed pose state.
  private yaw = 0;
  private hipY = 0.92;
  private lean = 0.2;
  private footL = new THREE.Vector3(-0.17, 0, 0.04);
  private footR = new THREE.Vector3(0.17, 0, -0.04);
  private grip = new THREE.Vector3(-0.2, 1.1, 0.2);
  private bladeTip = new THREE.Vector3(0.6, -0.2, 0.6);
  private kneeHint = new THREE.Vector3(0, 0, 1);

  constructor(palette: SurferPalette) {
    const m = (c: string, rough = 0.6) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
    this.deckCanvas.width = 128;
    this.deckCanvas.height = 512;
    this.deckTex = new THREE.CanvasTexture(this.deckCanvas);
    this.deckTex.colorSpace = THREE.SRGBColorSpace;
    this.deckTex.wrapS = THREE.ClampToEdgeWrapping;
    this.deckTex.wrapT = THREE.ClampToEdgeWrapping;
    this.deckTex.repeat.set(1 / (2 * BOARD_HALF_W + 0.06), 1 / (BOARD_NOSE - BOARD_TAIL));
    this.deckTex.offset.set((BOARD_HALF_W + 0.03) / (2 * BOARD_HALF_W + 0.06), -BOARD_TAIL / (BOARD_NOSE - BOARD_TAIL));
    this.mats = {
      wetsuit: m(palette.wetsuit, 0.8),
      skin: m(palette.skin, 0.85),
      hair: m(palette.hair, 0.9),
      board: new THREE.MeshStandardMaterial({ map: this.deckTex, roughness: 0.3 }),
      paddle: m(palette.paddle, 0.5),
      blade: m(palette.blade, 0.4),
    };

    const shape = new THREE.Shape();
    shape.moveTo(0, BOARD_NOSE);
    shape.bezierCurveTo(BOARD_HALF_W * 1.05, BOARD_NOSE - 0.6, BOARD_HALF_W * 1.1, BOARD_TAIL + 0.7, BOARD_HALF_W * 0.55, BOARD_TAIL);
    shape.lineTo(-BOARD_HALF_W * 0.55, BOARD_TAIL);
    shape.bezierCurveTo(-BOARD_HALF_W * 1.1, BOARD_TAIL + 0.7, -BOARD_HALF_W * 1.05, BOARD_NOSE - 0.6, 0, BOARD_NOSE);
    const boardGeo = new THREE.ExtrudeGeometry(shape, {
      depth: BOARD_THICK,
      bevelEnabled: true,
      bevelSize: 0.03,
      bevelThickness: 0.03,
      bevelSegments: 2,
      curveSegments: 16,
    });
    boardGeo.rotateX(Math.PI / 2);
    boardGeo.translate(0, BOARD_THICK + 0.02, 0);
    this.board = new THREE.Mesh(boardGeo, this.mats.board);

    const cyl = (r: number, mat: THREE.Material) => new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 1, 10), mat);
    this.thighs = [cyl(0.085, this.mats.wetsuit), cyl(0.085, this.mats.wetsuit)];
    this.shins = [cyl(0.065, this.mats.wetsuit), cyl(0.065, this.mats.wetsuit)];
    this.upperArms = [cyl(0.055, this.mats.wetsuit), cyl(0.055, this.mats.wetsuit)];
    this.forearms = [cyl(0.045, this.mats.wetsuit), cyl(0.045, this.mats.wetsuit)];
    const foot = () => new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.06, 0.26), this.mats.wetsuit);
    this.feet = [foot(), foot()];
    const hand = () => new THREE.Mesh(new THREE.SphereGeometry(0.05, 8, 6), this.mats.skin);
    this.hands = [hand(), hand()];

    this.pelvis = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.2, 0.22), this.mats.wetsuit);
    this.torso = new THREE.Mesh(new THREE.BoxGeometry(0.42, 1, 0.24), this.mats.wetsuit);
    this.head = new THREE.Mesh(new THREE.SphereGeometry(0.11, 14, 10), this.mats.skin);
    this.hair = new THREE.Mesh(new THREE.SphereGeometry(0.112, 14, 10), this.mats.hair);

    this.shaft = cyl(0.018, this.mats.paddle);
    this.blade = new THREE.Mesh(new THREE.BoxGeometry(0.21, 1, 0.025), this.mats.blade);

    this.body.add(
      this.pelvis,
      this.torso,
      this.head,
      this.hair,
      ...this.thighs,
      ...this.shins,
      ...this.feet,
      ...this.upperArms,
      ...this.forearms,
      ...this.hands,
      this.shaft,
      this.blade,
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
    paintDeck(this.deckCanvas.getContext('2d')!, p);
    this.deckTex.needsUpdate = true;
  }

  /**
   * @param stance -1 back, 0 centre, 1 front
   * @param strokePhase paddling animation phase (radians), 0 to freeze
   * @param crouch 0..1 (riding)
   * @param side which rail the paddle (and, when riding, the surfer's chest) faces: +1 right, -1 left
   */
  pose(stance: Stance, strokePhase: number, crouch: number, side: 1 | -1): void {
    const riding = strokePhase === 0 && crouch > 0;
    const k = 0.18;
    this.body.position.z = approach(this.body.position.z, stance * 0.45, k);

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
        hipY = 0.9;
        lean = 0.15;
        this.grip.set(-side * 0.25, 1.05, 0.15);
        this.bladeTip.set(side * 0.6, -0.15, 0.7);
      }
    }
    this.yaw = approach(this.yaw, yaw, k);
    this.hipY = approach(this.hipY, hipY, k);
    this.lean = approach(this.lean, lean, k);
    this.body.rotation.y = this.yaw;

    const hips = _p.hips.set(0, this.hipY, -0.08 * crouch);
    this.pelvis.position.copy(hips);
    this.pelvis.rotation.set(this.lean * 0.4, 0, 0);

    // Legs.
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? -1 : 1;
      const foot = i === 0 ? this.footL : this.footR;
      const hip = _p.hip.set(sideX * 0.12, this.hipY, hips.z);
      const ankle = _p.ankle.set(foot.x, 0.08, foot.z);
      const hint = _p.hint.copy(this.kneeHint).addScaledVector(_p.tmp.set(sideX, 0, 0), 0.3);
      const knee = joint(hip, ankle, THIGH, SHIN, hint, _p.knee);
      span(this.thighs[i], hip, knee);
      span(this.shins[i], knee, ankle);
      this.feet[i].position.set(foot.x, 0.03, foot.z);
      this.feet[i].rotation.y = -this.yaw;
    }

    // Torso, head.
    const shoulders = _p.shoulders.set(0, this.hipY + TORSO * Math.cos(this.lean), hips.z + TORSO * Math.sin(this.lean));
    span(this.torso, hips, shoulders);
    this.torso.scale.y = TORSO;
    const neckDir = _p.tmp.subVectors(shoulders, hips).normalize();
    this.head.position.copy(shoulders).addScaledVector(neckDir, 0.2).add(_p.tmp2.set(0, 0.03, 0.03));
    this.hair.position.copy(this.head.position).add(_p.tmp2.set(0, 0.035, -0.035));

    // Paddle.
    const grip = this.grip;
    const tip = this.bladeTip;
    const dir = _p.tmp.subVectors(tip, grip).normalize();
    const bladeTop = _p.bladeTop.copy(grip).addScaledVector(dir, SHAFT);
    span(this.shaft, grip, bladeTop);
    span(this.blade, bladeTop, _p.tmp2.copy(bladeTop).addScaledVector(dir, 0.45));
    const lowHand = _p.lowHand.copy(grip).addScaledVector(dir, 0.72);

    // Arms: the hand on the paddle side holds the shaft, the other one the grip.
    for (let i = 0; i < 2; i++) {
      const sideX = i === 0 ? -1 : 1;
      const shoulder = _p.shoulder.set(sideX * 0.21, shoulders.y, shoulders.z);
      const target = sideX === side ? lowHand : grip;
      const hand = _p.hand.copy(target);
      const hint = _p.hint.set(sideX * 0.8, -0.6, -0.2);
      const elbow = joint(shoulder, hand, UPPER_ARM, FOREARM, hint, _p.elbow);
      span(this.upperArms[i], shoulder, elbow);
      span(this.forearms[i], elbow, hand);
      this.hands[i].position.copy(hand);
    }
  }

  setWipeout(progress: number): void {
    this.body.rotation.x = -progress * 1.6;
    this.body.position.y = BOARD_THICK + 0.05 - progress * 0.8;
    this.body.position.x = progress * 1.2;
    this.board.rotation.z = progress * 0.9;
  }

  resetWipeout(): void {
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
  bladeTop: new THREE.Vector3(),
  tmp: new THREE.Vector3(),
  tmp2: new THREE.Vector3(),
};
