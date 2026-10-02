import './style.css';
import { Game } from './game';
import { Hud } from './hud';
import { describeSpot, loadRoster, saveRoster } from './roster';
import { SettingsPanel } from './settings';
import { TouchControls } from './touch';

const app = document.querySelector<HTMLDivElement>('#app')!;
app.innerHTML = `<canvas id="gl"></canvas><div id="hud"></div><div id="touch"></div><div id="settings"></div>`;

const canvas = document.querySelector<HTMLCanvasElement>('#gl')!;
const roster = loadRoster();
const hud = new Hud(document.querySelector<HTMLElement>('#hud')!);
const game = new Game(canvas, roster.spots[roster.spotIndex], roster.surfers[roster.surferIndex], hud);
const settings = new SettingsPanel(document.querySelector<HTMLElement>('#settings')!, roster, game);
new TouchControls(document.querySelector<HTMLElement>('#touch')!, canvas, hud.element, game.input, settings);

function renderSpots(): void {
  hud.setSpots(
    roster.spots.map((s) => ({ name: s.name, desc: describeSpot(s) })),
    roster.spotIndex,
    (i) => {
      roster.spotIndex = i;
      game.applySpot(roster.spots[i]);
      saveRoster(roster);
      settings.refresh();
      renderSpots();
    },
  );
}
renderSpots();
let shownSpot = game.spot;

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
  if (game.spot !== shownSpot) {
    shownSpot = game.spot;
    renderSpots();
  }
  hud.update(
    {
      phase: game.phase,
      fatigue: game.fatigue,
      stance: game.stance,
      score: game.score,
      caught: game.caught,
      setLabel: game.phase === 'start' ? '' : game.setLabel(),
      hint: game.hint,
      surfer: game.surfer.name,
      spot: game.spot.name,
      ridePoints: game.ride?.points ?? 0,
    },
    now,
  );
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
