// Water droplets on the camera lens: added when spray hits the camera or on a wipeout, they
// sit a moment, then slide down and fade.

interface Drop {
  x: number;
  y: number;
  r: number;
  life: number;
  age: number;
  vy: number;
  wob: number;
}

const MAX_DROPS = 36;

export class LensDrops {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly canvas: HTMLCanvasElement;
  private drops: Drop[] = [];
  private w = 1;
  private h = 1;
  private dpr = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2d canvas unavailable');
    this.ctx = ctx;
  }

  resize(w: number, h: number): void {
    this.w = w;
    this.h = h;
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * this.dpr);
    this.canvas.height = Math.round(h * this.dpr);
  }

  /** Add n droplets; big ones for a dunking, fine ones for blown spray. */
  splash(n: number, big = false): void {
    for (let i = 0; i < n && this.drops.length < MAX_DROPS; i++) {
      const r = big ? 5 + Math.random() * 9 : 2 + Math.random() * 4;
      this.drops.push({
        x: Math.random() * this.w,
        y: Math.random() * this.h * 0.9,
        r,
        life: 3 + Math.random() * 4,
        age: 0,
        vy: 0,
        wob: Math.random() * 6.28,
      });
    }
  }

  clear(): void {
    this.drops.length = 0;
  }

  update(dt: number): void {
    const keep: Drop[] = [];
    for (const d of this.drops) {
      d.age += dt;
      if (d.age > d.life) continue;
      if (d.age > 0.25 * d.life) d.vy += dt * (6 + d.r * 1.2);
      d.y += d.vy * dt;
      d.x += 0.3 * Math.sin(d.wob + 3 * d.age) * d.vy * dt;
      if (d.y < this.h + 40) keep.push(d);
    }
    this.drops = keep;
  }

  draw(): void {
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);
    if (this.drops.length === 0) return;
    for (const d of this.drops) {
      const t = d.age / d.life;
      const a = Math.min(1, d.age * 8) * (1 - t) * (1 - t);
      const stretch = 1 + Math.min(1.2, d.vy * 0.02);
      ctx.save();
      ctx.translate(d.x, d.y);
      ctx.scale(1, stretch);
      const g = ctx.createRadialGradient(-0.3 * d.r, -0.3 * d.r, 0, 0, 0, d.r);
      g.addColorStop(0, `rgba(255,255,255,${0.16 * a})`);
      g.addColorStop(0.7, `rgba(230,240,248,${0.05 * a})`);
      g.addColorStop(1, `rgba(255,255,255,${0.38 * a})`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255,255,255,${0.4 * a})`;
      ctx.beginPath();
      ctx.arc(-0.35 * d.r, -0.35 * d.r, 0.2 * d.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
}
