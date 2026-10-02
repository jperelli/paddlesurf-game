// Wave model: sets, peak/pockets, breaking fronts and the height field the sea mesh samples.

export interface BreakFront {
  x: number;
  startT: number;
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
}

export interface SpotConfig {
  name: string;
  minHeight: number;
  maxHeight: number;
  peelSpeed: number;
  sectionChance: number;
  peakRange: number;
  waveSpeed: number;
}

export const SPAWN_Z = -80;
export const BREAK_Z = -16;
export const FADE_Z = 28;
export const SHORE_Z = 52;
export const BEACH_Z = 58;
export const SMALL_WAVE_MAX = 0.5;

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

/** 0 = green face, 1 = whitewater. Soft 1.5 m edge. */
export function brokenAmount(w: Wave, x: number, t: number, spot: SpotConfig): number {
  let best = 0;
  const cz = crestZ(w, t);
  if (cz > FADE_Z + 4) best = Math.min(1, (cz - FADE_Z - 4) / 6);
  for (const f of w.fronts) {
    const r = spot.peelSpeed * (t - f.startT);
    const d = Math.abs(x - f.x) - r;
    const a = d <= 0 ? 1 : Math.max(0, 1 - d / 1.5);
    if (a > best) best = a;
  }
  return best;
}

/** Asymmetric profile across the travel direction. d > 0 is the shore side (steep face). */
export function profile(d: number, L: number): number {
  const s = d > 0 ? 0.55 * L : 1.6 * L;
  const u = d / s;
  return Math.exp(-u * u);
}

export function waveHeightAt(w: Wave, x: number, z: number, t: number, spot: SpotConfig): number {
  const cz = crestZ(w, t);
  const d = z - cz;
  const L = w.length;
  if (d > 3.5 * L || d < -5 * L) return 0;
  const h = localHeight(w, x, t);
  const broken = brokenAmount(w, x, t, spot);
  const amp = h * (1 - 0.35 * broken);
  return amp * profile(d, L);
}

export function chopAt(x: number, z: number, t: number): number {
  return (
    0.05 * Math.sin(0.9 * x + 1.3 * t) +
    0.04 * Math.sin(0.7 * z - 1.1 * t + 0.5 * x) +
    0.03 * Math.sin(1.9 * x - 0.6 * z + 2.1 * t)
  );
}

export function seaHeightAt(waves: Wave[], x: number, z: number, t: number, spot: SpotConfig): number {
  let h = chopAt(x, z, t);
  for (const w of waves) h += waveHeightAt(w, x, z, t, spot);
  return h;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}
function randInt(a: number, b: number): number {
  return Math.floor(rand(a, b + 1));
}

const RAMPS: Record<number, number[]> = {
  4: [0.75, 1.0, 0.95, 0.75],
  5: [0.7, 0.9, 1.0, 0.9, 0.72],
};

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
        w.fronts.push({ x: w.peakX, startT: t });
        w.nextSectionT = t + rand(3, 7);
      }
      if (w.isSet && w.fronts.length > 0 && t > w.nextSectionT && cz < FADE_Z) {
        w.nextSectionT = t + rand(3.5, 8);
        if (Math.random() < spot.sectionChance) {
          const half = brokenHalfWidth(w, t, spot);
          const side = Math.random() < 0.5 ? -1 : 1;
          w.fronts.push({ x: w.peakX + side * (half + rand(9, 22)), startT: t });
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
        this.setSize = randInt(4, 5);
        this.remaining = this.setSize;
        this.setIndex = 0;
        this.setBaseH = rand(spot.minHeight, spot.maxHeight);
        this.setPeakX = rand(-spot.peakRange, spot.peakRange);
        this.lastSetPeakX = this.setPeakX;
      } else {
        this.mode = 'lull';
        this.remaining = randInt(3, 7);
      }
    }
    let wave: Wave;
    if (this.mode === 'set') {
      const ramp = RAMPS[this.setSize][this.setIndex];
      const h = this.setBaseH * ramp * rand(0.9, 1.1);
      wave = this.makeWave(t, h, this.setPeakX + rand(-4, 4), true);
      wave.setIndex = this.setIndex + 1;
      wave.setSize = this.setSize;
      this.setIndex++;
      this.nextSpawnT = t + rand(7, 8.5);
    } else {
      const h = rand(0.2, 0.42);
      wave = this.makeWave(t, h, rand(-spot.peakRange, spot.peakRange), false);
      this.nextSpawnT = t + rand(4, 5.5);
    }
    this.remaining--;
    this.waves.push(wave);
  }

  private makeWave(t: number, height: number, peakX: number, isSet: boolean): Wave {
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
