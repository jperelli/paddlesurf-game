export interface WaterPalette {
  sky: string;
  deep: string;
  face: string;
  foam: string;
  sand: string;
}

export interface SurferPalette {
  wetsuit: string;
  skin: string;
  board: string;
  boardAccent: string;
  paddle: string;
}

// Sampled from Julian's reference photo (olive-green water, black wetsuit, red board with yellow tail).
export const DEFAULT_WATER: WaterPalette = {
  sky: '#8eacc5',
  deep: '#535c74',
  face: '#5f5d44',
  foam: '#e9eae6',
  sand: '#c9b58a',
};

export const DEFAULT_SURFER: SurferPalette = {
  wetsuit: '#333237',
  skin: '#c9a07a',
  board: '#a22d3a',
  boardAccent: '#e0b23a',
  paddle: '#6a6a57',
};

export type PaletteKey = keyof WaterPalette | keyof SurferPalette;

export const WATER_KEYS: (keyof WaterPalette)[] = ['face', 'deep', 'foam', 'sky', 'sand'];
export const SURFER_KEYS: (keyof SurferPalette)[] = ['wetsuit', 'skin', 'board', 'boardAccent', 'paddle'];

export const KEY_LABELS: Record<PaletteKey, string> = {
  face: 'Wave face',
  deep: 'Deep water',
  foam: 'Foam',
  sky: 'Sky',
  sand: 'Sand',
  wetsuit: 'Wetsuit',
  skin: 'Skin',
  board: 'Board',
  boardAccent: 'Board accent',
  paddle: 'Paddle',
};

export function toHex(r: number, g: number, b: number): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Average colour of a square patch of an image drawn on a canvas. */
export function samplePatch(ctx: CanvasRenderingContext2D, x: number, y: number, radius = 5): string {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const x0 = Math.max(0, Math.floor(x - radius));
  const y0 = Math.max(0, Math.floor(y - radius));
  const x1 = Math.min(w, Math.ceil(x + radius));
  const y1 = Math.min(h, Math.ceil(y + radius));
  const data = ctx.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
  let r = 0;
  let g = 0;
  let b = 0;
  const n = data.length / 4;
  for (let i = 0; i < data.length; i += 4) {
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
  }
  return toHex(r / n, g / n, b / n);
}

/** Rough automatic guess: sky from the top band, deep water from the bottom band, face from the middle. */
export function autoWaterPalette(ctx: CanvasRenderingContext2D): Partial<WaterPalette> {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const band = (y0: number, y1: number) => {
    const data = ctx.getImageData(0, Math.floor(y0 * h), w, Math.max(1, Math.floor((y1 - y0) * h))).data;
    let r = 0;
    let g = 0;
    let b = 0;
    const n = data.length / 4;
    for (let i = 0; i < data.length; i += 4) {
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
    }
    return toHex(r / n, g / n, b / n);
  };
  return { sky: band(0, 0.08), face: band(0.4, 0.6), deep: band(0.8, 1) };
}
