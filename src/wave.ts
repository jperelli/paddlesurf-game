// Wave model: sets, peak/pockets, breaking fronts and the height field the sea mesh samples.

import { rollHollow, tideShift, type Conditions } from './conditions';

/** Which way a wave peels: 0 = A-frame (both pockets), 1 = rights only (+x), -1 = lefts only (-x). */
export type Peel = 0 | 1 | -1;

export interface BreakFront {
  x: number;
  startT: number;
  /** 0 breaks both ways from x; ±1 peels one way, everything behind it is whitewater. */
  dir: Peel;
}

/** A deep stretch where the wave backs off, goes green again and re-breaks past it. */
export interface Reform {
  z0: number;
  z1: number;
}

export interface Wave {
  id: number;
  height: number;
  peakX: number;
  z0: number;
  t0: number;
  speed: number;
  length: number;
  shoulderWidth: number;
  isSet: boolean;
  setIndex: number;
  setSize: number;
  fronts: BreakFront[];
  nextSectionT: number;
  passedSurfer: boolean;
  peel: Peel;
  /** Crest rotation about the peak (radians): the crest at x sits at crestZ + tan(angle) * (x - peakX). */
  angle: number;
  /** Where this wave starts breaking and where it fades: BREAK_Z / FADE_Z shifted by the tide. */
  breakZ: number;
  fadeZ: number;
  /** 0.3 = crumbly spilling wave, 1 = hollow plunging wave. */
  hollow: number;
  reform: Reform | null;
}

export interface SpotConfig {
  name: string;
  minHeight: number;
  maxHeight: number;
  peelSpeed: number;
  sectionChance: number;
  peakRange: number;
  waveSpeed: number;
  /** Share of set waves that peel only right / only left; the rest are A-frames. */
  rightOnly: number;
  leftOnly: number;
  /** Small waves per lull and big waves per set. */
  lullMin: number;
  lullMax: number;
  setMin: number;
  setMax: number;
}

export const SPAWN_Z = -80;
export const BREAK_Z = -16;
export const FADE_Z = 28;
export const SHORE_Z = 52;
export const BEACH_Z = 58;
export const SMALL_WAVE_MAX = 0.5;
/** Width (m) of the curling lip zone next to the whitewater: the pocket. */
export const CURL_WIDTH = 9;

export interface SeaPoint {
  y: number;
  z: number;
}

