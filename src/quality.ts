// Graphics quality: "low" halves the sea grid, spray pools and pixel ratio and uses a single ripple
// layer so phones keep a steady frame rate. Picked from ?q=, then the saved choice, else by device.

export type Quality = 'high' | 'low';

const KEY = 'paddlesurf.quality';

export function loadQuality(): Quality {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'low' || q === 'high') return q;
  const saved = localStorage.getItem(KEY);
  if (saved === 'low' || saved === 'high') return saved;
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  return coarse || Math.min(window.innerWidth, window.innerHeight) < 600 ? 'low' : 'high';
}

export function saveQuality(q: Quality): void {
  localStorage.setItem(KEY, q);
}

export function isSaved(): boolean {
  return localStorage.getItem(KEY) !== null;
}
