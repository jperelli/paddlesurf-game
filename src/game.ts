import * as THREE from 'three';
import { Input } from './input';
import { Sea } from './sea';
import { SkyDome } from './sky';
import { Wake } from './wake';
import { Lips } from './lip';
import { SurferRig, type Stance } from './surfer';
import {
  BREAK_Z,
  SMALL_WAVE_MAX,
  WaveScheduler,
  brokenAmount,
  brokenHalfWidth,
  crestZAt,
  faceLength,
  localHeight,
  peelLabel,
  pocketOffset,
  seaHeightAt,
  seaPointAt,
  type SeaPoint,
  type Wave,
} from './wave';
import type { Spot, Surfer } from './roster';
import type { Hud } from './hud';
import { describeConditions, rollConditions, type Conditions } from './conditions';

export type Phase = 'start' | 'waiting' | 'riding' | 'ended';
export type EndReason = 'peak' | 'closeout' | 'caught' | 'overback' | 'faded';

export const POCKET_WIDTH = 6;
const LINEUP_Z = -2;
const WIPEOUTS: EndReason[] = ['peak', 'closeout', 'caught'];

interface Ride {
  wave: Wave;
  dir: 1 | -1;
  rel: number;
  theta: number;
  time: number;
  points: number;
  lean: number;
}

interface EndInfo {
  reason: EndReason;
  points: number;
  t: number;
  wave?: Wave;
}

export class Game {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly renderer: THREE.WebGLRenderer;
  readonly input = new Input();
  readonly scheduler: WaveScheduler;
  readonly sea: Sea;
  private lips: Lips;
  private surfPt: SeaPoint = { y: 0, z: 0 };
  readonly rig: SurferRig;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private skyDome: SkyDome;
  private wake = new Wake();
  private hintGroup = new THREE.Group();
  private peakMarker: THREE.Mesh;
  private pocketMarkers: THREE.Mesh[];

  phase: Phase = 'start';
  t = 0;
  conditions: Conditions = rollConditions();
  spot: Spot;
  surfer: Surfer;
  hint = true;

  x = 0;
  z = LINEUP_Z;
  vx = 0;
  vz = 0;
  heading = Math.PI; // facing out to sea
  stance: Stance = 0;
  fatigue = 0;
  strokePhase = 0;
  paddleSide: 1 | -1 = 1;

  ride: Ride | null = null;
  end: EndInfo | null = null;
  score = 0;
  caught = 0;
  wavesSeen = 0;

  private camPos = new THREE.Vector3(0, 6.5, 15);
  private camLook = new THREE.Vector3(0, 0, -20);

  private hud: Hud;

