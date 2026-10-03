// The look selector: three faces, body shapes, boards and paddles. Each surfer picks one of each;
// the face can also be a photo (stored as a small data URL) painted onto the front of the head.

export interface Look {
  face: number;
  body: number;
  board: number;
  paddle: number;
  facePhoto: string | null;
}

export function defaultLook(i: number): Look {
  const k = ((i % 3) + 3) % 3;
  return { face: k, body: k, board: k, paddle: k, facePhoto: null };
}

export const DEFAULT_LOOK: Look = defaultLook(0);

export function lookKey(l: Look): string {
  return `${l.face}/${l.body}/${l.board}/${l.paddle}/${l.facePhoto ?? ''}`;
}

export interface FaceSpec {
  name: string;
  desc: string;
  brow: number;
  browTilt: number;
  iris: string;
  smile: number;
  beard: number;
  fringe: number;
  /** Hair cap: scale, tilt and how far down the sides it reaches (sphere theta length). */
  hair: { scale: [number, number, number]; rot: number; theta: number } | null;
}

export const FACES: FaceSpec[] = [
  { name: 'Clean shaven', desc: 'short hair', brow: 0.02, browTilt: 0, iris: '#5a3a22', smile: 0.02, beard: 0, fringe: 0.1, hair: { scale: [0.84, 1.02, 0.95], rot: -0.4, theta: 0.6 } },
  { name: 'Stubble', desc: 'longer hair', brow: 0.018, browTilt: -0.01, iris: '#3f6b4a', smile: 0.05, beard: 0.35, fringe: 0.2, hair: { scale: [0.9, 1.06, 1.0], rot: -0.15, theta: 0.78 } },
  { name: 'Full beard', desc: 'shaved head', brow: 0.028, browTilt: 0.012, iris: '#35414f', smile: 0.0, beard: 0.85, fringe: 0, hair: null },
];

export interface BodySpec {
  name: string;
  desc: string;
  width: number;
  torso: number;
  belly: number;
  shoulder: number;
}

export const BODIES: BodySpec[] = [
  { name: 'Athletic', desc: 'the paddler in the photo', width: 1, torso: 1, belly: 0, shoulder: 1 },
  { name: 'Slim', desc: 'narrow shoulders, thin limbs', width: 0.88, torso: 0.9, belly: 0, shoulder: 0.94 },
  { name: 'Stocky', desc: 'broad, a bit of belly', width: 1.15, torso: 1.18, belly: 0.028, shoulder: 1.08 },
];

export interface BoardSpec {
  name: string;
  desc: string;
  nose: number;
  tail: number;
  halfW: number;
  /** 0 round nose, 1 pointed touring nose. */
  pointy: number;
  tailShape: 'round' | 'squash' | 'pin';
  rocker: number;
  fins: 1 | 3;
  deck: number;
}

export const BOARDS: BoardSpec[] = [
  { name: "All-round 10'6", desc: 'round nose, single fin, striped deck', nose: 1.5, tail: -1.3, halfW: 0.39, pointy: 0, tailShape: 'round', rocker: 1, fins: 1, deck: 0 },
  { name: "Touring 12'6", desc: 'long pointed nose, squash tail', nose: 1.75, tail: -1.4, halfW: 0.34, pointy: 1, tailShape: 'squash', rocker: 0.7, fins: 1, deck: 1 },
  { name: "Surf SUP 9'", desc: 'short and wide, pin tail, thruster', nose: 1.3, tail: -1.2, halfW: 0.42, pointy: 0.5, tailShape: 'pin', rocker: 1.5, fins: 3, deck: 2 },
];

export interface PaddleSpec {
  name: string;
  desc: string;
  shaftR: number;
  bladeW: number;
  bladeLen: number;
  grip: 't' | 'palm';
  collar: boolean;
}

export const PADDLES: PaddleSpec[] = [
  { name: 'Carbon', desc: 'thin shaft, teardrop blade, T-grip', shaftR: 0.016, bladeW: 1, bladeLen: 0.46, grip: 't', collar: false },
  { name: 'Wood', desc: 'thick shaft, wide blade, palm grip', shaftR: 0.019, bladeW: 1.28, bladeLen: 0.5, grip: 'palm', collar: false },
  { name: 'Alloy', desc: 'adjustable shaft, narrow long blade', shaftR: 0.017, bladeW: 0.84, bladeLen: 0.54, grip: 't', collar: true },
];

