// Foam left behind by broken waves: a coarse scalar field that fades over ~20 s and is carried by
// the current and the wind (semi-Lagrangian advection on a 2 m grid).

export const FOAM_LIFE = 20;

export class FoamField {
  private readonly cell: number;
  private readonly x0: number;
  private readonly z0: number;
  private readonly nx: number;
  private readonly nz: number;
  private a: Float32Array;
  private b: Float32Array;

  constructor(x0: number, x1: number, z0: number, z1: number, cell = 2) {
    this.cell = cell;
    this.x0 = x0;
    this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / cell) + 1;
    this.nz = Math.ceil((z1 - z0) / cell) + 1;
    this.a = new Float32Array(this.nx * this.nz);
    this.b = new Float32Array(this.nx * this.nz);
  }

  clear(): void {
    this.a.fill(0);
  }

  deposit(x: number, z: number, amount: number): void {
    const i = Math.round((x - this.x0) / this.cell);
    const j = Math.round((z - this.z0) / this.cell);
    if (i < 0 || j < 0 || i >= this.nx || j >= this.nz) return;
    const k = j * this.nx + i;
    this.a[k] = Math.min(1, this.a[k] + amount);
  }

  /** Bilinear sample of the field at world (x, z). */
  sample(x: number, z: number): number {
    const u = (x - this.x0) / this.cell;
    const v = (z - this.z0) / this.cell;
    const i = Math.floor(u);
    const j = Math.floor(v);
    if (i < 0 || j < 0 || i >= this.nx - 1 || j >= this.nz - 1) return 0;
    const fu = u - i;
    const fv = v - j;
    const a = this.a;
    const k = j * this.nx + i;
    const top = a[k] * (1 - fu) + a[k + 1] * fu;
    const bot = a[k + this.nx] * (1 - fu) + a[k + this.nx + 1] * fu;
    return top * (1 - fv) + bot * fv;
  }

  /** Fade and drift the whole field by (vx, vz) m/s. */
  step(dt: number, vx: number, vz: number): void {
    const decay = Math.exp(-dt / FOAM_LIFE);
    const du = (vx * dt) / this.cell;
    const dv = (vz * dt) / this.cell;
    const { a, b, nx, nz } = this;
    for (let j = 0; j < nz; j++) {
      const v = j - dv;
      const j0 = Math.floor(v);
      const fv = v - j0;
      for (let i = 0; i < nx; i++) {
        const u = i - du;
        const i0 = Math.floor(u);
        const fu = u - i0;
        let val = 0;
        if (i0 >= 0 && j0 >= 0 && i0 < nx - 1 && j0 < nz - 1) {
          const k = j0 * nx + i0;
          const top = a[k] * (1 - fu) + a[k + 1] * fu;
          const bot = a[k + nx] * (1 - fu) + a[k + nx + 1] * fu;
          val = top * (1 - fv) + bot * fv;
        }
        b[j * nx + i] = val * decay;
      }
    }
    this.a = b;
    this.b = a;
  }
}
