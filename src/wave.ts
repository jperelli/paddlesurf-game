// Wave model: sets, peak/pockets, breaking fronts and the height field the sea mesh samples.

/** Which way a wave peels: 0 = A-frame (both pockets), 1 = rights only (+x), -1 = lefts only (-x). */
export type Peel = 0 | 1 | -1;

export interface BreakFront {
  x: number;
  startT: number;
  /** 0 breaks both ways from x; ±1 peels one way, everything behind it is whitewater. */
  dir: Peel;
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

export function fadeAt(z: number): number {
  if (z < FADE_Z) return 1;
  return Math.max(0, 1 - (z - FADE_Z) / (SHORE_Z - FADE_Z));
}

export function envelope(w: Wave, x: number): number {
  const u = (x - w.peakX) / w.shoulderWidth;
  return (0.35 + 0.65 * Math.exp(-u * u)) * Math.exp(-(u * u) / 9);
}

export function localHeight(w: Wave, x: number, t: number): number {
  return w.height * envelope(w, x) * fadeAt(crestZ(w, t));
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

/** 0 = green face, 1 = whitewater. Soft 1.5 m edge. */
export function brokenAmount(w: Wave, x: number, t: number, spot: SpotConfig): number {
  let best = 0;
  const cz = crestZ(w, t);
  if (cz > FADE_Z + 4) best = Math.min(1, (cz - FADE_Z - 4) / 6);
  for (const f of w.fronts) {
    const r = spot.peelSpeed * (t - f.startT);
    const d = (f.dir === 0 ? Math.abs(x - f.x) : (x - f.x) * f.dir) - r;
    const a = d <= 0 ? 1 : Math.max(0, 1 - d / 1.5);
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
  const cz = crestZ(w, t);
  const ramp = smoothstep(BREAK_Z - 14, BREAK_Z + 1, cz) * fadeAt(cz);
  if (ramp <= 0) return 0;
  const dx = pocketOffset(w, x, t, spot);
  const lateral = dx <= CURL_WIDTH ? 1 : 0.35 + 0.65 * Math.exp(-(((dx - CURL_WIDTH) / 10) ** 2));
  return ramp * lateral;
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
  const cz = crestZ(w, t);
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
  lastSetPeakX = 0;

  spot: SpotConfig;

  constructor(spot: SpotConfig) {
    this.spot = spot;
    this.setPeakX = rand(-spot.peakRange, spot.peakRange);
  }

  reset(): void {
    this.waves = [];
    this.mode = 'lull';
    this.remaining = 2;
    this.nextSpawnT = 1.5;
  }

  get modeLabel(): string {
    return this.mode;
  }

  update(t: number): void {
    const spot = this.spot;
    if (t >= this.nextSpawnT) {
      this.spawn(t);
    }
    for (const w of this.waves) {
      const cz = crestZ(w, t);
      if (w.isSet && w.fronts.length === 0 && cz >= BREAK_Z) {
        w.fronts.push({ x: w.peakX, startT: t, dir: w.peel });
        w.nextSectionT = t + rand(3, 7);
      }
      if (w.isSet && w.fronts.length > 0 && t > w.nextSectionT && cz < FADE_Z) {
        w.nextSectionT = t + rand(3.5, 8);
        if (Math.random() < spot.sectionChance) {
          const half = brokenHalfWidth(w, t, spot);
          const side = w.peel !== 0 ? w.peel : Math.random() < 0.5 ? -1 : 1;
          w.fronts.push({ x: w.peakX + side * (half + rand(9, 22)), startT: t, dir: 0 });
        }
      }
    }
    this.waves = this.waves.filter((w) => crestZ(w, t) < BEACH_Z + 6);
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
