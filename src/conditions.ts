// Session conditions: swell angle, longshore current and wind. Rolled when a session starts.

export interface Conditions {
  /** Crest rotation (radians). Positive: the crest line sits further out to sea on the right. */
  angle: number;
  /** Longshore drift (m/s along x) that carries the paddler while waiting. */
  current: number;
  /** Wind (m/s). windZ < 0 is offshore (blowing from the beach out to sea), > 0 onshore. */
  windX: number;
  windZ: number;
}

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

function sign(): number {
  return Math.random() < 0.5 ? -1 : 1;
}

export function rollConditions(): Conditions {
  const angled = Math.random() < 0.35;
  const angle = (angled ? sign() * rand(0.1, 0.2) : rand(-0.05, 0.05));
  const current = Math.random() < 0.5 ? 0 : sign() * rand(0.2, 0.6);
  const w = Math.random();
  let windZ: number;
  if (w < 0.55) windZ = -rand(1.5, 6.5);
  else if (w < 0.8) windZ = rand(-0.8, 0.8);
  else windZ = rand(1.5, 4.5);
  const windX = rand(-2.5, 2.5);
  return { angle, current, windX, windZ };
}

export function windSpeed(c: Conditions): number {
  return Math.hypot(c.windX, c.windZ);
}

export function describeConditions(c: Conditions): string {
  const parts: string[] = [];
  const ws = windSpeed(c);
  if (ws < 1) parts.push('glassy, no wind');
  else {
    const strength = ws < 3 ? 'light' : ws < 5 ? 'moderate' : 'strong';
    parts.push(`${strength} ${c.windZ < 0 ? 'offshore' : 'onshore'} wind`);
  }
  if (Math.abs(c.angle) > 0.07) parts.push(`swell coming in at an angle from the ${c.angle > 0 ? 'left' : 'right'}`);
  if (c.current !== 0) parts.push(`current pulling ${c.current > 0 ? 'right' : 'left'}`);
  return parts.join(' · ');
}
