# Paddle Surf

A small 3D stand-up paddle surfing game (TypeScript + Vite + Three.js) built around the breaks and people we actually surf with.

## Play

```sh
npm install
npm run dev
```

Open the printed URL, press any key and paddle out.

## The game loop

1. **Waiting for the wave.** Waves come in sets: 3 to 7 small ones, then a set of 4 or 5 that grow and then shrink again (with some randomness). Each set wave has a **peak** (where it breaks first) and two **pockets** on either side of the breaking section. Paddle with the arrow keys, hold `Space` for power strokes. Power strokes fill the tiredness bar and get slower the more tired you are. When the crest reaches you:
   - in a pocket and not paddling into the peak: you are on, go to 2
   - on the peak: the lip lands on you, wipeout
   - anywhere else: the wave passes under you
2. **Riding.** The wave peels away from the peak and you ride away from the lip. `←`/`→` steer along the face (toward the lip or down to the trough). `↑`/`↓` step forward or back on the board: back foot = slower but turns much faster, front foot = slower and turns less, centre = fastest.
3. **End of the wave.** Either a section closes out in front of you (or the foam catches you from behind), you climb over the back, or the wave fades out near the shore with no push left. Points depend on wave size, time on the face and how high in the pocket you ride.
4. Press any key to paddle back out. Wipeouts cost extra energy.

`H` toggles the learning hints (red cone = peak, green bars = the two pockets). `Esc` opens settings.

## Realism from a photo

Settings (`Esc`) lets you load a photo of the spot, click "Wave face", "Deep water", "Sky", "Wetsuit", "Board", ... and then click on the photo to sample that colour. "Auto water from photo" takes a quick guess from the top, middle and bottom bands. The defaults are sampled from Julian's photo: olive-green water, black wetsuit, red board with a yellow tail.

Surfers (name + colours) and spots (name, wave height range, how fast it peels, how often it closes out, water colours) are editable and saved in the browser (`localStorage`). "Reset to defaults" restores the built-in roster in `src/roster.ts`.

## Code map

- `src/wave.ts`: set scheduler, wave parameters, breaking fronts, height field
- `src/sea.ts`: the sea mesh (vertex colours for face / deep water / foam)
- `src/surfer.ts`: low-poly paddler rig and poses
- `src/game.ts`: the four phases, takeoff rules, ride dynamics, camera
- `src/hud.ts`, `src/settings.ts`: UI
- `src/palette.ts`, `src/roster.ts`: colours and the surfer/spot roster

`npm run build` runs `tsc` and produces a static `dist/` you can host anywhere.
