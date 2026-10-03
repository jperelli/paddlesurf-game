import './style.css';
import { Game } from './game';
import { Hud } from './hud';
import { loadRoster, saveRoster } from './roster';
import { PRESETS, type Preset } from './conditions';
import { newSessionCode, normalizeCode } from './rng';
import { loadQuality } from './quality';
import { SettingsPanel } from './settings';
import { StartScreen } from './start';
import { TouchControls } from './touch';
import { t } from './i18n';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<canvas id="gl"></canvas><div id="hud"></div><div id="start"></div><div id="touch"></div><div id="settings"></div>`;

const canvas = document.querySelector<HTMLCanvasElement>('#gl')!;
const roster = loadRoster();
// A shared link (?spot=&cond=&seed=) overrides the saved spot and sets up the same session.
const params = new URLSearchParams(location.search);
const linkSpot = params.get('spot');
if (linkSpot !== null) {
  const i = roster.spots.findIndex((s) => s.name === linkSpot || String(roster.spots.indexOf(s)) === linkSpot);
  if (i >= 0) roster.spotIndex = i;
}
const hud = new Hud(document.querySelector<HTMLElement>('#hud')!);
const game = new Game(canvas, roster.spots[roster.spotIndex], roster.surfers[roster.surferIndex], hud, loadQuality());
const linkCond = params.get('cond');
if (linkCond && PRESETS.some((p) => p.id === linkCond)) game.preset = linkCond as Preset;
const linkSeed = params.get('seed');
if (linkSeed && normalizeCode(linkSeed)) game.seed = normalizeCode(linkSeed);

function syncUrl(): void {
  const u = new URL(location.href);
  u.searchParams.set('spot', String(roster.spotIndex));
  u.searchParams.set('cond', game.preset);
  u.searchParams.set('seed', game.seed);
  history.replaceState(null, '', u);
}

const settings = new SettingsPanel(document.querySelector<HTMLElement>('#settings')!, roster, game);
const start = new StartScreen(document.querySelector<HTMLElement>('#start')!, roster, game, hud, () => {
  saveRoster(roster);
  settings.refresh();
});
new TouchControls(document.querySelector<HTMLElement>('#touch')!, canvas, hud.element, game.input, settings);

function renderConditions(): void {
  start.setConditions(PRESETS, game.preset, (id) => {
    game.preset = id as Preset;
    syncUrl();
    renderConditions();
  });
}
renderConditions();
start.setSeed(game.seed);
start.bindSeed(
  (raw) => {
    const code = normalizeCode(raw);
    if (code) game.seed = code;
    syncUrl();
  },
  () => {
    game.seed = newSessionCode();
    start.setSeed(game.seed);
    syncUrl();
  },
  () => {
    syncUrl();
    navigator.clipboard
      ?.writeText(location.href)
      .then(() => start.seedNoteText(t('Link copied: same spot, conditions and waves for your friends')))
      .catch(() => start.seedNoteText(location.href));
  },
);
syncUrl();
start.bindSpot((i) => {
  roster.spotIndex = i;
  game.applySpot(roster.spots[i]);
  saveRoster(roster);
  syncUrl();
  settings.refresh();
});
let shownSpot = game.spot;
let shownSurfer = game.surfer;

declare global {
  interface Window {
    paddlesurf: Game;
  }
}
window.paddlesurf = game;

let last = performance.now();
function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;
  game.update(dt);
  const starting = game.phase === 'start';
  start.setVisible(starting);
  document.body.classList.toggle('starting', starting);
  if (game.spot !== shownSpot || game.surfer !== shownSurfer) {
    // Settings switched the spot or surfer: keep the start screen tiles in step.
    shownSpot = game.spot;
    shownSurfer = game.surfer;
    start.render();
  }
  hud.update(
    {
      phase: game.phase,
      fatigue: game.fatigue,
      stance: game.stance,
      score: game.score,
      caught: game.caught,
      setLabel: starting ? '' : game.setLabel(),
      surfer: game.surfer.name,
      spot: game.spot.name,
      ridePoints: game.ride?.points ?? 0,
    },
    now,
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
