import {
  CASTELLDEFELS_WATER,
  CHICAMA_WATER,
  DEFAULT_SURFER,
  NAZARE_WATER,
  PRAIA_DO_ROSA_WATER,
  SAN_CLEMENTE_WATER,
  type SurferPalette,
  type WaterPalette,
} from './palette';
import type { SpotConfig } from './wave';
import { defaultLook, type Look } from './looks';

export interface Surfer {
  name: string;
  palette: SurferPalette;
  look: Look;
}

export interface Spot extends SpotConfig {
  water: WaterPalette;
  /** Photo for the start screen tile (under public/spots). */
  photo?: string;
}

export interface Roster {
  surfers: Surfer[];
  spots: Spot[];
  surferIndex: number;
  spotIndex: number;
}

const KEY = 'paddlesurf.roster.v7';

export function defaultRoster(): Roster {
  return {
    surfers: [
      { name: 'Alfredo', palette: { ...DEFAULT_SURFER, board: '#2f7fb8', boardNose: '#f4f4f4', boardTail: '#f4f4f4' }, look: { ...defaultLook(1), facePhoto: 'faces/alfredo.jpg' } },
      { name: 'Julian', palette: { ...DEFAULT_SURFER }, look: { ...defaultLook(0), facePhoto: 'faces/julian.jpg' } },
      { name: 'Ferchu', palette: { ...DEFAULT_SURFER, board: '#f0f0ea', boardNose: '#2aa4b5', boardTail: '#2aa4b5' }, look: { ...defaultLook(2), facePhoto: 'faces/ferchu.jpg' } },
      { name: 'el Tano', palette: { ...DEFAULT_SURFER, board: '#2e8b57', boardNose: '#f2c84b', boardTail: '#f2c84b', wetsuit: '#1d2a3a' }, look: { ...defaultLook(0), body: 2, facePhoto: 'faces/tano.jpg' } },
    ],
    spots: [
      {
        name: 'San Clemente del Tuyú',
        minHeight: 0.9,
        maxHeight: 1.3,
        peelSpeed: 3.0,
        sectionChance: 0.35,
        peakRange: 22,
        waveSpeed: 5.5,
        rightOnly: 0.2,
        leftOnly: 0.2,
        lullMin: 3,
        lullMax: 7,
        setMin: 4,
        setMax: 5,
        water: { ...SAN_CLEMENTE_WATER },
        photo: 'spots/sanclemente.jpg',
      },
      {
        name: 'Chicama, Peru',
        minHeight: 1.8,
        maxHeight: 2.6,
        peelSpeed: 3.4,
        sectionChance: 0.15,
        peakRange: 25,
        waveSpeed: 6,
        rightOnly: 1,
        leftOnly: 0,
        lullMin: 1,
        lullMax: 2,
        setMin: 8,
        setMax: 10,
        water: { ...CHICAMA_WATER },
        photo: 'spots/chicama.jpg',
      },
      {
        // Beach break, lefts and rights, 0.5–2.5 m, fast and powerful with sections and
        // barrels; the lefts at Rosa Norte are the longer, hollower ones. Very consistent.
        name: 'Praia do Rosa, Brazil',
        minHeight: 1.2,
        maxHeight: 2.0,
        peelSpeed: 3.8,
        sectionChance: 0.45,
        peakRange: 30,
        waveSpeed: 6,
        rightOnly: 0.3,
        leftOnly: 0.4,
        lullMin: 3,
        lullMax: 6,
        setMin: 4,
        setMax: 7,
        water: { ...PRAIA_DO_ROSA_WATER },
        photo: 'spots/rosa.jpg',
      },
      {
        // Praia do Norte: the submarine canyon focuses the swell into huge A-frame peaks, mostly ridden
        // as rights; fast, thick and heavy, with sets that stack up with little rest between them.
        name: 'Nazaré, Portugal',
        minHeight: 5,
        maxHeight: 8,
        peelSpeed: 5.5,
        sectionChance: 0.3,
        peakRange: 35,
        waveSpeed: 9,
        rightOnly: 0.5,
        leftOnly: 0.15,
        lullMin: 2,
        lullMax: 4,
        setMin: 3,
        setMax: 5,
        water: { ...NAZARE_WATER },
        photo: 'spots/nazare.jpg',
      },
      {
        // Mediterranean beach break: knee-to-waist-high windswell, slow and crumbly, closes out a lot.
        name: 'Castelldefels, Spain',
        minHeight: 0.55,
        maxHeight: 0.8,
        peelSpeed: 2.4,
        sectionChance: 0.5,
        peakRange: 18,
        waveSpeed: 4.5,
        rightOnly: 0.3,
        leftOnly: 0.3,
        lullMin: 4,
        lullMax: 8,
        setMin: 3,
        setMax: 4,
        water: { ...CASTELLDEFELS_WATER },
        photo: 'spots/castelldefels.jpg',
      },
    ],
    surferIndex: 1,
    spotIndex: 0,
  };
}

/** One-line description of a spot for the level picker. */
export function describeSpot(s: Spot): string {
  const dir = s.rightOnly >= 1 ? 'rights only' : s.leftOnly >= 1 ? 'lefts only' : 'lefts & rights';
  return `${s.minHeight.toFixed(1)}–${s.maxHeight.toFixed(1)} m · sets of ${s.setMin}–${s.setMax} · ${dir}`;
}

export function loadRoster(): Roster {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultRoster();
    const parsed = JSON.parse(raw) as Roster;
    if (!parsed.surfers?.length || !parsed.spots?.length) return defaultRoster();
    parsed.surfers.forEach((s, i) => {
      if (!s.look) s.look = defaultLook(i);
    });
    return parsed;
  } catch {
    return defaultRoster();
  }
}

export function saveRoster(r: Roster): void {
  localStorage.setItem(KEY, JSON.stringify(r));
}

export function resetRoster(): Roster {
  localStorage.removeItem(KEY);
  return defaultRoster();
}