function smoothstep(a: number, b: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

export function crestZ(w: Wave, t: number): number {
  return w.z0 + w.speed * (t - w.t0);
}

/** Crest position at x for a wave arriving at an angle. */
export function crestZAt(w: Wave, x: number, t: number): number {
  return crestZ(w, t) + Math.tan(w.angle) * (x - w.peakX);
}

/** How far (m) an angled crest can be ahead of or behind its peak anywhere on the sea mesh. */
export function crestSkew(w: Wave, halfWidth: number): number {
  return Math.abs(Math.tan(w.angle)) * (halfWidth + Math.abs(w.peakX));
}

/** Ragged edge of the whitewater: the foam line wanders along the crest and in time. */
export function foamEdgeWobble(x: number, t: number, seed: number): number {
  return (
    1.1 * Math.sin(0.9 * x + 1.7 * t + seed) +
    0.6 * Math.sin(2.3 * x - 1.1 * t + 2 * seed) +
    0.35 * Math.sin(4.1 * x + 2.9 * t)
  );
}

export function fadeAt(w: Wave, z: number): number {
  if (z < w.fadeZ) return 1;
  return Math.max(0, 1 - (z - w.fadeZ) / (SHORE_Z - w.fadeZ));
}

/** 0 outside the deep section, 1 in the middle of it. */
export function reformAmount(w: Wave, cz: number): number {
  const r = w.reform;
  if (!r) return 0;
  return smoothstep(r.z0, r.z0 + 4, cz) * (1 - smoothstep(r.z1 - 4, r.z1, cz));
}

export function envelope(w: Wave, x: number): number {
  const u = (x - w.peakX) / w.shoulderWidth;
  return (0.35 + 0.65 * Math.exp(-u * u)) * Math.exp(-(u * u) / 9);
}

export function localHeight(w: Wave, x: number, t: number): number {
  const cz = crestZAt(w, x, t);
  return w.height * envelope(w, x) * fadeAt(w, cz) * (1 - 0.4 * reformAmount(w, cz));
}

export function faceLength(h: number): number {
  return 1.6 + 2.2 * h;
}

export function brokenHalfWidth(w: Wave, t: number, spot: SpotConfig): number {
  if (w.fronts.length === 0) return 0;
  return spot.peelSpeed * (t - w.fronts[0].startT);
}

/**
 * Signed distance (m) from the edge of the whitewater out along the open face, on the side(s) the wave
 * peels to. Negative = already broken (or behind a one-way wave's peak).
 */
export function pocketOffset(w: Wave, x: number, t: number, spot: SpotConfig): number {
  const dx = x - w.peakX;
  return (w.peel === 0 ? Math.abs(dx) : dx * w.peel) - brokenHalfWidth(w, t, spot);
}

export function peelLabel(w: Wave): string {
  return w.peel === 1 ? 'right →' : w.peel === -1 ? '← left' : '← A-frame →';
}

/** 0 = green face, 1 = whitewater. Soft, ragged edge a couple of metres wide. */
export function brokenAmount(w: Wave, x: number, t: number, spot: SpotConfig): number {
  let best = 0;
  const cz = crestZAt(w, x, t);
  if (cz > w.fadeZ + 4) best = Math.min(1, (cz - w.fadeZ - 4) / 6);
  const alive = 1 - 0.92 * reformAmount(w, cz);
  const edge = 2.2 + 2.5 * (1 - w.hollow);
  for (const f of w.fronts) {
    const r = spot.peelSpeed * (t - f.startT) + foamEdgeWobble(x, t, f.startT);
    const d = (f.dir === 0 ? Math.abs(x - f.x) : (x - f.x) * f.dir) - r;
    const a = (d <= 0 ? 1 : Math.max(0, 1 - d / edge)) * alive;
    if (a > best) best = a;
  }
  return best;
}

/**
 * How hollow the wave is at x: 0 = rolling swell, 1 = standing-up, pitching face.
 * Set waves stand up as they reach the break zone; hollowest next to the whitewater (the pocket),
 * softer out on the shoulder.
 */
export function steepness(w: Wave, x: number, t: number, spot: SpotConfig): number {
  if (!w.isSet) return 0;
  const cz = crestZAt(w, x, t);
  const ramp = smoothstep(w.breakZ - 14, w.breakZ + 1, cz) * fadeAt(w, cz) * (1 - reformAmount(w, cz));
  if (ramp <= 0) return 0;
  const dx = pocketOffset(w, x, t, spot);
  const lateral = dx <= CURL_WIDTH ? 1 : 0.35 + 0.65 * Math.exp(-(((dx - CURL_WIDTH) / 10) ** 2));
  return ramp * lateral * w.hollow;
}

/** Asymmetric profile across the travel direction. d > 0 is the shore side (steep face). */
export function profile(d: number, L: number, steep = 0, broken = 0): number {
  if (d > 0) {
    const s = L * (0.55 - 0.22 * steep) * (1 + 0.5 * broken);
    const p = 2 + 1.6 * steep;
    return Math.exp(-((d / s) ** p));
  }
  const u = d / (1.6 * L);
  return Math.exp(-u * u);
}

/**
 * Displacement of the water at material position (x, z) from this wave: vertical rise plus a
 * forward (shoreward) lean so a hollow face stands up near-vertical and the whitewater runs ahead.
 */
export function waveDisplaceAt(w: Wave, x: number, z: number, t: number, spot: SpotConfig, out: SeaPoint): void {
  const cz = crestZAt(w, x, t);
  const d = z - cz;
  const L = w.length;
  if (d > 3.5 * L || d < -5 * L) return;
  const h = localHeight(w, x, t);
  const broken = brokenAmount(w, x, t, spot);
  const steep = steepness(w, x, t, spot) * (1 - broken);
  const amp = h * (1 - 0.35 * broken);
  const f = profile(d, L, steep, broken);
  let y = amp * f;
  if (broken > 0) y += broken * 0.12 * amp * Math.sin(2.7 * x + 6 * t) * Math.cos(1.9 * d - 4 * t);
  out.y += y;
  out.z += (0.7 * steep * amp + 0.9 * broken * amp) * f * f;
}

export function waveHeightAt(w: Wave, x: number, z: number, t: number, spot: SpotConfig): number {
  const p: SeaPoint = { y: 0, z: 0 };
  waveDisplaceAt(w, x, z, t, spot, p);
  return p.y;
}

export function chopAt(x: number, z: number, t: number): number {
  return (
    0.05 * Math.sin(0.9 * x + 1.3 * t) +
    0.04 * Math.sin(0.7 * z - 1.1 * t + 0.5 * x) +
    0.03 * Math.sin(1.9 * x - 0.6 * z + 2.1 * t)
  );
}

/** World-space surface point for material coordinates (x, z): height plus forward lean. */
export function seaPointAt(waves: Wave[], x: number, z: number, t: number, spot: SpotConfig, out: SeaPoint): SeaPoint {
  out.y = chopAt(x, z, t);
  out.z = z;
  for (const w of waves) waveDisplaceAt(w, x, z, t, spot, out);
  return out;
}

const _pt: SeaPoint = { y: 0, z: 0 };
export function seaHeightAt(waves: Wave[], x: number, z: number, t: number, spot: SpotConfig): number {
  return seaPointAt(waves, x, z, t, spot, _pt).y;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function randInt(a: number, b: number): number {
  return Math.floor(rand(a, b + 1));
}

/** Set waves build up and then tail off: wave i of n. */
function setRamp(i: number, n: number): number {
  return 0.7 + 0.3 * Math.sin((Math.PI * (i + 0.5)) / n);
}

function pickPeel(spot: SpotConfig): Peel {
  const r = Math.random();
  if (r < spot.rightOnly) return 1;
  if (r < spot.rightOnly + spot.leftOnly) return -1;
  return 0;
}

export class WaveScheduler {
  waves: Wave[] = [];
  private nextId = 1;
  private mode: 'lull' | 'set' = 'lull';
  private remaining = 2;
  private nextSpawnT = 1.5;
  private setBaseH = 1;
  private setPeakX = 0;
  private setSize = 5;
  private setIndex = 0;
  private lastT = 0;
  lastSetPeakX = 0;

  spot: SpotConfig;
  conditions: Conditions;

  constructor(spot: SpotConfig, conditions: Conditions) {
    this.spot = spot;
    this.conditions = conditions;
    this.setPeakX = rand(-spot.peakRange, spot.peakRange);
  }

  reset(conditions: Conditions): void {
    this.conditions = conditions;
    this.waves = [];
    this.mode = 'lull';
    this.remaining = 2;
    this.nextSpawnT = 1.5;
    this.lastT = 0;
  }

  get modeLabel(): string {
    return this.mode;
  }

  update(t: number): void {
    const spot = this.spot;
    const dt = Math.max(0, t - this.lastT);
    this.lastT = t;
    if (t >= this.nextSpawnT) {
      this.spawn(t);
    }
    for (const w of this.waves) {
      const cz = crestZ(w, t);
      if (w.isSet && w.fronts.length === 0 && cz >= w.breakZ) {
        w.fronts.push({ x: w.peakX, startT: t, dir: w.peel });
        w.nextSectionT = t + rand(3, 7);
      }
      // Over the deep section the whitewater stops advancing; it picks up again past it.
      const rf = reformAmount(w, cz);
      if (rf > 0) for (const f of w.fronts) f.startT += dt * rf;
      if (w.isSet && w.fronts.length > 0 && t > w.nextSectionT && cz < w.fadeZ) {
        w.nextSectionT = t + rand(3.5, 8);
        if (Math.random() < spot.sectionChance) {
          const half = brokenHalfWidth(w, t, spot);
          const side = w.peel !== 0 ? w.peel : Math.random() < 0.5 ? -1 : 1;
          w.fronts.push({ x: w.peakX + side * (half + rand(9, 22)), startT: t, dir: 0 });
        }
      }
    }
    this.waves = this.waves.filter((w) => crestZ(w, t) - crestSkew(w, 90) < BEACH_Z + 6);
  }

  private spawn(t: number): void {
    const spot = this.spot;
    if (this.remaining <= 0) {
      if (this.mode === 'lull') {
        this.mode = 'set';
        this.setSize = randInt(spot.setMin, spot.setMax);
        this.remaining = this.setSize;
        this.setIndex = 0;
        this.setBaseH = rand(spot.minHeight, spot.maxHeight);
        this.setPeakX = rand(-spot.peakRange, spot.peakRange);
        this.lastSetPeakX = this.setPeakX;
      } else {
        this.mode = 'lull';
        this.remaining = randInt(spot.lullMin, spot.lullMax);
      }
    }
    let wave: Wave;
    if (this.mode === 'set') {
      const ramp = setRamp(this.setIndex, this.setSize);
      const h = this.setBaseH * ramp * rand(0.9, 1.1);
      wave = this.makeWave(t, h, this.setPeakX + rand(-4, 4), true, pickPeel(spot));
      wave.setIndex = this.setIndex + 1;
      wave.setSize = this.setSize;
      this.setIndex++;
      this.nextSpawnT = t + rand(7, 8.5);
    } else {
      const h = rand(0.2, 0.42);
      wave = this.makeWave(t, h, rand(-spot.peakRange, spot.peakRange), false, 0);
      this.nextSpawnT = t + rand(4, 5.5);
    }
    this.remaining--;
    this.waves.push(wave);
  }

  private makeWave(t: number, height: number, peakX: number, isSet: boolean, peel: Peel): Wave {
    const shift = tideShift(this.conditions, t);
    const breakZ = BREAK_Z + shift;
    const fadeZ = FADE_Z + shift;
    let reform: Reform | null = null;
    if (isSet && height >= 0.9 && Math.random() < 0.25) {
      const z0 = breakZ + rand(8, 14);
      reform = { z0, z1: Math.min(fadeZ - 6, z0 + rand(8, 12)) };
    }
    return {
      id: this.nextId++,
      height,
      peakX,
      z0: SPAWN_Z,
      t0: t,
      speed: this.spot.waveSpeed,
      length: 2.2 + 1.6 * height,
      shoulderWidth: 14 + 6 * height,
      isSet,
      setIndex: 0,
      setSize: 0,
      fronts: [],
      nextSectionT: Infinity,
      passedSurfer: false,
      peel,
      angle: this.conditions.angle + rand(-0.03, 0.03),
      breakZ,
      fadeZ,
      hollow: isSet ? rollHollow(this.conditions) : 1,
      reform,
    };
  }

  /** Nearest set wave still out to sea of the given z. */
  nextSetWave(t: number, z: number): Wave | undefined {
    let best: Wave | undefined;
    let bestZ = -Infinity;
    for (const w of this.waves) {
      if (!w.isSet) continue;
      const cz = crestZ(w, t);
      if (cz < z && cz > bestZ) {
        best = w;
        bestZ = cz;
      }
    }
    return best;
  }
}
