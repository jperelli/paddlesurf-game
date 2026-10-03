// Session conditions: swell angle, longshore current and wind. Rolled when a session starts.

/** A background swell train crossing the main one: long crests, its own angle and period. */
export interface SecondSwell {
  amp: number;
  /** Travel direction relative to straight-in (radians); positive heads towards +x. */
  angle: number;
  length: number;
  period: number;
}

import { random } from './rng';
import { t } from './i18n';

export type Preset = 'random' | 'glassy' | 'offshore' | 'onshore' | 'crosswind' | 'current';

export const PRESETS: { id: Preset; name: string; desc: string }[] = [
  { id: 'random', name: 'Whatever comes', desc: 'random conditions' },
  { id: 'glassy', name: 'Glassy', desc: 'no wind, no current' },
  { id: 'offshore', name: 'Offshore', desc: 'hollow waves, spray off the lip' },
  { id: 'onshore', name: 'Onshore', desc: 'crumbly, spilling waves' },
  { id: 'crosswind', name: 'Crosswind', desc: 'wind along the beach' },
  { id: 'current', name: 'Big current', desc: 'strong drift along the lineup' },
];

export interface Conditions {
  /** Crest rotation (radians). Positive: the crest line sits further out to sea on the right. */
  angle: number;
  /** Longshore drift (m/s along x) that carries the paddler while waiting. */
  current: number;
  /** Wind (m/s). windZ < 0 is offshore (blowing from the beach out to sea), > 0 onshore. */
  windX: number;
  windZ: number;
  /** Where in the tidal cycle the session starts (radians). */
  tidePhase: number;
  swell2: SecondSwell | null;
  /** Local time of day the session starts (hours, 7 to 19). */
  hour: number;
}

/** Tide period (s): short enough that the tide visibly moves during one session. */
const TIDE_PERIOD = 900;
/** How far (m) the break zone moves between low and high tide. */
const TIDE_RANGE = 7;

/** -1 (low) .. 1 (high). */
export function tideLevel(c: Conditions, t: number): number {
  return Math.sin(c.tidePhase + (2 * Math.PI * t) / TIDE_PERIOD);
}

/** Shoreward shift (m) of the break and fade lines: high tide breaks closer to the beach. */
export function tideShift(c: Conditions, t: number): number {
  return TIDE_RANGE * tideLevel(c, t);
}

export function tideRising(c: Conditions, t: number): boolean {
  return Math.cos(c.tidePhase + (2 * Math.PI * t) / TIDE_PERIOD) > 0;
}

/**
 * How hollow a wave breaks (0.3 crumbly spilling .. 1 plunging). Offshore wind holds the face up;
 * onshore wind makes it crumble early.
 */
export function rollHollow(c: Conditions): number {
  let base: number;
  if (c.windZ < -1) base = rand(0.8, 1);
  else if (c.windZ > 1) base = rand(0.3, 0.55);
  else base = rand(0.6, 0.9);
  return Math.min(1, Math.max(0.3, base + rand(-0.08, 0.08)));
}

function rand(a: number, b: number): number {
  return a + random() * (b - a);
}

function sign(): number {
  return random() < 0.5 ? -1 : 1;
}

export function rollConditions(preset: Preset = 'random'): Conditions {
  const angled = random() < 0.35;
  const angle = (angled ? sign() * rand(0.1, 0.2) : rand(-0.05, 0.05));
  const current = random() < 0.5 ? 0 : sign() * rand(0.2, 0.6);
  const w = random();
  let windZ: number;
  if (w < 0.55) windZ = -rand(1.5, 6.5);
  else if (w < 0.8) windZ = rand(-0.8, 0.8);
  else windZ = rand(1.5, 4.5);
  const windX = rand(-2.5, 2.5);
  const swell2: SecondSwell | null =
    random() < 0.55
      ? {
          amp: rand(0.15, 0.3),
          angle: (random() < 0.5 ? -1 : 1) * rand(0.35, 0.7),
          length: rand(22, 34),
          period: rand(7, 11),
        }
      : null;
  const hour = rand(7, 19);
  const c: Conditions = { angle, current, windX, windZ, tidePhase: rand(0, 2 * Math.PI), swell2, hour };
  applyPreset(c, preset);
  return c;
}

function applyPreset(c: Conditions, preset: Preset): void {
  switch (preset) {
    case 'glassy':
      c.windX = 0;
      c.windZ = 0;
      c.current = 0;
      break;
    case 'offshore':
      c.windZ = -rand(3, 5);
      c.windX = rand(-1, 1);
      break;
    case 'onshore':
      c.windZ = rand(3, 5);
      c.windX = rand(-1, 1);
      break;
    case 'crosswind':
      c.windX = sign() * rand(4, 6);
      c.windZ = rand(-1, 1);
      break;
    case 'current':
      c.current = sign() * rand(0.6, 0.9);
      c.windX *= 0.4;
      c.windZ *= 0.4;
      break;
    case 'random':
      break;
  }
}

export function windSpeed(c: Conditions): number {
  return Math.hypot(c.windX, c.windZ);
}

export function describeConditions(c: Conditions): string {
  const parts: string[] = [];
  const h = Math.floor(c.hour);
  const m = Math.floor((c.hour - h) * 60);
  const when = t(c.hour < 10 ? 'early light' : c.hour < 16 ? 'high sun' : 'evening light');
  parts.push(`${h}:${m < 10 ? '0' : ''}${m}, ${when}`);
  const ws = windSpeed(c);
  if (ws < 1) parts.push(t('glassy, no wind'));
  else {
    const strength = t(ws < 3 ? 'light' : ws < 5 ? 'moderate' : 'strong');
    parts.push(t('{strength} {dir} wind', { strength, dir: t(c.windZ < 0 ? 'offshore' : 'onshore') }));
  }
  if (Math.abs(c.angle) > 0.07) parts.push(t('swell coming in at an angle from the {side}', { side: t(c.angle > 0 ? 'left' : 'right') }));
  if (c.current !== 0) parts.push(t('current pulling {side}', { side: t(c.current > 0 ? 'right' : 'left') }));
  if (c.swell2) parts.push(t('a second swell crossing in from the {side}', { side: t(c.swell2.angle > 0 ? 'left' : 'right') }));
  if (c.windZ > 1) parts.push(t('crumbly, spilling waves'));
  else if (c.windZ < -1) parts.push(t('hollow plunging waves'));
  parts.push(t(tideRising(c, 0) ? 'tide rising' : 'tide dropping'));
  return parts.join(' · ');
}
