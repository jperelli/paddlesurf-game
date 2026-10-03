import * as THREE from 'three';
import { Input } from './input';
import { Sea } from './sea';
import { SkyDome } from './sky';
import { Wake } from './wake';
import { Lips } from './lip';
import { SurferRig, type Stance } from './surfer';
import { lookKey } from './looks';
import {
  SMALL_WAVE_MAX,
  WaveScheduler,
  brokenAmount,
  brokenHalfWidth,
  crestZAt,
  faceLength,
  brokenAge,
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
import { describeConditions, rollConditions, tideRising, type Conditions, type Preset } from './conditions';
import { newSessionCode, seedRng } from './rng';
import type { Quality } from './quality';
import { LensDrops } from './lens';
import { sunColor, sunElevation, sunLow } from './sky';
import { t as tr } from './i18n';

export type Phase = 'start' | 'waiting' | 'riding' | 'ended';
export type EndReason = 'peak' | 'closeout' | 'caught' | 'overback' | 'faded';

export const POCKET_WIDTH = 6;
const LINEUP_Z = -2;
const WIPEOUTS: EndReason[] = ['peak', 'closeout', 'caught'];
const HINTS_KEY = 'paddlesurf.hints';
/** Seconds after breaking by which whitewater has dissipated enough to roll under you harmlessly. */
const FOAM_SOFT_AGE = 4;
/** Whitewater (m) low enough to punch through by paddling straight out into it. */
const FOAM_PUNCH_HEIGHT = 1.1;

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
  rig: SurferRig;
  private rigKey: string;
  private hemi: THREE.HemisphereLight;
  private sun: THREE.DirectionalLight;
  private skyDome: SkyDome;
  private wake = new Wake();
  private hintGroup = new THREE.Group();
  private peakMarker: THREE.Mesh;
  private pocketMarkers: THREE.Mesh[];

  phase: Phase = 'start';
  /** Start screen framing: a close-up of the surfer on the first step, the lineup on the spot step. */
  startView: 'surfer' | 'spot' = 'surfer';
  private idleT = 0;
  private camSnap = true;
  t = 0;
  conditions: Conditions = rollConditions();
  preset: Preset = 'random';
  seed = newSessionCode();
  spot: Spot;
  surfer: Surfer;
  /** Subtle peak/pocket markers, on unless turned off in Settings or with H. */
  hint = localStorage.getItem(HINTS_KEY) !== '0';

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
  private lens: LensDrops;

  readonly quality: Quality;

  constructor(canvas: HTMLCanvasElement, spot: Spot, surfer: Surfer, hud: Hud, quality: Quality = 'high') {
    this.quality = quality;
    this.hud = hud;
    const lensCanvas = hud.root.querySelector<HTMLCanvasElement>('#hud-lens');
    if (!lensCanvas) throw new Error('lens canvas missing');
    this.lens = new LensDrops(lensCanvas);
    this.spot = spot;
    this.surfer = surfer;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: quality === 'high' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, quality === 'high' ? 2 : 1.25));
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

    this.sea = new Sea(spot.water, quality);
    this.scene.add(this.sea.mesh, this.sea.floor, this.sea.beach, this.sea.far);
    this.lips = new Lips(spot.water, quality);
    this.scene.add(this.lips.group);
    this.scheduler = new WaveScheduler(spot, this.conditions);
    this.lips.setConditions(this.conditions);

    this.rig = new SurferRig(surfer.palette, surfer.look);
    this.rigKey = lookKey(surfer.look);
    this.scene.add(this.rig.group);

    this.peakMarker = new THREE.Mesh(
      new THREE.ConeGeometry(0.3, 0.7, 10),
      new THREE.MeshBasicMaterial({ color: 0xe04040, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.peakMarker.rotation.x = Math.PI;
    const pocketGeo = new THREE.BoxGeometry(POCKET_WIDTH, 0.06, 0.6);
    const pocketMat = new THREE.MeshBasicMaterial({ color: 0x40e070, transparent: true, opacity: 0.3, depthWrite: false });
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
    this.lens.resize(w, h);
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
    this.applyLight();
  }

  /** Sky, sun and ambient for the current spot at the session's time of day. */
  private applyLight(): void {
    const hour = this.conditions.hour;
    this.skyDome.apply(this.spot.water, this.scene, this.sun, hour);
    const low = sunLow(hour);
    const up = Math.sin(THREE.MathUtils.degToRad(sunElevation(hour)));
    const sky = new THREE.Color(this.spot.water.sky);
    this.hemi.color.set(sky).lerp(new THREE.Color(0xffffff), 0.5).lerp(new THREE.Color(0xf0b890), 0.35 * low);
    this.hemi.groundColor.set(this.spot.water.deep).multiplyScalar(0.7);
    this.hemi.intensity = 0.7 + 0.3 * up;
    this.renderer.toneMappingExposure = 1.05 * (0.9 + 0.15 * up);
    this.sea.setSun(this.skyDome.sunDir, sunColor(hour), low);
  }

  applySurfer(surfer: Surfer): void {
    this.surfer = surfer;
    const key = lookKey(surfer.look);
    if (key !== this.rigKey) {
      const old = this.rig;
      this.scene.remove(old.group);
      old.dispose();
      this.rig = new SurferRig(surfer.palette, surfer.look);
      this.rig.group.position.copy(old.group.position);
      this.rig.group.quaternion.copy(old.group.quaternion);
      this.scene.add(this.rig.group);
      this.rigKey = key;
    } else {
      this.rig.setPalette(surfer.palette);
    }
  }

  start(): void {
    this.phase = 'waiting';
    seedRng(`${this.seed}:${this.spot.name}:${this.preset}`);
    this.conditions = rollConditions(this.preset);
    this.scheduler.reset(this.conditions);
    this.sea.patches.clear();
    this.lens.clear();
    this.applyLight();
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
    this.hud.flash(tr('Paddle into position and wait for the set. Today: {conds} · session {seed}.', { conds: describeConditions(this.conditions), seed: this.seed }), 6000);
  }

  /** Back to the start screen (from settings); the next paddle-out starts a fresh run. */
  toStart(): void {
    this.phase = 'start';
    this.startView = 'surfer';
    this.ride = null;
    this.end = null;
    this.hud.hideEnd();
    this.rig.resetWipeout();
    this.x = 0;
    this.z = LINEUP_Z;
    this.vx = 0;
    this.vz = 0;
    this.heading = Math.PI;
    this.stance = 0;
    this.wake.clear();
  }

  update(dt: number): void {
    dt = Math.min(dt, 0.05);
    const input = this.input;
    if (input.wasPressed('KeyH')) this.setHint(!this.hint);

    this.t += dt;
    this.scheduler.update(this.t);

    switch (this.phase) {
      case 'start':
        this.idleT += dt;
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
    this.sea.update(this.scheduler.waves, this.t, this.spot, this.wake.points, dt, {
      x: this.conditions.current + 0.04 * this.conditions.windX,
      z: 0.04 * this.conditions.windZ,
    });
    this.skyDome.update(this.t);
    this.lips.update(this.scheduler.waves, this.t, this.spot, dt, this.camPos);
    if (this.lips.lensHits > 0) this.lens.splash(Math.min(4, this.lips.lensHits));
    this.placeRig();
    this.updateHints();
    this.updateCamera(dt);
    this.sea.setCamera(this.camera);
    this.lens.update(dt);
    this.renderer.render(this.scene, this.camera);
    this.lens.draw();
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
      if (w.isSet) this.hud.flash(tr('Too far out on the shoulder, no push there.'));
      else this.hud.flash(tr('Just a small one, it rolled under you.'));
      return;
    }
    this.wavesSeen++;
    const off = pocketOffset(w, this.x, t, this.spot);
    const dx = this.x - w.peakX;
    const side: 1 | -1 = w.peel !== 0 ? w.peel : dx >= 0 ? 1 : -1;
    const speed = Math.hypot(this.vx, this.vz);
    const stopped = speed < 0.4;
    if (off < 1.2) {
      // In the impact zone: under the lip at the peak, or in the whitewater behind it.
      const broken = brokenAmount(w, this.x, t, this.spot);
      const foamAge = broken > 0.5 ? brokenAge(w, this.x, t, this.spot) : 0;
      const foamHeight = h * (1 - 0.35 * broken);
      const noseIn = this.vz < 0;
      if (broken > 0.5 && foamAge > FOAM_SOFT_AGE) {
        this.hud.flash(tr('Old foam, it just rolled under you.'));
        return;
      }
      const shove = (msg: string) => {
        this.hud.flash(msg);
        this.vz += 1.2 + foamHeight;
        this.fatigue = Math.min(1, this.fatigue + 0.06);
        this.lens.splash(3, false);
      };
      if (stopped) this.hud.flash(tr('Sitting still when it broke on you.'));
      else if (Math.abs(this.vx) >= Math.abs(this.vz)) this.hud.flash(tr('Sideways in the impact zone. Over you go.'));
      else if (broken > 0.5) {
        if (foamHeight < FOAM_PUNCH_HEIGHT) {
          shove(tr(noseIn ? 'Punched through the foam.' : 'The foam shoved you toward the beach.'));
          return;
        }
        this.hud.flash(tr('Too much foam to punch through.'));
      } else if (noseIn) this.hud.flash(tr('Nose straight into the lip. Over the falls.'));
      else {
        shove(tr('The lip landed behind you and shoved you in.'));
        return;
      }
      this.endRide('peak', w);
      return;
    }
    if (off < POCKET_WIDTH) {
      if (stopped) {
        this.hud.flash(tr('Sitting still as the pocket arrived. It threw you.'));
        this.endRide('peak', w);
        return;
      }
      if (this.vx * side < -0.8) {
        this.hud.flash(tr('In the pocket but paddling into the peak. Wave lost.'));
        return;
      }
      if (crestZAt(w, this.x, t) < w.breakZ - 4) {
        this.hud.flash(tr('Too early, it was not steep enough yet.'));
        return;
      }
      this.startRide(w, side);
      return;
    }
    if (off < POCKET_WIDTH + 10) this.hud.flash(tr('Too far on the shoulder, it passed under you.'));
    else this.hud.flash(tr('Missed it, too far from the peak.'));
  }

  private startRide(w: Wave, dir: 1 | -1): void {
    this.phase = 'riding';
    this.ride = { wave: w, dir, rel: 0.3, theta: 0.45, time: 0, points: 0, lean: 0 };
    this.stance = 0;
    this.caught++;
    this.hud.flash(tr(dir === 1 ? 'Got it! Riding →' : 'Got it! Riding ←'), 2000);
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
      if (ahead) this.hud.flash(tr('It closed out in front of you.'));
      else this.hud.flash(tr('The foam caught up with you.'));
      this.endRide(ahead ? 'closeout' : 'caught', w);
      return;
    }
    if (r.rel < -0.15) {
      this.hud.flash(tr('You went over the back. Wave lost.'));
      this.endRide('overback', w);
      return;
    }
    if (H < 0.35) {
      this.hud.flash(tr('The wave faded out. Nice ride!'));
      this.endRide('faded', w);
    }
  }

  private endRide(reason: EndReason, wave: Wave): void {
    const wipeout = WIPEOUTS.includes(reason);
    if (wipeout) this.lens.splash(9, true);
    const points = reason === 'peak' ? 0 : Math.round((this.ride?.points ?? 0) * 10 * (wipeout ? 0.5 : 1));
    this.score += points;
    this.fatigue = Math.min(1, this.fatigue + (wipeout ? 0.3 : 0.1));
    this.end = { reason, points, t: this.t, wave };
    this.phase = 'ended';
    const run = wipeout ? { waves: this.caught, points: this.score, spot: this.spot.name, seed: this.seed } : null;
    this.hud.showEnd(reason, points, this.ride?.time ?? 0, run);
  }

  // ---------------------------------------------------------------- phase 3/4

  private updateEnded(dt: number): void {
    const e = this.end;
    if (!e) return;
    const age = this.t - e.t;
    const wipeout = WIPEOUTS.includes(e.reason);
    if (wipeout) {
      this.rig.setWipeout(Math.min(1, age / 0.6), age);
      if (e.wave) this.z += e.wave.speed * 0.5 * dt;
      this.vx *= 0.9;
    } else {
      this.vx *= 0.97;
      this.x += this.vx * dt;
      this.vz = Math.max(0, this.vz - 3 * dt);
      this.z += this.vz * dt;
    }
    if (age > 1.2 && !this.hud.awaitingName && (this.input.anyPressed() || (this.hud.quickRestart && age > 2.5))) this.resetToLineup();
  }

  private resetToLineup(): void {
    if (this.end && WIPEOUTS.includes(this.end.reason)) {
      this.score = 0;
      this.caught = 0;
    }
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
    this.hud.flash(tr('Back in the lineup.'), 2500);
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
    // Eyes on the wave: down the line at the breaking section while riding, at the next set wave while waiting.
    let lookYaw = 0;
    let lookPitch = 0;
    let turn = 0;
    if (riding && this.ride) {
      lookYaw = Math.atan2(this.ride.dir * 6, -3) - this.heading;
      lookPitch = -0.15;
      turn = -this.ride.lean / 0.35;
    } else if (this.phase === 'waiting') {
      const next = this.scheduler.nextSetWave(t, this.z);
      if (next) {
        lookYaw = Math.atan2(next.peakX - this.x, crestZAt(next, this.x, t) - this.z) - this.heading;
        lookPitch = 0.05;
      }
    }
    let idle = 0;
    if (this.phase === 'start') {
      idle = this.idleT;
      // Eyes roughly on the preview camera (off the nose at about 0.48 rad), wandering a little.
      lookYaw = this.startView === 'surfer' ? 0.48 + 0.18 * Math.sin(0.37 * idle) : 0.3 * Math.sin(0.23 * idle);
      lookPitch = 0.04 * Math.sin(0.53 * idle);
    }
    this.rig.pose(this.stance, stroke, Math.min(1, crouch), riding && this.ride ? (-this.ride.dir as 1 | -1) : this.paddleSide, lookYaw, lookPitch, turn, idle);
  }

  setHint(on: boolean): void {
    this.hint = on;
    localStorage.setItem(HINTS_KEY, on ? '1' : '0');
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
    const topY = localHeight(w, w.peakX, this.t) + 0.7;
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
    } else if (this.phase === 'start' && this.startView === 'surfer') {
      // Three-quarter view from the front, knees up, the face near the top third so the pickers fit around it.
      const portrait = Math.max(1, 0.95 / this.camera.aspect);
      const dist = 2.1 * Math.pow(portrait, 0.6);
      const g = this.rig.group.position;
      tp.set(this.x - 0.5 * dist, g.y + 1.65, this.z - 0.95 * dist);
      tl.set(this.x + 0.04 * dist, g.y + 1.38 + 0.3 * (portrait - 1), this.z + 0.1);
    } else {
      tp.set(this.x, 6.5, this.z + 15);
      tl.set(this.x, 2.5, this.z - 26);
    }
    const k = this.camSnap ? 1 : 1 - Math.exp(-3 * dt);
    this.camSnap = false;
    this.camPos.lerp(tp, k);
    this.camLook.lerp(tl, k);
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  /** Label for the HUD: what is coming. */
  setLabel(): string {
    if (this.ride) {
      const w = this.ride.wave;
      return tr('Riding set wave {i}/{n} · {h} m here', { i: w.setIndex, n: w.setSize, h: localHeight(w, this.x, this.t).toFixed(1) });
    }
    const tide = `${tr('tide')} ${tideRising(this.conditions, this.t) ? '↑' : '↓'}`;
    const next = this.scheduler.nextSetWave(this.t, this.z);
    if (next) {
      const dist = Math.round(this.z - crestZAt(next, this.x, this.t));
      const kind = next.hollow < 0.55 ? tr('spilling') : next.hollow > 0.8 ? tr('hollow') : '';
      const extra = [kind, next.reform ? tr('reform') : '', tide].filter(Boolean).join(' · ');
      return tr('Set wave {i}/{n} · {h} m · {peel} · {dist} m out · {extra}', { i: next.setIndex, n: next.setSize, h: next.height.toFixed(1), peel: peelLabel(next), dist, extra });
    }
    return `${tr(this.scheduler.modeLabel === 'set' ? 'Set wave on the way' : 'Lull. Small waves, the set is coming.')} · ${tide}`;
  }
}

function lerpAngle(a: number, b: number, k: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * k;
}
