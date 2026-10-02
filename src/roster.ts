import { DEFAULT_SURFER, DEFAULT_WATER, type SurferPalette, type WaterPalette } from './palette';
import type { SpotConfig } from './wave';

export interface Surfer {
  name: string;
  palette: SurferPalette;
}

export interface Spot extends SpotConfig {
  water: WaterPalette;
}

export interface Roster {
  surfers: Surfer[];
  spots: Spot[];
  surferIndex: number;
  spotIndex: number;
}

const KEY = 'paddlesurf.roster.v1';

export function defaultRoster(): Roster {
  return {
    surfers: [
      { name: 'Julian', palette: { ...DEFAULT_SURFER } },
      { name: 'Friend 1', palette: { ...DEFAULT_SURFER, wetsuit: '#1d2a3a', board: '#2f7fb8', boardAccent: '#f4f4f4' } },
      { name: 'Friend 2', palette: { ...DEFAULT_SURFER, wetsuit: '#2a2a2a', board: '#f0f0ea', boardAccent: '#2aa4b5' } },
    ],
    spots: [
      {
        name: 'Home break',
        minHeight: 1.1,
        maxHeight: 2.0,
        peelSpeed: 3.2,
        sectionChance: 0.35,
        peakRange: 22,
        waveSpeed: 6,
        water: { ...DEFAULT_WATER },
      },
      {
        name: 'Point (long walls)',
        minHeight: 1.0,
        maxHeight: 1.6,
        peelSpeed: 2.6,
        sectionChance: 0.15,
        peakRange: 30,
        waveSpeed: 5.5,
        water: { ...DEFAULT_WATER, face: '#3f6b6a', deep: '#2f4f66', sky: '#a9c4d8' },
      },
      {
        name: 'Beachie (fast, closes out)',
        minHeight: 1.3,
        maxHeight: 2.4,
        peelSpeed: 4.2,
        sectionChance: 0.6,
        peakRange: 15,
        waveSpeed: 6.5,
        water: { ...DEFAULT_WATER, face: '#6f6a4c', deep: '#5a6274', sky: '#9fb3c4' },
      },
    ],
    surferIndex: 0,
    spotIndex: 0,
  };
}

export function loadRoster(): Roster {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultRoster();
    const parsed = JSON.parse(raw) as Roster;
    if (!parsed.surfers?.length || !parsed.spots?.length) return defaultRoster();
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
