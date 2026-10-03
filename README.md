# Paddle Surf

A small 3D stand-up paddle surfing game (TypeScript + Vite + Three.js) built around the breaks and people we actually surf with.

Play it at https://paddlesurf.coffee.jperelli.com.ar (deployed from `main` via Coolify).

## Play

```sh
npm install
npm run dev
```

Open the printed URL. The UI is in English or Spanish, following the browser language (`?lang=es` or `?lang=en` forces one; strings live in `src/i18n.ts`). The start screen shows your surfer idling on the board: pick a face (Alfredo, Julian, Ferchu or el Tano, each a real photo cut out along the face oval and aligned to the eyes, mouth and chin of the face texture, then mapped onto the head), a board and a paddle, type the name for the high scores, then pick the spot from the photo tiles and paddle out. Settings > "Back to the start screen" brings it back.

## The game loop

1. **Waiting for the wave.** Waves come in sets: 3 to 7 small ones, then a set of 4 or 5 that grow and then shrink again (with some randomness). Each set wave has a **peak** (where it breaks first) and two **pockets** on either side of the breaking section. Paddle with the arrow keys, hold `Space` for power strokes. Power strokes fill the tiredness bar and get slower the more tired you are. When the crest reaches you:
   - in a pocket and not paddling into the peak: you are on, go to 2
   - in the impact zone: wipeout if you sit still, are sideways to it, hit the unbroken lip nose-first, or the whitewater is too high; low fresh foam can be punched through nose-first (or shoves you in if it catches you from behind), and after a few seconds the foam has dissipated and rolls under you harmlessly
   - sitting still in the pocket as it arrives also throws you
   - anywhere else: the wave passes under you
2. **Riding.** The wave peels away from the peak and you ride away from the lip. `←`/`→` steer along the face (toward the lip or down to the trough). `↑`/`↓` step forward or back on the board: back foot = slower but turns much faster, front foot = slower and turns less, centre = fastest.
3. **End of the wave.** Either a section closes out in front of you (or the foam catches you from behind), you climb over the back, or the wave fades out near the shore with no push left. Points depend on wave size, time on the face and how high in the pocket you ride.
4. Press any key to paddle back out. Wipeouts cost extra energy.

On phones and tablets an on-screen joystick (drag the knob, diagonals work), POWER button and Hints/Settings buttons replace the keyboard; tap the screen to paddle back out.

The peak hint (two translucent blue arrows pulsing above the peak, pointing to the pockets; only one on a wave that peels one way) is on by default; Settings > Gameplay or `H` hides it. The water is clear enough to see the sand bottom: about 2 m deep out the back, ramping up to the beach. `Esc` opens settings.

## Look

The colours and the player are taken from Julian's reference photo and baked in: olive-green wave face, grey-blue deep water, a paddler in a black full wetsuit crouched side-on to the wave, and a red SUP with an orange striped nose and a yellow-green tail. Nothing has to be loaded at runtime; `src/palette.ts` holds the sampled colours and `src/surfer.ts` builds the board deck and the paddler from them.

## Conditions

Every session rolls the day's conditions, shown in the first HUD message: swell arriving straight or at an angle (the crest line is rotated, so one end of the wave arrives first), a longshore current that slowly drifts you sideways while you wait, and wind. Offshore wind tears a plume of spindrift off the crest of a wave that is standing up and carries it out to sea; onshore or cross wind blows the spray the other way. The whitewater edge is ragged and wanders, and the foam behind it thins into patches. `src/conditions.ts` holds the rolls.

## Spots (levels)

Pick the spot on the start screen (photo tiles; `public/spots`) or in settings:

- **San Clemente del Tuyú**: colours from the first photo (olive face, grey-blue water), small waves (0.9–1.3 m), lulls of 3–7 small waves then sets of 4–5. 60% of set waves are A-frames with both pockets, 20% are rights only, 20% lefts only.
- **Chicama, Peru**: colours from the second photo (teal water, blue sky), waves twice the size (1.8–2.6 m), lulls of 1–2 small waves then long sets of 8–10. Every wave peels right only: everything on the left of the peak is whitewater, the only pocket is on the right.
- **Praia do Rosa, Brazil** (Imbituba, Santa Catarina): characteristics from surf guides (brazilsurftravel.com, wannasurf.com, wavemasterai.com.br): sandy beach break, rights and lefts, 0.5–2.5 m, fast and powerful with quick sections and barrel potential, very consistent; the lefts at Rosa Norte are the longer, hollower ones. In the game: 1.2–2.0 m, lulls of 3–6 then sets of 4–7, peels fast, more sections/closeouts, 30% A-frames / 30% rights only / 40% lefts only. Water colours sampled from the Wikimedia Commons photo "Praia do Rosa Norte.jpg" (grey-teal water, clear blue sky, pale sand).
- **Nazaré, Portugal** (Praia do Norte): the submarine canyon focuses the swell into huge A-frame peaks, mostly ridden as rights, thick and fast, with sets stacking up with little rest. In the game: 5–8 m, lulls of 2–4 then sets of 3–5, 35% A-frames / 50% rights only / 15% lefts only, grey-blue Atlantic water. Tile photo: Wikimedia Commons "Nazaré Praia Do Norte Big Wave (133367589).jpeg" (CC BY 3.0).
- **Castelldefels, Spain**: Mediterranean beach break with knee-to-waist windswell, slow and crumbly, closes out a lot; the smallest waves in the game (0.55–0.8 m), lulls of 4–8 then sets of 3–4, 40% A-frames / 30% rights / 30% lefts, teal water over golden sand. Tile photo: Wikimedia Commons "Castelldefels beach (38517684145).jpg" (CC BY-SA 2.0).

A run is everything you catch until you fall (peak, closeout or the foam). When you fall, the run (waves and points) is sent under the name from the start screen to the leaderboard, which has Today / This week / This month / All time tabs (also behind "High scores" on the start screen). Scores are stored in SQLite by `server/index.mjs`, a small Node server (no dependencies, `node:sqlite`) that also serves the built game: `npm run build && npm start` (env `PORT`, `DB_PATH`, default `./data/scores.db`); in development `npm run server` next to `npm run dev`, Vite proxies `/api`. The Dockerfile runs it on port 80 with the database on a `/data` volume.

The start screen (`src/start.ts`) picks the surfer (the face photos in `public/faces` are mapped onto the head), board and paddle; settings add three drawn faces, a photo of your own face, and three body shapes (`src/looks.ts`). Surfers (name + colours) and spots (name, wave height range, how fast it peels, how often it closes out, rights/lefts share, waves per set, water colours) are editable and saved in the browser (`localStorage`). "Reset to defaults" restores the built-in roster in `src/roster.ts`.

## Code map

- `src/wave.ts`: set scheduler, wave parameters, breaking fronts, height field
- `src/conditions.ts`: swell angle, current and wind for the session
- `src/lip.ts`: the pitching lip, landing spray and wind-blown spindrift
- `src/sea.ts`: the sea mesh (vertex colours for face / deep water / foam)
- `src/surfer.ts`: paddler rig (photo-based board deck, crouched riding pose, paddle)
- `src/game.ts`: the four phases, takeoff rules, ride dynamics, camera
- `src/hud.ts`, `src/settings.ts`: UI; `src/scores.ts`: leaderboard client; `server/index.mjs`: static files + `/api/scores` on SQLite
- `src/palette.ts`, `src/roster.ts`, `src/looks.ts`: colours, the surfer/spot roster and the face/body/board/paddle options

`npm run build` runs `tsc` and produces a static `dist/` you can host anywhere.
