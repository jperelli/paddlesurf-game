/** Tileable value-noise fbm on the unit square, in [0, 1]. Each octave wraps at its own frequency so the result tiles. */
export function tileableFbm(seed: number, baseFreq = 2, octaves = 5): (u: number, v: number) => number {
  const grid = baseFreq << (octaves - 1);
  const rand = new Float32Array(grid * grid);
  let s = seed;
  for (let i = 0; i < rand.length; i++) {
    s = (s * 16807) % 2147483647;
    rand[i] = s / 2147483647;
  }
  const noise = (u: number, v: number, f: number): number => {
    const at = (x: number, z: number) => rand[(((z % f) + f) % f) * grid + (((x % f) + f) % f)];
    const gx = u * f;
    const gz = v * f;
    const x0 = Math.floor(gx);
    const z0 = Math.floor(gz);
    const tx = gx - x0;
    const tz = gz - z0;
    const sx = tx * tx * (3 - 2 * tx);
    const sz = tz * tz * (3 - 2 * tz);
    const a = at(x0, z0);
    const b = at(x0 + 1, z0);
    const c = at(x0, z0 + 1);
    const d = at(x0 + 1, z0 + 1);
    return (a + (b - a) * sx) * (1 - sz) + (c + (d - c) * sx) * sz;
  };
  return (u, v) => {
    let n = 0;
    let amp = 0.5;
    let f = baseFreq;
    for (let o = 0; o < octaves; o++) {
      n += amp * noise(u, v, f);
      amp *= 0.5;
      f *= 2;
    }
    return n;
  };
}
