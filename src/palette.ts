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
  hair: string;
  board: string;
  boardNose: string;
  boardTail: string;
  paddle: string;
  blade: string;
}

// Everything below is sampled from Julian's reference photo: olive-green face, grey-blue deep water,
// hazy sky, black full wetsuit, red board with an orange nose and a yellow-green tail, dark paddle.
export const DEFAULT_WATER: WaterPalette = {
  sky: '#86b0e6',
  deep: '#20575f',
  face: '#357b95',
  foam: '#e6ebf0',
  sand: '#c9b58a',
};

export const DEFAULT_SURFER: SurferPalette = {
  wetsuit: '#1a1722',
  skin: '#9a6a55',
  hair: '#3f3b36',
  board: '#a20223',
  boardNose: '#e8622a',
  boardTail: '#cfd25a',
  paddle: '#4a4b3e',
  blade: '#d9dad0',
};

export type PaletteKey = keyof WaterPalette | keyof SurferPalette;

export const WATER_KEYS: (keyof WaterPalette)[] = ['face', 'deep', 'foam', 'sky', 'sand'];
export const SURFER_KEYS: (keyof SurferPalette)[] = ['wetsuit', 'skin', 'hair', 'board', 'boardNose', 'boardTail', 'paddle', 'blade'];

export const KEY_LABELS: Record<PaletteKey, string> = {
  face: 'Wave face',
  deep: 'Deep water',
  foam: 'Foam',
  sky: 'Sky',
  sand: 'Sand',
  wetsuit: 'Wetsuit',
  skin: 'Skin',
  hair: 'Hair',
  board: 'Board',
  boardNose: 'Board nose',
  boardTail: 'Board tail',
  paddle: 'Paddle shaft',
  blade: 'Paddle blade',
};