function hexAlpha(hex: string, a: number): string {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

/** Paints the face texture: a photo (mirrored, centre-cropped) or a drawn face using the palette's skin and hair. */
export function paintFace(ctx: CanvasRenderingContext2D, variant: number, skin: string, hair: string, photo: HTMLImageElement | null): void {
  const W = ctx.canvas.width;
  const H = ctx.canvas.height;
  ctx.clearRect(0, 0, W, H);
  if (photo && photo.width > 0) {
    // Skin under the photo so a cut-out face (transparent around the oval) blends into the head.
    ctx.fillStyle = skin;
    ctx.fillRect(0, 0, W, H);
    const s = Math.min(photo.width, photo.height);
    ctx.save();
    ctx.translate(W, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(photo, (photo.width - s) / 2, (photo.height - s) / 2, s, s, 0, 0, W, H);
    ctx.restore();
    return;
  }
  const f = FACES[variant] ?? FACES[0];
  ctx.fillStyle = skin;
  ctx.fillRect(0, 0, W, H);
  const g = ctx.createLinearGradient(0, 0, W, 0);
  g.addColorStop(0, 'rgba(0,0,0,0.22)');
  g.addColorStop(0.25, 'rgba(0,0,0,0)');
  g.addColorStop(0.75, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.22)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  if (f.beard > 0) {
    ctx.fillStyle = hexAlpha(hair, f.beard);
    ctx.beginPath();
    ctx.moveTo(W * 0.1, H * 0.52);
    ctx.quadraticCurveTo(W * 0.14, H * 0.95, W * 0.5, H);
    ctx.quadraticCurveTo(W * 0.86, H * 0.95, W * 0.9, H * 0.52);
    ctx.quadraticCurveTo(W * 0.75, H * 0.62, W * 0.5, H * 0.63);
    ctx.quadraticCurveTo(W * 0.25, H * 0.62, W * 0.1, H * 0.52);
    ctx.fill();
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.73, W * 0.13, H * 0.045, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = hexAlpha(hair, Math.min(1, f.beard + 0.1));
    ctx.beginPath();
    ctx.ellipse(W * 0.5, H * 0.665, W * 0.15, H * 0.028, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.lineCap = 'round';
  ctx.strokeStyle = hair;
  ctx.lineWidth = H * f.brow;
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(W * (0.5 + sx * 0.12), H * 0.31);
    ctx.lineTo(W * (0.5 + sx * 0.3), H * (0.295 + f.browTilt));
    ctx.stroke();
  }
  for (const sx of [-1, 1]) {
    const ex = W * (0.5 + sx * 0.2);
    const ey = H * 0.4;
    ctx.fillStyle = '#f3efe8';
    ctx.beginPath();
    ctx.ellipse(ex, ey, W * 0.075, H * 0.04, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = f.iris;
    ctx.beginPath();
    ctx.arc(ex, ey, W * 0.034, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath();
    ctx.arc(ex, ey, W * 0.016, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.beginPath();
    ctx.arc(ex - W * 0.01, ey - H * 0.012, W * 0.007, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = 'rgba(40,25,20,0.7)';
    ctx.lineWidth = H * 0.008;
    ctx.beginPath();
    ctx.ellipse(ex, ey, W * 0.075, H * 0.04, 0, Math.PI, Math.PI * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = 'rgba(0,0,0,0.18)';
  ctx.lineWidth = W * 0.02;
  ctx.beginPath();
  ctx.moveTo(W * 0.47, H * 0.44);
  ctx.lineTo(W * 0.45, H * 0.57);
  ctx.quadraticCurveTo(W * 0.5, H * 0.62, W * 0.56, H * 0.57);
  ctx.stroke();
  ctx.strokeStyle = '#6e4035';
  ctx.lineWidth = H * 0.018;
  ctx.beginPath();
  ctx.moveTo(W * 0.4, H * 0.73);
  ctx.quadraticCurveTo(W * 0.5, H * (0.73 + f.smile), W * 0.6, H * 0.73);
  ctx.stroke();
  ctx.fillStyle = 'rgba(170,90,80,0.5)';
  ctx.beginPath();
  ctx.ellipse(W * 0.5, H * 0.755, W * 0.085, H * 0.016, 0, 0, Math.PI * 2);
  ctx.fill();
  if (f.fringe > 0) {
    ctx.fillStyle = hair;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(W, 0);
    ctx.lineTo(W, H * f.fringe * 0.6);
    ctx.quadraticCurveTo(W * 0.5, H * f.fringe * 1.5, 0, H * f.fringe * 0.6);
    ctx.fill();
  }
}

/** Centre-crops an uploaded image to a small square JPEG data URL so it fits in localStorage. */
export function photoToDataUrl(img: HTMLImageElement, size = 256): string {
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const ctx = c.getContext('2d')!;
  const s = Math.min(img.width, img.height);
  ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size);
  return c.toDataURL('image/jpeg', 0.85);
}