  constructor(canvas: HTMLCanvasElement, spot: Spot, surfer: Surfer, hud: Hud) {
    this.hud = hud;
    this.spot = spot;
    this.surfer = surfer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.camera = new THREE.PerspectiveCamera(55, 1, 0.1, 400);
    this.camera.position.copy(this.camPos);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 1.0);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2dd, 1.7);
    this.scene.add(this.sun);
    this.skyDome = new SkyDome(this.renderer);
    this.scene.add(this.wake.group);

    this.sea = new Sea(spot.water);
    this.scene.add(this.sea.mesh, this.sea.beach, this.sea.far);
    this.lips = new Lips(spot.water);
    this.scene.add(this.lips.group);
    this.scheduler = new WaveScheduler(spot, this.conditions);
    this.lips.setConditions(this.conditions);

    this.rig = new SurferRig(surfer.palette);
    this.scene.add(this.rig.group);

    this.peakMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.6, 1.4, 12),
      new THREE.MeshBasicMaterial({ color: 0xe04040, transparent: true, opacity: 0.85 }),
    );
    this.peakMarker.rotation.x = Math.PI;
    const pocketGeo = new THREE.BoxGeometry(POCKET_WIDTH, 0.25, 1.2);
    const pocketMat = new THREE.MeshBasicMaterial({ color: 0x40e070, transparent: true, opacity: 0.7 });
    this.pocketMarkers = [new THREE.Mesh(pocketGeo, pocketMat), new THREE.Mesh(pocketGeo, pocketMat)];
    this.hintGroup.add(this.peakMarker, ...this.pocketMarkers);
    this.scene.add(this.hintGroup);

    this.applySpot(spot);
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Portrait phones: shift the frame up so the surfer sits above the on-screen controls.
    if (h > w) this.camera.setViewOffset(w, h, 0, h * 0.13, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
  }

  applySpot(spot: Spot): void {
    this.spot = spot;
    this.scheduler.spot = spot;
    this.sea.setPalette(spot.water);
    this.lips.setPalette(spot.water);
    this.wake.setPalette(spot.water);
    this.skyDome.apply(spot.water, this.scene, this.sun);
    const sky = new THREE.Color(spot.water.sky);
    this.hemi.color.set(sky).lerp(new THREE.Color(0xffffff), 0.5);
    this.hemi.groundColor.set(spot.water.deep).multiplyScalar(0.7);
  }

  applySurfer(surfer: Surfer): void {
    this.surfer = surfer;
    this.rig.setPalette(surfer.palette);
  }

  start(): void {
    this.phase = 'waiting';
    this.conditions = rollConditions();
    this.scheduler.reset(this.conditions);
    this.lips.setConditions(this.conditions);
    this.t = 0;
    this.score = 0;
    this.caught = 0;
    this.wavesSeen = 0;
    this.fatigue = 0;
    this.x = 0;
    this.z = LINEUP_Z;
    this.wake.clear();
    this.vx = 0;
    this.vz = 0;
    this.heading = Math.PI;
    this.stance = 0;
    this.rig.resetWipeout();
    this.hud.flash(`Paddle into position and wait for the set. Today: ${describeConditions(this.conditions)}.`, 6000);
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    const input = this.input;
    if (input.wasPressed('KeyH')) this.hint = !this.hint;

    if (this.phase !== 'start') {
      this.t += dt;
      this.scheduler.update(this.t);
    }

    switch (this.phase) {
      case 'start':
        if (input.anyPressed()) this.start();
        break;
      case 'waiting':
        this.updateWaiting(dt);
        break;
      case 'riding':
        this.updateRiding(dt);
        break;
      case 'ended':
        this.updateEnded(dt);
        break;
    }

    const speed = this.phase === 'start' ? 0 : Math.hypot(this.vx, this.vz);
    this.wake.update(this.t, this.x, this.z, this.heading, speed, this.scheduler.waves, this.spot);
    this.sea.update(this.scheduler.waves, this.t, this.spot, this.wake.points);
    this.skyDome.update(this.t);
    this.lips.update(this.scheduler.waves, this.t, this.spot, dt);
    this.placeRig();
    this.updateHints();
    this.updateCamera(dt);
    this.renderer.render(this.scene, this.camera);
    input.endFrame();
  }

  // ---------------------------------------------------------------- phase 1

  private updateWaiting(dt: number): void {
    const input = this.input;
    const ax = (input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('ArrowLeft') ? 1 : 0);
    const az = (input.isDown('ArrowDown') ? 1 : 0) - (input.isDown('ArrowUp') ? 1 : 0);
    const moving = ax !== 0 || az !== 0;
    const power = input.isDown('Space') && moving && this.fatigue < 0.98;

    if (power) this.fatigue = Math.min(1, this.fatigue + 0.28 * dt);
    else this.fatigue = Math.max(0, this.fatigue - 0.07 * dt);

    let maxS = 3.0 * (1 - 0.35 * this.fatigue);
    if (power) maxS *= 2.0 - 1.25 * this.fatigue;
    const len = Math.hypot(ax, az) || 1;
    const tx = moving ? (ax / len) * maxS : 0;
    const tz = moving ? (az / len) * maxS : 0;
    const k = Math.min(1, 3.2 * dt);
    this.vx += (tx - this.vx) * k;
    this.vz += (tz - this.vz) * k;
    this.x = THREE.MathUtils.clamp(this.x + (this.vx + this.conditions.current) * dt, -70, 70);
    this.z = THREE.MathUtils.clamp(this.z + this.vz * dt, -48, 24);

    const speed = Math.hypot(this.vx, this.vz);
    if (speed > 0.4) {
      const target = Math.atan2(this.vx, this.vz);
      this.heading = lerpAngle(this.heading, target, Math.min(1, 5 * dt));
    }
    if (moving) {
      this.strokePhase += dt * (3.5 + 2.5 * (speed / 3) + (power ? 4 : 0));
      this.paddleSide = Math.floor(this.strokePhase / (Math.PI * 2)) % 2 === 0 ? 1 : -1;
    } else {
      this.strokePhase = 0;
    }

    for (const w of this.scheduler.waves) {
      if (!w.passedSurfer && crestZAt(w, this.x, this.t) >= this.z) {
        w.passedSurfer = true;
        this.evaluateTakeoff(w);
        if (this.phase !== 'waiting') break;
      }
    }
  }

  private evaluateTakeoff(w: Wave): void {
    const t = this.t;
    const h = localHeight(w, this.x, t);
    if (!w.isSet || h < SMALL_WAVE_MAX) {
      if (w.isSet) this.hud.flash('Too far out on the shoulder, no push there.');
      else this.hud.flash('Just a small one, it rolled under you.');
      return;
    }
    this.wavesSeen++;
    const off = pocketOffset(w, this.x, t, this.spot);
    const dx = this.x - w.peakX;
    const side: 1 | -1 = w.peel !== 0 ? w.peel : dx >= 0 ? 1 : -1;
    if (off < 1.2) {
      if (w.peel !== 0 && dx * w.peel < -1.2) {
        this.hud.flash(`Wrong side: this one only goes ${w.peel === 1 ? 'right' : 'left'}. The whitewater got you.`);
      } else {
        this.hud.flash('Right under the peak. The lip landed on you.');
      }
      this.endRide('peak', w);
      return;
    }
    if (off < POCKET_WIDTH) {
      if (this.vx * side < -0.8) {
        this.hud.flash('In the pocket but paddling into the peak. Wave lost.');
        return;
      }
      if (crestZAt(w, this.x, t) < BREAK_Z - 4) {
        this.hud.flash('Too early, it was not steep enough yet.');
        return;
      }
      this.startRide(w, side);
      return;
    }
    if (off < POCKET_WIDTH + 10) this.hud.flash('Too far on the shoulder, it passed under you.');
    else this.hud.flash('Missed it, too far from the peak.');
  }

  private startRide(w: Wave, dir: 1 | -1): void {
    this.phase = 'riding';
    this.ride = { wave: w, dir, rel: 0.3, theta: 0.45, time: 0, points: 0, lean: 0 };
    this.stance = 0;
    this.caught++;
    this.hud.flash(dir === 1 ? 'Got it! Riding →' : 'Got it! Riding ←', 2000);
  }

  // ---------------------------------------------------------------- phase 2

  private updateRiding(dt: number): void {
    const r = this.ride;
    if (!r) return;
    const input = this.input;
    const w = r.wave;
    const t = this.t;
    r.time += dt;

    if (input.wasPressed('ArrowUp')) this.stance = Math.min(1, this.stance + 1) as Stance;
    if (input.wasPressed('ArrowDown')) this.stance = Math.max(-1, this.stance - 1) as Stance;
    const stanceSpeed = [0.85, 1.0, 0.9][this.stance + 1];
    const stanceTurn = [1.55, 1.0, 0.6][this.stance + 1];

    const H = localHeight(w, this.x, t);
    const turnIn = (input.isDown('ArrowRight') ? 1 : 0) - (input.isDown('ArrowLeft') ? 1 : 0);
    const turnRate = 1.7 * stanceTurn;
    const dTheta = turnIn * r.dir * turnRate * dt;
    r.theta = THREE.MathUtils.clamp(r.theta + dTheta, -0.95, 1.5);

    const relC = THREE.MathUtils.clamp(r.rel, 0, 1);
    let S = (3.6 + 3.2 * H) * (0.65 + 0.35 * (1 - relC)) * stanceSpeed;
    if (r.rel > 1) S *= Math.max(0.4, 1 - (r.rel - 1) * 2);

    const fl = faceLength(Math.max(H, 0.4));
    const vx = S * Math.cos(r.theta) * r.dir;
    let drel = (0.55 * S * Math.sin(r.theta)) / fl + 0.08;
    if (r.rel > 1) drel -= (r.rel - 1) * 1.6;
    r.rel += drel * dt;
    this.x += vx * dt;
    this.z = crestZAt(w, this.x, t) + r.rel * fl;
    this.vx = vx;
    this.vz = w.speed + drel * fl + Math.tan(w.angle) * vx;
    this.heading = lerpAngle(this.heading, Math.atan2(this.vx, this.vz), Math.min(1, 8 * dt));
    const targetLean = -turnIn * r.dir * 0.35 * stanceTurn;
    r.lean += (targetLean - r.lean) * Math.min(1, 6 * dt);

    r.points += dt * H * (2 + 3 * Math.max(0, 0.45 - r.rel)) + Math.abs(dTheta) * H * 1.5;

    if (brokenAmount(w, this.x, t, this.spot) > 0.5) {
      const front = w.fronts.find((f) => Math.abs(this.x - f.x) < this.spot.peelSpeed * (t - f.startT) + 1.5);
      const ahead = front ? Math.sign(front.x - this.x) === r.dir : false;
      if (ahead) this.hud.flash('It closed out in front of you.');
      else this.hud.flash('The foam caught up with you.');
      this.endRide(ahead ? 'closeout' : 'caught', w);
      return;
    }
    if (r.rel < -0.15) {
      this.hud.flash('You went over the back. Wave lost.');
      this.endRide('overback', w);
      return;
    }
    if (H < 0.35) {
      this.hud.flash('The wave faded out. Nice ride!');
      this.endRide('faded', w);
    }
  }

  private endRide(reason: EndReason, wave: Wave): void {
    const wipeout = WIPEOUTS.includes(reason);
    const points = reason === 'peak' ? 0 : Math.round((this.ride?.points ?? 0) * 10 * (wipeout ? 0.5 : 1));
    this.score += points;
    this.fatigue = Math.min(1, this.fatigue + (wipeout ? 0.3 : 0.1));
    this.end = { reason, points, t: this.t, wave };
    this.phase = 'ended';
    this.hud.showEnd(reason, points, this.ride?.time ?? 0);
  }

  // ---------------------------------------------------------------- phase 3/4

  private updateEnded(dt: number): void {
    const e = this.end;
    if (!e) return;
    const age = this.t - e.t;
    const wipeout = WIPEOUTS.includes(e.reason);
    if (wipeout) {
      this.rig.setWipeout(Math.min(1, age / 0.6));
      if (e.wave) this.z += e.wave.speed * 0.5 * dt;
      this.vx *= 0.9;
    } else {
      this.vx *= 0.97;
      this.x += this.vx * dt;
      this.vz = Math.max(0, this.vz - 3 * dt);
      this.z += this.vz * dt;
    }
    if (age > 1.2 && this.input.anyPressed()) this.resetToLineup();
  }

  private resetToLineup(): void {
    this.phase = 'waiting';
    this.ride = null;
    this.end = null;
    this.hud.hideEnd();
    this.rig.resetWipeout();
    this.x = THREE.MathUtils.clamp(this.x, -45, 45);
    this.z = LINEUP_Z;
    this.wake.clear();
    this.vx = 0;
    this.vz = 0;
    this.heading = Math.PI;
    this.stance = 0;
    for (const w of this.scheduler.waves) if (crestZAt(w, this.x, this.t) >= this.z - 2) w.passedSurfer = true;
    this.hud.flash('Back in the lineup.', 2500);
  }

  // ---------------------------------------------------------------- presentation

  private placeRig(): void {
    const waves = this.scheduler.waves;
    const t = this.t;
    const p = seaPointAt(waves, this.x, this.z, t, this.spot, this.surfPt);
    const g = this.rig.group;
    g.position.set(this.x, p.y + 0.02, p.z);
    const fx = Math.sin(this.heading);
    const fz = Math.cos(this.heading);
    const ahead = seaHeightAt(waves, this.x + fx, this.z + fz, t, this.spot);
    const behind = seaHeightAt(waves, this.x - fx, this.z - fz, t, this.spot);
    const right = seaHeightAt(waves, this.x + fz, this.z - fx, t, this.spot);
    const left = seaHeightAt(waves, this.x - fz, this.z + fx, t, this.spot);
    const pitch = Math.atan2(behind - ahead, 2) * 0.8;
    const roll = Math.atan2(right - left, 2) * 0.8;
    g.rotation.set(0, 0, 0);
    g.rotateY(this.heading);
    g.rotateX(pitch);
    const lean = this.ride ? this.ride.lean : 0;
    g.rotateZ(roll + lean);

    const riding = this.phase === 'riding';
    const crouch = riding ? 0.6 + 0.4 * Math.abs(this.ride?.lean ?? 0) / 0.35 : 0;
    const stroke = this.phase === 'waiting' ? this.strokePhase : 0;
    this.rig.pose(this.stance, stroke, Math.min(1, crouch), riding && this.ride ? (-this.ride.dir as 1 | -1) : this.paddleSide);
  }

  private updateHints(): void {
    const show = this.hint && this.phase === 'waiting';
    this.hintGroup.visible = show;
    if (!show) return;
    const w = this.scheduler.nextSetWave(this.t, this.z);
    if (!w) {
      this.hintGroup.visible = false;
      return;
    }
    const half = brokenHalfWidth(w, this.t, this.spot);
    const topY = localHeight(w, w.peakX, this.t) + 1.2;
    this.peakMarker.position.set(w.peakX, topY, crestZAt(w, w.peakX, this.t));
    for (let i = 0; i < 2; i++) {
      const side = i === 0 ? 1 : -1;
      const px = w.peakX + side * (half + POCKET_WIDTH / 2);
      const pz = crestZAt(w, px, this.t) + 0.5;
      const p = seaPointAt(this.scheduler.waves, px, pz, this.t, this.spot, this.surfPt);
      this.pocketMarkers[i].position.set(px, p.y + 0.15, p.z);
      this.pocketMarkers[i].visible = w.peel === 0 || w.peel === side;
    }
  }

  private updateCamera(dt: number): void {
    const tp = new THREE.Vector3();
    const tl = new THREE.Vector3();
    if (this.phase === 'riding' && this.ride) {
      const d = this.ride.dir;
      tp.set(this.x - d * 13, 5.5, this.z + 10);
      tl.set(this.x + d * 5, 0.8, this.z - 1);
    } else if (this.phase === 'ended' && this.end && this.ride) {
      const d = this.ride.dir;
      tp.set(this.x - d * 13, 6, this.z + 12);
      tl.set(this.x, 0.5, this.z);
    } else {
      tp.set(this.x, 6.5, this.z + 15);
      tl.set(this.x, 2.5, this.z - 26);
    }
    const k = 1 - Math.exp(-3 * dt);
    this.camPos.lerp(tp, k);
    this.camLook.lerp(tl, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  /** Label for the HUD: what is coming. */
  setLabel(): string {
    if (this.ride) {
      const w = this.ride.wave;
      return `Riding set wave ${w.setIndex}/${w.setSize} · ${localHeight(w, this.x, this.t).toFixed(1)} m here`;
    }
    const next = this.scheduler.nextSetWave(this.t, this.z);
    if (next) {
      const dist = Math.round(this.z - crestZAt(next, this.x, this.t));
      return `Set wave ${next.setIndex}/${next.setSize} · ${next.height.toFixed(1)} m · ${peelLabel(next)} · ${dist} m out`;
    }
    return this.scheduler.modeLabel === 'set' ? 'Set wave on the way' : 'Lull. Small waves, the set is coming.';
  }
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
